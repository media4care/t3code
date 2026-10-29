import { useCallback, useState } from "react";
import { FlatList, Platform, Pressable, View } from "react-native";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { formatGitExplorerSync } from "@t3tools/client-runtime/git-explorer";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { useProject, useProjects } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { GitExplorerBranches } from "./GitExplorerBranches";
import { GitExplorerGraph } from "./GitExplorerGraph";
import { GitExplorerChanges } from "./GitExplorerChanges";
import { GitExplorerSyncControls } from "./GitExplorerSyncControls";
import { useGitExplorer, type GitExplorerParams } from "./useGitExplorer";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

export function GitRepositoriesScreen(props: { readonly workspace?: boolean }) {
  const navigation = useNavigation();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  return (
    <>
      {props.workspace && Platform.OS === "ios" ? null : (
        <AppBar
          title="Git Explorer"
          subtitle="Choose a repository"
          sidebar={!props.workspace}
          onBack={props.workspace ? undefined : () => navigation.goBack()}
        />
      )}
      <ScreenContent>
        <FlatList
          data={projects}
          keyExtractor={(item) => JSON.stringify([item.environmentId, item.id])}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingBottom: props.workspace
              ? Math.max(insets.bottom, workspace?.bottomClearance ?? 0)
              : insets.bottom,
          }}
          ListEmptyComponent={
            <EmptyState
              variant="plain"
              title="No projects available"
              detail="Connect an environment and add a project to explore its repository."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Explore Git history for ${item.title}`}
              className="min-h-20 gap-1 border-b border-border-subtle px-5 py-4"
              onPress={() =>
                navigation.navigate("GitExplorer", {
                  environmentId: item.environmentId,
                  projectId: item.id,
                })
              }
            >
              <Text className="font-t3-semibold text-foreground">{item.title}</Text>
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                {savedConnectionsById[item.environmentId]?.environmentLabel ?? "Environment"} ·{" "}
                {item.workspaceRoot}
              </Text>
            </Pressable>
          )}
        />
      </ScreenContent>
    </>
  );
}

export function GitExplorerScreen(props: StaticScreenProps<GitExplorerParams>) {
  const routeScope = JSON.stringify(props.route.params);
  const [selection, setSelection] = useState({
    routeScope,
    worktreePath: props.route.params.worktreePath,
  });
  const worktreePath =
    selection.routeScope === routeScope ? selection.worktreePath : props.route.params.worktreePath;
  const scopeKey = JSON.stringify([
    props.route.params.environmentId,
    props.route.params.projectId,
    worktreePath,
  ]);
  return (
    <GitExplorerRepository
      key={scopeKey}
      params={{ ...props.route.params, worktreePath }}
      onWorktreeChange={(path) => setSelection({ routeScope, worktreePath: path })}
    />
  );
}

function GitExplorerRepository(props: {
  readonly params: GitExplorerParams;
  readonly onWorktreeChange: (path: string) => void;
}) {
  const navigation = useNavigation();
  const { params } = props;
  const project = useProject({
    environmentId: EnvironmentId.make(params.environmentId),
    projectId: ProjectId.make(params.projectId),
  });
  const explorer = useGitExplorer(params);
  const overview = explorer.overview.data;
  const [width, setWidth] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [branchesVisible, setBranchesVisible] = useState(false);
  const split = width >= 700;
  const branchRail = width >= 850;
  const insets = useSafeAreaInsets();
  const columnMetrics = useNativeColumnLayoutMetrics();
  const safeArea = columnMetrics?.safeArea ?? insets;
  const selectRevision = useCallback((revision: string | null) => {
    setSelectedRevision(revision);
    setReviewVisible(true);
  }, []);
  const currentBranch = overview?.refs.find(
    (ref) =>
      ref.kind === "local" &&
      (ref.name === overview.headBranch || ref.shortName === overview.headBranch),
  );
  const worktreeName = overview?.selectedWorktreePath.split("/").at(-1);
  return (
    <>
      <AppBar
        title="Git Explorer"
        subtitle={project?.title ?? "Repository"}
        onBack={() => navigation.goBack()}
        actions={[
          {
            accessibilityLabel: "Refresh Git Explorer",
            icon: "arrow.clockwise",
            onPress: explorer.refresh,
            disabled: explorer.overview.isPending,
          },
        ]}
        menus={
          overview
            ? [
                {
                  title: "Review worktree",
                  icon: "point.topleft.down.curvedto.point.bottomright.up",
                  items: overview.worktrees
                    .filter((worktree) => !worktree.bare)
                    .map((worktree) => ({
                      id: worktree.path,
                      title: worktree.branch?.replace(/^refs\/heads\//, "") ?? "Detached HEAD",
                      subtitle: worktree.path,
                      selected: worktree.path === overview.selectedWorktreePath,
                      onPress: () => props.onWorktreeChange(worktree.path),
                    })),
                },
              ]
            : []
        }
      />
      <ScreenContent>
        <View
          className="flex-1 bg-sheet-solid"
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{
            paddingTop: Platform.OS === "ios" ? safeArea.top : 0,
            paddingBottom: safeArea.bottom,
          }}
        >
          {explorer.overview.error ? (
            <EmptyState
              variant="plain"
              title="Could not open Git Explorer"
              detail={explorer.overview.error}
              actionLabel="Retry"
              onAction={explorer.refresh}
            />
          ) : null}
          {!overview && explorer.overview.isPending ? (
            <View className="p-8">
              <AppActivityIndicator />
            </View>
          ) : null}
          {overview ? (
            <>
              <View className="border-b border-border px-3 py-1">
                <Pressable
                  disabled={branchRail}
                  accessibilityRole={branchRail ? undefined : "button"}
                  accessibilityLabel={`${branchesVisible ? "Hide" : "Show"} branches, remotes, tags and stashes. Current branch ${overview.headBranch ?? "Detached HEAD"}, ${currentBranch ? formatGitExplorerSync(currentBranch) : "No upstream comparison"}`}
                  accessibilityState={{ expanded: branchRail || branchesVisible }}
                  onPress={() => setBranchesVisible((visible) => !visible)}
                  className="min-h-9 flex-row items-center gap-2"
                  hitSlop={{ top: 4, bottom: 4 }}
                >
                  <Text
                    numberOfLines={1}
                    className="min-w-0 shrink text-xs font-t3-semibold text-foreground"
                  >
                    {overview.headBranch?.replace(/^refs\/heads\//, "") ?? "Detached HEAD"}
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="min-w-0 flex-1 text-[11px] leading-[14px] text-foreground-muted"
                  >
                    {currentBranch ? formatGitExplorerSync(currentBranch) : "No upstream"}
                  </Text>
                  {!branchRail ? (
                    <Text className="text-[11px] leading-[14px] text-primary-text">
                      Browse {branchesVisible ? "▴" : "▾"}
                    </Text>
                  ) : null}
                </Pressable>
                <Text
                  numberOfLines={1}
                  accessibilityLabel={`Selected worktree ${overview.selectedWorktreePath}. HEAD ${overview.headHash ?? "unborn"}. ${overview.lastFetchAt ? `Last recorded fetch ${new Date(overview.lastFetchAt).toLocaleString()}` : "Last fetch time unknown"}. Remote tracking refs may be stale; refresh reads local Git only.`}
                  className="pb-1 text-[11px] leading-[14px] text-foreground-muted"
                >
                  {worktreeName} · {overview.headHash?.slice(0, 7) ?? "unborn"} ·{" "}
                  {overview.lastFetchAt
                    ? `Fetched ${new Date(overview.lastFetchAt).toLocaleDateString()}`
                    : "Fetch unknown"}{" "}
                  · local refs
                </Text>
                <GitExplorerSyncControls
                  params={params}
                  overview={overview}
                  onRefresh={explorer.refresh}
                />
              </View>
              {!branchRail && branchesVisible ? (
                <View style={{ height: 240 }} className="border-b border-border bg-card">
                  <GitExplorerBranches
                    overview={overview}
                    params={params}
                    active={explorer.active}
                    onRefresh={explorer.refresh}
                    selectedRevision={selectedRevision}
                    tablet={split}
                    onSelect={(hash) => {
                      selectRevision(hash);
                      setBranchesVisible(false);
                    }}
                  />
                </View>
              ) : null}
              <View className="min-h-0 flex-1 flex-row">
                {branchRail ? (
                  <View style={{ width: 190 }} className="border-r border-border bg-card">
                    <GitExplorerBranches
                      overview={overview}
                      params={params}
                      active={explorer.active}
                      onRefresh={explorer.refresh}
                      selectedRevision={selectedRevision}
                      tablet
                      onSelect={selectRevision}
                    />
                  </View>
                ) : null}
                <View className="min-h-0 min-w-0 flex-1">
                  {split || !reviewVisible ? (
                    <View style={{ flex: split ? 1.15 : 1, minHeight: split ? 140 : undefined }}>
                      <GitExplorerGraph
                        commits={explorer.commits}
                        overview={overview}
                        selectedRevision={selectedRevision}
                        onSelect={selectRevision}
                        canLoadMore={explorer.canLoadMore}
                        loadMore={explorer.loadMore}
                        pending={explorer.history.isPending}
                        error={explorer.history.error}
                        onRefresh={explorer.refresh}
                        tablet={split}
                      />
                    </View>
                  ) : null}
                  {split || reviewVisible ? (
                    <View className="min-h-0 flex-1 border-t border-border">
                      <GitExplorerChanges
                        key={selectedRevision ?? "working-tree"}
                        params={params}
                        overview={overview}
                        revision={selectedRevision}
                        split={split}
                        active={explorer.active}
                        onBack={() => setReviewVisible(false)}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            </>
          ) : null}
        </View>
      </ScreenContent>
    </>
  );
}
