import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CONFLICT_AGENT_MODEL_SELECTION } from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { newMessageId, newThreadId } from "~/lib/utils";
import { waitForThreadShell } from "~/state/entities";
import { usePreparePullRequestThreadAction } from "~/state/sourceControlActions";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { toastManager } from "../ui/toast";
import { checkoutFailureDescription, readableFailure } from "./pullRequestDetail.logic";

/**
 * Checks the pull request out in its own worktree and starts a thread there that rebases it,
 * resolves conflicts and, where the repository allows, reviews and merges it unattended.
 */
export function usePullRequestRebaseLaunch(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly cwd: string | null;
}) {
  const navigate = useNavigate();
  const prepareThread = usePreparePullRequestThreadAction({
    environmentId: input.environmentId,
    cwd: input.cwd,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const runtimeMode = useEnvironmentSettings(
    input.environmentId,
    (settings) => resolveProjectSettings(settings, input.projectId).settings.defaultRuntimeMode,
  );
  const [launching, setLaunching] = useState(false);

  const launch = async (task: { readonly url: string; readonly title: string; prompt: string }) => {
    const { projectId } = input;
    if (launching || projectId === null || !prepareThread.isAllowed) return false;
    setLaunching(true);
    const toastId = toastManager.add({
      type: "loading",
      title: "Handing the rebase to an agent...",
    });
    const fail = (title: string, description?: string) => {
      setLaunching(false);
      toastManager.update(toastId, {
        type: "error",
        title,
        ...(description ? { description } : {}),
      });
      return false;
    };
    const threadId = newThreadId();
    const prepared = await prepareThread.run({ reference: task.url, mode: "worktree", threadId });
    if (prepared._tag === "Failure") {
      return fail(
        "Could not check out the branch to rebase",
        checkoutFailureDescription(
          isAtomCommandInterrupted(prepared) ? undefined : squashAtomCommandFailure(prepared),
        ),
      );
    }
    const createdAt = new Date().toISOString();
    const started = await startThreadTurn({
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
            projectId,
            title: task.title,
            modelSelection: CONFLICT_AGENT_MODEL_SELECTION,
            runtimeMode,
            interactionMode: "default",
            branch: prepared.value.branch,
            worktreePath: prepared.value.worktreePath,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (started._tag === "Failure") {
      return fail(
        "Could not start the rebase thread",
        isAtomCommandInterrupted(started)
          ? undefined
          : readableFailure(squashAtomCommandFailure(started), "Try again from the pull request."),
      );
    }
    setLaunching(false);
    toastManager.update(toastId, {
      type: "success",
      title: "An agent is rebasing this branch",
      description: "It resolves the conflicts, reviews the result and merges when it is clean.",
    });
    const threadRef = scopeThreadRef(input.environmentId, threadId);
    if (await waitForThreadShell(threadRef)) {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
    }
    return true;
  };

  return { launching, available: prepareThread.isAllowed, launch };
}
