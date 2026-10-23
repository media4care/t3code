import type { GitExplorerBranchStatus, GitExplorerRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  gitExplorerBranchRows,
  prepareGitExplorerBranchDeletion,
  prepareGitExplorerFolderDeletion,
} from "./gitExplorerBranches.logic";

const reference: GitExplorerRef = {
  name: "refs/heads/feature",
  shortName: "feature",
  kind: "local",
  hash: "a".repeat(40),
  upstream: null,
  ahead: null,
  behind: null,
  upstreamMissing: false,
};
const merged: GitExplorerBranchStatus = {
  name: reference.name,
  hash: reference.hash,
  mergeStatus: "merged",
  targetRef: "refs/remotes/origin/main",
  targetHash: "b".repeat(40),
  reason: null,
  deleteBlockedReason: null,
};

describe("Git Explorer branch folders", () => {
  const refs = ["main", "feature/z", "feature/api/a", "feature/api/b", "fix/login"].map(
    (shortName) => ({ ...reference, shortName, name: `refs/heads/${shortName}` }),
  );

  it("groups slash-separated branches into nested folders while retaining full ref identities", () => {
    const rows = gitExplorerBranchRows(refs, new Set());
    expect(rows.map((row) => [row.kind, row.label, row.depth])).toEqual([
      ["folder", "feature", 0],
      ["folder", "api", 1],
      ["branch", "a", 2],
      ["branch", "b", 2],
      ["branch", "z", 1],
      ["folder", "fix", 0],
      ["branch", "login", 1],
      ["branch", "main", 0],
    ]);
    expect(rows.filter((row) => row.kind === "branch").map((row) => row.reference.name)).toEqual([
      "refs/heads/feature/api/a",
      "refs/heads/feature/api/b",
      "refs/heads/feature/z",
      "refs/heads/fix/login",
      "refs/heads/main",
    ]);
  });

  it("collapses only the requested folder and restores its children when reopened", () => {
    const collapsed = new Set(["feature/api"]);
    expect(gitExplorerBranchRows(refs, collapsed).map((row) => row.label)).toEqual([
      "feature",
      "api",
      "z",
      "fix",
      "login",
      "main",
    ]);
    collapsed.add("feature");
    expect(gitExplorerBranchRows(refs, collapsed).map((row) => row.label)).toEqual([
      "feature",
      "fix",
      "login",
      "main",
    ]);
    collapsed.delete("feature");
    collapsed.delete("feature/api");
    expect(gitExplorerBranchRows(refs, collapsed)).toEqual(gitExplorerBranchRows(refs, new Set()));
  });

  it("groups remote branches beneath the remote without changing their ref names", () => {
    const remote = {
      ...reference,
      kind: "remote" as const,
      name: "refs/remotes/origin/feature/api",
      shortName: "origin/feature/api",
    };
    expect(gitExplorerBranchRows([remote], new Set(), "origin/")).toEqual([
      { kind: "folder", path: "feature", label: "feature", depth: 0 },
      { kind: "branch", reference: remote, label: "api", depth: 1 },
    ]);
  });
});

describe("Git Explorer branch deletion review", () => {
  it("pins the reviewed branch and comparison tips in the deletion request", () => {
    const review = prepareGitExplorerBranchDeletion(reference, merged);
    expect(review?.input).toEqual({
      branchName: reference.name,
      expectedHash: reference.hash,
      expectedTargetRef: merged.targetRef,
      expectedTargetHash: merged.targetHash,
      allowEquivalent: false,
    });
    expect(review?.confirmation).toContain("last known remote-tracking ref");
  });

  it("requires a distinct explanation before permitting patch-equivalent deletion", () => {
    const review = prepareGitExplorerBranchDeletion(reference, {
      ...merged,
      mergeStatus: "equivalent",
    });
    expect(review?.input.allowEquivalent).toBe(true);
    expect(review?.confirmation).toContain("original commits are not ancestors");
    expect(review?.confirmation).toContain("using patch equivalence");
  });

  it("does not offer deletion using a result for a moved or different branch", () => {
    expect(
      prepareGitExplorerBranchDeletion({ ...reference, hash: "c".repeat(40) }, merged),
    ).toBeNull();
    expect(
      prepareGitExplorerBranchDeletion(reference, { ...merged, name: "refs/heads/other" }),
    ).toBeNull();
  });

  it.each(["checked-out", "protected", "unmerged", "unknown"] as const)(
    "respects the server's %s deletion block even if merged",
    (deleteBlockedReason) => {
      expect(
        prepareGitExplorerBranchDeletion(reference, { ...merged, deleteBlockedReason }),
      ).toBeNull();
    },
  );

  it("keeps unknown, missing-base, and remote references out of the cleanup action", () => {
    expect(prepareGitExplorerBranchDeletion(reference, undefined)).toBeNull();
    expect(
      prepareGitExplorerBranchDeletion(reference, { ...merged, mergeStatus: "unknown" }),
    ).toBeNull();
    expect(prepareGitExplorerBranchDeletion(reference, { ...merged, targetHash: null })).toBeNull();
    expect(prepareGitExplorerBranchDeletion({ ...reference, kind: "remote" }, merged)).toBeNull();
  });
});

describe("folder deletion review", () => {
  it("includes nested local branches, excludes prefix siblings and keeps blocked or stale branches", () => {
    const refs = [
      "feature/a",
      "feature/nested/b",
      "feature/active",
      "feature/stale",
      "features/other",
    ].map((shortName) => ({ ...reference, shortName, name: `refs/heads/${shortName}` }));
    const statuses = refs.map((ref) => ({
      ...merged,
      name: ref.name,
      deleteBlockedReason: ref.shortName === "feature/active" ? ("checked-out" as const) : null,
      hash: ref.shortName === "feature/stale" ? "c".repeat(40) : ref.hash,
    }));
    const review = prepareGitExplorerFolderDeletion(
      "feature",
      [...refs, { ...refs[0]!, kind: "remote" }],
      statuses,
    );
    expect(review.eligible.map(({ reference }) => reference.shortName)).toEqual([
      "feature/a",
      "feature/nested/b",
    ]);
    expect(review.skipped.map(({ reference }) => reference.shortName)).toEqual([
      "feature/active",
      "feature/stale",
    ]);
    expect(review.eligible[0]?.deletion.input.expectedHash).toBe(reference.hash);
  });
});
