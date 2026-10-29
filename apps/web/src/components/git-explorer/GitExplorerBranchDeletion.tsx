import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitExplorerBranchStatus,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRef,
} from "@t3tools/contracts";
import {
  describeGitExplorerMerge,
  gitExplorerUpstreamMergeSummary,
  prepareGitExplorerBranchesDeletion,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";

import { gitExplorerEnvironment } from "~/state/git-explorer";
import { useEnvironment } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { prepareGitExplorerFolderDeletion } from "./gitExplorerBranches.logic";

export function GitExplorerBranchDeletion({
  folder,
  references,
  environmentId,
  input,
  overview,
  onClose,
  refresh,
}: {
  folder?: string;
  references: readonly GitExplorerRef[];
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  onClose: () => void;
  refresh: () => void;
}) {
  const allowed = useAtomValue(gitExplorerEnvironment.deleteBranch.permissionAtom(environmentId));
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const readStatuses = useAtomCommand(gitExplorerEnvironment.readBranchStatuses, {
    reportFailure: false,
  });
  const deleteBranch = useAtomCommand(gitExplorerEnvironment.deleteBranch, {
    reportFailure: false,
  });
  // Freeze the reviewed scope; refreshes must not add new branches to a pending deletion.
  const [captured] = useState(() => ({ input, overview, references }));
  const [statuses, setStatuses] = useState<GitExplorerBranchStatus[] | null>(null);
  const [force, setForce] = useState(false);
  const safeReview = statuses
    ? folder
      ? prepareGitExplorerFolderDeletion(folder, captured.references, statuses)
      : prepareGitExplorerBranchesDeletion(captured.references, statuses)
    : null;
  const forceReview = statuses
    ? folder
      ? prepareGitExplorerFolderDeletion(folder, captured.references, statuses, true)
      : prepareGitExplorerBranchesDeletion(captured.references, statuses, true)
    : null;
  const review = force ? forceReview : safeReview;
  const forceCount = (forceReview?.eligible.length ?? 0) - (safeReview?.eligible.length ?? 0);
  const statusesByName = new Map(statuses?.map((status) => [status.name, status]));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load and cancel the branch safety review while the confirmation dialog is mounted.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const refs = captured.references;
      const statuses: GitExplorerBranchStatus[] = [];
      for (let index = 0; index < refs.length; index += 32) {
        const result = await readStatuses({
          environmentId,
          input: {
            ...captured.input,
            snapshotId: captured.overview.snapshotId,
            branches: refs.slice(index, index + 32).map((ref) => ref.name),
          },
        });
        if (!active) return;
        if (result._tag !== "Success") {
          const failure = isAtomCommandInterrupted(result)
            ? null
            : squashAtomCommandFailure(result);
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not review branches. Close this review and try again.",
          );
          return;
        }
        statuses.push(...result.value.branches);
      }
      if (active) setStatuses(statuses);
    };
    void load();
    return () => {
      active = false;
    };
  }, [captured, environmentId, readStatuses]);
  const remove = async () => {
    if (!review || inFlight.current || !allowed || !connected) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const completed = new Set(deleted);
    for (const entry of review.eligible) {
      if (completed.has(entry.reference.name)) continue;
      const result = await deleteBranch({
        environmentId,
        input: { ...captured.input, ...entry.deletion.input },
      });
      if (result._tag !== "Success") {
        const failure = squashAtomCommandFailure(result);
        setError(
          `${completed.size} ${completed.size === 1 ? "branch" : "branches"} deleted. Deletion stopped: ${failure instanceof Error ? failure.message : "Refresh and review the remaining branches."}`,
        );
        setDeleted(completed);
        setPending(false);
        inFlight.current = false;
        refresh();
        return;
      }
      completed.add(entry.reference.name);
      setDeleted(new Set(completed));
    }
    toastManager.add({
      type: "success",
      title: `Deleted ${completed.size} local ${completed.size === 1 ? "branch" : "branches"}`,
      ...(review.skipped.length
        ? {
            description: `${review.skipped.length} ${review.skipped.length === 1 ? "branch was" : "branches were"} kept.`,
          }
        : {}),
    });
    refresh();
    onClose();
  };
  const remaining = review?.eligible.filter((entry) => !deleted.has(entry.reference.name)) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {folder ? `Delete branches in ${folder}` : "Delete selected branches"}
          </DialogTitle>
          <DialogDescription>
            Review the branches in the repository on{" "}
            {environment?.label || "the selected environment"}. Branches on Git remotes and worktree
            files are unchanged.
            {folder ? " The folder disappears when no branches remain." : null}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto px-6 py-4 text-xs">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {!review && !error ? <p>Checking branches…</p> : null}
          {review ? (
            <>
              {forceCount > 0 ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={force}
                      disabled={pending || deleted.size > 0}
                      onChange={(event) => setForce(event.target.checked)}
                    />
                    Force delete unmerged or unverified branches ({forceCount})
                  </label>
                  <p className="text-muted-foreground">
                    This can lose commits that are not saved on another branch. This cannot be
                    undone from Git Explorer. Checked-out and protected branches are kept.
                  </p>
                </div>
              ) : null}
              <p className="font-medium">
                {force ? "Force delete" : "Delete"} {remaining.length}{" "}
                {force ? "" : "merged or patch-equivalent "}
                {remaining.length === 1 ? "branch" : "branches"}
              </p>
              <ul className="space-y-2">
                {remaining.map(({ reference, deletion }) => (
                  <li key={reference.name}>
                    <span className="font-medium">{reference.shortName}</span>
                    <span className="block text-muted-foreground">
                      {deletion.input.force
                        ? `Force deletion · ${describeGitExplorerMerge(statusesByName.get(reference.name))}`
                        : `${deletion.input.allowEquivalent ? "Equivalent patches; original commits are not ancestors" : "Merged"} · ${deletion.input.expectedTargetRef?.replace(/^refs\/(heads|remotes)\//, "")}`}
                    </span>
                    {reference.upstream ? (
                      <span className="block text-muted-foreground">
                        {
                          gitExplorerUpstreamMergeSummary(
                            reference,
                            statusesByName.get(reference.name),
                          ).description
                        }
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {review.skipped.length ? (
                <>
                  <p className="font-medium">
                    Keep {review.skipped.length}{" "}
                    {review.skipped.length === 1 ? "branch" : "branches"}
                  </p>
                  <ul className="space-y-2">
                    {review.skipped.map(({ reference, reason }) => (
                      <li key={reference.name}>
                        {reference.shortName}
                        <span className="block text-muted-foreground">{reason}</span>
                        {reference.upstream ? (
                          <span className="block text-muted-foreground">
                            {
                              gitExplorerUpstreamMergeSummary(
                                reference,
                                statusesByName.get(reference.name),
                              ).description
                            }
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="text-muted-foreground">
                Remote comparisons use the last fetched refs. Each branch is checked again before
                deletion.
              </p>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!remaining.length || pending || error !== null || !allowed || !connected}
            onClick={() => void remove()}
          >
            {pending
              ? `Deleting… (${deleted.size}/${review?.eligible.length ?? 0})`
              : `${force ? "Force delete" : "Delete"} ${remaining.length} ${remaining.length === 1 ? "branch" : "branches"}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
