import { LegendList } from "@legendapp/list/react";
import type { CodeViewDiffItem } from "@pierre/diffs";
import type {
  EnvironmentId,
  GitExplorerDetailsResult,
  GitExplorerFile,
  GitExplorerOverviewInput,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  Columns2Icon,
  FileIcon,
  Rows3Icon,
} from "lucide-react";
import { useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useRenderedAppearance } from "~/hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { gitExplorerEnvironment } from "~/state/git-explorer";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { GitExplorerNotice } from "./GitExplorerNotice";
import { GitExplorerHint } from "./GitExplorerHint";
import { useGitExplorerQuery } from "./useGitExplorerQuery";
import { useGitExplorerListNavigation } from "./useGitExplorerListNavigation";
import {
  GitExplorerWorkingTree,
  type GitExplorerWorkingTreeActions,
} from "./GitExplorerWorkingTree";

import { useGitExplorerFileMenu } from "./useGitExplorerFileMenu";
import { gitExplorerMenuPosition } from "./gitExplorerContextMenu";

const FILE_STATUS = {
  added: { label: "A", color: "text-success-foreground" },
  modified: { label: "M", color: "text-warning-foreground" },
  deleted: { label: "D", color: "text-destructive" },
  renamed: { label: "R", color: "text-info-foreground" },
  copied: { label: "C", color: "text-info-foreground" },
  unmerged: { label: "!", color: "text-destructive" },
  untracked: { label: "?", color: "text-muted-foreground" },
};

const STAGE_LABELS = {
  committed: "Committed",
  staged: "Staged",
  unstaged: "Unstaged",
  untracked: "Untracked",
  "stash-untracked": "Saved untracked",
};

const REVIEW_HEADER_CLASS =
  "flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3";

function fileKey(file: GitExplorerFile) {
  return `${file.stage}:${file.path}`;
}

function FileStats({ file }: { file: GitExplorerFile }) {
  return file.binary ? (
    <span className="text-xs text-muted-foreground">Binary</span>
  ) : (
    <span className="flex shrink-0 gap-1.5 font-mono text-xs tabular-nums">
      {file.additions !== null ? (
        <span className="text-success-foreground">+{file.additions}</span>
      ) : null}
      {file.deletions !== null ? <span className="text-destructive">−{file.deletions}</span> : null}
    </span>
  );
}

function CommitMetadata({ details }: { details: GitExplorerDetailsResult }) {
  const commit = details.commit;
  const stash = details.stash;
  if (!commit) {
    return (
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/20 px-3 py-2">
        <h2 className="text-xs font-medium">Working Tree</h2>
        <p className="text-xs text-muted-foreground">
          Uncommitted changes in the selected worktree.
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border bg-muted/20 px-3 py-2">
      <details className="group/metadata">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-sm text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          {stash ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ArchiveIcon className="size-3.5" aria-hidden />
              <span className="font-mono">{stash.name}</span>
            </span>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate font-medium">
            {stash?.subject ?? commit.subject}
          </h2>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {commit.hash.slice(0, 8)}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            Details
            <ChevronDownIcon
              className="size-3 -rotate-90 group-open/metadata:rotate-0"
              aria-hidden
            />
          </span>
        </summary>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p className="break-words font-medium text-foreground">{commit.subject}</p>
          <p className="break-words">
            {commit.authorName} &lt;{commit.authorEmail}&gt;
          </p>
          <p className="break-all font-mono">{commit.hash}</p>
          {commit.body ? <p className="whitespace-pre-wrap break-words">{commit.body}</p> : null}
        </div>
      </details>
      <p className="mt-0.5 break-words text-xs text-muted-foreground">
        {commit.authorName} · {new Date(stash?.createdAt ?? commit.authoredAt).toLocaleString()} ·{" "}
        {stash
          ? details.comparisonParent
            ? `Stash · comparing base ${details.comparisonParent.slice(0, 8)}`
            : "Stash snapshot"
          : details.comparisonParent
            ? `${commit.parents.length > 1 ? "Merge commit · comparing first parent" : "Comparing parent"} ${details.comparisonParent.slice(0, 8)}`
            : "Root commit · comparing the empty tree"}
      </p>
    </div>
  );
}

function FilePatch({
  environmentId,
  input,
  revision,
  file,
}: {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  revision: string | null;
  file: GitExplorerFile;
}) {
  const theme = useRenderedAppearance();
  const compact = useMediaQuery("max-md");
  const diffLayout = useClientSettings((settings) => settings.diffLayout);
  const patchQuery = useGitExplorerQuery(
    gitExplorerEnvironment.patch({
      environmentId,
      input: { ...input, revision, path: file.path, stage: file.stage },
    }),
  );
  const patch = patchQuery.data;
  const parsed = getRenderablePatch(patch?.patch, `git-explorer:${revision}:${fileKey(file)}`, {
    compactPartialHunkOffsets: true,
  });
  const items: CodeViewDiffItem<undefined>[] =
    parsed?.kind === "files"
      ? parsed.files.map((fileDiff) => ({
          id: buildFileDiffIdentityKey(fileDiff),
          type: "diff",
          fileDiff,
          version: buildFileDiffContentVersion(fileDiff),
        }))
      : [];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Diff for ${file.path}`}>
      <header className={REVIEW_HEADER_CLASS}>
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <GitExplorerHint className="min-w-0 flex-1 truncate text-xs" label={file.path}>
          {file.path}
        </GitExplorerHint>
        {file.stage === "stash-untracked" ? (
          <span className="shrink-0 text-xs text-muted-foreground">Saved untracked</span>
        ) : null}
        <FileStats file={file} />
        {!compact ? (
          <ToggleGroup
            value={[diffLayout]}
            onValueChange={(values) => {
              const value = values[0];
              if (value === "split" || value === "stacked") {
                void updateClientSettings({ diffLayout: value });
              }
            }}
            aria-label="Diff layout"
          >
            <Toggle value="stacked" aria-label="Inline diff">
              <Rows3Icon className="size-3.5" />
            </Toggle>
            <Toggle value="split" aria-label="Side-by-side diff">
              <Columns2Icon className="size-3.5" />
            </Toggle>
          </ToggleGroup>
        ) : null}
      </header>
      {file.oldPath ? (
        <p className="break-all border-b border-border px-3 py-2 text-xs text-muted-foreground">
          Renamed from {file.oldPath}
        </p>
      ) : null}
      {patchQuery.error ? (
        <GitExplorerNotice title="Could not load this diff" retry={patchQuery.refresh}>
          {patchQuery.error}
        </GitExplorerNotice>
      ) : !patch ? (
        <GitExplorerNotice title="Loading diff…" />
      ) : patch.binary ? (
        <GitExplorerNotice title="Binary file changed">
          A text diff is not available for this file.
        </GitExplorerNotice>
      ) : (
        <>
          {patch.truncated ? (
            <p
              className="border-b border-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground"
              role="status"
            >
              This diff exceeds the preview limit.
            </p>
          ) : null}
          {parsed?.kind === "files" ? (
            <StyledDiffCodeView
              key={fileKey(file)}
              items={items}
              className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [--diffs-font-size:var(--text-xs)]"
              unsafeCSSExtra="[data-separator] [data-separator-content] { font-size: var(--diffs-font-size) !important; }"
              options={{
                diffStyle: !compact && diffLayout === "split" ? "split" : "unified",
                overflow: "wrap",
                disableFileHeader: true,
                theme: resolveDiffThemeName(theme),
                themeType: theme,
                preferredHighlighter: PREFERRED_HIGHLIGHTER,
              }}
            />
          ) : parsed?.kind === "raw" ? (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <p className="mb-3 text-xs text-muted-foreground">{parsed.reason}</p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{parsed.text}</pre>
            </div>
          ) : (
            <GitExplorerNotice
              title={patch.truncated ? "Diff is too large to preview" : "No text changes"}
            >
              {file.status === "unmerged"
                ? "This file has unresolved merge conflicts."
                : "This change may only affect a file's name, mode, or contents outside the preview."}
            </GitExplorerNotice>
          )}
        </>
      )}
    </section>
  );
}

export function GitExplorerReview({
  environmentId,
  input,
  revision,
  compact,
  onBack,
  workingTreeActions,
  workspacePath,
}: {
  environmentId: EnvironmentId;
  input: GitExplorerOverviewInput;
  revision: string | null;
  compact: boolean;
  onBack: () => void;
  workingTreeActions?: GitExplorerWorkingTreeActions;
  workspacePath?: string;
}) {
  const showFileMenu = useGitExplorerFileMenu(environmentId, workspacePath);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const touch = useMediaQuery({ pointer: "coarse" });
  const fileRowHeight = compact || touch ? 40 : 28;
  const detailsQuery = useGitExplorerQuery(
    gitExplorerEnvironment.details({ environmentId, input: { ...input, revision } }),
  );
  const details = detailsQuery.data;
  const files = details?.files ?? [];
  const selectedFile = files.find((file) => fileKey(file) === selectedFileKey) ?? files[0] ?? null;
  const stageCounts = new Map<string, number>();
  for (const file of files) stageCounts.set(file.stage, (stageCounts.get(file.stage) ?? 0) + 1);
  const selectFile = (file: GitExplorerFile) => {
    setSelectedFileKey(fileKey(file));
    setShowDiff(true);
  };
  const navigation = useGitExplorerListNavigation({
    count: files.length,
    selectedIndex: selectedFile ? files.indexOf(selectedFile) : -1,
    rowHeight: fileRowHeight,
    onSelect: (index) => selectFile(files[index]!),
  });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {compact ? (
        <div className="flex h-11 shrink-0 items-center border-b border-border px-2">
          <Button variant="ghost" size="sm" onClick={showDiff ? () => setShowDiff(false) : onBack}>
            <ArrowLeftIcon className="size-4" />
            {showDiff ? "Changed files" : "History"}
          </Button>
        </div>
      ) : null}
      {detailsQuery.error ? (
        <GitExplorerNotice title="Could not load changes" retry={detailsQuery.refresh}>
          {detailsQuery.error}
        </GitExplorerNotice>
      ) : !details ? (
        <GitExplorerNotice title="Loading changes…" />
      ) : (
        <>
          <div className={cn("shrink-0", compact && showDiff && "hidden")}>
            <CommitMetadata details={details} />
          </div>
          {revision === null && workingTreeActions ? (
            <GitExplorerWorkingTree
              {...workingTreeActions}
              environmentId={environmentId}
              input={input}
              details={details}
              selectedFile={selectedFile}
            />
          ) : null}
          {details.truncated ? (
            <p className="border-b border-border bg-warning-surface px-4 py-2 text-xs text-warning-foreground">
              The changed-file list was limited. Additional files may be omitted.
            </p>
          ) : null}
          {files.length === 0 ? (
            <GitExplorerNotice
              title={revision === null ? "Working tree clean" : "No changed files"}
            >
              {revision === null
                ? "There are no staged, unstaged, or untracked changes."
                : details.stash
                  ? "This stash has no saved file changes against its base."
                  : "This commit has no file changes against the selected comparison."}
            </GitExplorerNotice>
          ) : (
            <div className={cn("flex min-h-0 min-w-0 flex-1", compact ? "flex-col" : "flex-row")}>
              <section
                className={cn(
                  "min-h-0 min-w-0 flex-col border-border",
                  compact ? "flex-1" : "w-[30%] min-w-52 max-w-88 shrink-0 border-r",
                  compact && showDiff ? "hidden" : "flex",
                )}
                aria-label="Changed files"
              >
                <div className={cn(REVIEW_HEADER_CLASS, "text-xs text-muted-foreground")}>
                  <GitExplorerHint
                    className="min-w-0 truncate"
                    label={
                      revision === null
                        ? [...stageCounts].map(([stage, count]) => `${count} ${stage}`).join(" · ")
                        : `${files.length} changed ${files.length === 1 ? "file" : "files"}`
                    }
                  >
                    {files.length} changed {files.length === 1 ? "file" : "files"}
                  </GitExplorerHint>
                </div>
                <LegendList
                  {...navigation.listProps}
                  aria-label="Changed files"
                  data={files}
                  keyExtractor={fileKey}
                  estimatedItemSize={fileRowHeight}
                  getFixedItemSize={() => fileRowHeight}
                  extraData={selectedFile ? fileKey(selectedFile) : null}
                  className="min-h-0 flex-1 overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  renderItem={({ item: file, index }) => (
                    <button
                      type="button"
                      {...navigation.optionProps(index)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void showFileMenu(file, gitExplorerMenuPosition(event));
                      }}
                      aria-current={
                        selectedFile && fileKey(file) === fileKey(selectedFile) ? "true" : undefined
                      }
                      style={{ height: fileRowHeight }}
                      className="flex w-full items-center gap-2 px-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-current:bg-primary/10"
                    >
                      <span
                        className={cn(
                          "w-4 shrink-0 font-mono text-xs",
                          FILE_STATUS[file.status].color,
                        )}
                        aria-label={file.status}
                      >
                        {FILE_STATUS[file.status].label}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <GitExplorerHint className="block truncate text-xs" label={file.path}>
                          {file.path}
                        </GitExplorerHint>
                        {file.stage !== "committed" ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {STAGE_LABELS[file.stage]}
                          </span>
                        ) : null}
                      </span>
                      <FileStats file={file} />
                    </button>
                  )}
                />
              </section>
              <div
                className={cn(
                  "min-h-0 min-w-0 flex-1 flex-col",
                  !compact || showDiff ? "flex" : "hidden",
                )}
              >
                {selectedFile && (!compact || showDiff) ? (
                  <FilePatch
                    key={fileKey(selectedFile)}
                    environmentId={environmentId}
                    input={input}
                    revision={revision}
                    file={selectedFile}
                  />
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
