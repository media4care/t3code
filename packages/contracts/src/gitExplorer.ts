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
export const GitExplorerHistoryInput = Schema.Struct({
  ...GitExplorerScope,
  snapshotId: Schema.String,
  cursor: Schema.optional(NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000))),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
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
    }
  }
}
