import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CONFLICT_AGENT_MODEL_SELECTION } from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GitExplorerOverviewInput } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { newMessageId, newThreadId } from "~/lib/utils";
import { waitForThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { toastManager } from "../ui/toast";

/** Starts a thread in the conflicted checkout that resolves an in-progress merge. */
export function useGitExplorerConflictAgent(input: {
  readonly environmentId: EnvironmentId;
  readonly scope: GitExplorerOverviewInput;
}) {
  const navigate = useNavigate();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const runtimeMode = useEnvironmentSettings(
    input.environmentId,
    (settings) =>
      resolveProjectSettings(settings, input.scope.projectId).settings.defaultRuntimeMode,
  );

  return async (task: {
    readonly title: string;
    readonly prompt: string;
    branch: string | null;
  }) => {
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const started = await startTurn({
      environmentId: input.environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: task.prompt, attachments: [] },
        modelSelection: CONFLICT_AGENT_MODEL_SELECTION,
        titleSeed: task.title,
        runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: input.scope.projectId,
            title: task.title,
            modelSelection: CONFLICT_AGENT_MODEL_SELECTION,
            runtimeMode,
            interactionMode: "default",
            // A submodule's branch is not the thread's; the prompt names the submodule path.
            branch: input.scope.submodulePath ? null : task.branch,
            worktreePath: input.scope.worktreePath ?? null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (started._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not start an agent for the merge conflicts",
        description: isAtomCommandInterrupted(started)
          ? "The merge is still in progress. Resolve it or run `git merge --abort`."
          : readableFailure(
              squashAtomCommandFailure(started),
              "The merge is still in progress. Resolve it or run `git merge --abort`.",
            ),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: "An agent is resolving the merge conflicts",
      description: "It concludes the merge with a commit and does not push.",
    });
    const threadRef = scopeThreadRef(input.environmentId, threadId);
    if (await waitForThreadShell(threadRef)) {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
    }
  };
}
