import { gitExplorerResetModes } from "@t3tools/client-runtime/git-explorer";
import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRunActionInput,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { RadioGroup, Radio } from "../ui/radio-group";
import { useGitExplorerAction } from "./useGitExplorerAction";

export function GitExplorerResetAction(props: {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  revision: string;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const [overview] = useState(props.overview);
  const [mode, setMode] = useState<NonNullable<GitExplorerRunActionInput["resetMode"]>>("mixed");
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const { execute, pending, allowed, failureMessage } = useGitExplorerAction({
    ...props,
    overview,
  });
  const ready =
    allowed && !pending && !!overview.headBranch && (mode !== "hard" || discardConfirmed);
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
            if (!ready) return;
            void execute({ action: "reset", revision: props.revision, resetMode: mode }).then(
              (success) => {
                if (success) props.onClose();
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Reset {overview.headBranch ?? "current branch"} to this commit
            </DialogTitle>
            <DialogDescription>
              Move the checked-out branch to {props.revision.slice(0, 12)}. This rewrites local
              branch history; the remote branch stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 text-sm">
            <p className="break-all text-xs text-muted-foreground">
              {overview.selectedWorktreePath}
            </p>
            <RadioGroup
              aria-label="Reset mode"
              value={mode}
              disabled={pending}
              onValueChange={(value) => {
                const selected = gitExplorerResetModes.find((option) => option.value === value);
                if (selected) {
                  setMode(selected.value);
                  setDiscardConfirmed(false);
                }
              }}
            >
              {gitExplorerResetModes.map((option) => (
                <label key={option.value} className="flex items-start gap-3">
                  <Radio value={option.value} />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {mode === "hard" ? (
              <label className="flex items-start gap-3">
                <Checkbox
                  checked={discardConfirmed}
                  disabled={pending}
                  onCheckedChange={(checked) => setDiscardConfirmed(checked === true)}
                />
                <span>
                  I understand that discarded file changes cannot be recovered by undoing this
                  reset.
                </span>
              </label>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Previous tip: <span className="font-mono">{overview.headHash?.slice(0, 12)}</span>.
              Git records it in the reflog for recovery.
            </p>
            {failureMessage ? (
              <p role="alert" className="text-destructive">
                {failureMessage}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready}>
              {pending ? "Resetting…" : `Reset ${overview.headBranch ?? "current branch"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
