import type { GitExplorerBranchStatus, GitExplorerRef } from "@t3tools/contracts";

export type GitExplorerBranchRow =
  | { kind: "folder"; path: string; label: string; depth: number }
  | { kind: "branch"; reference: GitExplorerRef; label: string; depth: number };

export function gitExplorerBranchRows(
  references: readonly GitExplorerRef[],
  collapsed: ReadonlySet<string>,
  prefix = "",
) {
  type Folder = { folders: Map<string, Folder>; branches: GitExplorerRef[] };
  const root: Folder = { folders: new Map(), branches: [] };
  for (const reference of references) {
    const segments = reference.shortName.slice(prefix.length).split("/");
    let folder = root;
    for (const name of segments.slice(0, -1)) {
      let child = folder.folders.get(name);
      if (!child) {
        child = { folders: new Map(), branches: [] };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    folder.branches.push(reference);
  }
  const rows: GitExplorerBranchRow[] = [];
  const visit = (folder: Folder, parent: string, depth: number) => {
    for (const [label, child] of [...folder.folders].sort(([a], [b]) => a.localeCompare(b))) {
      const path = parent ? `${parent}/${label}` : label;
      rows.push({ kind: "folder", path, label, depth });
      if (!collapsed.has(path)) visit(child, path, depth + 1);
    }
    for (const reference of folder.branches.toSorted((a, b) =>
      a.shortName.localeCompare(b.shortName),
    )) {
      rows.push({
        kind: "branch",
        reference,
        label: reference.shortName.slice(reference.shortName.lastIndexOf("/") + 1),
        depth,
      });
    }
  };
  visit(root, "", 0);
  return rows;
}

function targetName(reference: string) {
  return reference.replace(/^refs\/(heads|remotes)\//, "");
}

const UNKNOWN_REASONS = {
  "missing-base": "No comparison branch is available.",
  shallow: "Shallow history prevents a complete comparison.",
  "merge-commits": "Merge commits prevent a reliable patch-equivalence comparison.",
  limit: "This comparison exceeds the analysis limit.",
  unrelated: "The branches have no common history.",
  "read-failed": "Git could not complete the comparison.",
} as const;

export function describeGitExplorerMerge(status: GitExplorerBranchStatus | undefined) {
  if (!status) return "Merge status not loaded.";
  const target = status.targetRef ? targetName(status.targetRef) : "the comparison branch";
  const comparison =
    status.mergeStatus === "merged"
      ? `Merged into ${target}.`
      : status.mergeStatus === "equivalent"
        ? `Equivalent changes in ${target} (rebased or cherry-picked). The original commits are not ancestors of the comparison branch.`
        : status.mergeStatus === "unmerged"
          ? `Not merged into ${target}. No complete ancestry or patch-equivalence match was found; squashed or edited merges may not be recognized.`
          : `Merge status unknown${status.targetRef ? ` against ${target}` : ""}. ${status.reason ? UNKNOWN_REASONS[status.reason] : "The comparison could not be completed."}`;
  return `${comparison}${status.targetRef?.startsWith("refs/remotes/") ? " Uses the local remote-tracking ref; the remote server has not been checked." : ""}`;
}

export function gitExplorerBranchDeletionBlock(
  reference: GitExplorerRef,
  status: GitExplorerBranchStatus | undefined,
) {
  if (reference.kind !== "local") return "Only local branches can be deleted here.";
  if (!status) return "Load the merge status before deleting this branch.";
  if (status.name !== reference.name || status.hash !== reference.hash)
    return "This branch has changed. Refresh Git Explorer before deleting it.";
  switch (status.deleteBlockedReason) {
    case "checked-out":
      return "This branch is checked out in a worktree.";
    case "protected":
      return "The repository's base branch cannot be deleted here.";
    case "unmerged":
      return "No complete merge or patch-equivalence match was found.";
    case "unknown":
      return "The merge status must be verified before deletion.";
  }
  if (status.mergeStatus !== "merged" && status.mergeStatus !== "equivalent")
    return "Only merged or patch-equivalent branches can be deleted here.";
  if (!status.targetRef || !status.targetHash)
    return "A comparison branch is required before deletion.";
  return null;
}

export function prepareGitExplorerBranchDeletion(
  reference: GitExplorerRef,
  status: GitExplorerBranchStatus | undefined,
) {
  if (
    gitExplorerBranchDeletionBlock(reference, status) !== null ||
    !status?.targetRef ||
    !status.targetHash
  )
    return null;
  const equivalent = status.mergeStatus === "equivalent";
  const target = targetName(status.targetRef);
  return {
    input: {
      branchName: reference.name,
      expectedHash: reference.hash,
      expectedTargetRef: status.targetRef,
      expectedTargetHash: status.targetHash,
      allowEquivalent: equivalent,
    },
    confirmation: [
      `Delete local branch "${reference.shortName}"?`,
      equivalent
        ? `Its changes have equivalent patches in ${target}, but the original commits are not ancestors of that branch. Confirming deletes the local branch using patch equivalence.`
        : `Its commits are already merged into ${target}.`,
      "Only this local branch is removed. Remote branches and worktree files are unchanged.",
      ...(status.targetRef.startsWith("refs/remotes/")
        ? [
            "This comparison uses the last known remote-tracking ref. The remote server has not been checked.",
          ]
        : []),
    ].join("\n\n"),
  };
}
