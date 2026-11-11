import {
  GIT_EXPLORER_COLORS,
  gitExplorerReferenceColors,
} from "@t3tools/client-runtime/git-explorer-colors";
import { memo, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { layoutGitGraph, type GitGraphRow } from "@t3tools/client-runtime/git-explorer";
import type {
  GitExplorerCommit,
  GitExplorerOverviewResult,
  GitExplorerRef,
} from "@t3tools/contracts";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import type { GitExplorerCommitMenu } from "./GitExplorerCommitMenu";

const COLORS = GIT_EXPLORER_COLORS.map((color) => color.value);
const STATUS_LABELS = {
  "local-only": "Ahead of upstream",
  "upstream-only": "Upstream only",
  shared: "In upstream",
  other: "Other branch",
  unknown: "Upstream membership unknown",
} as const;
const EMPTY_REFS: readonly GitExplorerRef[] = [];

const GraphCommit = memo(function GraphCommit(props: {
  readonly commit: GitExplorerCommit;
  readonly graph: GitGraphRow;
  readonly graphWidth: number;
  readonly rowHeight: number;
  readonly tablet: boolean;
  readonly refs: readonly GitExplorerRef[];
  readonly refColors: ReadonlyMap<string, number>;
  readonly worktrees: string;
  readonly isHead: boolean;
  readonly headBranch: string | null;
  readonly selected: boolean;
  readonly onSelect: (hash: string) => void;
  readonly menu: GitExplorerCommitMenu;
}) {
  const { graph, commit, rowHeight, menu } = props;
  const preferredBranch =
    props.refs.find(
      (ref) =>
        ref.kind === "local" &&
        (ref.name === props.headBranch || ref.shortName === props.headBranch),
    ) ??
    props.refs.find((ref) => ref.kind === "local") ??
    props.refs.find((ref) => ref.kind === "remote");
  const tag = props.refs.find((ref) => ref.kind === "tag");
  const visibleRefs = preferredBranch
    ? tag
      ? [preferredBranch, tag]
      : [preferredBranch, ...props.refs.filter((ref) => ref !== preferredBranch)].slice(0, 2)
    : props.refs.slice(0, 2);
  const x = (lane: number) => 10 + lane * 14;
  const nodeY = props.tablet ? rowHeight / 2 : 11;
  const direction =
    commit.upstreamStatus === "local-only"
      ? "↑"
      : commit.upstreamStatus === "upstream-only"
        ? "↓"
        : "";
  return (
    <Menu
      shouldOpenOnLongPress
      title={`${commit.hash.slice(0, 7)} · ${commit.subject || "(No commit message)"}`}
      actions={menu.getActions(commit.hash, props.refs)}
      onPressAction={({ nativeEvent }) => menu.onAction(commit.hash, nativeEvent.event, props.refs)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Touch and hold for commit actions."
        accessibilityLabel={`${props.isHead ? "HEAD. " : ""}${commit.subject}. ${commit.hash.slice(0, 8)}. ${commit.authorName}. ${props.refs.map((ref) => `${ref.kind === "tag" ? "Tag " : ""}${ref.shortName}`).join(", ")}. ${props.worktrees}. ${STATUS_LABELS[commit.upstreamStatus]}`}
        accessibilityState={{ selected: props.selected }}
        onPress={() => props.onSelect(commit.hash)}
        style={{ height: rowHeight }}
        className={cn(
          "flex-row items-center px-1",
          props.selected ? "bg-primary/10" : "bg-sheet-solid",
        )}
      >
        <Svg width={props.graphWidth} height={rowHeight} accessible={false}>
          {graph.lines.map((line) => {
            const startY = line.kind === "parent" ? nodeY : 0;
            const endY = line.kind === "incoming" ? nodeY : rowHeight;
            const midY = (startY + endY) / 2;
            return (
              <Path
                key={`${line.kind}:${line.from}:${line.to}`}
                d={`M ${x(line.from)} ${startY} C ${x(line.from)} ${midY} ${x(line.to)} ${midY} ${x(line.to)} ${endY}`}
                stroke={COLORS[line.color % COLORS.length]}
                strokeWidth={1.6}
                fill="none"
              />
            );
          })}
          <Circle
            cx={x(graph.column)}
            cy={nodeY}
            r={props.isHead ? 4.5 : 3.3}
            fill={COLORS[graph.color % COLORS.length]}
          />
          {props.isHead ? <Circle cx={x(graph.column)} cy={nodeY} r={1.5} fill="#ffffff" /> : null}
        </Svg>
        <View className="min-w-0 flex-1 justify-center pl-1">
          <View className="h-[18px] min-w-0 flex-row items-center gap-1">
            {props.refs.length > 0 || props.isHead ? (
              <View
                style={{ maxWidth: "50%" }}
                className="h-[18px] shrink flex-row items-center gap-1 overflow-hidden"
              >
                {props.isHead ? (
                  <View className="h-[18px] justify-center rounded border border-border bg-subtle-strong px-1">
                    <Text className="text-[12px] leading-[14px] text-foreground">HEAD</Text>
                  </View>
                ) : null}
                {visibleRefs.map((ref) => {
                  const color = COLORS[(props.refColors.get(ref.hash) ?? 0) % COLORS.length]!;
                  return (
                    <View
                      key={ref.name}
                      // 16% alpha keeps the label readable in both themes.
                      style={{ borderColor: color, backgroundColor: `${color}29` }}
                      className="h-[18px] min-w-0 shrink flex-row items-center gap-1 rounded border px-1"
                    >
                      <SymbolView
                        name={ref.kind === "tag" ? "tag" : "arrow.triangle.branch"}
                        size={10}
                        tintColor={color}
                      />
                      <Text
                        numberOfLines={1}
                        className={cn(
                          "min-w-0 shrink text-[12px] leading-[14px] text-foreground",
                          ref.kind === "local" &&
                            (ref.name === props.headBranch || ref.shortName === props.headBranch)
                            ? "font-t3-bold"
                            : ref === preferredBranch && "font-t3-semibold",
                        )}
                      >
                        {ref.shortName}
                      </Text>
                    </View>
                  );
                })}
                {props.refs.length > visibleRefs.length ? (
                  <View className="h-[18px] justify-center rounded border border-border bg-subtle-strong px-1">
                    <Text className="text-[12px] leading-[14px] text-foreground">
                      +{props.refs.length - visibleRefs.length}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text
              numberOfLines={1}
              className="min-w-0 flex-1 text-[12px] leading-[14px] text-foreground"
            >
              {commit.subject || "(No commit message)"}
            </Text>
            {direction ? (
              <Text className="pr-1 text-[12px] leading-[14px] font-t3-semibold text-primary-text">
                {direction}
              </Text>
            ) : null}
            {props.worktrees ? (
              <Text className="pr-1 text-[10px] leading-[14px] text-foreground-muted">WT</Text>
            ) : null}
          </View>
          {!props.tablet ? (
            <Text
              numberOfLines={1}
              className="mt-[2px] text-[10px] leading-[12px] text-foreground-muted"
            >
              {commit.hash.slice(0, 7)} · {commit.authorName} ·{" "}
              {new Date(commit.committedAt).toLocaleDateString()}
            </Text>
          ) : null}
        </View>
        {props.tablet ? (
          <>
            <Text
              numberOfLines={1}
              style={{ width: 67 }}
              className="pl-2 font-mono text-[11px] leading-[14px] text-foreground-muted"
            >
              {commit.hash.slice(0, 7)}
            </Text>
            <Text
              numberOfLines={1}
              style={{ width: 106 }}
              className="pl-2 text-[11px] leading-[14px] text-foreground-muted"
            >
              {commit.authorName}
            </Text>
            <Text
              numberOfLines={1}
              style={{ width: 64 }}
              className="px-2 text-[11px] leading-[14px] text-foreground-muted"
            >
              {new Date(commit.committedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </Text>
          </>
        ) : null}
      </Pressable>
    </Menu>
  );
});

export function GitExplorerGraph(props: {
  readonly commits: readonly GitExplorerCommit[];
  readonly overview: GitExplorerOverviewResult;
  readonly selectedRevision: string | null;
  readonly onSelect: (revision: string | null) => void;
  readonly canLoadMore: boolean;
  readonly loadMore: () => void;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onRefresh: () => void;
  readonly tablet: boolean;
  readonly menu: GitExplorerCommitMenu;
}) {
  const rowHeight = props.tablet ? 22 : 34;
  const refColors = useMemo(
    () => gitExplorerReferenceColors(props.overview.refs),
    [props.overview.refs],
  );
  const layout = useMemo(
    () => layoutGitGraph(props.commits, [], new Set(), refColors),
    [props.commits, refColors],
  );
  const laneCount = layout.rows.reduce((max, row) => Math.max(max, row.laneCount), 1);
  const graphWidth = Math.max(props.tablet ? 58 : 30, laneCount * 14 + 6);
  const [viewportWidth, setViewportWidth] = useState(320);
  const contentWidth = Math.max(viewportWidth, graphWidth + (props.tablet ? 470 : 230));
  const refs = useMemo(() => {
    const map = new Map<string, GitExplorerRef[]>();
    for (const ref of props.overview.refs) {
      const labels = map.get(ref.hash) ?? [];
      labels.push(ref);
      map.set(ref.hash, labels);
    }
    return map;
  }, [props.overview.refs]);
  const worktrees = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const worktree of props.overview.worktrees) {
      if (!worktree.headHash || worktree.path === props.overview.selectedWorktreePath) continue;
      const labels = map.get(worktree.headHash) ?? [];
      labels.push(worktree.path);
      map.set(worktree.headHash, labels);
    }
    return map;
  }, [props.overview]);
  return (
    <View className="flex-1" onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
      <ScrollView horizontal className="flex-1" contentContainerStyle={{ width: contentWidth }}>
        <View style={{ width: contentWidth, flex: 1 }}>
          {props.tablet ? (
            <View
              style={{ height: 24 }}
              className="flex-row items-center border-b border-border bg-card px-1"
            >
              <Text
                style={{ width: graphWidth }}
                className="pl-1 text-[11px] leading-[14px] font-t3-semibold text-foreground-muted"
              >
                Graph
              </Text>
              <Text className="min-w-0 flex-1 pl-1 text-[11px] leading-[14px] font-t3-semibold text-foreground-muted">
                Description
              </Text>
              <Text
                style={{ width: 67 }}
                className="pl-2 text-[11px] leading-[14px] font-t3-semibold text-foreground-muted"
              >
                Commit
              </Text>
              <Text
                style={{ width: 106 }}
                className="pl-2 text-[11px] leading-[14px] font-t3-semibold text-foreground-muted"
              >
                Author
              </Text>
              <Text
                style={{ width: 64 }}
                className="px-2 text-[11px] leading-[14px] font-t3-semibold text-foreground-muted"
              >
                Date
              </Text>
            </View>
          ) : null}
          <FlatList
            key={String(rowHeight)}
            data={props.commits}
            keyExtractor={(item) => item.hash}
            initialNumToRender={24}
            maxToRenderPerBatch={24}
            windowSize={7}
            getItemLayout={(_, index) => ({
              length: rowHeight,
              offset: rowHeight * (index + 1),
              index,
            })}
            contentInsetAdjustmentBehavior="never"
            extraData={[props.selectedRevision, refs, layout]}
            ListHeaderComponent={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Working Tree, staged, unstaged and untracked changes"
                accessibilityState={{ selected: props.selectedRevision === null }}
                onPress={() => props.onSelect(null)}
                style={{ height: rowHeight }}
                className={cn(
                  "flex-row items-center border-b border-border px-1",
                  props.selectedRevision === null ? "bg-primary/10" : "bg-card",
                )}
              >
                <View style={{ width: graphWidth }}>
                  <View className="ml-[5px] size-2.5 rounded-full border border-foreground-muted" />
                </View>
                <Text className="pl-1 text-[12px] leading-[14px] font-t3-semibold text-foreground">
                  Working Tree
                </Text>
                <Text className="ml-2 text-[11px] leading-[14px] text-foreground-muted">
                  Uncommitted changes
                </Text>
              </Pressable>
            }
            renderItem={({ item, index }) => {
              const graph = layout.rows[index];
              return graph ? (
                <GraphCommit
                  commit={item}
                  graph={graph}
                  graphWidth={graphWidth}
                  rowHeight={rowHeight}
                  tablet={props.tablet}
                  refs={refs.get(item.hash) ?? EMPTY_REFS}
                  refColors={refColors}
                  worktrees={(worktrees.get(item.hash) ?? []).join(", ")}
                  isHead={item.hash === props.overview.headHash}
                  headBranch={props.overview.headBranch}
                  selected={props.selectedRevision === item.hash}
                  onSelect={props.onSelect}
                  menu={props.menu}
                />
              ) : null;
            }}
            onEndReached={() => {
              if (!props.error) props.loadMore();
            }}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={
              !props.pending ? (
                <Text className="px-3 py-2 text-xs text-foreground-muted">
                  No commits in this repository yet.
                </Text>
              ) : undefined
            }
            ListFooterComponent={
              <View className="items-center gap-2 px-3 py-2">
                {props.error ? (
                  <>
                    <Text className="text-xs text-danger-foreground">{props.error}</Text>
                    <Button label="Refresh history" onPress={props.onRefresh} />
                  </>
                ) : props.pending ? (
                  <AppActivityIndicator />
                ) : props.canLoadMore ? (
                  <Button label="Load more commits" onPress={props.loadMore} />
                ) : (
                  <Text className="text-[10px] text-foreground-muted">End of history</Text>
                )}
              </View>
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}
