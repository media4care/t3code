// @effect-diagnostics nodeBuiltinImport:off -- streaming SHA-256 keeps native build inputs out of memory.
import * as NodeCrypto from "node:crypto";
import { type QaFreshness, type QaRun, type QaSuite } from "@t3tools/contracts";
import {
  CHECK_INPUT_PATHS,
  INSTALL_INPUTS,
  decide,
  workspacePackage,
  workspacePatterns,
} from "@t3tools/shared/workspaceChanges";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ProcessRunner from "../processRunner.ts";

export const InputEvidence = Schema.Struct({
  configuration: Schema.String,
  files: Schema.Record(Schema.String, Schema.String),
  problem: Schema.NullOr(Schema.String),
  stable: Schema.Boolean,
});
export type InputEvidence = typeof InputEvidence.Type;

const ROOT_INPUTS = [
  ...INSTALL_INPUTS,
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-workspace.yaml",
  "vitest.config.ts",
  "vite.config.ts",
  "tsconfig.json",
  "turbo.json",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".gitignore",
];
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      workspaces: Schema.optionalKey(
        Schema.Union([
          Schema.Array(Schema.String),
          Schema.Struct({ packages: Schema.Array(Schema.String) }),
        ]),
      ),
    }),
  ),
);

function configuration(suite: QaSuite) {
  return encodeJson({
    command: suite.command,
    cwd: suite.cwd ?? ".",
    report: suite.report ?? null,
    inputs: suite.inputs,
    workspacePackage: suite.workspacePackage,
    environment: suite.environment ?? null,
    environmentFile: suite.environmentFile ?? null,
  });
}

export const makeInputCapture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;
  return Effect.fn("QaService.captureInputs")(function* (root: string, suites: readonly QaSuite[]) {
    const listings = yield* Effect.forEach(
      [
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
        [
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "-z",
          "--",
          ...CHECK_INPUT_PATHS,
        ],
      ],
      (args) =>
        processes
          .run({
            command: "git",
            args,
            cwd: root,
            maxOutputBytes: 4 * 1024 * 1024,
            timeout: "10 seconds",
          })
          .pipe(Effect.result),
      { concurrency: 2 },
    );
    const paths = listings.every(
      (item) =>
        item._tag === "Success" && item.success.code === 0 && !item.success.stdoutInvalidUtf8,
    )
      ? [
          ...new Set(
            listings.flatMap((item, index) =>
              item._tag === "Success"
                ? item.success.stdout
                    .split("\0")
                    .filter((name) => name && (index === 0 || !name.endsWith("/")))
                : [],
            ),
          ),
        ].sort()
      : null;
    const graph =
      suites.some((suite) => suite.workspacePackage) && paths
        ? yield* Effect.gen(function* () {
            const manifest = yield* decodeManifest(
              yield* fs.readFileString(path.join(root, "package.json")),
            );
            const pnpm = path.join(root, "pnpm-workspace.yaml");
            const patterns = (yield* fs.exists(pnpm))
              ? workspacePatterns(yield* fs.readFileString(pnpm))
              : manifest.workspaces && "packages" in manifest.workspaces
                ? manifest.workspaces.packages
                : (manifest.workspaces ?? []);
            if (
              !patterns.length ||
              patterns.some((pattern) => !/^[^!*?[\]{}]+(?:\/\*)?$/.test(pattern))
            )
              return null;
            const dirs = paths
              .filter((name) => name.endsWith("/package.json"))
              .map((name) => name.slice(0, -13))
              .filter((dir) =>
                patterns.some((pattern) =>
                  pattern.endsWith("/*")
                    ? dir.startsWith(pattern.slice(0, -1)) &&
                      !dir.slice(pattern.length - 1).includes("/")
                    : dir === pattern,
                ),
              );
            const t3Rules = manifest.name === "@t3tools/monorepo";
            const packages = yield* Effect.forEach(
              dirs,
              (dir) =>
                fs.readFileString(path.join(root, dir, "package.json")).pipe(
                  Effect.flatMap(decodeManifest),
                  Effect.map((pkg) => workspacePackage(pkg, dir, t3Rules)),
                ),
              { concurrency: 8 },
            );
            if (new Set(packages.map((pkg) => pkg.name)).size !== packages.length) return null;
            const selected = new Map(packages.map((pkg) => [pkg.name, [] as string[]]));
            const targets = new Set(
              suites.flatMap((suite) => (suite.workspacePackage ? [suite.workspacePackage] : [])),
            );
            for (const name of paths) {
              for (const affected of decide([name], packages, false, t3Rules).affected) {
                if (targets.has(affected)) selected.get(affected)?.push(name);
              }
            }
            return selected;
          }).pipe(Effect.orElseSucceed(() => null))
        : null;
    type FileFingerprint = { hash: string; problem: string | null };
    const cached = new Map<string, FileFingerprint>();
    const visiting = new Set<string>();
    let bytes = 0;
    // Individual file hashes share the capture span instead of creating thousands of spans per refresh.
    const read = Effect.fnUntraced(function* (name: string): Effect.fn.Return<FileFingerprint> {
      const previous = cached.get(name);
      if (previous) return previous;
      if (visiting.has(name)) return { hash: "", problem: `Cyclic linked input: ${name}` };
      visiting.add(name);
      const filename = path.resolve(root, name);
      const relative = path.relative(root, filename);
      const value = yield* Effect.gen(function* () {
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          return { hash: "", problem: `Input is outside the project: ${name}` };
        const inspected = yield* fs.stat(filename).pipe(Effect.result);
        if (inspected._tag === "Failure")
          return inspected.failure.reason._tag === "NotFound"
            ? { hash: "missing", problem: null }
            : { hash: "", problem: `Input could not be inspected: ${name}` };
        const real = yield* fs.realPath(filename);
        const target = path.relative(root, real).split(path.sep).join("/");
        if (target === ".." || target.startsWith("../") || path.isAbsolute(target))
          return { hash: "", problem: `Linked input is outside the project: ${name}` };
        const before = inspected.success;
        if (real !== filename && before.type === "Directory") {
          const children = paths?.filter((file) => file.startsWith(`${target}/`)) ?? [];
          if (!children.length)
            return {
              hash: "",
              problem: `Linked directory has no inspectable input files: ${name}`,
            };
          const hashes: string[] = [target];
          for (const child of children) {
            const value = yield* read(child);
            if (value.problem) return value;
            hashes.push(child, value.hash);
          }
          return {
            hash: NodeCrypto.createHash("sha256").update(encodeJson(hashes)).digest("hex"),
            problem: null,
          };
        }
        if (before.type !== "File")
          return { hash: "", problem: `Input is not a regular file: ${name}` };
        bytes += Number(before.size);
        if (before.size > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES)
          return {
            hash: "",
            problem: "Input snapshot exceeds the size limit. Use more specific input paths.",
          };
        const content = yield* fs.stream(filename, { bytesToRead: MAX_FILE_BYTES + 1 }).pipe(
          Stream.runFold(
            () => ({ hash: NodeCrypto.createHash("sha256"), bytes: 0 }),
            (state, chunk) => ({
              hash: state.hash.update(chunk),
              bytes: state.bytes + chunk.length,
            }),
          ),
        );
        if (content.bytes > MAX_FILE_BYTES)
          return { hash: "", problem: `Input grew while it was being checked: ${name}` };
        const hash = content.hash.digest("hex");
        const after = yield* fs.stat(filename);
        const stamp = (info: typeof before) =>
          encodeJson([info.size.toString(), info.mode, Option.getOrNull(info.mtime)]);
        return {
          hash: `${target}:${before.mode & 0o111}:${hash}`,
          problem:
            stamp(before) === stamp(after)
              ? null
              : `Input changed while it was being checked: ${name}`,
        };
      }).pipe(
        Effect.orElseSucceed(() => ({ hash: "", problem: `Input could not be read: ${name}` })),
      );
      cached.set(name, value);
      visiting.delete(name);
      return value;
    });
    const results = new Map<string, InputEvidence>();
    for (const suite of suites) {
      const files: Record<string, string> = {};
      let problem: string | null =
        !suite.inputs?.length && !suite.workspacePackage
          ? "Declare input files or directories for this suite in t3.json."
          : paths === null
            ? "The Git working tree could not be inspected."
            : null;
      if (suite.workspacePackage && !graph?.has(suite.workspacePackage))
        problem =
          "The workspace package or its dependency graph could not be resolved. Check workspacePackage and workspace manifests.";
      const external =
        suite.environment === "external" ||
        (suite.environment !== "workspace" &&
          (suite.kind === "maestro" || suite.kind === "e2e" || /\bmaestro\b/.test(suite.command)));
      if (!problem && external && !suite.environmentFile)
        problem =
          "The installed app or external service identity is unknown. Configure an environmentFile.";
      if (!problem && paths) {
        const selected = new Set([
          ...ROOT_INPUTS,
          ...paths.filter((name) => !name.includes("/") && name.startsWith(".env")),
        ]);
        if (suite.workspacePackage)
          for (const name of graph?.get(suite.workspacePackage) ?? []) selected.add(name);
        for (const input of suite.inputs ?? []) {
          const prefix = path.normalize(input).split(path.sep).join("/").replace(/\/$/, "");
          const matches = paths.filter(
            (name) => prefix === "." || name === prefix || name.startsWith(`${prefix}/`),
          );
          if (matches.length === 0) {
            const info = yield* fs.stat(path.join(root, input)).pipe(Effect.option);
            if (Option.isSome(info) && info.value.type === "File") selected.add(input);
            else problem = `No input files found at ${input}. Check the configured paths.`;
          }
          for (const name of matches) selected.add(name);
        }
        if (suite.environmentFile) selected.add(suite.environmentFile);
        // Suite commands and inputs are hashed separately; edits to another suite do not invalidate this one.
        if (suite.environmentFile !== "t3.json") selected.delete("t3.json");
        if (selected.size > 20000)
          problem = "More than 20,000 input files. Use more specific input paths.";
        if (!problem) {
          if (suite.environmentFile) {
            const identity = yield* fs
              .stat(path.join(root, suite.environmentFile))
              .pipe(Effect.option);
            if (
              Option.isNone(identity) ||
              identity.value.type !== "File" ||
              Number(identity.value.size) === 0
            )
              problem = "The environment identity file is missing or empty.";
          }
          for (const name of [...selected].sort()) {
            const value = yield* read(name);
            files[name] = value.hash;
            if (value.problem) {
              problem = value.problem;
              break;
            }
            if (name === suite.environmentFile && value.hash === "missing") {
              problem = "The environment identity file is missing.";
              break;
            }
          }
        }
      }
      results.set(suite.id, { configuration: configuration(suite), files, problem, stable: false });
    }
    return results;
  });
});

export function changedInputs(before: InputEvidence, after: InputEvidence) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter((name) => before.files[name] !== after.files[name])
    .sort();
}

export function assessFreshness(
  suite: QaSuite,
  run: QaRun | undefined,
  before: InputEvidence | undefined,
  current: InputEvidence,
  checkedAt: string,
  lastPassedAt: string | null,
): QaFreshness {
  const result = (
    state: QaFreshness["state"],
    reason: string,
    changes: string[] = [],
  ): QaFreshness => ({
    suiteId: suite.id,
    state,
    reason,
    changedPaths: changes.slice(0, 10),
    changedFileCount: changes.length,
    needsRun: run?.status !== "running" && (state !== "current" || run?.status !== "passed"),
    lastPassedAt,
  });
  if (!run) return result("never", "No run has been recorded for this suite.");
  if (run.status === "running")
    return result("unknown", "The suite is running; freshness is checked when it finishes.");
  if (current.problem) return result("unknown", current.problem);
  if (!before)
    return result(
      "unknown",
      "This run predates input tracking. Run the suite to record its inputs.",
    );
  if (before.problem) return result("unknown", before.problem);
  if (before.configuration !== current.configuration)
    return result(
      "stale",
      "The command, working directory, report, or input configuration changed.",
    );
  const changes = changedInputs(before, current);
  if (changes.length)
    return result(
      "stale",
      `${changes.length} input ${changes.length === 1 ? "file changed" : "files changed"} since this run.`,
      changes,
    );
  if (!before.stable)
    return result(
      "unknown",
      "Inputs changed during this run, or could not be verified when it finished.",
    );
  if (
    suite.maxAgeHours &&
    Date.parse(checkedAt) - Date.parse(run.startedAt) >= suite.maxAgeHours * 3600000
  )
    return result("stale", `The run is older than the ${suite.maxAgeHours}-hour freshness limit.`);
  return result(
    "current",
    run.status === "passed"
      ? "Configured inputs match this run."
      : "Configured inputs match, but the last run did not pass.",
  );
}
