import { useAtomValue } from "@effect/atom-react";
import { gitExplorerResetModes } from "@t3tools/client-runtime/git-explorer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { GitExplorerOverviewResult } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

export function GitExplorerResetControls(props: {
  params: GitExplorerParams;
  overview: GitExplorerOverviewResult;
  selectedRevision: string | null;
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
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const disabled =
    !allowed || !connected || pending || !props.selectedRevision || !props.overview.headBranch;
  return (
    <Menu
      title="Reset branch to selected commit"
      accessibilityRole="button"
      accessibilityLabel={`Reset ${props.overview.headBranch ?? "current branch"} to selected commit`}
      actions={gitExplorerResetModes.map((mode) => ({
        id: mode.value,
        title: `${mode.label} reset…`,
        attributes: { disabled, destructive: mode.value === "hard" },
      }))}
      onPressAction={({ nativeEvent }) => {
        const mode = gitExplorerResetModes.find((option) => option.value === nativeEvent.event);
        const revision = props.selectedRevision;
        const overview = props.overview;
        if (disabled || !mode || !revision) return;
        Dialog.confirm({
          title: `Reset ${overview.headBranch} to ${revision.slice(0, 12)}`,
          message: `${overview.selectedWorktreePath}\n\n${mode.label}: ${mode.description}\n\nThis rewrites local branch history; the remote branch stays unchanged. Previous tip: ${overview.headHash?.slice(0, 12)} (recoverable through Git's reflog).${mode.value === "hard" ? " Discarded file changes cannot be recovered by undoing this reset." : ""}`,
          confirmText: `${mode.label} reset`,
          destructive: true,
          onConfirm: () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setPending(true);
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
                setPending(false);
                props.onRefresh();
              });
          },
        });
      }}
    >
      <Button
        label="Reset branch…"
        tone="text"
        disabled={disabled}
        loading={pending}
        onPress={() => {}}
      />
    </Menu>
  );
}
