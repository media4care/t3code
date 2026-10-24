import {
  gitExplorerBranchDeletionBlock,
  prepareGitExplorerBranchDeletion,
} from "@t3tools/client-runtime/git-explorer";
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

export function prepareGitExplorerFolderDeletion(
  folder: string,
  references: readonly GitExplorerRef[],
  statuses: readonly GitExplorerBranchStatus[],
  force = false,
) {
  const byName = new Map(statuses.map((status) => [status.name, status]));
  const eligible: {
    reference: GitExplorerRef;
    deletion: NonNullable<ReturnType<typeof prepareGitExplorerBranchDeletion>>;
  }[] = [];
  const skipped: { reference: GitExplorerRef; reason: string }[] = [];
  for (const reference of references) {
    if (reference.kind !== "local" || !reference.shortName.startsWith(`${folder}/`)) continue;
    const status = byName.get(reference.name);
    const deletion =
      prepareGitExplorerBranchDeletion(reference, status) ??
      (force ? prepareGitExplorerBranchDeletion(reference, status, true) : null);
    if (deletion) eligible.push({ reference, deletion });
    else skipped.push({ reference, reason: gitExplorerBranchDeletionBlock(reference, status)! });
  }
  return { eligible, skipped };
}
