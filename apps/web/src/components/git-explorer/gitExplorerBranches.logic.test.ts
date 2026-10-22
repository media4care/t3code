import type { GitExplorerBranchStatus, GitExplorerRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { prepareGitExplorerBranchDeletion } from "./gitExplorerBranches.logic";

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
