import { IsoDateTime, QaError, QaRun, QaSuite, type ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { SHARED_RESULTS_DIRECTORY, type InputEvidence } from "./inputs.ts";

const SharedResult = Schema.Struct({
  version: Schema.Literal(1),
  suiteId: QaSuite.fields.id,
  id: QaRun.fields.id,
  startedAt: QaRun.fields.startedAt,
  finishedAt: IsoDateTime,
  status: Schema.Literals(["passed", "failed", "incomplete"]),
  exitCode: Schema.Int,
  commit: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  branch: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  dirty: QaRun.fields.dirty,
  summary: QaRun.fields.summary,
  fingerprint: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
});
type SharedResult = typeof SharedResult.Type;
const decode = Schema.decodeEffect(Schema.fromJsonString(SharedResult));
const encode = Schema.encodeSync(Schema.fromJsonString(SharedResult, { space: 2 }));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const MAX_BYTES = 16 * 1024;
export const SHARED_RESULT_DETAILS =
  "This repository summary contains the outcome and counts. Full output and individual test reports remain on the execution environment.";

export const makeSharedResults = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const invalid = () => new QaError({ reason: "storage" });
  const fingerprint = Effect.fn("QaService.sharedFingerprint")(function* (evidence: InputEvidence) {
    const bytes = new TextEncoder().encode(
      encodeJson([
        1,
        evidence.configuration,
        Object.entries(evidence.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ]),
    );
    return yield* crypto
      .digest("SHA-256", bytes)
      .pipe(
        Effect.map((hash) =>
          Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
      );
  });
  const directory = Effect.fn("QaService.sharedDirectory")(function* (
    root: string,
    create: boolean,
  ) {
    const dir = path.join(root, SHARED_RESULTS_DIRECTORY);
    if (create) yield* fs.makeDirectory(dir, { recursive: true });
    if (!(yield* fs.exists(dir))) return null;
    if ((yield* fs.realPath(dir)) !== dir || (yield* fs.stat(dir)).type !== "Directory")
      return yield* invalid();
    return dir;
  });
  const readFile = Effect.fn("QaService.readSharedResult")(function* (
    dir: string,
    suiteId: string,
  ) {
    const filename = path.join(dir, `${suiteId}.json`);
    if (!(yield* fs.exists(filename))) return null;
    if ((yield* fs.realPath(filename)) !== filename) return yield* invalid();
    const info = yield* fs.stat(filename);
    if (info.type !== "File" || info.size > MAX_BYTES) return yield* invalid();
    const contents = yield* fs
      .stream(filename, { bytesToRead: MAX_BYTES + 1 })
      .pipe(Stream.decodeText(), Stream.mkString);
    if (new TextEncoder().encode(contents).byteLength > MAX_BYTES) return yield* invalid();
    const result = yield* decode(contents);
    const timestamp = DateTime.toEpochMillis(yield* DateTime.now);
    if (
      result.suiteId !== suiteId ||
      Date.parse(result.finishedAt) < Date.parse(result.startedAt) ||
      Date.parse(result.finishedAt) > timestamp + 300_000 ||
      (result.summary && result.summary.failures + result.summary.skipped > result.summary.tests) ||
      (result.status === "passed" &&
        (result.exitCode !== 0 ||
          (result.summary &&
            (result.summary.failures > 0 || result.summary.tests === result.summary.skipped))))
    )
      return yield* invalid();
    return result;
  });
  const read = Effect.fn("QaService.readSharedResults")(
    function* (root: string, suites: readonly QaSuite[], projectId: ProjectId) {
      const records = new Map<string, { run: QaRun; fingerprint: string | null }>();
      const dir = yield* directory(root, false);
      let warning: string | null = null;
      if (dir)
        for (const suite of suites) {
          const loaded = yield* readFile(dir, suite.id).pipe(Effect.result);
          if (loaded._tag === "Failure") {
            warning =
              "Some repository QA results could not be read. Check the JSON files in t3.qa-results/ for invalid data or merge conflicts.";
            continue;
          }
          if (!loaded.success) continue;
          const { version: _version, suiteId: _suiteId, fingerprint, ...saved } = loaded.success;
          records.set(suite.id, {
            fingerprint,
            run: {
              ...saved,
              projectId,
              suite,
              cwd: path.resolve(root, suite.cwd ?? "."),
              note: SHARED_RESULT_DETAILS,
              repositoryFile: `${SHARED_RESULTS_DIRECTORY}/${suite.id}.json`,
            },
          });
        }
      return { records, warning };
    },
    Effect.orElseSucceed(() => ({
      records: new Map<string, { run: QaRun; fingerprint: string | null }>(),
      warning:
        "Repository QA results could not be read. Check that t3.qa-results/ is a regular directory inside the project.",
    })),
  );
  const write = Effect.fn("QaService.writeSharedResult")(function* (
    root: string,
    run: QaRun,
    evidence: InputEvidence,
  ) {
    if (
      run.status === "running" ||
      run.status === "cancelled" ||
      run.status === "interrupted" ||
      run.exitCode === null ||
      !run.finishedAt
    )
      return;
    const dir = yield* directory(root, true);
    if (!dir) return yield* invalid();
    const previous = yield* readFile(dir, run.suite.id);
    if (previous && Date.parse(previous.startedAt) > Date.parse(run.startedAt)) return;
    const result: SharedResult = {
      version: 1,
      suiteId: run.suite.id,
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      exitCode: run.exitCode,
      commit: run.commit,
      branch: run.branch,
      dirty: run.dirty,
      summary: run.summary,
      fingerprint: evidence.stable && !evidence.problem ? yield* fingerprint(evidence) : null,
    };
    const temporary = yield* fs.makeTempFileScoped({ directory: dir, prefix: ".pending-" });
    yield* fs.writeFileString(temporary, encode(result) + "\n");
    yield* fs.rename(temporary, path.join(dir, `${run.suite.id}.json`));
  }, Effect.scoped);
  return { read, write, fingerprint };
});
