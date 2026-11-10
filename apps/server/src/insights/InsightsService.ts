import {
  CommandId,
  type EnvironmentId,
  InsightAttributionInput,
  InsightsEvidenceInput,
  InsightsEvidenceResult,
  InsightRecommendation,
  InsightUpdateInput,
  InsightsError,
  InsightsReport,
  InsightsSettings,
  InsightsSnapshot,
  InsightsSubmitInput,
  ModelSelection,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  type InsightChangeProblem,
  type InsightEdit,
  type InsightEvidence,
  type InsightFrictionCluster,
  type InsightSkillUsage,
  type InsightTask,
  type InsightsProject,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import * as SqlClient from "effect/sql/SqlClient";

import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadSkills from "../orchestration-v2/ThreadSkills.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  addInsightsMetrics,
  emptyInsightsMetrics,
  evidenceExcerpt,
  insightKey,
  sumInsightSkills,
} from "./insightsEvidence.ts";
import { INSIGHTS_ANALYSIS_PROMPT, insightImplementationPrompt } from "./insightsPrompt.ts";
import { frictionSignature, mergeFrictionClusters } from "./toolFriction.ts";

const TASK_ID = ScheduledTaskId.make("insights:daily");
/** Excerpt characters one packet may carry, shared between this environment and linked ones. */
const CHARACTER_BUDGET = 150000;
/** Collect holds the Insights lock, so a linked environment that stops answering is skipped. */
const LINKED_TIMEOUT = "2 minutes";
const decodeSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(InsightsSettings));
const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(InsightsReport));
const decodeRecommendation = Schema.decodeUnknownEffect(
  Schema.fromJsonString(InsightRecommendation),
);
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(InsightsSettings));
const encodeReport = Schema.encodeEffect(Schema.fromJsonString(InsightsReport));
const encodeRecommendation = Schema.encodeEffect(Schema.fromJsonString(InsightRecommendation));
const encodeAttribution = Schema.encodeEffect(Schema.fromJsonString(InsightAttributionInput));
const decodeSelection = Schema.decodeUnknownEffect(Schema.fromJsonString(ModelSelection));
const isInsightsError = Schema.is(InsightsError);
const storageError = (cause: unknown) =>
  isInsightsError(cause) ? cause : new InsightsError({ reason: "storage", cause });

export class InsightsService extends Context.Service<
  InsightsService,
  {
    readonly snapshot: () => Effect.Effect<InsightsSnapshot, InsightsError>;
    readonly subscribe: () => Stream.Stream<InsightsSnapshot, InsightsError>;
    readonly configure: (input: InsightsSettings) => Effect.Effect<InsightsSnapshot, InsightsError>;
    readonly runNow: () => Effect.Effect<{ threadId: ThreadId | null }, InsightsError>;
    readonly report: (id: string) => Effect.Effect<InsightsReport, InsightsError>;
    readonly recommendation: (id: string) => Effect.Effect<InsightRecommendation, InsightsError>;
    readonly update: (
      input: InsightUpdateInput,
    ) => Effect.Effect<InsightRecommendation, InsightsError>;
    readonly implement: (id: string) => Effect.Effect<{ threadId: ThreadId }, InsightsError>;
    readonly collect: (threadId: ThreadId) => Effect.Effect<
      {
        report: InsightsReport;
        previousReports: ReadonlyArray<InsightsReport>;
        recommendations: ReadonlyArray<InsightRecommendation>;
        projects: ReadonlyArray<
          InsightsProject & { environmentId?: EnvironmentId; environmentLabel?: string }
        >;
      },
      InsightsError
    >;
    /** This environment's share of a linked environment's analysis. */
    readonly evidence: (
      input: InsightsEvidenceInput,
    ) => Effect.Effect<InsightsEvidenceResult, InsightsError>;
    readonly submit: (
      threadId: ThreadId,
      input: InsightsSubmitInput,
    ) => Effect.Effect<InsightsReport, InsightsError>;
    readonly record: (
      threadId: ThreadId,
      input: InsightAttributionInput,
    ) => Effect.Effect<void, InsightsError>;
  }
>()("t3/insights/InsightsService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const scheduler = yield* ScheduledTasks.ScheduledTaskService;
  const launcher = yield* ThreadLaunch.ThreadLaunchService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const links = yield* PeerLinks.PeerLinks;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const digest = yield* Digest.Digest;
  const random = yield* SecureRandom.SecureRandom;
  const threadSkills = yield* ThreadSkills.ThreadSkills;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const updates = yield* PubSub.sliding<void>(1);
  const lock = yield* Semaphore.make(1);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const notify = PubSub.publish(updates, undefined);

  const settings = Effect.fn("InsightsService.settings")(function* () {
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM insights_settings WHERE id = 1`;
    return rows[0] ? yield* decodeSettings(rows[0].payload_json) : null;
  }, Effect.mapError(storageError));
  const report = Effect.fn("InsightsService.report")(function* (id: string) {
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM insights_reports WHERE id = ${id}`;
    if (!rows[0]) return yield* new InsightsError({ reason: "not_found" });
    return yield* decodeReport(rows[0].payload_json);
  }, Effect.mapError(storageError));
  const recommendation = Effect.fn("InsightsService.recommendation")(function* (id: string) {
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM insights_recommendations WHERE id = ${id}`;
    if (!rows[0]) return yield* new InsightsError({ reason: "not_found" });
    return yield* decodeRecommendation(rows[0].payload_json);
  }, Effect.mapError(storageError));
  const saveReport = Effect.fn("InsightsService.saveReport")(function* (value: InsightsReport) {
    yield* sql`INSERT INTO insights_reports (id, thread_id, status, created_at, through_sequence, payload_json)
      VALUES (${value.id}, ${value.threadId}, ${value.status}, ${value.createdAt}, ${value.throughSequence}, ${yield* encodeReport(value)})
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload_json = excluded.payload_json`;
  });
  const saveRecommendation = Effect.fn("InsightsService.saveRecommendation")(function* (
    value: InsightRecommendation,
  ) {
    yield* sql`INSERT INTO insights_recommendations (id, insight_key, status, updated_at, payload_json)
      VALUES (${value.id}, ${value.key}, ${value.status}, ${value.updatedAt}, ${yield* encodeRecommendation(value)})
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, payload_json = excluded.payload_json`;
  });
  const snapshot = Effect.fn("InsightsService.snapshot")(function* () {
    yield* recoverReports();
    const config = yield* settings();
    const { tasks } = yield* scheduler.list();
    const latest = yield* sql<{
      threadId: ThreadId;
      status: OrchestrationV2RunStatus;
    }>`SELECT r.thread_id AS threadId, r.status
      FROM orchestration_v2_projection_runs r WHERE EXISTS (SELECT 1 FROM orchestration_v2_projection_messages m
        WHERE m.thread_id = r.thread_id AND json_extract(m.payload_json, '$.scheduledTaskId') = ${TASK_ID})
      ORDER BY r.requested_at DESC, r.ordinal DESC LIMIT 1`;
    const reports = yield* sql<{
      payload_json: string;
    }>`SELECT json_remove(json_set(payload_json, '$.evidence', json('[]')), '$.tasks', '$.friction') AS payload_json FROM insights_reports ORDER BY created_at DESC LIMIT 30`;
    const recs = yield* sql<{
      payload_json: string;
    }>`SELECT json_replace(json_set(payload_json, '$.evidence', json('[]'), '$.history', json('[]'), '$.assessments', json(COALESCE((SELECT json_group_array(json_set(value, '$.evidence', json('[]'))) FROM json_each(json_extract(payload_json, '$.assessments'))), '[]'))),
      '$.edits', json('[]'), '$.incidents', json(COALESCE((SELECT json_group_array(json_set(value, '$.evidence', json('[]'))) FROM json_each(json_extract(payload_json, '$.incidents'))), '[]'))) AS payload_json FROM insights_recommendations ORDER BY updated_at DESC LIMIT 251`;
    return {
      settings: config,
      latestAnalysis: latest[0] ?? null,
      schedule: tasks.find((task) => task.id === TASK_ID) ?? null,
      reports: (yield* Effect.forEach(reports, (row) => decodeReport(row.payload_json))).map(
        (entry) => ({ ...entry, evidence: [] }),
      ),
      recommendations: (yield* Effect.forEach(recs.slice(0, 250), (row) =>
        decodeRecommendation(row.payload_json),
      )).map(({ edits, incidents, ...entry }) => ({
        ...entry,
        evidence: [],
        history: [],
        assessments: entry.assessments.map((assessment) => ({ ...assessment, evidence: [] })),
        // An absent `edits` marks a recommendation from before exact changes, so it stays absent.
        ...(edits ? { edits: [] } : {}),
        ...(incidents
          ? { incidents: incidents.map((incident) => ({ ...incident, evidence: [] })) }
          : {}),
      })),
      truncated: recs.length > 250,
    };
  }, Effect.mapError(storageError));

  const validateConfiguration = Effect.fn("InsightsService.validateConfiguration")(function* (
    input: InsightsSettings,
  ) {
    const projects = yield* sql<{
      project_id: string;
    }>`SELECT project_id FROM projection_projects WHERE deleted_at IS NULL`;
    const ids = new Set(projects.map((p) => p.project_id));
    const available = yield* providers.getProviders;
    const provider = available.find((p) => p.instanceId === input.modelSelection.instanceId);
    const applyWith = input.implementationModelSelection;
    const linked = input.linkedProjects ?? [];
    const linkedAvailable =
      linked.length === 0 ||
      ((yield* links.enabled) &&
        new Set(linked.map((entry) => entry.environmentId)).size === linked.length &&
        (yield* Effect.forEach(linked, (entry) => links.get(entry.environmentId)).pipe(
          Effect.map((found) => found.every(Option.isSome)),
          Effect.orElseSucceed(() => false),
        )));
    if (
      !ids.has(input.projectId) ||
      input.projectIds.some((id) => !ids.has(id)) ||
      !linkedAvailable ||
      (applyWith !== undefined &&
        !available.some(
          (p) =>
            p.instanceId === applyWith.instanceId &&
            p.enabled &&
            p.models.some((model) => model.slug === applyWith.model),
        )) ||
      provider?.driver !== "codex" ||
      !provider.enabled ||
      !input.modelSelection.model.includes("astra") ||
      !provider.models.some((model) => {
        const effort = model.capabilities?.optionDescriptors?.find(
          (option) => option.id === "reasoningEffort",
        );
        return (
          model.slug === input.modelSelection.model &&
          (!effort ||
            (effort.type === "select" && effort.options.some((option) => option.id === "max")))
        );
      })
    ) {
      return yield* new InsightsError({ reason: "invalid_settings" });
    }
  });

  const saveSchedule = (config: InsightsSettings) =>
    scheduler
      .upsert({
        id: TASK_ID,
        title: "Daily workflow insights",
        prompt: INSIGHTS_ANALYSIS_PROMPT,
        enabled: config.enabled,
        schedule: { type: "fixed_time", timeOfDay: config.timeOfDay },
        projectId: config.projectId,
        threadId: null,
        workspaceStrategy: { type: "root" },
        modelSelection: config.modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      })
      .pipe(Effect.mapError((cause) => new InsightsError({ reason: "schedule", cause })));

  const configure = Effect.fn("InsightsService.configure")(
    function* (input: InsightsSettings) {
      if (input.enabled) yield* validateConfiguration(input);
      const { linkedProjects, ...rest } = input;
      const config: InsightsSettings = {
        ...rest,
        projectIds: [...new Set(input.projectIds)],
        ...(linkedProjects?.length
          ? {
              linkedProjects: linkedProjects.map((entry) => ({
                ...entry,
                projectIds: [...new Set(entry.projectIds)],
              })),
            }
          : {}),
        modelSelection: {
          ...input.modelSelection,
          options: [
            ...(input.modelSelection.options ?? []).filter(
              (option) => option.id !== "reasoningEffort",
            ),
            { id: "reasoningEffort", value: "max" },
          ],
        },
      };
      yield* saveSchedule(config);
      yield* sql`INSERT INTO insights_settings (id, payload_json) VALUES (1, ${yield* encodeSettings(config)})
      ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`;
      yield* notify;
      return yield* snapshot();
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const recoverReports = Effect.fn("InsightsService.recoverReports")(function* () {
    const rows = yield* sql<{ payload_json: string; active: number }>`SELECT r.payload_json,
      EXISTS(SELECT 1 FROM orchestration_v2_projection_runs run WHERE run.thread_id = r.thread_id
        AND run.status IN ('preparing', 'queued', 'starting', 'running', 'waiting')) AS active
      FROM insights_reports r WHERE r.status = 'analyzing'`;
    for (const row of rows) {
      if (row.active) continue;
      const previous = yield* decodeReport(row.payload_json);
      const failed: InsightsReport = {
        ...previous,
        status: "failed",
        completedAt: yield* now,
        summary:
          "The analysis ended without submitting a report. Its evidence will be retried on the next run.",
      };
      yield* sql`UPDATE insights_reports SET status = 'failed', payload_json = ${yield* encodeReport(failed)} WHERE id = ${failed.id} AND status = 'analyzing'`;
    }
  });
  const runNow = Effect.fn("InsightsService.runNow")(
    function* () {
      const config = yield* settings();
      if (config === null) return yield* new InsightsError({ reason: "not_configured" });
      yield* validateConfiguration(config);
      yield* recoverReports();
      const pending = yield* sql`SELECT 1 FROM orchestration_v2_projection_runs r
      JOIN orchestration_v2_projection_messages m ON m.thread_id = r.thread_id
      WHERE json_extract(m.payload_json, '$.scheduledTaskId') = ${TASK_ID}
      AND r.status IN ('preparing', 'queued', 'starting', 'running', 'waiting') LIMIT 1`;
      if (pending.length) return yield* new InsightsError({ reason: "analysis_running" });
      const result = yield* scheduler
        .runNow({ id: TASK_ID })
        .pipe(Effect.mapError((cause) => new InsightsError({ reason: "schedule", cause })));
      yield* notify;
      return { threadId: result.threadId };
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const boundedId = (id: string) =>
    id.length <= 300
      ? Effect.succeed(id)
      : digest
          .digestHex(Digest.sha256, new TextEncoder().encode(id))
          .pipe(Effect.map((hex) => `sha256:${hex}`));

  const projectsIn = (projectIds: ReadonlyArray<ProjectId>) =>
    sql<InsightsProject>`SELECT project_id AS projectId, title, workspace_root AS workspaceRoot
      FROM projection_projects WHERE deleted_at IS NULL AND ${projectIds.length ? sql.in("project_id", projectIds) : sql`1 = 1`}`;

  /** Activity in `projectIds` (all when empty) after `fromSequence`, as bounded evidence. */
  const gather = Effect.fn("InsightsService.gather")(function* (
    input: InsightsEvidenceInput & { readonly excludeThreadId: ThreadId | null },
  ) {
    const highRows = yield* sql<{
      sequence: number;
    }>`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events WHERE application_event_version = 2`;
    const upper = highRows[0]?.sequence ?? 0;
    const createdAt = yield* now;
    const since = DateTime.formatIso(
      DateTime.subtract(DateTime.makeUnsafe(createdAt), { days: input.lookbackDays }),
    );
    const rows = yield* sql<{
      run_id: string;
      thread_id: ThreadId;
      project_id: ProjectId;
      title: string;
      status: string;
      selection: string;
      started_at: string | null;
      completed_at: string | null;
      sequence: number;
      root_thread_id: ThreadId;
    }>`SELECT r.run_id, r.thread_id, t.project_id, t.title, r.status,
      COALESCE(json_extract(t.payload_json, '$.lineage.rootThreadId'), r.thread_id) AS root_thread_id,
      json_extract(r.payload_json, '$.modelSelection') AS selection,
      json_extract(r.payload_json, '$.startedAt') AS started_at, r.completed_at, changed.sequence
      FROM (SELECT json_extract(metadata_json, '$.runId') AS run_id, MAX(sequence) AS sequence FROM orchestration_events
        WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND sequence > ${input.fromSequence} AND sequence <= ${upper} AND occurred_at >= ${since} AND json_extract(metadata_json, '$.runId') IS NOT NULL
        GROUP BY json_extract(metadata_json, '$.runId')) changed
      JOIN orchestration_v2_projection_runs r ON r.run_id = changed.run_id
      JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
      WHERE t.deleted_at IS NULL AND ${input.excludeThreadId === null ? sql`1 = 1` : sql`r.thread_id <> ${input.excludeThreadId}`}
        AND ${input.projectIds.length ? sql.in("t.project_id", input.projectIds) : sql`1 = 1`}
        AND NOT EXISTS (SELECT 1 FROM insights_reports previous WHERE previous.thread_id = r.thread_id)
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_messages m WHERE m.thread_id = r.thread_id AND json_extract(m.payload_json, '$.scheduledTaskId') = ${TASK_ID})
      ORDER BY changed.sequence ASC LIMIT ${input.maxRuns + 1}`;
    const runs = rows.slice(0, input.maxRuns);
    const hasMore = rows.length > input.maxRuns;
    const throughSequence = hasMore ? runs.at(-1)!.sequence : upper;
    const metrics = { ...emptyInsightsMetrics() };
    const evidence: InsightEvidence[] = [];
    const skillUsage: InsightSkillUsage[] = [];
    const sampledRuns = new Set(runs.map((run) => run.run_id));
    const tasks = new Map<
      ThreadId,
      Types.Mutable<Omit<InsightTask, "threadIds" | "frictionKeys" | "pullRequest">> & {
        threadIds: Set<ThreadId>;
        frictionKeys: Set<string>;
        briefId: string | null;
      }
    >();
    const friction = new Map<
      string,
      Types.Mutable<Omit<InsightFrictionCluster, "tasks" | "maxPerTask" | "evidenceIds">> & {
        perTask: Map<ThreadId, number>;
        evidenceIds: string[];
      }
    >();
    for (const run of runs) {
      metrics.runs++;
      if (run.status === "completed") metrics.completed++;
      else if (run.status === "failed") metrics.failed++;
      else if (["interrupted", "cancelled", "rolled_back"].includes(run.status))
        metrics.interrupted++;
      else metrics.active++;
      if (run.started_at && run.completed_at)
        metrics.activeMilliseconds += Math.max(
          0,
          Date.parse(run.completed_at) - Date.parse(run.started_at),
        );
      const identity = {
        occurredAt: run.completed_at ?? run.started_at ?? createdAt,
        threadId: run.thread_id,
        runId: run.run_id,
        projectId: run.project_id,
        title: run.title,
      };
      const counts = yield* sql<{ failures: number; requests: number; interrupts: number }>`SELECT
        SUM(CASE WHEN type IN ('dynamic_tool', 'command_execution') AND (status = 'failed' OR COALESCE(json_extract(payload_json, '$.exitCode'), 0) <> 0 OR json_extract(payload_json, '$.outputIndicatesFailure') = 1) THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN type IN ('user_input_request', 'approval_request') THEN 1 ELSE 0 END) AS requests,
        SUM(CASE WHEN type = 'run_interrupt_request' THEN 1 ELSE 0 END) AS interrupts
        FROM orchestration_v2_projection_turn_items WHERE run_id = ${run.run_id}`;
      metrics.toolFailures += counts[0]?.failures ?? 0;
      metrics.humanRequests += counts[0]?.requests ?? 0;
      const usage = yield* sql<{ tokens: number | null; samples: number }>`SELECT
        SUM(json_extract(p.payload_json, '$.turnTokenUsage.inputTokens') + json_extract(p.payload_json, '$.turnTokenUsage.outputTokens')) AS tokens,
        COUNT(json_extract(p.payload_json, '$.turnTokenUsage.inputTokens') + json_extract(p.payload_json, '$.turnTokenUsage.outputTokens')) AS samples
        FROM orchestration_v2_projection_provider_turns p
        JOIN orchestration_v2_projection_run_attempts a ON a.attempt_id = p.run_attempt_id
        WHERE a.run_id = ${run.run_id}`;
      metrics.tokens += usage[0]?.tokens ?? 0;
      if ((usage[0]?.samples ?? 0) > 0) metrics.runsWithTokenUsage++;
      const skills = yield* threadSkills.forRun(run.run_id);
      skillUsage.push(...skills.map((skill) => ({ skill, runs: 1 })));
      evidence.push({
        ...identity,
        id: `run:${run.run_id}`,
        itemId: null,
        kind: "run",
        text: `Status: ${run.status}; model selection: ${run.selection}; started: ${run.started_at}; ended: ${run.completed_at}; tool failures: ${counts[0]?.failures ?? 0}; user/approval requests: ${counts[0]?.requests ?? 0}; recorded tokens: ${usage[0]?.tokens ?? "unknown"}${skills.length ? `; skills loaded: ${skills.join(", ")}` : ""}. Completion is not verified task success.`,
      });
      let task = tasks.get(run.root_thread_id);
      if (!task) {
        const root = yield* sql<{
          title: string;
          project_id: ProjectId;
        }>`SELECT title, project_id FROM orchestration_v2_projection_threads WHERE thread_id = ${run.root_thread_id}`;
        const brief = yield* sql<{
          id: string;
          run_id: string | null;
          text: string;
          created_at: string;
        }>`SELECT message_id AS id, run_id, created_at, substr(COALESCE(json_extract(payload_json, '$.text'), ''), 1, 5000) AS text
          FROM orchestration_v2_projection_messages WHERE thread_id = ${run.root_thread_id} AND role = 'user' AND streaming = 0
            AND COALESCE(json_extract(payload_json, '$.createdBy'), 'user') = 'user'
          ORDER BY created_at, message_id LIMIT 1`;
        const first = brief[0];
        task = {
          rootThreadId: run.root_thread_id,
          projectId: root[0]?.project_id ?? run.project_id,
          title: root[0]?.title ?? run.title,
          threadIds: new Set(),
          runs: 0,
          followUps: 0,
          interrupts: 0,
          agentQuestions: 0,
          failedTools: 0,
          harmlessFailures: 0,
          frictionKeys: new Set(),
          firstActivityAt: run.started_at ?? identity.occurredAt,
          lastActivityAt: identity.occurredAt,
          latestRunStatus: run.status,
          briefId: first?.id ?? null,
        };
        tasks.set(run.root_thread_id, task);
        if (first)
          evidence.push({
            ...identity,
            threadId: run.root_thread_id,
            runId: first.run_id,
            projectId: task.projectId,
            title: task.title,
            occurredAt: first.created_at,
            id: `message:${first.id}`,
            itemId: null,
            kind: "message",
            text: `Task brief, the user's first message in this task${first.run_id && sampledRuns.has(first.run_id) ? "" : " (context from before this review's activity)"}: ${first.text}`,
          });
      }
      task.threadIds.add(run.thread_id);
      task.runs++;
      task.interrupts += counts[0]?.interrupts ?? 0;
      task.agentQuestions += counts[0]?.requests ?? 0;
      task.failedTools += counts[0]?.failures ?? 0;
      if ((run.started_at ?? identity.occurredAt) < task.firstActivityAt)
        task.firstActivityAt = run.started_at ?? identity.occurredAt;
      if (identity.occurredAt >= task.lastActivityAt) {
        task.lastActivityAt = identity.occurredAt;
        task.latestRunStatus = run.status;
      }
      const prompts = yield* sql<{
        id: string;
        created_by: string;
        text: string;
        created_at: string;
      }>`SELECT message_id AS id, COALESCE(json_extract(payload_json, '$.createdBy'), 'user') AS created_by, created_at,
        substr(COALESCE(json_extract(payload_json, '$.text'), ''), 1, 5000) AS text
        FROM orchestration_v2_projection_messages WHERE run_id = ${run.run_id} AND role = 'user' AND streaming = 0
        ORDER BY created_at DESC, message_id DESC`;
      task.followUps += prompts.filter(
        (prompt) => prompt.created_by === "user" && prompt.id !== task.briefId,
      ).length;
      for (const prompt of prompts.slice(0, 4)) {
        if (prompt.id === task.briefId) continue;
        // What the agent said right before the user wrote, which the message usually answers.
        const answered = yield* sql<{
          id: string;
          text: string;
          created_at: string;
        }>`SELECT message_id AS id, created_at, substr(COALESCE(json_extract(payload_json, '$.text'), ''), 1, 5000) AS text
          FROM orchestration_v2_projection_messages WHERE thread_id = ${run.thread_id} AND role = 'assistant' AND streaming = 0 AND created_at < ${prompt.created_at}
          ORDER BY created_at DESC, message_id DESC LIMIT 1`;
        if (answered[0] && !evidence.some((entry) => entry.id === `message:${answered[0]!.id}`))
          evidence.push({
            ...identity,
            occurredAt: answered[0].created_at,
            id: `message:${answered[0].id}`,
            itemId: null,
            kind: "message",
            text: `Agent message the next user-side message replied to: ${answered[0].text}`,
          });
        evidence.push({
          ...identity,
          occurredAt: prompt.created_at,
          id: `message:${prompt.id}`,
          itemId: null,
          kind: "message",
          text: `${prompt.created_by === "user" ? "Follow-up the user wrote" : "Message an agent sent on the user's side (not the user)"}: ${prompt.text}`,
        });
      }
      const final = yield* sql<{
        id: string;
        text: string;
        created_at: string;
      }>`SELECT message_id AS id, created_at, substr(COALESCE(json_extract(payload_json, '$.text'), ''), 1, 5000) AS text
        FROM orchestration_v2_projection_messages WHERE run_id = ${run.run_id} AND role = 'assistant' AND streaming = 0
        ORDER BY created_at DESC, message_id DESC LIMIT 1`;
      if (final[0] && !evidence.some((entry) => entry.id === `message:${final[0]!.id}`))
        evidence.push({
          ...identity,
          occurredAt: final[0].created_at,
          id: `message:${final[0].id}`,
          itemId: null,
          kind: "message",
          text: `The run's final agent reply: ${final[0].text}`,
        });
      const requests = yield* sql<{
        id: string;
        type: string;
        text: string;
        occurred_at: string;
      }>`SELECT turn_item_id AS id, type, updated_at AS occurred_at,
        substr(COALESCE(json_extract(payload_json, '$.questions'), json_extract(payload_json, '$.prompt'), json_extract(payload_json, '$.text'), ''), 1, 3000) AS text
        FROM orchestration_v2_projection_turn_items WHERE run_id = ${run.run_id}
          AND type IN ('run_interrupt_request', 'user_input_request', 'approval_request')
        ORDER BY ordinal DESC LIMIT 3`;
      for (const request of requests)
        evidence.push({
          ...identity,
          occurredAt: request.occurred_at,
          id: `item:${request.id}`,
          itemId: request.id,
          kind: "tool",
          text:
            request.type === "run_interrupt_request"
              ? "The user interrupted the run."
              : `The agent asked the user (${request.type}): ${request.text}`,
        });
      const failures = yield* sql<{
        id: string;
        type: string;
        tool_name: string | null;
        command: string | null;
        output: string;
        exit_code: number | null;
        occurred_at: string;
      }>`SELECT turn_item_id AS id, type, updated_at AS occurred_at, json_extract(payload_json, '$.toolName') AS tool_name,
        substr(CASE WHEN json_type(payload_json, '$.input') = 'text' THEN json_extract(payload_json, '$.input')
          ELSE COALESCE(json_extract(payload_json, '$.input.command'), json_extract(payload_json, '$.input')) END, 1, 2000) AS command,
        substr(COALESCE(json_extract(payload_json, '$.output'), ''), -2000) AS output, json_extract(payload_json, '$.exitCode') AS exit_code
        FROM orchestration_v2_projection_turn_items WHERE run_id = ${run.run_id} AND type IN ('dynamic_tool', 'command_execution')
          AND (status = 'failed' OR COALESCE(json_extract(payload_json, '$.exitCode'), 0) <> 0 OR json_extract(payload_json, '$.outputIndicatesFailure') = 1)
        ORDER BY ordinal LIMIT 100`;
      for (const failure of failures) {
        const signature = frictionSignature({
          toolName: failure.type === "dynamic_tool" ? failure.tool_name : null,
          command: failure.command ?? "",
          output: failure.output,
          exitCode: failure.exit_code,
        });
        const cluster = friction.get(signature.key) ?? {
          ...signature,
          failures: 0,
          perTask: new Map<ThreadId, number>(),
          evidenceIds: [] as string[],
        };
        friction.set(signature.key, cluster);
        cluster.failures++;
        cluster.perTask.set(task.rootThreadId, (cluster.perTask.get(task.rootThreadId) ?? 0) + 1);
        task.frictionKeys.add(signature.key);
        if (signature.harmless) task.harmlessFailures++;
        if (cluster.evidenceIds.length < 3) {
          cluster.evidenceIds.push(`item:${failure.id}`);
          evidence.push({
            ...identity,
            occurredAt: failure.occurred_at,
            id: `item:${failure.id}`,
            itemId: failure.id,
            kind: "tool",
            text: `Failed ${failure.type} (friction group "${signature.key}"): ${failure.command ?? ""}\n--- output (end) ---\n${failure.output}`,
          });
        }
      }
      const children = yield* sql<{
        id: string;
        text: string;
        occurred_at: string;
        total: number;
      }>`SELECT subagent_id AS id,
        updated_at AS occurred_at, COUNT(*) OVER () AS total, substr(payload_json, 1, 6000) AS text FROM orchestration_v2_projection_subagents WHERE run_id = ${run.run_id} ORDER BY updated_at DESC LIMIT 12`;
      metrics.subagents += children[0]?.total ?? 0;
      for (const child of children)
        evidence.push({
          ...identity,
          occurredAt: child.occurred_at,
          id: `agent:${child.id}`,
          itemId: null,
          kind: "workflow",
          text: child.text,
        });
      const attributions = yield* sql<{
        id: number;
        payload_json: string;
        created_at: string;
      }>`SELECT id, payload_json, created_at FROM insights_attributions WHERE run_id = ${run.run_id} ORDER BY id DESC LIMIT 12`;
      for (const attribution of attributions)
        evidence.push({
          ...identity,
          occurredAt: attribution.created_at,
          id: `attribution:${attribution.id}`,
          itemId: null,
          kind: "attribution",
          text: `Agent-reported attribution: ${attribution.payload_json}`,
        });
    }
    // Evidence shares the budget evenly, so a smaller sample keeps more of each excerpt.
    const excerptLimit = Math.max(
      160,
      Math.min(2200, Math.floor(input.characterBudget / Math.max(1, evidence.length))),
    );
    const projects = yield* projectsIn(input.projectIds);
    const taskList = yield* Effect.forEach(
      tasks.values(),
      Effect.fnUntraced(function* ({ briefId: _briefId, ...task }) {
        const threadIds = [...task.threadIds];
        const states = yield* sql<{
          state: string | null;
        }>`SELECT json_extract(pr.value, '$.snapshot.state') AS state
          FROM orchestration_v2_projection_threads t, json_each(t.payload_json, '$.pullRequests') pr
          WHERE ${sql.in("t.thread_id", [...threadIds, task.rootThreadId])}`;
        const pullRequest = (["merged", "open", "closed"] as const).find((state) =>
          states.some((row) => row.state === state),
        );
        return {
          ...task,
          threadIds: threadIds.slice(0, 50),
          frictionKeys: [...task.frictionKeys].slice(0, 20),
          pullRequest: pullRequest ?? null,
        };
      }),
    );
    const clusters = yield* Effect.forEach(
      friction.values(),
      ({ perTask, evidenceIds, ...cluster }) =>
        Effect.forEach(evidenceIds, boundedId).pipe(
          Effect.map((ids) => ({
            ...cluster,
            tasks: perTask.size,
            maxPerTask: Math.max(...perTask.values()),
            evidenceIds: ids,
          })),
        ),
    );
    return {
      projects,
      metrics,
      skills: sumInsightSkills([skillUsage]),
      tasks: taskList.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
      friction: mergeFrictionClusters([clusters]),
      evidence: yield* Effect.forEach(evidence, (entry) =>
        boundedId(entry.id).pipe(
          Effect.map((id) => ({ ...entry, id, text: evidenceExcerpt(entry.text, excerptLimit) })),
        ),
      ),
      throughSequence,
      hasMore,
      createdAt,
    };
  });

  const evidenceFor = Effect.fn("InsightsService.evidence")(function* (
    input: InsightsEvidenceInput,
  ) {
    const { createdAt: _createdAt, ...result } = yield* gather({ ...input, excludeThreadId: null });
    return result;
  }, Effect.mapError(storageError));

  type LinkedProjects = NonNullable<InsightsSettings["linkedProjects"]>[number];

  /** One linked environment's share, or why it could not be reached; its cursor then stays put. */
  const gatherLinked = Effect.fn("InsightsService.gatherLinked")(function* (
    entry: LinkedProjects,
    share: Pick<InsightsEvidenceInput, "lookbackDays" | "maxRuns" | "characterBudget">,
  ) {
    const link = yield* links.get(entry.environmentId).pipe(Effect.orElseSucceed(Option.none));
    const label = Option.isSome(link) ? link.value.label : entry.environmentId;
    const scopeKey = `${share.lookbackDays}:${[...entry.projectIds].sort().join("\n")}`;
    const cursorRows = yield* sql<{
      sequence: number;
    }>`SELECT COALESCE(MAX(json_extract(c.value, '$.throughSequence')), 0) AS sequence
      FROM insights_reports r, json_each(r.payload_json, '$.linked') c
      WHERE r.status IN ('completed', 'empty') AND json_extract(c.value, '$.environmentId') = ${entry.environmentId}
        AND json_extract(c.value, '$.scopeKey') = ${scopeKey}`;
    const fromSequence = cursorRows[0]?.sequence ?? 0;
    return yield* peers
      .call({
        environmentId: entry.environmentId,
        tool: "t3_insights_evidence",
        arguments: { ...share, projectIds: entry.projectIds, fromSequence },
        // Evidence is a read; the narrowest modes keep the link from doing anything else.
        limits: { runtimeMode: "approval-required", interactionMode: "plan" },
        success: InsightsEvidenceResult,
      })
      .pipe(
        Effect.timeout(LINKED_TIMEOUT),
        Effect.map((result) => ({
          _tag: "Reached" as const,
          environmentId: entry.environmentId,
          label,
          scopeKey,
          fromSequence,
          missing: entry.projectIds.filter(
            (id) => !result.projects.some((project) => project.projectId === id),
          ).length,
          result,
        })),
        Effect.catch((error) =>
          Effect.succeed({ _tag: "Unreached" as const, label, message: error.message }),
        ),
      );
  });

  const collect = Effect.fn("InsightsService.collect")(
    function* (threadId: ThreadId) {
      const config = yield* settings();
      if (config === null) return yield* new InsightsError({ reason: "not_configured" });
      yield* recoverReports();
      const state = yield* snapshot();
      const localProjects = yield* projectsIn(config.projectIds);
      const withLinked = (value: InsightsReport) => [
        ...localProjects,
        ...(value.linked ?? []).flatMap((entry) =>
          entry.projects.map((project) => ({
            ...project,
            environmentId: entry.environmentId,
            environmentLabel: entry.label,
          })),
        ),
      ];
      const own = state.reports.find((r) => r.threadId === threadId && r.status === "analyzing");
      if (own) {
        const resumed = yield* report(own.id);
        return {
          report: resumed,
          previousReports: state.reports,
          recommendations: state.recommendations,
          projects: withLinked(resumed),
        };
      }
      if (state.reports.some((r) => r.status === "analyzing"))
        return yield* new InsightsError({ reason: "analysis_running" });
      const scopeKey = `${config.lookbackDays}:${[...config.projectIds].sort().join("\n")}`;
      const cursorRows = yield* sql<{
        sequence: number;
      }>`SELECT COALESCE(MAX(through_sequence), 0) AS sequence FROM insights_reports WHERE status IN ('completed', 'empty') AND json_extract(payload_json, '$.scopeKey') = ${scopeKey}`;
      const fromSequence = cursorRows[0]?.sequence ?? 0;
      const linkedProjects = config.linkedProjects ?? [];
      const linksOn = linkedProjects.length > 0 && (yield* links.enabled);
      const shares = 1 + (linksOn ? linkedProjects.length : 0);
      const share = {
        lookbackDays: config.lookbackDays,
        maxRuns: Math.ceil(config.maxRuns / shares),
        characterBudget: Math.floor(CHARACTER_BUDGET / shares),
      };
      const local = yield* gather({
        ...share,
        projectIds: config.projectIds,
        fromSequence,
        excludeThreadId: threadId,
      });
      const remote = linksOn
        ? yield* Effect.forEach(linkedProjects, (entry) => gatherLinked(entry, share), {
            concurrency: "unbounded",
          })
        : [];
      const reached = remote.filter((entry) => entry._tag === "Reached");
      const linkedEvidence = yield* Effect.forEach(reached, (entry) =>
        Effect.forEach(entry.result.evidence, (item) =>
          boundedId(`${entry.environmentId}/${item.id}`).pipe(
            Effect.map((id) => ({ ...item, id, environmentId: entry.environmentId })),
          ),
        ),
      ).pipe(Effect.map((groups) => groups.flat()));
      const metrics = reached.reduce(
        (total, entry) => addInsightsMetrics(total, entry.result.metrics),
        local.metrics,
      );
      const skills = sumInsightSkills([
        local.skills,
        ...reached.map((entry) => entry.result.skills),
      ]);
      const linkedFriction = yield* Effect.forEach(reached, (entry) =>
        Effect.forEach(entry.result.friction ?? [], (cluster) =>
          Effect.forEach(cluster.evidenceIds, (id) =>
            boundedId(`${entry.environmentId}/${id}`),
          ).pipe(Effect.map((evidenceIds) => ({ ...cluster, evidenceIds }))),
        ),
      );
      const friction = mergeFrictionClusters([local.friction, ...linkedFriction]);
      const tasks = [
        ...local.tasks,
        ...reached.flatMap((entry) =>
          (entry.result.tasks ?? []).map((task) => ({
            ...task,
            environmentId: entry.environmentId,
          })),
        ),
      ].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      const hasMore = local.hasMore || reached.some((entry) => entry.result.hasMore);
      const createdAt = local.createdAt;
      const actualRows = yield* sql<{
        selection: string;
      }>`SELECT json_extract(payload_json, '$.modelSelection') AS selection FROM orchestration_v2_projection_runs WHERE thread_id = ${threadId} ORDER BY ordinal DESC LIMIT 1`;
      const value: InsightsReport = {
        id: `insights:${yield* random.uuidV4()}`,
        threadId,
        status: metrics.runs ? "analyzing" : "empty",
        createdAt,
        completedAt: metrics.runs ? null : createdAt,
        summary: metrics.runs
          ? "Analysis in progress"
          : "No new activity in the selected projects.",
        wins: [],
        limitations: [
          "Evidence is sampled: per task its brief, and per run up to 4 user-side messages with the agent message each replied to, the final reply, 3 interrupts or agent questions and 12 delegations. Failing tools are grouped by program, exit code and error, with up to 3 examples per group. Inspect source threads before drawing conclusions.",
          "Timings include waiting; tokens are shown only where recorded for the main agent of each run. Native child sessions may be missing; workflow totals are not added again. Agent-reported attribution is not independent verification.",
          "Skill counts are a lower bound from recorded native skill calls and supported explicit SKILL.md reads. Skills already in context or read through unsupported tools may be missing. Older linked environments may only report native skill calls.",
          ...(hasMore
            ? ["More activity remains for the next analysis; the checkpoint has not skipped it."]
            : []),
          ...(linkedProjects.length > 0 && !linksOn
            ? ["Linked projects were skipped because Linked environments is off on this machine."]
            : []),
          ...remote.flatMap((entry) =>
            entry._tag === "Unreached"
              ? [
                  `${entry.label} could not be reached (${entry.message}). Its activity will be retried next analysis.`,
                ]
              : entry.missing > 0
                ? [`${entry.missing} selected project(s) no longer exist on ${entry.label}.`]
                : [],
          ),
        ],
        metrics,
        skills,
        tasks,
        friction,
        evidence: [...local.evidence, ...linkedEvidence],
        recommendationIds: [],
        scopeKey,
        fromSequence,
        throughSequence: local.throughSequence,
        hasMore,
        ...(reached.length
          ? {
              linked: reached.map((entry) => ({
                environmentId: entry.environmentId,
                label: entry.label,
                scopeKey: entry.scopeKey,
                fromSequence: entry.fromSequence,
                throughSequence: entry.result.throughSequence,
                hasMore: entry.result.hasMore,
                projects: entry.result.projects,
              })),
            }
          : {}),
        modelSelection: actualRows[0]
          ? yield* decodeSelection(actualRows[0].selection)
          : config.modelSelection,
      };
      yield* saveReport(value);
      yield* notify;
      return {
        report: value,
        previousReports: state.reports.slice(0, 14),
        recommendations: state.recommendations,
        projects: withLinked(value),
      };
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const checkEdit = Effect.fn("InsightsService.checkEdit")(function* (
    recommendationKey: string,
    edit: InsightEdit,
  ) {
    const invalid = (problem: InsightChangeProblem) =>
      new InsightsError({ reason: "invalid_change", problem, recommendationKey, file: edit.file });
    if (!path.isAbsolute(edit.file)) return yield* invalid("path_not_absolute");
    const content = yield* fileSystem.readFileString(edit.file).pipe(Effect.option);
    if (edit.find === "") {
      if (Option.isSome(content)) return yield* invalid("file_exists");
      return;
    }
    if (Option.isNone(content)) return yield* invalid("file_missing");
    const matches = content.value.split(edit.find).length - 1;
    if (matches !== 1) return yield* invalid(matches === 0 ? "text_not_found" : "text_not_unique");
  });

  const submit = Effect.fn("InsightsService.submit")(
    function* (threadId: ThreadId, input: InsightsSubmitInput) {
      const current = yield* report(input.reportId);
      if (current.threadId !== threadId) return yield* new InsightsError({ reason: "wrong_owner" });
      if (current.status === "completed") return current;
      if (current.status !== "analyzing") return yield* new InsightsError({ reason: "not_found" });
      const evidenceById = new Map(current.evidence.map((e) => [e.id, e]));
      const decisions = input.brief?.decisions ?? [];
      const recurrences = input.recurrences ?? [];
      const references = [
        ...input.wins,
        ...input.recommendations,
        ...input.assessments,
        ...decisions,
        ...recurrences,
      ];
      const keys = input.recommendations.map((r) => insightKey(r.key));
      if (
        references.some((r) => r.evidenceIds.some((id) => !evidenceById.has(id))) ||
        decisions.some((d) => (d.kind === "toolkit") !== (d.recommendationKey !== undefined)) ||
        keys.some((key) => !key) ||
        new Set(keys).size !== keys.length ||
        new Set(input.assessments.map((a) => a.recommendationId)).size !== input.assessments.length
      )
        return yield* new InsightsError({ reason: "invalid_evidence" });
      // One recommendation is one change: its exact edits, or a described one, never both or neither.
      const misshapen = input.recommendations.find(
        (r) => r.edits.length > 0 === (r.suggestedChange !== undefined),
      );
      if (misshapen)
        return yield* new InsightsError({
          reason: "invalid_change",
          problem: misshapen.edits.length ? "mixed_change" : "missing_change",
          recommendationKey: misshapen.key,
        });
      const at = yield* now;
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const ids: string[] = [];
          // A recommendation counts once per report, however often the submission names it.
          const counted = new Set<string>();
          // Both helpers run inside this submission's span and transaction.
          const tracked = Effect.fnUntraced(function* (key: string) {
            const rows = yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM insights_recommendations WHERE insight_key = ${key}`;
            return rows[0] ? yield* decodeRecommendation(rows[0].payload_json) : null;
          });
          const runOf = (entry: InsightEvidence) =>
            `${entry.environmentId ?? ""}\n${entry.runId ?? entry.id}`;
          const recordIncident = Effect.fnUntraced(function* (
            existing: InsightRecommendation,
            text: string,
            evidenceIds: ReadonlyArray<string>,
          ) {
            const cited = evidenceIds.map((id) => evidenceById.get(id)!);
            const seen = new Set(
              [
                ...existing.evidence,
                ...(existing.incidents ?? []).flatMap((incident) => incident.evidence),
              ].map(runOf),
            );
            // A later packet can sample a run again; only a run not cited before is another incident.
            if (!counted.has(existing.id) && cited.some((entry) => !seen.has(runOf(entry)))) {
              counted.add(existing.id);
              yield* saveRecommendation({
                ...existing,
                updatedAt: at,
                lastSeenAt: at,
                occurrences: existing.occurrences + 1,
                incidents: [
                  ...(existing.incidents ?? []),
                  { reportId: current.id, at, text, evidence: cited },
                ].slice(-30),
              });
            }
            return existing.id;
          });
          for (const proposal of input.recommendations) {
            const key = insightKey(proposal.key);
            const existing = yield* tracked(key);
            // Text with an exact change stays as first written, so resubmitting it is an incident.
            // One from before exact changes is rewritten once, to gain that change.
            if (existing?.edits !== undefined) {
              ids.push(yield* recordIncident(existing, proposal.observation, proposal.evidenceIds));
              continue;
            }
            yield* Effect.forEach(proposal.edits, (edit) => checkEdit(proposal.key, edit), {
              discard: true,
            });
            const value: InsightRecommendation = {
              key,
              title: proposal.title,
              category: proposal.category,
              priority: proposal.priority,
              confidence: proposal.confidence,
              observation: proposal.observation,
              recommendation: proposal.recommendation,
              targetFile: proposal.edits[0]?.file ?? proposal.targetFile ?? null,
              edits: proposal.edits,
              ...(proposal.suggestedChange === undefined
                ? {}
                : { suggestedChange: proposal.suggestedChange }),
              validation: proposal.validation,
              evidenceIds: proposal.evidenceIds,
              id: existing?.id ?? `insight:${yield* random.uuidV4()}`,
              status: existing?.status ?? "open",
              createdAt: existing?.createdAt ?? at,
              updatedAt: at,
              lastSeenAt: at,
              occurrences: (existing?.occurrences ?? 0) + 1,
              note: existing?.note ?? "",
              deferredUntil: existing?.deferredUntil ?? null,
              implementationThreadId: existing?.implementationThreadId ?? null,
              implementationRef: existing?.implementationRef ?? null,
              ...(existing?.trial ? { trial: existing.trial } : {}),
              evidence: proposal.evidenceIds.map((id) => evidenceById.get(id)!),
              assessments: existing?.assessments ?? [],
              history: existing
                ? [
                    ...existing.history,
                    {
                      at,
                      status: existing.status,
                      note: proposal.edits.length
                        ? "Rewritten with an exact change"
                        : "Rewritten by daily analysis",
                    },
                  ]
                : [{ at, status: "open", note: "Recommended by daily analysis" }],
            };
            yield* saveRecommendation(value);
            counted.add(value.id);
            ids.push(value.id);
          }
          const recommendationIds = new Map(keys.map((key, index) => [key, ids[index]!]));
          const brief = input.brief && {
            headline: input.brief.headline,
            decisions: yield* Effect.forEach(
              input.brief.decisions,
              Effect.fnUntraced(function* ({ recommendationKey, ...decision }) {
                if (recommendationKey === undefined) return decision;
                const key = insightKey(recommendationKey);
                const recommendationId =
                  recommendationIds.get(key) ??
                  (yield* sql<{
                    id: string;
                  }>`SELECT id FROM insights_recommendations WHERE insight_key = ${key}`)[0]?.id;
                if (!recommendationId)
                  return yield* new InsightsError({ reason: "invalid_evidence" });
                return { ...decision, recommendationId };
              }),
            ),
          };
          for (const recurrence of recurrences) {
            const existing = yield* tracked(insightKey(recurrence.recommendationKey));
            if (!existing)
              return yield* new InsightsError({
                reason: "invalid_change",
                problem: "unknown_recommendation",
                recommendationKey: recurrence.recommendationKey,
              });
            const id = yield* recordIncident(existing, recurrence.text, recurrence.evidenceIds);
            if (!ids.includes(id)) ids.push(id);
          }
          for (const assessment of input.assessments) {
            const existing = yield* recommendation(assessment.recommendationId);
            if (
              existing.status !== "implemented" ||
              (assessment.outcome !== "insufficient_evidence" &&
                assessment.evidenceIds.length === 0)
            )
              return yield* new InsightsError({ reason: "invalid_evidence" });
            const implementationAt = existing.history.findLast(
              (h, index, history) =>
                h.status === "implemented" && history[index - 1]?.status !== "implemented",
            )?.at;
            if (!implementationAt || current.createdAt <= implementationAt)
              return yield* new InsightsError({ reason: "invalid_evidence" });
            // insufficient_evidence may cite earlier work as context; it measures nothing.
            if (assessment.outcome !== "insufficient_evidence") {
              // One observation counts once per trial, however many reports see the run again.
              const assessed = new Set(
                existing.assessments
                  .filter(
                    (previous) =>
                      previous.outcome !== "insufficient_evidence" &&
                      previous.createdAt > implementationAt,
                  )
                  .flatMap((previous) => previous.evidence.map((evidence) => evidence.id)),
              );
              const cited = assessment.evidenceIds.map((id) => evidenceById.get(id)!);
              const localRunIds = cited.flatMap((evidence) =>
                evidence.runId && !evidence.environmentId ? [evidence.runId] : [],
              );
              // A run that began before the trial ran without the change, whenever it ended.
              const runStarts = new Map(
                localRunIds.length
                  ? (yield* sql<{
                      run_id: string;
                      started_at: string;
                    }>`SELECT run_id, COALESCE(json_extract(payload_json, '$.startedAt'), requested_at) AS started_at
                      FROM orchestration_v2_projection_runs WHERE ${sql.in("run_id", localRunIds)}`).map(
                      (row) => [row.run_id, row.started_at] as const,
                    )
                  : [],
              );
              if (
                cited.some(
                  (evidence) =>
                    assessed.has(evidence.id) ||
                    ((!evidence.environmentId && evidence.runId
                      ? runStarts.get(evidence.runId)
                      : undefined) ?? evidence.occurredAt) <= implementationAt,
                )
              )
                return yield* new InsightsError({ reason: "invalid_evidence" });
            }
            yield* saveRecommendation({
              ...existing,
              updatedAt: at,
              assessments: [
                ...existing.assessments,
                {
                  reportId: current.id,
                  createdAt: at,
                  outcome: assessment.outcome,
                  explanation: assessment.explanation,
                  evidence: assessment.evidenceIds.map((id) => evidenceById.get(id)!),
                },
              ].slice(-30),
            });
          }
          const completed: InsightsReport = {
            ...current,
            status: "completed",
            completedAt: at,
            summary: input.summary,
            ...(brief ? { brief } : {}),
            wins: input.wins,
            limitations: [...current.limitations, ...input.limitations],
            recommendationIds: ids,
          };
          yield* saveReport(completed);
          return completed;
        }),
      );
      yield* notify;
      return result;
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const update = Effect.fn("InsightsService.update")(
    function* (input: InsightUpdateInput) {
      const previous = yield* recommendation(input.id);
      const at = yield* now;
      if (
        previous.status === input.status &&
        previous.note === input.note &&
        (input.implementationRef === undefined ||
          input.implementationRef === previous.implementationRef) &&
        (input.deferredUntil === undefined || input.deferredUntil === previous.deferredUntil)
      )
        return previous;
      const implementationRef =
        input.implementationRef === undefined
          ? previous.implementationRef
          : input.implementationRef;
      const value: InsightRecommendation = {
        ...previous,
        status: input.status,
        note: input.note,
        updatedAt: at,
        deferredUntil: input.status === "deferred" ? (input.deferredUntil ?? null) : null,
        implementationRef,
        ...(input.status === "implemented" && previous.status !== "implemented"
          ? { trial: { startedAt: at, validation: previous.validation, implementationRef } }
          : {}),
        history: [...previous.history, { at, status: input.status, note: input.note }],
      };
      yield* saveRecommendation(value);
      yield* notify;
      return value;
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  /** The remote default branch a pull request starts from; null without a remote that has one. */
  const pullRequestBase = Effect.fn("InsightsService.pullRequestBase")(
    function* (cwd: string) {
      const remote = yield* git.resolvePrimaryRemoteName(cwd);
      const branch = yield* git.resolveDefaultBranchName(cwd, remote);
      if (branch === null) return null;
      // Fetch does not update a recorded HEAD, so it can name a branch the remote no longer has.
      yield* git.resolveCommit({ cwd, revision: `refs/remotes/${remote}/${branch}` });
      return `${remote}/${branch}`;
    },
    Effect.orElseSucceed(() => null),
  );

  const implement = Effect.fn("InsightsService.implement")(
    function* (id: string) {
      const config = yield* settings();
      if (!config) return yield* new InsightsError({ reason: "not_configured" });
      const rec = yield* recommendation(id);
      if (rec.implementationThreadId) return { threadId: rec.implementationThreadId };
      const threadId = ThreadId.make(`insight-implementation:${id}`);
      // A relative path would resolve against the server's own directory, so it is in no project.
      const within = (root: string, file: string) => {
        const relative = path.relative(root, file);
        return (
          path.isAbsolute(file) &&
          relative !== "" &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative)
        );
      };
      const target = rec.edits?.[0]?.file ?? rec.targetFile;
      const projects = yield* projectsIn([]);
      const owner = target
        ? projects
            .filter((entry) => within(entry.workspaceRoot, target))
            .sort((a, b) => b.workspaceRoot.length - a.workspaceRoot.length)[0]
        : undefined;
      // Linked evidence names a project in its own environment; the change is made in one here.
      const fallbackId =
        rec.evidence.find((entry) => entry.environmentId === undefined)?.projectId ??
        config.projectId;
      const project = owner ?? projects.find((entry) => entry.projectId === fallbackId);
      // A file outside every project is changed where it is: no other checkout's worktree holds it.
      const elsewhere = target !== null && path.isAbsolute(target) && owner === undefined;
      const base = project && !elsewhere ? yield* pullRequestBase(project.workspaceRoot) : null;
      const worktreeOf = project && base !== null ? project.workspaceRoot : null;
      const { options: _maxEffort, ...analysisModel } = config.modelSelection;
      yield* launcher
        .launch({
          commandId: CommandId.make(`insight-implementation:${id}`),
          threadId,
          projectId: project?.projectId ?? fallbackId,
          title: rec.title,
          // Applying a reviewed edit needs neither the analysis model's max effort nor its price.
          modelSelection: config.implementationModelSelection ?? analysisModel,
          runtimeMode: "full-access",
          interactionMode: "default",
          // A worktree off the remote default branch keeps the pull request to this one change.
          workspaceStrategy:
            base === null
              ? { type: "root" }
              : { type: "worktree", baseRef: base, startFromOrigin: true },
          initialMessage: {
            text: insightImplementationPrompt({
              ...rec,
              worktreeOf,
              edits: rec.edits?.map((edit) => ({
                ...edit,
                file:
                  worktreeOf !== null && within(worktreeOf, edit.file)
                    ? path.relative(worktreeOf, edit.file)
                    : edit.file,
              })),
            }),
            attachments: [],
          },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError((cause) => new InsightsError({ reason: "launch", cause })));
      const at = yield* now;
      yield* saveRecommendation({
        ...rec,
        status: "accepted",
        implementationThreadId: threadId,
        updatedAt: at,
        history: [
          ...rec.history,
          { at, status: "accepted", note: "Started implementation thread" },
        ],
      });
      yield* notify;
      return { threadId };
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const record = Effect.fn("InsightsService.record")(function* (
    threadId: ThreadId,
    input: InsightAttributionInput,
  ) {
    const rows = yield* sql<{
      run_id: string;
    }>`SELECT run_id FROM orchestration_v2_projection_runs WHERE thread_id = ${threadId} AND status IN ('starting', 'running', 'waiting') ORDER BY ordinal DESC LIMIT 1`;
    if (!rows[0]) return yield* new InsightsError({ reason: "not_found" });
    yield* sql`INSERT INTO insights_attributions (thread_id, run_id, created_at, payload_json) VALUES (${threadId}, ${rows[0].run_id}, ${yield* now}, ${yield* encodeAttribution(input)})`;
  }, Effect.mapError(storageError));

  // The schedule stores its prompt, so one saved before a prompt change would keep the old text.
  yield* Effect.gen(function* () {
    const config = yield* settings();
    const { tasks } = yield* scheduler.list();
    const task = tasks.find((entry) => entry.id === TASK_ID);
    if (config && task && task.prompt !== INSIGHTS_ANALYSIS_PROMPT) yield* saveSchedule(config);
  }).pipe(Effect.ignore({ log: true }));

  return InsightsService.of({
    snapshot,
    configure,
    runNow,
    report,
    recommendation,
    update,
    implement,
    collect,
    evidence: evidenceFor,
    submit,
    record,
    subscribe: () =>
      Stream.mergeAll({ concurrency: "unbounded" })([
        Stream.fromPubSub(updates),
        scheduler.subscribeList().pipe(
          Stream.map(() => undefined),
          Stream.mapError(storageError),
        ),
        orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "run.updated" &&
              ["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(
                event.payload.status,
              ),
          ),
          Stream.filterEffect((event) =>
            sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM insights_reports WHERE thread_id = ${event.threadId} AND status = 'analyzing')
              OR EXISTS (SELECT 1 FROM orchestration_v2_projection_messages WHERE thread_id = ${event.threadId} AND json_extract(payload_json, '$.scheduledTaskId') = ${TASK_ID})`.pipe(
              Effect.map((rows) => rows.length > 0),
            ),
          ),
          Stream.map(() => undefined),
          Stream.mapError(storageError),
        ),
      ]).pipe(Stream.mapEffect(snapshot), Stream.mapError(storageError)),
  });
});

export const layer = Layer.effect(InsightsService, make);
