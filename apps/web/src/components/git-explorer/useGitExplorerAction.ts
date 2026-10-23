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
} from "@t3tools/contracts";
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
}: {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  refresh: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const allowed = useAtomValue(gitExplorerEnvironment.runAction.permissionAtom(environmentId));
  const run = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const execute = async (
    action: Omit<
      GitExplorerRunActionInput,
      "projectId" | "worktreePath" | "expectedHead" | "expectedBranch"
    >,
    expected = overview,
  ) => {
    if (!allowed || inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setFailureMessage(null);
    onBusyChange(true);
    try {
      const result = await run({
        environmentId,
        input: {
          ...input,
          ...action,
          expectedHead: expected.headHash,
          expectedBranch: expected.headBranch,
        },
      });
      if (result._tag === "Success") {
        toastManager.add({ type: "success", title: result.value.message });
        return true;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        const description = error instanceof Error ? error.message : "Refresh and try again.";
        setFailureMessage(description);
        toastManager.add({
          type: "error",
          title: "Git action failed",
          description,
        });
      }
      return false;
    } finally {
      refresh();
      void refreshStatus({ environmentId, input: { cwd: overview.selectedWorktreePath } });
      inFlight.current = false;
      setPending(false);
      onBusyChange(false);
    }
  };
  return { execute, pending, allowed, failureMessage };
}
