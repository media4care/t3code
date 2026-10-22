import type { GitExplorerCommit, GitExplorerRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mergeGitExplorerHistoryPage,
  selectGitExplorerReferences,
} from "./gitExplorerHistory.logic";

const commit = (hash: string): GitExplorerCommit => ({
  hash,
  parents: [],
  subject: hash,
  authorName: "Author",
  authorEmail: "author@example.com",
  authoredAt: "2026-10-22T00:00:00Z",
  committedAt: "2026-10-22T00:00:00Z",
  upstreamStatus: "shared",
});

const reference = (shortName: string, kind: GitExplorerRef["kind"]): GitExplorerRef => ({
  name: `${kind}:${shortName}`,
  shortName,
  kind,
  hash: "a".repeat(40),
  upstream: null,
  ahead: null,
  behind: null,
  upstreamMissing: false,
});

describe("Git Explorer visible references", () => {
  it("keeps the checked-out branch and a tag visible when other branches share the commit", () => {
    const other = reference("feature", "local");
    const head = reference("main", "local");
    const remote = reference("origin/main", "remote");
    const tag = reference("v1.0", "tag");
    const refs = [other, head, remote, tag];
    expect(selectGitExplorerReferences(refs, "main", 2)).toEqual({
      visible: [head, tag],
      hidden: [other, remote],
    });
    expect(refs).toEqual([other, head, remote, tag]);
  });

  it("keeps the checked-out branch in the phone chip and the tag in overflow", () => {
    const other = reference("feature", "local");
    const head = reference("main", "local");
    const tag = reference("v1.0", "tag");
    expect(selectGitExplorerReferences([other, head, tag], "main", 1)).toEqual({
      visible: [head],
      hidden: [other, tag],
    });
  });

  it("shows a branch and tag away from HEAD, and preserves tag-only references", () => {
    const branch = reference("release", "local");
    const remote = reference("origin/release", "remote");
    const tag = reference("v1.0", "tag");
    expect(selectGitExplorerReferences([branch, remote, tag], "main", 2)).toEqual({
      visible: [branch, tag],
      hidden: [remote],
    });
    expect(selectGitExplorerReferences([tag], "main", 2)).toEqual({
      visible: [tag],
      hidden: [],
    });
  });
});

describe("Git Explorer history pages", () => {
  it("keeps topological order and stable commit objects when a page is retried", () => {
    const first = commit("a");
    const second = commit("b");
    const current = [first, second];
    const next = mergeGitExplorerHistoryPage(current, [commit("b"), commit("c"), commit("c")], 2);
    expect(next.map((entry) => entry.hash)).toEqual(["a", "b", "c"]);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(second);
    expect(current).toEqual([first, second]);
  });

  it("replaces old history when refreshing the first page", () => {
    const next = mergeGitExplorerHistoryPage([commit("old")], [commit("new")], 0);
    expect(next.map((entry) => entry.hash)).toEqual(["new"]);
  });
});
