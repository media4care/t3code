import {
  applyGitExplorerReleaseProgress,
  describeGitFailure,
  type GitExplorerReleaseProgress,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerReleaseChannel,
  GitExplorerReleasePlanResult,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerMerge } from "./useGitExplorerMerge";

export type GitExplorerReleaseRequest = {
  overview: GitExplorerOverviewResult;
  channel: GitExplorerReleaseChannel;
  reference: GitExplorerRef;
};

/**
 * Opens the release sheet, then merges, tags and pushes; conflicts go to an agent thread.
 * The release runs here, not in the sheet, so closing the sheet doesn't stop it.
 */
export function useGitExplorerRelease(params: GitExplorerParams, onRefresh: () => void) {
  const target = gitExplorerTarget(params);
  const merge = useGitExplorerMerge(params, onRefresh);
  const run = useAtomCommand(gitExplorerEnvironment.release, { reportFailure: false });
  const inFlight = useRef(false);
  const [releasing, setReleasing] = useState(false);
  const [request, setRequest] = useState<GitExplorerReleaseRequest | null>(null);
  const [progress, setProgress] = useState<GitExplorerReleaseProgress | null>(null);
  const unavailable = merge.mergeUnavailable || releasing;

  const confirmRelease = (
    overview: GitExplorerOverviewResult,
    channel: GitExplorerReleaseChannel,
    reference: GitExplorerRef,
  ) => {
    if (unavailable) return;
    setProgress(null);
    setRequest({ overview, channel, reference });
  };

  const release = (plan: GitExplorerReleasePlanResult) => {
    if (!request || inFlight.current) return;
    const { overview, reference } = request;
    inFlight.current = true;
    setReleasing(true);
    setProgress(null);
    void run({
      ...target,
      input: {
        ...target.input,
        expectedHead: overview.headHash,
        expectedBranch: overview.headBranch,
        mergeRef: reference.name,
        revision: reference.hash,
        releaseChannel: plan.channel,
        tagName: plan.tag,
        releaseBase: plan.base,
      },
      onProgress: (event) =>
        setProgress((current) => applyGitExplorerReleaseProgress(current, event, Date.now())),
    })
      .then(async (result) => {
        setRequest(null);
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result))
            Dialog.alert(
              `Could not release ${plan.tag}`,
              describeGitFailure(squashAtomCommandFailure(result), "Try again."),
            );
          return;
        }
        const { conflictedPaths, message } = result.value;
        if (conflictedPaths)
          await merge.launchAgent(overview, plan.source, plan.releaseBranch, conflictedPaths);
        else Dialog.alert(`Released ${plan.tag}`, message);
      })
      .finally(() => {
        inFlight.current = false;
        setReleasing(false);
        onRefresh();
      });
  };

  return {
    releaseUnavailable: unavailable,
    confirmRelease,
    releaseSheet: request
      ? { request, releasing, progress, onRelease: release, onClose: () => setRequest(null) }
      : null,
  };
}
