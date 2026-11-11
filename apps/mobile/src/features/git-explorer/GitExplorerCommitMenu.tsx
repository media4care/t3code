import { useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import { gitExplorerResetModes } from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { GitExplorerOverviewResult, GitExplorerRef } from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceEnvironments } from "../../state/workspace";
import type { GitExplorerTagRequest } from "./GitExplorerTagDialog";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerMerge } from "./useGitExplorerMerge";

export type GitExplorerCommitMenu = {
  readonly getActions: (hash: string, tags: readonly GitExplorerRef[]) => MenuAction[];
  readonly onAction: (hash: string, action: string) => void;
};

export function useGitExplorerCommitMenu(props: {
  params: GitExplorerParams;
  overview: GitExplorerOverviewResult | null | undefined;
  onRefresh: () => void;
}) {
  const target = gitExplorerTarget(props.params);
  const allowed = useAtomValue(
    gitExplorerEnvironment.runAction.permissionAtom(target.environmentId),
  );
  const connected = useWorkspaceEnvironments().some(
    (environment) =>
      environment.environmentId === target.environmentId &&
      environment.connectionState === "connected",
  );
  const run = useAtomCommand(gitExplorerEnvironment.runAction, { reportFailure: false });
  const merge = useGitExplorerMerge(props.params, props.onRefresh);
  const inFlight = useRef(false);
  const [resetting, setResetting] = useState(false);
  const [tagRequest, setTagRequest] = useState<GitExplorerTagRequest | null>(null);
  const { overview, onRefresh } = props;
  const unavailable = !allowed || !connected || !overview;
  const resetDisabled = unavailable || resetting || !overview?.headBranch;

  const getActions = (hash: string, tags: readonly GitExplorerRef[]): MenuAction[] => [
    { id: "copy-hash", title: "Copy commit hash", image: "doc.on.doc" },
    {
      id: "reset",
      title: `Reset ${overview?.headBranch ?? "current branch"} to this commit`,
      image: "arrow.uturn.backward",
      attributes: { disabled: resetDisabled || hash === overview?.headHash },
      subactions: gitExplorerResetModes.map((mode) => ({
        id: `reset:${mode.value}`,
        title: `${mode.label} reset…`,
        subtitle: mode.description,
        attributes: { destructive: mode.value === "hard" },
      })),
    },
    {
      id: "merge",
      title: `Merge into ${overview?.headBranch ?? "current branch"}…`,
      image: PullRequestGlyph.merged,
      attributes: {
        disabled:
          merge.mergeUnavailable ||
          resetting ||
          !overview?.headBranch ||
          hash === overview?.headHash,
      },
    },
    { id: "tag", title: "Add tag…", image: "tag", attributes: { disabled: unavailable } },
    ...tags.map((tag) => ({
      id: tag.name,
      title: tag.shortName,
      image: "tag",
      subactions: [
        {
          id: `push:${tag.shortName}`,
          title: "Push tag…",
          image: "arrow.up",
          attributes: { disabled: unavailable },
        },
        {
          id: `delete:${tag.shortName}`,
          title: "Delete local tag…",
          image: "trash",
          attributes: { disabled: unavailable, destructive: true },
        },
      ],
    })),
  ];

  const confirmReset = (revision: string, value: string) => {
    const mode = gitExplorerResetModes.find((option) => option.value === value);
    if (resetDisabled || !overview || !mode) return;
    Dialog.confirm({
      title: `Reset ${overview.headBranch} to ${revision.slice(0, 12)}`,
      message: `${overview.selectedWorktreePath}\n\n${mode.label}: ${mode.description}\n\nThis rewrites local branch history; the remote branch stays unchanged. Previous tip: ${overview.headHash?.slice(0, 12)} (recoverable through Git's reflog).${mode.value === "hard" ? " Discarded file changes cannot be recovered by undoing this reset." : ""}`,
      confirmText: `${mode.label} reset`,
      destructive: true,
      onConfirm: () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setResetting(true);
        void run({
          ...target,
          input: {
            ...target.input,
            action: "reset",
            revision,
            resetMode: mode.value,
            expectedHead: overview.headHash,
            expectedBranch: overview.headBranch,
          },
        })
          .then((result) => {
            if (result._tag !== "Success" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              Dialog.alert(
                "Could not reset branch",
                error instanceof Error ? error.message : "Refresh and try again.",
              );
            }
          })
          .finally(() => {
            inFlight.current = false;
            setResetting(false);
            onRefresh();
          });
      },
    });
  };

  const onAction = (hash: string, action: string) => {
    if (action === "copy-hash") {
      void Clipboard.setStringAsync(hash).catch(() => undefined);
    } else if (action.startsWith("reset:")) {
      confirmReset(hash, action.slice(6));
    } else if (action === "merge") {
      if (overview && !resetting) merge.confirmMerge(overview, hash);
    } else if (unavailable) {
      return;
    } else if (action === "tag") {
      setTagRequest({ action: "create", revision: hash, name: "" });
    } else if (action.startsWith("push:")) {
      setTagRequest({ action: "push", revision: hash, name: action.slice(5) });
    } else if (action.startsWith("delete:")) {
      setTagRequest({ action: "delete", revision: hash, name: action.slice(7) });
    }
  };

  return {
    menu: { getActions, onAction } satisfies GitExplorerCommitMenu,
    tagRequest,
    unavailable,
    closeTagDialog: () => setTagRequest(null),
  };
}
