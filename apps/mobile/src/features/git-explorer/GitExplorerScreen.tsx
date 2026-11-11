import { use, useContext, useRef, useState, type ReactNode } from "react";
import { FlatList, Platform, Pressable, ScrollView, View } from "react-native";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  CommonActions,
  StackActions,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { formatGitExplorerSync } from "@t3tools/client-runtime/git-explorer";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { WorkspacePaneDivider } from "../layout/workspace-pane-divider";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useProject, useProjects } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { GitExplorerBranches } from "./GitExplorerBranches";
import { GitExplorerRepositoryMenu, gitExplorerHomeProject } from "./GitExplorerRepositoryMenu";
import { GitExplorerGraph } from "./GitExplorerGraph";
import { GitExplorerChanges } from "./GitExplorerChanges";
import { useGitExplorerCommitMenu } from "./GitExplorerCommitMenu";
import { GitExplorerTagDialog } from "./GitExplorerTagDialog";
import { useActiveGitQuery, useAppForeground } from "./useActiveGitQuery";
import { gitExplorerTarget, useGitExplorer, type GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerSync } from "./useGitExplorerSync";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { LIST_FILTER_ROW_STYLE, ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE,
  THREAD_LIST_V2_SIDEBAR_ROW_STYLE,
} from "../threads/thread-list-v2-row-appearance";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";

const HISTORY_MIN_HEIGHT = 120;
const REVIEW_MIN_HEIGHT = 140;

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
  const primaryColumn = use(NativePrimaryColumnContext);
  const branchesInListColumn = useBranchesInListColumn();
  const openRoute = primaryColumn?.gitExplorerRoute;
  const openParams = openRoute ? readRouteParams(openRoute.params) : null;
  if (props.workspace && branchesInListColumn && openRoute && openParams)
    return <GitExplorerBranchesColumn routeKey={openRoute.key} params={openParams} />;
  // The iPad list column picks the repository for the page beside it. Everywhere else the
  // explorer opens on a repository and its repository chip switches it.
  if (props.workspace && primaryColumn !== null) return <GitRepositoriesColumn />;
  return <GitExplorerHome workspace={props.workspace === true} />;
}

function GitRepositoriesColumn() {
  const navigation = useNavigation();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  return (
    <ScreenContent>
      <FlatList
        className="bg-drawer"
        data={projects}
        keyExtractor={(item) => JSON.stringify([item.environmentId, item.id])}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, workspace?.bottomClearance ?? 0),
        }}
        ListEmptyComponent={
          <EmptyState
            variant="plain"
            title="No projects available"
            detail="Connect an environment and add a project to explore its repository."
          />
        }
        renderItem={({ item }) => (
          <View style={THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Explore Git history for ${item.title}`}
              style={THREAD_LIST_V2_SIDEBAR_ROW_STYLE}
              className="gap-1 bg-drawer active:bg-thread-hover"
              onPress={() =>
                navigation.navigate("GitExplorer", {
                  environmentId: item.environmentId,
                  projectId: item.id,
                })
              }
            >
              <Text numberOfLines={1} className="text-base font-t3-medium text-drawer-foreground">
                {item.title}
              </Text>
              <Text numberOfLines={1} className="text-xs text-drawer-foreground-muted">
                {savedConnectionsById[item.environmentId]?.environmentLabel ?? "Environment"} ·{" "}
                {item.workspaceRoot}
              </Text>
            </Pressable>
          </View>
        )}
      />
    </ScreenContent>
  );
}

function GitExplorerHome(props: { readonly workspace: boolean }) {
  const navigation = useNavigation();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const project = gitExplorerHomeProject(
    useProjects(),
    AsyncResult.isSuccess(preferences) ? preferences.value.gitExplorerProject : undefined,
  );
  const scope = project ? JSON.stringify([project.environmentId, project.id]) : "";
  const [view, setView] = useState({
    scope,
    worktreePath: undefined as string | undefined,
    revision: null as string | null,
  });
  if (!project)
    return (
      <>
        {props.workspace && Platform.OS === "ios" ? null : (
          <AppBar
            title="Git Explorer"
            onBack={props.workspace ? undefined : () => navigation.goBack()}
          />
        )}
        <ScreenContent>
          <EmptyState
            variant="plain"
            title="No projects available"
            detail="Connect an environment and add a project to explore its repository."
          />
        </ScreenContent>
      </>
    );
  const current = view.scope === scope ? view : { scope, worktreePath: undefined, revision: null };
  const repository = (
    <GitExplorerRepositoryMenu
      selected={{ environmentId: project.environmentId, projectId: project.id }}
    />
  );
  return (
    <GitExplorerRepository
      key={JSON.stringify([project.environmentId, project.id, current.worktreePath])}
      params={{
        environmentId: project.environmentId,
        projectId: project.id,
        ...(current.worktreePath ? { worktreePath: current.worktreePath } : {}),
      }}
      selectedRevision={current.revision}
      onSelectRevision={(revision) => setView({ ...current, revision })}
      onWorktreeChange={(worktreePath) => setView({ scope, worktreePath, revision: null })}
      home={{ workspace: props.workspace, repository }}
    />
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
  const header = params.submodulePath ? (
    <View className="gap-0.5 px-3 pb-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to parent repository"
        onPress={() => navigation.dispatch({ ...CommonActions.goBack(), source: props.routeKey })}
        className="-ml-1 flex-row items-center gap-1 self-start py-1 active:opacity-60"
      >
        <SymbolView name="chevron.left" size={12} tintColorClassName="accent-primary-text" />
        <Text className="text-sm text-primary-text">Parent repository</Text>
      </Pressable>
      <Text numberOfLines={1} className="text-xl font-t3-semibold text-drawer-foreground">
        {`${project?.title ?? "Repository"} › ${params.submodulePath}`}
      </Text>
    </View>
  ) : (
    <View className="flex-row px-3 pb-2">
      <GitExplorerRepositoryMenu
        selected={params}
        onSelect={(next) =>
          navigation.dispatch({
            ...StackActions.replace("GitExplorer", next),
            source: props.routeKey,
          })
        }
      />
    </View>
  );
  // The header stays while the repository loads or fails, so its chip can still switch away.
  if (!overview.data)
    return (
      <ScrollView className="flex-1 bg-drawer" contentInsetAdjustmentBehavior="automatic">
        {header}
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
      </ScrollView>
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
  /** The tab's explorer: a chip row holds the repository picker and the actions. */
  readonly home?: { readonly workspace: boolean; readonly repository: ReactNode };
}) {
  const navigation = useNavigation();
  const { params, home } = props;
  const { themeAppearance } = useAppearancePreferences();
  const workspace = useWorkspaceTabs();
  const project = useProject({
    environmentId: EnvironmentId.make(params.environmentId),
    projectId: ProjectId.make(params.projectId),
  });
  const explorer = useGitExplorer(params);
  const overview = explorer.overview.data;
  const sync = useGitExplorerSync(params, overview, explorer.refresh);
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
  const [paneHeight, setPaneHeight] = useState(0);
  const [preferredReviewHeight, setPreferredReviewHeight] = useState<number | null>(null);
  const resizeStartHeight = useRef(0);
  const [fileListWidth, setFileListWidth] = useState(190);
  const reviewHeight = Math.max(
    REVIEW_MIN_HEIGHT,
    Math.min(
      preferredReviewHeight ?? Math.round(paneHeight * 0.46),
      paneHeight - HISTORY_MIN_HEIGHT,
    ),
  );
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
  // Submodule worktrees are not selectable; the parent worktree stays fixed.
  const worktrees =
    overview && !params.submodulePath
      ? overview.worktrees
          .filter((worktree) => !worktree.bare)
          .map((worktree) => ({
            id: worktree.path,
            title: worktree.branch?.replace(/^refs\/heads\//, "") ?? "Detached HEAD",
            subtitle: worktree.path,
            selected: worktree.path === overview.selectedWorktreePath,
            onPress: () => props.onWorktreeChange(worktree.path),
          }))
      : [];
  const subtitle = params.submodulePath
    ? `${project?.title ?? "Repository"} › ${params.submodulePath}`
    : (project?.title ?? "Repository");
  const openSubmodule = (path: string) =>
    navigation.dispatch(
      StackActions.push("GitExplorer", {
        environmentId: params.environmentId,
        projectId: params.projectId,
        ...(params.worktreePath ? { worktreePath: params.worktreePath } : {}),
        submodulePath: params.submodulePath ? `${params.submodulePath}/${path}` : path,
      }),
    );
  const pullLabel = `Pull ${overview?.headBranch ?? "current branch"} (fast-forward only)${sync.pullUnavailable ? `. ${sync.pullUnavailable}` : ""}`;
  const fetchLabel = `Fetch all remotes${sync.unavailable ? `. ${sync.unavailable}` : ""}`;
  return (
    <>
      {home ? (
        // The workspace header belongs to the tab bar's toolbar on iOS.
        home.workspace && Platform.OS === "ios" ? null : (
          <AppBar
            title="Git Explorer"
            subtitle={subtitle}
            onBack={home.workspace ? undefined : () => navigation.goBack()}
          />
        )
      ) : (
        <AppBar
          title="Git Explorer"
          subtitle={subtitle}
          onBack={() => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: "Refresh Git Explorer",
              icon: "arrow.clockwise",
              onPress: explorer.refresh,
              disabled: explorer.overview.isPending,
            },
            {
              accessibilityLabel: pullLabel,
              icon: "arrow.down",
              onPress: () => void sync.execute("pull"),
              disabled: sync.pullUnavailable !== null,
              loading: sync.pending === "pull",
            },
            {
              accessibilityLabel: fetchLabel,
              icon: "arrow.down.circle",
              onPress: () => void sync.execute("fetch"),
              disabled: sync.unavailable !== null,
              loading: sync.pending === "fetch",
            },
          ]}
          menus={
            worktrees.length
              ? [
                  {
                    title: "Review worktree",
                    icon: "point.topleft.down.curvedto.point.bottomright.up",
                    items: worktrees,
                  },
                ]
              : []
          }
        />
      )}
      <ScreenContent>
        <View
          className="flex-1 bg-sheet-solid"
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{
            paddingTop: Platform.OS === "ios" ? safeArea.top : 0,
            paddingBottom: home?.workspace
              ? Math.max(safeArea.bottom, workspace?.bottomClearance ?? 0)
              : safeArea.bottom,
          }}
        >
          {home ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={LIST_FILTER_ROW_STYLE}
            >
              {home.repository}
              {worktrees.length > 1 ? (
                <ListFilterMenu
                  label={
                    // Git lists the main worktree first; its folder only repeats the repository.
                    worktrees[0]?.selected ? "Main worktree" : (worktreeName ?? "Worktree")
                  }
                  accessibilityLabel="Review worktree"
                  actions={worktrees.map((worktree) => ({
                    id: worktree.id,
                    title: worktree.title,
                    subtitle: worktree.subtitle,
                    state: worktree.selected ? ("on" as const) : ("off" as const),
                  }))}
                  onSelect={props.onWorktreeChange}
                />
              ) : null}
              <Chip
                label="Refresh"
                icon="arrow.clockwise"
                glass
                colorScheme={themeAppearance}
                accessibilityLabel="Refresh Git Explorer"
                onPress={explorer.refresh}
                disabled={explorer.overview.isPending}
              />
              <Chip
                label={sync.pending === "pull" ? "Pulling…" : "Pull"}
                icon="arrow.down"
                glass
                colorScheme={themeAppearance}
                accessibilityLabel={pullLabel}
                onPress={() => void sync.execute("pull")}
                disabled={sync.pullUnavailable !== null}
              />
              <Chip
                label={sync.pending === "fetch" ? "Fetching…" : "Fetch"}
                icon="arrow.down.circle"
                glass
                colorScheme={themeAppearance}
                accessibilityLabel={fetchLabel}
                onPress={() => void sync.execute("fetch")}
                disabled={sync.unavailable !== null}
              />
            </ScrollView>
          ) : null}
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
                <View
                  className="min-h-0 min-w-0 flex-1"
                  onLayout={(event) => setPaneHeight(event.nativeEvent.layout.height)}
                >
                  {split || !reviewVisible ? (
                    <View className="min-h-0 flex-1">
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
                  {split ? (
                    <WorkspacePaneDivider
                      axis="y"
                      accessibilityLabel="Resize review pane"
                      currentWidth={reviewHeight}
                      resizeDirection={-1}
                      onResizeStart={() => {
                        resizeStartHeight.current = reviewHeight;
                      }}
                      onResizeBy={(delta) =>
                        setPreferredReviewHeight(resizeStartHeight.current + delta)
                      }
                    />
                  ) : null}
                  {split || reviewVisible ? (
                    <View
                      style={split ? { height: reviewHeight } : undefined}
                      className={cn("min-h-0 border-t border-border", !split && "flex-1")}
                    >
                      <GitExplorerChanges
                        key={selectedRevision ?? "working-tree"}
                        params={params}
                        overview={overview}
                        revision={selectedRevision}
                        split={split}
                        active={explorer.active}
                        fileListWidth={fileListWidth}
                        onFileListWidthChange={setFileListWidth}
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
