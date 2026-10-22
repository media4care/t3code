import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId, GitExplorerOverviewInput, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FolderGit2Icon, GitBranchIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";

import { isElectron } from "~/env";
import { observeResize } from "~/lib/observeResize";
import { inferProjectTitleFromPath } from "~/lib/projectPaths";
import { cn } from "~/lib/utils";
import { Route } from "~/routes/git";
import { useProjects } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { vcsEnvironment } from "~/state/vcs";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { GitExplorerHistory } from "./GitExplorerHistory";
import { GitExplorerBranches } from "./GitExplorerBranches";
import { GitExplorerHint } from "./GitExplorerHint";
import { GitExplorerNotice } from "./GitExplorerNotice";
import { GitExplorerReview } from "./GitExplorerReview";
import { useGitExplorerQuery } from "./useGitExplorerQuery";

function HistoryReviewDivider({
  share,
  onChange,
}: {
  share: number;
  onChange: (share: number) => void;
}) {
  const clamp = (value: number) => Math.max(0.3, Math.min(0.8, value));
  return (
    <button
      type="button"
      role="separator"
      aria-label="Resize history and review panels"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={30}
      aria-valuemax={80}
      className="relative z-10 h-1 shrink-0 cursor-row-resize touch-none border-y border-border bg-muted outline-none before:absolute before:-inset-y-1 before:inset-x-0 hover:bg-primary/30 focus-visible:bg-primary/50"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.preventDefault();
        const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
        if (bounds && bounds.height > 0)
          onChange(clamp((event.clientY - bounds.top) / bounds.height));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onChange(clamp(share + (event.key === "ArrowUp" ? -0.04 : 0.04)));
      }}
    />
  );
}

function RepositoryExplorer({
  environmentId,
  projectId,
  worktreePath,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  worktreePath?: string;
}) {
  const registry = useContext(RegistryContext);
  const navigate = useNavigate();
  const input: GitExplorerOverviewInput = { projectId, ...(worktreePath ? { worktreePath } : {}) };
  const target = { environmentId, input };
  const overviewQuery = useGitExplorerQuery(gitExplorerEnvironment.overview(target));
  const overview = overviewQuery.data;
  const [selectedRevision, setSelectedRevision] = useState<string | null | undefined>(undefined);
  const [showReview, setShowReview] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [historyShare, setHistoryShare] = useState(0.64);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const split = availableWidth >= 720;
  const refresh = () => {
    gitExplorerEnvironment.refresh(registry, target);
    setRefreshRevision((revision) => revision + 1);
  };
  const status = useGitExplorerQuery(
    overview
      ? vcsEnvironment.status({
          environmentId,
          input: { cwd: overview.selectedWorktreePath, includeRemote: false },
        })
      : null,
  );
  const previousStatusAt = useRef(0);
  useEffect(() => {
    if (!status.dataUpdatedAt || previousStatusAt.current === status.dataUpdatedAt) return;
    const hadStatus = previousStatusAt.current !== 0;
    previousStatusAt.current = status.dataUpdatedAt;
    if (hadStatus) gitExplorerEnvironment.refresh(registry, target);
  }, [status.dataUpdatedAt, registry, target]);
  const trackWidth = (element: HTMLDivElement) =>
    observeResize(element, ([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
  const selectRevision = (revision: string | null) => {
    setSelectedRevision(revision);
    setShowReview(true);
    setShowBranches(false);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={trackWidth}>
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-y border-border px-2 py-1">
        {split ? (
          <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Button
            variant={showBranches ? "secondary" : "ghost"}
            size="sm"
            aria-expanded={showBranches}
            aria-controls="git-explorer-branches"
            onClick={() => setShowBranches((visible) => !visible)}
          >
            <GitBranchIcon className="size-3.5" aria-hidden />
            Branches
          </Button>
        )}
        {overview ? (
          <div className="min-w-0 flex-1">
            <Select
              value={overview.selectedWorktreePath}
              onValueChange={(value) => {
                if (value)
                  void navigate({
                    to: "/git",
                    search: { environmentId, projectId, worktreePath: value },
                    replace: true,
                  });
              }}
            >
              <Tooltip>
                <TooltipTrigger render={<SelectTrigger size="sm" aria-label="Review worktree" />}>
                  <SelectValue>
                    {overview.headBranch ?? "Detached HEAD"} ·{" "}
                    {inferProjectTitleFromPath(overview.selectedWorktreePath)}
                  </SelectValue>
                </TooltipTrigger>
                <TooltipPopup>{overview.selectedWorktreePath}</TooltipPopup>
              </Tooltip>
              <SelectPopup>
                {overview.worktrees
                  .filter((worktree) => !worktree.bare)
                  .map((worktree) => (
                    <SelectItem key={worktree.path} value={worktree.path}>
                      <span className="min-w-0">
                        <span className="block truncate">
                          {worktree.branch ?? "Detached HEAD"}
                          {worktree.locked ? " · locked" : ""}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {worktree.path}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          </div>
        ) : (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">Repository</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh Git Explorer"
          title="Refresh local Git data"
          disabled={overviewQuery.isPending}
          onClick={refresh}
        >
          <RefreshIcon />
        </Button>
      </div>
      {overviewQuery.error ? (
        <GitExplorerNotice title="Git Explorer unavailable" retry={refresh}>
          {overviewQuery.error}
        </GitExplorerNotice>
      ) : !overview ? (
        <GitExplorerNotice title="Reading repository…" />
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <aside
              id="git-explorer-branches"
              aria-label="Branches"
              className={cn(
                "min-h-0 flex-col overflow-y-auto border-border bg-muted/25",
                split ? "flex w-56 shrink-0 border-r" : showBranches ? "flex flex-1" : "hidden",
              )}
            >
              <GitExplorerBranches
                overview={overview}
                selectedRevision={selectedRevision}
                onSelect={selectRevision}
              />
            </aside>
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                !split && showBranches ? "hidden" : "flex",
              )}
            >
              <section
                className={cn(
                  "min-h-0 min-w-0 flex-col",
                  split
                    ? selectedRevision === undefined
                      ? "flex flex-1"
                      : "flex shrink-0"
                    : showReview
                      ? "hidden"
                      : "flex flex-1",
                )}
                style={
                  split && selectedRevision !== undefined
                    ? { height: `${historyShare * 100}%` }
                    : undefined
                }
                aria-label="Repository history"
              >
                <GitExplorerHistory
                  key={`${overview.snapshotId}:${overview.selectedWorktreePath}`}
                  environmentId={environmentId}
                  input={input}
                  overview={overview}
                  selectedRevision={selectedRevision}
                  onSelect={selectRevision}
                  refresh={refresh}
                  refreshRevision={refreshRevision}
                />
              </section>
              {split && selectedRevision !== undefined ? (
                <HistoryReviewDivider share={historyShare} onChange={setHistoryShare} />
              ) : null}
              <section
                className={cn(
                  "min-h-0 min-w-0 flex-1 flex-col",
                  (split && selectedRevision !== undefined) || (!split && showReview)
                    ? "flex"
                    : "hidden",
                )}
                aria-label="Commit review"
              >
                {selectedRevision === undefined ? (
                  <GitExplorerNotice title="Select a commit to review">
                    Inspect its changes, or choose Working Tree to review uncommitted work.
                  </GitExplorerNotice>
                ) : (
                  <GitExplorerReview
                    key={`${overview.selectedWorktreePath}:${selectedRevision ?? "working"}`}
                    environmentId={environmentId}
                    input={input}
                    revision={selectedRevision}
                    compact={!split}
                    onBack={() => setShowReview(false)}
                  />
                )}
              </section>
            </div>
          </div>
          <footer className="shrink-0 border-t border-border px-3 py-1 text-2xs text-muted-foreground">
            <GitExplorerHint
              className="block truncate"
              label={`Remote-tracking refs may be stale. ${overview.lastFetchAt ? `Last known fetch: ${new Date(overview.lastFetchAt).toLocaleString()}.` : "Last fetch time unknown."} Remote server not checked.`}
            >
              <span>
                Remote-tracking refs ·{" "}
                {overview.lastFetchAt
                  ? `last known fetch ${new Date(overview.lastFetchAt).toLocaleString()}`
                  : "last fetch unknown"}
              </span>
              <span className="ml-1 hidden sm:inline">· Remote server not checked</span>
            </GitExplorerHint>
          </footer>
        </>
      )}
    </div>
  );
}

export function GitExplorerPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const selectedProject = search.projectId
    ? projects.find(
        (project) =>
          project.id === search.projectId && project.environmentId === search.environmentId,
      )
    : projects[0];
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const projectKey = (project: (typeof projects)[number]) =>
    `${project.environmentId}:${project.id}`;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <FolderGit2Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h1 className="shrink-0 text-sm font-medium">Git Explorer</h1>
          <span className="hidden text-2xs text-muted-foreground sm:block">Read-only</span>
          <div className="ml-auto min-w-0 max-w-72 flex-1">
            <Select
              value={selectedProject ? projectKey(selectedProject) : null}
              onValueChange={(value) => {
                const project = projects.find((candidate) => projectKey(candidate) === value);
                if (project)
                  void navigate({
                    to: "/git",
                    search: { environmentId: project.environmentId, projectId: project.id },
                    replace: true,
                  });
              }}
            >
              <SelectTrigger size="sm" aria-label="Repository">
                <SelectValue placeholder="Choose a project">
                  {selectedProject?.title ?? "Choose a project"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((project) => (
                  <SelectItem key={projectKey(project)} value={projectKey(project)}>
                    <span className="min-w-0">
                      <span className="block truncate">{project.title}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {environmentLabels.get(project.environmentId)} · {project.workspaceRoot}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </WorkspacePageHeader>
        {selectedProject ? (
          <RepositoryExplorer
            key={projectKey(selectedProject)}
            environmentId={selectedProject.environmentId}
            projectId={selectedProject.id}
            {...(search.worktreePath ? { worktreePath: search.worktreePath } : {})}
          />
        ) : (
          <GitExplorerNotice
            title={projects.length ? "Choose a repository" : "No projects available"}
          >
            Select a project to review its repository history.
          </GitExplorerNotice>
        )}
      </div>
    </SidebarInset>
  );
}
