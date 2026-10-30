import {
  CommandId,
  InsightAttributionInput,
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
  type InsightEvidence,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { emptyInsightsMetrics, evidenceExcerpt, insightKey } from "./insightsEvidence.ts";
import { INSIGHTS_ANALYSIS_PROMPT } from "./insightsPrompt.ts";

const TASK_ID = ScheduledTaskId.make("insights:daily");
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
        projects: ReadonlyArray<{ projectId: ProjectId; title: string; workspaceRoot: string }>;
      },
      InsightsError
    >;
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
  const crypto = yield* Crypto.Crypto;
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
    }>`SELECT json_set(payload_json, '$.evidence', json('[]')) AS payload_json FROM insights_reports ORDER BY created_at DESC LIMIT 30`;
    const recs = yield* sql<{
      payload_json: string;
    }>`SELECT json_set(payload_json, '$.evidence', json('[]'), '$.history', json('[]'), '$.assessments', json(COALESCE((SELECT json_group_array(json_set(value, '$.evidence', json('[]'))) FROM json_each(json_extract(payload_json, '$.assessments'))), '[]'))) AS payload_json FROM insights_recommendations ORDER BY updated_at DESC LIMIT 251`;
    return {
      settings: config,
      latestAnalysis: latest[0] ?? null,
      schedule: tasks.find((task) => task.id === TASK_ID) ?? null,
      reports: (yield* Effect.forEach(reports, (row) => decodeReport(row.payload_json))).map(
        (entry) => ({ ...entry, evidence: [] }),
      ),
      recommendations: (yield* Effect.forEach(recs.slice(0, 250), (row) =>
        decodeRecommendation(row.payload_json),
      )).map((entry) => ({
        ...entry,
        evidence: [],
        history: [],
        assessments: entry.assessments.map((assessment) => ({ ...assessment, evidence: [] })),
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
    const provider = (yield* providers.getProviders).find(
      (p) => p.instanceId === input.modelSelection.instanceId,
    );
    if (
      !ids.has(input.projectId) ||
      input.projectIds.some((id) => !ids.has(id)) ||
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

  const configure = Effect.fn("InsightsService.configure")(
    function* (input: InsightsSettings) {
      if (input.enabled) yield* validateConfiguration(input);
      const config: InsightsSettings = {
        ...input,
        projectIds: [...new Set(input.projectIds)],
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
      yield* scheduler
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

  const collect = Effect.fn("InsightsService.collect")(
    function* (threadId: ThreadId) {
      const config = yield* settings();
      if (config === null) return yield* new InsightsError({ reason: "not_configured" });
      yield* recoverReports();
      const state = yield* snapshot();
      const projects = yield* sql<{
        projectId: ProjectId;
        title: string;
        workspaceRoot: string;
      }>`SELECT project_id AS projectId, title, workspace_root AS workspaceRoot
      FROM projection_projects WHERE deleted_at IS NULL AND ${config.projectIds.length ? sql.in("project_id", config.projectIds) : sql`1 = 1`}`;
      const own = state.reports.find((r) => r.threadId === threadId && r.status === "analyzing");
      if (own)
        return {
          report: yield* report(own.id),
          previousReports: state.reports,
          recommendations: state.recommendations,
          projects,
        };
      if (state.reports.some((r) => r.status === "analyzing"))
        return yield* new InsightsError({ reason: "analysis_running" });
      const scopeKey = `${config.lookbackDays}:${[...config.projectIds].sort().join("\n")}`;
      const cursorRows = yield* sql<{
        sequence: number;
      }>`SELECT COALESCE(MAX(through_sequence), 0) AS sequence FROM insights_reports WHERE status IN ('completed', 'empty') AND json_extract(payload_json, '$.scopeKey') = ${scopeKey}`;
      const fromSequence = cursorRows[0]?.sequence ?? 0;
      const highRows = yield* sql<{
        sequence: number;
      }>`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events WHERE application_event_version = 2`;
      const upper = highRows[0]?.sequence ?? 0;
      const createdAt = yield* now;
      const since = DateTime.formatIso(
        DateTime.subtract(DateTime.makeUnsafe(createdAt), { days: config.lookbackDays }),
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
      }>`SELECT r.run_id, r.thread_id, t.project_id, t.title, r.status,
      json_extract(r.payload_json, '$.modelSelection') AS selection,
      json_extract(r.payload_json, '$.startedAt') AS started_at, r.completed_at, changed.sequence
      FROM (SELECT json_extract(metadata_json, '$.runId') AS run_id, MAX(sequence) AS sequence FROM orchestration_events
        WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND sequence > ${fromSequence} AND sequence <= ${upper} AND occurred_at >= ${since} AND json_extract(metadata_json, '$.runId') IS NOT NULL
        GROUP BY json_extract(metadata_json, '$.runId')) changed
      JOIN orchestration_v2_projection_runs r ON r.run_id = changed.run_id
      JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
      WHERE t.deleted_at IS NULL AND r.thread_id <> ${threadId}
        AND ${config.projectIds.length ? sql.in("t.project_id", config.projectIds) : sql`1 = 1`}
        AND NOT EXISTS (SELECT 1 FROM insights_reports previous WHERE previous.thread_id = r.thread_id)
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_messages m WHERE m.thread_id = r.thread_id AND json_extract(m.payload_json, '$.scheduledTaskId') = ${TASK_ID})
      ORDER BY changed.sequence ASC LIMIT ${config.maxRuns + 1}`;
      const runs = rows.slice(0, config.maxRuns);
      const hasMore = rows.length > config.maxRuns;
      const throughSequence = hasMore ? runs.at(-1)!.sequence : upper;
      const metrics = { ...emptyInsightsMetrics() };
      const evidence: InsightEvidence[] = [];
      const excerptLimit = Math.max(
        160,
        Math.min(2200, Math.floor(150000 / Math.max(1, runs.length) / 32)),
      );
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
        const counts = yield* sql<{ failures: number; requests: number }>`SELECT
        SUM(CASE WHEN type IN ('dynamic_tool', 'command_execution') AND (status = 'failed' OR COALESCE(json_extract(payload_json, '$.exitCode'), 0) <> 0 OR json_extract(payload_json, '$.outputIndicatesFailure') = 1) THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN type IN ('user_input_request', 'approval_request') THEN 1 ELSE 0 END) AS requests
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
        evidence.push({
          ...identity,
          id: `run:${run.run_id}`,
          itemId: null,
          kind: "run",
          text: `Status: ${run.status}; model selection: ${run.selection}; started: ${run.started_at}; ended: ${run.completed_at}; tool failures: ${counts[0]?.failures ?? 0}; user/approval requests: ${counts[0]?.requests ?? 0}; recorded tokens: ${usage[0]?.tokens ?? "unknown"}. Completion is not verified task success.`,
        });
        const items = yield* sql<{
          id: string;
          type: string;
          status: string;
          text: string;
          occurred_at: string;
        }>`SELECT turn_item_id AS id, type, status, updated_at AS occurred_at,
        substr(COALESCE(json_extract(payload_json, '$.text'), json_extract(payload_json, '$.output'), json_extract(payload_json, '$.input'), json_extract(payload_json, '$.questions'), json_extract(payload_json, '$.prompt'), ''), 1, 5000) AS text
        FROM orchestration_v2_projection_turn_items WHERE run_id = ${run.run_id}
          AND type IN ('user_message', 'assistant_message', 'dynamic_tool', 'command_execution', 'user_input_request', 'approval_request')
        ORDER BY CASE WHEN status = 'failed' OR COALESCE(json_extract(payload_json, '$.exitCode'), 0) <> 0 OR json_extract(payload_json, '$.outputIndicatesFailure') = 1 THEN 0 WHEN type = 'user_message' THEN 1 WHEN type = 'assistant_message' THEN 2 ELSE 3 END, ordinal DESC LIMIT 8`;
        for (const item of items)
          evidence.push({
            ...identity,
            occurredAt: item.occurred_at,
            id: `item:${item.id}`,
            itemId: item.id,
            kind: item.type.endsWith("message") ? "message" : "tool",
            text: evidenceExcerpt(`${item.type} (${item.status}): ${item.text}`, excerptLimit),
          });
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
            text: evidenceExcerpt(child.text, excerptLimit),
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
            text: evidenceExcerpt(
              `Agent-reported attribution: ${attribution.payload_json}`,
              excerptLimit,
            ),
          });
      }
      const actualRows = yield* sql<{
        selection: string;
      }>`SELECT json_extract(payload_json, '$.modelSelection') AS selection FROM orchestration_v2_projection_runs WHERE thread_id = ${threadId} ORDER BY ordinal DESC LIMIT 1`;
      const value: InsightsReport = {
        id: `insights:${yield* crypto.randomUUIDv4()}`,
        threadId,
        status: runs.length ? "analyzing" : "empty",
        createdAt,
        completedAt: runs.length ? null : createdAt,
        summary: runs.length ? "Analysis in progress" : "No new activity in the selected projects.",
        wins: [],
        limitations: [
          "Evidence is sampled: up to 8 timeline items and 12 delegations per run. Inspect source threads before drawing conclusions.",
          "Timings include waiting; tokens are shown only where recorded for the main agent of each run. Native child sessions may be missing; workflow totals are not added again. Agent-reported attribution is not independent verification.",
          ...(hasMore
            ? ["More activity remains for the next analysis; the checkpoint has not skipped it."]
            : []),
        ],
        metrics,
        evidence,
        recommendationIds: [],
        scopeKey,
        fromSequence,
        throughSequence,
        hasMore,
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
        projects,
      };
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const submit = Effect.fn("InsightsService.submit")(
    function* (threadId: ThreadId, input: InsightsSubmitInput) {
      const current = yield* report(input.reportId);
      if (current.threadId !== threadId) return yield* new InsightsError({ reason: "wrong_owner" });
      if (current.status === "completed") return current;
      if (current.status !== "analyzing") return yield* new InsightsError({ reason: "not_found" });
      const evidenceById = new Map(current.evidence.map((e) => [e.id, e]));
      const references = [...input.wins, ...input.recommendations, ...input.assessments];
      const keys = input.recommendations.map((r) => insightKey(r.key));
      if (
        references.some((r) => r.evidenceIds.some((id) => !evidenceById.has(id))) ||
        keys.some((key) => !key) ||
        new Set(keys).size !== keys.length ||
        new Set(input.assessments.map((a) => a.recommendationId)).size !== input.assessments.length
      )
        return yield* new InsightsError({ reason: "invalid_evidence" });
      const at = yield* now;
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const ids: string[] = [];
          for (const proposal of input.recommendations) {
            const key = insightKey(proposal.key);
            const existingRows = yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM insights_recommendations WHERE insight_key = ${key}`;
            const existing = existingRows[0]
              ? yield* decodeRecommendation(existingRows[0].payload_json)
              : null;
            const value: InsightRecommendation = {
              ...proposal,
              key,
              id: existing?.id ?? `insight:${yield* crypto.randomUUIDv4()}`,
              status: existing?.status ?? "open",
              createdAt: existing?.createdAt ?? at,
              updatedAt: at,
              lastSeenAt: at,
              occurrences: (existing?.occurrences ?? 0) + 1,
              note: existing?.note ?? "",
              deferredUntil: existing?.deferredUntil ?? null,
              implementationThreadId: existing?.implementationThreadId ?? null,
              implementationRef: existing?.implementationRef ?? null,
              evidence: proposal.evidenceIds.map((id) => evidenceById.get(id)!),
              assessments: existing?.assessments ?? [],
              history: existing?.history ?? [
                { at, status: "open", note: "Recommended by daily analysis" },
              ],
            };
            yield* saveRecommendation(value);
            ids.push(value.id);
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
            if (
              !implementationAt ||
              current.createdAt <= implementationAt ||
              (assessment.outcome !== "insufficient_evidence" &&
                assessment.evidenceIds.some(
                  (id) => evidenceById.get(id)!.occurredAt <= implementationAt,
                ))
            )
              return yield* new InsightsError({ reason: "invalid_evidence" });
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
      const value: InsightRecommendation = {
        ...previous,
        status: input.status,
        note: input.note,
        updatedAt: at,
        deferredUntil: input.status === "deferred" ? (input.deferredUntil ?? null) : null,
        implementationRef:
          input.implementationRef === undefined
            ? previous.implementationRef
            : input.implementationRef,
        history: [...previous.history, { at, status: input.status, note: input.note }],
      };
      yield* saveRecommendation(value);
      yield* notify;
      return value;
    },
    lock.withPermits(1),
    Effect.mapError(storageError),
  );

  const implement = Effect.fn("InsightsService.implement")(
    function* (id: string) {
      const config = yield* settings();
      if (!config) return yield* new InsightsError({ reason: "not_configured" });
      const rec = yield* recommendation(id);
      if (rec.implementationThreadId) return { threadId: rec.implementationThreadId };
      const threadId = ThreadId.make(`insight-implementation:${id}`);
      yield* launcher
        .launch({
          commandId: CommandId.make(`insight-implementation:${id}`),
          threadId,
          projectId: rec.evidence[0]?.projectId ?? config.projectId,
          title: rec.title,
          modelSelection: config.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: {
            text: `Implement this workflow improvement. Verify its premise against current source first. Follow repository instructions and preserve unrelated work. Do not push or publish unless asked.\n\n${yield* encodeRecommendation(rec)}\nAfter verification, report changed files, tests and commit if any. Do not claim workflow improvement until later runs establish it.`,
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

  return InsightsService.of({
    snapshot,
    configure,
    runNow,
    report,
    recommendation,
    update,
    implement,
    collect,
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
