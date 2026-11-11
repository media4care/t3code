import {
  GIT_EXPLORER_RELEASE_REMOTE,
  GitExplorerError,
  gitExplorerReleaseSourceKind,
  type GitCommandError,
  type GitExplorerRunActionInput,
  type GitExplorerRunActionResult,
  type GitExplorerCommit,
  type GitExplorerBranchStatus,
  type GitExplorerBranchStatusesInput,
  type GitExplorerBranchStatusesResult,
  type GitExplorerDeleteBranchInput,
  type GitExplorerDetailsInput,
  type GitExplorerDetailsResult,
  type GitExplorerFile,
  type GitExplorerFileStage,
  type GitExplorerHistoryInput,
  type GitExplorerHistoryResult,
  type GitExplorerOverviewInput,
  type GitExplorerOverviewResult,
  type GitExplorerPatchInput,
  type GitExplorerPatchResult,
  type GitExplorerRef,
  type GitExplorerReleasePlanInput,
  type GitExplorerReleasePlanResult,
  type GitExplorerStash,
  type GitExplorerSubmodule,
  type GitExplorerWorktree,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { latestReleaseBranch, nextReleaseTag } from "./gitExplorerRelease.ts";

export class GitExplorer extends Context.Service<
  GitExplorer,
  {
    readonly overview: (
      input: GitExplorerOverviewInput,
    ) => Effect.Effect<GitExplorerOverviewResult, GitExplorerError>;
    readonly branchStatuses: (
      input: GitExplorerBranchStatusesInput,
    ) => Effect.Effect<GitExplorerBranchStatusesResult, GitExplorerError>;
    readonly deleteBranch: (
      input: GitExplorerDeleteBranchInput,
    ) => Effect.Effect<void, GitExplorerError>;
    readonly runAction: (
      input: GitExplorerRunActionInput,
    ) => Effect.Effect<GitExplorerRunActionResult, GitExplorerError | GitCommandError>;
    readonly releasePlan: (
      input: GitExplorerReleasePlanInput,
    ) => Effect.Effect<GitExplorerReleasePlanResult, GitExplorerError | GitCommandError>;
    readonly history: (
      input: GitExplorerHistoryInput,
    ) => Effect.Effect<GitExplorerHistoryResult, GitExplorerError>;
    readonly details: (
      input: GitExplorerDetailsInput,
    ) => Effect.Effect<GitExplorerDetailsResult, GitExplorerError>;
    readonly patch: (
      input: GitExplorerPatchInput,
    ) => Effect.Effect<GitExplorerPatchResult, GitExplorerError>;
  }
>()("t3/git/GitExplorer") {}

const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s";
const DIFF_OPTIONS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--ignore-submodules=dirty",
  "--find-renames=50%",
  "-l1000",
];
const MAX_FILES = 2_000;
const MAX_REFS = 2_048;
const REF_FORMAT = "--format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)";
const MAX_STASHES = 200;
const MAX_SUBMODULES = 256;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_ANCESTORS = 25_000;
const MAX_MERGE_COMMITS = 4_000;
const MAX_MERGE_ASSESSMENTS = 4_096;
const SNAPSHOT_TTL_MS = 30 * 60_000;

type Snapshot = {
  signature: string;
  shallowBoundary: string;
  overview: GitExplorerOverviewResult;
  projectId: string;
  commonDirectory: string;
  tips: readonly string[];
  touchedAt: number;
  mergeConfig: { signature: string; remotes: string[]; bases: Map<string, string> };
  remoteHeads: Map<string, string>;
  refsByName: Map<string, GitExplorerRef>;
  branchStatuses: Map<string, GitExplorerBranchStatus>;
  ancestors?: {
    local: Set<string>;
    upstream: Set<string>;
    localComplete: boolean;
    upstreamComplete: boolean;
  };
};

function commitsFromOutput(output: string): GitExplorerCommit[] {
  const fields = output.split("\0");
  const result: GitExplorerCommit[] = [];
  for (let i = 0; i + 6 < fields.length; i += 7) {
    const hash = fields[i]!;
    if (!HASH.test(hash)) break;
    result.push({
      hash,
      parents: fields[i + 1]!.split(" ").filter(Boolean),
      authorName: fields[i + 2]!,
      authorEmail: fields[i + 3]!,
      authoredAt: fields[i + 4]!,
      committedAt: fields[i + 5]!,
      subject: fields[i + 6]!,
      upstreamStatus: "unknown",
    });
  }
  return result;
}

function parseWorktrees(output: string): GitExplorerWorktree[] {
  return output.split("\0\0").flatMap((record) => {
    const fields = record.split("\0");
    const path = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (!path) return [];
    const head = fields.find((field) => field.startsWith("HEAD "))?.slice(5) ?? null;
    return [
      {
        path,
        headHash: head && !/^0+$/.test(head) ? head : null,
        branch:
          fields
            .find((field) => field.startsWith("branch "))
            ?.slice(7)
            .replace(/^refs\/heads\//, "") ?? null,
        bare: fields.includes("bare"),
        locked: fields.some((field) => field === "locked" || field.startsWith("locked ")),
      },
    ];
  });
}

function parseFiles(output: string, stage: GitExplorerFileStage): GitExplorerFile[] {
  const tokens = output.split("\0");
  const files: GitExplorerFile[] = [];
  const byPath = new Map<string, number>();
  let i = 0;
  while (tokens[i]?.startsWith(":")) {
    const code = tokens[i++]!.split(" ").at(-1)!.charAt(0);
    const firstPath = tokens[i++];
    const renamed = code === "R" || code === "C";
    const filePath = renamed ? tokens[i++] : firstPath;
    if (!filePath || !firstPath) break;
    const status =
      code === "A"
        ? "added"
        : code === "D"
          ? "deleted"
          : code === "R"
            ? "renamed"
            : code === "C"
              ? "copied"
              : code === "U"
                ? "unmerged"
                : "modified";
    const file: GitExplorerFile = {
      path: filePath,
      oldPath: renamed ? firstPath : null,
      status,
      stage,
      additions: null,
      deletions: null,
      binary: false,
    };
    const previousIndex = byPath.get(filePath);
    if (previousIndex === undefined) {
      byPath.set(filePath, files.length);
      files.push(file);
    } else {
      files[previousIndex] = {
        ...file,
        status: files[previousIndex]?.status === "unmerged" ? "unmerged" : status,
      };
    }
  }
  while (i < tokens.length) {
    const row = tokens[i++]!;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(row);
    if (!match) continue;
    let filePath = match[3]!;
    if (filePath === "") {
      i++;
      filePath = tokens[i++] ?? "";
    }
    const index = byPath.get(filePath);
    const file = index === undefined ? undefined : files[index];
    if (file && index !== undefined) {
      // Numstat and raw entries come from the same Git invocation, including rename detection.
      const updated = {
        ...file,
        additions: match[1] === "-" ? null : Number(match[1]),
        deletions: match[2] === "-" ? null : Number(match[2]),
        binary: match[1] === "-",
      };
      files[index] = updated;
    }
  }
  return files;
}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const digest = yield* Digest.Digest;
  const random = yield* SecureRandom.SecureRandom;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const snapshots = new Map<string, Snapshot>();
  const mergeAssessments = new Map<
    string,
    Pick<GitExplorerBranchStatus, "mergeStatus" | "reason">
  >();
  const mutationLocks = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();
  const contentToken = Effect.fn("GitExplorer.contentToken")((value: string) =>
    digest.digestHex(Digest.sha256, new TextEncoder().encode(value)),
  );

  const run = Effect.fn("GitExplorer.readGit")(function* (
    cwd: string,
    args: readonly string[],
    options?: { maxBytes?: number; truncate?: boolean; allowNonZero?: boolean; stdin?: string },
  ) {
    return yield* git
      .execute({
        operation: "GitExplorer.readGit",
        cwd,
        ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
        args: [
          "--no-optional-locks",
          "--literal-pathspecs",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "gc.auto=0",
          "-c",
          "maintenance.auto=false",
          ...args,
        ],
        env: {
          GIT_OPTIONAL_LOCKS: "0",
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_NO_REPLACE_OBJECTS: "1",
        },
        timeoutMs: 15_000,
        maxOutputBytes: options?.maxBytes ?? 4 * 1024 * 1024,
        appendTruncationMarker: options?.truncate ?? false,
        allowNonZeroExit: options?.allowNonZero ?? false,
      })
      .pipe(
        Effect.mapError(
          (cause) => new GitExplorerError({ operation: "git", reason: "read-failed", cause }),
        ),
      );
  });
  const canonical = Effect.fn("GitExplorer.canonicalPath")(function* (value: string) {
    return yield* fs
      .realPath(value)
      .pipe(
        Effect.mapError(
          (cause) =>
            new GitExplorerError({ operation: "worktree", reason: "invalid-worktree", cause }),
        ),
      );
  });
  const resolveSubmodule = Effect.fn("GitExplorer.resolveSubmodule")(function* (
    worktree: string,
    submodulePath: string,
  ) {
    const invalid = () =>
      new GitExplorerError({ operation: "submodule", reason: "invalid-submodule" });
    const target = yield* canonical(path.join(worktree, submodulePath)).pipe(
      Effect.mapError(invalid),
    );
    if ((yield* fs.stat(target).pipe(Effect.mapError(invalid))).type !== "Directory")
      return yield* invalid();
    // Walk superprojects so nested submodules resolve, but only within the selected worktree.
    let current = target;
    for (let depth = 0; depth < 8; depth++) {
      if (!current.startsWith(`${worktree}${path.sep}`)) return yield* invalid();
      const result = yield* run(
        current,
        ["rev-parse", "--show-toplevel", "--show-superproject-working-tree"],
        { allowNonZero: true },
      ).pipe(Effect.mapError(invalid));
      const [toplevel, superproject] = result.stdout.trim().split("\n");
      if (result.exitCode !== 0 || !toplevel || !superproject) return yield* invalid();
      if ((yield* canonical(toplevel).pipe(Effect.mapError(invalid))) !== current)
        return yield* invalid();
      current = yield* canonical(superproject).pipe(Effect.mapError(invalid));
      if (current === worktree) return target;
    }
    return yield* invalid();
  });
  const resolveRepository = Effect.fn("GitExplorer.resolveRepository")(function* (
    root: string,
    worktreePath: string | undefined,
  ) {
    const commonDirectory = yield* canonical(
      (yield* run(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim(),
    );
    const worktreeOutput = (yield* run(root, ["worktree", "list", "--porcelain", "-z"])).stdout;
    const worktrees = parseWorktrees(worktreeOutput);
    // A submodule's main worktree is listed at its administrative directory, not its checkout.
    const main = worktrees[0];
    if (
      main &&
      !main.bare &&
      (yield* canonical(main.path).pipe(Effect.orElseSucceed(() => null))) === commonDirectory
    )
      worktrees[0] = { ...main, path: root };
    const cwd = worktreePath === undefined ? root : yield* canonical(worktreePath);
    const selected = yield* Effect.findFirst(worktrees, (worktree) =>
      canonical(worktree.path).pipe(
        Effect.map((value) => value === cwd),
        Effect.orElseSucceed(() => false),
      ),
    );
    if (Option.isNone(selected) || selected.value.bare)
      return yield* new GitExplorerError({ operation: "worktree", reason: "invalid-worktree" });
    // The worktree list can race removal/replacement by an agent. Verify its repository again.
    const actualCommon = yield* canonical(
      (yield* run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim(),
    );
    if (actualCommon !== commonDirectory)
      return yield* new GitExplorerError({ operation: "worktree", reason: "invalid-worktree" });
    return { cwd, root, commonDirectory, worktrees, worktreeOutput, selected: selected.value };
  });
  const resolve = Effect.fn("GitExplorer.resolve")(function* (input: GitExplorerOverviewInput) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new GitExplorerError({ operation: "project", reason: "read-failed", cause }),
        ),
      );
    if (Option.isNone(project))
      return yield* new GitExplorerError({ operation: "project", reason: "project-not-found" });
    const workspace = yield* canonical(project.value.workspaceRoot);
    const root = yield* canonical(
      (yield* run(workspace, ["rev-parse", "--show-toplevel"])).stdout.trim(),
    );
    const repository = yield* resolveRepository(root, input.worktreePath);
    if (input.submodulePath === undefined) return repository;
    return yield* resolveRepository(
      yield* resolveSubmodule(repository.cwd, input.submodulePath),
      undefined,
    );
  });
  const readShallowBoundary = Effect.fn("GitExplorer.readShallowBoundary")(function* (
    commonDirectory: string,
  ) {
    return yield* fs.readFileString(path.join(commonDirectory, "shallow")).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      Effect.mapError(
        (cause) =>
          new GitExplorerError({ operation: "shallow-boundary", reason: "read-failed", cause }),
      ),
    );
  });
  const readStashes = Effect.fn("GitExplorer.readStashes")(function* (cwd: string) {
    const output = yield* run(cwd, [
      "stash",
      "list",
      `--max-count=${MAX_STASHES + 1}`,
      "--format=%H%x00%gs%x00%cI",
      "-z",
      "--no-color",
      "--no-show-signature",
    ]);
    const fields = output.stdout.split("\0");
    const stashes: GitExplorerStash[] = [];
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const hash = fields[i]!;
      if (!HASH.test(hash))
        return yield* new GitExplorerError({ operation: "stashes", reason: "read-failed" });
      stashes.push({
        name: `stash@{${stashes.length}}`,
        hash,
        subject: fields[i + 1]!,
        createdAt: fields[i + 2]!,
      });
    }
    if (stashes.length > MAX_STASHES)
      return yield* new GitExplorerError({ operation: "stashes", reason: "too-large" });
    return { stashes, signature: output.stdout };
  });
  const readSubmoduleHead = Effect.fn("GitExplorer.readSubmoduleHead")(function* (
    checkout: string,
  ) {
    if (!(yield* fs.exists(path.join(checkout, ".git")))) return null;
    const result = yield* run(checkout, ["rev-parse", "--show-toplevel", "HEAD"], {
      allowNonZero: true,
    });
    const [toplevel, hash] = result.stdout.trim().split("\n");
    // An empty checkout resolves to the superproject, which must not count as initialized.
    if (result.exitCode !== 0 || !toplevel || !hash || !HASH.test(hash)) return null;
    return (yield* canonical(toplevel)) === (yield* canonical(checkout)) ? hash : null;
  });
  const readSubmodules = Effect.fn("GitExplorer.readSubmodules")(function* (cwd: string) {
    if (!(yield* fs.exists(path.join(cwd, ".gitmodules")).pipe(Effect.orElseSucceed(() => false))))
      return [];
    const config = yield* run(
      cwd,
      [
        "config",
        "--file",
        ".gitmodules",
        "--null",
        "--get-regexp",
        "^submodule\\..*\\.(path|url)$",
      ],
      { allowNonZero: true, maxBytes: 256 * 1024 },
    );
    // A malformed .gitmodules should not hide the rest of the repository.
    if (config.exitCode !== 0) return [];
    const modules = new Map<string, { name: string; path?: string; url?: string }>();
    for (const record of config.stdout.split("\0")) {
      const split = record.indexOf("\n");
      const match = split < 0 ? null : /^submodule\.(.*)\.(path|url)$/.exec(record.slice(0, split));
      if (!match) continue;
      const module = modules.get(match[1]!) ?? { name: match[1]! };
      module[match[2] as "path" | "url"] = record.slice(split + 1);
      modules.set(match[1]!, module);
    }
    const byPath = new Map(
      [...modules.values()].flatMap((module) => (module.path ? [[module.path, module]] : [])),
    );
    const paths = [...byPath.keys()].toSorted().slice(0, MAX_SUBMODULES);
    if (paths.length === 0) return [];
    const recorded = new Map<string, string | null>();
    for (const entry of (yield* run(cwd, [
      "ls-files",
      "--stage",
      "-z",
      "--",
      ...paths,
    ])).stdout.split("\0")) {
      const tab = entry.indexOf("\t");
      const [mode, hash, stage] = entry.slice(0, tab).split(" ");
      const entryPath = entry.slice(tab + 1);
      if (tab < 0 || mode !== "160000" || !hash || !HASH.test(hash) || !byPath.has(entryPath))
        continue;
      // Conflicted gitlinks have no single recorded commit.
      recorded.set(entryPath, stage === "0" && !recorded.has(entryPath) ? hash : null);
    }
    return yield* Effect.forEach(
      [...recorded],
      ([submodulePath, recordedHash]) =>
        Effect.gen(function* () {
          const headHash = yield* readSubmoduleHead(path.join(cwd, submodulePath)).pipe(
            Effect.orElseSucceed(() => null),
          );
          const module = byPath.get(submodulePath)!;
          const submodule: GitExplorerSubmodule = {
            name: module.name,
            path: submodulePath,
            url: module.url ?? null,
            recordedHash,
            headHash,
            state:
              recordedHash === null
                ? "conflicted"
                : headHash === null
                  ? "uninitialized"
                  : headHash === recordedHash
                    ? "in-sync"
                    : "out-of-sync",
          };
          return submodule;
        }),
      { concurrency: 4 },
    );
  });
  const findStash = Effect.fn("GitExplorer.findStash")(function* (
    cwd: string,
    commonDirectory: string,
    projectId: string,
    revision: string,
  ) {
    const live = (yield* readStashes(cwd)).stashes.find((stash) => stash.hash === revision);
    if (live) return live;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    for (const snapshot of [...snapshots.values()].toReversed()) {
      if (
        snapshot.projectId !== projectId ||
        snapshot.commonDirectory !== commonDirectory ||
        now - snapshot.touchedAt > SNAPSHOT_TTL_MS
      )
        continue;
      const captured = snapshot.overview.stashes.find((stash) => stash.hash === revision);
      if (captured) return captured;
    }
    return null;
  });
  const readMergeConfig = Effect.fn("GitExplorer.readMergeConfig")(function* (cwd: string) {
    const result = yield* run(
      cwd,
      [
        "config",
        "--null",
        "--get-regexp",
        "^(branch\\..*\\.(t3-merge-base-ref|gh-merge-base)|remote\\..*\\.url)$",
      ],
      { allowNonZero: true, maxBytes: 256 * 1024 },
    );
    if (result.exitCode !== 0 && result.exitCode !== 1)
      return yield* new GitExplorerError({ operation: "branch-config", reason: "read-failed" });
    const bases = new Map<string, string>();
    const remotes = new Set<string>();
    const records = result.stdout.split("\0").flatMap((record) => {
      const split = record.indexOf("\n");
      return split < 0 ? [] : [[record.slice(0, split), record.slice(split + 1)] as const];
    });
    for (const [key, value] of records) {
      const remote = /^remote\.(.*)\.url$/.exec(key);
      if (remote) remotes.add(remote[1]!);
      const branch = /^branch\.(.*)\.gh-merge-base$/.exec(key);
      if (branch) bases.set(`refs/heads/${branch[1]}`, value);
    }
    for (const [key, value] of records) {
      const branch = /^branch\.(.*)\.t3-merge-base-ref$/.exec(key);
      if (branch) bases.set(`refs/heads/${branch[1]}`, value);
    }
    return { signature: result.stdout, remotes: [...remotes], bases };
  });
  const listRefs = Effect.fn("GitExplorer.listRefs")(function* (
    cwd: string,
    args: readonly string[],
  ) {
    return (yield* run(cwd, ["for-each-ref", REF_FORMAT, ...args])).stdout
      .split("\n")
      .filter(Boolean);
  });
  // Remotes like a fork's upstream can carry thousands of branches. Keep every local branch,
  // the remote refs they track or compare against, then the newest remaining refs.
  const readRefLines = Effect.fn("GitExplorer.readRefLines")(function* (cwd: string) {
    const locals = yield* listRefs(cwd, [`--count=${MAX_REFS + 1}`, "refs/heads"]);
    if (locals.length > MAX_REFS)
      return yield* new GitExplorerError({ operation: "refs", reason: "too-large" });
    const newest = yield* listRefs(cwd, [
      "--sort=-creatordate",
      `--count=${MAX_REFS}`,
      "refs/remotes",
      "refs/tags",
    ]);
    let lines = [...locals, ...newest];
    if (newest.length === MAX_REFS) {
      const remoteHeads = yield* listRefs(cwd, ["refs/remotes/*/HEAD"]);
      const patterns = new Set([
        "refs/remotes/*/main",
        "refs/remotes/*/master",
        ...[...locals, ...remoteHeads].flatMap((line) => {
          const [, , upstream, symbolic] = line.split("\0");
          return [upstream, symbolic].filter((name): name is string => !!name);
        }),
        ...[...(yield* readMergeConfig(cwd)).bases.values()].flatMap((base) => {
          const short = base.replace(/^refs\/(heads|remotes)\//, "");
          return [
            ...(base.startsWith("refs/") ? [base] : []),
            `refs/remotes/${short}`,
            `refs/remotes/*/${short}`,
          ];
        }),
      ]);
      const essentials = yield* listRefs(cwd, [...patterns]);
      const byName = new Map<string, string>();
      for (const line of [...locals, ...remoteHeads, ...essentials, ...newest]) {
        if (byName.size >= MAX_REFS) break;
        const name = line.slice(0, line.indexOf("\0"));
        if (!byName.has(name)) byName.set(name, line);
      }
      lines = [...byName.values()];
    }
    // NUL ends each refname, so sorting whole lines sorts by refname like for-each-ref does.
    return lines.toSorted().join("\n");
  });
  const readOverviewState = Effect.fn("GitExplorer.readOverviewState")(function* (
    input: GitExplorerOverviewInput,
  ) {
    // A commit can move the branch between worktree enumeration and ref enumeration.
    for (let attempt = 0; attempt < 2; attempt++) {
      const context = yield* resolve(input);
      const output = { stdout: yield* readRefLines(context.cwd) };
      const currentBranchHash =
        context.selected.branch === null
          ? null
          : (output.stdout
              .split("\n")
              .map((line) => line.split("\0"))
              .find(([name]) => name === `refs/heads/${context.selected.branch}`)?.[1] ?? null);
      if (context.selected.branch === null || currentBranchHash === context.selected.headHash)
        return { context, output };
    }
    return yield* new GitExplorerError({
      operation: "concurrent-head-change",
      reason: "read-failed",
    });
  });
  const overview: GitExplorer["Service"]["overview"] = Effect.fn("GitExplorer.overview")(
    function* (input) {
      const { context, output } = yield* readOverviewState(input);
      const { cwd, root, commonDirectory, worktrees, selected } = context;
      const shallowBoundary = yield* readShallowBoundary(commonDirectory);
      const mergeConfig = yield* readMergeConfig(cwd);
      const records = output.stdout
        .trimEnd()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\0"));
      const tagRecords = records.filter(
        ([name, hash]) => name?.startsWith("refs/tags/") && hash && HASH.test(hash),
      );
      const peeledTags = new Map<string, string>();
      if (tagRecords.length > 0) {
        // Batch peeling handles annotated and nested tags without spawning one process per tag.
        const peeled = yield* run(cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
          stdin: tagRecords.map(([, hash]) => `${hash}^{commit}\n`).join(""),
        });
        for (const [index, row] of peeled.stdout.trimEnd().split("\n").entries()) {
          const [hash, type] = row.split(" ");
          const name = tagRecords[index]?.[0];
          if (name && hash && HASH.test(hash) && type === "commit") peeledTags.set(name, hash);
        }
      }
      const refs: GitExplorerRef[] = records.flatMap(([name, objectHash, upstream, symbolic]) => {
        if (!name || !objectHash || symbolic || !HASH.test(objectHash)) return [];
        const local = name.startsWith("refs/heads/");
        const tag = name.startsWith("refs/tags/");
        const hash = tag ? peeledTags.get(name) : objectHash;
        if (!hash) return [];
        return [
          {
            name,
            shortName: name.replace(/^refs\/(heads|remotes|tags)\//, ""),
            kind: local ? "local" : tag ? "tag" : "remote",
            hash,
            upstream: local ? upstream || null : null,
            ahead: null,
            behind: null,
            upstreamMissing: false,
          },
        ];
      });
      const { stashes, signature: stashSignature } = yield* readStashes(cwd);
      const submodules = yield* readSubmodules(cwd);
      const fetchPath = (yield* run(cwd, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "FETCH_HEAD",
      ])).stdout.trim();
      const fetchTimes = yield* Effect.forEach(
        [...new Set([fetchPath, path.join(commonDirectory, "FETCH_HEAD")])],
        (filePath) =>
          fs.stat(filePath).pipe(
            Effect.map((stat) =>
              stat.size > 0n
                ? Option.getOrNull(Option.map(stat.mtime, (date) => date.toISOString()))
                : null,
            ),
            Effect.orElseSucceed(() => null),
          ),
      );
      const lastFetchAt =
        fetchTimes
          .filter((time) => time !== null)
          .sort()
          .at(-1) ?? null;
      const signature = [
        input.projectId,
        commonDirectory,
        cwd,
        context.worktreeOutput,
        output.stdout,
        shallowBoundary,
        stashSignature,
        submodules
          .map((submodule) =>
            [
              submodule.name,
              submodule.path,
              submodule.url,
              submodule.recordedHash,
              submodule.headHash,
              submodule.state,
            ].join("\0"),
          )
          .join("\n"),
        mergeConfig.signature,
      ]
        .map((value) => `${value.length}:${value}`)
        .join("");
      const signatureHash = yield* digest.digestHex(
        Digest.sha256,
        new TextEncoder().encode(signature),
      );
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const cached = [...snapshots.values()].find(
        (snapshot) =>
          snapshot.signature === signatureHash && now - snapshot.touchedAt <= SNAPSHOT_TTL_MS,
      );
      if (cached) {
        cached.touchedAt = now;
        return { ...cached.overview, lastFetchAt };
      }
      const snapshotId = yield* random.uuidV4();
      const hashes = new Map(refs.map((ref) => [ref.name, ref.hash]));
      const resolvedRefs = yield* Effect.forEach(
        refs,
        (ref) =>
          Effect.gen(function* () {
            if (!ref.upstream) return ref;
            const upstreamHash = hashes.get(ref.upstream);
            if (!upstreamHash) return { ...ref, upstreamMissing: true };
            const counts = (yield* run(cwd, [
              "rev-list",
              "--left-right",
              "--count",
              `${ref.hash}...${upstreamHash}`,
              "--",
            ])).stdout
              .trim()
              .split(/\s+/)
              .map(Number);
            return { ...ref, ahead: counts[0] ?? 0, behind: counts[1] ?? 0 };
          }),
        { concurrency: 4 },
      );
      if ((yield* readShallowBoundary(commonDirectory)) !== shallowBoundary)
        return yield* new GitExplorerError({
          operation: "concurrent-shallow-change",
          reason: "read-failed",
        });
      const result: GitExplorerOverviewResult = {
        repositoryPath: worktrees[0]?.path ?? root,
        selectedWorktreePath: cwd,
        headHash: selected.headHash,
        headBranch: selected.branch,
        worktrees,
        refs: resolvedRefs,
        stashes,
        submodules,
        remotes: mergeConfig.remotes,
        lastFetchAt,
        snapshotId,
      };
      for (const [key, value] of snapshots)
        if (now - value.touchedAt > SNAPSHOT_TTL_MS) snapshots.delete(key);
      if (snapshots.size >= 8) {
        const oldest = [...snapshots].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
        if (oldest) snapshots.delete(oldest[0]);
      }
      snapshots.set(snapshotId, {
        signature: signatureHash,
        shallowBoundary,
        mergeConfig,
        remoteHeads: new Map(
          records.flatMap(([name, , , symbolic]) => (name && symbolic ? [[name, symbolic]] : [])),
        ),
        branchStatuses: new Map(),
        refsByName: new Map(refs.map((ref) => [ref.name, ref])),
        overview: result,
        projectId: input.projectId,
        commonDirectory,
        tips: [
          ...new Set([
            ...refs.map((ref) => ref.hash),
            ...worktrees.flatMap((worktree) => (worktree.headHash ? [worktree.headHash] : [])),
          ]),
        ],
        touchedAt: now,
      });
      return result;
    },
  );
  const baseForBranch = (snapshot: Snapshot, branch: string): string | null => {
    const refs = snapshot.refsByName;
    const remotes = snapshot.mergeConfig.remotes;
    const remote = remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null;
    const configured = snapshot.mergeConfig.bases.get(branch);
    if (configured) {
      const short = configured.replace(/^refs\/heads\//, "");
      const candidates = configured.startsWith("refs/remotes/")
        ? [configured]
        : [
            ...(remote ? [`refs/remotes/${remote}/${short}`] : []),
            `refs/remotes/${configured}`,
            ...(remotes.length === 0 ? [`refs/heads/${short}`] : []),
          ];
      return candidates.find((candidate) => refs.has(candidate)) ?? null;
    }
    if (remote) {
      const head = snapshot.remoteHeads.get(`refs/remotes/${remote}/HEAD`);
      if (head && refs.has(head)) return head;
    }
    const candidates = remote
      ? [`refs/remotes/${remote}/main`, `refs/remotes/${remote}/master`]
      : remotes.length === 0
        ? ["refs/heads/main", "refs/heads/master"]
        : [];
    const available = candidates.filter((candidate) => refs.has(candidate));
    return available.length === 1 ? available[0]! : null;
  };
  const protectedBranch = (snapshot: Snapshot, ref: GitExplorerRef) => {
    if (ref.shortName === "main" || ref.shortName === "master") return true;
    const bases = new Set([
      ...snapshot.remoteHeads.values(),
      ...snapshot.overview.refs
        .filter((candidate) => candidate.kind === "local")
        .flatMap((candidate) => {
          const base = baseForBranch(snapshot, candidate.name);
          return base ? [base] : [];
        }),
    ]);
    return [...bases].some(
      (base) =>
        base === ref.name ||
        snapshot.mergeConfig.remotes.some(
          (remote) => base === `refs/remotes/${remote}/${ref.shortName}`,
        ),
    );
  };
  // Untracked symlinks (agents link node_modules into worktrees) lose nothing when removed.
  const worktreeIsClean = Effect.fn("GitExplorer.worktreeIsClean")(function* (cwd: string) {
    const status = yield* run(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], {
      allowNonZero: true,
    });
    if (status.exitCode !== 0) return false;
    const entries = status.stdout.split("\0").filter(Boolean);
    if (entries.length > 32 || entries.some((entry) => !entry.startsWith("?? "))) return false;
    const links = yield* Effect.forEach(
      entries,
      (entry) =>
        entry.endsWith("/")
          ? Effect.succeed(false)
          : fs.readLink(path.join(cwd, entry.slice(3))).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
      { concurrency: 4 },
    );
    return links.every(Boolean);
  });
  // A clean linked worktree holding the branch is removed with it; any other checkout blocks deletion.
  const branchWorktree = Effect.fn("GitExplorer.branchWorktree")(function* (
    worktrees: readonly GitExplorerWorktree[],
    selectedPath: string,
    ref: GitExplorerRef,
  ): Effect.fn.Return<
    Pick<GitExplorerBranchStatus, "deleteBlockedReason" | "checkedOutAt">,
    GitExplorerError
  > {
    const index = worktrees.findIndex((worktree) => worktree.branch === ref.shortName);
    if (index === -1) return { deleteBlockedReason: null };
    const worktree = worktrees[index]!;
    if (index === 0 || worktree.bare) return { deleteBlockedReason: "checked-out" };
    const checkout = yield* canonical(worktree.path).pipe(Effect.orElseSucceed(() => null));
    if (checkout === null || checkout === selectedPath)
      return { deleteBlockedReason: "checked-out" };
    const removable = !worktree.locked && (yield* worktreeIsClean(checkout));
    return { deleteBlockedReason: removable ? null : "checked-out", checkedOutAt: worktree.path };
  });
  const branchDeletionContext = Effect.fn("GitExplorer.branchDeletionContext")(function* (
    snapshot: Snapshot,
    ref: GitExplorerRef,
  ) {
    const targetRef = baseForBranch(snapshot, ref.name);
    const targetHash = targetRef ? (snapshot.refsByName.get(targetRef)?.hash ?? null) : null;
    return {
      name: ref.name,
      hash: ref.hash,
      targetRef,
      targetHash,
      mergeStatus: "unknown",
      reason: null,
      ...(protectedBranch(snapshot, ref)
        ? { deleteBlockedReason: "protected" }
        : yield* branchWorktree(
            snapshot.overview.worktrees,
            snapshot.overview.selectedWorktreePath,
            ref,
          )),
    } satisfies GitExplorerBranchStatus;
  });
  const computeMergeAssessment = Effect.fn("GitExplorer.computeMergeAssessment")(
    function* (
      snapshot: Snapshot,
      hash: string,
      targetHash: string | null,
    ): Effect.fn.Return<Pick<GitExplorerBranchStatus, "mergeStatus" | "reason">, GitExplorerError> {
      if (!targetHash) return { mergeStatus: "unknown", reason: "missing-base" };
      if (snapshot.shallowBoundary) return { mergeStatus: "unknown", reason: "shallow" };
      const cached = mergeAssessments.get(`${snapshot.commonDirectory}\0${hash}\0${targetHash}`);
      if (cached) return cached;
      const cwd = snapshot.overview.selectedWorktreePath;
      const ancestry = yield* run(cwd, ["merge-base", "--is-ancestor", hash, targetHash], {
        allowNonZero: true,
      });
      if (ancestry.exitCode === 0) return { mergeStatus: "merged", reason: null };
      if (ancestry.exitCode !== 1) return { mergeStatus: "unknown", reason: "read-failed" };
      const common = yield* run(cwd, ["merge-base", hash, targetHash], { allowNonZero: true });
      if (common.exitCode === 1) return { mergeStatus: "unknown", reason: "unrelated" };
      if (common.exitCode !== 0) return { mergeStatus: "unknown", reason: "read-failed" };
      const range = `${targetHash}...${hash}`;
      const walk = yield* run(cwd, [
        "rev-list",
        "--left-right",
        "--parents",
        `--max-count=${MAX_MERGE_COMMITS + 1}`,
        range,
        "--",
      ]);
      const commits = walk.stdout.trim().split("\n").filter(Boolean);
      if (commits.length > MAX_MERGE_COMMITS) return { mergeStatus: "unknown", reason: "limit" };
      // Patch IDs omit merge conflict resolutions. A unique merge prevents proving equivalence.
      if (commits.some((commit) => commit.startsWith(">") && commit.split(" ").length > 2))
        return { mergeStatus: "unknown", reason: "merge-commits" };
      const patches = yield* Effect.forEach(
        [`${hash}..${targetHash}`, `${targetHash}..${hash}`],
        (range) =>
          run(
            cwd,
            [
              "log",
              "--format=commit %H",
              "--no-merges",
              "--patch",
              "--binary",
              "--full-index",
              "--no-renames",
              "--no-ext-diff",
              "--no-textconv",
              "--no-color",
              "--no-show-signature",
              range,
              "--",
            ],
            { maxBytes: 2 * 1024 * 1024, truncate: true },
          ),
        { concurrency: 2 },
      );
      if (patches.some((patch) => patch.stdoutTruncated))
        return { mergeStatus: "unknown", reason: "limit" };
      // Git's ordinary cherry comparison ignores whitespace, which can change Python control flow.
      const patchIds = yield* Effect.forEach(
        patches,
        (patch) => run(cwd, ["patch-id", "--verbatim"], { stdin: patch.stdout }),
        { concurrency: 2 },
      );
      const basePatches = new Set(
        patchIds[0]!.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split(" ")[0]),
      );
      const unique = patchIds[1]!.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .some((line) => !basePatches.has(line.split(" ")[0]));
      return { mergeStatus: unique ? "unmerged" : "equivalent", reason: null };
    },
    Effect.timeout("10 seconds"),
    Effect.orElseSucceed(() => ({
      mergeStatus: "unknown" as const,
      reason: "read-failed" as const,
    })),
    (effect, snapshot, hash, targetHash) =>
      effect.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            // Commit comparisons survive ref deletion; checkout/protection checks still use the current snapshot.
            // Failed reads must be retried; shallow history and missing bases are cheap to check afresh.
            if (!targetHash || snapshot.shallowBoundary || result.reason === "read-failed") return;
            const key = `${snapshot.commonDirectory}\0${hash}\0${targetHash}`;
            mergeAssessments.delete(key);
            mergeAssessments.set(key, result);
            if (mergeAssessments.size > MAX_MERGE_ASSESSMENTS)
              mergeAssessments.delete(mergeAssessments.keys().next().value!);
          }),
        ),
      ),
  );
  const computeBranchStatus = Effect.fn("GitExplorer.computeBranchStatus")(function* (
    snapshot: Snapshot,
    ref: GitExplorerRef,
  ) {
    const result = yield* branchDeletionContext(snapshot, ref);
    const status = {
      ...result,
      ...(yield* computeMergeAssessment(snapshot, ref.hash, result.targetHash)),
    };
    return {
      ...status,
      deleteBlockedReason:
        status.deleteBlockedReason ??
        (status.mergeStatus === "unknown"
          ? "unknown"
          : status.mergeStatus === "unmerged"
            ? "unmerged"
            : null),
    } satisfies GitExplorerBranchStatus;
  });
  const branchStatuses: GitExplorer["Service"]["branchStatuses"] = Effect.fn(
    "GitExplorer.branchStatuses",
  )(function* (input) {
    const context = yield* resolve(input);
    const snapshot = snapshots.get(input.snapshotId);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (
      !snapshot ||
      snapshot.projectId !== input.projectId ||
      snapshot.commonDirectory !== context.commonDirectory ||
      snapshot.overview.selectedWorktreePath !== context.cwd ||
      now - snapshot.touchedAt > SNAPSHOT_TTL_MS ||
      (yield* readShallowBoundary(context.commonDirectory)) !== snapshot.shallowBoundary ||
      (yield* readMergeConfig(context.cwd)).signature !== snapshot.mergeConfig.signature
    )
      return yield* new GitExplorerError({
        operation: "branch-statuses",
        reason: "snapshot-expired",
      });
    if (input.branches.length > 32)
      return yield* new GitExplorerError({ operation: "branch-statuses", reason: "too-large" });
    const refs: GitExplorerRef[] = [];
    for (const name of new Set(input.branches)) {
      const ref = snapshot.overview.refs.find(
        (candidate) => candidate.kind === "local" && candidate.name === name,
      );
      if (!ref)
        return yield* new GitExplorerError({
          operation: "branch-statuses",
          reason: "invalid-branch",
        });
      refs.push(ref);
    }
    snapshot.touchedAt = now;
    const branches = yield* Effect.forEach(
      refs,
      (ref) =>
        Effect.gen(function* () {
          const cached = snapshot.branchStatuses.get(ref.name);
          if (cached) return cached;
          const local = yield* computeBranchStatus(snapshot, ref);
          const upstream = ref.upstream ? snapshot.refsByName.get(ref.upstream) : undefined;
          const result: GitExplorerBranchStatus = upstream
            ? {
                ...local,
                upstream: {
                  name: upstream.name,
                  hash: upstream.hash,
                  ...(upstream.hash === ref.hash
                    ? { mergeStatus: local.mergeStatus, reason: local.reason }
                    : yield* computeMergeAssessment(snapshot, upstream.hash, local.targetHash)),
                },
              }
            : local;
          // Worktree changes do not change the snapshot signature, so recheck their cleanliness.
          if (
            result.reason !== "read-failed" &&
            result.upstream?.reason !== "read-failed" &&
            result.checkedOutAt === undefined
          )
            snapshot.branchStatuses.set(ref.name, result);
          return result;
        }),
      { concurrency: 4 },
    );
    return { branches };
  });
  const deleteBranch: GitExplorer["Service"]["deleteBranch"] = Effect.fn(
    "GitExplorer.deleteBranch",
  )(function* (input) {
    if (
      !input.branchName.startsWith("refs/heads/") ||
      !HASH.test(input.expectedHash) ||
      (input.expectedTargetHash !== null && !HASH.test(input.expectedTargetHash)) ||
      (input.expectedTargetRef === null) !== (input.expectedTargetHash === null)
    )
      return yield* new GitExplorerError({ operation: "delete-branch", reason: "invalid-branch" });
    const context = yield* resolve(input);
    let lock = mutationLocks.get(context.commonDirectory);
    if (!lock) {
      lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
      mutationLocks.set(context.commonDirectory, lock);
    }
    lock.users++;
    const activeLock = lock;
    return yield* Effect.gen(function* () {
      const current = yield* overview(input);
      const snapshot = snapshots.get(current.snapshotId);
      if (!snapshot)
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "snapshot-expired",
        });
      const ref = current.refs.find(
        (candidate) => candidate.kind === "local" && candidate.name === input.branchName,
      );
      if (!ref)
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "invalid-branch",
        });
      if (ref.hash !== input.expectedHash)
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-changed",
        });
      const status = input.force
        ? yield* branchDeletionContext(snapshot, ref)
        : yield* computeBranchStatus(snapshot, ref);
      if (
        status.targetRef !== input.expectedTargetRef ||
        status.targetHash !== input.expectedTargetHash
      )
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-changed",
        });
      if (status.deleteBlockedReason === "protected")
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-protected",
        });
      if (status.deleteBlockedReason === "checked-out")
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-checked-out",
        });
      if (
        !input.force &&
        status.mergeStatus !== "merged" &&
        !(status.mergeStatus === "equivalent" && input.allowEquivalent)
      )
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-not-merged",
        });
      if (status.checkedOutAt !== undefined) {
        if (input.removeWorktree === undefined)
          return yield* new GitExplorerError({
            operation: "delete-branch",
            reason: "branch-checked-out",
          });
        if (input.removeWorktree !== status.checkedOutAt)
          return yield* new GitExplorerError({
            operation: "delete-branch",
            reason: "branch-changed",
          });
        // A single --force removes the reviewed untracked symlinks but still refuses a locked worktree.
        yield* git
          .execute({
            operation: "GitExplorer.removeWorktree",
            cwd: context.cwd,
            args: ["worktree", "remove", "--force", "--", status.checkedOutAt],
            env: { GIT_TERMINAL_PROMPT: "0" },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new GitExplorerError({
                  operation: "delete-branch-worktree",
                  reason: "write-failed",
                  cause,
                }),
            ),
          );
      }
      const latest = yield* resolve(input);
      if (latest.worktrees.some((worktree) => worktree.branch === ref.shortName))
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-checked-out",
        });
      const hashes = (yield* run(latest.cwd, [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)",
        input.branchName,
        ...(input.expectedTargetRef ? [input.expectedTargetRef] : []),
      ])).stdout
        .split("\n")
        .map((line) => line.split("\0"));
      if (
        hashes.find(([name]) => name === input.branchName)?.[1] !== input.expectedHash ||
        (input.expectedTargetRef !== null &&
          hashes.find(([name]) => name === input.expectedTargetRef)?.[1] !==
            input.expectedTargetHash) ||
        (yield* readMergeConfig(latest.cwd)).signature !== snapshot.mergeConfig.signature ||
        (yield* readShallowBoundary(latest.commonDirectory)) !== snapshot.shallowBoundary
      )
        return yield* new GitExplorerError({
          operation: "delete-branch",
          reason: "branch-changed",
        });
      // Registered worktrees can be offline or missing. Their administrative
      // directories still own the HEAD locks; opening each checkout would block
      // deletion of unrelated branches when any old checkout is unavailable.
      const worktreeDirectories = yield* Effect.gen(function* () {
        const directory = path.join(latest.commonDirectory, "worktrees");
        const entries = yield* fs.readDirectory(directory).pipe(
          Effect.catchIf(
            (cause) => cause.reason._tag === "NotFound",
            () => Effect.succeed([] as string[]),
          ),
        );
        return new Map(
          yield* Effect.forEach(
            entries,
            (entry) =>
              Effect.gen(function* () {
                const gitDirectory = path.join(directory, entry);
                const gitFile = (yield* fs.readFileString(
                  path.join(gitDirectory, "gitdir"),
                )).trim();
                return [path.dirname(path.resolve(gitDirectory, gitFile)), gitDirectory] as const;
              }),
            { concurrency: 4 },
          ),
        );
      }).pipe(
        Effect.mapError(
          (cause) =>
            new GitExplorerError({
              operation: "delete-branch-worktrees",
              reason: "read-failed",
              cause,
            }),
        ),
      );
      const heads = yield* Effect.forEach(
        latest.worktrees.filter((worktree) => !worktree.bare),
        (worktree) =>
          Effect.gen(function* () {
            const gitDirectory =
              worktree === latest.worktrees[0]
                ? latest.commonDirectory
                : worktreeDirectories.get(path.resolve(worktree.path));
            if (!gitDirectory)
              return yield* new GitExplorerError({
                operation: "delete-branch",
                reason: "invalid-worktree",
              });
            return { filePath: path.join(gitDirectory, "HEAD"), worktree };
          }),
        { concurrency: 4 },
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          // Git cannot verify another worktree's HEAD in an update-ref transaction.
          // Its standard exclusive lock keeps existing worktrees from checking out this branch while we delete it.
          for (const head of heads.toSorted((a, b) => a.filePath.localeCompare(b.filePath))) {
            const lockPath = `${head.filePath}.lock`;
            yield* Effect.acquireRelease(
              Effect.scoped(fs.open(lockPath, { flag: "wx" }).pipe(Effect.asVoid)).pipe(
                Effect.mapError(
                  (cause) =>
                    new GitExplorerError({
                      operation: "delete-branch-lock",
                      reason: "write-failed",
                      cause,
                    }),
                ),
              ),
              () => fs.remove(lockPath).pipe(Effect.ignore),
            );
            const reserved = yield* Effect.forEach(
              ["rebase-merge/head-name", "rebase-apply/head-name", "BISECT_START"],
              (relative) =>
                fs.readFileString(path.join(path.dirname(head.filePath), relative)).pipe(
                  Effect.catchIf(
                    (cause) => cause.reason._tag === "NotFound",
                    () => Effect.succeed(""),
                  ),
                  Effect.mapError(
                    (cause) =>
                      new GitExplorerError({
                        operation: "delete-branch-reserved",
                        reason: "read-failed",
                        cause,
                      }),
                  ),
                ),
              { concurrency: 3 },
            );
            if (
              reserved.some(
                (value) => value.trim() === input.branchName || value.trim() === ref.shortName,
              )
            )
              return yield* new GitExplorerError({
                operation: "delete-branch",
                reason: "branch-checked-out",
              });
            const value = yield* fs.readFileString(head.filePath).pipe(
              Effect.mapError(
                (cause) =>
                  new GitExplorerError({
                    operation: "delete-branch-head",
                    reason: "read-failed",
                    cause,
                  }),
              ),
            );
            if (value.trim() === `ref: ${input.branchName}`)
              return yield* new GitExplorerError({
                operation: "delete-branch",
                reason: "branch-checked-out",
              });
            if (
              value.trim() !==
              (head.worktree.branch
                ? `ref: refs/heads/${head.worktree.branch}`
                : head.worktree.headHash)
            )
              return yield* new GitExplorerError({
                operation: "delete-branch",
                reason: "branch-changed",
              });
          }
          const lockedContext = yield* resolve(input);
          if (lockedContext.worktreeOutput !== latest.worktreeOutput)
            return yield* new GitExplorerError({
              operation: "delete-branch",
              reason: "branch-changed",
            });
          // Verifying a checked-out base also makes Git lock HEAD. A detached
          // ref context shares the repository refs without colliding with the
          // worktree HEAD locks that prevent checkout during deletion.
          const refContext = yield* Effect.gen(function* () {
            const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-delete-" });
            yield* fs.writeFileString(
              path.join(directory, "commondir"),
              `${latest.commonDirectory}\n`,
            );
            yield* fs.writeFileString(path.join(directory, "HEAD"), `${input.expectedHash}\n`);
            return directory;
          }).pipe(
            Effect.mapError(
              (cause) =>
                new GitExplorerError({
                  operation: "delete-branch",
                  reason: "write-failed",
                  cause,
                }),
            ),
          );
          const result = yield* git
            .execute({
              operation: "GitExplorer.deleteBranch",
              cwd: latest.cwd,
              args: [
                `--git-dir=${refContext}`,
                "-c",
                `core.hooksPath=${platform === "win32" ? "NUL" : "/dev/null"}`,
                "update-ref",
                "--no-deref",
                "--stdin",
              ],
              stdin: [
                "start",
                ...(input.expectedTargetRef
                  ? [`verify ${input.expectedTargetRef} ${input.expectedTargetHash}`]
                  : []),
                `delete ${input.branchName} ${input.expectedHash}`,
                "prepare",
                "commit",
                "",
              ].join("\n"),
              env: {
                GIT_NO_LAZY_FETCH: "1",
                GIT_TERMINAL_PROMPT: "0",
                GIT_NO_REPLACE_OBJECTS: "1",
              },
              timeoutMs: 15_000,
              maxOutputBytes: 64 * 1024,
              allowNonZeroExit: true,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new GitExplorerError({
                    operation: "delete-branch",
                    reason: "write-failed",
                    cause,
                  }),
              ),
            );
          if (result.exitCode !== 0) {
            const fresh = yield* readOverviewState(input);
            const rows = fresh.output.stdout.split("\n").map((line) => line.split("\0"));
            if (
              rows.find(([name]) => name === input.branchName)?.[1] !== input.expectedHash ||
              (input.expectedTargetRef !== null &&
                rows.find(([name]) => name === input.expectedTargetRef)?.[1] !==
                  input.expectedTargetHash)
            )
              return yield* new GitExplorerError({
                operation: "delete-branch",
                reason: "branch-changed",
              });
            return yield* new GitExplorerError({
              operation: "delete-branch",
              reason: "write-failed",
            });
          }
        }),
      );
      // Keep branch config: a separate remove-section could erase configuration of a concurrently recreated branch.
      for (const [id, cached] of snapshots)
        if (cached.commonDirectory === context.commonDirectory) snapshots.delete(id);
      yield* git.invalidateRefs(latest.cwd).pipe(Effect.ignore);
    }).pipe(
      activeLock.semaphore.withPermits(1),
      Effect.ensuring(
        Effect.sync(() => {
          activeLock.users--;
          if (activeLock.users === 0) mutationLocks.delete(context.commonDirectory);
        }),
      ),
    );
  });
  const withMutationLock = <A, E, R>(commonDirectory: string, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      let lock = mutationLocks.get(commonDirectory);
      if (!lock) {
        lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
        mutationLocks.set(commonDirectory, lock);
      }
      lock.users++;
      const activeLock = lock;
      return effect.pipe(
        activeLock.semaphore.withPermits(1),
        Effect.ensuring(
          Effect.sync(() => {
            activeLock.users--;
            if (activeLock.users === 0) mutationLocks.delete(commonDirectory);
          }),
        ),
      );
    });
  const mergeInProgress = (cwd: string) =>
    run(cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { allowNonZero: true }).pipe(
      Effect.map((result) => result.exitCode === 0),
    );
  // Worded as Git words a merge by branch name, though the verified tip is what gets merged.
  const mergeMessage = (mergeRef: string, branch: string) =>
    `Merge ${mergeRef.startsWith("refs/heads/") ? "branch" : "remote-tracking branch"} '${mergeRef.replace(/^refs\/(?:heads|remotes)\//, "")}' into ${branch}`;
  /** Merges into HEAD with --no-ff; a merge stopped by conflicts stays in progress and returns their paths. */
  const mergeIntoHead = Effect.fn("GitExplorer.mergeIntoHead")(function* (
    cwd: string,
    revision: string,
    message: string | undefined,
  ) {
    return yield* git
      .execute({
        operation: "GitExplorer.merge",
        cwd,
        args: [
          "-c",
          "submodule.recurse=false",
          "merge",
          "--no-ff",
          "--no-edit",
          ...(message === undefined ? [] : ["-m", message]),
          revision,
        ],
        env: { GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
        timeoutMs: null,
      })
      .pipe(
        Effect.as(null),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const paths = (yield* mergeInProgress(cwd))
              ? (yield* run(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"])).stdout
                  .split("\0")
                  .filter(Boolean)
              : [];
            // A stopped merge without conflicts (a rejecting hook, say) is reported as its Git error.
            return paths.length > 0 ? paths : yield* error;
          }),
        ),
        Effect.ensuring(git.invalidateRefs(cwd).pipe(Effect.ignore)),
      );
  });
  /** Fetches the release refs from origin, then works out what releasing `sourceRef` would do. */
  const planRelease = Effect.fn("GitExplorer.planRelease")(function* (
    cwd: string,
    worktrees: readonly GitExplorerWorktree[],
    input: Pick<GitExplorerReleasePlanInput, "channel" | "sourceRef" | "revision">,
  ) {
    const remote = GIT_EXPLORER_RELEASE_REMOTE;
    const sourceName = /^refs\/(?:heads|remotes\/origin)\/(.+)$/.exec(input.sourceRef)?.[1];
    const kind = sourceName ? gitExplorerReleaseSourceKind(sourceName) : null;
    if (!sourceName || !kind || !HASH.test(input.revision))
      return yield* new GitExplorerError({ operation: "release", reason: "invalid-branch" });
    if (!(yield* readMergeConfig(cwd)).remotes.includes(remote))
      return yield* new GitExplorerError({ operation: "release", reason: "invalid-remote" });
    const fetch = (refspecs: readonly string[]) =>
      git.execute({
        operation: "GitExplorer.releaseFetch",
        cwd,
        args: ["fetch", "--no-tags", "--recurse-submodules=no", "--", remote, ...refspecs],
        env: { GIT_TERMINAL_PROMPT: "0" },
        timeoutMs: null,
      });
    const commitOf = (ref: string) =>
      run(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
        allowNonZero: true,
      }).pipe(Effect.map((result) => result.stdout.trim() || null));
    const isAncestor = (ancestor: string, descendant: string) =>
      run(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], { allowNonZero: true }).pipe(
        Effect.map((result) => result.exitCode === 0),
      );
    const count = (range: string, ...flags: string[]) =>
      run(cwd, ["rev-list", "--count", ...flags, range, "--"]).pipe(
        Effect.map((result) => Number(result.stdout.trim())),
      );

    // The source is not fetched: the release is of the commit that was reviewed.
    yield* fetch(["+refs/heads/v*:refs/remotes/origin/v*"]).pipe(
      Effect.ensuring(git.invalidateRefs(cwd).pipe(Effect.ignore)),
    );
    if ((yield* commitOf(input.sourceRef)) !== input.revision)
      return yield* new GitExplorerError({ operation: "release", reason: "branch-changed" });
    const branchNames = (yield* run(cwd, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/v*",
      "refs/remotes/origin/v*",
    ])).stdout
      .split("\n")
      .map((ref) => ref.replace(/^refs\/(?:heads|remotes\/origin)\//, ""));
    const releaseBranch = kind === "release-branch" ? sourceName : latestReleaseBranch(branchNames);
    if (!releaseBranch)
      return yield* new GitExplorerError({ operation: "release", reason: "invalid-branch" });
    const tagPattern = `refs/tags/${releaseBranch.slice(1)}.*`;
    yield* fetch([`+${tagPattern}:${tagPattern}`]).pipe(
      Effect.ensuring(git.invalidateRefs(cwd).pipe(Effect.ignore)),
    );

    const local = yield* commitOf(`refs/heads/${releaseBranch}`);
    const tracked = yield* commitOf(`refs/remotes/${remote}/${releaseBranch}`);
    const head = (yield* run(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      allowNonZero: true,
    })).stdout.trim();
    const inWorktree = head === releaseBranch;
    const elsewhere = !inWorktree && worktrees.some((tree) => tree.branch === releaseBranch);
    const source = input.sourceRef.replace(/^refs\/(?:heads|remotes)\//, "");
    const onOrigin = `${releaseBranch} is already on origin at this commit. Pushing only a tag doesn't start CI.`;
    let blocked: string | null = null;
    let base: string;
    let merge: GitExplorerReleasePlanResult["merge"] = null;
    let tagCommit: string | null = null;
    if (kind === "release-branch") {
      base = input.revision;
      tagCommit = input.revision;
      if (tracked === input.revision)
        blocked = `${onOrigin} Release from master to merge new work, or push a new commit to ${releaseBranch}.`;
      else if (tracked && (yield* isAncestor(input.revision, tracked)))
        blocked = `origin/${releaseBranch} has newer commits. Pull ${releaseBranch} first.`;
      else if (tracked && !(yield* isAncestor(tracked, input.revision)))
        blocked = `${releaseBranch} and origin/${releaseBranch} have diverged.`;
    } else {
      if (!local && !tracked)
        return yield* new GitExplorerError({ operation: "release", reason: "invalid-branch" });
      base = (local ?? tracked)!;
      if (local && tracked && local !== tracked && !(yield* isAncestor(tracked, local))) {
        if (!(yield* isAncestor(local, tracked)))
          blocked = `${releaseBranch} and origin/${releaseBranch} have diverged.`;
        // A branch nobody has checked out is fast-forwarded as part of the release.
        else if (inWorktree || elsewhere)
          blocked = `${releaseBranch} is behind origin/${releaseBranch}. Pull it first.`;
        else base = tracked;
      }
      if ((yield* count(`${base}..${input.revision}`)) === 0) {
        tagCommit = base;
        if (!blocked && tracked && (yield* isAncestor(base, tracked)))
          blocked = `${releaseBranch} already contains ${source}. ${onOrigin}`;
      } else {
        const range = `${base}..${input.revision}`;
        const commits = (yield* run(cwd, [
          "log",
          "--no-merges",
          "-n",
          "5",
          "--format=%H%x1f%s",
          range,
          "--",
        ])).stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, subject = ""] = line.split("\x1f");
            return { hash: hash!, subject };
          });
        merge = { commits, total: yield* count(range, "--no-merges"), inWorktree };
        if (!blocked && elsewhere)
          blocked = `${releaseBranch} is checked out in another worktree. Release from that worktree.`;
        else if (!blocked && inWorktree && (yield* mergeInProgress(cwd)))
          blocked = "A merge is already in progress in this worktree.";
      }
    }
    const tags = (yield* run(cwd, [
      "for-each-ref",
      "--format=%(refname:strip=2)%00%(creatordate:iso-strict)",
      tagPattern,
    ])).stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\0") as [string, string]);
    const next = nextReleaseTag(
      releaseBranch,
      tags.map(([name]) => name),
      input.channel,
    )!;
    const previousDate = tags.find(([name]) => name === next.previous)?.[1];
    const plan: GitExplorerReleasePlanResult = {
      channel: input.channel,
      source,
      releaseBranch,
      base,
      tag: next.tag,
      previousRelease:
        next.previous && previousDate ? { tag: next.previous, createdAt: previousDate } : null,
      merge,
      tagCommit,
      unpublished: tracked ? yield* count(`${tracked}..${tagCommit ?? base}`) : 0,
      blocked,
    };
    return { plan, local };
  });
  const runAction: GitExplorer["Service"]["runAction"] = Effect.fn("GitExplorer.runAction")(
    function* (input) {
      const { cwd, commonDirectory, worktrees } = yield* resolve(input);
      return yield* withMutationLock(
        commonDirectory,
        Effect.gen(function* () {
          if (input.action !== "fetch") {
            const head =
              (yield* run(cwd, ["rev-parse", "--verify", "HEAD"], {
                allowNonZero: true,
              })).stdout.trim() || null;
            const branch =
              (yield* run(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
                allowNonZero: true,
              })).stdout.trim() || null;
            if (head !== input.expectedHead || branch !== input.expectedBranch)
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "worktree-changed",
              });
          }
          if (input.action === "reset") {
            if (!input.expectedBranch || !["soft", "mixed", "hard"].includes(input.resetMode ?? ""))
              return yield* new GitExplorerError({ operation: "reset", reason: "invalid-reset" });
            if (
              !input.revision ||
              !HASH.test(input.revision) ||
              (yield* run(cwd, ["cat-file", "-t", input.revision], {
                allowNonZero: true,
              })).stdout.trim() !== "commit"
            )
              return yield* new GitExplorerError({
                operation: "reset",
                reason: "invalid-revision",
              });
            yield* git.execute({
              operation: "GitExplorer.reset",
              cwd,
              args: [
                "-c",
                "submodule.recurse=false",
                "reset",
                `--${input.resetMode}`,
                input.revision,
                "--",
              ],
              env: { GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
            });
            yield* git.invalidateRefs(cwd);
            return {
              message: `Reset ${input.expectedBranch} to ${input.revision.slice(0, 12)} (${input.resetMode}).`,
            };
          }
          if (input.action === "merge") {
            const { expectedBranch, mergeRef, revision } = input;
            if (!expectedBranch || !revision || !HASH.test(revision))
              return yield* new GitExplorerError({
                operation: "merge",
                reason: "invalid-revision",
              });
            if (mergeRef !== undefined) {
              if (
                !/^refs\/(?:heads|remotes)\//.test(mergeRef) ||
                (yield* run(cwd, ["check-ref-format", mergeRef], { allowNonZero: true }))
                  .exitCode !== 0
              )
                return yield* new GitExplorerError({
                  operation: "merge",
                  reason: "invalid-branch",
                });
              const hash = (yield* run(
                cwd,
                ["rev-parse", "--verify", "--quiet", `${mergeRef}^{commit}`],
                { allowNonZero: true },
              )).stdout.trim();
              if (hash !== revision)
                return yield* new GitExplorerError({
                  operation: "merge",
                  reason: "branch-changed",
                });
            } else if (
              (yield* run(cwd, ["cat-file", "-t", revision], {
                allowNonZero: true,
              })).stdout.trim() !== "commit"
            )
              return yield* new GitExplorerError({
                operation: "merge",
                reason: "invalid-revision",
              });
            if (yield* mergeInProgress(cwd))
              return yield* new GitExplorerError({
                operation: "merge",
                reason: "merge-in-progress",
              });
            const source =
              mergeRef?.replace(/^refs\/(?:heads|remotes)\//, "") ?? revision.slice(0, 12);
            const conflictedPaths = yield* mergeIntoHead(
              cwd,
              revision,
              mergeRef === undefined ? undefined : mergeMessage(mergeRef, expectedBranch),
            );
            if (conflictedPaths)
              return {
                message: `Merging ${source} into ${expectedBranch} stopped with conflicts in ${conflictedPaths.length} ${conflictedPaths.length === 1 ? "file" : "files"}.`,
                conflictedPaths,
              };
            const head = (yield* run(cwd, ["rev-parse", "--verify", "HEAD"])).stdout.trim();
            return {
              message:
                head === input.expectedHead
                  ? `${expectedBranch} already contains ${source}.`
                  : `Merged ${source} into ${expectedBranch}.`,
            };
          }
          if (input.action === "release") {
            const { mergeRef, revision, releaseChannel, tagName, releaseBase } = input;
            if (!mergeRef || !revision || !releaseChannel || !tagName || !releaseBase)
              return yield* new GitExplorerError({
                operation: "release",
                reason: "invalid-revision",
              });
            const { plan, local } = yield* planRelease(cwd, worktrees, {
              channel: releaseChannel,
              sourceRef: mergeRef,
              revision,
            });
            if (plan.blocked || plan.tag !== tagName || plan.base !== releaseBase)
              return yield* new GitExplorerError({
                operation: "release",
                reason: "release-changed",
              });
            const branch = plan.releaseBranch;
            let commit = plan.tagCommit;
            if (plan.merge?.inWorktree) {
              const conflictedPaths = yield* mergeIntoHead(
                cwd,
                revision,
                mergeMessage(mergeRef, branch),
              );
              if (conflictedPaths)
                return {
                  message: `Merging ${plan.source} into ${branch} stopped with conflicts. Nothing was tagged or pushed.`,
                  conflictedPaths,
                };
              commit = (yield* run(cwd, ["rev-parse", "--verify", "HEAD"])).stdout.trim();
            } else if (plan.merge) {
              // The release branch is not checked out, so the merge is built without a worktree.
              const merged = yield* git.execute({
                operation: "GitExplorer.releaseMergeTree",
                cwd,
                args: ["merge-tree", "--write-tree", "--no-messages", plan.base, revision],
                allowNonZeroExit: true,
              });
              if (merged.exitCode === 1)
                return yield* new GitExplorerError({
                  operation: "release",
                  reason: "release-conflicts",
                });
              if (merged.exitCode !== 0)
                return yield* new GitExplorerError({ operation: "release", reason: "read-failed" });
              commit = (yield* git.execute({
                operation: "GitExplorer.releaseMergeCommit",
                cwd,
                args: [
                  "commit-tree",
                  merged.stdout.split("\n")[0]!,
                  "-p",
                  plan.base,
                  "-p",
                  revision,
                  "-m",
                  mergeMessage(mergeRef, branch),
                ],
              })).stdout.trim();
              if (local)
                yield* git.execute({
                  operation: "GitExplorer.releaseUpdateBranch",
                  cwd,
                  args: [
                    "update-ref",
                    "-m",
                    "release: merge",
                    `refs/heads/${branch}`,
                    commit,
                    local,
                  ],
                });
            }
            if (!commit)
              return yield* new GitExplorerError({
                operation: "release",
                reason: "release-changed",
              });
            const tagRef = `refs/tags/${plan.tag}`;
            yield* git.execute({
              operation: "GitExplorer.releaseTag",
              cwd,
              args: ["tag", "--no-sign", "--", plan.tag, commit],
            });
            yield* git
              .execute({
                operation: "GitExplorer.releasePush",
                cwd,
                // Atomic, so CI's build of the branch push always finds the tag.
                args: [
                  "push",
                  "--atomic",
                  "--no-follow-tags",
                  "--",
                  GIT_EXPLORER_RELEASE_REMOTE,
                  `${commit}:refs/heads/${branch}`,
                  `${tagRef}:${tagRef}`,
                ],
                env: { GIT_TERMINAL_PROMPT: "0" },
                timeoutMs: null,
              })
              .pipe(
                // Without the tag, releasing again works out the same version.
                Effect.tapError(() =>
                  git
                    .execute({
                      operation: "GitExplorer.releaseUntag",
                      cwd,
                      args: ["update-ref", "-d", tagRef, commit],
                    })
                    .pipe(Effect.ignore),
                ),
                Effect.ensuring(git.invalidateRefs(cwd).pipe(Effect.ignore)),
              );
            return { message: `Released ${plan.tag}: pushed ${branch} and the tag to origin.` };
          }
          if (
            input.action === "create-tag" ||
            input.action === "push-tag" ||
            input.action === "delete-tag"
          ) {
            const name = input.tagName;
            const revision = input.revision;
            if (
              !name ||
              name.startsWith("-") ||
              !revision ||
              !HASH.test(revision) ||
              (yield* run(cwd, ["check-ref-format", `refs/tags/${name}`], { allowNonZero: true }))
                .exitCode !== 0
            )
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "invalid-tag",
              });
            const ref = `refs/tags/${name}`;
            if (input.action === "create-tag") {
              if (
                (yield* run(cwd, ["cat-file", "-t", revision], {
                  allowNonZero: true,
                })).stdout.trim() !== "commit"
              )
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "invalid-revision",
                });
              yield* git.execute({
                operation: "GitExplorer.create-tag",
                cwd,
                args: [
                  "tag",
                  "--no-sign",
                  ...(input.message?.trim() ? ["-a", "-m", input.message.trim()] : []),
                  "--",
                  name,
                  revision,
                ],
                env: { GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
              });
              yield* git.invalidateRefs(cwd);
              return { message: `Created tag ${name}.` };
            }
            const object = (yield* run(cwd, ["rev-parse", "--verify", ref], {
              allowNonZero: true,
            })).stdout.trim();
            const commit = (yield* run(cwd, ["rev-parse", "--verify", `${ref}^{commit}`], {
              allowNonZero: true,
            })).stdout.trim();
            if (!HASH.test(object) || commit !== revision)
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "tag-changed",
              });
            if (input.action === "delete-tag") {
              yield* git.execute({
                operation: "GitExplorer.delete-tag",
                cwd,
                args: ["update-ref", "-d", ref, object],
              });
              yield* git.invalidateRefs(cwd);
              return { message: `Deleted local tag ${name}.` };
            }
            if (!input.remote || !(yield* readMergeConfig(cwd)).remotes.includes(input.remote))
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "invalid-remote",
              });
            yield* git.execute({
              operation: "GitExplorer.push-tag",
              cwd,
              // Publishing a ref to an existing commit has nothing for pre-push checks to verify.
              args: [
                "push",
                "--no-verify",
                "--no-follow-tags",
                "--",
                input.remote,
                `${object}:${ref}`,
              ],
              env: { GIT_TERMINAL_PROMPT: "0" },
              timeoutMs: null,
            });
            return { message: `Pushed tag ${name} to ${input.remote}.` };
          }
          if (input.action === "switch" || input.action === "rename") {
            const name = input.branchName;
            if (
              !name?.startsWith("refs/heads/") ||
              !input.branchHash ||
              (yield* run(cwd, ["check-ref-format", name], { allowNonZero: true })).exitCode !== 0
            )
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "invalid-branch",
              });
            const hash = (yield* run(cwd, ["show-ref", "--verify", "--hash", name], {
              allowNonZero: true,
            })).stdout.trim();
            if (hash !== input.branchHash)
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "branch-changed",
              });
            const shortName = name.slice("refs/heads/".length);
            const { worktrees } = yield* resolve(input);
            if (worktrees.some((tree) => tree.branch === shortName && tree.path !== cwd))
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "branch-in-use",
              });
            if (input.action === "switch") {
              yield* git.switchRef({
                cwd,
                refName: shortName,
                ...(input.filePaths ? { discardPaths: input.filePaths } : {}),
              });
              return { message: `Switched to ${shortName}.` };
            }
            if (
              !input.newName ||
              input.newName.startsWith("-") ||
              (yield* run(cwd, ["check-ref-format", `refs/heads/${input.newName}`], {
                allowNonZero: true,
              })).exitCode !== 0
            )
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "invalid-branch-name",
              });
            yield* git.renameBranch({
              cwd,
              oldBranch: shortName,
              newBranch: input.newName,
              exactName: true,
            });
            return { message: `Renamed ${shortName} to ${input.newName}.` };
          }
          if (input.action === "push") {
            const result = yield* git.pushCurrentBranch(cwd, null, { force: input.force === true });
            return {
              message:
                result.status !== "pushed"
                  ? "Already up to date."
                  : input.force
                    ? "Force pushed successfully."
                    : "Pushed successfully.",
            };
          }
          if (input.action === "pull") {
            const result = yield* git.pullCurrentBranch(cwd);
            return {
              message: result.status === "pulled" ? "Pulled successfully." : "Already up to date.",
            };
          }
          if (
            input.action === "apply-stash" ||
            input.action === "pop-stash" ||
            input.action === "drop-stash"
          ) {
            const stashHash = input.stashHash;
            if (
              !stashHash ||
              !(yield* readStashes(cwd)).stashes.some((stash) => stash.hash === stashHash)
            )
              return yield* new GitExplorerError({
                operation: input.action,
                reason: "stash-unavailable",
              });
            if (input.action !== "drop-stash") {
              yield* git
                .execute({
                  operation: `GitExplorer.${input.action}`,
                  cwd,
                  args: [
                    "stash",
                    "apply",
                    ...(input.restoreIndex === false ? [] : ["--index"]),
                    stashHash,
                  ],
                  timeoutMs: null,
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new GitExplorerError({
                        operation: input.action,
                        reason: "stash-apply-failed",
                        cause,
                      }),
                  ),
                );
            }
            if (input.action !== "apply-stash") {
              // Applying can take time. Resolve the current reflog position again before removing it.
              const current = (yield* readStashes(cwd).pipe(
                Effect.mapError(
                  (cause) =>
                    new GitExplorerError({
                      operation: input.action,
                      reason:
                        input.action === "pop-stash"
                          ? "stash-pop-drop-failed"
                          : "stash-drop-failed",
                      cause,
                    }),
                ),
              )).stashes.find((stash) => stash.hash === stashHash);
              if (current) {
                yield* git
                  .execute({
                    operation: `GitExplorer.${input.action}`,
                    cwd,
                    args: ["stash", "drop", current.name],
                    timeoutMs: null,
                  })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new GitExplorerError({
                          operation: input.action,
                          reason:
                            input.action === "pop-stash"
                              ? "stash-pop-drop-failed"
                              : "stash-drop-failed",
                          cause,
                        }),
                    ),
                  );
              }
            }
            yield* git.invalidateRefs(cwd);
            return {
              message:
                input.action === "apply-stash"
                  ? "Stash applied. The saved stash was kept."
                  : input.action === "pop-stash"
                    ? "Stash applied and removed from the stash list."
                    : "Stash deleted. Working files were kept.",
            };
          }
          let args: string[];
          let stdin: string | undefined;
          switch (input.action) {
            case "stage":
            case "unstage": {
              const review = yield* details({ ...input, revision: null });
              const selected = input.filePaths?.map((name) =>
                review.files.find(
                  (file) =>
                    file.path === name &&
                    (input.action === "unstage"
                      ? file.stage === "staged"
                      : file.stage === "unstaged" || file.stage === "untracked"),
                ),
              );
              if (!selected?.length || selected.some((file) => !file))
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "invalid-path",
                });
              const paths = [
                ...new Set(
                  selected.flatMap((file) =>
                    file ? [file.path, ...(file.oldPath ? [file.oldPath] : [])] : [],
                  ),
                ),
              ];
              args =
                input.action === "stage"
                  ? ["add", "-A", "--", ...paths]
                  : input.expectedHead
                    ? ["reset", "-q", "HEAD", "--", ...paths]
                    : ["update-index", "--force-remove", "--", ...paths];
              break;
            }
            case "discard": {
              const filePaths = input.filePaths ?? [];
              const stages = input.fileStages ?? (input.fileStage ? [input.fileStage] : []);
              const tokens = input.changeTokens ?? (input.changeToken ? [input.changeToken] : []);
              if (
                filePaths.length === 0 ||
                new Set(filePaths).size !== filePaths.length ||
                stages.length !== filePaths.length ||
                tokens.length !== filePaths.length
              )
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "invalid-path",
                });
              const current = yield* Effect.forEach(
                filePaths,
                (filePath, index) =>
                  patch({ ...input, revision: null, path: filePath, stage: stages[index]! }),
                { concurrency: 4 },
              );
              if (
                current.some((file, index) => file.truncated || file.changeToken !== tokens[index])
              )
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "changes-changed",
                });
              const review = yield* details({ ...input, revision: null });
              if (
                review.files.some(
                  (file) => file.status === "unmerged" && filePaths.includes(file.path),
                )
              )
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "invalid-path",
                });
              const untracked = filePaths.filter((_, index) => stages[index] === "untracked");
              const tracked = filePaths.filter((_, index) => stages[index] === "unstaged");
              const gitlinks = tracked.length
                ? (yield* run(cwd, ["ls-files", "--stage", "-z", "--", ...tracked])).stdout
                    .split("\0")
                    .filter((record) => record.startsWith("160000 "))
                    .map((record) => record.slice(record.indexOf("\t") + 1))
                : [];
              // Restoring a gitlink checks out the recorded commit inside the submodule, overwriting its edits.
              for (const gitlink of gitlinks) {
                const status = yield* run(path.join(cwd, gitlink), ["status", "--porcelain"], {
                  allowNonZero: true,
                });
                if (status.exitCode !== 0 || status.stdout.trim())
                  return yield* new GitExplorerError({
                    operation: input.action,
                    reason: "submodule-has-changes",
                  });
              }
              if (untracked.length && tracked.length)
                yield* git.execute({
                  operation: "GitExplorer.discard",
                  cwd,
                  args: ["--literal-pathspecs", "clean", "-f", "--", ...untracked],
                  env: { GIT_TERMINAL_PROMPT: "0" },
                  timeoutMs: null,
                });
              args = tracked.length
                ? [
                    "restore",
                    ...(gitlinks.length ? ["--recurse-submodules"] : []),
                    "--worktree",
                    "--",
                    ...tracked,
                  ]
                : ["clean", "-f", "--", ...untracked];
              break;
            }
            case "commit": {
              if (!input.message?.trim())
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "commit-message-required",
                });
              const indexVersion = yield* contentToken(
                (yield* run(cwd, ["ls-files", "--stage", "-z"])).stdout,
              );
              if (indexVersion !== input.indexVersion)
                return yield* new GitExplorerError({
                  operation: input.action,
                  reason: "changes-changed",
                });
              args = ["commit", ...(input.amend ? ["--amend"] : []), "--file", "-"];
              stdin = input.message.trim();
              break;
            }
            case "fetch":
              args = ["fetch", "--all"];
              break;
            case "stash":
              args = [
                "stash",
                "push",
                "--include-untracked",
                "--message",
                input.message?.trim() || "Git Explorer stash",
              ];
              break;
          }
          const result = yield* git.execute({
            operation: `GitExplorer.${input.action}`,
            cwd,
            args: [
              ...(["stage", "unstage", "discard"].includes(input.action)
                ? ["--literal-pathspecs"]
                : []),
              ...args,
            ],
            ...(stdin === undefined ? {} : { stdin }),
            env: { GIT_TERMINAL_PROMPT: "0" },
            timeoutMs: null,
            appendTruncationMarker: true,
          });
          yield* git.invalidateRefs(cwd);
          return {
            message:
              input.action === "stage"
                ? "Selected files staged."
                : input.action === "unstage"
                  ? "Selected files unstaged."
                  : input.action === "discard"
                    ? "Selected changes discarded."
                    : input.action === "commit"
                      ? input.amend
                        ? "Amended the latest commit."
                        : "Committed staged changes."
                      : input.action === "fetch"
                        ? "Fetched all remotes."
                        : result.stdout.trim() || "Changes stashed.",
          };
        }),
      );
    },
  );
  const releasePlan: GitExplorer["Service"]["releasePlan"] = Effect.fn("GitExplorer.releasePlan")(
    function* (input) {
      const { cwd, commonDirectory, worktrees } = yield* resolve(input);
      const { plan } = yield* withMutationLock(commonDirectory, planRelease(cwd, worktrees, input));
      return plan;
    },
  );

  const ancestors = Effect.fn("GitExplorer.ancestors")(function* (
    cwd: string,
    hash: string | null,
  ) {
    if (!hash) return { values: new Set<string>(), complete: true };
    const result = yield* run(cwd, ["rev-list", `--max-count=${MAX_ANCESTORS + 1}`, hash, "--"]);
    const hashes = result.stdout.trim().split("\n").filter(Boolean);
    return {
      values: new Set(hashes.slice(0, MAX_ANCESTORS)),
      complete: hashes.length <= MAX_ANCESTORS,
    };
  });
  const history: GitExplorer["Service"]["history"] = Effect.fn("GitExplorer.history")(
    function* (input) {
      const context = yield* resolve(input);
      const snapshot = snapshots.get(input.snapshotId);
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (
        !snapshot ||
        snapshot.projectId !== input.projectId ||
        snapshot.commonDirectory !== context.commonDirectory ||
        snapshot.overview.selectedWorktreePath !== context.cwd ||
        now - snapshot.touchedAt > SNAPSHOT_TTL_MS ||
        (yield* readShallowBoundary(context.commonDirectory)) !== snapshot.shallowBoundary
      )
        return yield* new GitExplorerError({ operation: "history", reason: "snapshot-expired" });
      snapshot.touchedAt = now;
      const limit = Math.max(1, Math.min(200, input.limit ?? 100));
      const cursor = Math.max(0, Math.min(1_000_000, input.cursor ?? 0));
      let tips =
        input.historyScope === "current"
          ? snapshot.overview.headHash
            ? [snapshot.overview.headHash]
            : []
          : snapshot.tips;
      if (tips.length === 0) return { commits: [], nextCursor: null };
      const search = input.search?.trim() ?? "";
      const filters: string[] = [];
      const paths: string[] = [];
      if (search) {
        switch (input.searchField ?? "message") {
          case "message":
            filters.push("--fixed-strings", "--regexp-ignore-case", `--grep=${search}`);
            break;
          case "author":
            filters.push("--fixed-strings", "--regexp-ignore-case", `--author=${search}`);
            break;
          case "path":
            paths.push(search);
            break;
          case "hash": {
            if (!/^[0-9a-f]{4,64}$/i.test(search)) return { commits: [], nextCursor: null };
            const resolved = yield* run(
              context.cwd,
              ["rev-parse", "--verify", `${search}^{commit}`],
              { allowNonZero: true },
            );
            const hash = resolved.stdout.trim();
            if (resolved.exitCode !== 0 || !HASH.test(hash))
              return { commits: [], nextCursor: null };
            if (!tips.includes(hash)) {
              // A descendant among the snapshot tips proves the match belongs to this view.
              const descendants = yield* run(
                context.cwd,
                ["rev-list", "--max-count=1", `--ancestry-path=${hash}`, `^${hash}`, "--stdin"],
                { stdin: tips.join("\n") + "\n" },
              );
              if (!descendants.stdout.trim()) return { commits: [], nextCursor: null };
            }
            tips = [hash];
            filters.push("--no-walk");
            break;
          }
        }
      }
      const result = yield* run(
        context.cwd,
        [
          "log",
          "--topo-order",
          "--no-show-signature",
          "--no-color",
          "-z",
          `--format=${FORMAT}`,
          `--skip=${cursor}`,
          `--max-count=${limit + 1}`,
          ...filters,
          "--stdin",
          "--",
          ...paths,
        ],
        { stdin: tips.join("\n") + "\n" },
      );
      const rows = commitsFromOutput(result.stdout);
      const current = snapshot.overview.refs.find(
        (ref) => ref.kind === "local" && ref.shortName === snapshot.overview.headBranch,
      );
      const upstream = snapshot.overview.refs.find((ref) => ref.name === current?.upstream);
      if (upstream && !snapshot.ancestors) {
        const [local, remote] = yield* Effect.all(
          [
            ancestors(context.cwd, snapshot.overview.headHash),
            ancestors(context.cwd, upstream.hash),
          ],
          { concurrency: 2 },
        );
        snapshot.ancestors = {
          local: local.values,
          upstream: remote.values,
          localComplete: local.complete,
          upstreamComplete: remote.complete,
        };
      }
      const membership = snapshot.ancestors;
      const commits = rows.slice(0, limit).map((commit): GitExplorerCommit => {
        if (!membership) return commit;
        const local = membership.local.has(commit.hash);
        const remote = membership.upstream.has(commit.hash);
        const upstreamStatus =
          local && remote
            ? "shared"
            : local && membership.upstreamComplete
              ? "local-only"
              : remote && membership.localComplete
                ? "upstream-only"
                : membership.localComplete && membership.upstreamComplete
                  ? "other"
                  : "unknown";
        return { ...commit, upstreamStatus };
      });
      if ((yield* readShallowBoundary(context.commonDirectory)) !== snapshot.shallowBoundary)
        return yield* new GitExplorerError({ operation: "history", reason: "snapshot-expired" });
      return { commits, nextCursor: rows.length > limit ? cursor + limit : null };
    },
  );
  const commitDetails = Effect.fn("GitExplorer.commitDetails")(function* (
    cwd: string,
    revision: string,
  ) {
    if (!HASH.test(revision))
      return yield* new GitExplorerError({ operation: "commit", reason: "invalid-revision" });
    const result = yield* run(
      cwd,
      ["show", "-s", "--no-show-signature", "-z", `--format=${FORMAT}%x00%b`, revision, "--"],
      { allowNonZero: true },
    );
    const fields = result.stdout.split("\0");
    const commit = commitsFromOutput(fields.slice(0, 7).join("\0"))[0];
    if (result.exitCode !== 0 || !commit || commit.hash !== revision)
      return yield* new GitExplorerError({ operation: "commit", reason: "invalid-revision" });
    return { ...commit, body: fields[7] ?? "" };
  });
  const diffArgs = (revision: string | null, parent: string | null, stage: GitExplorerFileStage) =>
    revision
      ? parent
        ? ["diff", ...DIFF_OPTIONS, parent, revision]
        : ["diff-tree", "--root", "--no-commit-id", "-r", ...DIFF_OPTIONS, revision]
      : ["diff", ...DIFF_OPTIONS, ...(stage === "staged" ? ["--cached"] : [])];
  const readFiles = Effect.fn("GitExplorer.readFiles")(function* (
    cwd: string,
    revision: string | null,
    parent: string | null,
    stage: GitExplorerFileStage,
  ) {
    const result = yield* run(
      cwd,
      [...diffArgs(revision, parent, stage), "--raw", "--numstat", "--no-abbrev", "-z", "--"],
      { truncate: true },
    );
    return {
      files: parseFiles(
        result.stdoutTruncated
          ? result.stdout.slice(0, result.stdout.lastIndexOf("\0") + 1)
          : result.stdout,
        stage,
      ),
      truncated: result.stdoutTruncated,
    };
  });
  const details: GitExplorer["Service"]["details"] = Effect.fn("GitExplorer.details")(
    function* (input) {
      const { cwd, commonDirectory } = yield* resolve(input);
      if (input.revision) {
        const commit = yield* commitDetails(cwd, input.revision);
        const comparisonParent = commit.parents[0] ?? null;
        const stash =
          commit.parents.length >= 2
            ? yield* findStash(cwd, commonDirectory, input.projectId, input.revision)
            : null;
        const result = yield* readFiles(cwd, input.revision, comparisonParent, "committed");
        const untracked =
          stash && commit.parents[2]
            ? yield* readFiles(cwd, commit.parents[2], null, "stash-untracked")
            : { files: [], truncated: false };
        const files: GitExplorerFile[] = [
          ...result.files,
          ...untracked.files.map((file): GitExplorerFile => ({ ...file, status: "untracked" })),
        ];
        return {
          commit,
          stash,
          comparisonParent,
          files: files.slice(0, MAX_FILES),
          truncated: result.truncated || untracked.truncated || files.length > MAX_FILES,
        };
      }
      const [staged, unstaged, untracked, index] = yield* Effect.all(
        [
          readFiles(cwd, null, null, "staged"),
          readFiles(cwd, null, null, "unstaged"),
          run(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { truncate: true }),
          run(cwd, ["ls-files", "--stage", "-z"]),
        ],
        { concurrency: 3 },
      );
      const untrackedPaths = untracked.stdout.split("\0");
      untrackedPaths.pop();
      const files: GitExplorerFile[] = [
        ...staged.files,
        ...unstaged.files,
        ...untrackedPaths.map((filePath): GitExplorerFile => ({
          path: filePath,
          oldPath: null,
          status: "untracked",
          stage: "untracked",
          additions: null,
          deletions: null,
          binary: false,
        })),
      ];
      return {
        indexVersion: yield* contentToken(index.stdout),
        commit: null,
        stash: null,
        comparisonParent: null,
        files: files.slice(0, MAX_FILES),
        truncated:
          staged.truncated ||
          unstaged.truncated ||
          untracked.stdoutTruncated ||
          files.length > MAX_FILES,
      };
    },
  );
  const patch: GitExplorer["Service"]["patch"] = Effect.fn("GitExplorer.patch")(function* (input) {
    if (
      !input.path ||
      path.isAbsolute(input.path) ||
      input.path.includes("\0") ||
      input.path.split(/[\\/]/).some((part) => part === ".." || part === ".git") ||
      input.path.startsWith(":(")
    )
      return yield* new GitExplorerError({ operation: "patch", reason: "invalid-path" });
    if (
      (input.revision === null) ===
      (input.stage === "committed" || input.stage === "stash-untracked")
    )
      return yield* new GitExplorerError({ operation: "patch", reason: "invalid-path" });
    const { cwd, commonDirectory } = yield* resolve(input);
    if (input.stage === "untracked") {
      const listed = yield* run(cwd, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        input.path,
      ]);
      if (!listed.stdout.split("\0").includes(input.path))
        return yield* new GitExplorerError({ operation: "patch", reason: "invalid-path" });
      const parent = yield* canonical(path.dirname(path.join(cwd, input.path)));
      const relative = path.relative(cwd, parent);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
        return yield* new GitExplorerError({ operation: "patch", reason: "invalid-path" });
      const result = yield* run(
        cwd,
        [
          "diff",
          "--no-index",
          "--binary",
          ...DIFF_OPTIONS,
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--",
          platform === "win32" ? "NUL" : "/dev/null",
          input.path,
        ],
        { maxBytes: MAX_PATCH_BYTES, truncate: true, allowNonZero: true },
      );
      if (result.exitCode !== 0 && result.exitCode !== 1 && !result.stdoutTruncated)
        return yield* new GitExplorerError({ operation: "patch", reason: "read-failed" });
      return {
        ...(!result.stdoutTruncated ? { changeToken: yield* contentToken(result.stdout) } : {}),
        patch: result.stdoutTruncated ? "" : result.stdout,
        binary:
          result.stdout.includes("Binary files ") || result.stdout.includes("GIT binary patch"),
        truncated: result.stdoutTruncated,
      };
    }
    const commit = input.revision ? yield* commitDetails(cwd, input.revision) : null;
    let revision = input.revision;
    let parent = commit?.parents[0] ?? null;
    if (input.stage === "stash-untracked") {
      const stash = revision
        ? yield* findStash(cwd, commonDirectory, input.projectId, revision)
        : null;
      if (!stash || !commit?.parents[2])
        return yield* new GitExplorerError({ operation: "patch", reason: "invalid-path" });
      revision = commit.parents[2];
      parent = null;
    }
    const listed = yield* readFiles(cwd, revision, parent, input.stage);
    const file = listed.files.find((file) => file.path === input.path);
    if (!file) return yield* new GitExplorerError({ operation: "patch", reason: "invalid-path" });
    const result = yield* run(
      cwd,
      [
        ...diffArgs(revision, parent, input.stage),
        "--patch",
        ...(input.revision === null ? ["--binary"] : []),
        ...(file.status === "unmerged" && input.stage === "unstaged" ? ["--ours"] : []),
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        ...(file.oldPath ? [file.oldPath] : []),
        input.path,
      ],
      { maxBytes: MAX_PATCH_BYTES, truncate: true },
    );
    return {
      ...(input.revision === null && !result.stdoutTruncated
        ? { changeToken: yield* contentToken(result.stdout) }
        : {}),
      patch: result.stdoutTruncated ? "" : result.stdout,
      binary: file.binary || result.stdout.includes("Binary files "),
      truncated: result.stdoutTruncated,
    };
  });
  return GitExplorer.of({
    overview,
    history,
    details,
    patch,
    branchStatuses,
    deleteBranch,
    runAction,
    releasePlan,
  });
});

export const layer = Layer.effect(GitExplorer, make);
