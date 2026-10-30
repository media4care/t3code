import {
  QaError,
  QaConfiguration,
  QaRun,
  QaSchedule,
  QA_TEST_PAGE_SIZE,
  ProjectId,
  type QaSetScheduleInput,
  type QaImportInput,
  type QaProjectInput,
  type QaStartInput,
  type QaRunInput,
  type QaRunDetails,
  type QaSnapshot,
  type QaTestsInput,
  type QaTestResults,
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
import { InputEvidence, makeInputCapture, assessFreshness, changedInputs } from "./inputs.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import {
  nextScheduledRunAt,
  isMissedFixedTimeRun,
  isSameSchedule,
} from "../scheduledTasks/Schedule.ts";

const MAX_OUTPUT = 128 * 1024;
const MAX_REPORT = 2 * 1024 * 1024;
const decodeConfig = Schema.decodeEffect(
  fromLenientJson(Schema.Struct({ qa: Schema.optionalKey(QaConfiguration) })),
);
const decodeRun = Schema.decodeEffect(Schema.fromJsonString(QaRun));
const encodeRun = Schema.encodeEffect(Schema.fromJsonString(QaRun));
const encodeEvidence = Schema.encodeEffect(Schema.fromJsonString(InputEvidence));
const decodeEvidence = Schema.decodeEffect(Schema.fromJsonString(InputEvidence));
const decodeSchedule = Schema.decodeEffect(Schema.fromJsonString(QaSchedule));
const encodeSchedule = Schema.encodeEffect(Schema.fromJsonString(QaSchedule));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isQaError = Schema.is(QaError);
const storageError = (cause: unknown) =>
  isQaError(cause) ? cause : new QaError({ reason: "storage", cause });

export class QaService extends Context.Service<
  QaService,
  {
    readonly snapshot: (input: QaProjectInput) => Effect.Effect<QaSnapshot, QaError>;
    readonly subscribe: (input: QaProjectInput) => Stream.Stream<QaSnapshot, QaError>;
    readonly start: (input: QaStartInput) => Effect.Effect<QaRun, QaError>;
    readonly startAffected: (input: QaProjectInput) => Effect.Effect<readonly string[], QaError>;
    readonly cancelAffected: (input: QaProjectInput) => Effect.Effect<void, QaError>;
    readonly cancel: (input: QaRunInput) => Effect.Effect<void, QaError>;
    readonly details: (input: QaRunInput) => Effect.Effect<QaRunDetails, QaError>;
    readonly tests: (input: QaTestsInput) => Effect.Effect<QaTestResults, QaError>;
    readonly setSchedule: (input: QaSetScheduleInput) => Effect.Effect<void, QaError>;
    readonly importReport: (input: QaImportInput) => Effect.Effect<QaRun, QaError>;
  }
>()("t3/qa/QaService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const scheduler = yield* Scheduler.Scheduler;
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
  const captureInputs = yield* makeInputCapture;
  const batches = new Map<
    string,
    {
      pending: string[];
      runIds: string[];
      error?: string;
      runId?: string;
      fiber?: Fiber.Fiber<void, never>;
    }
  >();
  const batchErrors = new Map<string, string>();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const active = new Map<
    string,
    {
      details: QaRunDetails;
      cancelled: boolean;
      root: string;
      evidence: InputEvidence;
      fiber?: Fiber.Fiber<void, QaError>;
    }
  >();

  const recoveredAt = yield* now;
  yield* sql`UPDATE qa_runs SET status = 'interrupted', run_json = json_set(run_json,
    '$.status', 'interrupted', '$.finishedAt', ${recoveredAt}, '$.note', 'The server stopped before this run finished.')
    WHERE status = 'running'`.pipe(Effect.mapError(storageError));
  yield* sql`UPDATE qa_schedules SET schedule_json = json_set(schedule_json,
    '$.lastStatus', 'interrupted', '$.note', 'The server stopped before the scheduled run finished.')
    WHERE json_extract(schedule_json, '$.lastStatus') = 'running'`.pipe(
    Effect.mapError(storageError),
  );

  const readSchedule = Effect.fn("QaService.readSchedule")(function* (input: QaProjectInput) {
    const rows = yield* sql<{
      schedule_json: string;
    }>`SELECT schedule_json FROM qa_schedules WHERE project_id = ${input.projectId}`;
    return rows[0] ? yield* decodeSchedule(rows[0].schedule_json) : null;
  }, Effect.mapError(storageError));

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
    const latest = yield* sql<{
      run_json: string;
      evidence_json: string | null;
    }>`SELECT run_json, evidence_json FROM (
      SELECT id, run_json, ROW_NUMBER() OVER (PARTITION BY suite_id ORDER BY started_at DESC, rowid DESC) AS ordinal
      FROM qa_runs WHERE project_id = ${input.projectId} AND COALESCE(json_extract(run_json, '$.source.type'), '') <> 'ci'
    ) LEFT JOIN qa_run_inputs ON run_id = id
    WHERE ordinal = 1 ORDER BY json_extract(run_json, '$.startedAt') DESC LIMIT 200`;
    const recent = yield* sql<{ run_json: string }>`SELECT run_json FROM qa_runs
      WHERE project_id = ${input.projectId} ORDER BY started_at DESC, rowid DESC LIMIT 50`;
    const passed = yield* sql<{ suite_id: string; finished_at: string }>`SELECT suite_id,
      MAX(json_extract(run_json, '$.finishedAt')) AS finished_at FROM qa_runs
      WHERE project_id = ${input.projectId} AND status = 'passed'
        AND COALESCE(json_extract(run_json, '$.source.type'), '') <> 'ci' GROUP BY suite_id`;
    const ci = yield* sql<{ run_json: string }>`SELECT run_json FROM (
      SELECT run_json, ROW_NUMBER() OVER (PARTITION BY suite_id ORDER BY started_at DESC, rowid DESC) AS ordinal
      FROM qa_runs WHERE project_id = ${input.projectId} AND json_extract(run_json, '$.source.type') = 'ci'
    ) WHERE ordinal = 1 LIMIT 100`;
    const lastPassed = new Map(passed.map((row) => [row.suite_id, row.finished_at]));
    const suites = config._tag === "Success" ? config.success : [];
    const current = yield* captureInputs(root, suites);
    const latestRuns = yield* Effect.forEach(latest, (row) => decodeRun(row.run_json));
    const evidence = new Map<string, InputEvidence>();
    for (const row of latest) {
      if (row.evidence_json) {
        const value = yield* decodeEvidence(row.evidence_json);
        evidence.set((yield* decodeRun(row.run_json)).suite.id, value);
      }
    }
    const checkedAt = yield* now;
    return {
      workspaceRoot: root,
      configurationError: config._tag === "Failure" ? config.failure.message : null,
      suites,
      latestRuns,
      recentRuns: yield* Effect.forEach(recent, (row) => decodeRun(row.run_json)),
      checkedAt,
      freshness: suites.flatMap((suite) => {
        const inputs = current.get(suite.id);
        return inputs
          ? [
              assessFreshness(
                suite,
                latestRuns.find((run) => run.suite.id === suite.id),
                evidence.get(suite.id),
                inputs,
                checkedAt,
                lastPassed.get(suite.id) ?? null,
              ),
            ]
          : [];
      }),
      queuedSuiteIds: [...(batches.get(input.projectId)?.pending ?? [])],
      batchError: batchErrors.get(input.projectId) ?? null,
      batchRunning: batches.has(input.projectId),
      schedule: yield* readSchedule(input),
      latestCiRuns: yield* Effect.forEach(ci, (row) => decodeRun(row.run_json)),
      branch: yield* git(root, ["branch", "--show-current"]),
      testResultsAvailable: true,
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

  const tests = Effect.fn("QaService.tests")(function* (input: QaTestsInput) {
    const { run, reportXml } = yield* details(input);
    const offset = input.offset ?? 0;
    const empty = { run, tests: [], total: 0, matched: 0, offset, nextOffset: null };
    if (reportXml === null)
      return {
        ...empty,
        unavailableReason:
          run.status === "running"
            ? "Individual results will appear when this run produces its report."
            : "This run has no per-test report. Run the suite with JUnit reporting to see individual results.",
      };
    const parsed = yield* Effect.try(() => {
      const tests: QaTestResults["tests"][number][] = [];
      const terms = (input.search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      let matched = 0;
      const summary = parseJunitReport(reportXml, (test) => {
        if (input.status && test.status !== input.status) return;
        const searchable = `${test.name} ${test.group ?? ""} ${test.file ?? ""}`.toLowerCase();
        if (!terms.every((term) => searchable.includes(term))) return;
        if (matched >= offset && tests.length < QA_TEST_PAGE_SIZE) tests.push(test);
        matched += 1;
      });
      return {
        run,
        tests,
        total: summary.tests,
        matched,
        offset,
        nextOffset: offset + tests.length < matched ? offset + tests.length : null,
        unavailableReason: null,
      };
    }).pipe(Effect.result);
    return parsed._tag === "Success"
      ? parsed.success
      : {
          ...empty,
          unavailableReason:
            "The saved report could not be read. Open the run output and report for details.",
        };
  });

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
      const configured = (yield* catalog(entry.root).pipe(Effect.orElseSucceed(() => []))).find(
        (suite) => suite.id === run.suite.id,
      );
      const after = configured
        ? (yield* captureInputs(entry.root, [configured])).get(run.suite.id)
        : undefined;
      entry.evidence = {
        ...entry.evidence,
        stable:
          !!after &&
          !!configured &&
          !entry.evidence.problem &&
          !after.problem &&
          changedInputs(entry.evidence, after).length === 0 &&
          after.configuration === entry.evidence.configuration,
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
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* save(entry.details);
                  yield* sql`UPDATE qa_run_inputs SET evidence_json = ${yield* encodeEvidence(entry.evidence)}
                WHERE run_id = ${entry.details.run.id}`;
                }),
              )
              .pipe(
                Effect.ensuring(Effect.sync(() => active.delete(entry.details.run.id))),
                Effect.ensuring(PubSub.publish(updates, entry.details.run.projectId)),
              );
          }),
        ),
        Effect.mapError(storageError),
      ),
  );

  const startRun = Effect.fn("QaService.startRun")(function* (
    input: QaStartInput & { expectedBranch?: string },
  ) {
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
      ...(input.expectedBranch ? { source: { type: "schedule" as const } } : {}),
    };
    if (input.expectedBranch && branch !== input.expectedBranch)
      return yield* new QaError({ reason: "branch" });
    const evidence = (yield* captureInputs(root, [suite])).get(suite.id)!;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json)
          VALUES (${run.id}, ${run.projectId}, ${suite.id}, ${run.startedAt}, 'running', ${yield* encodeRun(run)})`;
        yield* sql`INSERT INTO qa_run_inputs VALUES (${run.id}, ${yield* encodeEvidence(evidence)})`;
      }),
    );
    const entry: NonNullable<ReturnType<typeof active.get>> = {
      details: { run, output: "", outputTruncated: false, reportXml: null },
      cancelled: false,
      root,
      evidence,
    };
    active.set(run.id, entry);
    entry.fiber = yield* execute(entry).pipe(
      Effect.interruptible,
      Effect.forkIn(scope, { startImmediately: true }),
    );
    yield* PubSub.publish(updates, input.projectId);
    return entry;
  }, Effect.mapError(storageError));

  const start = Effect.fn("QaService.start")(
    function* (input: QaStartInput) {
      if (batches.has(input.projectId)) return yield* new QaError({ reason: "busy" });
      batchErrors.delete(input.projectId);
      return (yield* startRun(input)).details.run;
    },
    lock.withPermit,
    Effect.uninterruptible,
  );

  const startBatch = Effect.fn("QaService.startBatch")(
    function* (input: QaProjectInput, scheduled?: QaSchedule) {
      if (
        batches.has(input.projectId) ||
        [...active.values()].some((entry) => entry.details.run.projectId === input.projectId)
      )
        return yield* new QaError({ reason: "busy" });
      if (scheduled && (yield* readSchedule(input))?.revision !== scheduled.revision)
        return yield* new QaError({ reason: "schedule" });
      const current = yield* snapshot(input);
      if (current.configurationError) return yield* new QaError({ reason: "configuration" });
      if (scheduled && current.branch !== scheduled.configuration.branch)
        return yield* new QaError({ reason: "branch" });
      const target = scheduled?.configuration.target ?? { type: "affected" };
      const ids =
        target.type === "suite"
          ? [target.suiteId]
          : target.type === "all"
            ? current.suites.map((suite) => suite.id)
            : current.freshness.filter((item) => item.needsRun).map((item) => item.suiteId);
      const batch: NonNullable<ReturnType<typeof batches.get>> = { pending: [...ids], runIds: [] };
      if (!ids.length) return { ids, batch };
      batchErrors.delete(input.projectId);
      batches.set(input.projectId, batch);
      batch.fiber = yield* Effect.gen(function* () {
        for (const suiteId of ids) {
          const entry = yield* lock.withPermit(
            Effect.gen(function* () {
              const entry = yield* startRun({
                ...input,
                suiteId,
                ...(scheduled ? { expectedBranch: scheduled.configuration.branch } : {}),
              });
              batch.pending.shift();
              batch.runId = entry.details.run.id;
              batch.runIds.push(entry.details.run.id);
              yield* PubSub.publish(updates, input.projectId);
              return entry;
            }).pipe(Effect.uninterruptible),
          );
          if (entry.fiber) yield* Fiber.join(entry.fiber);
          if (entry.cancelled) break;
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            batchErrors.set(input.projectId, error.message);
            batch.error = error.message;
          }),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            batches.delete(input.projectId);
            yield* PubSub.publish(updates, input.projectId);
          }),
        ),
        Effect.interruptible,
        Effect.forkIn(scope, { startImmediately: true }),
      );
      yield* PubSub.publish(updates, input.projectId);
      return { ids, batch };
    },
    lock.withPermit,
    Effect.uninterruptible,
  );

  const startAffected = Effect.fn("QaService.startAffected")((input: QaProjectInput) =>
    startBatch(input).pipe(Effect.map(({ ids }) => ids)),
  );

  const cancel = Effect.fn("QaService.cancel")(function* (input: QaRunInput) {
    yield* details(input);
    const entry = active.get(input.runId);
    if (!entry?.fiber || entry.details.run.projectId !== input.projectId) return;
    entry.cancelled = true;
    yield* Fiber.interrupt(entry.fiber);
  });

  const cancelAffected = Effect.fn("QaService.cancelAffected")(function* (input: QaProjectInput) {
    yield* workspace(input);
    const batch = batches.get(input.projectId);
    if (!batch?.fiber) return;
    yield* Fiber.interrupt(batch.fiber);
    if (batch.runId) yield* cancel({ ...input, runId: batch.runId });
  });

  const nextDue = (configuration: QaSchedule["configuration"], from: DateTime.DateTime) => {
    const zone = DateTime.zoneMakeNamed(configuration.timeZone);
    if (Option.isNone(zone)) return null;
    const next = nextScheduledRunAt(configuration.timing, DateTime.setZone(from, zone.value));
    return next ? DateTime.formatIso(next) : null;
  };

  const setSchedule = Effect.fn("QaService.setSchedule")(
    function* (input: QaSetScheduleInput) {
      const root = yield* workspace(input);
      if (!input.configuration) {
        yield* sql`DELETE FROM qa_schedules WHERE project_id = ${input.projectId}`;
      } else {
        const configuration = input.configuration;
        const suites = configuration.enabled ? yield* catalog(root) : [];
        const next = nextDue(configuration, yield* DateTime.now);
        const target = configuration.target;
        if (
          !next ||
          (configuration.enabled &&
            target.type === "suite" &&
            !suites.some((suite) => suite.id === target.suiteId))
        )
          return yield* new QaError({ reason: "schedule" });
        const previous = yield* readSchedule(input);
        const preserveDue =
          previous?.configuration.enabled &&
          configuration.enabled &&
          configuration.timeZone === previous.configuration.timeZone &&
          isSameSchedule(configuration.timing, previous.configuration.timing);
        const value: QaSchedule = {
          configuration,
          revision: yield* crypto.randomUUIDv4(),
          nextRunAt: configuration.enabled ? (preserveDue ? previous.nextRunAt : next) : null,
          lastRunAt: previous?.lastRunAt ?? null,
          lastStatus: previous?.lastStatus ?? "never",
          note: previous?.note ?? null,
          runIds: previous?.runIds ?? [],
        };
        yield* sql`INSERT INTO qa_schedules VALUES (${input.projectId}, ${yield* encodeSchedule(value)})
        ON CONFLICT(project_id) DO UPDATE SET schedule_json = excluded.schedule_json`;
      }
      yield* PubSub.publish(updates, input.projectId);
    },
    lock.withPermit,
    Effect.uninterruptible,
    Effect.mapError(storageError),
  );

  const updateScheduleRun = Effect.fn("QaService.updateScheduleRun")(
    function* (input: QaProjectInput, value: QaSchedule, completed = false) {
      if (completed) {
        // Completion must not undo schedule edits or a pause made during the run.
        yield* sql`UPDATE qa_schedules SET schedule_json = json_set(schedule_json,
        '$.lastStatus', ${value.lastStatus}, '$.note', ${value.note}, '$.runIds', json(${encodeJson(value.runIds)}))
        WHERE project_id = ${input.projectId} AND json_extract(schedule_json, '$.lastRunAt') = ${value.lastRunAt}
          AND json_extract(schedule_json, '$.lastStatus') = 'running'`;
      } else
        yield* sql`UPDATE qa_schedules SET schedule_json = ${yield* encodeSchedule(value)}
      WHERE project_id = ${input.projectId} AND json_extract(schedule_json, '$.revision') = ${value.revision}`;
      yield* PubSub.publish(updates, input.projectId);
    },
    lock.withPermit,
    Effect.uninterruptible,
    Effect.mapError(storageError),
  );

  const dispatchScheduled = Effect.fn("QaService.dispatchScheduled")(function* (
    input: QaProjectInput,
    schedule: QaSchedule,
  ) {
    const timestamp = yield* DateTime.now;
    const nextRunAt = nextDue(schedule.configuration, timestamp);
    if (
      schedule.nextRunAt &&
      isMissedFixedTimeRun(
        schedule.configuration.timing,
        DateTime.makeUnsafe(schedule.nextRunAt),
        timestamp,
      )
    ) {
      yield* updateScheduleRun(input, {
        ...schedule,
        nextRunAt,
        lastRunAt: schedule.nextRunAt,
        lastStatus: "missed",
        runIds: [],
        note: "The fixed-time run was missed by more than 10 minutes. It was not replayed.",
      });
      return;
    }
    const attempt = yield* startBatch(input, schedule).pipe(Effect.result);
    if (attempt._tag === "Failure") {
      if (attempt.failure.reason === "busy") return;
      yield* updateScheduleRun(input, {
        ...schedule,
        nextRunAt,
        lastRunAt: DateTime.formatIso(timestamp),
        lastStatus: "failed",
        note: attempt.failure.message,
        runIds: [],
      });
      return;
    }
    const { batch, ids } = attempt.success;
    const running: QaSchedule = {
      ...schedule,
      nextRunAt,
      lastRunAt: DateTime.formatIso(timestamp),
      lastStatus: ids.length ? "running" : "skipped",
      runIds: [],
      note: ids.length ? null : "No suites need to run.",
    };
    yield* updateScheduleRun(input, running);
    if (!batch.fiber) return;
    yield* Effect.gen(function* () {
      const outcome = yield* Fiber.await(batch.fiber!);
      const runs = yield* Effect.forEach(batch.runIds, (runId) => details({ ...input, runId }));
      yield* updateScheduleRun(
        input,
        {
          ...running,
          runIds: [...batch.runIds],
          lastStatus: Exit.isFailure(outcome)
            ? "interrupted"
            : batch.error || runs.some(({ run }) => run.status !== "passed")
              ? "failed"
              : "passed",
          note:
            batch.error ??
            (Exit.isFailure(outcome) ? "The scheduled run was stopped. See run history." : null),
        },
        true,
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("QA schedule completion could not be saved", { reason: error.reason }),
      ),
      Effect.forkIn(scope),
    );
  });

  const runDue = Effect.fn("QaService.runDue")(function* () {
    const due = yield* sql<{
      project_id: string;
      schedule_json: string;
    }>`SELECT project_id, schedule_json FROM qa_schedules
      WHERE json_extract(schedule_json, '$.configuration.enabled') = 1
        AND json_extract(schedule_json, '$.lastStatus') <> 'running'
        AND json_extract(schedule_json, '$.nextRunAt') <= ${yield* now}`;
    yield* Effect.forEach(
      due,
      (row) =>
        decodeSchedule(row.schedule_json).pipe(
          Effect.flatMap((schedule) =>
            dispatchScheduled({ projectId: ProjectId.make(row.project_id) }, schedule),
          ),
          Effect.catch((cause) => Effect.logWarning("QA schedule dispatch failed", { cause })),
        ),
      { discard: true },
    );
  });
  yield* scheduler.register("qa", runDue());

  const importReport = Effect.fn("QaService.importReport")(
    function* (input: QaImportInput) {
      const root = yield* workspace(input);
      const report = input.report;
      const suite = (yield* catalog(root)).find((item) => item.id === report.suiteId);
      if (!suite) return yield* new QaError({ reason: "suite-not-found" });
      const timestamp = yield* now;
      const started = Date.parse(report.startedAt);
      const finished = Date.parse(report.finishedAt);
      if (
        !Number.isFinite(started) ||
        !Number.isFinite(finished) ||
        finished < started ||
        finished > Date.parse(timestamp) + 300_000 ||
        new TextEncoder().encode(report.reportXml).byteLength > MAX_REPORT
      )
        return yield* new QaError({ reason: "report" });
      const summary = yield* Effect.try({
        try: () => parseJunitReport(report.reportXml),
        catch: (cause) => new QaError({ reason: "report", cause }),
      });
      const hash = yield* crypto
        .digest(
          "SHA-256",
          new TextEncoder().encode(
            encodeJson([
              report.suiteId,
              report.source.provider,
              report.source.runId,
              report.source.environment,
              report.source.url ?? null,
              report.commit.toLowerCase(),
              report.branch,
              report.startedAt,
              report.finishedAt,
              report.exitCode,
              report.reportXml,
            ]),
          ),
        )
        .pipe(Effect.map((bytes) => Buffer.from(bytes).toString("hex")));
      const existing = yield* sql<{
        run_id: string;
        payload_hash: string;
      }>`SELECT run_id, payload_hash FROM qa_ci_imports
      WHERE project_id = ${input.projectId} AND suite_id = ${report.suiteId}
        AND provider = ${report.source.provider} AND external_id = ${report.source.runId}`;
      if (existing[0]) {
        if (existing[0].payload_hash !== hash) return yield* new QaError({ reason: "duplicate" });
        return (yield* details({ projectId: input.projectId, runId: existing[0].run_id })).run;
      }
      const status =
        report.exitCode !== 0 || summary.failures > 0
          ? "failed"
          : summary.tests === summary.skipped
            ? "incomplete"
            : "passed";
      const run: QaRun = {
        id: yield* crypto.randomUUIDv4(),
        projectId: input.projectId,
        suite,
        cwd: "",
        startedAt: DateTime.formatIso(DateTime.makeUnsafe(started)),
        finishedAt: DateTime.formatIso(DateTime.makeUnsafe(finished)),
        status,
        exitCode: report.exitCode,
        commit: report.commit.toLowerCase(),
        branch: report.branch,
        dirty: null,
        summary,
        source: report.source,
        note: "Imported CI result. Local input freshness is evaluated separately.",
      };
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO qa_runs (id, project_id, suite_id, started_at, status, run_json, report_xml)
        VALUES (${run.id}, ${run.projectId}, ${suite.id}, ${run.startedAt}, ${status}, ${yield* encodeRun(run)}, ${report.reportXml})`;
          yield* sql`INSERT INTO qa_ci_imports VALUES (${run.projectId}, ${suite.id}, ${report.source.provider}, ${report.source.runId}, ${run.id}, ${hash})`;
        }),
      );
      yield* PubSub.publish(updates, input.projectId);
      return run;
    },
    lock.withPermit,
    Effect.uninterruptible,
    Effect.mapError(storageError),
  );

  return QaService.of({
    snapshot,
    start,
    startAffected,
    cancelAffected,
    cancel,
    details,
    tests,
    setSchedule,
    importReport,
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
