import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, ProjectId } from "./baseSchemas.ts";

const GitExplorerScope = {
  projectId: ProjectId,
  worktreePath: Schema.optional(Schema.String),
};
const GitExplorerHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/));
export const GitExplorerOverviewInput = Schema.Struct(GitExplorerScope);
export type GitExplorerOverviewInput = typeof GitExplorerOverviewInput.Type;
export const GitExplorerRef = Schema.Struct({
  name: Schema.String,
  shortName: Schema.String,
  kind: Schema.Literals(["local", "remote", "tag"]),
  hash: GitExplorerHash,
  upstream: Schema.NullOr(Schema.String),
  ahead: Schema.NullOr(NonNegativeInt),
  behind: Schema.NullOr(NonNegativeInt),
  upstreamMissing: Schema.Boolean,
});
export type GitExplorerRef = typeof GitExplorerRef.Type;
export const GitExplorerWorktree = Schema.Struct({
  path: Schema.String,
  headHash: Schema.NullOr(GitExplorerHash),
  branch: Schema.NullOr(Schema.String),
  bare: Schema.Boolean,
  locked: Schema.Boolean,
});
export type GitExplorerWorktree = typeof GitExplorerWorktree.Type;
export const GitExplorerStash = Schema.Struct({
  name: Schema.String,
  hash: GitExplorerHash,
  subject: Schema.String,
  createdAt: Schema.String,
});
export type GitExplorerStash = typeof GitExplorerStash.Type;
export const GitExplorerOverviewResult = Schema.Struct({
  repositoryPath: Schema.String,
  selectedWorktreePath: Schema.String,
  headHash: Schema.NullOr(GitExplorerHash),
  headBranch: Schema.NullOr(Schema.String),
  worktrees: Schema.Array(GitExplorerWorktree),
  refs: Schema.Array(GitExplorerRef),
  stashes: Schema.Array(GitExplorerStash),
  lastFetchAt: Schema.NullOr(Schema.String),
  snapshotId: Schema.String,
});
export type GitExplorerOverviewResult = typeof GitExplorerOverviewResult.Type;
const GitExplorerMergeAssessment = {
  mergeStatus: Schema.Literals(["merged", "equivalent", "unmerged", "unknown"]),
  reason: Schema.NullOr(
    Schema.Literals([
      "missing-base",
      "shallow",
      "merge-commits",
      "limit",
      "unrelated",
      "read-failed",
    ]),
  ),
};
export const GitExplorerBranchStatus = Schema.Struct({
  name: Schema.String,
  hash: GitExplorerHash,
  ...GitExplorerMergeAssessment,
  targetRef: Schema.NullOr(Schema.String),
  targetHash: Schema.NullOr(GitExplorerHash),
  upstream: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      hash: GitExplorerHash,
      ...GitExplorerMergeAssessment,
    }),
  ),
  deleteBlockedReason: Schema.NullOr(
    Schema.Literals(["checked-out", "protected", "unmerged", "unknown"]),
  ),
});
export type GitExplorerBranchStatus = typeof GitExplorerBranchStatus.Type;
const GitExplorerLocalBranch = Schema.String.check(
  Schema.isPattern(/^refs\/heads\/.+/),
  Schema.isMaxLength(1024),
);
export const GitExplorerBranchStatusesInput = Schema.Struct({
  ...GitExplorerScope,
  snapshotId: Schema.String,
  branches: Schema.Array(GitExplorerLocalBranch).check(Schema.isMaxLength(32)),
});
export type GitExplorerBranchStatusesInput = typeof GitExplorerBranchStatusesInput.Type;
export const GitExplorerBranchStatusesResult = Schema.Struct({
  branches: Schema.Array(GitExplorerBranchStatus),
});
export type GitExplorerBranchStatusesResult = typeof GitExplorerBranchStatusesResult.Type;
export const GitExplorerDeleteBranchInput = Schema.Struct({
  ...GitExplorerScope,
  branchName: GitExplorerLocalBranch,
  expectedHash: GitExplorerHash,
  expectedTargetRef: Schema.NullOr(Schema.String),
  expectedTargetHash: Schema.NullOr(GitExplorerHash),
  allowEquivalent: Schema.Boolean,
  force: Schema.optional(Schema.Boolean),
});
export type GitExplorerDeleteBranchInput = typeof GitExplorerDeleteBranchInput.Type;
export const GitExplorerRunActionInput = Schema.Struct({
  ...GitExplorerScope,
  expectedHead: Schema.NullOr(GitExplorerHash),
  expectedBranch: Schema.NullOr(Schema.String),
  action: Schema.Literals([
    "push",
    "pull",
    "fetch",
    "stash",
    "apply-stash",
    "pop-stash",
    "drop-stash",
    "switch",
    "rename",
    "stage",
    "unstage",
    "discard",
    "commit",
  ]),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(10000))),
  stashHash: Schema.optional(GitExplorerHash),
  restoreIndex: Schema.optional(Schema.Boolean),
  branchName: Schema.optional(GitExplorerLocalBranch),
  branchHash: Schema.optional(GitExplorerHash),
  newName: Schema.optional(Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1024))),
  filePaths: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(2000),
    ),
  ),
  fileStage: Schema.optional(Schema.Literals(["unstaged", "untracked"])),
  changeToken: Schema.optional(Schema.String),
  indexVersion: Schema.optional(Schema.String),
  amend: Schema.optional(Schema.Boolean),
});
export type GitExplorerRunActionInput = typeof GitExplorerRunActionInput.Type;
export const GitExplorerRunActionResult = Schema.Struct({ message: Schema.String });
export type GitExplorerRunActionResult = typeof GitExplorerRunActionResult.Type;
export const GitExplorerHistoryInput = Schema.Struct({
  ...GitExplorerScope,
  snapshotId: Schema.String,
  cursor: Schema.optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000))),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
  historyScope: Schema.optional(Schema.Literals(["all", "current"])),
  searchField: Schema.optional(Schema.Literals(["message", "author", "hash", "path"])),
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});
export type GitExplorerHistoryInput = typeof GitExplorerHistoryInput.Type;
export const GitExplorerCommit = Schema.Struct({
  hash: GitExplorerHash,
  parents: Schema.Array(GitExplorerHash),
  subject: Schema.String,
  authorName: Schema.String,
  authorEmail: Schema.String,
  authoredAt: Schema.String,
  committedAt: Schema.String,
  upstreamStatus: Schema.Literals(["local-only", "upstream-only", "shared", "other", "unknown"]),
});
export type GitExplorerCommit = typeof GitExplorerCommit.Type;
export const GitExplorerHistoryResult = Schema.Struct({
  commits: Schema.Array(GitExplorerCommit),
  nextCursor: Schema.NullOr(NonNegativeInt),
});
export type GitExplorerHistoryResult = typeof GitExplorerHistoryResult.Type;
export const GitExplorerDetailsInput = Schema.Struct({
  ...GitExplorerScope,
  revision: Schema.NullOr(GitExplorerHash),
});
export type GitExplorerDetailsInput = typeof GitExplorerDetailsInput.Type;
export const GitExplorerFileStage = Schema.Literals([
  "committed",
  "staged",
  "unstaged",
  "untracked",
  "stash-untracked",
]);
export type GitExplorerFileStage = typeof GitExplorerFileStage.Type;
export const GitExplorerFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.NullOr(Schema.String),
  status: Schema.Literals([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "unmerged",
    "untracked",
  ]),
  stage: GitExplorerFileStage,
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  binary: Schema.Boolean,
});
export type GitExplorerFile = typeof GitExplorerFile.Type;
export const GitExplorerDetailsResult = Schema.Struct({
  indexVersion: Schema.optional(Schema.String),
  stash: Schema.NullOr(GitExplorerStash),
  commit: Schema.NullOr(Schema.Struct({ ...GitExplorerCommit.fields, body: Schema.String })),
  comparisonParent: Schema.NullOr(GitExplorerHash),
  files: Schema.Array(GitExplorerFile),
  truncated: Schema.Boolean,
});
export type GitExplorerDetailsResult = typeof GitExplorerDetailsResult.Type;
export const GitExplorerPatchInput = Schema.Struct({
  ...GitExplorerDetailsInput.fields,
  path: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096)),
  stage: GitExplorerFileStage,
});
export type GitExplorerPatchInput = typeof GitExplorerPatchInput.Type;
export const GitExplorerPatchResult = Schema.Struct({
  changeToken: Schema.optional(Schema.String),
  patch: Schema.String,
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type GitExplorerPatchResult = typeof GitExplorerPatchResult.Type;
export class GitExplorerError extends Schema.TaggedError<GitExplorerError>()("GitExplorerError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "project-not-found",
    "invalid-worktree",
    "invalid-revision",
    "invalid-path",
    "snapshot-expired",
    "read-failed",
    "too-large",
    "invalid-branch",
    "branch-changed",
    "branch-checked-out",
    "branch-protected",
    "branch-not-merged",
    "write-failed",
    "worktree-changed",
    "stash-unavailable",
    "stash-apply-failed",
    "stash-drop-failed",
    "stash-pop-drop-failed",
    "branch-in-use",
    "invalid-branch-name",
    "changes-changed",
    "commit-message-required",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "project-not-found":
        return "The selected project is unavailable.";
      case "invalid-worktree":
        return "The selected worktree does not belong to this repository.";
      case "invalid-revision":
        return "The selected commit is unavailable in this repository.";
      case "invalid-path":
        return "The selected file is unavailable in this comparison.";
      case "snapshot-expired":
        return "History has expired. Refresh Git Explorer to continue.";
      case "too-large":
        return "This repository view is too large to load.";
      case "read-failed":
        return "Git Explorer could not read this repository.";
      case "invalid-branch":
        return "The selected local branch is unavailable.";
      case "branch-changed":
        return "The branch or its comparison base changed. Refresh and review it again.";
      case "branch-checked-out":
        return "This branch is checked out in a worktree and cannot be deleted.";
      case "branch-protected":
        return "The repository's base branch cannot be deleted from Git Explorer.";
      case "branch-not-merged":
        return "This branch has changes that are not confirmed merged into its base.";
      case "worktree-changed":
        return "The worktree branch or HEAD changed. Refresh Git Explorer and try again.";
      case "stash-unavailable":
        return "This stash is no longer available. Refresh Git Explorer and try again.";
      case "stash-apply-failed":
        return "Git could not fully apply this stash. The saved stash was kept. Check the working tree for conflicts or existing changes before trying again.";
      case "stash-drop-failed":
        return "Git could not delete this stash. Refresh Git Explorer and try again.";
      case "stash-pop-drop-failed":
        return "The stash was applied, but Git could not delete the saved entry. Refresh and delete it separately; do not apply it again.";
      case "branch-in-use":
        return "This branch is checked out in another worktree.";
      case "invalid-branch-name":
        return "Enter a valid Git branch name.";
      case "changes-changed":
        return "The changes have changed since you reviewed them. Refresh and review them again.";
      case "commit-message-required":
        return "Enter a commit message.";
      case "write-failed":
        return "Git Explorer could not delete this branch.";
    }
  }
}
