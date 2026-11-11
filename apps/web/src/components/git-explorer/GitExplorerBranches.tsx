import {
  describeGitExplorerMerge,
  describeGitExplorerSubmodule,
  gitExplorerBranchDeletionBlock,
  gitExplorerUpstreamMergeSummary,
  formatGitExplorerSync,
  gitExplorerEmphasizedRefs,
  gitExplorerBranchRows,
  gitExplorerFolderExpanded,
  gitExplorerReleaseSource,
  type GitExplorerBranchTreeRow,
} from "@t3tools/client-runtime/git-explorer";
import type {
  EnvironmentId,
  GitExplorerBranchStatus,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerReleaseChannel,
  GitExplorerStash,
  GitExplorerSubmodule,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowRightLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  EqualIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GlobeIcon,
  HardDriveIcon,
  EllipsisIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";
import { GIT_EXPLORER_COLORS, gitExplorerReferenceColors } from "./gitExplorerColors";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { GitExplorerHint } from "./GitExplorerHint";
import { useGitExplorerQuery } from "./useGitExplorerQuery";

import {
  copyGitExplorerValue,
  gitExplorerMenuPosition,
  gitExplorerReleaseMenu,
  gitExplorerReleaseMenuChannel,
  showGitExplorerContextMenu,
} from "./gitExplorerContextMenu";
import type { GitExplorerReleaseRequest } from "./GitExplorerReleaseAction";

import type { GitExplorerStashActionKind } from "./GitExplorerStashAction";

interface StashActions {
  unavailable: string | null;
  onAction: (action: GitExplorerStashActionKind, stash: GitExplorerStash) => void;
}

interface TagActions {
  unavailable: string | null;
  onAction: (action: "push" | "delete", reference: GitExplorerRef) => void;
}

const ROW_CLASS =
  "relative flex h-6 w-full min-w-0 items-center gap-1.5 rounded-sm px-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-current:bg-primary/8 pointer-coarse:h-7 max-sm:h-9";
const HEADING_CLASS =
  "flex h-6 shrink-0 items-center gap-1.5 px-2 text-2xs font-medium text-muted-foreground";
const CollapsibleSection = Schema.Literals(["tags", "stashes", "submodules"]);
const CollapsedSections = Schema.Array(CollapsibleSection);
const COLLAPSED_SECTIONS_KEY = "git-explorer-collapsed-sections";

function SectionHeading({
  icon: Icon,
  label,
  count,
  collapsed,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <h2>
      <button
        type="button"
        className={cn(
          HEADING_CLASS,
          "w-full rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <ChevronDownIcon className={cn("size-3 shrink-0", collapsed && "-rotate-90")} aria-hidden />
        <Icon className="size-3" aria-hidden />
        {label}
        <span className="ml-auto font-mono text-3xs tabular-nums">{count}</span>
      </button>
    </h2>
  );
}

interface BranchActions {
  deleteUnavailable: string | null;
  pendingBranch: string | null;
  onDeleteFolder: (path: string) => void;
  onDeleteBranches: (references: readonly GitExplorerRef[]) => void;
  onBranchAction: (action: "switch" | "rename", reference: GitExplorerRef) => void;
  headBranch: string | null;
  onMerge: (reference: GitExplorerRef) => void;
  onRelease: (request: GitExplorerReleaseRequest) => void;
  // Every ref, since releasing master needs a release branch to merge into.
  refs: readonly GitExplorerRef[];
  onDelete: (reference: GitExplorerRef, status: GitExplorerBranchStatus) => void;
}

interface BranchSelection {
  selected: ReadonlyMap<string, string>;
  onToggle: (reference: GitExplorerRef) => void;
  disabled: boolean;
}

function BranchFolderRow({
  row,
  collapsed,
  onToggle,
  actions,
}: {
  row: Extract<GitExplorerBranchTreeRow, { kind: "folder" }>;
  collapsed: boolean;
  onToggle: (path: string) => void;
  actions?: BranchActions;
}) {
  const Icon = collapsed ? FolderIcon : FolderOpenIcon;
  return (
    <div className="group/branch flex min-w-0 items-center rounded-sm hover:bg-accent">
      <button
        type="button"
        className={cn(ROW_CLASS, "flex-1")}
        aria-label={`${row.path} branch folder`}
        aria-expanded={!collapsed}
        onClick={() => onToggle(row.path)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            if (collapsed === (event.key === "ArrowRight")) onToggle(row.path);
          }
        }}
      >
        <ChevronDownIcon className={cn("size-3 shrink-0", collapsed && "-rotate-90")} aria-hidden />
        <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-medium">{row.label}</span>
      </button>
      {actions ? (
        <span className="mr-0.5 hidden shrink-0 group-any-hover/branch:block group-has-[:focus-visible]/branch:block pointer-coarse:block max-sm:block">
          <Button
            variant="ghost-destructive"
            size="xs"
            aria-label={`Delete local folder ${row.path}`}
            title={actions.deleteUnavailable ?? `Review branches in ${row.path} for deletion`}
            disabled={actions.deleteUnavailable !== null || actions.pendingBranch !== null}
            onClick={() => actions.onDeleteFolder(row.path)}
          >
            <Trash2Icon className="size-3" aria-hidden />
            <span className="pointer-coarse:hidden max-sm:hidden">Delete</span>
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function BranchMergeStatus({
  status,
  description,
}: {
  status: GitExplorerBranchStatus | undefined;
  description: string;
}) {
  const Icon =
    status?.mergeStatus === "merged"
      ? PullRequestGlyph.merged
      : status?.mergeStatus === "equivalent"
        ? EqualIcon
        : status?.mergeStatus === "unmerged"
          ? GitBranchIcon
          : CircleHelpIcon;
  return (
    <GitExplorerHint label={description} className="shrink-0">
      <Icon
        className={cn(
          "size-3",
          status?.mergeStatus === "merged"
            ? "text-success-foreground"
            : status?.mergeStatus === "equivalent"
              ? "text-info-foreground"
              : "text-muted-foreground",
        )}
        aria-hidden
      />
    </GitExplorerHint>
  );
}

function BranchSync({ reference }: { reference: GitExplorerRef }) {
  if (reference.upstream === null) {
    return <span className="shrink-0 text-3xs text-muted-foreground">No upstream</span>;
  }
  if (reference.upstreamMissing) {
    return <span className="shrink-0 text-3xs text-warning-foreground">Missing upstream</span>;
  }
  if (reference.ahead === null || reference.behind === null) {
    return <span className="shrink-0 text-3xs text-muted-foreground">Unknown</span>;
  }
  if (reference.ahead === 0 && reference.behind === 0) {
    return <CheckIcon className="size-3 shrink-0 text-success-foreground" aria-hidden />;
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs leading-none tabular-nums">
      {reference.ahead > 0 ? (
        <span className="flex items-center text-primary">
          <ArrowUpIcon className="size-2.5" aria-hidden />
          {reference.ahead}
        </span>
      ) : null}
      {reference.behind > 0 ? (
        <span className="flex items-center text-warning-foreground">
          <ArrowDownIcon className="size-2.5" aria-hidden />
          {reference.behind}
        </span>
      ) : null}
    </span>
  );
}

function ReferenceRow({
  reference,
  color,
  label,
  current,
  selected,
  onSelect,
  status,
  statusError,
  emphasized = false,
  actions,
  selection,
  tagActions,
}: {
  reference: GitExplorerRef;
  color: number;
  label: string;
  current: boolean;
  selected: boolean;
  onSelect: (revision: string | null) => void;
  status?: GitExplorerBranchStatus;
  statusError?: string | null;
  emphasized?: boolean;
  actions?: BranchActions;
  selection?: BranchSelection;
  tagActions?: TagActions;
}) {
  const palette = GIT_EXPLORER_COLORS[color % GIT_EXPLORER_COLORS.length]!;
  const mergeDescription = statusError
    ? `Merge status unavailable. ${statusError}`
    : describeGitExplorerMerge(status);
  const upstream = gitExplorerUpstreamMergeSummary(reference, status);
  const description =
    reference.kind === "local"
      ? `${reference.shortName}${current ? " · checked out" : ""} · ${formatGitExplorerSync(reference)}${reference.upstream ? ` · ${reference.upstream}` : ""} · Local branch: ${mergeDescription} · ${upstream.description}`
      : `${reference.shortName} · ${reference.kind === "tag" ? "tag" : "remote-tracking branch"}`;
  const slash = label.lastIndexOf("/");
  const pending = actions?.pendingBranch === reference.name;
  const deleteBlock =
    actions?.deleteUnavailable ??
    (actions?.pendingBranch ? "Another branch deletion is in progress." : null) ??
    gitExplorerBranchDeletionBlock(reference, status, true);
  const showActions = (position: { x: number; y: number }) => {
    const canManage = actions && reference.kind === "local";
    const blocked =
      !canManage || actions.deleteUnavailable !== null || actions.pendingBranch !== null;
    const mergeBlocked =
      !actions ||
      reference.kind === "tag" ||
      current ||
      !actions.headBranch ||
      actions.deleteUnavailable !== null ||
      actions.pendingBranch !== null;
    const releasable = actions && gitExplorerReleaseSource([reference], actions.refs) === reference;
    return showGitExplorerContextMenu<
      | "copy-name"
      | "copy-hash"
      | "switch"
      | "rename"
      | "merge"
      | "push-tag"
      | "delete-tag"
      | "release"
      | `release:${GitExplorerReleaseChannel}`
    >(
      [
        {
          id: "copy-name",
          label: reference.kind === "tag" ? "Copy tag name" : "Copy branch name",
          icon: "copy",
        },
        { id: "copy-hash", label: "Copy commit hash", icon: "copy" },
        ...(reference.kind === "tag" && tagActions
          ? [
              {
                id: "push-tag" as const,
                label: "Push tag…",
                disabled: tagActions.unavailable !== null,
                separatorBefore: true,
              },
              {
                id: "delete-tag" as const,
                label: "Delete local tag…",
                disabled: tagActions.unavailable !== null,
              },
            ]
          : []),
        ...(canManage
          ? [
              {
                id: "switch" as const,
                label: "Switch to branch",
                disabled: blocked || current,
                separatorBefore: true,
              },
              { id: "rename" as const, label: "Rename branch…", disabled: blocked },
            ]
          : []),
        ...(actions && reference.kind !== "tag"
          ? [
              {
                id: "merge" as const,
                label: `Merge into ${actions.headBranch ?? "current branch"}…`,
                disabled: mergeBlocked,
                separatorBefore: !canManage,
              },
            ]
          : []),
        ...(releasable
          ? [
              gitExplorerReleaseMenu(
                actions.deleteUnavailable !== null || actions.pendingBranch !== null,
              ),
            ]
          : []),
      ],
      position,
      async (action) => {
        const channel = gitExplorerReleaseMenuChannel(action);
        if (channel) {
          if (releasable && !actions.deleteUnavailable && !actions.pendingBranch)
            actions.onRelease({ channel, reference });
          return;
        }
        if (action === "copy-name")
          await copyGitExplorerValue(
            reference.shortName,
            reference.kind === "tag" ? "tag name" : "branch name",
          );
        else if (action === "copy-hash") await copyGitExplorerValue(reference.hash, "commit hash");
        else if (
          (action === "push-tag" || action === "delete-tag") &&
          tagActions?.unavailable === null
        )
          tagActions.onAction(action === "push-tag" ? "push" : "delete", reference);
        else if (action === "merge" && !mergeBlocked) actions.onMerge(reference);
        else if (!blocked && (action === "rename" || (action === "switch" && !current)))
          actions.onBranchAction(action, reference);
      },
    );
  };
  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void showActions(gitExplorerMenuPosition(event));
      }}
      className={cn(
        "group/branch flex min-w-0 items-center rounded-sm hover:bg-accent",
        (selection ? selection.selected.get(reference.name) === reference.hash : selected) &&
          palette.selected,
      )}
    >
      {selection ? (
        <span className="pl-2">
          <Checkbox
            aria-label={`Select branch ${reference.shortName}`}
            checked={selection.selected.get(reference.name) === reference.hash}
            disabled={selection.disabled}
            onCheckedChange={() => selection.onToggle(reference)}
          />
        </span>
      ) : null}
      <button
        type="button"
        className={cn(
          ROW_CLASS,
          "flex-1",
          reference.kind === "local" &&
            reference.upstream &&
            "h-auto flex-col items-start gap-0 py-1 pointer-coarse:h-auto max-sm:h-auto",
        )}
        onClick={() => (selection ? selection.onToggle(reference) : onSelect(reference.hash))}
        onDoubleClick={() => {
          if (selection) return;
          if (actions && !current && !actions.deleteUnavailable && !actions.pendingBranch)
            actions.onBranchAction("switch", reference);
        }}
        aria-current={!selection && selected ? "true" : undefined}
        aria-pressed={
          selection ? selection.selected.get(reference.name) === reference.hash : undefined
        }
        aria-label={description}
      >
        {!selection && selected ? (
          <span className={cn("absolute inset-y-1 left-0 w-0.5 rounded-full", palette.marker)} />
        ) : null}
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span
            className={cn("flex w-3 shrink-0 items-center justify-center", palette.foreground)}
            aria-hidden
          >
            {reference.kind === "tag" ? (
              <TagIcon className="size-3" />
            ) : current ? (
              <span className="flex size-2.5 items-center justify-center rounded-full ring-1 ring-current ring-inset">
                <span className={cn("size-1.5 rounded-full", palette.marker)} />
              </span>
            ) : (
              <span className={cn("size-1 rounded-full", palette.marker)} />
            )}
          </span>
          <GitExplorerHint className="min-w-0 flex-1 truncate" label={description}>
            {slash >= 0 ? (
              <span className="text-muted-foreground">{label.slice(0, slash + 1)}</span>
            ) : null}
            <span className={cn("text-foreground", (current || emphasized) && "font-semibold")}>
              {label.slice(slash + 1)}
            </span>
          </GitExplorerHint>
          {reference.kind === "local" ? (
            <>
              {!reference.upstreamMissing ? (
                <span
                  className={cn(
                    "shrink-0",
                    actions &&
                      "group-any-hover/branch:hidden group-has-[:focus-visible]/branch:hidden",
                  )}
                >
                  <BranchSync reference={reference} />
                </span>
              ) : null}
              <BranchMergeStatus
                status={status}
                description={`Local branch: ${mergeDescription}`}
              />
            </>
          ) : null}
        </span>
        {reference.kind === "local" && reference.upstream ? (
          <GitExplorerHint
            label={upstream.description}
            className={cn(
              "w-full truncate pl-4.5",
              upstream.mergeStatus === "merged"
                ? "text-success-foreground"
                : upstream.mergeStatus === "equivalent"
                  ? "text-info-foreground"
                  : "text-muted-foreground",
            )}
          >
            {upstream.label}
          </GitExplorerHint>
        ) : null}
      </button>
      {reference.kind === "local" && actions && !selection ? (
        <span
          className={cn(
            "mr-0.5 hidden shrink-0 items-center group-any-hover/branch:flex group-has-[:focus-visible]/branch:flex pointer-coarse:flex max-sm:flex",
            pending && "flex",
          )}
        >
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Actions for branch ${reference.shortName}`}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              void showActions({ x: bounds.left, y: bounds.bottom });
            }}
          >
            <EllipsisIcon className="size-3" aria-hidden />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-destructive"
                  size="xs"
                  aria-label={`Delete local branch ${reference.shortName}`}
                  aria-disabled={deleteBlock !== null}
                  onClick={() => {
                    if (deleteBlock === null && status) actions.onDelete(reference, status);
                  }}
                />
              }
            >
              {pending ? <Spinner size="xs" /> : <Trash2Icon className="size-3" aria-hidden />}
              <span className="pointer-coarse:hidden max-sm:hidden">Delete</span>
            </TooltipTrigger>
            <TooltipPopup>
              {deleteBlock ??
                `Delete local branch ${reference.shortName}${status?.checkedOutAt ? " and its worktree" : ""}`}
            </TooltipPopup>
          </Tooltip>
        </span>
      ) : null}
    </div>
  );
}

function LocalBranchChunk({
  rows,
  colors,
  isExpanded,
  onToggle,
  environmentId,
  input,
  overview,
  selectedRevision,
  onSelect,
  active,
  actions,
  selection,
}: {
  rows: readonly GitExplorerBranchTreeRow[];
  colors: ReadonlyMap<string, number>;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  overview: GitExplorerOverviewResult;
  selectedRevision: string | null | undefined;
  onSelect: (revision: string | null) => void;
  active: boolean;
  actions: BranchActions;
  selection?: BranchSelection;
}) {
  const [visible, setVisible] = useState(false);
  const emphasizedRefs = gitExplorerEmphasizedRefs(overview.refs);
  const branches = rows.flatMap((row) => (row.kind === "branch" ? [row.reference.name] : []));
  const query = useGitExplorerQuery(
    branches.length
      ? gitExplorerEnvironment.branchStatuses({
          environmentId,
          input: {
            ...input,
            snapshotId: overview.snapshotId,
            branches,
          },
        })
      : null,
    active && visible,
  );
  const byName = new Map(query.data?.branches.map((status) => [status.name, status]));
  const observeVisibility = (element: HTMLDivElement) => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting === true),
      { root: element.closest("[data-git-explorer-branches-scroll]") },
    );
    observer.observe(element);
    return () => observer.disconnect();
  };
  return (
    <div ref={observeVisibility}>
      {rows.map((row) => {
        if (row.kind === "folder")
          return (
            <div key={`folder:${row.path}`} style={{ paddingInlineStart: row.depth * 12 }}>
              <BranchFolderRow
                row={row}
                collapsed={!isExpanded(row.path)}
                onToggle={onToggle}
                actions={actions}
              />
            </div>
          );
        const reference = row.reference;
        const candidate = byName.get(reference.name);
        const status = !query.error && candidate?.hash === reference.hash ? candidate : undefined;
        return (
          <div key={reference.name} style={{ paddingInlineStart: row.depth * 12 }}>
            <ReferenceRow
              reference={reference}
              color={colors.get(reference.hash) ?? 0}
              emphasized={emphasizedRefs.has(reference.name)}
              label={row.label}
              current={reference.shortName === overview.headBranch}
              selected={selectedRevision === reference.hash}
              onSelect={onSelect}
              {...(status ? { status } : {})}
              statusError={query.error}
              actions={actions}
              {...(selection ? { selection } : {})}
            />
          </div>
        );
      })}
    </div>
  );
}

function StashRow({
  stash,
  selected,
  onSelect,
  actions,
}: {
  stash: GitExplorerStash;
  selected: boolean;
  onSelect: (revision: string | null) => void;
  actions: StashActions;
}) {
  const description = `${stash.name} · ${stash.subject} · ${new Date(stash.createdAt).toLocaleString()}`;
  const showActions = (position: { x: number; y: number }) =>
    showGitExplorerContextMenu<GitExplorerStashActionKind>(
      [
        { id: "apply-stash", label: "Apply stash…", disabled: actions.unavailable !== null },
        { id: "pop-stash", label: "Pop stash…", disabled: actions.unavailable !== null },
        {
          id: "drop-stash",
          label: "Delete stash…",
          destructive: true,
          separatorBefore: true,
          disabled: actions.unavailable !== null,
        },
      ],
      position,
      (action) => {
        if (!actions.unavailable) actions.onAction(action, stash);
      },
    );
  return (
    <div
      className="group/stash flex min-w-0 items-center"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void showActions(gitExplorerMenuPosition(event));
      }}
    >
      <button
        type="button"
        className={cn(ROW_CLASS, "flex-1")}
        onClick={() => onSelect(stash.hash)}
        aria-current={selected ? "true" : undefined}
        aria-label={description}
      >
        {selected ? (
          <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
        ) : null}
        <ArchiveIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <GitExplorerHint className="flex min-w-0 flex-1 items-center gap-1.5" label={description}>
          <span className="shrink-0 rounded-sm bg-accent px-1 font-mono text-3xs leading-4 text-muted-foreground">
            {stash.name.replace(/^stash@\{(\d+)\}$/, "@$1")}
          </span>
          <span className="min-w-0 truncate">{stash.subject}</span>
        </GitExplorerHint>
      </button>
      <div className="hidden shrink-0 group-any-hover/stash:block group-has-[:focus-visible]/stash:block pointer-coarse:block max-sm:block">
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Actions for ${stash.name}`}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            void showActions({ x: bounds.left, y: bounds.bottom });
          }}
        >
          <EllipsisIcon className="size-3" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function SubmoduleState({ submodule }: { submodule: GitExplorerSubmodule }) {
  if (submodule.state === "in-sync")
    return <CheckIcon className="size-3 shrink-0 text-success-foreground" aria-hidden />;
  if (submodule.state === "out-of-sync")
    return <ArrowRightLeftIcon className="size-3 shrink-0 text-warning-foreground" aria-hidden />;
  if (submodule.state === "conflicted")
    return <TriangleAlertIcon className="size-3 shrink-0 text-destructive" aria-hidden />;
  return <span className="shrink-0 text-3xs text-muted-foreground">Not initialized</span>;
}

function SubmoduleRow({
  submodule,
  onOpen,
}: {
  submodule: GitExplorerSubmodule;
  onOpen: (path: string) => void;
}) {
  const openable = submodule.headHash !== null;
  const description = `${submodule.path} · ${describeGitExplorerSubmodule(submodule)}${submodule.url ? ` · ${submodule.url}` : ""}`;
  const slash = submodule.path.lastIndexOf("/");
  const showActions = (position: { x: number; y: number }) =>
    showGitExplorerContextMenu<"open" | "copy-path" | "copy-hash">(
      [
        { id: "open", label: "Open submodule", disabled: !openable },
        { id: "copy-path", label: "Copy path", icon: "copy", separatorBefore: true },
        ...(submodule.recordedHash
          ? [
              {
                id: "copy-hash" as const,
                label: "Copy recorded commit hash",
                icon: "copy" as const,
              },
            ]
          : []),
      ],
      position,
      async (action) => {
        if (action === "open") {
          if (openable) onOpen(submodule.path);
        } else if (action === "copy-path") await copyGitExplorerValue(submodule.path, "path");
        else if (submodule.recordedHash)
          await copyGitExplorerValue(submodule.recordedHash, "commit hash");
      },
    );
  return (
    <div
      className="flex min-w-0 items-center"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void showActions(gitExplorerMenuPosition(event));
      }}
    >
      <button
        type="button"
        className={cn(ROW_CLASS, "flex-1", !openable && "cursor-default")}
        aria-disabled={!openable}
        onClick={() => {
          if (openable) onOpen(submodule.path);
        }}
        aria-label={`${openable ? "Open submodule " : ""}${description}`}
      >
        <FolderGit2Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <GitExplorerHint className="min-w-0 flex-1 truncate" label={description}>
          {slash >= 0 ? (
            <span className="text-muted-foreground">{submodule.path.slice(0, slash + 1)}</span>
          ) : null}
          <span className={cn(!openable && "text-muted-foreground")}>
            {submodule.path.slice(slash + 1)}
          </span>
        </GitExplorerHint>
        <SubmoduleState submodule={submodule} />
      </button>
    </div>
  );
}

export function GitExplorerBranches({
  overview,
  selectedRevision,
  onSelect,
  environmentId,
  input,
  active,
  actions,
  stashActions,
  onOpenSubmodule,
  tagActions,
}: {
  overview: GitExplorerOverviewResult;
  selectedRevision: string | null | undefined;
  onSelect: (revision: string | null) => void;
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  active: boolean;
  actions: BranchActions;
  stashActions: StashActions;
  onOpenSubmodule: (path: string) => void;
  tagActions?: TagActions;
}) {
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useLocalStorage(
    COLLAPSED_SECTIONS_KEY,
    [],
    CollapsedSections,
  );
  const toggleSection = (section: typeof CollapsibleSection.Type) =>
    setCollapsedSections((current) =>
      current.includes(section)
        ? current.filter((value) => value !== section)
        : [...current, section],
    );
  const [selecting, setSelecting] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState<ReadonlyMap<string, string>>(new Map());
  const selectionDisabled = actions.deleteUnavailable !== null || actions.pendingBranch !== null;
  const selectedReferences = overview.refs.filter(
    (ref) => ref.kind === "local" && selectedBranches.get(ref.name) === ref.hash,
  );
  const selection: BranchSelection | undefined = selecting
    ? {
        selected: selectedBranches,
        disabled: selectionDisabled,
        onToggle: (ref) => {
          if (selectionDisabled) return;
          setSelectedBranches((current) => {
            const next = new Map(current);
            if (next.get(ref.name) === ref.hash) next.delete(ref.name);
            else next.set(ref.name, ref.hash);
            return next;
          });
        },
      }
    : undefined;
  const filter = search.trim().toLocaleLowerCase();
  const referenceColors = gitExplorerReferenceColors(overview.refs);
  const matches = (reference: GitExplorerRef) =>
    reference.shortName.toLocaleLowerCase().includes(filter);
  const [toggledLocal, setToggledLocal] = useState<ReadonlySet<string>>(new Set());
  const [expandedRemote, setExpandedRemote] = useState<ReadonlySet<string>>(new Set());
  const toggleFolder = (current: ReadonlySet<string>, path: string) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  };
  const isLocalExpanded = (path: string) =>
    filter !== "" || gitExplorerFolderExpanded(path, overview.headBranch, toggledLocal.has(path));
  const isRemoteExpanded = (path: string) => filter !== "" || expandedRemote.has(path);
  const emphasizedRefs = gitExplorerEmphasizedRefs(overview.refs);
  const localRefs = overview.refs.filter(
    (reference) => reference.kind === "local" && matches(reference),
  );
  const localRows = gitExplorerBranchRows(localRefs, isLocalExpanded);
  const localChunks: GitExplorerBranchTreeRow[][] = [];
  for (let offset = 0; offset < localRows.length; offset += 32) {
    localChunks.push(localRows.slice(offset, offset + 32));
  }
  const tags = overview.refs
    .filter((reference) => reference.kind === "tag" && matches(reference))
    .toSorted((a, b) => a.shortName.localeCompare(b.shortName));
  // Searching reveals matching tags the same way it expands collapsed branch folders.
  const tagsCollapsed = !filter && collapsedSections.includes("tags");
  const submodules = overview.submodules ?? [];
  const remoteGroups = new Map<string, GitExplorerRef[]>();
  for (const reference of overview.refs) {
    if (reference.kind !== "remote" || !matches(reference)) continue;
    const prefix = reference.shortName.split("/")[0] ?? reference.shortName;
    const refs = remoteGroups.get(prefix) ?? [];
    refs.push(reference);
    remoteGroups.set(prefix, refs);
  }

  return (
    <nav className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Repository references">
      <div className="shrink-0 px-1.5 pt-1.5">
        <Input
          size="compact"
          type="search"
          aria-label="Search branches and tags"
          placeholder="Search branches and tags"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {selecting ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-3.5 py-1">
          <label className="flex items-center gap-1.5 text-2xs">
            <Checkbox
              checked={
                localRefs.length > 0 &&
                localRefs.every((ref) => selectedBranches.get(ref.name) === ref.hash)
              }
              indeterminate={
                localRefs.some((ref) => selectedBranches.get(ref.name) === ref.hash) &&
                !localRefs.every((ref) => selectedBranches.get(ref.name) === ref.hash)
              }
              disabled={selectionDisabled || localRefs.length === 0}
              onCheckedChange={(checked) =>
                setSelectedBranches((current) => {
                  const next = new Map(current);
                  for (const ref of localRefs) {
                    if (checked) next.set(ref.name, ref.hash);
                    else next.delete(ref.name);
                  }
                  return next;
                })
              }
            />
            {filter ? "All matching" : "All"}
          </label>
          <span className="ml-auto">
            <Button
              variant="ghost-destructive"
              size="xs"
              disabled={selectionDisabled || selectedReferences.length === 0}
              onClick={() => actions.onDeleteBranches(selectedReferences)}
            >
              Delete selected ({selectedReferences.length})
            </Button>
          </span>
        </div>
      ) : null}
      <div
        data-git-explorer-branches-scroll
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1.5 py-2"
      >
        <section aria-label="Local branches">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h2 className={HEADING_CLASS}>
              <GitBranchIcon className="size-3" aria-hidden />
              Local branches
              <span className="font-mono text-3xs tabular-nums">{localRefs.length}</span>
            </h2>
            <Button
              variant="ghost"
              size="xs"
              disabled={selectionDisabled && !selecting}
              onClick={() => {
                setSelecting(!selecting);
                setSelectedBranches(new Map());
              }}
            >
              {selecting ? "Cancel" : "Select"}
            </Button>
          </div>
          <button
            type="button"
            className={ROW_CLASS}
            aria-current={selectedRevision === null ? "page" : undefined}
            onClick={() => onSelect(null)}
          >
            {selectedRevision === null ? (
              <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
            ) : null}
            <HardDriveIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">Working Tree</span>
          </button>
          {localChunks.map((rows) => (
            <LocalBranchChunk
              key={rows[0]!.kind === "branch" ? rows[0]!.reference.name : rows[0]!.path}
              rows={rows}
              colors={referenceColors}
              isExpanded={isLocalExpanded}
              onToggle={(path) => setToggledLocal((current) => toggleFolder(current, path))}
              environmentId={environmentId}
              input={input}
              overview={overview}
              selectedRevision={selectedRevision}
              onSelect={onSelect}
              active={active}
              actions={actions}
              {...(selection ? { selection } : {})}
            />
          ))}
          {localRefs.length === 0 ? (
            <p className="px-2 text-2xs text-muted-foreground">No local branches</p>
          ) : null}
        </section>
        <section aria-label="Remote-tracking branches">
          <h2 className={HEADING_CLASS}>
            <GlobeIcon className="size-3" aria-hidden />
            Remotes
            <span className="ml-auto font-mono text-3xs tabular-nums">{remoteGroups.size}</span>
          </h2>
          {[...remoteGroups].map(([prefix, references]) => (
            <details key={prefix} open className="group/remote">
              <summary className="flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-sm px-2 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:h-7 max-sm:h-9">
                <ChevronDownIcon
                  className="size-3 shrink-0 -rotate-90 group-open/remote:rotate-0"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-medium">{prefix}</span>
                <span className="font-mono text-3xs tabular-nums text-muted-foreground">
                  {references.length}
                </span>
              </summary>
              <div className="ml-3.5 border-l border-border/70 pl-1">
                {gitExplorerBranchRows(
                  references,
                  (path) => isRemoteExpanded(`${prefix}/${path}`),
                  `${prefix}/`,
                ).map((row) => (
                  <div
                    key={row.kind === "folder" ? `folder:${row.path}` : row.reference.name}
                    style={{ paddingInlineStart: row.depth * 12 }}
                  >
                    {row.kind === "folder" ? (
                      <BranchFolderRow
                        row={row}
                        collapsed={!isRemoteExpanded(`${prefix}/${row.path}`)}
                        onToggle={(path) =>
                          setExpandedRemote((current) => toggleFolder(current, `${prefix}/${path}`))
                        }
                      />
                    ) : (
                      <ReferenceRow
                        reference={row.reference}
                        color={referenceColors.get(row.reference.hash) ?? 0}
                        emphasized={emphasizedRefs.has(row.reference.name)}
                        label={row.label}
                        current={false}
                        selected={selectedRevision === row.reference.hash}
                        onSelect={onSelect}
                      />
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
          {remoteGroups.size === 0 ? (
            <p className="px-2 text-2xs text-muted-foreground">No remote-tracking branches</p>
          ) : null}
        </section>
        <section aria-label="Tags">
          <SectionHeading
            icon={TagIcon}
            label="Tags"
            count={tags.length}
            collapsed={tagsCollapsed}
            onToggle={() => toggleSection("tags")}
          />
          {tagsCollapsed ? null : (
            <>
              {tags.map((reference) => (
                <ReferenceRow
                  key={reference.name}
                  reference={reference}
                  color={referenceColors.get(reference.hash) ?? 0}
                  label={reference.shortName}
                  current={false}
                  selected={selectedRevision === reference.hash}
                  onSelect={onSelect}
                  {...(tagActions ? { tagActions } : {})}
                />
              ))}
              {tags.length === 0 ? (
                <p className="px-2 text-2xs text-muted-foreground">No tags</p>
              ) : null}
            </>
          )}
        </section>
        <section aria-label="Stashes">
          <SectionHeading
            icon={ArchiveIcon}
            label="Stashes"
            count={overview.stashes.length}
            collapsed={collapsedSections.includes("stashes")}
            onToggle={() => toggleSection("stashes")}
          />
          {collapsedSections.includes("stashes") ? null : (
            <>
              {overview.stashes.map((stash) => (
                <StashRow
                  key={stash.name}
                  stash={stash}
                  actions={stashActions}
                  selected={selectedRevision === stash.hash}
                  onSelect={onSelect}
                />
              ))}
              {overview.stashes.length === 0 ? (
                <p className="px-2 text-2xs text-muted-foreground">No stashes</p>
              ) : null}
            </>
          )}
        </section>
        {submodules.length > 0 ? (
          <section aria-label="Submodules">
            <SectionHeading
              icon={FolderGit2Icon}
              label="Submodules"
              count={submodules.length}
              collapsed={collapsedSections.includes("submodules")}
              onToggle={() => toggleSection("submodules")}
            />
            {collapsedSections.includes("submodules")
              ? null
              : submodules.map((submodule) => (
                  <SubmoduleRow
                    key={submodule.path}
                    submodule={submodule}
                    onOpen={onOpenSubmodule}
                  />
                ))}
          </section>
        ) : null}
      </div>
    </nav>
  );
}
