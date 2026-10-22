import {
  GitExplorerError,
  type GitExplorerCommit,
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
  type GitExplorerStash,
  type GitExplorerWorktree,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export class GitExplorer extends Context.Service<
  GitExplorer,
  {
    readonly overview: (
      input: GitExplorerOverviewInput,
    ) => Effect.Effect<GitExplorerOverviewResult, GitExplorerError>;
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
const MAX_STASHES = 200;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_ANCESTORS = 25_000;
const SNAPSHOT_TTL_MS = 30 * 60_000;

type Snapshot = {
  signature: string;
  shallowBoundary: string;
  overview: GitExplorerOverviewResult;
  projectId: string;
  commonDirectory: string;
  tips: readonly string[];
  touchedAt: number;
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
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const snapshots = new Map<string, Snapshot>();

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
        env: { GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
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
    const commonDirectory = yield* canonical(
      (yield* run(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim(),
    );
    const worktreeOutput = (yield* run(root, ["worktree", "list", "--porcelain", "-z"])).stdout;
    const worktrees = parseWorktrees(worktreeOutput);
    const cwd = input.worktreePath === undefined ? root : yield* canonical(input.worktreePath);
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
  const readOverviewState = Effect.fn("GitExplorer.readOverviewState")(function* (
    input: GitExplorerOverviewInput,
  ) {
    // A commit can move the branch between worktree enumeration and ref enumeration.
    for (let attempt = 0; attempt < 2; attempt++) {
      const context = yield* resolve(input);
      const output = yield* run(context.cwd, [
        "for-each-ref",
        "--count=2049",
        "--format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ]);
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
      if (output.stdout.split("\n").filter(Boolean).length > 2048)
        return yield* new GitExplorerError({ operation: "refs", reason: "too-large" });
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
      if (refs.length > 2048)
        return yield* new GitExplorerError({ operation: "refs", reason: "too-large" });
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
      ]
        .map((value) => `${value.length}:${value}`)
        .join("");
      const signatureHash = yield* crypto
        .digest("SHA-256", new TextEncoder().encode(signature))
        .pipe(
          Effect.map(Hex.encode),
          Effect.mapError(
            (cause) =>
              new GitExplorerError({ operation: "snapshot", reason: "read-failed", cause }),
          ),
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
      const snapshotId = yield* crypto
        .randomUUIDv4()
        .pipe(
          Effect.mapError(
            (cause) =>
              new GitExplorerError({ operation: "snapshot", reason: "read-failed", cause }),
          ),
        );
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
      if (snapshot.tips.length === 0) return { commits: [], nextCursor: null };
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
          "--stdin",
          "--",
        ],
        { stdin: snapshot.tips.join("\n") + "\n" },
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
      const [staged, unstaged, untracked] = yield* Effect.all(
        [
          readFiles(cwd, null, null, "staged"),
          readFiles(cwd, null, null, "unstaged"),
          run(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { truncate: true }),
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
      patch: result.stdoutTruncated ? "" : result.stdout,
      binary: file.binary || result.stdout.includes("Binary files "),
      truncated: result.stdoutTruncated,
    };
  });
  return GitExplorer.of({ overview, history, details, patch });
});

export const layer = Layer.effect(GitExplorer, make);
