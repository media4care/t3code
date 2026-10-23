import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRunActionInput,
  GitExplorerStash,
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

export type GitExplorerStashActionKind = Extract<
  GitExplorerRunActionInput["action"],
  "apply-stash" | "pop-stash" | "drop-stash"
>;

export function GitExplorerStashAction(props: {
  action: GitExplorerStashActionKind;
  stash: GitExplorerStash;
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [overview] = useState(props.overview);
  const [restoreIndex, setRestoreIndex] = useState(true);
  const { execute, pending, allowed, failureMessage } = useGitExplorerAction({
    ...props,
    overview,
  });
  const dropping = props.action === "drop-stash";
  const label = dropping
    ? "Delete stash"
    : props.action === "pop-stash"
      ? "Pop stash"
      : "Apply stash";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) props.onClose();
      }}
    >
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void execute({ action: props.action, stashHash: props.stash.hash, restoreIndex }).then(
              (success) => {
                if (success) props.onComplete();
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {dropping
                ? "Delete this saved stash without applying it. Working files are kept. This cannot be undone from Git Explorer."
                : props.action === "pop-stash"
                  ? "Restore the saved changes and remove the stash only after a successful apply. If conflicts occur, the stash is kept."
                  : "Restore the saved changes into this worktree and keep the stash for later."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-4 text-xs">
            <p className="break-words font-medium">
              {props.stash.name} · {props.stash.subject}
            </p>
            <p className="break-all text-muted-foreground">{overview.selectedWorktreePath}</p>
            {!dropping ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={restoreIndex}
                  disabled={pending}
                  onChange={(event) => setRestoreIndex(event.target.checked)}
                />
                Restore staged files
              </label>
            ) : null}
            {failureMessage ? (
              <p role="alert" className="text-destructive">
                {failureMessage}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={props.onClose}>
              {failureMessage ? "Close" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant={dropping ? "destructive" : "default"}
              disabled={!allowed || pending}
            >
              {pending ? "Working…" : label}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
