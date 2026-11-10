import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRunActionInput,
  GitExplorerStash,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  TagIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { gitExplorerEnvironment } from "~/state/git-explorer";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
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
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

import type { GitExplorerStashActionKind } from "./GitExplorerStashAction";

export function GitExplorerToolbar({
  environmentId,
  input,
  overview,
  selectedRevision,
  connected,
  busy,
  onBusyChange,
  refresh,
  onStashAction,
  onAddTag,
}: {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  selectedRevision: string | null | undefined;
  connected: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  refresh: () => void;
  onStashAction: (action: GitExplorerStashActionKind, stash: GitExplorerStash) => void;
  onAddTag: (revision: string) => void;
}) {
  const allowed = useAtomValue(gitExplorerEnvironment.runAction.permissionAtom(environmentId));
  const runAction = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const [pending, setPending] = useState<GitExplorerRunActionInput["action"] | null>(null);
  const inFlight = useRef(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [force, setForce] = useState(true);
  const [message, setMessage] = useState("");
  const stash = overview.stashes.find((entry) => entry.hash === selectedRevision);
  const branch = overview.refs.find(
    (ref) => ref.kind === "local" && ref.shortName === overview.headBranch,
  );
  const unavailable = !connected
    ? "Connect to this environment first."
    : !allowed
      ? "Source-control write permission is required."
      : busy
        ? "A Git action is in progress."
        : null;
  const execute = async (action: "push" | "pull" | "fetch" | "stash") => {
    if (inFlight.current || unavailable) return;
    inFlight.current = true;
    setPending(action);
    onBusyChange(true);
    const result = await runAction({
      environmentId,
      input: {
        ...input,
        action,
        expectedHead: overview.headHash,
        expectedBranch: overview.headBranch,
        ...(action === "stash" ? { message } : {}),
        ...(action === "push" ? { force } : {}),
      },
    });
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: result.value.message });
      if (action === "stash") {
        setStashOpen(false);
        setMessage("");
      }
      if (action === "push") setPushOpen(false);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Git action failed",
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    }
    // A failed pull or stash apply can still fetch refs or leave conflict files.
    refresh();
    void refreshStatus({ environmentId, input: { cwd: overview.selectedWorktreePath } });
    inFlight.current = false;
    setPending(null);
    onBusyChange(false);
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5" aria-label="Git actions">
        <Button
          variant="ghost"
          size="xs"
          disabled={unavailable !== null || !(selectedRevision ?? overview.headHash)}
          title={unavailable ?? "Tag the selected commit, or HEAD"}
          onClick={() => {
            const revision = selectedRevision ?? overview.headHash;
            if (revision) onAddTag(revision);
          }}
        >
          <TagIcon className="size-3.5" aria-hidden />
          Tag
        </Button>
        {(
          [
            {
              action: "push",
              label: "Push",
              Icon: ArrowUpIcon,
              hint: "Push the current branch",
              blocked: !overview.headBranch ? "Check out a branch before pushing." : null,
            },
            {
              action: "pull",
              label: "Pull",
              Icon: ArrowDownIcon,
              hint: "Pull the current branch (fast-forward only)",
              blocked: !branch?.upstream ? "Configure an upstream before pulling." : null,
            },
            {
              action: "fetch",
              label: "Fetch",
              Icon: DownloadIcon,
              hint: "Fetch all remotes",
              blocked: null,
            },
            {
              action: "stash",
              label: "Stash",
              Icon: ArchiveIcon,
              hint: "Save tracked and untracked changes in a stash",
              blocked: !overview.headHash ? "Create the first commit before stashing." : null,
            },
          ] as const
        ).map(({ action, label, Icon, hint, blocked }) => (
          <Button
            key={action}
            variant="ghost"
            size="xs"
            title={unavailable ?? blocked ?? hint}
            disabled={unavailable !== null || blocked !== null}
            onClick={() => {
              if (action === "stash") setStashOpen(true);
              else if (action === "push") {
                setForce(true);
                setPushOpen(true);
              } else void execute(action);
            }}
          >
            {pending === action ? <Spinner size="xs" /> : <Icon className="size-3.5" aria-hidden />}
            {label}
          </Button>
        ))}
        {stash
          ? (
              [
                { action: "apply-stash", label: "Apply stash…", Icon: ArchiveRestoreIcon },
                { action: "pop-stash", label: "Pop stash…", Icon: ArchiveRestoreIcon },
                { action: "drop-stash", label: "Delete stash…", Icon: Trash2Icon },
              ] as const
            ).map(({ action, label, Icon }) => (
              <Button
                key={action}
                variant={action === "drop-stash" ? "ghost-destructive" : "ghost"}
                size="xs"
                disabled={unavailable !== null}
                title={unavailable ?? `${label} ${stash.name}`}
                onClick={() => onStashAction(action, stash)}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </Button>
            ))
          : null}
      </div>
      <Dialog
        open={pushOpen}
        onOpenChange={(open) => {
          if (!pending) setPushOpen(open);
        }}
      >
        <DialogPopup>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void execute("push");
            }}
          >
            <DialogHeader>
              <DialogTitle>Push {overview.headBranch}</DialogTitle>
              <DialogDescription>
                {branch?.upstream
                  ? `Push ${overview.headBranch} to ${overview.refs.find((ref) => ref.name === branch.upstream)?.shortName ?? branch.upstream}.`
                  : `Publish ${overview.headBranch} and set its upstream.`}
              </DialogDescription>
            </DialogHeader>
            <label className="flex items-start gap-2 px-6 py-4 text-sm">
              <span className="mt-0.5 flex">
                <Checkbox
                  checked={force}
                  onCheckedChange={(checked) => setForce(checked === true)}
                />
              </span>
              <span>
                Force push
                <span className="block text-xs text-muted-foreground">
                  Overwrites the remote branch with your history (--force-with-lease). Stops if the
                  remote has commits you have not fetched.
                </span>
              </span>
            </label>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => setPushOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={unavailable !== null} autoFocus>
                {pending === "push" ? "Pushing…" : force ? "Force push" : "Push"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={stashOpen}
        onOpenChange={(open) => {
          if (!pending) setStashOpen(open);
        }}
      >
        <DialogPopup>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void execute("stash");
            }}
          >
            <DialogHeader>
              <DialogTitle>Stash changes</DialogTitle>
              <DialogDescription>
                Save tracked and untracked changes in this worktree. Select the saved stash in the
                left panel and choose Apply stash to restore it.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-4">
              <Input
                aria-label="Stash message"
                placeholder="Optional stash message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => setStashOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={unavailable !== null}>
                {pending === "stash" ? "Stashing…" : "Stash changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
