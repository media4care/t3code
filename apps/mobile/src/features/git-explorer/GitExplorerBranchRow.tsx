import type { GitExplorerOverviewResult, GitExplorerRef } from "@t3tools/contracts";
import {
  formatGitExplorerSync,
  gitExplorerBranchDeletionBlock,
  gitExplorerUpstreamMergeSummary,
} from "@t3tools/client-runtime/git-explorer";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { useHoverGesture } from "../../lib/useHoverGesture";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useActiveGitQuery } from "./useActiveGitQuery";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";
import {
  describeBranchMerge,
  type useGitExplorerBranchActions,
} from "./useGitExplorerBranchActions";

function syncMark(ref: GitExplorerRef) {
  if (ref.kind !== "local") return null;
  if (ref.upstreamMissing) return "!";
  if (!ref.upstream) return "No upstream";
  if (ref.ahead === null || ref.behind === null) return "?";
  if (ref.ahead === 0 && ref.behind === 0) return "✓";
  return [ref.ahead > 0 ? `↑${ref.ahead}` : "", ref.behind > 0 ? `↓${ref.behind}` : ""]
    .filter(Boolean)
    .join(" ");
}

export function GitExplorerBranchRow(props: {
  readonly branch: GitExplorerRef;
  readonly displayName: string;
  readonly statusBranches?: readonly string[];
  readonly overview: GitExplorerOverviewResult;
  readonly params: GitExplorerParams;
  readonly active: boolean;
  readonly rowHeight: number;
  readonly selected: boolean;
  readonly onSelect: (revision: string) => void;
  readonly actions: ReturnType<typeof useGitExplorerBranchActions>;
  readonly selection?: {
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly onToggle: () => void;
  };
}) {
  const ref = props.branch;
  const target = gitExplorerTarget(props.params);
  const query = useActiveGitQuery(
    props.statusBranches
      ? gitExplorerEnvironment.branchStatuses({
          ...target,
          input: {
            ...target.input,
            snapshotId: props.overview.snapshotId,
            branches: props.statusBranches,
          },
        })
      : null,
    props.active,
  );
  const status = query.error
    ? null
    : (query.data?.branches.find(
        (status) => status.name === ref.name && status.hash === ref.hash,
      ) ?? null);
  const mergeDescription = query.error ? "Merge status unavailable" : describeBranchMerge(status);
  const statusDetail = [
    status?.mergeStatus === "unmerged"
      ? "No complete ancestry or patch-equivalence match was found; squashed or edited merges may not be recognized."
      : null,
    status?.targetRef?.startsWith("refs/remotes/") ? "Based on locally cached remote refs." : null,
  ]
    .filter(Boolean)
    .join(" ");
  const blockedReason =
    props.actions.unavailableReason ??
    (query.error
      ? "Refresh to retry the merge status check."
      : query.isPending
        ? "Wait for the merge status check."
        : gitExplorerBranchDeletionBlock(ref, status ?? undefined, true));
  const canDelete =
    !props.selection && ref.kind === "local" && blockedReason === null && status !== null;
  const requestDelete = () => {
    if (canDelete && status) props.actions.confirmDelete(ref, status);
  };
  const { hovered, hoverGesture } = useHoverGesture(ref.kind !== "local");
  const mark = syncMark(ref);
  const upstream = gitExplorerUpstreamMergeSummary(ref, status ?? undefined);
  const rowHeight = props.rowHeight + (ref.kind === "local" && ref.upstream ? 16 : 0);
  const current =
    ref.kind === "local" &&
    (ref.shortName === props.overview.headBranch || ref.name === props.overview.headBranch);
  const slash = props.displayName.lastIndexOf("/");
  const prefix = props.displayName.slice(0, slash + 1);
  const leaf = props.displayName.slice(slash + 1);
  const row = (
    <Pressable
      accessibilityRole={props.selection ? "checkbox" : "button"}
      accessibilityLabel={`${ref.shortName}. ${current ? "Currently checked out. " : ""}${ref.kind === "tag" ? "Tag" : ref.kind === "remote" ? "Remote-tracking branch" : `${formatGitExplorerSync(ref)}. Local branch: ${mergeDescription}. ${statusDetail} ${upstream.description}`}${ref.upstream ? `. Tracks ${ref.upstream}` : ""}${ref.kind === "local" && blockedReason ? `. ${blockedReason}` : ""}`}
      accessibilityHint={
        props.selection
          ? "Select this branch for deletion."
          : ref.kind === "local"
            ? "Long press for branch details and actions."
            : undefined
      }
      accessibilityState={
        props.selection
          ? { checked: props.selection.checked, disabled: props.selection.disabled }
          : { selected: props.selected, busy: props.actions.busyBranch === ref.name }
      }
      disabled={props.selection?.disabled}
      accessibilityActions={
        canDelete ? [{ name: "delete", label: "Delete local branch" }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") requestDelete();
      }}
      onPress={() => (props.selection ? props.selection.onToggle() : props.onSelect(ref.hash))}
      style={{ height: rowHeight }}
      className={cn(
        "flex-row items-center gap-1 px-3",
        (props.selection ? props.selection.checked : props.selected)
          ? "bg-primary/10"
          : hovered
            ? "bg-row-hover"
            : "bg-card",
      )}
    >
      {props.selection ? (
        <SymbolView
          name={props.selection.checked ? "checkmark.circle.fill" : "circle"}
          size={16}
          tintColorClassName="accent-primary-text"
        />
      ) : null}
      {current ? (
        <View
          style={{ width: 2, height: 14, top: (rowHeight - 14) / 2 }}
          className="absolute left-0 rounded-r-sm bg-primary"
        />
      ) : null}
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} ellipsizeMode="middle" className="text-[12px] leading-[16px]">
          {prefix ? <Text className="text-foreground-muted">{prefix}</Text> : null}
          <Text
            className={cn(
              "font-t3-medium",
              current ? "font-t3-semibold text-primary-text" : "text-foreground",
            )}
          >
            {leaf}
          </Text>
        </Text>
        {ref.kind === "local" && ref.upstream ? (
          <Text
            numberOfLines={1}
            className={cn(
              "text-[12px] leading-[16px]",
              upstream.mergeStatus === "merged" || upstream.mergeStatus === "equivalent"
                ? "text-adaptive-emerald-700-300"
                : "text-foreground-muted",
            )}
          >
            {upstream.label}
          </Text>
        ) : null}
      </View>
      {mark ? (
        <Text
          numberOfLines={1}
          style={{ width: 42, textAlign: "right" }}
          className={cn(
            "text-[10px] leading-[14px]",
            ref.upstreamMissing || (ref.behind ?? 0) > 0
              ? "text-warning-foreground"
              : (ref.ahead ?? 0) > 0
                ? "text-primary-text"
                : "text-foreground-muted",
          )}
        >
          {mark}
        </Text>
      ) : null}
      {ref.kind === "local" ? (
        <View style={{ width: 24, height: rowHeight }} className="items-center justify-center">
          {hovered && canDelete ? (
            <Pressable
              accessible={false}
              style={{ width: 24, height: rowHeight }}
              className="items-center justify-center"
              onPress={(event) => {
                event.stopPropagation();
                requestDelete();
              }}
            >
              <SymbolView name="trash" size={14} tintColorClassName="accent-danger-foreground" />
            </Pressable>
          ) : status?.mergeStatus === "merged" ? (
            <SymbolView
              name={PullRequestGlyph.merged}
              size={14}
              tintColorClassName="accent-adaptive-emerald-700-300"
            />
          ) : status?.mergeStatus === "unmerged" ? (
            <SymbolView
              name="arrow.triangle.branch"
              size={14}
              tintColorClassName="accent-icon-muted"
            />
          ) : (
            <Text
              className={cn(
                "text-[13px] leading-[16px]",
                status?.mergeStatus === "equivalent"
                  ? "text-adaptive-emerald-700-300"
                  : "text-foreground-muted",
              )}
            >
              {status?.mergeStatus === "equivalent" ? "≈" : query.isPending ? "·" : "?"}
            </Text>
          )}
        </View>
      ) : null}
    </Pressable>
  );
  if (ref.kind !== "local" || props.selection) return row;
  return (
    <GestureDetector gesture={hoverGesture}>
      <Menu
        title={ref.shortName}
        shouldOpenOnLongPress
        actions={[
          {
            id: "status",
            title: `Local branch: ${mergeDescription}`,
            subtitle: statusDetail,
            attributes: { disabled: true },
          },
          {
            id: "upstream-merge",
            title: upstream.label,
            subtitle: upstream.description,
            attributes: { disabled: true },
          },
          {
            id: "sync",
            title: formatGitExplorerSync(ref),
            ...(ref.upstream ? { subtitle: `Tracks ${ref.upstream}` } : {}),
            attributes: { disabled: true },
          },
          {
            id: "delete",
            title:
              props.actions.busyBranch === ref.name ? "Deleting branch…" : "Delete local branch",
            ...(blockedReason ? { subtitle: blockedReason } : {}),
            image: "trash",
            attributes: { destructive: true, disabled: !canDelete },
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === "delete") requestDelete();
        }}
      >
        {row}
      </Menu>
    </GestureDetector>
  );
}
