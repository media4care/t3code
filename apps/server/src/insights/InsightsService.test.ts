import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  type InsightsEvidenceResult,
  InsightsSettings,
  InsightsSubmitInput,
  OrchestratorMcpFailure,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ScheduledTask,
  ScheduledTaskId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadSkills from "../orchestration-v2/ThreadSkills.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Insights from "./InsightsService.ts";

const studio = EnvironmentId.make("studio");

/** A linked Mac Studio answering each evidence call with the next response, or unreachable. */
const linkedStudio = (responses: Array<InsightsEvidenceResult | "unreachable">) => {
  const calls: Array<Record<string, unknown>> = [];
  const launches: Array<ProjectId> = [];
  const layer = Layer.mergeAll(
    Layer.mock(PeerLinks.PeerLinks)({
      enabled: Effect.succeed(true),
      get: (environmentId) =>
        Effect.succeed(
          environmentId === studio
            ? Option.some({
                environmentId,
                label: "Mac Studio",
                urls: [],
                access: "read-only" as const,
                linkedAt: DateTime.makeUnsafe(0),
                expiresAt: DateTime.makeUnsafe(Date.parse("2027-01-01T00:00:00.000Z")),
                lastReachedAt: null,
                lastError: null,
              })
            : Option.none(),
        ),
    }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({
      call: (input) => {
        calls.push(input.arguments);
        const next = responses.shift();
        return next === undefined || next === "unreachable"
          ? Effect.fail(
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: "The linked environment stopped answering.",
              }),
            )
          : // oxlint-disable-next-line t3code/no-inline-schema-compile -- each call brings its own schema
            Schema.decodeEffect(Schema.fromJsonString(input.success))(JSON.stringify(next)).pipe(
              Effect.orDie,
            );
      },
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) => {
        launches.push(input.projectId);
        return Effect.die("not needed");
      },
    }),
  );
  return { calls, launches, layer };
};

const layerWith = (
  peers: Layer.Layer<
    PeerLinks.PeerLinks | PeerMcpClient.PeerMcpClient | ThreadLaunch.ThreadLaunchService
  >,
) =>
  Insights.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ScheduledTasks.ScheduledTaskService)({
          list: () => Effect.succeed({ tasks: [] }),
          subscribeList: () => Stream.make({ tasks: [] }),
          upsert: (input) => {
            assert.equal(input.schedule.type, "fixed_time");
            assert.deepEqual(input.modelSelection.options, [
              { id: "reasoningEffort", value: "max" },
            ]);
            return Effect.succeed({
              task: ScheduledTask.make({
                ...input,
                id: input.id ?? ScheduledTaskId.make("test"),
                threadId: null,
                schedule: { type: "fixed_time", timeOfDay: "09:00" },
                createdBy: "user",
                creationSource: "web",
                createdAt: timestamp,
                updatedAt: timestamp,
                nextRunAt: null,
                lastRunAt: null,
                lastRunStatus: "never",
                lastRunError: null,
                runCount: 0,
              }),
            });
          },
        }),
        peers,
        Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
        ThreadSkills.layer,
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([
            ServerProvider.make({
              instanceId: ProviderInstanceId.make("codex"),
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              installed: true,
              version: null,
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-10-30T10:00:00.000Z",
              models: [{ slug: "gpt-6-astra", name: "Astra", isCustom: false, capabilities: null }],
              skills: [],
              slashCommands: [],
            }),
          ]),
        }),
        NodeCrypto.layer,
      ),
    ),
    Layer.provideMerge(Layer.merge(Sqlite.layerMemory, NodeServices.layer)),
  );
const layer = layerWith(
  Layer.mergeAll(
    Layer.mock(PeerLinks.PeerLinks)({
      enabled: Effect.succeed(false),
      get: () => Effect.succeedNone,
    }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({}),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
  ),
);
const analyst = ThreadId.make("analyst");
const timestamp = "2026-10-30T10:00:00.000Z";
const encodeSettings = Schema.encodeSync(Schema.fromJsonString(InsightsSettings));
const config: InsightsSettings = {
  enabled: true,
  projectId: ProjectId.make("project"),
  projectIds: [],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6-astra",
    options: [{ id: "reasoningEffort", value: "max" }],
  },
  timeOfDay: "09:00",
  lookbackDays: 30,
  maxRuns: 10,
};

const seed = Effect.fn("test.insights.seed")(function* (count = 1) {
  yield* TestClock.setTime(Date.parse(timestamp));
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('project', 'Test', '/workspace/test', '[]', ${timestamp}, ${timestamp})`;
  yield* sql`INSERT INTO insights_settings VALUES (1, ${encodeSettings(config)})`;
  for (const id of [analyst, ThreadId.make("work")]) {
    yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
      VALUES (${id}, 'project', ${id}, 'codex', 'full-access', 'default', ${timestamp}, ${timestamp}, '{}')`;
  }
  yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
    VALUES ('analyst-run', ${analyst}, 1, 'codex', 'running', ${timestamp}, '{"modelSelection":{"instanceId":"codex","model":"gpt-6-astra","options":[{"id":"reasoningEffort","value":"max"}]}}')`;
  for (let index = 1; index <= count; index++) {
    const run = `run-${index}`;
    yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
      VALUES (${run}, 'work', ${index}, 'codex', 'completed', ${timestamp}, ${timestamp}, '{"modelSelection":{"instanceId":"codex","model":"gpt-6-astra"}}')`;
    yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES (${`event-${index}`}, 'thread', 'work', ${index}, 'run.completed', ${timestamp}, 'server', '{}', ${`{"runId":"${run}"}`}, 2)`;
    yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (${`message-${index}`}, 'work', ${run}, 'assistant', 0, ${timestamp}, ${timestamp}, '{"createdBy":"agent","text":"Tests passed; the deployment remains unverified."}')`;
  }
});

const submission = (reportId: string, evidenceId: string): InsightsSubmitInput => ({
  reportId,
  summary: "Deployment verification was left open.",
  wins: [],
  limitations: [],
  assessments: [],
  recommendations: [
    {
      key: "deployment-verification",
      title: "Verify deployments",
      category: "verification",
      priority: "high",
      confidence: "medium",
      observation: "The agent reported missing deployment verification.",
      recommendation: "Add a runtime verification step.",
      targetFile: "skills/deploy/SKILL.md",
      suggestedChange: "Check the deployed version before completion.",
      expectedImpact: "Expose failed deployments earlier.",
      validation: "Check subsequent deployment evidence.",
      evidenceIds: [evidenceId],
    },
  ],
});

it.effect(
  "collects bounded evidence without skipping the backlog or counting its own analysis",
  () =>
    Effect.gen(function* () {
      yield* seed(12);
      const sql = yield* SqlClient.SqlClient;
      for (const index of [1, 2]) {
        yield* sql`UPDATE orchestration_v2_projection_messages SET message_id = ${`message:${"nested%3A".repeat(40)}:${index}`} WHERE message_id = ${`message-${index}`}`;
      }
      const service = yield* Insights.InsightsService;
      const first = yield* service.collect(analyst);
      assert.equal(first.report.metrics.runs, 10);
      assert.isTrue(first.report.hasMore);
      assert.equal(first.report.throughSequence, 10);
      assert.isFalse(first.report.evidence.some((e) => e.threadId === analyst));
      const longEvidence = first.report.evidence.filter((e) => e.id.startsWith("sha256:"));
      assert.equal(longEvidence.length, 2);
      assert.notEqual(longEvidence[0]!.id, longEvidence[1]!.id);
      assert.isTrue(first.report.evidence.every((e) => e.id.length <= 300));
      assert.equal((yield* service.collect(analyst)).report.id, first.report.id);
      assert.deepEqual((yield* service.report(first.report.id)).evidence, first.report.evidence);
      const decision = {
        title: "Name the deployment check",
        action: "Say which deployment check counts as done.",
        why: "The brief left verification open and the agent stopped at passing tests.",
        evidenceIds: [longEvidence[0]!.id],
      };
      const briefed = (decisions: NonNullable<InsightsSubmitInput["brief"]>["decisions"]) => ({
        ...submission(first.report.id, longEvidence[0]!.id),
        brief: { headline: "Deployments are left unverified.", decisions },
      });
      assert.equal(
        (yield* Effect.flip(service.submit(analyst, briefed([{ ...decision, kind: "toolkit" }]))))
          .reason,
        "invalid_evidence",
      );
      const completed = yield* service.submit(
        analyst,
        briefed([
          { ...decision, kind: "briefing" },
          { ...decision, kind: "toolkit", recommendationKey: "Deployment verification" },
        ]),
      );
      assert.deepEqual(
        completed.brief?.decisions.map((d) => d.recommendationId ?? null),
        [null, completed.recommendationIds[0]],
      );
      const recommendation = yield* service.recommendation(completed.recommendationIds[0]!);
      assert.deepEqual(recommendation.evidence, [longEvidence[0]!]);
      const next = yield* service.collect(analyst);
      assert.equal(next.report.metrics.runs, 2);
      assert.equal(next.report.fromSequence, 10);
      assert.isFalse(next.report.hasMore);
      const reprioritized = yield* service.submit(analyst, {
        ...submission(next.report.id, next.report.evidence[0]!.id),
        recommendations: [],
        brief: {
          headline: "Verify deployments next.",
          decisions: [
            {
              ...decision,
              kind: "toolkit",
              evidenceIds: [next.report.evidence[0]!.id],
              recommendationKey: "deployment-verification",
            },
          ],
        },
      });
      assert.equal(
        reprioritized.brief?.decisions[0]?.recommendationId,
        completed.recommendationIds[0],
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "rejects fabricated evidence and foreign submissions atomically, and preserves dismissed decisions across reports",
  () =>
    Effect.gen(function* () {
      yield* seed();
      const service = yield* Insights.InsightsService;
      const packet = yield* service.collect(analyst);
      const payload = submission(packet.report.id, packet.report.evidence[0]!.id);
      assert.equal(
        (yield* Effect.flip(service.submit(ThreadId.make("other"), payload))).reason,
        "wrong_owner",
      );
      assert.equal(
        (yield* Effect.flip(service.submit(analyst, submission(packet.report.id, "invented"))))
          .reason,
        "invalid_evidence",
      );
      assert.equal((yield* service.snapshot()).recommendations.length, 0);
      const completed = yield* service.submit(analyst, payload);
      const id = completed.recommendationIds[0]!;
      yield* service.update({ id, status: "dismissed", note: "Covered by another step." });
      yield* service.submit(analyst, payload);
      assert.equal((yield* service.recommendation(id)).occurrences, 1);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version) VALUES ('later', 'thread', 'work', 2, 'run.updated', ${timestamp}, 'server', '{}', '{"runId":"run-1"}', 2)`;
      const next = yield* service.collect(analyst);
      yield* service.submit(analyst, submission(next.report.id, next.report.evidence[0]!.id));
      const saved = yield* service.recommendation(id);
      assert.equal(saved.status, "dismissed");
      assert.equal(saved.note, "Covered by another step.");
      assert.equal(saved.occurrences, 2);
      assert.equal(saved.history.length, 2);
      yield* service.update({ id, status: "open", note: "Reconsider after the workflow changed." });
      assert.equal((yield* service.recommendation(id)).status, "open");
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "retries failed analyses from the last successful checkpoint and reports missing usage honestly",
  () =>
    Effect.gen(function* () {
      yield* seed();
      const service = yield* Insights.InsightsService;
      const first = yield* service.collect(analyst);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'failed' WHERE run_id = 'analyst-run'`;
      const next = yield* service.collect(ThreadId.make("replacement"));
      assert.equal((yield* service.report(first.report.id)).status, "failed");
      assert.equal(next.report.fromSequence, 0);
      assert.equal(next.report.metrics.runs, 1);
      assert.equal(next.report.metrics.runsWithTokenUsage, 0);
      assert.equal(next.report.metrics.tokens, 0);
      const packet = yield* service.snapshot();
      assert.isTrue(packet.reports.every((r) => r.evidence.length === 0));
    }).pipe(Effect.provide(layer)),
);

it.effect("keeps checkpoints scoped to the selected projects", () =>
  Effect.gen(function* () {
    yield* seed();
    const service = yield* Insights.InsightsService;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE insights_settings SET payload_json = ${encodeSettings({ ...config, projectIds: [ProjectId.make("other")] })}`;
    assert.equal((yield* service.collect(analyst)).report.status, "empty");
    yield* sql`UPDATE insights_settings SET payload_json = ${encodeSettings(config)}`;
    const packet = yield* service.collect(analyst);
    assert.equal(packet.report.fromSequence, 0);
    assert.equal(packet.report.metrics.runs, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("requires an available Astra and project, enforces max effort, and permits pausing", () =>
  Effect.gen(function* () {
    yield* seed();
    const service = yield* Insights.InsightsService;
    const saved = yield* service.configure({
      ...config,
      modelSelection: {
        ...config.modelSelection,
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    });
    assert.deepEqual(saved.settings?.modelSelection.options, [
      { id: "reasoningEffort", value: "max" },
    ]);
    for (const invalid of [
      { ...config, projectId: ProjectId.make("missing") },
      { ...config, modelSelection: { ...config.modelSelection, model: "gpt-6.1-sol" } },
      {
        ...config,
        modelSelection: {
          ...config.modelSelection,
          instanceId: ProviderInstanceId.make("missing"),
        },
      },
      {
        ...config,
        linkedProjects: [{ environmentId: studio, projectIds: [ProjectId.make("app2")] }],
      },
    ])
      assert.equal((yield* Effect.flip(service.configure(invalid))).reason, "invalid_settings");
    assert.isFalse((yield* service.configure({ ...config, enabled: false })).settings!.enabled);
  }).pipe(Effect.provide(layer)),
);

it.effect("tracks a restarted analyst and prevents a second analysis during its continuation", () =>
  Effect.gen(function* () {
    yield* seed();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'cancelled' WHERE run_id = 'analyst-run'`;
    yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
      VALUES ('scheduled', ${analyst}, 'analyst-run', 'user', 0, ${timestamp}, ${timestamp}, '{"scheduledTaskId":"insights:daily"}')`;
    yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES ('continuation', ${analyst}, 2, 'codex', 'running', '2026-10-30T11:00:00.000Z', '{}')`;
    const service = yield* Insights.InsightsService;
    assert.equal((yield* service.snapshot()).latestAnalysis?.status, "running");
    assert.equal((yield* Effect.flip(service.runNow())).reason, "analysis_running");
    yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'continuation'`;
    assert.equal((yield* service.snapshot()).latestAnalysis?.status, "completed");
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "groups child threads under their task, separates the user's messages from agents', and clusters failing tools",
  () =>
    Effect.gen(function* () {
      yield* seed();
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
        VALUES ('child', 'project', 'child', 'codex', 'full-access', 'default', ${timestamp}, ${timestamp},
          '{"lineage":{"parentThreadId":"work","rootThreadId":"work","relationshipToParent":"subagent"},"pullRequests":[{"snapshot":{"state":"merged"}}]}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
        VALUES ('child-run', 'child', 1, 'codex', 'failed', ${timestamp}, ${timestamp}, '{"modelSelection":{"instanceId":"codex","model":"gpt-6-astra"}}')`;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
        VALUES ('child-event', 'thread', 'child', 1, 'run.completed', ${timestamp}, 'server', '{}', '{"runId":"child-run"}', 2)`;
      for (const [id, run, createdBy, at, text] of [
        ["brief", "run-1", "user", "2026-10-30T09:00:00.000Z", "Fix the deploy."],
        ["follow-up", "run-1", "user", "2026-10-30T11:00:00.000Z", "Also check staging."],
        ["delegated", "child-run", "agent", timestamp, "Check the staging logs."],
      ] as const)
        yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
          VALUES (${id}, ${run === "run-1" ? "work" : "child"}, ${run}, 'user', 0, ${at}, ${at}, ${JSON.stringify({ createdBy, text })})`;
      for (const [id, run, type, status, payload] of [
        [
          "dynamic",
          "run-1",
          "dynamic_tool",
          "failed",
          '{"toolName":"database","output":"Unavailable"}',
        ],
        [
          "command",
          "run-1",
          "command_execution",
          "completed",
          '{"input":"sed -n 1,9p a.ts","output":"sed: a.ts: No such file or directory","exitCode":1}',
        ],
        [
          "child-command",
          "child-run",
          "command_execution",
          "completed",
          '{"input":"sed -n 1,9p b.ts","output":"sed: b.ts: No such file or directory","exitCode":1}',
        ],
        ["expected", "run-1", "command_execution", "completed", '{"input":"test","exitCode":0}'],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
          VALUES (${id}, ${run === "run-1" ? "work" : "child"}, ${run}, 2, ${type}, ${status}, ${timestamp}, ${payload})`;
      }
      const service = yield* Insights.InsightsService;
      const { report } = yield* service.collect(analyst);
      assert.equal(report.metrics.toolFailures, 3);
      assert.deepInclude(report.tasks?.[0], {
        rootThreadId: ThreadId.make("work"),
        threadIds: [ThreadId.make("work"), ThreadId.make("child")],
        runs: 2,
        followUps: 1,
        failedTools: 3,
        latestRunStatus: "failed",
        pullRequest: "merged",
      });
      assert.deepEqual(
        report.friction?.map(({ key, failures, tasks, maxPerTask, evidenceIds }) => ({
          key,
          failures,
          tasks,
          maxPerTask,
          evidenceIds,
        })),
        [
          {
            key: "sed · exit 1 · sed: <path>: No such file or directory",
            failures: 2,
            tasks: 1,
            maxPerTask: 2,
            evidenceIds: ["item:command", "item:child-command"],
          },
          {
            key: "database · exit ? · (no error output)",
            failures: 1,
            tasks: 1,
            maxPerTask: 1,
            evidenceIds: ["item:dynamic"],
          },
        ],
      );
      const text = (id: string) => report.evidence.find((e) => e.id === id)?.text ?? "";
      assert.match(text("message:brief"), /^Task brief/);
      assert.match(text("message:follow-up"), /^Follow-up the user wrote/);
      assert.match(text("message:delegated"), /not the user/);
      assert.isUndefined((yield* service.snapshot()).reports[0]?.tasks);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "rejects improvement claims using pre-change evidence, then accepts later observations",
  () =>
    Effect.gen(function* () {
      yield* seed();
      const service = yield* Insights.InsightsService;
      const sql = yield* SqlClient.SqlClient;
      const packet = yield* service.collect(analyst);
      const completed = yield* service.submit(analyst, submission(packet.report.id, "run:run-1"));
      const id = completed.recommendationIds[0]!;
      yield* TestClock.adjust("1 hour");
      yield* service.update({ id, status: "implemented", note: "Added the check." });
      yield* TestClock.adjust("1 hour");
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('changed', 'thread', 'work', 2, 'run.updated', ${timestamp}, 'server', '{}', '{"runId":"run-1"}', 2)`;
      const next = yield* service.collect(analyst);
      const assessment = {
        recommendationId: id,
        outcome: "improved" as const,
        explanation: "The deployment has been verified.",
        evidenceIds: ["message:message-1"],
      };
      const payload = {
        ...submission(next.report.id, "run:run-1"),
        recommendations: [],
        assessments: [assessment],
      };
      assert.equal(
        (yield* Effect.flip(service.submit(analyst, payload))).reason,
        "invalid_evidence",
      );
      assert.equal((yield* service.recommendation(id)).assessments.length, 0);
      yield* service.submit(analyst, {
        ...payload,
        assessments: [{ ...assessment, outcome: "insufficient_evidence", evidenceIds: [] }],
      });
      const later = "2026-10-30T13:00:00.000Z";
      yield* TestClock.setTime(Date.parse(later));
      yield* sql`UPDATE orchestration_v2_projection_messages SET created_at = ${later} WHERE message_id = 'message-1'`;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('later', 'thread', 'work', 3, 'run.updated', ${later}, 'server', '{}', '{"runId":"run-1"}', 2)`;
      const after = yield* service.collect(analyst);
      const proposal = submission(after.report.id, "run:run-1").recommendations[0]!;
      yield* service.submit(analyst, {
        ...payload,
        reportId: after.report.id,
        recommendations: [{ ...proposal, validation: "Count fewer tool calls." }],
      });
      const assessed = yield* service.recommendation(id);
      assert.equal(assessed.assessments.at(-1)?.outcome, "improved");
      assert.equal(assessed.validation, "Count fewer tool calls.");
      assert.deepInclude(assessed.trial, { validation: "Check subsequent deployment evidence." });
      yield* TestClock.adjust("1 hour");
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('again', 'thread', 'work', 4, 'run.updated', ${later}, 'server', '{}', '{"runId":"run-1"}', 2)`;
      const again = yield* service.collect(analyst);
      assert.equal(
        (yield* Effect.flip(service.submit(analyst, { ...payload, reportId: again.report.id })))
          .reason,
        "invalid_evidence",
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "merges a linked environment and its skill usage into one report, keeping its own cursor when it cannot be reached",
  () => {
    const remote: InsightsEvidenceResult = {
      projects: [
        { projectId: ProjectId.make("app2"), title: "app2", workspaceRoot: "/studio/app2" },
      ],
      metrics: { ...emptyRemoteMetrics, runs: 1, completed: 1 },
      skills: [
        { skill: "review", runs: 1 },
        { skill: "deploy", runs: 1 },
      ],
      evidence: [
        {
          id: "run:remote-run",
          threadId: ThreadId.make("remote-work"),
          runId: "remote-run",
          itemId: null,
          projectId: ProjectId.make("app2"),
          occurredAt: timestamp,
          title: "Remote work",
          kind: "run",
          text: "Status: completed",
        },
      ],
      throughSequence: 7,
      hasMore: false,
    };
    const peer = linkedStudio([
      remote,
      "unreachable",
      { ...remote, evidence: [], throughSequence: 9 },
    ]);
    return Effect.gen(function* () {
      yield* seed();
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
        VALUES ('skill', 'work', 'run-1', 2, 'dynamic_tool', 'completed', ${timestamp}, '{"toolName":"Skill","input":{"skill":"deploy"}}')`;
      const service = yield* Insights.InsightsService;
      yield* service.configure({
        ...config,
        linkedProjects: [{ environmentId: studio, projectIds: [ProjectId.make("app2")] }],
      });
      const packet = yield* service.collect(analyst);
      assert.deepEqual(peer.calls[0], {
        lookbackDays: 30,
        maxRuns: 5,
        characterBudget: 75000,
        projectIds: ["app2"],
        fromSequence: 0,
      });
      assert.equal(packet.report.metrics.runs, 2);
      assert.deepEqual(packet.report.skills, [
        { skill: "deploy", runs: 2 },
        { skill: "review", runs: 1 },
      ]);
      assert.include(
        packet.report.evidence.find((e) => e.id === "run:run-1")?.text,
        "skills loaded: deploy",
      );
      const linkedEvidence = packet.report.evidence.find((e) => e.environmentId === studio);
      assert.equal(linkedEvidence?.id, "studio/run:remote-run");
      assert.deepEqual(
        packet.projects.find((p) => p.environmentId === studio),
        {
          projectId: ProjectId.make("app2"),
          title: "app2",
          workspaceRoot: "/studio/app2",
          environmentId: studio,
          environmentLabel: "Mac Studio",
        },
      );
      const completed = yield* service.submit(
        analyst,
        submission(packet.report.id, linkedEvidence!.id),
      );
      yield* Effect.exit(service.implement(completed.recommendationIds[0]!));
      assert.deepEqual(peer.launches, [config.projectId]);

      const unreached = yield* service.collect(analyst);
      assert.equal(peer.calls[1]?.fromSequence, 7);
      assert.isUndefined(unreached.report.linked);
      assert.isTrue(
        unreached.report.limitations.some((l) => l.startsWith("Mac Studio could not be reached")),
      );

      const retried = yield* service.collect(analyst);
      assert.equal(peer.calls[2]?.fromSequence, 7);
      assert.equal(retried.report.linked?.[0]?.throughSequence, 9);
    }).pipe(Effect.provide(layerWith(peer.layer)));
  },
);

const emptyRemoteMetrics = {
  runs: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  active: 0,
  toolFailures: 0,
  humanRequests: 0,
  subagents: 0,
  tokens: 0,
  runsWithTokenUsage: 0,
  activeMilliseconds: 0,
};
