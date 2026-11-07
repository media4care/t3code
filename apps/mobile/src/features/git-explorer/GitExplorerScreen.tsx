import { use, useContext, useState } from "react";
import { FlatList, Platform, Pressable, View } from "react-native";
import { RegistryContext } from "@effect/atom-react";
import {
  CommonActions,
  StackActions,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { formatGitExplorerSync } from "@t3tools/client-runtime/git-explorer";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useProject, useProjects } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { GitExplorerBranches } from "./GitExplorerBranches";
import { GitExplorerGraph } from "./GitExplorerGraph";
import { GitExplorerChanges } from "./GitExplorerChanges";
import { GitExplorerSyncControls } from "./GitExplorerSyncControls";
import { useGitExplorerCommitMenu } from "./GitExplorerCommitMenu";
import { GitExplorerTagDialog } from "./GitExplorerTagDialog";
import { useActiveGitQuery, useAppForeground } from "./useActiveGitQuery";
import { gitExplorerTarget, useGitExplorer, type GitExplorerParams } from "./useGitExplorer";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE,
  THREAD_LIST_V2_SIDEBAR_ROW_STYLE,
} from "../threads/thread-list-v2-row-appearance";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";

type GitExplorerRouteParams = GitExplorerParams & { readonly revision?: string | undefined };

function readRouteParams(params: object | undefined): GitExplorerRouteParams | null {
  if (!params || !("environmentId" in params) || !("projectId" in params)) return null;
  const { environmentId, projectId } = params;
  if (typeof environmentId !== "string" || typeof projectId !== "string") return null;
  const optional = (key: "worktreePath" | "submodulePath" | "revision") => {
    const value: unknown = key in params ? params[key as keyof typeof params] : undefined;
    return typeof value === "string" ? { [key]: value } : {};
  };
  return {
    environmentId,
    projectId,
    ...optional("worktreePath"),
    ...optional("submodulePath"),
    ...optional("revision"),
  };
}

/** On iPad the workspace list column carries the open repository's branches, like the thread list. */
function useBranchesInListColumn() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs();
  return (
    Platform.OS === "ios" && layout.usesSplitView && workspace?.state.selectedTab === "gitExplorer"
  );
}

export function GitRepositoriesScreen(props: { readonly workspace?: boolean }) {
  const navigation = useNavigation();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  const primaryColumn = use(NativePrimaryColumnContext);
  const branchesInListColumn = useBranchesInListColumn();
  const openRoute = primaryColumn?.gitExplorerRoute;
  const openParams = openRoute ? readRouteParams(openRoute.params) : null;
  if (props.workspace && branchesInListColumn && openRoute && openParams)
    return <GitExplorerBranchesColumn routeKey={openRoute.key} params={openParams} />;
  const sidebar = props.workspace === true && primaryColumn !== null;
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
          className={sidebar ? "bg-drawer" : undefined}
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
          renderItem={({ item }) => {
            const row = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Explore Git history for ${item.title}`}
                style={sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : undefined}
                className={
                  sidebar
                    ? "gap-1 bg-drawer active:bg-thread-hover"
                    : "min-h-20 gap-1 border-b border-border-subtle px-5 py-4"
                }
                onPress={() =>
                  navigation.navigate("GitExplorer", {
                    environmentId: item.environmentId,
                    projectId: item.id,
                  })
                }
              >
                <Text
                  numberOfLines={1}
                  className={
                    sidebar
                      ? "text-base font-t3-medium text-drawer-foreground"
                      : "font-t3-semibold text-foreground"
                  }
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  className={
                    sidebar
                      ? "text-xs text-drawer-foreground-muted"
                      : "text-xs text-foreground-muted"
                  }
                >
                  {savedConnectionsById[item.environmentId]?.environmentLabel ?? "Environment"} ·{" "}
                  {item.workspaceRoot}
                </Text>
              </Pressable>
            );
            return sidebar ? (
              <View style={THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE}>{row}</View>
            ) : (
              row
            );
          }}
        />
      </ScreenContent>
    </>
  );
}

export function GitExplorerScreen(props: StaticScreenProps<GitExplorerRouteParams>) {
  const navigation = useNavigation();
  const { revision, ...params } = props.route.params;
  const scopeKey = JSON.stringify([params.environmentId, params.projectId, params.worktreePath]);
  return (
    <GitExplorerRepository
      key={scopeKey}
      params={params}
      selectedRevision={revision ?? null}
      onSelectRevision={(next) => navigation.setParams({ revision: next ?? undefined })}
      onWorktreeChange={(path) => navigation.setParams({ worktreePath: path, revision: undefined })}
    />
  );
}

function GitExplorerBranchesColumn(props: {
  readonly routeKey: string;
  readonly params: GitExplorerRouteParams;
}) {
  const navigation = useNavigation();
  const registry = useContext(RegistryContext);
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  // The list route never holds navigation focus while its detail page is open beside it.
  const active = useAppForeground();
  const { revision, ...params } = props.params;
  const target = gitExplorerTarget(params);
  const overview = useActiveGitQuery(gitExplorerEnvironment.overview(target), active);
  const project = useProject({
    environmentId: EnvironmentId.make(params.environmentId),
    projectId: ProjectId.make(params.projectId),
  });
  const updateDetail = (next: Partial<GitExplorerRouteParams>) =>
    navigation.dispatch({ ...CommonActions.setParams(next), source: props.routeKey });
  const header = (
    <View className="gap-0.5 px-3 pb-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          params.submodulePath ? "Back to parent repository" : "Back to repositories"
        }
        onPress={() => navigation.dispatch({ ...CommonActions.goBack(), source: props.routeKey })}
        className="-ml-1 flex-row items-center gap-1 self-start py-1 active:opacity-60"
      >
        <SymbolView name="chevron.left" size={12} tintColorClassName="accent-primary-text" />
        <Text className="text-sm text-primary-text">
          {params.submodulePath ? "Parent repository" : "Repositories"}
        </Text>
      </Pressable>
      <Text numberOfLines={1} className="text-xl font-t3-semibold text-drawer-foreground">
        {params.submodulePath
          ? `${project?.title ?? "Repository"} › ${params.submodulePath}`
          : (project?.title ?? "Repository")}
      </Text>
    </View>
  );
  if (!overview.data)
    return (
      <View className="flex-1 bg-drawer">
        {overview.error ? (
          <EmptyState
            variant="plain"
            title="Could not open Git Explorer"
            detail={overview.error}
            actionLabel="Retry"
            onAction={() => gitExplorerEnvironment.refresh(registry, target)}
          />
        ) : (
          <View className="p-8">
            <AppActivityIndicator />
          </View>
        )}
      </View>
    );
  return (
    <GitExplorerBranches
      overview={overview.data}
      params={params}
      active={active}
      onRefresh={() => gitExplorerEnvironment.refresh(registry, target)}
      selectedRevision={revision ?? null}
      tablet
      sidebar={{
        header,
        bottomInset: Math.max(insets.bottom, workspace?.bottomClearance ?? 0),
      }}
      onOpenSubmodule={(path) =>
        navigation.dispatch({
          ...StackActions.push("GitExplorer", {
            ...params,
            submodulePath: params.submodulePath ? `${params.submodulePath}/${path}` : path,
          }),
          source: props.routeKey,
        })
      }
      onSelect={(hash) => updateDetail({ revision: hash })}
    />
  );
}

function GitExplorerRepository(props: {
  readonly params: GitExplorerParams;
  readonly selectedRevision: string | null;
  readonly onSelectRevision: (revision: string | null) => void;
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
  const commitMenu = useGitExplorerCommitMenu({
    params,
    overview,
    onRefresh: explorer.refresh,
  });
  const [width, setWidth] = useState(0);
  const selectedRevision = props.selectedRevision;
  const branchesInListColumn = useBranchesInListColumn();
  const [reviewVisible, setReviewVisible] = useState(false);
  const [branchesVisible, setBranchesVisible] = useState(false);
  const split = width >= 700;
  const branchRail = width >= 850 && !branchesInListColumn;
  const branchesPinned = branchRail || branchesInListColumn;
  const insets = useSafeAreaInsets();
  const columnMetrics = useNativeColumnLayoutMetrics();
  const safeArea = columnMetrics?.safeArea ?? insets;
  const selectRevision = (revision: string | null) => {
    props.onSelectRevision(revision);
    setReviewVisible(true);
  };
  const currentBranch = overview?.refs.find(
    (ref) =>
      ref.kind === "local" &&
      (ref.name === overview.headBranch || ref.shortName === overview.headBranch),
  );
  const worktreeName = overview?.selectedWorktreePath.split("/").at(-1);
  const openSubmodule = (path: string) =>
    navigation.dispatch(
      StackActions.push("GitExplorer", {
        environmentId: params.environmentId,
        projectId: params.projectId,
        ...(params.worktreePath ? { worktreePath: params.worktreePath } : {}),
        submodulePath: params.submodulePath ? `${params.submodulePath}/${path}` : path,
      }),
    );
  return (
    <>
      <AppBar
        title="Git Explorer"
        subtitle={
          params.submodulePath
            ? `${project?.title ?? "Repository"} › ${params.submodulePath}`
            : (project?.title ?? "Repository")
        }
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
          // Submodule worktrees are not selectable; the parent worktree stays fixed.
          overview && !params.submodulePath
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
                  disabled={branchesPinned}
                  accessibilityRole={branchesPinned ? undefined : "button"}
                  accessibilityLabel={`${branchesVisible ? "Hide" : "Show"} branches, remotes, tags and stashes. Current branch ${overview.headBranch ?? "Detached HEAD"}, ${currentBranch ? formatGitExplorerSync(currentBranch) : "No upstream comparison"}`}
                  accessibilityState={{ expanded: branchesPinned || branchesVisible }}
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
                  {!branchesPinned ? (
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
              {!branchesPinned && branchesVisible ? (
                <View style={{ height: 240 }} className="border-b border-border bg-card">
                  <GitExplorerBranches
                    overview={overview}
                    params={params}
                    active={explorer.active}
                    onRefresh={explorer.refresh}
                    selectedRevision={selectedRevision}
                    tablet={split}
                    onOpenSubmodule={openSubmodule}
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
                      onOpenSubmodule={openSubmodule}
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
                        menu={commitMenu.menu}
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
              {commitMenu.tagRequest ? (
                <GitExplorerTagDialog
                  params={params}
                  overview={overview}
                  request={commitMenu.tagRequest}
                  unavailable={commitMenu.unavailable}
                  onRefresh={explorer.refresh}
                  onClose={commitMenu.closeTagDialog}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </ScreenContent>
    </>
  );
}
