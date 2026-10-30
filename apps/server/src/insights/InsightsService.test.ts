import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  InsightsSettings,
  InsightsSubmitInput,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ScheduledTask,
  ScheduledTaskId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Insights from "./InsightsService.ts";

const layer = Insights.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ScheduledTasks.ScheduledTaskService)({
        list: () => Effect.succeed({ tasks: [] }),
        subscribeList: () => Stream.make({ tasks: [] }),
        upsert: (input) => {
          assert.equal(input.schedule.type, "fixed_time");
          assert.deepEqual(input.modelSelection.options, [{ id: "reasoningEffort", value: "max" }]);
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
      Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
      Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
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
  Layer.provideMerge(Sqlite.layerMemory),
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
    yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
      VALUES (${`item-${index}`}, 'work', ${run}, ${index}, 'assistant_message', 'completed', ${timestamp}, '{"text":"Tests passed; the deployment remains unverified."}')`;
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
      const service = yield* Insights.InsightsService;
      const first = yield* service.collect(analyst);
      assert.equal(first.report.metrics.runs, 10);
      assert.isTrue(first.report.hasMore);
      assert.equal(first.report.throughSequence, 10);
      assert.isFalse(first.report.evidence.some((e) => e.threadId === analyst));
      assert.equal((yield* service.collect(analyst)).report.id, first.report.id);
      yield* service.submit(analyst, {
        ...submission(first.report.id, first.report.evidence[0]!.id),
        recommendations: [],
      });
      const next = yield* service.collect(analyst);
      assert.equal(next.report.metrics.runs, 2);
      assert.equal(next.report.fromSequence, 10);
      assert.isFalse(next.report.hasMore);
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

it.effect("counts dynamic tools and nonzero exits, and keeps failure evidence in the packet", () =>
  Effect.gen(function* () {
    yield* seed();
    const sql = yield* SqlClient.SqlClient;
    for (const [id, type, status, payload] of [
      ["dynamic", "dynamic_tool", "failed", '{"toolName":"database","output":"Unavailable"}'],
      [
        "command",
        "command_execution",
        "completed",
        '{"input":"verify","output":"Failed","exitCode":1}',
      ],
      ["expected", "command_execution", "completed", '{"input":"test","exitCode":0}'],
    ]) {
      yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json)
        VALUES (${id}, 'work', 'run-1', 2, ${type}, ${status}, ${timestamp}, ${payload})`;
    }
    const packet = yield* (yield* Insights.InsightsService).collect(analyst);
    assert.equal(packet.report.metrics.toolFailures, 2);
    assert.isTrue(packet.report.evidence.some((e) => e.id === "item:dynamic"));
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
        evidenceIds: ["item:item-1"],
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
      yield* sql`UPDATE orchestration_v2_projection_turn_items SET updated_at = ${later} WHERE turn_item_id = 'item-1'`;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('later', 'thread', 'work', 3, 'run.updated', ${later}, 'server', '{}', '{"runId":"run-1"}', 2)`;
      const after = yield* service.collect(analyst);
      yield* service.submit(analyst, { ...payload, reportId: after.report.id });
      assert.equal((yield* service.recommendation(id)).assessments.at(-1)?.outcome, "improved");
    }).pipe(Effect.provide(layer)),
);
