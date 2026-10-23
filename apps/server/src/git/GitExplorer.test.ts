import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitExplorer from "./GitExplorer.ts";

const projectId = ProjectId.make("git-explorer-test");
const scope = { projectId };
const layer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-explorer-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-explorer-repo-" });
  const git = Effect.fn("GitExplorer.test.git")(function* (args: readonly string[]) {
    return (yield* driver.execute({ operation: "GitExplorer.test", cwd, args })).stdout.trim();
  });
  const write = (name: string, contents: string) =>
    fs.writeFileString(path.join(cwd, name), contents);
  yield* git(["init", "--initial-branch=main"]);
  yield* git(["config", "user.email", "test@example.com"]);
  yield* git(["config", "user.name", "Test Author"]);
  yield* git(["config", "core.autocrlf", "false"]);
  yield* write("hello.txt", "first\n");
  yield* git(["add", "."]);
  yield* git(["commit", "-m", "root"]);
  const root = yield* git(["rev-parse", "HEAD"]);
  const projectStore = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (id) =>
      Effect.succeed(
        id === projectId
          ? Option.some({
              projectId,
              title: "Git",
              workspaceRoot: cwd,
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
  const explorer = yield* GitExplorer.GitExplorer.pipe(
    Effect.provide(GitExplorer.layer.pipe(Layer.provide(projectStore))),
  );
  return { fs, path, cwd, git, write, root, explorer, projectStore };
});

it.layer(layer)("GitExplorer", (it) => {
  it.effect("switches existing branches and renames without losing local changes or upstream", () =>
    Effect.gen(function* () {
      const { explorer, git, write, root } = yield* fixture;
      yield* git(["branch", "feature/old"]);
      yield* git(["config", "branch.feature/old.remote", "."]);
      yield* git(["config", "branch.feature/old.merge", "refs/heads/main"]);
      yield* write("hello.txt", "keep local edits\n");
      const target = {
        ...scope,
        expectedHead: root,
        expectedBranch: "main",
        branchName: "refs/heads/feature/old",
        branchHash: root,
      };
      yield* explorer.runAction({ ...target, action: "switch" });
      assert.equal(yield* git(["branch", "--show-current"]), "feature/old");
      yield* explorer.runAction({
        ...target,
        expectedBranch: "feature/old",
        action: "rename",
        newName: "feature/new",
      });
      assert.equal(yield* git(["branch", "--show-current"]), "feature/new");
      assert.equal(yield* git(["config", "branch.feature/new.merge"]), "refs/heads/main");
      assert.include(yield* git(["diff"]), "keep local edits");
    }),
  );

  it.effect("rejects stale branch actions, invalid names and branches checked out elsewhere", () =>
    Effect.gen(function* () {
      const { explorer, git, cwd, path, root } = yield* fixture;
      yield* git(["branch", "feature"]);
      const target = {
        ...scope,
        expectedHead: root,
        expectedBranch: "main",
        branchName: "refs/heads/feature",
        branchHash: root,
      };
      assert.equal(
        (yield* explorer
          .runAction({ ...target, branchHash: "a".repeat(40), action: "switch" })
          .pipe(Effect.flip))._tag,
        "GitExplorerError",
      );
      assert.equal(
        (yield* explorer
          .runAction({ ...target, action: "rename", newName: "--bad" })
          .pipe(Effect.flip))._tag,
        "GitExplorerError",
      );
      yield* git(["worktree", "add", path.join(cwd, "other"), "feature"]);
      assert.equal(
        (yield* explorer
          .runAction({ ...target, action: "rename", newName: "other-name" })
          .pipe(Effect.flip))._tag,
        "GitExplorerError",
      );
      assert.equal(
        (yield* explorer.runAction({ ...target, action: "switch" }).pipe(Effect.flip))._tag,
        "GitExplorerError",
      );
      assert.equal(yield* git(["branch", "--show-current"]), "main");
      assert.equal(yield* git(["rev-parse", "refs/heads/feature"]), root);
    }),
  );

  it.effect(
    "stashes tracked and untracked changes and restores the index without dropping the stash",
    () =>
      Effect.gen(function* () {
        const { explorer, git, write, root } = yield* fixture;
        yield* write("hello.txt", "staged\n");
        yield* git(["add", "hello.txt"]);
        yield* write("hello.txt", "unstaged\n");
        yield* write("new.txt", "untracked\n");
        const before = yield* git(["status", "--porcelain"]);
        const target = { ...scope, expectedHead: root, expectedBranch: "main" };
        yield* explorer.runAction({ ...target, action: "stash", message: "Save test changes" });
        assert.equal(yield* git(["status", "--porcelain"]), "");
        const saved = (yield* explorer.overview(scope)).stashes[0]!;
        assert.include(saved.subject, "Save test changes");
        yield* explorer.runAction({ ...target, action: "apply-stash", stashHash: saved.hash });
        assert.equal(yield* git(["status", "--porcelain"]), before);
        assert.equal(yield* git(["show", ":hello.txt"]), "staged");
        assert.lengthOf((yield* explorer.overview(scope)).stashes, 1);
      }),
  );

  it.effect("refuses stale action targets and stashes that are no longer listed", () =>
    Effect.gen(function* () {
      const { explorer, git, write, root } = yield* fixture;
      yield* write("hello.txt", "changed\n");
      yield* git(["switch", "-c", "other"]);
      const target = { ...scope, expectedHead: root, expectedBranch: "main" };
      assert.equal(
        (yield* explorer.runAction({ ...target, action: "stash" }).pipe(Effect.flip))._tag,
        "GitExplorerError",
      );
      assert.include(yield* git(["status", "--porcelain"]), "hello.txt");
      assert.equal(
        (yield* explorer
          .runAction({ ...target, expectedBranch: "other", action: "apply-stash", stashHash: root })
          .pipe(Effect.flip))._tag,
        "GitExplorerError",
      );
    }),
  );

  it.effect(
    "pushes, fetches without moving HEAD, and pulls by fast-forward from a local remote",
    () =>
      Effect.gen(function* () {
        const { explorer, git, write, fs, root } = yield* fixture;
        const remote = yield* fs.makeTempDirectoryScoped({ prefix: "t3-explorer-remote-" });
        yield* git(["init", "--bare", remote]);
        yield* git(["remote", "add", "origin", remote]);
        const target = { ...scope, expectedHead: root, expectedBranch: "main" };
        yield* explorer.runAction({ ...target, action: "push" });
        assert.equal(yield* git(["rev-parse", "@{upstream}"]), root);
        yield* write("hello.txt", "remote change\n");
        yield* git(["commit", "-am", "remote update"]);
        const updated = yield* git(["rev-parse", "HEAD"]);
        yield* git(["push"]);
        yield* git(["reset", "--hard", root]);
        yield* git(["update-ref", "refs/remotes/origin/main", root]);
        yield* explorer.runAction({ ...target, action: "fetch" });
        assert.equal(yield* git(["rev-parse", "HEAD"]), root);
        assert.equal(yield* git(["rev-parse", "origin/main"]), updated);
        yield* explorer.runAction({ ...target, action: "pull" });
        assert.equal(yield* git(["rev-parse", "HEAD"]), updated);
      }),
  );

  it.effect("reviews root commits and paginates immutable tips across concurrent commits", () =>
    Effect.gen(function* () {
      const { explorer, git, write, root } = yield* fixture;
      const details = yield* explorer.details({ ...scope, revision: root });
      assert.equal(details.comparisonParent, null);
      assert.equal(details.files[0]?.status, "added");
      assert.equal(details.files[0]?.additions, 1);
      const patch = yield* explorer.patch({
        ...scope,
        revision: root,
        path: "hello.txt",
        stage: "committed",
      });
      assert.include(patch.patch, "+first");
      yield* write("hello.txt", "second\n");
      yield* git(["commit", "-am", "second"]);
      const overview = yield* explorer.overview(scope);
      const first = yield* explorer.history({
        ...scope,
        snapshotId: overview.snapshotId,
        limit: 1,
      });
      yield* write("hello.txt", "third\n");
      yield* git(["commit", "-am", "third"]);
      const second = yield* explorer.history({
        ...scope,
        snapshotId: overview.snapshotId,
        cursor: first.nextCursor!,
        limit: 1,
      });
      assert.equal(first.commits[0]?.subject, "second");
      assert.equal(second.commits[0]?.hash, root);
      assert.equal(second.nextCursor, null);
    }),
  );

  it.effect(
    "separates staged, unstaged, untracked and binary changes without touching the index",
    () =>
      Effect.gen(function* () {
        const { explorer, git, write, fs, path, cwd } = yield* fixture;
        yield* write("hello.txt", "staged\n");
        yield* git(["add", "hello.txt"]);
        yield* write("hello.txt", "unstaged\n");
        yield* write("untracked.txt", "new\n");
        yield* fs.writeFile(path.join(cwd, "binary.dat"), new Uint8Array([0, 1, 2]));
        const before = yield* fs.readFile(path.join(cwd, ".git", "index"));
        const details = yield* explorer.details({ ...scope, revision: null });
        assert.sameMembers(
          details.files.filter((file) => file.path === "hello.txt").map((file) => file.stage),
          ["staged", "unstaged"],
        );
        assert.equal(
          details.files.find((file) => file.path === "untracked.txt")?.stage,
          "untracked",
        );
        const patch = yield* explorer.patch({
          ...scope,
          revision: null,
          path: "untracked.txt",
          stage: "untracked",
        });
        assert.include(patch.patch, "+new");
        const binary = yield* explorer.patch({
          ...scope,
          revision: null,
          path: "binary.dat",
          stage: "untracked",
        });
        assert.isTrue(binary.binary);
        assert.deepEqual(yield* fs.readFile(path.join(cwd, ".git", "index")), before);
      }),
  );

  it.effect("rejects unrelated worktrees, path traversal and revision option injection", () =>
    Effect.gen(function* () {
      const { explorer, fs, root } = yield* fixture;
      const other = yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-explorer-other-" });
      assert.equal(
        (yield* explorer.overview({ ...scope, worktreePath: other }).pipe(Effect.flip)).reason,
        "invalid-worktree",
      );
      assert.equal(
        (yield* explorer
          .patch({ ...scope, revision: null, path: "../secret", stage: "untracked" })
          .pipe(Effect.flip)).reason,
        "invalid-path",
      );
      assert.equal(
        (yield* explorer.details({ ...scope, revision: "--all" }).pipe(Effect.flip)).reason,
        "invalid-revision",
      );
      assert.equal(
        (yield* explorer
          .patch({ ...scope, revision: root, path: ":(glob)*", stage: "committed" })
          .pipe(Effect.flip)).reason,
        "invalid-path",
      );
    }),
  );
  it.effect(
    "uses upstream ancestry for diverged, synchronized, missing and unconfigured branches",
    () =>
      Effect.gen(function* () {
        const { explorer, git, write, root } = yield* fixture;
        yield* git(["config", "remote.origin.url", "https://invalid.example/never-contact.git"]);
        yield* git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
        yield* git(["switch", "-c", "remote-work"]);
        yield* write("remote.txt", "remote\n");
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "remote-only"]);
        const remote = yield* git(["rev-parse", "HEAD"]);
        yield* git(["update-ref", "refs/remotes/origin/main", remote]);
        yield* git(["switch", "main"]);
        yield* write("local.txt", "local\n");
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "local-only"]);
        const local = yield* git(["rev-parse", "HEAD"]);
        yield* git(["branch", "--set-upstream-to=origin/main", "main"]);
        yield* git(["branch", "synced", remote]);
        yield* git(["branch", "--set-upstream-to=origin/main", "synced"]);
        yield* git(["branch", "unconfigured", root]);
        yield* git(["branch", "missing", root]);
        yield* git(["config", "branch.missing.remote", "origin"]);
        yield* git(["config", "branch.missing.merge", "refs/heads/gone"]);
        const overview = yield* explorer.overview(scope);
        const main = overview.refs.find((ref) => ref.shortName === "main")!;
        assert.equal(main.ahead, 1);
        assert.equal(main.behind, 1);
        assert.equal(overview.refs.find((ref) => ref.shortName === "synced")?.ahead, 0);
        assert.equal(overview.refs.find((ref) => ref.shortName === "synced")?.behind, 0);
        assert.equal(overview.refs.find((ref) => ref.shortName === "unconfigured")?.upstream, null);
        assert.isTrue(overview.refs.find((ref) => ref.shortName === "missing")!.upstreamMissing);
        assert.equal(overview.lastFetchAt, null);
        assert.equal((yield* explorer.overview(scope)).snapshotId, overview.snapshotId);
        const history = yield* explorer.history({ ...scope, snapshotId: overview.snapshotId });
        assert.equal(
          history.commits.find((commit) => commit.hash === local)?.upstreamStatus,
          "local-only",
        );
        assert.equal(
          history.commits.find((commit) => commit.hash === remote)?.upstreamStatus,
          "upstream-only",
        );
        assert.equal(
          history.commits.find((commit) => commit.hash === root)?.upstreamStatus,
          "shared",
        );
      }),
  );

  it.effect(
    "includes detached worktree HEADs and isolates working tree review without checkout",
    () =>
      Effect.gen(function* () {
        const { explorer, git, write, root, fs, path, cwd } = yield* fixture;
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const worktreeParent = yield* fs.makeTempDirectoryScoped({
          prefix: "t3-git-explorer-worktree-",
        });
        const worktree = path.join(worktreeParent, "linked");
        yield* git(["worktree", "add", "--detach", worktree, root]);
        yield* fs.writeFileString(path.join(worktree, "detached.txt"), "detached\n");
        yield* driver.execute({ operation: "GitExplorer.test", cwd: worktree, args: ["add", "."] });
        yield* driver.execute({
          operation: "GitExplorer.test",
          cwd: worktree,
          args: ["commit", "-m", "detached commit"],
        });
        yield* write("main-only.txt", "main\n");
        yield* fs.writeFileString(path.join(worktree, "linked-only.txt"), "linked\n");
        const main = yield* explorer.overview(scope);
        const history = yield* explorer.history({ ...scope, snapshotId: main.snapshotId });
        assert.isTrue(history.commits.some((commit) => commit.subject === "detached commit"));
        const selected = yield* explorer.overview({ ...scope, worktreePath: worktree });
        assert.equal(selected.headBranch, null);
        assert.equal(selected.worktrees.length, 2);
        assert.notEqual(selected.headHash, main.headHash);
        const details = yield* explorer.details({
          ...scope,
          worktreePath: worktree,
          revision: null,
        });
        assert.sameMembers(
          details.files.map((file) => file.path),
          ["linked-only.txt"],
        );
        assert.equal(yield* git(["rev-parse", "HEAD"]), root);
        assert.equal(yield* git(["symbolic-ref", "--short", "HEAD"]), "main");
        const mainDetails = yield* explorer.details({
          ...scope,
          worktreePath: cwd,
          revision: null,
        });
        assert.sameMembers(
          mainDetails.files.map((file) => file.path),
          ["main-only.txt"],
        );
      }),
  );

  it.effect("preserves rename paths and compares merge commits to their first parent", () =>
    Effect.gen(function* () {
      const { explorer, git, write, fs, path, cwd } = yield* fixture;
      const oldName = "old\tname.txt";
      const newName = "new\nname.txt";
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join("");
      yield* write(oldName, lines);
      yield* git(["add", "."]);
      yield* git(["commit", "-m", "before rename"]);
      yield* fs.rename(path.join(cwd, oldName), path.join(cwd, newName));
      yield* write(newName, lines + "added line\n");
      yield* git(["add", "-A"]);
      yield* git(["commit", "-m", "rename"]);
      const renamed = yield* git(["rev-parse", "HEAD"]);
      const details = yield* explorer.details({ ...scope, revision: renamed });
      assert.equal(details.files[0]?.status, "renamed");
      assert.equal(details.files[0]?.oldPath, oldName);
      assert.equal(details.files[0]?.path, newName);
      assert.equal(details.files[0]?.additions, 1);
      const patch = yield* explorer.patch({
        ...scope,
        revision: renamed,
        stage: "committed",
        path: newName,
      });
      assert.include(patch.patch, "rename from");
      assert.include(patch.patch, "+added line");
      assert.notInclude(patch.patch, "+line 0");
      yield* git(["switch", "-c", "topic"]);
      yield* write("topic.txt", "topic\n");
      yield* git(["add", "."]);
      yield* git(["commit", "-m", "topic"]);
      yield* git(["switch", "main"]);
      yield* git(["merge", "--no-ff", "topic", "-m", "merge topic"]);
      const merge = yield* git(["rev-parse", "HEAD"]);
      const merged = yield* explorer.details({ ...scope, revision: merge });
      assert.equal(merged.commit?.parents.length, 2);
      assert.equal(merged.stash, null);
      assert.equal(merged.comparisonParent, renamed);
      assert.sameMembers(
        merged.files.map((file) => file.path),
        ["topic.txt"],
      );
    }),
  );

  it.effect("bounds large patches and disables external diff helpers", () =>
    Effect.gen(function* () {
      const { explorer, git, write, fs, path, cwd } = yield* fixture;
      yield* write("huge.txt", "x".repeat(600_000));
      yield* git(["add", "."]);
      yield* git(["commit", "-m", "large"]);
      const revision = yield* git(["rev-parse", "HEAD"]);
      const large = yield* explorer.patch({
        ...scope,
        revision,
        stage: "committed",
        path: "huge.txt",
      });
      assert.isTrue(large.truncated);
      assert.equal(large.patch, "");
      yield* git(["config", "diff.external", "this-executable-must-never-run"]);
      yield* git(["config", "log.showSignature", "true"]);
      yield* write("hello.txt", "changed\n");
      const patch = yield* explorer.patch({
        ...scope,
        revision: null,
        stage: "unstaged",
        path: "hello.txt",
      });
      assert.include(patch.patch, "+changed");
      const overview = yield* explorer.overview(scope);
      const history = yield* explorer.history({ ...scope, snapshotId: overview.snapshotId });
      assert.equal(history.commits.length, 2);
      assert.isFalse(yield* fs.exists(path.join(cwd, ".git", "index.lock")));
    }),
  );

  it.effect("represents an unborn repository without inventing commits", () =>
    Effect.gen(function* () {
      const { explorer, git, write } = yield* fixture;
      yield* git(["switch", "--orphan", "unborn"]);
      yield* git(["branch", "-D", "main"]);
      const overview = yield* explorer.overview(scope);
      assert.equal(overview.headHash, null);
      assert.equal(overview.headBranch, "unborn");
      assert.deepEqual(
        (yield* explorer.history({ ...scope, snapshotId: overview.snapshotId })).commits,
        [],
      );
      yield* write("new.txt", "new\n");
      yield* git(["add", "new.txt"]);
      const details = yield* explorer.details({ ...scope, revision: null });
      assert.equal(details.files[0]?.status, "added");
      const patch = yield* explorer.patch({
        ...scope,
        revision: null,
        stage: "staged",
        path: "new.txt",
      });
      assert.include(patch.patch, "+new");
    }),
  );
  it.effect("reports gitlink changes instead of hiding submodule revisions", () =>
    Effect.gen(function* () {
      const { explorer, git, root } = yield* fixture;
      yield* git(["update-index", "--add", "--cacheinfo", `160000,${root},dependency`]);
      yield* git(["commit", "-m", "add gitlink"]);
      const revision = yield* git(["rev-parse", "HEAD"]);
      const details = yield* explorer.details({ ...scope, revision });
      assert.equal(details.files.find((file) => file.path === "dependency")?.status, "added");
      const patch = yield* explorer.patch({
        ...scope,
        revision,
        stage: "committed",
        path: "dependency",
      });
      assert.include(patch.patch, `+Subproject commit ${root}`);
    }),
  );

  it.effect("keeps conflicted paths unique and renders the working file against ours", () =>
    Effect.gen(function* () {
      const { explorer, git, write, cwd } = yield* fixture;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      yield* git(["switch", "-c", "topic"]);
      yield* write("hello.txt", "topic\n");
      yield* git(["commit", "-am", "topic"]);
      yield* git(["switch", "main"]);
      yield* write("hello.txt", "main\n");
      yield* git(["commit", "-am", "main"]);
      yield* driver.execute({
        operation: "GitExplorer.test",
        cwd,
        args: ["merge", "topic"],
        allowNonZeroExit: true,
      });
      const details = yield* explorer.details({ ...scope, revision: null });
      const unstaged = details.files.filter((file) => file.stage === "unstaged");
      assert.equal(unstaged.length, 1);
      assert.equal(unstaged[0]?.status, "unmerged");
      const patch = yield* explorer.patch({
        ...scope,
        revision: null,
        stage: "unstaged",
        path: "hello.txt",
      });
      assert.include(patch.patch, "diff --git a/hello.txt b/hello.txt");
      assert.include(patch.patch, "+<<<<<<< HEAD");
    }),
  );

  it.effect("expires inactive snapshots and reports only locally observed fetch timestamps", () =>
    Effect.gen(function* () {
      const { explorer, fs, path, cwd } = yield* fixture;
      const overview = yield* explorer.overview(scope);
      assert.equal(overview.lastFetchAt, null);
      yield* fs.writeFileString(
        path.join(cwd, ".git", "FETCH_HEAD"),
        "recorded by a different git process\n",
      );
      const refreshed = yield* explorer.overview(scope);
      assert.isNotNull(refreshed.lastFetchAt);
      assert.equal(refreshed.snapshotId, overview.snapshotId);
      yield* TestClock.adjust("31 minutes");
      const expired = yield* explorer
        .history({ ...scope, snapshotId: overview.snapshotId })
        .pipe(Effect.flip);
      assert.equal(expired.reason, "snapshot-expired");
      const renewed = yield* explorer.overview(scope);
      assert.notEqual(renewed.snapshotId, overview.snapshotId);
      assert.equal(
        (yield* explorer.history({ ...scope, snapshotId: renewed.snapshotId })).commits.length,
        1,
      );
    }),
  );
  it.effect("invalidates ancestry snapshots when shallow history deepens with unchanged tips", () =>
    Effect.gen(function* () {
      const { explorer, git, write, root, fs, path, cwd } = yield* fixture;
      yield* write("hello.txt", "second\n");
      yield* git(["commit", "-am", "second"]);
      const boundary = yield* git(["rev-parse", "HEAD"]);
      yield* write("hello.txt", "third\n");
      yield* git(["commit", "-am", "third"]);
      yield* git(["config", "remote.origin.url", "https://invalid.example/never-contact.git"]);
      yield* git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
      yield* git(["update-ref", "refs/remotes/origin/main", root]);
      yield* git(["branch", "--set-upstream-to=origin/main", "main"]);
      yield* fs.writeFileString(path.join(cwd, ".git", "shallow"), `${boundary}\n`);
      const shallow = yield* explorer.overview(scope);
      assert.equal(shallow.refs.find((ref) => ref.shortName === "main")?.behind, 1);
      const before = yield* explorer.history({ ...scope, snapshotId: shallow.snapshotId });
      assert.equal(
        before.commits.find((commit) => commit.hash === root)?.upstreamStatus,
        "upstream-only",
      );
      assert.deepEqual(before.commits.find((commit) => commit.hash === boundary)?.parents, []);
      yield* fs.remove(path.join(cwd, ".git", "shallow"));
      assert.equal(
        (yield* explorer.history({ ...scope, snapshotId: shallow.snapshotId }).pipe(Effect.flip))
          .reason,
        "snapshot-expired",
      );
      const complete = yield* explorer.overview(scope);
      assert.equal(complete.headHash, shallow.headHash);
      assert.notEqual(complete.snapshotId, shallow.snapshotId);
      assert.equal(complete.refs.find((ref) => ref.shortName === "main")?.behind, 0);
      const after = yield* explorer.history({ ...scope, snapshotId: complete.snapshotId });
      assert.equal(after.commits.find((commit) => commit.hash === root)?.upstreamStatus, "shared");
      assert.deepEqual(after.commits.find((commit) => commit.hash === boundary)?.parents, [root]);
    }),
  );

  it.effect.each([false, true])(
    "bounds worktree HEAD rereads during concurrent commits (continuous=%s)",
    (continuous) =>
      Effect.gen(function* () {
        const { cwd, projectStore } = yield* fixture;
        const driver = yield* GitVcsDriver.GitVcsDriver;
        let worktreeReads = 0;
        const racingDriver = Layer.succeed(GitVcsDriver.GitVcsDriver, {
          ...driver,
          execute: Effect.fn("GitExplorer.test.concurrentCommit")(function* (input) {
            const result = yield* driver.execute(input);
            if (input.args.includes("worktree") && input.args.includes("list")) {
              worktreeReads++;
              if (continuous || worktreeReads === 1)
                yield* driver.execute({
                  operation: "GitExplorer.test",
                  cwd,
                  args: ["commit", "--allow-empty", "-m", "concurrent"],
                });
            }
            return result;
          }),
        });
        const explorer = yield* GitExplorer.GitExplorer.pipe(
          Effect.provide(
            GitExplorer.layer.pipe(Layer.provide(Layer.merge(projectStore, racingDriver))),
          ),
        );
        if (continuous) {
          assert.equal(
            (yield* explorer.overview(scope).pipe(Effect.flip)).operation,
            "concurrent-head-change",
          );
        } else {
          const overview = yield* explorer.overview(scope);
          assert.equal(
            overview.headHash,
            overview.refs.find((ref) => ref.shortName === "main")?.hash,
          );
        }
        assert.equal(worktreeReads, 2);
      }),
  );

  it.effect("does not report an empty FETCH_HEAD from a failed fetch as a known fetch", () =>
    Effect.gen(function* () {
      const { explorer, fs, path, cwd } = yield* fixture;
      yield* fs.writeFileString(path.join(cwd, ".git", "FETCH_HEAD"), "");
      assert.equal((yield* explorer.overview(scope)).lastFetchAt, null);
    }),
  );
  it.effect("shows peeled commit tags and tagged-only history while skipping non-commit tags", () =>
    Effect.gen(function* () {
      const { explorer, git, write, root } = yield* fixture;
      const original = yield* explorer.overview(scope);
      yield* git(["tag", "lightweight", root]);
      yield* git(["tag", "-a", "annotated", root, "-m", "release"]);
      yield* git(["tag", "-a", "nested", "annotated", "-m", "nested tag"]);
      const blob = yield* git(["rev-parse", "HEAD:hello.txt"]);
      const tree = yield* git(["rev-parse", "HEAD^{tree}"]);
      yield* git(["tag", "blob", blob]);
      yield* git(["tag", "-a", "annotated-blob", blob, "-m", "blob tag"]);
      yield* git(["tag", "tree", tree]);
      yield* git(["switch", "--orphan", "tag-only"]);
      yield* write("release.txt", "release\n");
      yield* git(["add", "."]);
      yield* git(["commit", "-m", "tag-only history"]);
      const taggedOnly = yield* git(["rev-parse", "HEAD"]);
      yield* git(["tag", "release-only", taggedOnly]);
      yield* git(["switch", "main"]);
      yield* git(["branch", "-D", "tag-only"]);
      const overview = yield* explorer.overview(scope);
      assert.notEqual(overview.snapshotId, original.snapshotId);
      assert.deepEqual(overview.stashes, []);
      const tags = overview.refs.filter((ref) => ref.kind === "tag");
      assert.sameMembers(
        tags.map((ref) => ref.shortName),
        ["lightweight", "annotated", "nested", "release-only"],
      );
      for (const tag of tags.filter((ref) => ref.shortName !== "release-only"))
        assert.equal(tag.hash, root);
      assert.isTrue(
        tags.every((tag) => tag.upstream === null && tag.ahead === null && tag.behind === null),
      );
      const history = yield* explorer.history({ ...scope, snapshotId: overview.snapshotId });
      assert.isTrue(history.commits.some((commit) => commit.hash === taggedOnly));
      assert.sameMembers(
        history.commits.map((commit) => commit.hash),
        [root, taggedOnly],
      );
    }),
  );

  it.effect(
    "reviews multiple stashes and their saved untracked objects without touching Git state",
    () =>
      Effect.gen(function* () {
        const { explorer, git, write, root, fs, path, cwd } = yield* fixture;
        yield* write("hello.txt", "staged version\n");
        yield* git(["add", "hello.txt"]);
        yield* write("hello.txt", "saved working version\n");
        yield* write("loose.txt", "saved untracked version\n");
        yield* fs.writeFile(path.join(cwd, "loose.bin"), new Uint8Array([0, 1, 2]));
        yield* git(["stash", "push", "--include-untracked", "-m", "first stash"]);
        const first = yield* git(["rev-parse", "refs/stash"]);
        yield* write("hello.txt", "second stash version\n");
        yield* git(["stash", "push", "-m", "second stash"]);
        const second = yield* git(["rev-parse", "refs/stash"]);
        yield* write("hello.txt", "current working version\n");
        yield* write("loose.txt", "current untracked version\n");
        const indexBefore = yield* fs.readFile(path.join(cwd, ".git", "index"));
        const stashLogBefore = yield* fs.readFile(path.join(cwd, ".git", "logs", "refs", "stash"));
        const refsBefore = yield* git(["show-ref"]);
        const statusBefore = yield* git(["--no-optional-locks", "status", "--porcelain=v2", "-z"]);
        const overview = yield* explorer.overview(scope);
        assert.deepEqual(
          overview.stashes.map((stash) => [stash.name, stash.hash]),
          [
            ["stash@{0}", second],
            ["stash@{1}", first],
          ],
        );
        assert.include(overview.stashes[1]!.subject, "first stash");
        assert.match(overview.stashes[0]!.createdAt, /^\d{4}-/);
        const history = yield* explorer.history({ ...scope, snapshotId: overview.snapshotId });
        assert.deepEqual(
          history.commits.map((commit) => commit.hash),
          [root],
        );
        const details = yield* explorer.details({ ...scope, revision: first });
        assert.equal(details.stash?.hash, first);
        assert.equal(details.stash?.name, "stash@{1}");
        assert.equal(details.comparisonParent, root);
        assert.equal(details.files.find((file) => file.path === "hello.txt")?.stage, "committed");
        const loose = details.files.find((file) => file.path === "loose.txt");
        assert.equal(loose?.stage, "stash-untracked");
        assert.equal(loose?.status, "untracked");
        assert.equal(loose?.additions, 1);
        const trackedPatch = yield* explorer.patch({
          ...scope,
          revision: first,
          stage: "committed",
          path: "hello.txt",
        });
        assert.include(trackedPatch.patch, "+saved working version");
        assert.notInclude(trackedPatch.patch, "current working version");
        assert.notInclude(trackedPatch.patch, "staged version");
        const loosePatch = yield* explorer.patch({
          ...scope,
          revision: first,
          stage: "stash-untracked",
          path: "loose.txt",
        });
        assert.include(loosePatch.patch, "+saved untracked version");
        assert.notInclude(loosePatch.patch, "current untracked version");
        assert.isTrue(
          (yield* explorer.patch({
            ...scope,
            revision: first,
            stage: "stash-untracked",
            path: "loose.bin",
          })).binary,
        );
        assert.equal((yield* explorer.details({ ...scope, revision: second })).files.length, 1);
        assert.equal((yield* explorer.details({ ...scope, revision: root })).stash, null);
        assert.equal(
          (yield* explorer
            .patch({ ...scope, revision: root, stage: "stash-untracked", path: "hello.txt" })
            .pipe(Effect.flip)).reason,
          "invalid-path",
        );
        assert.deepEqual(yield* fs.readFile(path.join(cwd, ".git", "index")), indexBefore);
        assert.deepEqual(
          yield* fs.readFile(path.join(cwd, ".git", "logs", "refs", "stash")),
          stashLogBefore,
        );
        assert.equal(yield* git(["show-ref"]), refsBefore);
        assert.equal(
          yield* git(["--no-optional-locks", "status", "--porcelain=v2", "-z"]),
          statusBefore,
        );
      }),
  );

  it.effect("keeps stash selection pinned to its hash through reflog reordering and removal", () =>
    Effect.gen(function* () {
      const { explorer, git, write } = yield* fixture;
      yield* write("loose.txt", "original saved content\n");
      yield* git(["stash", "push", "--include-untracked", "-m", "original"]);
      const first = yield* git(["rev-parse", "refs/stash"]);
      yield* write("hello.txt", "newer\n");
      yield* git(["stash", "push", "-m", "newer"]);
      const initial = yield* explorer.overview(scope);
      yield* git(["stash", "drop", "stash@{0}"]);
      const reordered = yield* explorer.overview(scope);
      assert.notEqual(reordered.snapshotId, initial.snapshotId);
      const details = yield* explorer.details({ ...scope, revision: first });
      assert.equal(details.stash?.name, "stash@{0}");
      assert.equal(details.stash?.hash, first);
      yield* git(["stash", "drop", "stash@{0}"]);
      const removed = yield* explorer.overview(scope);
      assert.deepEqual(removed.stashes, []);
      const captured = yield* explorer.details({ ...scope, revision: first });
      assert.equal(captured.stash?.hash, first);
      assert.include(
        (yield* explorer.patch({
          ...scope,
          revision: first,
          stage: "stash-untracked",
          path: "loose.txt",
        })).patch,
        "+original saved content",
      );
    }),
  );
});

const branchFixture = Effect.gen(function* () {
  const setup = yield* fixture;
  const { git, write, root, explorer } = setup;
  yield* git(["config", "remote.origin.url", "https://invalid.example/never-contact.git"]);
  yield* git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  yield* git(["switch", "-c", "rebased"]);
  yield* write("feature.txt", "feature\n");
  yield* git(["add", "."]);
  yield* git(["commit", "-m", "feature before rebase"]);
  const original = yield* git(["rev-parse", "HEAD"]);
  yield* git(["switch", "main"]);
  yield* write("base.txt", "base advanced\n");
  yield* git(["add", "."]);
  yield* git(["commit", "-m", "base advance"]);
  yield* git(["cherry-pick", original]);
  const target = yield* git(["rev-parse", "HEAD"]);
  yield* git(["update-ref", "refs/remotes/origin/main", target]);
  yield* git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  yield* git(["branch", "done", root]);
  yield* git(["switch", "-c", "pending", root]);
  yield* write("pending.txt", "not merged\n");
  yield* git(["add", "."]);
  yield* git(["commit", "-m", "not merged"]);
  const pending = yield* git(["rev-parse", "HEAD"]);
  yield* git(["update-ref", "refs/remotes/origin/pending", pending]);
  yield* git(["branch", "--set-upstream-to=origin/pending", "pending"]);
  yield* git(["switch", "main"]);
  const statuses = Effect.fn("GitExplorer.test.branchStatuses")(function* (names: string[]) {
    const overview = yield* explorer.overview(scope);
    return (yield* explorer.branchStatuses({
      ...scope,
      snapshotId: overview.snapshotId,
      branches: names.map((name) => `refs/heads/${name}`),
    })).branches;
  });
  return { ...setup, original, target, pending, statuses };
});

it.layer(layer)("GitExplorer branch review", (it) => {
  it.effect("protects a merged branch reserved by detached rebase and bisect operations", () =>
    Effect.gen(function* () {
      const { explorer, git, target, root, cwd, fs, path } = yield* branchFixture;
      yield* git(["switch", "--detach"]);
      const request = {
        ...scope,
        branchName: "refs/heads/done",
        expectedHash: root,
        expectedTargetRef: "refs/remotes/origin/main",
        expectedTargetHash: target,
        allowEquivalent: false,
      };
      for (const relative of ["rebase-merge/head-name", "rebase-apply/head-name", "BISECT_START"]) {
        const file = path.join(cwd, ".git", relative);
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(
          file,
          relative === "BISECT_START" ? "done\n" : "refs/heads/done\n",
        );
        assert.equal(
          (yield* explorer.deleteBranch(request).pipe(Effect.flip)).reason,
          "branch-checked-out",
        );
        assert.equal(yield* git(["rev-parse", "done"]), root);
        assert.isFalse(yield* fs.exists(path.join(cwd, ".git", "HEAD.lock")));
        yield* fs.remove(file);
      }
    }),
  );

  it.effect(
    "preserves another process's HEAD lock and releases only locks acquired by deletion",
    () =>
      Effect.gen(function* () {
        const { explorer, git, target, original, cwd, fs, path } = yield* branchFixture;
        const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-branch-lock-" });
        const linked = path.join(parent, "linked");
        yield* git(["worktree", "add", "-b", "active-other", linked]);
        const existingLock = path.join(cwd, ".git", "worktrees", "linked", "HEAD.lock");
        yield* fs.writeFileString(existingLock, "another process");
        assert.equal(
          (yield* explorer
            .deleteBranch({
              ...scope,
              branchName: "refs/heads/rebased",
              expectedHash: original,
              expectedTargetRef: "refs/remotes/origin/main",
              expectedTargetHash: target,
              allowEquivalent: true,
            })
            .pipe(Effect.flip)).reason,
          "write-failed",
        );
        assert.equal(yield* fs.readFileString(existingLock), "another process");
        assert.isFalse(yield* fs.exists(path.join(cwd, ".git", "HEAD.lock")));
        assert.equal(yield* git(["rev-parse", "rebased"]), original);
      }),
  );

  it.effect("holds every registered worktree HEAD lock until the ref transaction completes", () =>
    Effect.gen(function* () {
      const { projectStore, git, target, original, cwd, fs, path } = yield* branchFixture;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-branch-checkout-" });
      const linked = path.join(parent, "linked");
      yield* git(["worktree", "add", "--detach", linked]);
      let blockedCheckout = false;
      const guardedDriver = GitVcsDriver.GitVcsDriver.of({
        ...driver,
        execute: (input) =>
          Effect.gen(function* () {
            if (input.operation === "GitExplorer.deleteBranch") {
              assert.isTrue(
                yield* fs.exists(path.join(cwd, ".git", "HEAD.lock")).pipe(Effect.orDie),
              );
              assert.isTrue(
                yield* fs
                  .exists(path.join(cwd, ".git", "worktrees", "linked", "HEAD.lock"))
                  .pipe(Effect.orDie),
              );
              const checkout = yield* driver.execute({
                operation: "GitExplorer.test.checkout",
                cwd: linked,
                args: ["switch", "rebased"],
                allowNonZeroExit: true,
              });
              blockedCheckout = checkout.exitCode !== 0 && checkout.stderr.includes("HEAD.lock");
            }
            return yield* driver.execute(input);
          }),
      });
      const explorer = yield* GitExplorer.GitExplorer.pipe(
        Effect.provide(
          GitExplorer.layer.pipe(
            Layer.provide(projectStore),
            Layer.provide(Layer.succeed(GitVcsDriver.GitVcsDriver, guardedDriver)),
          ),
        ),
      );
      yield* explorer.deleteBranch({
        ...scope,
        branchName: "refs/heads/rebased",
        expectedHash: original,
        expectedTargetRef: "refs/remotes/origin/main",
        expectedTargetHash: target,
        allowEquivalent: true,
      });
      assert.isTrue(blockedCheckout);
      assert.isFalse(yield* fs.exists(path.join(cwd, ".git", "HEAD.lock")));
      assert.isFalse(yield* fs.exists(path.join(cwd, ".git", "worktrees", "linked", "HEAD.lock")));
      assert.equal(yield* git(["symbolic-ref", "HEAD"]), "refs/heads/main");
    }),
  );

  it.effect("does not consider whitespace-changing Python patches equivalent or deletable", () =>
    Effect.gen(function* () {
      const { explorer, git, write } = yield* fixture;
      yield* write("example.py", "def f(x):\n    if x:\n        return 1\n    return 2\n");
      yield* git(["add", "."]);
      yield* git(["commit", "-m", "python base"]);
      yield* git(["switch", "-c", "python-feature"]);
      yield* write("example.py", "def f(x):\n    if x:\n        return 1\n    return 3\n");
      yield* git(["commit", "-am", "return three outside if"]);
      const branch = yield* git(["rev-parse", "HEAD"]);
      yield* git(["switch", "main"]);
      yield* write("example.py", "def f(x):\n    if x:\n        return 1\n        return 3\n");
      yield* git(["commit", "-am", "unreachable return inside if"]);
      const target = yield* git(["rev-parse", "HEAD"]);
      const overview = yield* explorer.overview(scope);
      assert.equal(
        (yield* explorer.branchStatuses({
          ...scope,
          snapshotId: overview.snapshotId,
          branches: ["refs/heads/python-feature"],
        })).branches[0]?.mergeStatus,
        "unmerged",
      );
      assert.equal(
        (yield* explorer
          .deleteBranch({
            ...scope,
            branchName: "refs/heads/python-feature",
            expectedHash: branch,
            expectedTargetRef: "refs/heads/main",
            expectedTargetHash: target,
            allowEquivalent: true,
          })
          .pipe(Effect.flip)).reason,
        "branch-not-merged",
      );
      assert.equal(yield* git(["rev-parse", "python-feature"]), branch);
    }),
  );

  it.effect(
    "does not cache transient read failures and rejects refs changed during deletion review",
    () =>
      Effect.gen(function* () {
        const { cwd, pending, original, target, projectStore } = yield* branchFixture;
        const driver = yield* GitVcsDriver.GitVcsDriver;
        let failAncestry = true;
        let moveBeforeMutation = false;
        const guardedDriver = GitVcsDriver.GitVcsDriver.of({
          ...driver,
          execute: (input) =>
            Effect.gen(function* () {
              if (input.args.includes("merge-base") && failAncestry) {
                failAncestry = false;
                return yield* driver.execute({
                  ...input,
                  args: ["rev-parse", "--verify", "missing-test-ref"],
                });
              }
              if (moveBeforeMutation && input.operation === "GitExplorer.deleteBranch") {
                moveBeforeMutation = false;
                yield* driver.execute({
                  operation: "GitExplorer.test.concurrent",
                  cwd,
                  args: ["update-ref", "refs/heads/rebased", pending],
                });
              }
              return yield* driver.execute(input);
            }),
        });
        const explorer = yield* GitExplorer.GitExplorer.pipe(
          Effect.provide(
            GitExplorer.layer.pipe(
              Layer.provide(projectStore),
              Layer.provide(Layer.succeed(GitVcsDriver.GitVcsDriver, guardedDriver)),
            ),
          ),
        );
        const overview = yield* explorer.overview(scope);
        const input = {
          ...scope,
          snapshotId: overview.snapshotId,
          branches: ["refs/heads/rebased"],
        };
        assert.equal((yield* explorer.branchStatuses(input)).branches[0]?.reason, "read-failed");
        assert.equal(
          (yield* explorer.branchStatuses(input)).branches[0]?.mergeStatus,
          "equivalent",
        );
        moveBeforeMutation = true;
        assert.equal(
          (yield* explorer
            .deleteBranch({
              ...scope,
              branchName: "refs/heads/rebased",
              expectedHash: original,
              expectedTargetRef: "refs/remotes/origin/main",
              expectedTargetHash: target,
              allowEquivalent: true,
            })
            .pipe(Effect.flip)).reason,
          "branch-changed",
        );
        assert.equal(
          (yield* driver.execute({
            operation: "GitExplorer.test.verify",
            cwd,
            args: ["rev-parse", "refs/heads/rebased"],
          })).stdout.trim(),
          pending,
        );
      }),
  );

  it.effect(
    "bounds patch comparisons and reports unrelated histories without permitting deletion",
    () =>
      Effect.gen(function* () {
        const { explorer, git, root, cwd, statuses } = yield* branchFixture;
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const commits = Array.from(
          { length: 4001 },
          (_, index) =>
            `commit refs/heads/long-branch\ncommitter Test <test@example.com> ${1700000000 + index} +0000\ndata 4\nlong\n${index === 0 ? `from ${root}\n` : ""}\n`,
        ).join("");
        yield* driver.execute({
          operation: "GitExplorer.test.long-history",
          cwd,
          args: ["fast-import", "--quiet"],
          stdin: commits,
        });
        const [long] = yield* statuses(["long-branch"]);
        assert.equal(long?.reason, "limit");
        assert.equal(long?.deleteBlockedReason, "unknown");
        yield* git(["checkout", "--orphan", "unrelated"]);
        yield* git(["commit", "-m", "unrelated root"]);
        yield* git(["switch", "main"]);
        assert.equal((yield* statuses(["unrelated"]))[0]?.reason, "unrelated");
        const overview = yield* explorer.overview(scope);
        assert.equal(
          (yield* explorer
            .branchStatuses({
              ...scope,
              snapshotId: overview.snapshotId,
              branches: ["refs/remotes/origin/main"],
            })
            .pipe(Effect.flip)).reason,
          "invalid-branch",
        );
        assert.equal(
          (yield* explorer
            .branchStatuses({
              ...scope,
              snapshotId: overview.snapshotId,
              branches: Array.from({ length: 33 }, () => "refs/heads/main"),
            })
            .pipe(Effect.flip)).reason,
          "too-large",
        );
      }),
  );

  it.effect("deletes a topic at the base tip while preserving the actual base branch", () =>
    Effect.gen(function* () {
      const { explorer, git, target } = yield* branchFixture;
      yield* git(["branch", "empty-topic", target]);
      const overview = yield* explorer.overview(scope);
      const result = yield* explorer.branchStatuses({
        ...scope,
        snapshotId: overview.snapshotId,
        branches: ["refs/heads/empty-topic"],
      });
      assert.equal(result.branches[0]?.mergeStatus, "merged");
      assert.equal(result.branches[0]?.deleteBlockedReason, null);
      yield* explorer.deleteBranch({
        ...scope,
        branchName: "refs/heads/empty-topic",
        expectedHash: target,
        expectedTargetRef: "refs/remotes/origin/main",
        expectedTargetHash: target,
        allowEquivalent: false,
      });
      assert.equal(yield* git(["rev-parse", "main"]), target);
      assert.notInclude(
        yield* git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
        "refs/heads/empty-topic",
      );
    }),
  );

  it.effect("deletes a merged local branch when the comparison branch is checked out", () =>
    Effect.gen(function* () {
      const { explorer, git, root } = yield* fixture;
      yield* git(["branch", "finished"]);
      const overview = yield* explorer.overview(scope);
      const { branches } = yield* explorer.branchStatuses({
        ...scope,
        snapshotId: overview.snapshotId,
        branches: ["refs/heads/finished"],
      });
      assert.equal(branches[0]?.targetRef, "refs/heads/main");
      assert.equal(branches[0]?.deleteBlockedReason, null);
      yield* explorer.deleteBranch({
        ...scope,
        branchName: "refs/heads/finished",
        expectedHash: root,
        expectedTargetRef: "refs/heads/main",
        expectedTargetHash: root,
        allowEquivalent: false,
      });
      assert.equal(yield* git(["branch", "--list", "finished"]), "");
      assert.equal(yield* git(["symbolic-ref", "HEAD"]), "refs/heads/main");
    }),
  );

  it.effect(
    "detects ancestry and rebased patches against origin's base, not a synced upstream",
    () =>
      Effect.gen(function* () {
        const { statuses, target, git, fs, path, cwd } = yield* branchFixture;
        const index = yield* fs.readFile(path.join(cwd, ".git", "index"));
        const refs = yield* git(["show-ref"]);
        const initialStatuses = yield* statuses(["done", "rebased", "pending", "main"]);
        const [done, rebased, pending, main] = initialStatuses;
        assert.equal(done?.mergeStatus, "merged");
        assert.equal(rebased?.mergeStatus, "equivalent");
        assert.equal(rebased?.targetRef, "refs/remotes/origin/main");
        assert.equal(rebased?.targetHash, target);
        assert.equal(pending?.mergeStatus, "unmerged");
        assert.equal(pending?.deleteBlockedReason, "unmerged");
        assert.equal(main?.deleteBlockedReason, "protected");
        assert.deepEqual(yield* statuses(["done", "rebased", "pending", "main"]), initialStatuses);
        assert.deepEqual(yield* fs.readFile(path.join(cwd, ".git", "index")), index);
        assert.equal(yield* git(["show-ref"]), refs);
      }),
  );

  it.effect(
    "invalidates configured bases and refuses equivalence with unique merge commits or shallow history",
    () =>
      Effect.gen(function* () {
        const { statuses, git, explorer, target, root, fs, path, cwd } = yield* branchFixture;
        const before = yield* explorer.overview(scope);
        yield* git(["config", "branch.pending.t3-merge-base-ref", "refs/remotes/origin/pending"]);
        const after = yield* explorer.overview(scope);
        assert.notEqual(before.snapshotId, after.snapshotId);
        const [configured] = yield* statuses(["pending"]);
        assert.equal(configured?.mergeStatus, "merged");
        assert.equal(configured?.deleteBlockedReason, "protected");
        yield* git(["switch", "-c", "with-merge", root]);
        yield* git(["merge", "--no-ff", "rebased", "-m", "merge feature"]);
        yield* git(["switch", "main"]);
        assert.equal((yield* statuses(["with-merge"]))[0]?.reason, "merge-commits");
        yield* fs.writeFileString(path.join(cwd, ".git", "shallow"), `${target}\n`);
        assert.equal((yield* statuses(["rebased"]))[0]?.reason, "shallow");
      }),
  );

  it.effect(
    "uses a local base only without remotes and reports ambiguous or missing remote bases",
    () =>
      Effect.gen(function* () {
        const { explorer, git, root } = yield* fixture;
        yield* git(["branch", "done"]);
        let overview = yield* explorer.overview(scope);
        const request = { ...scope, branches: ["refs/heads/done"] };
        const local = (yield* explorer.branchStatuses({
          ...request,
          snapshotId: overview.snapshotId,
        })).branches[0];
        assert.equal(local?.targetRef, "refs/heads/main");
        assert.equal(local?.mergeStatus, "merged");
        yield* git(["config", "remote.origin.url", "https://invalid.example/never-contact.git"]);
        overview = yield* explorer.overview(scope);
        const unknown = (yield* explorer.branchStatuses({
          ...request,
          snapshotId: overview.snapshotId,
        })).branches[0];
        assert.equal(unknown?.reason, "missing-base");
        yield* git(["update-ref", "refs/remotes/origin/main", root]);
        yield* git(["update-ref", "refs/remotes/origin/master", root]);
        overview = yield* explorer.overview(scope);
        assert.equal(
          (yield* explorer.branchStatuses({ ...request, snapshotId: overview.snapshotId }))
            .branches[0]?.reason,
          "missing-base",
        );
      }),
  );

  it.effect("deletes an ancestor against the reviewed base and invalidates cached refs", () =>
    Effect.gen(function* () {
      const { explorer, git, target, original, root, cwd, fs, path } = yield* branchFixture;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      yield* git(["branch", "integrated", target]);
      yield* git(["update-ref", "refs/remotes/origin/integrated", root]);
      yield* git(["branch", "--set-upstream-to=origin/integrated", "integrated"]);
      yield* git(["commit", "--allow-empty", "-m", "after integration"]);
      const base = yield* git(["rev-parse", "HEAD"]);
      yield* git(["update-ref", "refs/remotes/origin/main", base]);
      yield* git(["reset", "--hard", root]);
      const before = yield* explorer.overview(scope);
      yield* driver.listRefs({ cwd });
      const index = yield* fs.readFile(path.join(cwd, ".git", "index"));
      yield* explorer.deleteBranch({
        ...scope,
        branchName: "refs/heads/integrated",
        expectedHash: target,
        expectedTargetRef: "refs/remotes/origin/main",
        expectedTargetHash: base,
        allowEquivalent: false,
      });
      assert.notInclude(
        yield* git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
        "refs/heads/integrated",
      );
      assert.notInclude(
        (yield* driver.listRefs({ cwd })).refs.map((ref) => ref.name),
        "integrated",
      );
      assert.equal(yield* git(["rev-parse", "rebased"]), original);
      assert.equal(yield* git(["symbolic-ref", "HEAD"]), "refs/heads/main");
      assert.deepEqual(yield* fs.readFile(path.join(cwd, ".git", "index")), index);
      assert.notEqual((yield* explorer.overview(scope)).snapshotId, before.snapshotId);
      assert.equal(
        yield* git(["config", "remote.origin.url"]),
        "https://invalid.example/never-contact.git",
      );
    }),
  );

  it.effect(
    "requires explicit equivalent deletion and rejects stale branch, stale base, protected and unmerged requests",
    () =>
      Effect.gen(function* () {
        const { explorer, git, target, original, pending, root } = yield* branchFixture;
        const request = {
          ...scope,
          branchName: "refs/heads/rebased",
          expectedHash: original,
          expectedTargetRef: "refs/remotes/origin/main",
          expectedTargetHash: target,
          allowEquivalent: false,
        };
        assert.equal(
          (yield* explorer.deleteBranch(request).pipe(Effect.flip)).reason,
          "branch-not-merged",
        );
        assert.equal(
          (yield* explorer
            .deleteBranch({ ...request, expectedHash: root, allowEquivalent: true })
            .pipe(Effect.flip)).reason,
          "branch-changed",
        );
        assert.equal(
          (yield* explorer
            .deleteBranch({ ...request, expectedTargetHash: root, allowEquivalent: true })
            .pipe(Effect.flip)).reason,
          "branch-changed",
        );
        assert.equal(
          (yield* explorer
            .deleteBranch({ ...request, branchName: "refs/heads/main", expectedHash: target })
            .pipe(Effect.flip)).reason,
          "branch-protected",
        );
        assert.equal(
          (yield* explorer
            .deleteBranch({
              ...request,
              branchName: "refs/heads/pending",
              expectedHash: pending,
              allowEquivalent: true,
            })
            .pipe(Effect.flip)).reason,
          "branch-not-merged",
        );
        assert.equal(
          (yield* explorer
            .deleteBranch({ ...request, branchName: "refs/remotes/origin/main" })
            .pipe(Effect.flip)).reason,
          "invalid-branch",
        );
        assert.equal(
          (yield* explorer
            .deleteBranch({ ...request, branchName: "refs/heads/../main" })
            .pipe(Effect.flip)).reason,
          "invalid-branch",
        );
        yield* explorer.deleteBranch({ ...request, allowEquivalent: true });
        assert.notInclude(
          yield* git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
          "refs/heads/rebased",
        );
      }),
  );

  it.effect("refuses branches checked out in any worktree and validates repository scope", () =>
    Effect.gen(function* () {
      const { explorer, git, target, original, fs, path } = yield* branchFixture;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-branch-worktree-" });
      yield* git(["worktree", "add", path.join(directory, "linked"), "rebased"]);
      const request = {
        ...scope,
        branchName: "refs/heads/rebased",
        expectedHash: original,
        expectedTargetRef: "refs/remotes/origin/main",
        expectedTargetHash: target,
        allowEquivalent: true,
      };
      assert.equal(
        (yield* explorer.deleteBranch(request).pipe(Effect.flip)).reason,
        "branch-checked-out",
      );
      assert.equal(
        (yield* explorer.deleteBranch({ ...request, worktreePath: directory }).pipe(Effect.flip))
          .reason,
        "invalid-worktree",
      );
      assert.equal(yield* git(["rev-parse", "rebased"]), original);
    }),
  );
});
