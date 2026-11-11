import {
  QA_OUTPUT_TAIL_LIMIT,
  QaError,
  T3ProjectFileScript,
  type QaCheckout,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as NodeUtil from "node:util";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

const CHECKOUTS_DIRECTORY = "qa-checkouts";
// Refs tried once should not keep their dependencies and build caches on disk.
const UNUSED_CHECKOUT_TTL = Duration.days(14);
const MAX_OUTPUT_BYTES = 256 * 1024;

const Registry = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    checkouts: Schema.Array(
      Schema.Struct({
        ref: Schema.String,
        commit: Schema.String,
        syncedAt: Schema.String,
        /** False while the setup script has not succeeded for `commit`. */
        ready: Schema.Boolean,
      }),
    ),
  }),
);
type RegistryEntry = (typeof Registry.Type)["checkouts"][number];
const decodeRegistry = Schema.decodeEffect(Registry);
const encodeRegistry = Schema.encodeEffect(Registry);
const decodeProjectScripts = Schema.decodeEffect(
  fromLenientJson(
    Schema.Struct({ scripts: Schema.optionalKey(Schema.Array(T3ProjectFileScript)) }),
  ),
);

export interface QaCheckoutTarget {
  /** The repository's identity key; one clone serves every project of the repository. */
  readonly key: string;
  readonly remoteUrl: string;
  readonly ref: string;
  /** Handed to the setup script as `T3CODE_PROJECT_ROOT`, as for an agent worktree. */
  readonly projectRoot: string;
}

const tail = (text: string) =>
  NodeUtil.stripVTControlCharacters(text.slice(-QA_OUTPUT_TAIL_LIMIT)).trim();

class CheckoutFailure extends Schema.TaggedError<CheckoutFailure>()("CheckoutFailure", {
  detail: Schema.String,
}) {}

/**
 * QA's own clone of a repository's remote, with one worktree per ref that persists between runs
 * so dependencies and build caches are reused. Git work on one repository is serialized.
 */
export const makeQaCheckouts = Effect.fn("QaCheckouts.make")(function* (
  notify: (key: string) => Effect.Effect<void>,
) {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;
  const digest = yield* Digest.Digest;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const base = path.join(config.stateDir, CHECKOUTS_DIRECTORY);
  const locks = new Map<string, Semaphore.Semaphore>();
  const live = new Map<string, { state: "syncing" | "setup" | "failed"; error: string | null }>();

  const hash = (value: string) =>
    digest
      .digestHex(Digest.sha256, new TextEncoder().encode(value))
      .pipe(Effect.map((hex) => hex.slice(0, 16)));
  const repositoryDirectory = (key: string) =>
    hash(key).pipe(Effect.map((name) => path.join(base, name)));
  const checkoutPath = Effect.fn("QaCheckouts.path")(function* (key: string, ref: string) {
    const slug = ref.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
    return path.join(
      yield* repositoryDirectory(key),
      "refs",
      `${slug}-${(yield* hash(ref)).slice(0, 8)}`,
    );
  });
  const liveKey = (key: string, ref: string) => `${key}\u0000${ref}`;
  const lockFor = (key: string) => {
    let lock = locks.get(key);
    if (!lock) {
      lock = Semaphore.makeUnsafe(1);
      locks.set(key, lock);
    }
    return lock;
  };

  const readRegistry = Effect.fn("QaCheckouts.readRegistry")(function* (key: string) {
    const file = path.join(yield* repositoryDirectory(key), "checkouts.json");
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap(decodeRegistry),
      Effect.map((registry) => registry.checkouts),
      Effect.orElseSucceed((): ReadonlyArray<RegistryEntry> => []),
    );
  });
  const writeRegistry = Effect.fn("QaCheckouts.writeRegistry")(function* (
    key: string,
    checkouts: ReadonlyArray<RegistryEntry>,
  ) {
    const filePath = path.join(yield* repositoryDirectory(key), "checkouts.json");
    yield* writeFileStringAtomically({
      filePath,
      contents: yield* encodeRegistry({ version: 1, checkouts }),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
  });

  const run = Effect.fn("QaCheckouts.run")(function* (input: ProcessRunner.ProcessRunInput) {
    const result = yield* processes
      .run({
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
        ...input,
        // A credential prompt would hang the run; fail instead.
        env: { GIT_TERMINAL_PROMPT: "0", ...input.env },
      })
      .pipe(Effect.mapError((error) => new CheckoutFailure({ detail: error.message })));
    if (result.code !== 0)
      return yield* new CheckoutFailure({
        detail: tail(`${result.stdout}\n${result.stderr}`) || `${input.command} failed.`,
      });
    return result.stdout.trim();
  });
  const git = (cwd: string, args: ReadonlyArray<string>, timeout: Duration.Input = "2 minutes") =>
    run({ command: "git", args, cwd, timeout });
  const resolveCommit = (repository: string, ref: string) =>
    git(repository, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).pipe(
      Effect.orElseSucceed(() => null),
    );

  const setState = (
    key: string,
    ref: string,
    state: "syncing" | "setup" | "failed",
    error: string | null = null,
  ) =>
    Effect.suspend(() => {
      live.set(liveKey(key, ref), { state, error });
      return notify(key);
    });

  const runSetup = Effect.fn("QaCheckouts.runSetup")(function* (
    target: QaCheckoutTarget,
    directory: string,
  ) {
    const contents = yield* fs
      .readFileString(path.join(directory, "t3.json"))
      .pipe(Effect.orElseSucceed(() => "{}"));
    const scripts = (yield* decodeProjectScripts(contents).pipe(
      Effect.orElseSucceed(() => ({ scripts: [] })),
    )).scripts;
    const setup = scripts?.find((script) => script.runOnWorktreeCreate);
    if (!setup) return;
    yield* run({
      command: platform === "win32" ? "cmd.exe" : environment.SHELL || "/bin/sh",
      args: platform === "win32" ? ["/d", "/s", "/c", setup.command] : ["-lc", setup.command],
      cwd: directory,
      timeout: "30 minutes",
      env: { T3CODE_PROJECT_ROOT: target.projectRoot, T3CODE_WORKTREE_PATH: directory },
    });
  });

  const removeDirectory = Effect.fn("QaCheckouts.removeDirectory")(function* (
    repository: string,
    directory: string,
  ) {
    yield* git(repository, ["worktree", "remove", "--force", directory]).pipe(Effect.ignore);
    yield* fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore);
    yield* git(repository, ["worktree", "prune"]).pipe(Effect.ignore);
  });

  /**
   * Fetches the remote and moves the ref's worktree to its commit, running the ref's own setup
   * script when the commit changed. `canSync` is checked once the repository lock is held, so a
   * run that started meanwhile keeps its checkout.
   */
  const sync = Effect.fn("QaCheckouts.sync")(function* (
    target: QaCheckoutTarget,
    canSync: () => boolean,
    onProgress: (line: string) => Effect.Effect<void> = () => Effect.void,
  ) {
    const { key, ref } = target;
    return yield* lockFor(key).withPermit(
      Effect.gen(function* () {
        if (!canSync()) return yield* new QaError({ reason: "busy" });
        const root = yield* repositoryDirectory(key);
        const repository = path.join(root, "repository.git");
        const directory = yield* checkoutPath(key, ref);
        yield* setState(key, ref, "syncing");
        const work = Effect.gen(function* () {
          yield* fs.makeDirectory(path.join(root, "refs"), { recursive: true });
          if (!(yield* fs.exists(repository))) {
            yield* onProgress(`Cloning ${target.remoteUrl}…`);
            yield* git(
              root,
              ["clone", "--bare", "--quiet", target.remoteUrl, repository],
              "30 minutes",
            );
            // Bare clones map remote branches onto local ones only at clone time.
            yield* git(repository, ["config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"]);
          }
          yield* onProgress(`Fetching ${target.remoteUrl}…`);
          yield* git(
            repository,
            ["fetch", "--quiet", "--prune", "--prune-tags", "--tags", "--force", "origin"],
            "10 minutes",
          );
          const branch = yield* resolveCommit(repository, `refs/heads/${ref}`);
          const commit = branch ?? (yield* resolveCommit(repository, `refs/tags/${ref}`));
          if (!commit) return yield* new QaError({ reason: "ref" });
          const registry = yield* readRegistry(key);
          const previous = registry.find((entry) => entry.ref === ref);
          const exists = yield* fs.exists(directory);
          yield* onProgress(`Checking out ${ref} at ${commit.slice(0, 8)}…`);
          if (!exists) {
            yield* git(repository, ["worktree", "prune"]);
            yield* git(
              repository,
              ["worktree", "add", "--detach", "--force", "--quiet", directory, commit],
              "10 minutes",
            );
          } else {
            yield* git(directory, ["reset", "--hard", "--quiet"]);
            yield* git(
              directory,
              ["checkout", "--detach", "--force", "--quiet", commit],
              "10 minutes",
            );
            // Ignored files stay, so installed dependencies and build caches are reused.
            yield* git(directory, ["clean", "-ffdq"]);
          }
          const syncedAt = DateTime.formatIso(yield* DateTime.now);
          const ready = exists && previous?.commit === commit && previous.ready;
          const others = registry.filter((entry) => entry.ref !== ref);
          yield* writeRegistry(key, [...others, { ref, commit, syncedAt, ready }]);
          if (!ready) {
            yield* setState(key, ref, "setup");
            yield* onProgress("Running the setup script from t3.json…");
            yield* runSetup(target, directory);
            yield* writeRegistry(key, [...others, { ref, commit, syncedAt, ready: true }]);
          }
          const cutoff = Date.parse(syncedAt) - Duration.toMillis(UNUSED_CHECKOUT_TTL);
          const expired = others.filter((entry) => Date.parse(entry.syncedAt) < cutoff);
          if (expired.length) {
            for (const entry of expired)
              yield* removeDirectory(repository, yield* checkoutPath(key, entry.ref));
            yield* writeRegistry(key, [
              ...others.filter((entry) => !expired.includes(entry)),
              { ref, commit, syncedAt, ready: true },
            ]);
          }
          return { root: directory, commit, isTag: branch === null };
        });
        return yield* work.pipe(
          Effect.tap(() =>
            Effect.suspend(() => {
              live.delete(liveKey(key, ref));
              return notify(key);
            }),
          ),
          Effect.tapError((error) =>
            setState(
              key,
              ref,
              "failed",
              error._tag === "QaError"
                ? `${ref} was not found on ${target.remoteUrl}.`
                : error._tag === "CheckoutFailure"
                  ? error.detail
                  : "QA could not prepare its checkout.",
            ),
          ),
          Effect.mapError((error) =>
            error._tag === "QaError" ? error : new QaError({ reason: "checkout", cause: error }),
          ),
        );
      }),
    );
  });

  const status = Effect.fn("QaCheckouts.status")(function* (key: string, ref: string) {
    const entry = (yield* readRegistry(key)).find((candidate) => candidate.ref === ref);
    const current = live.get(liveKey(key, ref));
    return {
      state: current?.state ?? (entry ? (entry.ready ? "ready" : "failed") : "missing"),
      path: yield* checkoutPath(key, ref),
      commit: entry?.commit ?? null,
      syncedAt: entry?.syncedAt ?? null,
      error: current?.error ?? (entry && !entry.ready ? "The setup script did not finish." : null),
    } satisfies QaCheckout;
  });

  const refs = (key: string) =>
    readRegistry(key).pipe(Effect.map((entries) => entries.map((entry) => entry.ref)));

  /** The default branch: the clone's, else the project's remote HEAD, else `main`. */
  const defaultBranch = Effect.fn("QaCheckouts.defaultBranch")(function* (
    key: string,
    projectRoot: string,
    remoteName: string,
  ) {
    const repository = path.join(yield* repositoryDirectory(key), "repository.git");
    const cloned = (yield* fs.exists(repository))
      ? yield* git(repository, ["symbolic-ref", "--short", "HEAD"]).pipe(
          Effect.orElseSucceed(() => null),
        )
      : null;
    if (cloned) return cloned;
    const remoteHead = yield* git(projectRoot, [
      "symbolic-ref",
      "--short",
      `refs/remotes/${remoteName}/HEAD`,
    ]).pipe(Effect.orElseSucceed(() => null));
    return remoteHead?.startsWith(`${remoteName}/`)
      ? remoteHead.slice(remoteName.length + 1)
      : "main";
  });

  const remove = Effect.fn("QaCheckouts.remove")(
    function* (key: string, ref: string, canRemove: () => boolean) {
      yield* lockFor(key).withPermit(
        Effect.gen(function* () {
          if (!canRemove()) return yield* new QaError({ reason: "busy" });
          const repository = path.join(yield* repositoryDirectory(key), "repository.git");
          yield* removeDirectory(repository, yield* checkoutPath(key, ref));
          yield* writeRegistry(
            key,
            (yield* readRegistry(key)).filter((entry) => entry.ref !== ref),
          );
          live.delete(liveKey(key, ref));
        }),
      );
      yield* notify(key);
    },
    Effect.mapError((cause) =>
      cause._tag === "QaError" ? cause : new QaError({ reason: "storage", cause }),
    ),
  );

  return { checkoutPath, sync, status, refs, defaultBranch, remove };
});

export type QaCheckouts = Effect.Success<ReturnType<typeof makeQaCheckouts>>;
