import {
  QaError,
  QaConfiguration,
  QaRun,
  type QaProjectInput,
  type QaStartInput,
  type QaRunInput,
  type QaRunDetails,
  type QaSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { parseJunitReport } from "./junit.ts";

const MAX_OUTPUT = 128 * 1024;
const MAX_REPORT = 2 * 1024 * 1024;
const decodeConfig = Schema.decodeEffect(
  fromLenientJson(Schema.Struct({ qa: Schema.optionalKey(QaConfiguration) })),
);
const decodeRun = Schema.decodeEffect(Schema.fromJsonString(QaRun));
const encodeRun = Schema.encodeEffect(Schema.fromJsonString(QaRun));
const isQaError = Schema.is(QaError);
const storageError = (cause: unknown) =>
  isQaError(cause) ? cause : new QaError({ reason: "storage", cause });

export class QaService extends Context.Service<
  QaService,
  {
    readonly snapshot: (input: QaProjectInput) => Effect.Effect<QaSnapshot, QaError>;
    readonly subscribe: (input: QaProjectInput) => Stream.Stream<QaSnapshot, QaError>;
    readonly start: (input: QaStartInput) => Effect.Effect<QaRun, QaError>;
    readonly cancel: (input: QaRunInput) => Effect.Effect<void, QaError>;
    readonly details: (input: QaRunInput) => Effect.Effect<QaRunDetails, QaError>;
  }
>()("t3/qa/QaService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const processes = yield* ProcessRunner.ProcessRunner;
  const crypto = yield* Crypto.Crypto;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const scope = yield* Effect.scope;
  const updates = yield* PubSub.sliding<string>(128);
  const lock = yield* Semaphore.make(1);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const active = new Map<
    string,
    {
      details: QaRunDetails;
      cancelled: boolean;
      fiber?: Fiber.Fiber<void, QaError>;
    }
  >();

  const recoveredAt = yield* now;
  yield* sql`UPDATE qa_runs SET status = 'interrupted', run_json = json_set(run_json,
    '$.status', 'interrupted', '$.finishedAt', ${recoveredAt}, '$.note', 'The server stopped before this run finished.')
    WHERE status = 'running'`.pipe(Effect.mapError(storageError));

  const workspace = Effect.fn("QaService.workspace")(function* (input: QaProjectInput) {
    const project = yield* projects.get(input.projectId);
    if (Option.isNone(project) || project.value.deletedAt !== null)
      return yield* new QaError({ reason: "project-not-found" });
    return yield* fs
      .realPath(project.value.workspaceRoot)
      .pipe(Effect.mapError((cause) => new QaError({ reason: "workspace", cause })));
  }, Effect.mapError(storageError));

  const catalog = Effect.fn("QaService.catalog")(
    function* (root: string) {
      const contents = yield* fs.readFileString(path.join(root, "t3.json")).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
        }),
      );
      return (yield* decodeConfig(contents)).qa?.suites ?? [];
    },
    Effect.mapError((cause) => new QaError({ reason: "configuration", cause })),
  );

  const snapshot = Effect.fn("QaService.snapshot")(function* (input: QaProjectInput) {
    const root = yield* workspace(input);
    const config = yield* catalog(root).pipe(Effect.result);
    const latest = yield* sql<{ run_json: string }>`SELECT run_json FROM (
      SELECT run_json, ROW_NUMBER() OVER (PARTITION BY suite_id ORDER BY started_at DESC, rowid DESC) AS ordinal
      FROM qa_runs WHERE project_id = ${input.projectId}
    ) WHERE ordinal = 1 ORDER BY json_extract(run_json, '$.startedAt') DESC LIMIT 200`;
    const recent = yield* sql<{ run_json: string }>`SELECT run_json FROM qa_runs
      WHERE project_id = ${input.projectId} ORDER BY started_at DESC, rowid DESC LIMIT 50`;
    return {
      workspaceRoot: root,
      configurationError: config._tag === "Failure" ? config.failure.message : null,
      suites: config._tag === "Success" ? config.success : [],
      latestRuns: yield* Effect.forEach(latest, (row) => decodeRun(row.run_json)),
      recentRuns: yield* Effect.forEach(recent, (row) => decodeRun(row.run_json)),
    };
  }, Effect.mapError(storageError));

  const details = Effect.fn("QaService.details")(function* (input: QaRunInput) {
    const live = active.get(input.runId)?.details;
    if (live?.run.projectId === input.projectId) return { ...live };
    const rows = yield* sql<{
      run_json: string;
      output: string;
      output_truncated: number;
      report_xml: string | null;
    }>`
      SELECT run_json, output, output_truncated, report_xml FROM qa_runs WHERE id = ${input.runId} AND project_id = ${input.projectId}`;
    if (!rows[0]) return yield* new QaError({ reason: "run-not-found" });
    return {
      run: yield* decodeRun(rows[0].run_json),
      output: rows[0].output,
      outputTruncated: rows[0].output_truncated !== 0,
      reportXml: rows[0].report_xml,
    };
  }, Effect.mapError(storageError));

  const save = Effect.fn("QaService.save")(function* (value: QaRunDetails) {
    yield* sql`UPDATE qa_runs SET status = ${value.run.status}, run_json = ${yield* encodeRun(value.run)},
      output = ${value.output}, output_truncated = ${Number(value.outputTruncated)}, report_xml = ${value.reportXml}
      WHERE id = ${value.run.id}`;
  }, Effect.mapError(storageError));

  const git = Effect.fn("QaService.git")(
    function* (cwd: string, args: readonly string[]) {
      const result = yield* processes.run({
        command: "git",
        args,
        cwd,
        timeout: "10 seconds",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      });
      return result.code === 0 ? result.stdout.trim() : null;
    },
    Effect.orElseSucceed(() => null),
  );

  const execute = Effect.fn("QaService.execute")(
    function* (entry: NonNullable<ReturnType<typeof active.get>>) {
      const run = entry.details.run;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-qa-" });
      const reportPath = path.join(directory, "report.xml");
      const child = yield* spawner.spawn(
        ChildProcess.make(
          platform === "win32" ? run.suite.command : environment.SHELL || "/bin/sh",
          platform === "win32" ? [] : ["-lc", run.suite.command],
          {
            cwd: run.cwd,
            shell: platform === "win32",
            stdin: "ignore",
            env: { T3_QA_REPORT_PATH: reportPath, CI: "1", FORCE_COLOR: "0" },
            extendEnv: true,
            forceKillAfter: "2 seconds",
          },
        ),
      );
      // Output chunks share the run's span and stay bounded even when a runner is noisy.
      const collect = (stream: typeof child.stdout) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => {
              const output = entry.details.output + chunk;
              entry.details = {
                ...entry.details,
                output: output.slice(-MAX_OUTPUT),
                outputTruncated: entry.details.outputTruncated || output.length > MAX_OUTPUT,
              };
            }),
          ),
        );
      const [exitCode] = yield* Effect.all(
        [child.exitCode, collect(child.stdout), collect(child.stderr)],
        { concurrency: "unbounded" },
      );
      let status: QaRun["status"] = exitCode === 0 ? "passed" : "failed";
      let summary: QaRun["summary"] = null;
      let note: string | null = null;
      let reportXml: string | null = null;
      if (run.suite.report === "junit") {
        const report = yield* Effect.gen(function* () {
          const info = yield* fs.stat(reportPath);
          if (info.size > MAX_REPORT) return yield* new QaError({ reason: "configuration" });
          const xml = yield* fs.readFileString(reportPath);
          const counts = yield* Effect.try(() => parseJunitReport(xml));
          return { xml, counts };
        }).pipe(Effect.result);
        if (report._tag === "Success") {
          reportXml = report.success.xml;
          summary = report.success.counts;
          if (summary.failures > 0) status = "failed";
          else if (summary.tests === 0 || summary.tests === summary.skipped) {
            if (status === "passed") status = "incomplete";
            note = "The report contains no executed tests.";
          }
        } else {
          if (status === "passed") status = "incomplete";
          note =
            "No valid JUnit report was produced. Write the report to T3_QA_REPORT_PATH (maximum 2 MiB).";
        }
      }
      entry.details = {
        ...entry.details,
        reportXml,
        run: { ...run, exitCode, status, summary, note },
      };
    },
    Effect.scoped,
    (effect, entry) =>
      effect.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit)) {
              entry.details = {
                ...entry.details,
                run: {
                  ...entry.details.run,
                  status: entry.cancelled
                    ? "cancelled"
                    : Exit.hasInterrupts(exit)
                      ? "interrupted"
                      : "incomplete",
                  note: entry.cancelled
                    ? "Cancelled by the user."
                    : "The command did not finish. Check the output and the execution environment.",
                },
              };
            }
            entry.details = {
              ...entry.details,
              run: { ...entry.details.run, finishedAt: yield* now },
            };
            yield* save(entry.details).pipe(
              Effect.ensuring(Effect.sync(() => active.delete(entry.details.run.id))),
              Effect.ensuring(PubSub.publish(updates, entry.details.run.projectId)),
            );
          }),
        ),
        Effect.mapError(storageError),
      ),
  );

  const start = Effect.fn("QaService.start")(
    function* (input: QaStartInput) {
      const root = yield* workspace(input);
      const suite = (yield* catalog(root)).find((candidate) => candidate.id === input.suiteId);
      if (!suite) return yield* new QaError({ reason: "suite-not-found" });
      if ([...active.values()].some((entry) => entry.details.run.projectId === input.projectId))
        return yield* new QaError({ reason: "busy" });
      const cwd = yield* fs
        .realPath(path.resolve(root, suite.cwd ?? "."))
        .pipe(Effect.mapError((cause) => new QaError({ reason: "workspace", cause })));
      const relative = path.relative(root, cwd);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return yield* new QaError({ reason: "workspace" });
      const [commit, branch, changes] = yield* Effect.all(
        [
          git(root, ["rev-parse", "HEAD"]),
          git(root, ["branch", "--show-current"]),
          git(root, ["status", "--porcelain"]),
        ],
        { concurrency: "unbounded" },
      );
      const run: QaRun = {
        id: yield* crypto.randomUUIDv4(),
        projectId: input.projectId,
        suite,
        cwd,
        startedAt: yield* now,
        finishedAt: null,
        status: "running",
        exitCode: null,
        commit,
        branch: branch || null,
        dirty: changes === null ? null : changes.length > 0,
        summary: null,
        note: null,
      };
      yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json)
      VALUES (${run.id}, ${run.projectId}, ${suite.id}, ${run.startedAt}, 'running', ${yield* encodeRun(run)})`;
      const entry: NonNullable<ReturnType<typeof active.get>> = {
        details: { run, output: "", outputTruncated: false, reportXml: null },
        cancelled: false,
      };
      active.set(run.id, entry);
      entry.fiber = yield* execute(entry).pipe(Effect.interruptible, Effect.forkIn(scope));
      yield* PubSub.publish(updates, input.projectId);
      return run;
    },
    lock.withPermit,
    Effect.uninterruptible,
    Effect.mapError(storageError),
  );

  const cancel = Effect.fn("QaService.cancel")(function* (input: QaRunInput) {
    yield* details(input);
    const entry = active.get(input.runId);
    if (!entry?.fiber || entry.details.run.projectId !== input.projectId) return;
    entry.cancelled = true;
    yield* Fiber.interrupt(entry.fiber);
  });

  return QaService.of({
    snapshot,
    start,
    cancel,
    details,
    subscribe: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const queue = yield* PubSub.subscribe(updates);
          return Stream.concat(
            Stream.fromEffect(snapshot(input)),
            Stream.fromSubscription(queue).pipe(
              Stream.filter((projectId) => projectId === input.projectId),
              Stream.mapEffect(() => snapshot(input)),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(QaService, make);
