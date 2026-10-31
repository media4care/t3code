import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  QaRun,
  type QaSuite,
  type QaCiReport,
  type QaScheduleConfiguration,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { ChildProcessSpawner } from "effect/process";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Qa from "./QaService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import {
  AuthSessionId,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Etag from "effect/http/Etag";
import * as QaHttp from "./http.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";

class QaTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.qa) {}

const projectId = ProjectId.make("qa-test");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeRun = Schema.decodeUnknownEffect(QaRun);
const decodeSharedRecord = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const layer = Layer.mergeAll(Sqlite.layerMemory, ProcessRunner.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const suite: QaSuite = {
  id: "unit",
  name: "Unit tests",
  component: "Backend",
  kind: "unit",
  command: "node run.cjs",
  report: "junit",
};

const fixture = Effect.fn("Qa.test.fixture")(function* (
  script: string,
  suites: readonly QaSuite[] = [suite],
  options: { sharedResults?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM qa_runs`;
  yield* sql`DELETE FROM qa_schedules`;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-qa-test-" });
  const processes = yield* ProcessRunner.ProcessRunner;
  const git = (args: readonly string[]) => processes.run({ command: "git", args, cwd: root });
  yield* git(["init", "-q"]);
  yield* fs.writeFileString(path.join(root, "t3.json"), encodeJson({ qa: { suites, ...options } }));
  yield* fs.writeFileString(path.join(root, "run.cjs"), script);
  const projectLayer = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (id) =>
      Effect.succeed(
        id === projectId
          ? Option.some({
              projectId,
              workspaceRoot: root,
              title: "QA",
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            })
          : Option.none(),
      ),
  });
  const registered = yield* Deferred.make<Effect.Effect<void>>();
  const schedulerLayer = Layer.succeed(
    Scheduler.Scheduler,
    Scheduler.Scheduler.of({
      register: Effect.fn("Qa.test.register")(function* <E, R>(
        _name: string,
        work: Effect.Effect<void, E, R>,
      ) {
        const context = yield* Effect.context<R>();
        yield* Deferred.succeed(
          registered,
          work.pipe(Effect.provideContext(context), Effect.orDie),
        );
      }),
    }),
  );
  const serviceLayer = Qa.layer.pipe(Layer.provide(projectLayer), Layer.provide(schedulerLayer));
  const context = yield* Layer.build(Layer.fresh(serviceLayer));
  return {
    service: Context.get(context, Qa.QaService),
    serviceLayer,
    root,
    fs,
    path,
    sql,
    git,
    tick: yield* Deferred.await(registered),
  };
});

const completed = Effect.fn("Qa.test.completed")(function* (
  service: Qa.QaService["Service"],
  id: string,
) {
  const value = yield* service.subscribe({ projectId }).pipe(
    Stream.map((snapshot) =>
      snapshot.recentRuns.find((run) => run.id === id && run.status !== "running"),
    ),
    Stream.filter((run) => run !== undefined),
    Stream.runHead,
  );
  assert.isTrue(Option.isSome(value));
  return yield* service.details({ projectId, runId: id });
});

describe("QA runs", () => {
  it.live("reuses a repository result in another checkout without local run history", () =>
    Effect.gen(function* () {
      const tracked = { ...suite, inputs: ["."] };
      const script = `require('node:fs').writeFileSync(process.env.T3_QA_REPORT_PATH,
        '<testsuite><testcase name="private test name"/></testsuite>');
        console.log('private command output');`;
      const first = yield* fixture(script, [tracked], { sharedResults: true });
      yield* first.fs.writeFileString(first.path.join(first.root, ".gitignore"), ".env\n");
      yield* first.fs.writeFileString(
        first.path.join(first.root, ".env"),
        "QA_FIXTURE_SECRET=original\n",
      );
      const run = yield* first.service.start({ projectId, suiteId: suite.id });
      const finished = yield* completed(first.service, run.id);
      const relative = "t3.qa-results/unit.json";
      const contents = yield* first.fs.readFileString(first.path.join(first.root, relative));
      assert.notInclude(contents, first.root);
      assert.notInclude(contents, "private command output");
      assert.notInclude(contents, "private test name");
      assert.notInclude(contents, script);
      assert.notInclude(contents, "QA_FIXTURE_SECRET");
      assert.isFalse((yield* first.service.snapshot({ projectId })).freshness?.[0]?.needsRun);
      yield* first.fs.writeFileString(
        first.path.join(first.root, "run.cjs"),
        "require('node:net').createServer().listen(0, '127.0.0.1');",
      );
      const cancelled = yield* first.service.start({ projectId, suiteId: suite.id });
      yield* first.service.cancel({ projectId, runId: cancelled.id });
      assert.equal(
        (yield* first.service.details({ projectId, runId: cancelled.id })).run.status,
        "cancelled",
      );
      assert.equal(yield* first.fs.readFileString(first.path.join(first.root, relative)), contents);

      const second = yield* fixture(script, [tracked], { sharedResults: true });
      yield* second.fs.writeFileString(second.path.join(second.root, ".gitignore"), ".env\n");
      yield* second.fs.writeFileString(
        second.path.join(second.root, ".env"),
        "QA_FIXTURE_SECRET=original\n",
      );
      yield* second.fs.makeDirectory(second.path.join(second.root, "t3.qa-results"));
      yield* second.fs.writeFileString(second.path.join(second.root, relative), contents);
      const snapshot = yield* second.service.snapshot({ projectId });
      assert.equal(snapshot.latestRuns[0]?.id, run.id);
      assert.deepEqual(snapshot.latestRuns[0]?.summary, finished.run.summary);
      assert.equal(snapshot.latestRuns[0]?.repositoryFile, relative);
      assert.equal(snapshot.freshness?.[0]?.state, "current");
      assert.isFalse(snapshot.freshness?.[0]?.needsRun);
      assert.deepEqual(yield* second.service.startAffected({ projectId }), []);
      assert.isEmpty(yield* second.sql`SELECT id FROM qa_runs`);
      const details = yield* second.service.details({ projectId, runId: run.id });
      assert.isNull(details.reportXml);
      assert.include(details.output, "execution environment");
      assert.include(
        (yield* second.service.tests({ projectId, runId: run.id })).unavailableReason ?? "",
        "execution environment",
      );
      yield* second.fs.writeFileString(
        second.path.join(second.root, ".env"),
        "QA_FIXTURE_SECRET=another-developer\n",
      );
      assert.isTrue((yield* second.service.snapshot({ projectId })).freshness?.[0]?.needsRun);
      yield* second.fs.writeFileString(
        second.path.join(second.root, ".env"),
        "QA_FIXTURE_SECRET=original\n",
      );
      assert.isFalse((yield* second.service.snapshot({ projectId })).freshness?.[0]?.needsRun);

      yield* second.fs.writeFileString(second.path.join(second.root, "run.cjs"), script + "\n");
      assert.isTrue((yield* second.service.snapshot({ projectId })).freshness?.[0]?.needsRun);
      yield* second.fs.writeFileString(second.path.join(second.root, "run.cjs"), script);
      yield* second.fs.writeFileString(
        second.path.join(second.root, "t3.json"),
        encodeJson({
          qa: {
            sharedResults: true,
            suites: [{ ...tracked, command: "node --no-warnings run.cjs" }],
          },
        }),
      );
      assert.isTrue((yield* second.service.snapshot({ projectId })).freshness?.[0]?.needsRun);

      yield* second.fs.writeFileString(
        second.path.join(second.root, "t3.json"),
        encodeJson({
          qa: { sharedResults: true, suites: [{ ...tracked, maxAgeHours: 0.000000001 }] },
        }),
      );
      assert.include(
        (yield* second.service.snapshot({ projectId })).freshness?.[0]?.reason ?? "",
        "freshness limit",
      );
      yield* second.fs.writeFileString(
        second.path.join(second.root, "t3.json"),
        encodeJson({
          qa: { sharedResults: true, suites: [tracked] },
        }),
      );
      yield* second.fs.writeFileString(
        second.path.join(second.root, "run.cjs"),
        script + "\nprocess.exitCode = 1;",
      );
      const failed = yield* second.service.start({ projectId, suiteId: suite.id });
      assert.equal((yield* completed(second.service, failed.id)).run.status, "failed");
      const failedSummary = yield* second.fs.readFileString(
        second.path.join(second.root, relative),
      );
      yield* second.fs.writeFileString(second.path.join(second.root, relative), contents);
      assert.equal((yield* second.service.snapshot({ projectId })).latestRuns[0]?.id, failed.id);
      yield* second.fs.writeFileString(second.path.join(second.root, relative), failedSummary);
      yield* second.sql`DELETE FROM qa_runs`;
      const sharedFailure = yield* second.service.snapshot({ projectId });
      assert.equal(sharedFailure.latestRuns[0]?.status, "failed");
      assert.equal(sharedFailure.freshness?.[0]?.state, "current");
      assert.isTrue(sharedFailure.freshness?.[0]?.needsRun);

      yield* second.fs.writeFileString(
        second.path.join(second.root, "t3.json"),
        encodeJson({
          qa: { sharedResults: false, suites: [tracked] },
        }),
      );
      assert.isEmpty((yield* second.service.snapshot({ projectId })).latestRuns);
      const disabled = yield* second.service.start({ projectId, suiteId: suite.id });
      yield* completed(second.service, disabled.id);
      assert.equal(
        yield* second.fs.readFileString(second.path.join(second.root, relative)),
        failedSummary,
      );
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "does not reuse unverifiable repository results or lose local outcomes when sharing fails",
    () =>
      Effect.gen(function* () {
        const tracked = { id: "unit", name: "Unit", command: "node run.cjs", inputs: ["."] };
        const { service, fs, path, root, sql } = yield* fixture("", [tracked], {
          sharedResults: true,
        });
        const run = yield* service.start({ projectId, suiteId: "unit" });
        yield* completed(service, run.id);
        const filename = path.join(root, "t3.qa-results/unit.json");
        const contents = yield* fs.readFileString(filename);
        const saved = yield* decodeSharedRecord(contents);
        yield* sql`DELETE FROM qa_runs`;
        yield* fs.writeFileString(filename, encodeJson({ ...saved, fingerprint: null }));
        const unverified = yield* service.snapshot({ projectId });
        assert.equal(unverified.latestRuns[0]?.status, "passed");
        assert.equal(unverified.freshness?.[0]?.state, "unknown");
        assert.isTrue(unverified.freshness?.[0]?.needsRun);
        for (const invalid of [
          "<<<<<<< merge conflict",
          " ".repeat(16 * 1024 + 1),
          encodeJson({ ...saved, version: 2 }),
          encodeJson({ ...saved, suiteId: "another-suite" }),
          encodeJson({ ...saved, exitCode: 1 }),
          encodeJson({ ...saved, summary: { tests: 1, failures: 1, skipped: 0 } }),
          encodeJson({
            ...saved,
            startedAt: "2099-01-01T00:00:00.000Z",
            finishedAt: "2099-01-02T00:00:00.000Z",
          }),
          encodeJson({ ...saved, finishedAt: "2000-01-01T00:00:00.000Z" }),
        ]) {
          yield* fs.writeFileString(filename, invalid);
          const state = yield* service.snapshot({ projectId });
          assert.isEmpty(state.latestRuns);
          assert.isTrue(state.freshness?.[0]?.needsRun);
          assert.isString(state.sharedResults?.warning);
        }
        const failedExport = yield* service.start({ projectId, suiteId: "unit" });
        const local = yield* completed(service, failedExport.id);
        assert.equal(local.run.status, "passed");
        assert.include(local.run.note ?? "", "repository summary could not be saved");
        yield* sql`DELETE FROM qa_runs`;
        yield* fs.remove(filename);
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-qa-external-" });
        const target = path.join(outside, "unit.json");
        yield* fs.writeFileString(target, contents);
        yield* fs.symlink(target, filename);
        assert.isEmpty((yield* service.snapshot({ projectId })).latestRuns);
        const linkedFile = yield* service.start({ projectId, suiteId: "unit" });
        assert.include(
          (yield* completed(service, linkedFile.id)).run.note ?? "",
          "could not be saved",
        );
        assert.equal(yield* fs.readFileString(target), contents);
        yield* fs.remove(filename);
        yield* fs.remove(path.join(root, "t3.qa-results"), { recursive: true });
        yield* fs.symlink(outside, path.join(root, "t3.qa-results"));
        yield* sql`DELETE FROM qa_runs`;
        assert.isEmpty((yield* service.snapshot({ projectId })).latestRuns);
        const linkedDirectory = yield* service.start({ projectId, suiteId: "unit" });
        assert.include(
          (yield* completed(service, linkedDirectory.id)).run.note ?? "",
          "could not be saved",
        );
        assert.equal(yield* fs.readFileString(target), contents);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "runs due schedules once, records actual results, and keeps interval state across restarts",
    () =>
      Effect.gen(function* () {
        const { service, tick, sql, serviceLayer, git } = yield* fixture("process.exitCode = 1", [
          { id: "unit", name: "Unit", command: "node run.cjs", inputs: ["run.cjs"] },
        ]);
        const branch = (yield* git(["branch", "--show-current"])).stdout.trim();
        const configuration: QaScheduleConfiguration = {
          enabled: true,
          branch,
          timeZone: "Europe/Berlin",
          timing: { type: "interval", everyMs: 86_400_000 },
          target: { type: "all" },
        };
        yield* service.setSchedule({ projectId, configuration });
        yield* tick;
        assert.isEmpty((yield* service.snapshot({ projectId })).recentRuns);
        yield* sql`UPDATE qa_schedules SET schedule_json = json_set(schedule_json, '$.nextRunAt', '2000-01-01T00:00:00.000Z')`;
        yield* tick;
        yield* tick;
        const finished = yield* service.subscribe({ projectId }).pipe(
          Stream.filter((value) => value.schedule?.lastStatus === "failed"),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(finished));
        const state = yield* service.snapshot({ projectId });
        assert.lengthOf(state.recentRuns, 1);
        assert.equal(state.recentRuns[0]?.status, "failed");
        assert.equal(state.recentRuns[0]?.source?.type, "schedule");
        assert.deepEqual(state.schedule?.runIds, [state.recentRuns[0]!.id]);
        assert.isNotNull(state.schedule?.nextRunAt);
        const restarted = Context.get(yield* Layer.build(Layer.fresh(serviceLayer)), Qa.QaService);
        assert.deepEqual((yield* restarted.snapshot({ projectId })).schedule, state.schedule);
        yield* restarted.setSchedule({
          projectId,
          configuration: { ...configuration, enabled: false },
        });
        assert.isNull((yield* restarted.snapshot({ projectId })).schedule?.nextRunAt);
        yield* restarted.setSchedule({ projectId, configuration });
        assert.isNotNull((yield* restarted.snapshot({ projectId })).schedule?.nextRunAt);
        yield* restarted.setSchedule({ projectId, configuration: null });
        assert.isNull((yield* restarted.snapshot({ projectId })).schedule);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("skips missed fixed times, rejects wrong branches, and validates the time zone", () =>
    Effect.gen(function* () {
      const { service, tick, sql, fs, path, root } = yield* fixture("");
      const configuration: QaScheduleConfiguration = {
        enabled: true,
        branch: "wrong-branch",
        timeZone: "Europe/Berlin",
        timing: { type: "fixed_time", timeOfDay: "09:00" },
        target: { type: "all" },
      };
      assert.equal(
        (yield* service
          .setSchedule({ projectId, configuration: { ...configuration, timeZone: "Invalid/Zone" } })
          .pipe(Effect.flip)).reason,
        "schedule",
      );
      yield* service.setSchedule({ projectId, configuration });
      yield* sql`UPDATE qa_schedules SET schedule_json = json_set(schedule_json, '$.nextRunAt', '2000-01-01T00:00:00.000Z')`;
      yield* tick;
      assert.equal((yield* service.snapshot({ projectId })).schedule?.lastStatus, "missed");
      yield* service.setSchedule({
        projectId,
        configuration: { ...configuration, timing: { type: "interval", everyMs: 60_000 } },
      });
      yield* sql`UPDATE qa_schedules SET schedule_json = json_set(schedule_json, '$.nextRunAt', '2000-01-01T00:00:00.000Z')`;
      yield* tick;
      const state = yield* service.snapshot({ projectId });
      assert.equal(state.schedule?.lastStatus, "failed");
      assert.include(state.schedule?.note ?? "", "different branch");
      assert.isEmpty(state.recentRuns);
      yield* fs.writeFileString(path.join(root, "t3.json"), "{ invalid catalog");
      yield* service.setSchedule({
        projectId,
        configuration: { ...configuration, enabled: false },
      });
      assert.isFalse((yield* service.snapshot({ projectId })).schedule?.configuration.enabled);
      yield* service.setSchedule({ projectId, configuration: null });
      assert.isNull((yield* service.snapshot({ projectId })).schedule);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "waits for manual work and does not resurrect an edited schedule when an active run finishes",
    () =>
      Effect.gen(function* () {
        const { service, tick, sql, git } = yield* fixture(
          "require('node:net').createServer().listen(0, '127.0.0.1')",
          [{ id: "unit", name: "Unit", command: "node run.cjs" }],
        );
        const configuration: QaScheduleConfiguration = {
          enabled: true,
          branch: (yield* git(["branch", "--show-current"])).stdout.trim(),
          timeZone: "UTC",
          timing: { type: "interval", everyMs: 60_000 },
          target: { type: "all" },
        };
        yield* service.setSchedule({ projectId, configuration });
        yield* sql`UPDATE qa_schedules SET schedule_json = json_set(schedule_json, '$.nextRunAt', '2000-01-01T00:00:00.000Z')`;
        const manual = yield* service.start({ projectId, suiteId: "unit" });
        yield* tick;
        assert.equal((yield* service.snapshot({ projectId })).schedule?.lastStatus, "never");
        yield* service.cancel({ projectId, runId: manual.id });
        yield* tick;
        yield* service.subscribe({ projectId }).pipe(
          Stream.filter((state) =>
            state.latestRuns.some(
              (run) => run.source?.type === "schedule" && run.status === "running",
            ),
          ),
          Stream.runHead,
        );
        yield* service.setSchedule({
          projectId,
          configuration: { ...configuration, enabled: false },
        });
        yield* service.cancelAffected({ projectId });
        yield* service.subscribe({ projectId }).pipe(
          Stream.filter((state) => state.schedule?.lastStatus !== "running"),
          Stream.runHead,
        );
        const state = yield* service.snapshot({ projectId });
        assert.isFalse(state.schedule?.configuration.enabled);
        assert.equal(state.schedule?.lastStatus, "interrupted");
        assert.isNull(state.schedule?.nextRunAt);
        assert.isFalse(state.batchRunning);
        assert.isFalse(state.latestRuns.some((run) => run.status === "running"));
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "imports CI reports idempotently without replacing local freshness or a newer CI run",
    () =>
      Effect.gen(function* () {
        const { service, sql, fs, path, root, serviceLayer } = yield* fixture("", [
          { id: "unit", name: "Unit", command: "node run.cjs", inputs: ["run.cjs"] },
        ]);
        const local = yield* service.start({ projectId, suiteId: "unit" });
        yield* completed(service, local.id);
        yield* fs.writeFileString(path.join(root, "run.cjs"), "changed");
        const report: QaCiReport = {
          suiteId: "unit",
          source: {
            type: "ci",
            provider: "GitHub Actions",
            runId: "100:1",
            environment: "ubuntu-latest",
          },
          commit: "a".repeat(40),
          branch: "main",
          startedAt: "2026-01-02T00:00:00.000Z",
          finishedAt: "2026-01-02T00:01:00.000Z",
          exitCode: 0,
          reportXml: "<testsuite><testcase/></testsuite>",
        };
        let allowed = false;
        const routes = HttpApiBuilder.layer(QaTestApi).pipe(
          Layer.provide(QaHttp.layer),
          Layer.provide(Layer.succeed(Qa.QaService, service)),
          Layer.provide(
            Layer.mock(ServerRuntimeStartup.ServerRuntimeStartup)({
              enqueueCommand: (effect) => effect,
            }),
          ),
          Layer.provide(
            Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
              Effect.suspend(() =>
                effect.pipe(
                  Effect.provideService(EnvironmentAuthenticatedPrincipal, {
                    sessionId: AuthSessionId.make("qa-ci"),
                    subject: "ci",
                    method: "bearer-access-token",
                    scopes: new Set(allowed ? ["terminal:operate" as const] : []),
                  }),
                ),
              ),
            ),
          ),
          Layer.provide(HttpPlatform.layer),
          Layer.provide(Etag.layerWeak),
          Layer.provide(NodeServices.layer),
        );
        const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
        yield* Effect.addFinalizer(() => Effect.promise(dispose));
        const request = () =>
          new Request("http://localhost/api/qa/import", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJson({ projectId, report }),
          });
        assert.equal((yield* Effect.promise(() => handler(request()))).status, 403);
        assert.equal((yield* sql`SELECT * FROM qa_ci_imports`).length, 0);
        allowed = true;
        const response = yield* Effect.promise(() => handler(request()));
        assert.equal(response.status, 200);
        const imported = yield* decodeRun(yield* Effect.promise(() => response.json()));
        assert.equal(imported.status, "passed");
        assert.isNull(imported.dirty);
        assert.equal((yield* service.importReport({ projectId, report })).id, imported.id);
        assert.equal(
          (yield* service
            .importReport({ projectId, report: { ...report, exitCode: 1 } })
            .pipe(Effect.flip)).reason,
          "duplicate",
        );
        yield* service.importReport({
          projectId,
          report: {
            ...report,
            source: { ...report.source, runId: "99:1" },
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        });
        const state = yield* service.snapshot({ projectId });
        assert.equal(state.latestRuns[0]?.id, local.id);
        assert.equal(state.latestCiRuns?.[0]?.id, imported.id);
        assert.equal(state.freshness?.[0]?.state, "stale");
        assert.equal((yield* sql`SELECT * FROM qa_ci_imports`).length, 2);
        const restarted = Context.get(yield* Layer.build(Layer.fresh(serviceLayer)), Qa.QaService);
        assert.equal(
          (yield* restarted.details({ projectId, runId: imported.id })).reportXml,
          report.reportXml,
        );
        for (const [xml, exitCode, status] of [
          ["<testsuite><testcase><failure/></testcase></testsuite>", 0, "failed"],
          ["<testsuite><testcase/></testsuite>", 1, "failed"],
          ["<testsuite/>", 0, "incomplete"],
          ["<testsuite><testcase><skipped/></testcase></testsuite>", 0, "incomplete"],
        ] as const) {
          const result = yield* service.importReport({
            projectId,
            report: {
              ...report,
              source: { ...report.source, runId: xml + exitCode },
              reportXml: xml,
              exitCode,
            },
          });
          assert.equal(result.status, status);
        }
        for (const invalid of [
          { reportXml: "<testsuite>" },
          { reportXml: "<!DOCTYPE x><testsuite/>" },
          { reportXml: "x".repeat(2 * 1024 * 1024 + 1) },
          { finishedAt: "2025-01-01T00:00:00.000Z" },
          { finishedAt: "2099-01-01T00:00:00.000Z" },
          { startedAt: "not a timestamp" },
          { finishedAt: "not a timestamp" },
        ])
          assert.equal(
            (yield* service
              .importReport({ projectId, report: { ...report, ...invalid } })
              .pipe(Effect.flip)).reason,
            "report",
          );
        assert.equal(
          (yield* service
            .importReport({ projectId: ProjectId.make("missing"), report })
            .pipe(Effect.flip)).reason,
          "project-not-found",
        );
      }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live(
    "uses CI package impact rules for workspace dependencies and keeps unrelated package edits current",
    () =>
      Effect.gen(function* () {
        const { service, root, fs, path } = yield* fixture("", [
          { id: "unit", name: "Server", command: "node run.cjs", workspacePackage: "t3" },
        ]);
        yield* fs.writeFileString(
          path.join(root, "package.json"),
          encodeJson({ name: "@t3tools/monorepo" }),
        );
        yield* fs.writeFileString(
          path.join(root, "pnpm-workspace.yaml"),
          "packages:\n  - apps/*\n  - packages/*\n",
        );
        for (const [dir, name, deps] of [
          [
            "apps/server",
            "t3",
            { "@t3tools/contracts": "workspace:*", "@t3tools/web": "workspace:*" },
          ],
          ["apps/web", "@t3tools/web", { "@t3tools/contracts": "workspace:*" }],
          ["packages/contracts", "@t3tools/contracts", {}],
        ] as const) {
          yield* fs.makeDirectory(path.join(root, dir), { recursive: true });
          yield* fs.writeFileString(
            path.join(root, dir, "package.json"),
            encodeJson({ name, dependencies: deps }),
          );
          yield* fs.writeFileString(path.join(root, dir, "code.ts"), "original");
        }
        const run = yield* service.start({ projectId, suiteId: "unit" });
        yield* completed(service, run.id);
        assert.equal((yield* service.snapshot({ projectId })).freshness?.[0]?.state, "current");
        yield* fs.writeFileString(path.join(root, "apps/web/code.ts"), "unrelated web change");
        assert.equal((yield* service.snapshot({ projectId })).freshness?.[0]?.state, "current");
        yield* fs.writeFileString(
          path.join(root, "packages/contracts/code.ts"),
          "shared contract change",
        );
        assert.deepEqual((yield* service.snapshot({ projectId })).freshness?.[0]?.changedPaths, [
          "packages/contracts/code.ts",
        ]);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live(
    "tracks content, additions, deletions, shared lockfiles and configuration while ignoring unrelated edits",
    () =>
      Effect.gen(function* () {
        const tracked = {
          id: "unit",
          name: "Unit",
          command: "node run.cjs",
          inputs: ["src", "run.cjs"],
        };
        const { service, root, fs, path, git, sql, serviceLayer } = yield* fixture("", [tracked]);
        yield* fs.makeDirectory(path.join(root, "src"));
        yield* fs.writeFileString(path.join(root, "src/api.ts"), "original");
        yield* fs.writeFileString(path.join(root, ".gitignore"), "src/.generated/\n.env.local\n");
        yield* fs.makeDirectory(path.join(root, "src/.generated"));
        yield* fs.writeFileString(path.join(root, "src/.generated/types.ts"), "original");
        yield* fs.writeFileString(path.join(root, ".env.local"), "FIXTURE=original");
        yield* git(["add", "."]);
        yield* git([
          "-c",
          "user.name=QA",
          "-c",
          "user.email=qa@example.test",
          "commit",
          "-qm",
          "fixture",
        ]);
        const run = yield* service.start({ projectId, suiteId: "unit" });
        yield* completed(service, run.id);
        const check = Effect.fn("Qa.test.freshness")(function* () {
          return (yield* service.snapshot({ projectId })).freshness?.[0];
        });
        assert.equal((yield* check())?.state, "current");
        assert.isFalse((yield* check())?.needsRun);
        assert.isNotNull((yield* check())?.lastPassedAt);
        yield* fs.writeFileString(path.join(root, "README.md"), "unrelated");
        assert.equal((yield* check())?.state, "current");
        for (const [input, original] of [
          ["src/.generated/types.ts", "original"],
          [".env.local", "FIXTURE=original"],
        ] as const) {
          yield* fs.writeFileString(path.join(root, input), "changed");
          assert.deepEqual((yield* check())?.changedPaths, [input]);
          yield* fs.writeFileString(path.join(root, input), original);
          assert.equal((yield* check())?.state, "current");
        }
        for (const staged of [false, true]) {
          yield* fs.writeFileString(path.join(root, "src/api.ts"), "changed");
          if (staged) yield* git(["add", "."]);
          assert.deepEqual((yield* check())?.changedPaths, ["src/api.ts"]);
          yield* fs.writeFileString(path.join(root, "src/api.ts"), "original");
          assert.equal((yield* check())?.state, "current");
        }
        const added = "src/new\nname.ts";
        yield* fs.writeFileString(path.join(root, added), "new");
        assert.deepEqual((yield* check())?.changedPaths, [added]);
        yield* fs.remove(path.join(root, added));
        yield* fs.remove(path.join(root, "src/api.ts"));
        assert.deepEqual((yield* check())?.changedPaths, ["src/api.ts"]);
        yield* fs.writeFileString(path.join(root, "src/api.ts"), "original");
        yield* fs.writeFileString(path.join(root, "yarn.lock"), "dependencies changed");
        assert.deepEqual((yield* check())?.changedPaths, ["yarn.lock"]);
        yield* fs.remove(path.join(root, "yarn.lock"));
        yield* fs.writeFileString(
          path.join(root, "t3.json"),
          encodeJson({ qa: { suites: [{ ...tracked, name: "New label" }] } }),
        );
        assert.equal((yield* check())?.state, "current");
        yield* fs.writeFileString(
          path.join(root, "t3.json"),
          encodeJson({ qa: { suites: [{ ...tracked, command: "node --no-warnings run.cjs" }] } }),
        );
        assert.include((yield* check())?.reason ?? "", "configuration changed");
        yield* fs.writeFileString(
          path.join(root, "t3.json"),
          encodeJson({ qa: { suites: [tracked] } }),
        );
        const restarted = Context.get(yield* Layer.build(Layer.fresh(serviceLayer)), Qa.QaService);
        assert.equal((yield* restarted.snapshot({ projectId })).freshness?.[0]?.state, "current");
        yield* sql`DELETE FROM qa_run_inputs WHERE run_id = ${run.id}`;
        assert.equal((yield* check())?.state, "unknown");
        assert.isTrue((yield* check())?.needsRun);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("keeps results visible when inputs changed during execution or a run has expired", () =>
    Effect.gen(function* () {
      const tracked = {
        id: "unit",
        name: "Unit",
        command: "node run.cjs",
        inputs: ["run.cjs", "src"],
      };
      const { service, root, fs, path, sql } = yield* fixture(
        "require('node:fs').writeFileSync('src/value', 'changed');",
        [tracked],
      );
      yield* fs.makeDirectory(path.join(root, "src"));
      yield* fs.writeFileString(path.join(root, "src/value"), "original");
      const run = yield* service.start({ projectId, suiteId: "unit" });
      assert.equal((yield* completed(service, run.id)).run.status, "passed");
      assert.equal((yield* service.snapshot({ projectId })).freshness?.[0]?.state, "stale");
      yield* fs.writeFileString(path.join(root, "src/value"), "original");
      assert.include(
        (yield* service.snapshot({ projectId })).freshness?.[0]?.reason ?? "",
        "during this run",
      );
      yield* fs.writeFileString(path.join(root, "run.cjs"), "");
      const next = yield* service.start({ projectId, suiteId: "unit" });
      yield* completed(service, next.id);
      yield* fs.writeFileString(
        path.join(root, "t3.json"),
        encodeJson({ qa: { suites: [{ ...tracked, maxAgeHours: 24 }] } }),
      );
      yield* sql`UPDATE qa_runs SET run_json = json_set(run_json, '$.startedAt', '2020-01-01T00:00:00.000Z') WHERE id = ${next.id}`;
      assert.include(
        (yield* service.snapshot({ projectId })).freshness?.[0]?.reason ?? "",
        "24-hour",
      );
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "requires explicit environment evidence for device suites and detects target changes",
    () =>
      Effect.gen(function* () {
        const device: QaSuite = {
          id: "unit",
          name: "Device",
          kind: "maestro",
          command: "node run.cjs",
          inputs: ["run.cjs"],
        };
        const { service, root, fs, path } = yield* fixture("", [device]);
        const run = yield* service.start({ projectId, suiteId: "unit" });
        yield* completed(service, run.id);
        assert.include(
          (yield* service.snapshot({ projectId })).freshness?.[0]?.reason ?? "",
          "identity is unknown",
        );
        yield* fs.writeFileString(path.join(root, ".gitignore"), "target.txt\n");
        yield* fs.writeFileString(path.join(root, "target.txt"), "installed build 1");
        yield* fs.writeFileString(
          path.join(root, "t3.json"),
          encodeJson({ qa: { suites: [{ ...device, environmentFile: "target.txt" }] } }),
        );
        const next = yield* service.start({ projectId, suiteId: "unit" });
        yield* completed(service, next.id);
        assert.equal((yield* service.snapshot({ projectId })).freshness?.[0]?.state, "current");
        yield* fs.writeFileString(path.join(root, "target.txt"), "installed build 2");
        assert.deepEqual((yield* service.snapshot({ projectId })).freshness?.[0]?.changedPaths, [
          "target.txt",
        ]);
        yield* fs.remove(path.join(root, "target.txt"));
        assert.equal((yield* service.snapshot({ projectId })).freshness?.[0]?.state, "unknown");
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "runs affected suites sequentially on the server and includes failures without rerunning current passes",
    () =>
      Effect.gen(function* () {
        const suites = ["current", "failed", "never"].map((id) => ({
          id,
          name: id,
          command: `node run.cjs ${id}`,
          inputs: ["run.cjs"],
        }));
        const { service, fs, path, root, sql } = yield* fixture(
          "const fs = require('node:fs'); fs.mkdirSync('exclusive'); fs.appendFileSync('order.txt', process.argv[2] + '\\n'); fs.rmdirSync('exclusive');",
          suites,
        );
        for (const suite of suites.slice(0, 2)) {
          const run = yield* service.start({ projectId, suiteId: suite.id });
          yield* completed(service, run.id);
          if (suite.id === "failed")
            yield* sql`UPDATE qa_runs SET status = 'failed', run_json = json_set(run_json, '$.status', 'failed') WHERE id = ${run.id}`;
        }
        yield* fs.writeFileString(path.join(root, "order.txt"), "");
        assert.deepEqual(yield* service.startAffected({ projectId }), ["failed", "never"]);
        const done = yield* service.subscribe({ projectId }).pipe(
          Stream.filter((value) => !value.batchRunning),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(done));
        assert.equal(yield* fs.readFileString(path.join(root, "order.txt")), "failed\nnever\n");
        assert.deepEqual(yield* service.startAffected({ projectId }), []);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live(
    "executes the configured command, captures its report, and retains history after rebuilding the service",
    () =>
      Effect.gen(function* () {
        const xml =
          '<testsuites><testsuite><testcase name="works"/><testcase name="later"><skipped/></testcase></testsuite></testsuites>';
        const { service, serviceLayer, sql } = yield* fixture(
          `require('node:fs').writeFileSync(process.env.T3_QA_REPORT_PATH, ${encodeJson(xml)}); console.log('suite finished');`,
        );
        const run = yield* service.start({ projectId, suiteId: "unit" });
        const result = yield* completed(service, run.id);
        assert.deepEqual((yield* service.snapshot({ projectId })).suites, [suite]);
        assert.deepEqual(result.run.suite, suite);
        assert.equal(result.run.status, "passed");
        assert.equal(result.run.exitCode, 0);
        assert.deepEqual(result.run.summary, { tests: 2, failures: 0, skipped: 1 });
        assert.include(result.output, "suite finished");
        assert.equal(result.reportXml, xml);
        assert.isNotNull(result.run.finishedAt);
        const restarted = Context.get(yield* Layer.build(Layer.fresh(serviceLayer)), Qa.QaService);
        assert.deepEqual(yield* restarted.details({ projectId, runId: run.id }), result);
        assert.equal((yield* restarted.snapshot({ projectId })).latestRuns[0]?.id, run.id);
        assert.equal((yield* sql`SELECT id FROM qa_runs`).length, 1);
        const tests = yield* restarted.tests({ projectId, runId: run.id });
        assert.deepEqual(
          tests.tests.map((test) => [test.name, test.status]),
          [
            ["works", "passed"],
            ["later", "skipped"],
          ],
        );
        assert.equal(tests.total, 2);
        assert.isNull(tests.unavailableReason);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("keeps failing, missing, empty, and skipped reports from becoming passes", () =>
    Effect.gen(function* () {
      const { service, fs, path, root } = yield* fixture("");
      for (const [xml, exitCode, expected] of [
        ["<testsuite><testcase><failure/></testcase></testsuite>", 0, "failed"],
        ["<testsuite><testcase/></testsuite>", 1, "failed"],
        [null, 1, "failed"],
        [null, 0, "incomplete"],
        ["<testsuite/>", 0, "incomplete"],
        ["<testsuite><testcase><skipped/></testcase></testsuite>", 0, "incomplete"],
        ["<testsuite>", 0, "incomplete"],
      ] as const) {
        yield* fs.writeFileString(
          path.join(root, "run.cjs"),
          `${xml === null ? "" : `require('node:fs').writeFileSync(process.env.T3_QA_REPORT_PATH, ${encodeJson(xml)});`} console.error('Cannot connect to the Docker daemon'); process.exitCode = ${exitCode};`,
        );
        const run = yield* service.start({ projectId, suiteId: "unit" });
        const result = yield* completed(service, run.id);
        assert.equal(result.run.status, expected);
        assert.include(result.run.outputTail ?? "", "Cannot connect to the Docker daemon");
        const snapshot = yield* service.snapshot({ projectId });
        assert.equal(snapshot.latestRuns[0]?.outputTail, result.run.outputTail);
        assert.equal(snapshot.recentRuns[0]?.outputTail, result.run.outputTail);
        if (!result.reportXml) {
          const tests = yield* service.tests({ projectId, runId: run.id });
          assert.isEmpty(tests.tests);
          assert.isNotNull(tests.unavailableReason);
        }
      }
      assert.equal((yield* service.snapshot({ projectId })).recentRuns.length, 7);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "pages and filters stored test cases without losing duplicate names or crossing projects",
    () =>
      Effect.gen(function* () {
        const { service, sql } = yield* fixture("");
        const reportXml = `<testsuite name="Backend" file="auth.test.ts">${Array.from(
          { length: 127 },
          (_, index) =>
            `<testcase name="${index < 2 ? "same name" : `checks user ${index}`}" time="0.01">${index === 7 ? '<failure message="expected 401">token was accepted</failure>' : index === 3 ? '<skipped message="requires device"/>' : ""}</testcase>`,
        ).join("")}</testsuite>`;
        const run = yield* service.importReport({
          projectId,
          report: {
            suiteId: "unit",
            source: { type: "ci", provider: "CI", runId: "individual-tests", environment: "linux" },
            commit: "a".repeat(40),
            branch: "main",
            startedAt: "2026-01-01T09:00:00.000Z",
            finishedAt: "2026-01-01T09:01:00.000Z",
            exitCode: 1,
            reportXml,
          },
        });
        const first = yield* service.tests({ projectId, runId: run.id });
        assert.equal(first.total, 127);
        assert.equal(first.matched, 127);
        assert.lengthOf(first.tests, 50);
        assert.equal(first.nextOffset, 50);
        assert.deepEqual(
          first.tests.slice(0, 2).map((test) => [test.id, test.name]),
          [
            [0, "same name"],
            [1, "same name"],
          ],
        );
        const middle = yield* service.tests({ projectId, runId: run.id, offset: 50 });
        assert.lengthOf(middle.tests, 50);
        assert.equal(middle.tests[0]?.id, 50);
        const last = yield* service.tests({ projectId, runId: run.id, offset: 100 });
        assert.lengthOf(last.tests, 27);
        assert.isNull(last.nextOffset);
        const failed = yield* service.tests({
          projectId,
          runId: run.id,
          status: "failed",
          search: "BACKEND auth.test.ts",
        });
        assert.equal(failed.matched, 1);
        assert.equal(failed.tests[0]?.name, "checks user 7");
        assert.include(failed.tests[0]?.details ?? "", "token was accepted");
        assert.isNull(failed.nextOffset);
        assert.equal(
          (yield* service.tests({ projectId, runId: run.id, status: "skipped" })).matched,
          1,
        );
        assert.equal(
          (yield* service.tests({ projectId, runId: run.id, search: "not in report" })).matched,
          0,
        );
        assert.equal(
          (yield* service
            .tests({ projectId: ProjectId.make("another"), runId: run.id })
            .pipe(Effect.flip)).reason,
          "run-not-found",
        );
        yield* sql`UPDATE qa_runs SET report_xml = '<testsuite><testcase/></testsuite>broken' WHERE id = ${run.id}`;
        const corrupt = yield* service.tests({ projectId, runId: run.id });
        assert.isEmpty(corrupt.tests);
        assert.isNotNull(corrupt.unavailableReason);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("retains the launch error when the shell cannot start", () =>
    Effect.gen(function* () {
      const {
        service: original,
        serviceLayer,
        fs,
        path,
        root,
      } = yield* fixture(
        "",
        [{ id: "unit", name: "Unit", command: "node run.cjs", inputs: ["run.cjs"] }],
        { sharedResults: true },
      );
      const passed = yield* original.start({ projectId, suiteId: "unit" });
      yield* completed(original, passed.id);
      const filename = path.join(root, "t3.qa-results/unit.json");
      const contents = yield* fs.readFileString(filename);
      const context = yield* Layer.build(
        Layer.fresh(serviceLayer).pipe(
          Layer.provide(Layer.succeed(HostProcess.Environment, { SHELL: "/t3-qa-missing-shell" })),
        ),
      );
      const service = Context.get(context, Qa.QaService);
      const run = yield* service.start({ projectId, suiteId: "unit" });
      const result = yield* completed(service, run.id);
      assert.equal(result.run.status, "incomplete");
      assert.include(result.output, "/t3-qa-missing-shell");
      assert.include(result.run.outputTail ?? "", "/t3-qa-missing-shell");
      assert.equal(yield* fs.readFileString(filename), contents);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("bounds noisy command output and supports commands without reports", () =>
    Effect.gen(function* () {
      const { service, sql, git } = yield* fixture(
        "console.log('x'.repeat(200000) + '\\n\\x1b[31mError: unsupported Node version\\x1b[0m');",
        [{ id: "unit", name: "Unit tests", command: "node run.cjs" }],
        { sharedResults: true },
      );
      yield* git(["add", "."]);
      yield* git([
        "-c",
        "user.name=QA",
        "-c",
        "user.email=qa@example.test",
        "commit",
        "-qm",
        "fixture",
      ]);
      const run = yield* service.start({ projectId, suiteId: "unit" });
      const result = yield* completed(service, run.id);
      assert.equal(result.run.status, "passed");
      assert.isNull(result.run.summary);
      assert.isTrue(result.outputTruncated);
      assert.isAtMost(result.output.length, 128 * 1024);
      assert.isUndefined(result.run.outputTail);
      assert.isFalse(result.run.dirty);
      // Older runs store only the captured output, without a dashboard excerpt.
      yield* sql`UPDATE qa_runs SET status = 'failed', run_json = json_set(run_json, '$.status', 'failed', '$.exitCode', 1) WHERE id = ${run.id}`;
      const snapshot = yield* service.snapshot({ projectId });
      const failed = yield* service.details({ projectId, runId: run.id });
      assert.isAtMost(snapshot.latestRuns[0]!.outputTail!.length, 2000);
      assert.include(snapshot.latestRuns[0]?.outputTail ?? "", "Error: unsupported Node version");
      assert.notInclude(snapshot.latestRuns[0]?.outputTail ?? "", "\u001b");
      assert.equal(snapshot.latestRuns[0]?.outputTail, failed.run.outputTail);
      assert.equal(snapshot.recentRuns[0]?.outputTail, failed.run.outputTail);
      const repeated = yield* service.start({ projectId, suiteId: "unit" });
      assert.isFalse((yield* completed(service, repeated.id)).run.dirty);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "rejects overlapping starts and wrong-project cancellation, then releases the project after cancellation",
    () =>
      Effect.gen(function* () {
        const { serviceLayer } = yield* fixture(
          "require('node:net').createServer().listen(0, '127.0.0.1', () => console.log('ready'));",
          [suite, { id: "later", name: "Later", command: "node -e 'process.exit(0)'" }],
        );
        const started = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>();
        const actualSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const spawner = ChildProcessSpawner.make((command) =>
          actualSpawner.spawn(command).pipe(
            Effect.map((handle) =>
              ChildProcessSpawner.makeHandle({
                ...handle,
                stdout: handle.stdout.pipe(Stream.tap(() => Deferred.succeed(started, handle))),
              }),
            ),
          ),
        );
        const context = yield* Layer.build(
          Layer.fresh(
            serviceLayer.pipe(
              Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
            ),
          ),
        );
        const service = Context.get(context, Qa.QaService);
        const run = yield* service.start({ projectId, suiteId: "unit" });
        const child = yield* Deferred.await(started);
        assert.equal(
          (yield* service.start({ projectId, suiteId: "unit" }).pipe(Effect.flip)).reason,
          "busy",
        );
        assert.equal(
          (yield* service.startAffected({ projectId }).pipe(Effect.flip)).reason,
          "busy",
        );
        assert.equal(
          (yield* service
            .cancel({ projectId: ProjectId.make("another"), runId: run.id })
            .pipe(Effect.flip)).reason,
          "run-not-found",
        );
        yield* service.cancel({ projectId, runId: run.id });
        assert.isFalse(yield* child.isRunning);
        assert.equal(
          (yield* service.details({ projectId, runId: run.id })).run.status,
          "cancelled",
        );
        const next = yield* service.start({ projectId, suiteId: "unit" });
        assert.notEqual(next.id, run.id);
        yield* service.cancel({ projectId, runId: next.id });
        assert.deepEqual(yield* service.startAffected({ projectId }), ["unit", "later"]);
        yield* service.subscribe({ projectId }).pipe(
          Stream.filter(
            (value) =>
              value.queuedSuiteIds?.length === 1 &&
              value.latestRuns.some((run) => run.status === "running"),
          ),
          Stream.runHead,
        );
        yield* service.cancelAffected({ projectId });
        const stopped = yield* service.snapshot({ projectId });
        assert.isFalse(stopped.batchRunning);
        assert.deepEqual(stopped.queuedSuiteIds, []);
        assert.isFalse(
          stopped.latestRuns.some((run) => run.status === "running" || run.suite.id === "later"),
        );
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live(
    "recovers orphaned running records and validates catalog and working-directory boundaries",
    () =>
      Effect.gen(function* () {
        const { service, serviceLayer, fs, path, root, sql } = yield* fixture("");
        const orphan = QaRun.make({
          id: "orphan",
          projectId,
          suite,
          cwd: root,
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: null,
          status: "running",
          exitCode: null,
          commit: null,
          branch: null,
          dirty: null,
          summary: null,
          note: null,
        });
        yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json)
      VALUES ('orphan', ${projectId}, 'unit', ${orphan.startedAt}, 'running', ${encodeJson(orphan)})`;
        const recovered = Context.get(yield* Layer.build(Layer.fresh(serviceLayer)), Qa.QaService);
        assert.equal(
          (yield* recovered.details({ projectId, runId: "orphan" })).run.status,
          "interrupted",
        );
        yield* fs.writeFileString(
          path.join(root, "t3.json"),
          encodeJson({ qa: { suites: [suite, suite] } }),
        );
        assert.isNotNull((yield* service.snapshot({ projectId })).configurationError);
        assert.equal(
          (yield* service.start({ projectId, suiteId: "unit" }).pipe(Effect.flip)).reason,
          "configuration",
        );
        yield* fs.writeFileString(
          path.join(root, "t3.json"),
          encodeJson({ qa: { suites: [{ ...suite, cwd: ".." }] } }),
        );
        assert.equal(
          (yield* service.start({ projectId, suiteId: "unit" }).pipe(Effect.flip)).reason,
          "workspace",
        );
        assert.equal(
          (yield* service.start({ projectId, suiteId: "removed" }).pipe(Effect.flip)).reason,
          "suite-not-found",
        );
        yield* fs.remove(path.join(root, "t3.json"));
        assert.deepEqual((yield* service.snapshot({ projectId })).suites, []);
        assert.equal((yield* service.snapshot({ projectId })).recentRuns.length, 1);
      }).pipe(Effect.provide(layer), Effect.scoped),
  );
});
