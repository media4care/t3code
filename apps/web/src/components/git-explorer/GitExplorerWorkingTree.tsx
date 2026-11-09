import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerDetailsResult,
  GitExplorerFile,
} from "@t3tools/contracts";
import { useImperativeHandle, useState, type Ref } from "react";
import { ensureLocalApi } from "~/localApi";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { useAtomCommand } from "~/state/use-atom-command";
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
import type { GitExplorerFileMenuExtra } from "./useGitExplorerFileMenu";
import { toastManager } from "../ui/toast";

export interface GitExplorerWorkingTreeActions {
  overview: GitExplorerOverviewResult;
  busy: boolean;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
}

export interface GitExplorerWorkingTreeHandle {
  fileMenu: (files: readonly GitExplorerFile[]) => GitExplorerFileMenuExtra;
}

const isDiscardable = (file: GitExplorerFile) =>
  (file.stage === "unstaged" || file.stage === "untracked") && file.status !== "unmerged";

export function GitExplorerWorkingTree({
  environmentId,
  input,
  details,
  selectedFiles,
  ref,
  ...actions
}: GitExplorerWorkingTreeActions & {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  details: GitExplorerDetailsResult;
  selectedFiles: readonly GitExplorerFile[];
  ref?: Ref<GitExplorerWorkingTreeHandle>;
}) {
  const { execute, pending, allowed } = useGitExplorerAction({ environmentId, input, ...actions });
  const readPatch = useAtomCommand(gitExplorerEnvironment.readPatch, { reportFailure: false });
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
  const stageable = (files: readonly GitExplorerFile[]) =>
    files.filter((file) => file.stage === "unstaged" || file.stage === "untracked");
  const unstageable = (files: readonly GitExplorerFile[]) =>
    files.filter((file) => file.stage === "staged");
  const stage = (files: readonly GitExplorerFile[]) => {
    const paths = [...new Set(stageable(files).map((file) => file.path))];
    if (!blocked && paths.length) void execute({ action: "stage", filePaths: paths });
  };
  const unstage = (files: readonly GitExplorerFile[]) => {
    const paths = unstageable(files).map((file) => file.path);
    if (!blocked && paths.length) void execute({ action: "unstage", filePaths: paths });
  };
  const discard = (selection: readonly GitExplorerFile[]) => {
    const files = selection.filter(isDiscardable);
    if (blocked || !files.length) return;
    setConfirming(true);
    return reviewDiscard(files).finally(() => setConfirming(false));
  };
  const reviewDiscard = async (files: readonly GitExplorerFile[]) => {
    const tokens: string[] = [];
    // Each token pins the reviewed change; the server refuses files that changed since.
    for (let index = 0; index < files.length; index += 8) {
      const results = await Promise.all(
        files.slice(index, index + 8).map((file) =>
          readPatch({
            environmentId,
            input: { ...input, revision: null, path: file.path, stage: file.stage },
          }),
        ),
      );
      for (const result of results) {
        if (result._tag !== "Success" || !result.value.changeToken) {
          toastManager.add({
            type: "error",
            title: "Could not discard changes",
            description:
              "A change is too large to review here or could not be read. Refresh and try again.",
          });
          return;
        }
        tokens.push(result.value.changeToken);
      }
    }
    const untracked = files.filter((file) => file.stage === "untracked").length;
    const submodules = files.filter((file) =>
      actions.overview.submodules?.some((submodule) => submodule.path === file.path),
    ).length;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      [
        files.length === 1
          ? files[0]!.stage === "untracked"
            ? `Delete the untracked file ${files[0]!.path}? It has no committed version to restore.`
            : `Discard unstaged changes in ${files[0]!.path}? Staged changes are kept.`
          : `Discard unstaged changes in ${files.length} files? Staged changes are kept.`,
        ...(files.length > 1
          ? [
              files
                .slice(0, 8)
                .map((file) => file.path)
                .join("\n") + (files.length > 8 ? `\n…and ${files.length - 8} more` : ""),
            ]
          : []),
        ...(files.length > 1 && untracked
          ? [`${untracked} untracked ${untracked === 1 ? "file is" : "files are"} deleted.`]
          : []),
        ...(submodules
          ? [
              `${submodules === 1 ? "The submodule is" : `${submodules} submodules are`} checked out at the commit this repository records.`,
            ]
          : []),
      ].join("\n\n"),
      { variant: "destructive" },
    );
    if (confirmed)
      await execute({
        action: "discard",
        filePaths: files.map((file) => file.path),
        fileStages: files.map((file) => file.stage as "unstaged" | "untracked"),
        changeTokens: tokens,
      });
  };
  useImperativeHandle(ref, () => ({
    fileMenu: (files) => ({
      items: [
        {
          id: "stage",
          label: files.length > 1 ? `Stage ${files.length} files` : "Stage",
          disabled: blocked || !stageable(files).length,
        },
        {
          id: "unstage",
          label: files.length > 1 ? `Unstage ${files.length} files` : "Unstage",
          disabled: blocked || !unstageable(files).length,
        },
        {
          id: "discard",
          label: "Discard changes…",
          destructive: true,
          disabled: blocked || !files.some(isDiscardable),
        },
      ],
      activate: (id) => {
        if (id === "stage") stage(files);
        else if (id === "unstage") unstage(files);
        else if (id === "discard") void discard(files);
      },
    }),
  }));
  const count = selectedFiles.length;
  return (
    <>
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1"
        aria-label="Working tree actions"
      >
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !stageable(selectedFiles).length}
          onClick={() => stage(selectedFiles)}
        >
          {count > 1 ? `Stage ${count} files` : "Stage file"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !unstageable(selectedFiles).length}
          onClick={() => unstage(selectedFiles)}
        >
          {count > 1 ? `Unstage ${count} files` : "Unstage file"}
        </Button>
        <Button
          size="xs"
          variant="ghost-destructive"
          disabled={blocked || !selectedFiles.some(isDiscardable)}
          onClick={() => void discard(selectedFiles)}
        >
          {count > 1 ? `Discard ${count} files…` : "Discard…"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !unstaged.length || details.truncated}
          onClick={() => stage(unstaged)}
        >
          Stage all
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={blocked || !staged.length || details.truncated}
          onClick={() => unstage(staged)}
        >
          Unstage all
        </Button>
        <Button
          size="xs"
          variant="ghost-destructive"
          disabled={blocked || !unstaged.some(isDiscardable) || details.truncated}
          onClick={() => void discard(unstaged)}
        >
          Discard all…
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
