import { describe, expect, it } from "vite-plus/test";
import { GitExplorerBranchStatus, type GitExplorerRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  formatGitExplorerSync,
  layoutGitGraph,
  gitExplorerEmphasizedRefs,
  gitExplorerUpstreamMergeSummary,
  prepareGitExplorerBranchDeletion,
  prepareGitExplorerBranchesDeletion,
} from "./gitExplorer.ts";

const decodeBranchStatus = Schema.decodeUnknownSync(GitExplorerBranchStatus);

describe("selected branch deletion", () => {
  it("reviews only the chosen branches and preserves protection, stale-tip and force rules", () => {
    const refs: GitExplorerRef[] = [
      "feature/one",
      "fix/two",
      "pending",
      "main",
      "active",
      "stale",
      "not-selected",
    ].map((shortName) => ({
      name: `refs/heads/${shortName}`,
      shortName,
      kind: "local",
      hash: "a".repeat(40),
      upstream: null,
      ahead: null,
      behind: null,
      upstreamMissing: false,
    }));
    const statuses = refs.map((ref) =>
      decodeBranchStatus({
        name: ref.name,
        hash: ref.shortName === "stale" ? "c".repeat(40) : ref.hash,
        targetRef: "refs/remotes/origin/main",
        targetHash: "b".repeat(40),
        mergeStatus: ref.shortName === "pending" ? "unmerged" : "merged",
        reason: null,
        deleteBlockedReason:
          ref.shortName === "main"
            ? "protected"
            : ref.shortName === "active"
              ? "checked-out"
              : ref.shortName === "pending"
                ? "unmerged"
                : null,
      }),
    );
    const selected = [...refs.slice(0, -1), refs[0]!];
    const safe = prepareGitExplorerBranchesDeletion(selected, statuses);
    expect(safe.eligible.map(({ reference }) => reference.shortName)).toEqual([
      "feature/one",
      "fix/two",
    ]);
    expect(safe.skipped.map(({ reference }) => reference.shortName)).toEqual([
      "pending",
      "main",
      "active",
      "stale",
    ]);
    const forced = prepareGitExplorerBranchesDeletion(selected, statuses, true);
    expect(forced.eligible.map(({ reference }) => reference.shortName)).toEqual([
      "feature/one",
      "fix/two",
      "pending",
    ]);
    expect(forced.eligible.map(({ deletion }) => deletion.input.force ?? false)).toEqual([
      false,
      false,
      true,
    ]);
    expect(forced.eligible[0]?.deletion.input.expectedHash).toBe(refs[0]?.hash);
    expect(prepareGitExplorerBranchesDeletion([refs[0]!], []).eligible).toEqual([]);
  });
});

describe("Git Explorer graph", () => {
  it("emphasizes first-parent history without thickening a merged feature or reused lane", () => {
    const { rows } = layoutGitGraph(
      [
        { hash: "main", parents: ["base", "feature"] },
        { hash: "feature", parents: ["base"] },
        { hash: "base", parents: [] },
        { hash: "other", parents: [] },
      ],
      [],
      new Set(["main"]),
    );
    expect(rows.filter((row) => row.emphasized).map((row) => row.hash)).toEqual(["main", "base"]);
    expect(rows[0]?.lines.filter((line) => line.emphasized)).toHaveLength(1);
    expect(rows[1]?.lines.find((line) => line.kind === "through")?.emphasized).toBe(true);
    expect(rows[1]?.lines.find((line) => line.kind === "parent")?.emphasized).toBeUndefined();
  });

  it("selects main and the highest numeric release branch including remote counterparts, excluding tags", () => {
    const refs = [
      { name: "refs/heads/main", shortName: "main", kind: "local" },
      { name: "refs/heads/v2.9", shortName: "v2.9", kind: "local" },
      { name: "refs/heads/v2.10", shortName: "v2.10", kind: "local" },
      { name: "refs/remotes/origin/v2.10", shortName: "origin/v2.10", kind: "remote" },
      { name: "refs/tags/v99", shortName: "v99", kind: "tag" },
    ] as const;
    expect([...gitExplorerEmphasizedRefs(refs)]).toEqual([
      "refs/heads/main",
      "refs/heads/v2.10",
      "refs/remotes/origin/v2.10",
    ]);
  });

  it("connects a linear history and stops at the root", () => {
    const { rows, lanes } = layoutGitGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows.map((row) => row.column)).toEqual([0, 0, 0]);
    expect(rows[0]?.lines).toEqual([{ from: 0, to: 0, color: 0, kind: "parent" }]);
    expect(rows[1]?.lines.map((line) => line.kind)).toEqual(["incoming", "parent"]);
    expect(rows[2]?.lines).toEqual([{ from: 0, to: 0, color: 0, kind: "incoming" }]);
    expect(lanes).toEqual([]);
  });

  it("draws both merge parents and rejoins their common ancestor", () => {
    const { rows, lanes } = layoutGitGraph([
      { hash: "merge", parents: ["main", "feature"] },
      { hash: "feature", parents: ["base"] },
      { hash: "main", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    expect(rows[0]?.lines).toEqual([
      { from: 0, to: 0, color: 0, kind: "parent" },
      { from: 0, to: 1, color: 1, kind: "parent" },
    ]);
    expect(rows[1]?.lines).toContainEqual({ from: 0, to: 0, color: 0, kind: "through" });
    expect(rows[2]?.lines).toContainEqual({ from: 0, to: 1, color: 1, kind: "parent" });
    expect(rows[3]?.column).toBe(1);
    expect(lanes).toEqual([]);
  });

  it("keeps all octopus merge parents until their rows arrive", () => {
    const graph = layoutGitGraph([{ hash: "m", parents: ["a", "b", "c"] }]);
    expect(graph.lanes).toEqual(["a", "b", "c"]);
    expect(graph.rows[0]?.laneCount).toBe(3);
    expect(graph.rows[0]?.lines.filter((line) => line.kind === "parent")).toHaveLength(3);
  });

  it("reuses a free lane without shifting a surviving branch", () => {
    const graph = layoutGitGraph([
      { hash: "a", parents: ["root"] },
      { hash: "b", parents: ["other-root"] },
      { hash: "root", parents: [] },
      { hash: "c", parents: ["other-root"] },
      { hash: "other-root", parents: [] },
    ]);
    expect(graph.rows.map((row) => row.column)).toEqual([0, 1, 0, 0, 1]);
    expect(graph.rows[3]?.lines).toContainEqual({ from: 0, to: 1, color: 1, kind: "parent" });
    expect(graph.lanes).toEqual([]);
  });

  it("preserves geometry across page boundaries and leaves shallow parents open", () => {
    const commits = [
      { hash: "m", parents: ["a", "b"] },
      { hash: "a", parents: ["base"] },
      { hash: "b", parents: ["base"] },
      { hash: "base", parents: ["shallow-boundary"] },
    ];
    const first = layoutGitGraph(commits.slice(0, 2));
    const second = layoutGitGraph(commits.slice(2), first.lanes);
    const combined = layoutGitGraph(commits);
    expect([...first.rows, ...second.rows]).toEqual(combined.rows);
    expect(second.lanes).toEqual(combined.lanes);
    expect(second.lanes.filter(Boolean)).toEqual(["shallow-boundary"]);
    expect(first.lanes).toEqual(["base", "b"]);
  });

  it("keeps a long linear history in a single lane", () => {
    const commits = Array.from({ length: 10_000 }, (_, index) => ({
      hash: String(index),
      parents: index === 9_999 ? [] : [String(index + 1)],
    }));
    const { rows, lanes } = layoutGitGraph(commits);
    expect(rows).toHaveLength(10_000);
    expect(rows.every((row) => row.laneCount === 1 && row.lines.length <= 2)).toBe(true);
    expect(lanes).toEqual([]);
  });
});

describe("Git Explorer upstream status", () => {
  it("shows a merged upstream without claiming the local branch is merged or safe to delete", () => {
    const ref: GitExplorerRef = {
      name: "refs/heads/topic",
      shortName: "topic",
      kind: "local",
      hash: "a".repeat(40),
      upstream: "refs/remotes/origin/topic",
      upstreamMissing: false,
      ahead: 2,
      behind: 4,
    };
    const status = decodeBranchStatus({
      name: ref.name,
      hash: ref.hash,
      mergeStatus: "unmerged",
      reason: null,
      targetRef: "refs/remotes/origin/main",
      targetHash: "b".repeat(40),
      deleteBlockedReason: "unmerged",
      upstream: { name: ref.upstream, hash: "c".repeat(40), mergeStatus: "merged", reason: null },
    });
    const summary = gitExplorerUpstreamMergeSummary(ref, status);
    expect(summary.label).toBe("Upstream merged");
    expect(summary.description).toContain("origin/topic: Merged into origin/main");
    expect(summary.description).toContain("local remote-tracking ref");
    expect(prepareGitExplorerBranchDeletion(ref, status)).toBeNull();
    expect(prepareGitExplorerBranchDeletion(ref, status, true)?.confirmation).toContain(
      summary.description,
    );

    expect(gitExplorerUpstreamMergeSummary({ ...ref, upstreamMissing: true }, status).label).toBe(
      "Missing upstream",
    );
    expect(gitExplorerUpstreamMergeSummary({ ...ref, upstream: null }, status).label).toBe(
      "No upstream",
    );
    expect(
      gitExplorerUpstreamMergeSummary({ ...ref, upstream: "refs/remotes/origin/other" }, status)
        .label,
    ).toBe("Upstream unknown");
    expect(gitExplorerUpstreamMergeSummary({ ...ref, hash: "d".repeat(40) }, status).label).toBe(
      "Upstream unknown",
    );
    const { upstream: _upstream, ...legacyStatus } = status;
    expect(gitExplorerUpstreamMergeSummary(ref, legacyStatus).label).toBe("Upstream unknown");
  });

  const tracked = { upstream: "refs/remotes/origin/main", upstreamMissing: false };

  it("distinguishes synchronization, either direction, and divergence", () => {
    expect(formatGitExplorerSync({ ...tracked, ahead: 0, behind: 0 })).toBe("Synchronized");
    expect(formatGitExplorerSync({ ...tracked, ahead: 2, behind: 0 })).toBe("2 ahead");
    expect(formatGitExplorerSync({ ...tracked, ahead: 0, behind: 3 })).toBe("3 behind");
    expect(formatGitExplorerSync({ ...tracked, ahead: 1, behind: 3 })).toBe(
      "1 ahead, 3 behind (diverged)",
    );
  });

  it("never calls unavailable or unconfigured upstreams synchronized", () => {
    expect(formatGitExplorerSync({ ...tracked, ahead: null, behind: null })).toBe(
      "Upstream status unavailable",
    );
    expect(formatGitExplorerSync({ ...tracked, upstream: null, ahead: 0, behind: 0 })).toBe(
      "No upstream",
    );
    expect(
      formatGitExplorerSync({ ...tracked, upstreamMissing: true, ahead: null, behind: null }),
    ).toBe("Upstream missing");
  });
});
