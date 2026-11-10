import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  type InsightEdit,
  type InsightsEvidenceResult,
  InsightsSettings,
  InsightsSubmitInput,
  OrchestratorMcpFailure,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ScheduledTask,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as Insights from "./InsightsService.ts";
import { INSIGHTS_ANALYSIS_PROMPT } from "./insightsPrompt.ts";

const studio = EnvironmentId.make("studio");

/** Records what an implementation thread would start with; the launch itself is not needed. */
const launcher = (launches: Array<ThreadLaunch.ThreadLaunchInput>) =>
  Layer.mock(ThreadLaunch.ThreadLaunchService)({
    launch: (input) => {
      launches.push(input);
      return Effect.die("not needed");
    },
  });

/** A linked Mac Studio answering each evidence call with the next response, or unreachable. */
const linkedStudio = (responses: Array<InsightsEvidenceResult | "unreachable">) => {
  const calls: Array<Record<string, unknown>> = [];
  const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
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
    launcher(launches),
  );
  return { calls, launches, layer };
};

const unlinked = (launches: Array<ThreadLaunch.ThreadLaunchInput> = []) =>
  Layer.mergeAll(
    Layer.mock(PeerLinks.PeerLinks)({
      enabled: Effect.succeed(false),
      get: () => Effect.succeedNone,
    }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({}),
    launcher(launches),
  );

const scheduled = (input: ScheduledTaskUpsertInput) =>
  ScheduledTask.make({
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
  });

const storage = Layer.merge(Sqlite.layerMemory, NodeServices.layer);

/** Insights over its collaborators. Storage comes from outside, so a test can seed it first. */
const servicesWith = (
  peers: Layer.Layer<
    PeerLinks.PeerLinks | PeerMcpClient.PeerMcpClient | ThreadLaunch.ThreadLaunchService
  >,
  options: {
    /** What the scheduler has saved; a save replaces it. */
    readonly tasks?: Array<ScheduledTask>;
    /** Each checkout's remote default branch; a checkout has none while `branch` is null. */
    readonly remote?: { branch: string | null };
  } = {},
) => {
  const tasks = options.tasks ?? [];
  const remote = options.remote ?? { branch: "main" };
  return Insights.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ScheduledTasks.ScheduledTaskService)({
          list: () => Effect.succeed({ tasks }),
          subscribeList: () => Stream.make({ tasks: [] }),
          upsert: (input) => {
            assert.equal(input.schedule.type, "fixed_time");
            assert.deepEqual(input.modelSelection.options, [
              { id: "reasoningEffort", value: "max" },
            ]);
            const task = scheduled(input);
            tasks.splice(0, tasks.length, task);
            return Effect.succeed({ task });
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
              models: [
                { slug: "gpt-6-astra", name: "Astra", isCustom: false, capabilities: null },
                { slug: "gpt-6-luna", name: "Luna", isCustom: false, capabilities: null },
              ],
              skills: [],
              slashCommands: [],
            }),
          ]),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolvePrimaryRemoteName: () => Effect.succeed("origin"),
          resolveDefaultBranchName: () => Effect.succeed(remote.branch),
          resolveCommit: () => Effect.succeed({ commitSha: "0".repeat(40) }),
        }),
        NodeCrypto.layer,
      ),
    ),
  );
};
const layerWith = (...args: Parameters<typeof servicesWith>) =>
  servicesWith(...args).pipe(Layer.provideMerge(storage));
const layer = layerWith(unlinked());
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
      edits: [],
      suggestedChange: "Check the deployed version before completion.",
      targetFile: "skills/deploy/SKILL.md",
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
  "rejects fabricated evidence and foreign submissions atomically, and records a problem seen again without rewriting or reopening it",
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
      const activity = (event: string, version: number, run: string) =>
        sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version) VALUES (${event}, 'thread', 'work', ${version}, 'run.updated', ${timestamp}, 'server', '{}', ${`{"runId":"${run}"}`}, 2)`;
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
        VALUES ('run-2', 'work', 2, 'codex', 'completed', ${timestamp}, ${timestamp}, '{"modelSelection":{"instanceId":"codex","model":"gpt-6-astra"}}')`;
      yield* activity("second", 2, "run-2");
      const next = yield* service.collect(analyst);
      const again = submission(next.report.id, "run:run-2");
      // The same key submitted in full is taken as the problem coming back, not as a rewrite.
      const resubmitted = yield* service.submit(analyst, {
        ...again,
        recommendations: [
          {
            ...again.recommendations[0]!,
            title: "Reworded",
            observation: "The second deployment went unverified too.",
          },
        ],
        recurrences: [
          {
            recommendationKey: "deployment-verification",
            text: "Named a second time in the same review.",
            evidenceIds: ["run:run-2"],
          },
        ],
      });
      assert.deepEqual(resubmitted.recommendationIds, [id]);
      const saved = yield* service.recommendation(id);
      assert.deepInclude(saved, {
        status: "dismissed",
        note: "Covered by another step.",
        title: "Verify deployments",
        observation: "The agent reported missing deployment verification.",
        occurrences: 2,
      });
      assert.equal(saved.history.length, 2);
      assert.deepEqual(
        saved.incidents?.map((incident) => [
          incident.reportId,
          incident.text,
          incident.evidence.map((evidence) => evidence.id),
        ]),
        [[next.report.id, "The second deployment went unverified too.", ["run:run-2"]]],
      );
      assert.deepEqual(
        (yield* service.snapshot()).recommendations[0]?.incidents?.[0]?.evidence,
        [],
      );
      // A later review that samples the same run again has seen nothing new.
      yield* activity("third", 3, "run-2");
      const resampled = yield* service.collect(analyst);
      const recurrence = {
        recommendationKey: "Deployment verification",
        text: "The deployment went unverified.",
        evidenceIds: ["run:run-2"],
      };
      const unknown = yield* Effect.flip(
        service.submit(analyst, {
          ...submission(resampled.report.id, "run:run-2"),
          recommendations: [],
          recurrences: [recurrence, { ...recurrence, recommendationKey: "never-recommended" }],
        }),
      );
      assert.deepInclude(unknown, {
        reason: "invalid_change",
        problem: "unknown_recommendation",
        recommendationKey: "never-recommended",
      });
      const repeated = yield* service.submit(analyst, {
        ...submission(resampled.report.id, "run:run-2"),
        recommendations: [],
        recurrences: [recurrence],
      });
      assert.deepEqual(repeated.recommendationIds, [id]);
      assert.deepInclude(yield* service.recommendation(id), {
        occurrences: 2,
        status: "dismissed",
      });
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
      {
        ...config,
        implementationModelSelection: { ...config.modelSelection, model: "not-offered" },
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
  "rejects measurements from runs begun before the trial, then accepts later observations",
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
      const boundary = {
        ...assessment,
        outcome: "insufficient_evidence" as const,
        evidenceIds: ["run:run-1"],
      };
      yield* service.submit(analyst, { ...payload, assessments: [boundary] });
      const later = "2026-10-30T13:00:00.000Z";
      yield* TestClock.setTime(Date.parse(later));
      yield* sql`UPDATE orchestration_v2_projection_messages SET created_at = ${later} WHERE message_id = 'message-1'`;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('later', 'thread', 'work', 3, 'run.updated', ${later}, 'server', '{}', '{"runId":"run-1"}', 2)`;
      const straddling = yield* service.collect(analyst);
      const straddlingPayload = { ...payload, reportId: straddling.report.id };
      assert.equal(
        (yield* Effect.flip(service.submit(analyst, straddlingPayload))).reason,
        "invalid_evidence",
      );
      yield* service.submit(analyst, { ...straddlingPayload, assessments: [boundary] });
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
      VALUES ('run-2', 'work', 2, 'codex', 'completed', ${later}, ${later}, '{"modelSelection":{"instanceId":"codex","model":"gpt-6-astra"}}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
      VALUES ('message-2', 'work', 'run-2', 'assistant', 0, ${later}, ${later}, '{"createdBy":"agent","text":"Deployed version verified."}')`;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('after', 'thread', 'work', 4, 'run.completed', ${later}, 'server', '{}', '{"runId":"run-2"}', 2)`;
      const after = yield* service.collect(analyst);
      const proposal = submission(after.report.id, "run:run-2").recommendations[0]!;
      const observed = { ...assessment, evidenceIds: ["message:message-2"] };
      yield* service.submit(analyst, {
        ...payload,
        reportId: after.report.id,
        recommendations: [{ ...proposal, validation: "Count fewer tool calls." }],
        assessments: [observed],
      });
      const assessed = yield* service.recommendation(id);
      assert.equal(assessed.assessments.at(-1)?.outcome, "improved");
      assert.equal(assessed.validation, "Check subsequent deployment evidence.");
      assert.deepInclude(assessed.trial, { validation: "Check subsequent deployment evidence." });
      yield* TestClock.adjust("1 hour");
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json, application_event_version)
      VALUES ('again', 'thread', 'work', 5, 'run.updated', ${later}, 'server', '{}', '{"runId":"run-2"}', 2)`;
      const again = yield* service.collect(analyst);
      assert.equal(
        (yield* Effect.flip(
          service.submit(analyst, {
            ...payload,
            reportId: again.report.id,
            assessments: [observed],
          }),
        )).reason,
        "invalid_evidence",
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "gives a recommendation from before exact changes its edit only once the edit applies to the file, then starts it as a pull request",
  () => {
    const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
    const remote: { branch: string | null } = { branch: "main" };
    return Effect.gen(function* () {
      yield* seed();
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-insights-" });
      const skill = path.join(root, "skills", "deploy", "SKILL.md");
      const checks = path.join(root, "skills", "deploy", "CHECKS.md");
      yield* fs.makeDirectory(path.dirname(skill), { recursive: true });
      yield* fs.writeFileString(skill, "# Deploy\n\nRun the tests.\nRun the tests.\nShip it.\n");
      yield* sql`UPDATE projection_projects SET workspace_root = ${root}`;
      const { edits: _edits, ...written } = submission("", "run:old").recommendations[0]!;
      yield* sql`INSERT INTO insights_recommendations (id, insight_key, status, updated_at, payload_json)
        VALUES ('insight:earlier', 'deployment-verification', 'deferred', ${timestamp}, ${JSON.stringify(
          {
            ...written,
            expectedImpact: "Expose failed deployments earlier.",
            id: "insight:earlier",
            status: "deferred",
            createdAt: timestamp,
            updatedAt: timestamp,
            lastSeenAt: timestamp,
            occurrences: 3,
            note: "After the release.",
            deferredUntil: null,
            implementationThreadId: null,
            implementationRef: null,
            evidence: [],
            assessments: [],
            history: [{ at: timestamp, status: "deferred", note: "After the release." }],
          },
        )})`;
      const service = yield* Insights.InsightsService;
      assert.isUndefined((yield* service.snapshot()).recommendations[0]?.edits);
      const packet = yield* service.collect(analyst);
      const {
        suggestedChange: _prose,
        targetFile: _target,
        ...proposal
      } = submission(packet.report.id, "run:run-1").recommendations[0]!;
      const proposing = (edits: ReadonlyArray<InsightEdit>, suggestedChange?: string) => ({
        ...submission(packet.report.id, "run:run-1"),
        recommendations: [
          {
            ...proposal,
            title: "Verify each deployment",
            edits,
            ...(suggestedChange === undefined ? {} : { suggestedChange }),
          },
        ],
      });
      const edit = { file: skill, find: "Ship it.", replace: "Check the deployed version." };
      for (const [edits, problem, suggestedChange] of [
        [[], "missing_change"],
        [[edit], "mixed_change", "Also make the deploy script run the check."],
        [[{ ...edit, file: "skills/deploy/SKILL.md" }], "path_not_absolute"],
        [[{ ...edit, file: checks }], "file_missing"],
        [[{ ...edit, find: "" }], "file_exists"],
        [[{ ...edit, find: "Ship it now." }], "text_not_found"],
        [[edit, { ...edit, find: "Run the tests." }], "text_not_unique"],
      ] as const)
        assert.deepInclude(
          yield* Effect.flip(service.submit(analyst, proposing(edits, suggestedChange))),
          { reason: "invalid_change", problem, recommendationKey: "deployment-verification" },
        );
      assert.equal((yield* service.recommendation("insight:earlier")).title, "Verify deployments");
      const edits = [edit, { file: checks, find: "", replace: "# Checks\n" }];
      const completed = yield* service.submit(analyst, proposing(edits));
      assert.deepEqual(completed.recommendationIds, ["insight:earlier"]);
      const saved = yield* service.recommendation("insight:earlier");
      assert.deepInclude(saved, {
        title: "Verify each deployment",
        edits,
        targetFile: skill,
        status: "deferred",
        note: "After the release.",
        occurrences: 4,
      });
      assert.isUndefined(saved.expectedImpact);
      assert.deepEqual(
        saved.history.map((entry) => entry.note),
        ["After the release.", "Rewritten with an exact change"],
      );
      assert.deepEqual((yield* service.snapshot()).recommendations[0]?.edits, []);

      yield* Effect.exit(service.implement("insight:earlier"));
      assert.deepInclude(launches[0], {
        projectId: config.projectId,
        workspaceStrategy: { type: "worktree", baseRef: "origin/main", startFromOrigin: true },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
      });
      const inWorktree = launches[0]?.initialMessage?.text ?? "";
      assert.include(inWorktree, `In ${path.join("skills", "deploy", "SKILL.md")}, replace:`);
      assert.include(inWorktree, `Create ${path.join("skills", "deploy", "CHECKS.md")} with:`);
      assert.notInclude(inWorktree, skill);

      // Without a remote there is no pull request to open, so the change is made in place.
      remote.branch = null;
      const apply = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
      yield* service.configure({ ...config, implementationModelSelection: apply });
      yield* Effect.exit(service.implement("insight:earlier"));
      assert.deepInclude(launches[1], {
        workspaceStrategy: { type: "root" },
        modelSelection: apply,
      });
      assert.include(launches[1]?.initialMessage?.text, `In ${skill}, replace:`);
    }).pipe(Effect.provide(layerWith(unlinked(launches), { remote })));
  },
);

it.effect("replaces a saved schedule's prompt when this build's analysis prompt differs", () => {
  const tasks = [
    scheduled({
      id: ScheduledTaskId.make("insights:daily"),
      title: "Daily workflow insights",
      prompt: "The analysis prompt of an earlier build.",
      enabled: true,
      schedule: { type: "fixed_time", timeOfDay: "09:00" },
      projectId: config.projectId,
      workspaceStrategy: { type: "root" },
      modelSelection: config.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
    }),
  ];
  return Effect.gen(function* () {
    yield* seed();
    yield* Layer.build(servicesWith(unlinked(), { tasks }));
    assert.equal(tasks[0]?.prompt, INSIGHTS_ANALYSIS_PROMPT);
  }).pipe(Effect.provide(storage));
});

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
      assert.deepEqual(
        peer.launches.map((launch) => launch.projectId),
        [config.projectId],
      );

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
