import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRunActionInput,
  GitExplorerRunActionResult,
} from "@t3tools/contracts";
import { describeGitFailure } from "@t3tools/client-runtime/git-explorer";
import { useRef, useState } from "react";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { toastManager } from "../ui/toast";

export function useGitExplorerAction({
  environmentId,
  input,
  overview,
  refresh,
  onBusyChange,
  onSuccess,
}: {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
  onSuccess?: (result: GitExplorerRunActionResult) => void;
}) {
  const allowed = useAtomValue(gitExplorerEnvironment.runAction.permissionAtom(environmentId));
  const run = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  /** Runs one Git command with the shared busy state, toasts and refresh. */
  const perform = async (
    request: () => Promise<AtomCommandResult<GitExplorerRunActionResult, unknown>>,
  ) => {
    if (!allowed || inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setFailureMessage(null);
    setFailure(null);
    onBusyChange(true);
    return request()
      .then((result) => {
        if (result._tag === "Success") {
          toastManager.add({
            type: result.value.conflictedPaths ? "warning" : "success",
            title: result.value.message,
          });
          onSuccess?.(result.value);
          return true;
        }
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          const description = describeGitFailure(error, "Refresh and try again.");
          setFailureMessage(description);
          setFailure(error);
          toastManager.add({
            type: "error",
            title: "Git action failed",
            description,
          });
        }
        return false;
      })
      .finally(() => {
        refresh();
        void refreshStatus({ environmentId, input: { cwd: overview.selectedWorktreePath } });
        inFlight.current = false;
        setPending(false);
        onBusyChange(false);
      });
  };
  const execute = (
    action: Omit<
      GitExplorerRunActionInput,
      "projectId" | "worktreePath" | "expectedHead" | "expectedBranch"
    >,
    expected = overview,
  ) =>
    perform(() =>
      run({
        environmentId,
        input: {
          ...input,
          ...action,
          expectedHead: expected.headHash,
          expectedBranch: expected.headBranch,
        },
      }),
    );
  return { execute, perform, pending, allowed, failureMessage, failure };
}
