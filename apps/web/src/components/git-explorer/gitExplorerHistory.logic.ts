import type { GitExplorerCommit, GitExplorerRef } from "@t3tools/contracts";

export function mergeGitExplorerHistoryPage(
  current: readonly GitExplorerCommit[],
  page: readonly GitExplorerCommit[],
  cursor: number,
): readonly GitExplorerCommit[] {
  const commits = cursor === 0 ? [] : [...current];
  const seen = new Set(commits.map((commit) => commit.hash));
  for (const commit of page) {
    if (seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    commits.push(commit);
  }
  return commits;
}

export function selectGitExplorerReferences(
  references: readonly GitExplorerRef[],
  headBranch: string | null,
  limit: 1 | 2,
) {
  const branch =
    references.find(
      (reference) => reference.kind === "local" && reference.shortName === headBranch,
    ) ??
    references.find((reference) => reference.kind === "local") ??
    references.find((reference) => reference.kind === "remote");
  const tag = references.find((reference) => reference.kind === "tag");
  const preferred = [...(branch ? [branch] : []), ...(limit > 1 && tag ? [tag] : [])];
  const visible = [
    ...preferred,
    ...references.filter((reference) => !preferred.includes(reference)),
  ].slice(0, limit);
  return { visible, hidden: references.filter((reference) => !visible.includes(reference)) };
}
