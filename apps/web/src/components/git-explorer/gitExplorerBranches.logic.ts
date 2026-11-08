import { prepareGitExplorerBranchesDeletion } from "@t3tools/client-runtime/git-explorer";
import type { GitExplorerBranchStatus, GitExplorerRef } from "@t3tools/contracts";

export function prepareGitExplorerFolderDeletion(
  folder: string,
  references: readonly GitExplorerRef[],
  statuses: readonly GitExplorerBranchStatus[],
  force = false,
) {
  return prepareGitExplorerBranchesDeletion(
    references.filter((ref) => ref.kind === "local" && ref.shortName.startsWith(`${folder}/`)),
    statuses,
    force,
  );
}
