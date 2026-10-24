import { LegendList } from "@legendapp/list/react";
import {
  formatGitExplorerSync,
  layoutGitGraph,
  gitExplorerEmphasizedRefs,
  type GitGraphRow,
} from "@t3tools/client-runtime/git-explorer";
import type {
  EnvironmentId,
  GitExplorerCommit,
  GitExplorerHistoryInput,
  GitExplorerHistoryResult,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRef,
} from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  GitBranchIcon,
  HardDriveIcon,
  TagIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useDebouncedValue } from "~/state/queries";
import { GitExplorerNotice } from "./GitExplorerNotice";
import { GitExplorerHint } from "./GitExplorerHint";
import {
  mergeGitExplorerHistoryPage,
  selectGitExplorerReferences,
} from "./gitExplorerHistory.logic";
import { useGitExplorerQuery } from "./useGitExplorerQuery";
import { useGitExplorerListNavigation } from "./useGitExplorerListNavigation";

import {
  copyGitExplorerValue,
  gitExplorerMenuPosition,
  showGitExplorerContextMenu,
} from "./gitExplorerContextMenu";

const GRAPH_COLORS = [
  "text-primary",
  "text-success-foreground",
  "text-warning-foreground",
  "text-info-foreground",
  "text-destructive",
  "text-muted-foreground",
];
const LANE_WIDTH = 14;
const AUTHOR_COLUMN_CLASS = "hidden w-40 shrink-0 truncate px-2 @min-[40rem]/git-history:block";
const DATE_COLUMN_CLASS = "hidden w-36 shrink-0 truncate px-2 @min-[52rem]/git-history:block";

function CommitGraph({
  row,
  width,
  offset,
  height,
}: {
  row: GitGraphRow;
  width: number;
  offset: number;
  height: number;
}) {
  const x = (column: number) => (column + 0.5) * LANE_WIDTH + 8;
  return (
    <svg
      viewBox={`${offset} 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full overflow-hidden"
      aria-hidden
    >
      {row.lines.map((line) => {
        const fromY = line.kind === "parent" ? height / 2 : 0;
        const toY = line.kind === "incoming" ? height / 2 : height;
        const midY = (fromY + toY) / 2;
        return (
          <path
            key={`${line.kind}:${line.from}:${line.to}`}
            d={`M ${x(line.from)} ${fromY} C ${x(line.from)} ${midY}, ${x(line.to)} ${midY}, ${x(line.to)} ${toY}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={line.emphasized ? 3.5 : 2}
            className={GRAPH_COLORS[line.color % GRAPH_COLORS.length]}
          />
        );
      })}
      <circle
        cx={x(row.column)}
        cy={height / 2}
        r={row.emphasized ? 4 : 3.5}
        fill="currentColor"
        className={GRAPH_COLORS[row.column % GRAPH_COLORS.length]}
      />
    </svg>
  );
}

function RefLabel({ reference, emphasized }: { reference: GitExplorerRef; emphasized: boolean }) {
  return (
    <GitExplorerHint
      className={cn(
        "inline-flex h-4.5 min-w-0 max-w-36 flex-auto items-center gap-1 rounded px-1 text-xs leading-none",
        emphasized && "font-semibold",
        reference.kind === "local"
          ? "bg-primary text-primary-foreground"
          : reference.kind === "tag"
            ? "bg-info/8 text-info-foreground ring-1 ring-info/24 ring-inset dark:bg-info/16"
            : "bg-accent text-foreground/85 ring-1 ring-border ring-inset",
      )}
      label={`${reference.shortName} · ${reference.kind === "local" ? formatGitExplorerSync(reference) : reference.kind === "tag" ? "tag" : "remote-tracking branch"}`}
    >
      {reference.kind === "tag" ? (
        <TagIcon className="size-2.5 shrink-0" aria-hidden />
      ) : (
        <GitBranchIcon className="size-2.5 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 truncate">{reference.shortName}</span>
    </GitExplorerHint>
  );
}

interface HistoryProps {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  selectedRevision: string | null | undefined;
  onSelect: (revision: string | null) => void;
  refresh: () => void;
  refreshRevision: number;
}

export function GitExplorerHistory(props: HistoryProps) {
  const [historyScope, setHistoryScope] = useState<"all" | "current">("all");
  const [searchField, setSearchField] =
    useState<NonNullable<GitExplorerHistoryInput["searchField"]>>("message");
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 250);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border p-1.5">
        <Select
          value={historyScope}
          onValueChange={(value) => {
            if (value) setHistoryScope(value);
          }}
        >
          <SelectTrigger size="sm" aria-label="History scope">
            <SelectValue>{historyScope === "all" ? "All branches" : "Current branch"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All branches</SelectItem>
            <SelectItem value="current">Current branch</SelectItem>
          </SelectPopup>
        </Select>
        <Select
          value={searchField}
          onValueChange={(value) => {
            if (value) setSearchField(value);
          }}
        >
          <SelectTrigger size="sm" aria-label="Search field">
            <SelectValue>
              {
                { message: "Message", author: "Author", hash: "Commit hash", path: "File path" }[
                  searchField
                ]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="message">Message</SelectItem>
            <SelectItem value="author">Author</SelectItem>
            <SelectItem value="hash">Commit hash</SelectItem>
            <SelectItem value="path">File path</SelectItem>
          </SelectPopup>
        </Select>
        <div className="min-w-36 flex-1">
          <Input
            size="compact"
            type="search"
            aria-label="Search history"
            maxLength={256}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              searchField === "path"
                ? "Relative file or directory path"
                : searchField === "hash"
                  ? "Commit hash (at least 4 characters)"
                  : `Search by ${searchField}`
            }
          />
        </div>
        {query ? (
          <Button size="xs" variant="ghost" onClick={() => setQuery("")}>
            Clear
          </Button>
        ) : null}
      </div>
      <GitExplorerHistoryList
        key={JSON.stringify([props.overview.snapshotId, historyScope, searchField, search])}
        {...props}
        filters={{ historyScope, searchField, search }}
      />
    </div>
  );
}

function GitExplorerHistoryList({
  environmentId,
  input,
  overview,
  selectedRevision,
  onSelect,
  refresh,
  refreshRevision,
  filters,
}: HistoryProps & {
  filters: Pick<GitExplorerHistoryInput, "historyScope" | "searchField" | "search">;
}) {
  const phone = useMediaQuery("max-sm");
  const compact = useMediaQuery("max-lg");
  const coarsePointer = useMediaQuery({ pointer: "coarse" });
  const rowHeight = phone ? 32 : coarsePointer ? 28 : 20;
  const maxVisibleRefs = phone ? 1 : 2;
  const [cursor, setCursor] = useState(0);
  const [graphOffset, setGraphOffset] = useState(0);
  const [history, setHistory] = useState<{
    commits: readonly GitExplorerCommit[];
    result: GitExplorerHistoryResult | null;
    cursor: number;
  }>({ commits: [], result: null, cursor: 0 });
  const query = useGitExplorerQuery(
    gitExplorerEnvironment.history({
      environmentId,
      input: { ...input, ...filters, snapshotId: overview.snapshotId, cursor, limit: 200 },
    }),
  );
  const handledRefresh = useRef(refreshRevision);
  const refreshHistory = query.refresh;
  useEffect(() => {
    if (handledRefresh.current === refreshRevision) return;
    handledRefresh.current = refreshRevision;
    refreshHistory();
  }, [refreshRevision, refreshHistory]);
  if (query.data && query.data !== history.result) {
    setHistory({
      commits: mergeGitExplorerHistoryPage(history.commits, query.data.commits, cursor),
      result: query.data,
      cursor,
    });
  }
  const emphasizedRefs = gitExplorerEmphasizedRefs(overview.refs);
  const graph = layoutGitGraph(
    history.commits,
    [],
    new Set(overview.refs.filter((ref) => emphasizedRefs.has(ref.name)).map((ref) => ref.hash)),
  );
  const graphWidth =
    graph.rows.reduce((width, row) => Math.max(width, row.laneCount), 2) * LANE_WIDTH + 16;
  const graphDisplayWidth = compact ? Math.max(48, Math.min(graphWidth, 64)) : 88;
  const visibleGraphOffset = Math.min(graphOffset, Math.max(0, graphWidth - graphDisplayWidth));
  const rows = history.commits.map((commit, index) => ({ commit, graph: graph.rows[index]! }));
  const navigation = useGitExplorerListNavigation({
    count: rows.length,
    selectedIndex: history.commits.findIndex((commit) => commit.hash === selectedRevision),
    rowHeight,
    onSelect: (index) => onSelect(history.commits[index]!.hash),
  });
  const currentBranch = overview.refs.find(
    (reference) => reference.kind === "local" && reference.shortName === overview.headBranch,
  );
  const tracksRemote = currentBranch?.upstream?.startsWith("refs/remotes/") === true;
  const refsByHash = new Map<string, GitExplorerRef[]>();
  for (const reference of overview.refs) {
    const refs = refsByHash.get(reference.hash) ?? [];
    refs.push(reference);
    refsByHash.set(reference.hash, refs);
  }
  const worktreesByHash = new Map<string, string[]>();
  for (const worktree of overview.worktrees) {
    if (!worktree.headHash || worktree.path === overview.selectedWorktreePath) continue;
    const worktrees = worktreesByHash.get(worktree.headHash) ?? [];
    worktrees.push(worktree.path);
    worktreesByHash.set(worktree.headHash, worktrees);
  }
  const loadMore = () => {
    if (query.isPending || query.error || cursor !== history.cursor) return;
    if (history.result?.nextCursor != null) setCursor(history.result.nextCursor);
  };
  const extraData = {
    selectedRevision,
    refsByHash,
    worktreesByHash,
    overview,
    graphWidth,
    graphDisplayWidth,
    visibleGraphOffset,
    tracksRemote,
    rowHeight,
    maxVisibleRefs,
  };

  return (
    <div className="@container/git-history flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="flex h-6 shrink-0 items-center border-b border-border bg-muted/30 text-xs font-medium text-foreground/75 pointer-coarse:h-7 max-sm:h-8"
        aria-hidden
      >
        <span className="shrink-0 px-2" style={{ width: graphDisplayWidth }}>
          Graph
        </span>
        <span className="min-w-0 flex-1 border-l border-border/60 px-2">Description</span>
        <span className="w-22 shrink-0 border-l border-border/60 px-2">Commit</span>
        <span className={cn(AUTHOR_COLUMN_CLASS, "border-l border-border/60")}>Author</span>
        <span className={cn(DATE_COLUMN_CLASS, "border-l border-border/60")}>Date</span>
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={selectedRevision === null ? "true" : undefined}
        className="flex h-6 shrink-0 items-center border-b border-border/60 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-current:bg-foreground/10 pointer-coarse:h-7 max-sm:h-8"
      >
        <span className="shrink-0 px-2" style={{ width: graphDisplayWidth }}>
          <HardDriveIcon className="size-3.5 text-muted-foreground" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate px-2 text-xs leading-5 font-medium">
          Working Tree{" "}
          <span className="font-normal text-muted-foreground">· Uncommitted changes</span>
        </span>
        <span className="w-22 shrink-0 px-2 font-mono text-xs text-foreground/70">*</span>
        <span className={cn(AUTHOR_COLUMN_CLASS, "text-xs text-muted-foreground")}>*</span>
        <span className={cn(DATE_COLUMN_CLASS, "text-xs text-foreground/70")}>Local changes</span>
      </button>
      {graphWidth > graphDisplayWidth ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 text-2xs text-muted-foreground">
          <div
            className="h-5 shrink-0 overflow-x-auto overflow-y-hidden"
            style={{ width: graphDisplayWidth }}
            onScroll={(event) => setGraphOffset(event.currentTarget.scrollLeft)}
            aria-label="Scroll graph lanes"
            tabIndex={0}
          >
            <div className="h-1" style={{ width: graphWidth }} />
          </div>
          <span>Scroll graph lanes</span>
        </div>
      ) : null}
      {query.error && rows.length === 0 ? (
        <GitExplorerNotice title="Could not load history" retry={refresh}>
          {query.error}
        </GitExplorerNotice>
      ) : rows.length === 0 ? (
        <GitExplorerNotice
          title={
            query.isPending
              ? "Loading history…"
              : filters.search
                ? "No matching commits"
                : "No commits yet"
          }
        />
      ) : (
        <LegendList
          {...navigation.listProps}
          aria-label="Commits"
          key={rowHeight}
          data={rows}
          keyExtractor={(row) => row.commit.hash}
          estimatedItemSize={rowHeight}
          getFixedItemSize={() => rowHeight}
          extraData={extraData}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          className="min-h-0 flex-1 overscroll-contain outline-none"
          renderItem={({ item: { commit, graph: row }, index }) => {
            const references = refsByHash.get(commit.hash) ?? [];
            const { visible: visibleReferences, hidden: hiddenReferences } =
              selectGitExplorerReferences(references, overview.headBranch, maxVisibleRefs);
            const otherWorktrees = worktreesByHash.get(commit.hash);
            const isHead = overview.headHash === commit.hash;
            return (
              <button
                type="button"
                {...navigation.optionProps(index)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void showGitExplorerContextMenu(
                    [{ id: "copy-hash", label: "Copy commit hash", icon: "copy" }],
                    gitExplorerMenuPosition(event),
                    () => copyGitExplorerValue(commit.hash, "commit hash"),
                  );
                }}
                aria-current={selectedRevision === commit.hash ? "true" : undefined}
                className="flex w-full items-center text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-current:bg-foreground/10"
                style={{ height: rowHeight }}
                aria-label={`${commit.subject}, ${commit.authorName}, ${commit.hash.slice(0, 8)}${isHead ? ", HEAD" : ""}`}
              >
                <span className="h-full shrink-0" style={{ width: graphDisplayWidth }}>
                  <CommitGraph
                    row={row}
                    width={graphDisplayWidth}
                    offset={visibleGraphOffset}
                    height={rowHeight}
                  />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-2">
                  {isHead ? (
                    <span className="inline-flex h-4.5 shrink-0 items-center rounded bg-primary px-1 text-xs leading-none text-primary-foreground">
                      HEAD
                    </span>
                  ) : null}
                  {visibleReferences.length > 0 ? (
                    <span className="flex min-w-0 max-w-1/2 shrink-0 items-center gap-1">
                      {visibleReferences.map((reference) => (
                        <RefLabel
                          key={reference.name}
                          reference={reference}
                          emphasized={emphasizedRefs.has(reference.name)}
                        />
                      ))}
                      {hiddenReferences.length > 0 ? (
                        <GitExplorerHint
                          className="inline-flex h-4.5 shrink-0 items-center rounded bg-accent px-1 text-xs leading-none text-foreground/85"
                          label={`More references: ${hiddenReferences.map((reference) => (reference.kind === "tag" ? `tag: ${reference.shortName}` : reference.shortName)).join(", ")}`}
                        >
                          +{hiddenReferences.length}
                          <span className="sr-only"> more references</span>
                        </GitExplorerHint>
                      ) : null}
                    </span>
                  ) : null}
                  {otherWorktrees ? (
                    <GitExplorerHint
                      className="shrink-0"
                      label={`Worktree HEAD: ${otherWorktrees.join(", ")}`}
                    >
                      <HardDriveIcon className="size-3 shrink-0 text-muted-foreground" />
                    </GitExplorerHint>
                  ) : null}
                  <GitExplorerHint
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs leading-5",
                      isHead && "font-medium",
                    )}
                    label={commit.subject}
                  >
                    {commit.subject}
                  </GitExplorerHint>
                </span>
                <span className="flex w-22 shrink-0 items-center gap-1 px-2 text-xs text-foreground/70">
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {commit.hash.slice(0, 7)}
                  </span>
                  {commit.upstreamStatus === "local-only" ? (
                    <GitExplorerHint
                      className="flex shrink-0 items-center text-primary"
                      label={
                        tracksRemote
                          ? "Unpushed · not in the tracked upstream"
                          : "Ahead · not in the tracked upstream"
                      }
                    >
                      <ArrowUpIcon className="size-3" />
                      <span className="sr-only">{tracksRemote ? "Unpushed" : "Ahead"}</span>
                    </GitExplorerHint>
                  ) : null}
                  {commit.upstreamStatus === "upstream-only" ? (
                    <GitExplorerHint
                      className="flex shrink-0 items-center text-warning-foreground"
                      label="Only in the tracked upstream; absent from the selected branch"
                    >
                      <ArrowDownIcon className="size-3" />
                      <span className="sr-only">Upstream only</span>
                    </GitExplorerHint>
                  ) : null}
                  {commit.upstreamStatus === "shared" ? (
                    <GitExplorerHint
                      className="shrink-0 text-success-foreground"
                      label="Present in both the selected branch and its tracked upstream"
                    >
                      <CheckIcon className="size-3" />
                      <span className="sr-only">In upstream</span>
                    </GitExplorerHint>
                  ) : null}
                </span>
                <GitExplorerHint
                  className={cn(AUTHOR_COLUMN_CLASS, "text-xs text-foreground/75")}
                  label={`${commit.authorName} <${commit.authorEmail}>`}
                >
                  {commit.authorName}
                </GitExplorerHint>
                <GitExplorerHint
                  className={cn(DATE_COLUMN_CLASS, "text-xs text-foreground/75")}
                  label={new Date(commit.committedAt).toLocaleString()}
                >
                  <time
                    dateTime={commit.committedAt}
                    aria-label={new Date(commit.committedAt).toLocaleString()}
                  >
                    {new Date(commit.committedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </GitExplorerHint>
              </button>
            );
          }}
        />
      )}
      {query.error && rows.length > 0 ? (
        <div className="border-t border-border px-3 py-2 text-xs">
          <p role="status">{query.error}</p>
          <Button size="xs" variant="ghost" onClick={refresh}>
            Refresh history
          </Button>
        </div>
      ) : null}
      {history.result?.nextCursor != null ? (
        <div className="flex shrink-0 justify-center border-t border-border py-1">
          <Button size="xs" variant="ghost" disabled={query.isPending} onClick={loadMore}>
            {query.isPending ? "Loading…" : "Load more commits"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
