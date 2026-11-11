import {
  describeGitExplorerRelease,
  describeGitExplorerReleaseVersion,
  describeGitFailure,
  gitExplorerReleaseText,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerReleaseChannel,
  GitExplorerReleasePlanResult,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { relativeTime } from "../../lib/time";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerMerge } from "./useGitExplorerMerge";

function releaseMessage(plan: GitExplorerReleasePlanResult) {
  const { steps, conflicts } = describeGitExplorerRelease(plan);
  return [
    describeGitExplorerReleaseVersion(plan, (iso) => `${relativeTime(iso)} ago`),
    steps
      .map((step, index) =>
        [
          `${index + 1}. ${gitExplorerReleaseText(step.title)}`,
          ...(step.detail ? [`   ${step.detail}`] : []),
          ...(index === 0 && plan.merge
            ? plan.merge.commits.map((commit) => `   • ${commit.subject}`)
            : []),
        ].join("\n"),
      )
      .join("\n"),
    ...(conflicts ? [conflicts] : []),
  ].join("\n\n");
}

/** Plans a release, confirms it, then merges, tags and pushes; conflicts go to an agent thread. */
export function useGitExplorerRelease(params: GitExplorerParams, onRefresh: () => void) {
  const target = gitExplorerTarget(params);
  const merge = useGitExplorerMerge(params, onRefresh);
  const readPlan = useAtomCommand(gitExplorerEnvironment.readReleasePlan, {
    reportFailure: false,
  });
  const run = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const inFlight = useRef(false);
  const [releasing, setReleasing] = useState(false);
  const unavailable = merge.mergeUnavailable || releasing;

  const begin = () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setReleasing(true);
    return true;
  };
  const end = () => {
    inFlight.current = false;
    setReleasing(false);
  };
  const fail = (
    title: string,
    result: AtomCommandResult<unknown, unknown> & { _tag: "Failure" },
  ) => {
    if (!isAtomCommandInterrupted(result))
      Dialog.alert(title, describeGitFailure(squashAtomCommandFailure(result), "Try again."));
  };

  const release = (
    overview: GitExplorerOverviewResult,
    plan: GitExplorerReleasePlanResult,
    reference: GitExplorerRef,
  ) => {
    if (!begin()) return;
    void run({
      ...target,
      input: {
        ...target.input,
        action: "release",
        mergeRef: reference.name,
        revision: reference.hash,
        releaseChannel: plan.channel,
        tagName: plan.tag,
        releaseBase: plan.base,
        expectedHead: overview.headHash,
        expectedBranch: overview.headBranch,
      },
    })
      .then(async (result) => {
        if (result._tag !== "Success") return fail(`Could not release ${plan.tag}`, result);
        const { conflictedPaths, message } = result.value;
        if (conflictedPaths)
          await merge.launchAgent(overview, plan.source, plan.releaseBranch, conflictedPaths);
        else Dialog.alert(`Released ${plan.tag}`, message);
      })
      .finally(() => {
        end();
        onRefresh();
      });
  };

  const confirmRelease = (
    overview: GitExplorerOverviewResult,
    channel: GitExplorerReleaseChannel,
    reference: GitExplorerRef,
  ) => {
    if (unavailable || !begin()) return;
    void readPlan({
      ...target,
      input: { ...target.input, channel, sourceRef: reference.name, revision: reference.hash },
    })
      .then((result) => {
        if (result._tag !== "Success") return fail("Could not plan the release", result);
        const plan = result.value;
        const production = channel === "production";
        if (plan.blocked) {
          Dialog.alert(`Can't release ${plan.tag}`, plan.blocked);
          return;
        }
        Dialog.confirm({
          title: `Release ${plan.tag} to ${production ? "production" : "beta"}`,
          message: releaseMessage(plan),
          confirmText: `Release ${plan.tag}`,
          destructive: production,
          onConfirm: () => release(overview, plan, reference),
        });
      })
      .finally(end);
  };

  return { releaseUnavailable: unavailable, confirmRelease };
}
