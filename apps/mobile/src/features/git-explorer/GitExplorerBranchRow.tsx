import { GIT_EXPLORER_COLORS } from "@t3tools/client-runtime/git-explorer-colors";
import type { GitExplorerOverviewResult, GitExplorerRef } from "@t3tools/contracts";
import {
  formatGitExplorerSync,
  gitExplorerBranchDeletionBlock,
  gitExplorerUpstreamMergeSummary,
} from "@t3tools/client-runtime/git-explorer";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { useHoverGesture } from "../../lib/useHoverGesture";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import {
  THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE,
  THREAD_LIST_V2_SIDEBAR_ROW_STYLE,
  selectedThreadRowColors,
} from "../threads/thread-list-v2-row-appearance";
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
  readonly color: number;
  readonly branch: GitExplorerRef;
  readonly displayName: string;
  readonly depth?: number;
  readonly statusBranches?: readonly string[];
  readonly overview: GitExplorerOverviewResult;
  readonly params: GitExplorerParams;
  readonly active: boolean;
  readonly rowHeight: number;
  /** Styled like the thread and pull request lists, for the workspace list column. */
  readonly sidebar?: boolean;
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
  const color = GIT_EXPLORER_COLORS[props.color % GIT_EXPLORER_COLORS.length]!.value;
  const slash = props.displayName.lastIndexOf("/");
  const prefix = props.displayName.slice(0, slash + 1);
  const leaf = props.displayName.slice(slash + 1);
  const sidebar = props.sidebar === true;
  const highlighted = props.selection ? props.selection.checked : props.selected;
  const foreground =
    sidebar && highlighted
      ? selectedThreadRowColors.foregroundClassName
      : sidebar
        ? "text-drawer-foreground"
        : "text-foreground";
  const mutedForeground =
    sidebar && highlighted
      ? selectedThreadRowColors.mutedForegroundClassName
      : sidebar
        ? "text-drawer-foreground-muted"
        : "text-foreground-muted";
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
      style={[
        sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : { height: rowHeight },
        { paddingLeft: 12 + (props.depth ?? 0) * 14 },
      ]}
      className={cn(
        "flex-row items-center",
        sidebar ? "gap-2" : "gap-1 pr-3",
        sidebar
          ? highlighted
            ? "bg-thread-selected"
            : hovered
              ? "bg-thread-hover"
              : "bg-drawer active:bg-thread-hover"
          : highlighted
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
      {!props.selection ? (
        <View style={{ width: 14, height: 14 }} className="items-center justify-center">
          <View
            style={
              current
                ? {
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    borderWidth: 1.5,
                    borderColor: color,
                    alignItems: "center",
                    justifyContent: "center",
                  }
                : undefined
            }
          >
            <View
              style={{
                width: current ? 7 : 6,
                height: current ? 7 : 6,
                borderRadius: 3.5,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      ) : null}
      {current && !sidebar ? (
        <View
          style={{ width: 2, height: 14, top: (rowHeight - 14) / 2 }}
          className="absolute left-0 rounded-r-sm bg-primary"
        />
      ) : null}
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          className={sidebar ? "text-base" : "text-[12px] leading-[16px]"}
        >
          {prefix ? <Text className={mutedForeground}>{prefix}</Text> : null}
          <Text className={cn(current ? "font-t3-bold" : "font-t3-medium", foreground)}>
            {leaf}
          </Text>
        </Text>
        {ref.kind === "local" && ref.upstream ? (
          <Text
            numberOfLines={1}
            className={cn(
              sidebar ? "text-xs" : "text-[12px] leading-[16px]",
              upstream.mergeStatus === "merged" || upstream.mergeStatus === "equivalent"
                ? "text-adaptive-emerald-700-300"
                : mutedForeground,
            )}
          >
            {upstream.label}
          </Text>
        ) : null}
      </View>
      {mark ? (
        <Text
          numberOfLines={1}
          style={{ width: sidebar ? 52 : 42, textAlign: "right" }}
          className={cn(
            sidebar ? "text-2xs tabular-nums" : "text-[10px] leading-[14px]",
            ref.upstreamMissing || (ref.behind ?? 0) > 0
              ? "text-warning-foreground"
              : (ref.ahead ?? 0) > 0
                ? "text-primary-text"
                : mutedForeground,
          )}
        >
          {mark}
        </Text>
      ) : null}
      {ref.kind === "local" ? (
        <View
          style={{ width: 24, height: sidebar ? undefined : rowHeight }}
          className="items-center justify-center"
        >
          {hovered && canDelete ? (
            <Pressable
              accessible={false}
              style={{ width: 24, height: sidebar ? 24 : rowHeight }}
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
                  : mutedForeground,
              )}
            >
              {status?.mergeStatus === "equivalent" ? "≈" : query.isPending ? "·" : "?"}
            </Text>
          )}
        </View>
      ) : null}
    </Pressable>
  );
  const container = (content: ReactNode) =>
    sidebar ? <View style={THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE}>{content}</View> : content;
  if (ref.kind !== "local" || props.selection) return container(row);
  return container(
    <GestureDetector gesture={hoverGesture}>
      <Menu
        title={ref.shortName}
        shouldOpenOnLongPress
        actions={[
          {
            id: "switch",
            title: "Switch to branch",
            attributes: { disabled: current || props.actions.switchUnavailable !== null },
          },
          {
            id: "merge",
            title: `Merge into ${props.overview.headBranch ?? "current branch"}…`,
            attributes: {
              disabled: current || !props.overview.headBranch || props.actions.mergeUnavailable,
            },
          },
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
          if (nativeEvent.event === "switch") props.actions.confirmSwitch(ref, props.overview);
          if (nativeEvent.event === "merge")
            props.actions.confirmMerge(props.overview, ref.hash, ref);
          if (nativeEvent.event === "delete") requestDelete();
        }}
      >
        {row}
      </Menu>
    </GestureDetector>,
  );
}
