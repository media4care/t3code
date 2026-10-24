import { prepareGitExplorerBranchDeletion } from "@t3tools/client-runtime/git-explorer";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { GitExplorerBranchStatus, GitExplorerRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

export function describeBranchMerge(status: GitExplorerBranchStatus | null) {
  if (!status) return "Checking merge status";
  const target = status.targetRef?.replace(/^refs\/(?:heads|remotes)\//, "");
  const unknown = `Merge status unknown${target ? ` against ${target}` : ""}`;
  switch (status.mergeStatus) {
    case "merged":
      return `Merged into ${target}`;
    case "equivalent":
      return `Equivalent changes in ${target} (rebased or cherry-picked)`;
    case "unmerged":
      return `Not merged into ${target}`;
    case "unknown":
      switch (status.reason) {
        case "missing-base":
          return `${unknown}: no comparison branch`;
        case "shallow":
          return `${unknown}: shallow history`;
        case "merge-commits":
          return `${unknown}: merge commits prevent patch comparison`;
        case "limit":
          return `${unknown}: comparison limit reached`;
        case "unrelated":
          return `${unknown}: unrelated histories`;
        default:
          return `${unknown}: comparison unavailable`;
      }
  }
}

export function useGitExplorerBranchActions(params: GitExplorerParams, onRefresh: () => void) {
  const target = gitExplorerTarget(params);
  const canWrite = useAtomValue(
    gitExplorerEnvironment.deleteBranch.permissionAtom(target.environmentId),
  );
  const connected = useWorkspaceEnvironments().some(
    (environment) =>
      environment.environmentId === target.environmentId &&
      environment.connectionState === "connected",
  );
  const run = useAtomCommand(gitExplorerEnvironment.deleteBranch, { reportFailure: false });
  const pending = useRef(false);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const unavailableReason = !connected
    ? "Reconnect to delete a branch."
    : !canWrite
      ? "This connection cannot change source control."
      : busyBranch
        ? "A branch deletion is in progress."
        : null;

  const confirmDelete = (ref: GitExplorerRef, status: GitExplorerBranchStatus) => {
    if (
      unavailableReason ||
      pending.current ||
      ref.kind !== "local" ||
      ref.name !== status.name ||
      ref.hash !== status.hash ||
      status.deleteBlockedReason === "protected" ||
      status.deleteBlockedReason === "checked-out"
    )
      return;
    const review =
      prepareGitExplorerBranchDeletion(ref, status) ??
      prepareGitExplorerBranchDeletion(ref, status, true);
    if (!review) return;
    Dialog.confirm({
      title: review.input.force ? "Force delete branch" : "Delete branch",
      message: review.confirmation,
      confirmText: review.input.force ? "Force delete branch" : "Delete branch",
      destructive: true,
      onConfirm: () => {
        if (pending.current) return;
        pending.current = true;
        setBusyBranch(ref.name);
        void run({
          ...target,
          input: {
            ...target.input,
            ...review.input,
          },
        }).then((result) => {
          pending.current = false;
          setBusyBranch(null);
          onRefresh();
          if (AsyncResult.isFailure(result)) {
            const failure = squashAtomCommandFailure(result);
            Dialog.alert(
              "Could not delete branch",
              failure instanceof Error ? failure.message : "Refresh and try again.",
            );
          }
        });
      },
    });
  };

  return { busyBranch, unavailableReason, confirmDelete };
}
