import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerDetailsResult,
  GitExplorerFile,
} from "@t3tools/contracts";
import { useState } from "react";
import { ensureLocalApi } from "~/localApi";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { useGitExplorerAction } from "./useGitExplorerAction";
import { useGitExplorerQuery } from "./useGitExplorerQuery";

export interface GitExplorerWorkingTreeActions {
  overview: GitExplorerOverviewResult;
  busy: boolean;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
}

export function GitExplorerWorkingTree({
  environmentId,
  input,
  details,
  selectedFile,
  ...actions
}: GitExplorerWorkingTreeActions & {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  details: GitExplorerDetailsResult;
  selectedFile: GitExplorerFile | null;
}) {
  const { execute, pending, allowed } = useGitExplorerAction({ environmentId, input, ...actions });
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitReview, setCommitReview] = useState<{
    overview: GitExplorerOverviewResult;
    indexVersion: string | undefined;
    count: number;
  } | null>(null);
  const [amend, setAmend] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const head = useGitExplorerQuery(
    commitOpen && amend && commitReview?.overview.headHash
      ? gitExplorerEnvironment.details({
          environmentId,
          input: { ...input, revision: commitReview.overview.headHash },
        })
      : null,
  );
  const patch = useGitExplorerQuery(
    selectedFile && (selectedFile.stage === "unstaged" || selectedFile.stage === "untracked")
      ? gitExplorerEnvironment.patch({
          environmentId,
          input: { ...input, revision: null, path: selectedFile.path, stage: selectedFile.stage },
        })
      : null,
  );
  const staged = details.files.filter((file) => file.stage === "staged");
  const unstaged = details.files.filter(
    (file) => file.stage === "unstaged" || file.stage === "untracked",
  );
  const commitMessage =
    message ??
    (amend && head.data?.commit
      ? [head.data.commit.subject, head.data.commit.body].filter(Boolean).join("\n\n")
      : "");
  const blocked = !allowed || actions.busy || pending || confirming;
  const discard = async () => {
    if (
      blocked ||
      !selectedFile ||
      !patch.data?.changeToken ||
      (selectedFile.stage !== "unstaged" && selectedFile.stage !== "untracked")
    )
      return;
    const file = selectedFile;
    const changeToken = patch.data.changeToken;
    setConfirming(true);
    try {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        file.stage === "untracked"
          ? `Delete the untracked file ${file.path}? It has no committed version to restore.`
          : `Discard unstaged changes in ${file.path}? Staged changes are kept.`,
        { variant: "destructive" },
      );
      if (confirmed)
        await execute({
          action: "discard",
          filePaths: [file.path],
          fileStage: file.stage as "unstaged" | "untracked",
          changeToken,
        });
    } finally {
      setConfirming(false);
    }
  };
  return (
    <>
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1"
        aria-label="Working tree actions"
      >
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !selectedFile || selectedFile.stage === "staged"}
          onClick={() => {
            if (selectedFile) void execute({ action: "stage", filePaths: [selectedFile.path] });
          }}
        >
          Stage file
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || selectedFile?.stage !== "staged"}
          onClick={() => {
            if (selectedFile) void execute({ action: "unstage", filePaths: [selectedFile.path] });
          }}
        >
          Unstage file
        </Button>
        <Button
          size="xs"
          variant="ghost-destructive"
          disabled={blocked || !patch.data?.changeToken || selectedFile?.status === "unmerged"}
          onClick={() => void discard()}
        >
          Discard…
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !unstaged.length || details.truncated}
          onClick={() =>
            void execute({
              action: "stage",
              filePaths: [...new Set(unstaged.map((file) => file.path))],
            })
          }
        >
          Stage all
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !staged.length || details.truncated}
          onClick={() =>
            void execute({ action: "unstage", filePaths: staged.map((file) => file.path) })
          }
        >
          Unstage all
        </Button>
        <Button
          size="xs"
          disabled={blocked || (!staged.length && !actions.overview.headHash)}
          onClick={() => {
            setMessage(null);
            setAmend(false);
            setCommitReview({
              overview: actions.overview,
              indexVersion: details.indexVersion,
              count: staged.length,
            });
            setCommitOpen(true);
          }}
        >
          Commit…
        </Button>
        <span className="text-xs text-muted-foreground">
          {staged.length} staged · {unstaged.length} unstaged
        </span>
      </div>
      <Dialog
        open={commitOpen}
        onOpenChange={(open) => {
          if (!pending) setCommitOpen(open);
        }}
      >
        <DialogPopup>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void execute(
                {
                  action: "commit",
                  message: commitMessage,
                  amend,
                  indexVersion: commitReview?.indexVersion,
                },
                commitReview?.overview,
              ).then((success) => {
                if (success) {
                  setCommitOpen(false);
                  setMessage(null);
                }
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>{amend ? "Amend latest commit" : "Commit staged changes"}</DialogTitle>
              <DialogDescription>
                {amend
                  ? "Replace the latest commit with this message and the current staged content. Published commits will have a new hash."
                  : `${commitReview?.count ?? 0} staged files will be committed. Unstaged changes are kept.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-6 py-4">
              <Textarea
                aria-label="Commit message"
                placeholder="Commit message"
                rows={6}
                maxLength={10000}
                value={commitMessage}
                onChange={(event) => setMessage(event.target.value)}
                autoFocus
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={amend}
                  disabled={pending || !actions.overview.headHash}
                  onChange={(event) => {
                    setAmend(event.target.checked);
                    setMessage(null);
                  }}
                />
                Amend latest commit
              </label>
              {head.error ? <p className="text-xs text-destructive">{head.error}</p> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setCommitOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  blocked ||
                  !commitMessage.trim() ||
                  (!amend && !commitReview?.count) ||
                  !commitReview?.indexVersion
                }
              >
                {pending ? "Committing…" : amend ? "Amend commit" : "Commit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
