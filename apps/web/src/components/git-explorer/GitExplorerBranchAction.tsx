import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRef,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { useGitExplorerAction } from "./useGitExplorerAction";

export function GitExplorerBranchAction(props: {
  action: "switch" | "rename";
  reference: GitExplorerRef;
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(props.reference.shortName);
  const { execute, pending, allowed } = useGitExplorerAction(props);
  const switching = props.action === "switch";
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
            void execute({
              action: props.action,
              branchName: props.reference.name,
              branchHash: props.reference.hash,
              ...(switching ? {} : { newName: name.trim() }),
            }).then((success) => {
              if (success) props.onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{switching ? "Switch branch" : "Rename branch"}</DialogTitle>
            <DialogDescription>
              {switching
                ? `Switch this worktree to ${props.reference.shortName}. Local changes are kept; Git will refuse if they would be overwritten.`
                : `Rename the local branch ${props.reference.shortName}. Its remote branch is unchanged.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-4 text-xs">
            <p className="break-all text-muted-foreground">{props.overview.selectedWorktreePath}</p>
            {!switching ? (
              <Input
                aria-label="New branch name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={1024}
                autoFocus
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !allowed ||
                pending ||
                (!switching && (!name.trim() || name.trim() === props.reference.shortName))
              }
            >
              {pending ? "Working…" : switching ? "Switch branch" : "Rename branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
