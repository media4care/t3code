import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { GitExplorerOverviewResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { vcsEnvironment } from "../../state/vcs";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

export function useGitExplorerSync(
  params: GitExplorerParams,
  overview: GitExplorerOverviewResult,
  refresh: () => void,
) {
  const target = gitExplorerTarget(params);
  const allowed = useAtomValue(
    gitExplorerEnvironment.runAction.permissionAtom(target.environmentId),
  );
  const connected = useWorkspaceEnvironments().some(
    (environment) =>
      environment.environmentId === target.environmentId &&
      environment.connectionState === "connected",
  );
  const runAction = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const inFlight = useRef(false);
  const [pending, setPending] = useState<"fetch" | "pull" | null>(null);
  const branch = overview.refs.find(
    (ref) => ref.kind === "local" && ref.shortName === overview.headBranch,
  );
  const unavailable = !connected
    ? "Connect to this environment first."
    : !allowed
      ? "This connection cannot change source control."
      : pending
        ? "A Git action is in progress."
        : null;
  const pullUnavailable =
    unavailable ??
    (!overview.headBranch
      ? "Check out a branch before pulling."
      : !branch?.upstream || branch.upstreamMissing
        ? "Configure an upstream before pulling."
        : null);

  const execute = async (action: "fetch" | "pull") => {
    if (inFlight.current || (action === "pull" ? pullUnavailable : unavailable)) return;
    inFlight.current = true;
    setPending(action);
    const reportFailure = (error: unknown) =>
      Dialog.alert(
        action === "fetch" ? "Could not fetch" : "Could not pull",
        error instanceof Error ? error.message : "Refresh and try again.",
      );
    const result = await runAction({
      ...target,
      input: {
        ...target.input,
        action,
        expectedHead: overview.headHash,
        expectedBranch: overview.headBranch,
      },
    }).catch((error: unknown) => {
      reportFailure(error);
      return null;
    });
    if (result && AsyncResult.isFailure(result) && !isAtomCommandInterrupted(result)) {
      reportFailure(squashAtomCommandFailure(result));
    }
    refresh();
    void refreshStatus({
      environmentId: target.environmentId,
      input: { cwd: overview.selectedWorktreePath },
    });
    inFlight.current = false;
    setPending(null);
  };
  return { pending, unavailable, pullUnavailable, execute };
}
