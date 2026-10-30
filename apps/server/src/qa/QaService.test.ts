import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, QaRun, type QaSuite } from "@t3tools/contracts";
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

const projectId = ProjectId.make("qa-test");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
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
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM qa_runs`;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-qa-test-" });
  const processes = yield* ProcessRunner.ProcessRunner;
  const git = (args: readonly string[]) => processes.run({ command: "git", args, cwd: root });
  yield* git(["init", "-q"]);
  yield* fs.writeFileString(path.join(root, "t3.json"), encodeJson({ qa: { suites } }));
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
  const serviceLayer = Qa.layer.pipe(Layer.provide(projectLayer));
  const context = yield* Layer.build(Layer.fresh(serviceLayer));
  return { service: Context.get(context, Qa.QaService), serviceLayer, root, fs, path, sql, git };
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
      }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("keeps failing, missing, empty, and skipped reports from becoming passes", () =>
    Effect.gen(function* () {
      const { service, fs, path, root } = yield* fixture("");
      for (const [xml, exitCode, expected] of [
        ["<testsuite><testcase><failure/></testcase></testsuite>", 0, "failed"],
        ["<testsuite><testcase/></testsuite>", 1, "failed"],
        [null, 0, "incomplete"],
        ["<testsuite/>", 0, "incomplete"],
        ["<testsuite><testcase><skipped/></testcase></testsuite>", 0, "incomplete"],
        ["<testsuite>", 0, "incomplete"],
      ] as const) {
        yield* fs.writeFileString(
          path.join(root, "run.cjs"),
          `${xml === null ? "" : `require('node:fs').writeFileSync(process.env.T3_QA_REPORT_PATH, ${encodeJson(xml)});`} process.exitCode = ${exitCode};`,
        );
        const run = yield* service.start({ projectId, suiteId: "unit" });
        const result = yield* completed(service, run.id);
        assert.equal(result.run.status, expected);
      }
      assert.equal((yield* service.snapshot({ projectId })).recentRuns.length, 6);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("bounds noisy command output and supports commands without reports", () =>
    Effect.gen(function* () {
      const { service } = yield* fixture(
        "console.log('x'.repeat(200000)); console.error('done');",
        [{ id: "unit", name: "Unit tests", command: "node run.cjs" }],
      );
      const run = yield* service.start({ projectId, suiteId: "unit" });
      const result = yield* completed(service, run.id);
      assert.equal(result.run.status, "passed");
      assert.isNull(result.run.summary);
      assert.isTrue(result.outputTruncated);
      assert.isAtMost(result.output.length, 128 * 1024);
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
