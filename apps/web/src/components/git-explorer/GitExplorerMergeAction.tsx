import { gitExplorerMergeConflictTask } from "@t3tools/client-runtime/git-explorer";
import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRef,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { useGitExplorerAction } from "./useGitExplorerAction";
import { useGitExplorerConflictAgent } from "./useGitExplorerConflictAgent";

/** A commit to merge, or a branch that must still point at it. */
export type GitExplorerMergeRequest = {
  revision: string;
  reference?: GitExplorerRef;
};

export function GitExplorerMergeAction(
  props: GitExplorerMergeRequest & {
    environmentId: EnvironmentId;
    input: GitExplorerOverviewInput;
    overview: GitExplorerOverviewResult;
    refresh: () => void;
    onBusyChange: (busy: boolean) => void;
    onClose: () => void;
  },
) {
  const [overview] = useState(props.overview);
  const branch = overview.headBranch;
  const source = props.reference?.shortName ?? props.revision.slice(0, 12);
  const launchAgent = useGitExplorerConflictAgent({
    environmentId: props.environmentId,
    scope: props.input,
  });
  const { execute, pending, allowed, failureMessage } = useGitExplorerAction({
    ...props,
    overview,
    onSuccess: (result) => {
      if (result.conflictedPaths && branch)
        void launchAgent({
          ...gitExplorerMergeConflictTask({
            source,
            branch,
            cwd: overview.selectedWorktreePath,
            conflictedPaths: result.conflictedPaths,
          }),
          branch,
        });
    },
  });
  const ready = allowed && !pending && !!branch;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            void execute({
              action: "merge",
              revision: props.revision,
              ...(props.reference ? { mergeRef: props.reference.name } : {}),
            }).then((success) => {
              if (success) props.onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Merge {source} into {branch ?? "current branch"}
            </DialogTitle>
            <DialogDescription>
              Creates a merge commit on {branch ?? "the checked-out branch"}, even when a
              fast-forward is possible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 text-sm">
            <p className="break-all text-xs text-muted-foreground">
              {overview.selectedWorktreePath}
            </p>
            <p className="text-xs text-muted-foreground">
              If the merge stops with conflicts, it stays in progress and an agent (Claude Opus 5.5,
              high effort) starts in a new thread to resolve them and commit the merge.
            </p>
            {failureMessage ? (
              <p role="alert" className="text-destructive">
                {failureMessage}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              {pending ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={!ready}>
              {pending ? "Merging…" : "Merge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
