import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import {
  CONFLICT_AGENT_MODEL_SELECTION,
  describeGitFailure,
  gitExplorerMergeConflictTask,
} from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  type GitExplorerOverviewResult,
  type GitExplorerRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { buildProjectThreadStartTurnInput } from "../../lib/projectThreadStartTurn";
import { useEnvironmentServerConfig } from "../../state/entities";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

/** Merges into the checked-out branch with --no-ff and hands conflicts to an agent thread. */
export function useGitExplorerMerge(params: GitExplorerParams, onRefresh: () => void) {
  const target = gitExplorerTarget(params);
  const navigation = useNavigation();
  const allowed = useAtomValue(
    gitExplorerEnvironment.runAction.permissionAtom(target.environmentId),
  );
  const connected = useWorkspaceEnvironments().some(
    (environment) =>
      environment.environmentId === target.environmentId &&
      environment.connectionState === "connected",
  );
  const settings = useEnvironmentServerConfig(target.environmentId)?.settings;
  const run = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const inFlight = useRef(false);
  const [merging, setMerging] = useState(false);
  const unavailable = !allowed || !connected || merging;

  const launchAgent = async (
    overview: GitExplorerOverviewResult,
    source: string,
    branch: string,
    conflictedPaths: readonly string[],
  ) => {
    const task = gitExplorerMergeConflictTask({
      source,
      branch,
      cwd: overview.selectedWorktreePath,
      conflictedPaths,
    });
    const metadata = makeTurnCommandMetadata();
    const started = await startTurn({
      environmentId: target.environmentId,
      input: buildProjectThreadStartTurnInput({
        ...metadata,
        projectId: target.input.projectId,
        projectCwd: overview.repositoryPath,
        text: task.prompt,
        titleText: task.title,
        uploadedAttachments: [],
        modelSelection: CONFLICT_AGENT_MODEL_SELECTION,
        runtimeMode: resolveProjectSettings(
          settings ?? DEFAULT_SERVER_SETTINGS,
          target.input.projectId,
        ).settings.defaultRuntimeMode,
        interactionMode: "default",
        workspaceMode: "local",
        // A submodule's branch is not the thread's; the prompt names the submodule path.
        branch: params.submodulePath ? null : branch,
        worktreePath: params.worktreePath ?? null,
        startFromOrigin: false,
        worktreeBranchName: "",
      }),
    });
    if (started._tag !== "Success") {
      Dialog.alert(
        "Merge stopped with conflicts",
        `An agent could not be started${
          isAtomCommandInterrupted(started)
            ? ""
            : `: ${describeGitFailure(squashAtomCommandFailure(started), "try again")}`
        }. The merge is still in progress; resolve it or run \`git merge --abort\`.`,
      );
      return;
    }
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(target.environmentId),
        threadId: metadata.threadId,
      }),
    );
  };

  const confirmMerge = (
    overview: GitExplorerOverviewResult,
    revision: string,
    reference?: GitExplorerRef,
  ) => {
    const branch = overview.headBranch;
    if (unavailable || !branch) return;
    const source = reference?.shortName ?? revision.slice(0, 12);
    Dialog.confirm({
      title: `Merge ${source} into ${branch}`,
      message: `${overview.selectedWorktreePath}\n\nCreates a merge commit, even when a fast-forward is possible. If the merge stops with conflicts, it stays in progress and an agent (Claude Opus 5.5, high effort) starts in a new thread to resolve them and commit the merge.`,
      confirmText: "Merge",
      onConfirm: () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setMerging(true);
        void run({
          ...target,
          input: {
            ...target.input,
            action: "merge",
            revision,
            ...(reference ? { mergeRef: reference.name } : {}),
            expectedHead: overview.headHash,
            expectedBranch: branch,
          },
        })
          .then(async (result) => {
            if (result._tag === "Success") {
              const { conflictedPaths } = result.value;
              if (conflictedPaths) await launchAgent(overview, source, branch, conflictedPaths);
            } else if (!isAtomCommandInterrupted(result)) {
              Dialog.alert(
                "Could not merge",
                describeGitFailure(squashAtomCommandFailure(result), "Refresh and try again."),
              );
            }
          })
          .finally(() => {
            inFlight.current = false;
            setMerging(false);
            onRefresh();
          });
      },
    });
  };

  return { mergeUnavailable: unavailable, confirmMerge, launchAgent };
}
