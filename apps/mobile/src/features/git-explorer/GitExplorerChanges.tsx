import { useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import type { GitExplorerFile, GitExplorerOverviewResult } from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { cn } from "../../lib/cn";
import { gitExplorerEnvironment } from "../../state/git-explorer";
import { useActiveGitQuery } from "./useActiveGitQuery";
import { GitExplorerDiff } from "./GitExplorerDiff";
import { gitExplorerTarget, type GitExplorerParams } from "./useGitExplorer";

const REVIEW_ROW_HEIGHT = 44;

function fileKey(file: GitExplorerFile) {
  return JSON.stringify([file.stage, file.path]);
}

function fileChangeLabel(file: GitExplorerFile, stash: boolean) {
  if (file.stage === "stash-untracked") return "Saved untracked";
  if (file.stage === "committed") return stash ? `Saved · ${file.status}` : file.status;
  return `${file.stage} · ${file.status}`;
}

export function GitExplorerChanges(props: {
  readonly params: GitExplorerParams;
  readonly overview: GitExplorerOverviewResult;
  readonly revision: string | null;
  readonly split: boolean;
  readonly active: boolean;
  readonly onBack: () => void;
}) {
  const target = gitExplorerTarget(props.params);
  const input = { ...target.input, revision: props.revision };
  const details = useActiveGitQuery(
    gitExplorerEnvironment.details({ ...target, input }),
    props.active,
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const files = details.data?.files ?? [];
  const explicitIndex = files.findIndex((file) => fileKey(file) === selectedKey);
  const selectedIndex = explicitIndex >= 0 ? explicitIndex : props.split ? 0 : -1;
  const selectedFile = files[selectedIndex];
  const patch = useActiveGitQuery(
    selectedFile
      ? gitExplorerEnvironment.patch({
          ...target,
          input: { ...input, path: selectedFile.path, stage: selectedFile.stage },
        })
      : null,
    props.active,
  );
  const commit = details.data?.commit;
  const stash =
    details.data?.stash ??
    props.overview.stashes.find((entry) => entry.hash === props.revision) ??
    null;
  const reviewTitle = stash
    ? `${stash.name} · ${stash.subject}`
    : (commit?.subject ?? "Uncommitted changes");
  const refs = props.overview.refs.filter((ref) => ref.hash === props.revision);
  const showDiff = selectedFile !== undefined;
  const showFiles = props.split || !showDiff;
  const comparison = stash
    ? details.data?.comparisonParent
      ? `Stash · base ${details.data.comparisonParent.slice(0, 8)}`
      : "Stash · saved changes"
    : commit
      ? details.data?.comparisonParent
        ? `${commit.parents.length > 1 ? "Merge · first parent" : "Parent"} ${details.data.comparisonParent.slice(0, 8)}`
        : "Root commit · empty tree"
      : "Staged: index vs HEAD · unstaged: files vs index";
  return (
    <View className="min-h-0 min-w-0 flex-1 bg-sheet-solid">
      {!props.split ? (
        <View className="h-11 flex-row items-center justify-between gap-2 border-b border-border px-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showDiff ? "Back to changed files" : "Back to history"}
            className="min-h-11 justify-center"
            onPress={showDiff ? () => setSelectedKey(null) : props.onBack}
          >
            <Text className="text-sm text-primary-text">
              ‹ {showDiff ? "Changed files" : "History"}
            </Text>
          </Pressable>
          <Text
            numberOfLines={1}
            className="min-w-0 shrink text-xs font-t3-semibold text-foreground"
          >
            {stash?.name ?? props.revision?.slice(0, 8) ?? "Working Tree"}
          </Text>
        </View>
      ) : null}
      {details.error ? (
        <EmptyState
          variant="plain"
          title="Could not load changes"
          detail={details.error}
          actionLabel="Retry"
          onAction={details.refresh}
        />
      ) : null}
      {details.isPending && !details.data ? (
        <View className="p-8">
          <AppActivityIndicator />
        </View>
      ) : null}
      {details.data ? (
        <>
          {showFiles ? (
            <View className="border-b border-border">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${metadataExpanded ? "Hide" : "Show"} ${stash ? "stash" : "commit"} details. ${reviewTitle}. ${comparison}`}
                accessibilityState={{ expanded: metadataExpanded }}
                onPress={() => setMetadataExpanded((expanded) => !expanded)}
                className="gap-0.5 px-3 py-2"
                style={{ minHeight: props.split ? 48 : 56 }}
              >
                <View className="flex-row items-center gap-2">
                  <Text
                    numberOfLines={1}
                    className="min-w-0 flex-1 text-xs font-t3-semibold text-foreground"
                  >
                    {reviewTitle}
                  </Text>
                  <Text className="text-[11px] leading-[14px] text-primary-text">
                    Details {metadataExpanded ? "▴" : "▾"}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  className="text-[11px] leading-[14px] text-foreground-muted"
                >
                  {files.length} {files.length === 1 ? "file" : "files"} · +
                  {files.reduce((total, file) => total + (file.additions ?? 0), 0)} −
                  {files.reduce((total, file) => total + (file.deletions ?? 0), 0)} · {comparison}
                </Text>
              </Pressable>
              {metadataExpanded ? (
                <ScrollView
                  style={{ maxHeight: props.split ? 120 : 180 }}
                  contentContainerClassName="gap-1 px-3 pb-3"
                >
                  <Text selectable className="text-xs text-foreground">
                    {stash
                      ? `Saved stash ${stash.name}: ${stash.subject}`
                      : (commit?.subject ?? "Only the selected worktree is shown.")}
                  </Text>
                  {commit ? (
                    <>
                      <Text selectable className="text-xs text-foreground-muted">
                        {commit.authorName} &lt;{commit.authorEmail}&gt;
                      </Text>
                      <Text selectable className="text-xs text-foreground-muted">
                        {stash ? "Saved " : ""}
                        {new Date(stash?.createdAt ?? commit.authoredAt).toLocaleString()} ·{" "}
                        {commit.hash}
                      </Text>
                      {commit.body ? (
                        <Text selectable className="text-xs text-foreground">
                          {commit.body}
                        </Text>
                      ) : null}
                      {refs.length > 0 ? (
                        <Text selectable className="text-xs text-primary-text">
                          {refs
                            .map((ref) => `${ref.kind === "tag" ? "Tag " : ""}${ref.shortName}`)
                            .join(" · ")}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                  <Text className="text-xs text-foreground-muted">{comparison}</Text>
                </ScrollView>
              ) : null}
              {details.data.truncated ? (
                <Text className="px-3 pb-2 text-xs text-warning-foreground">
                  The file list exceeds the preview limit. Some files are omitted.
                </Text>
              ) : null}
            </View>
          ) : null}
          <View className={cn("min-h-0 flex-1", props.split ? "flex-row" : "flex-col")}>
            {showFiles ? (
              <View
                className={props.split ? "min-h-0 border-r border-border" : "min-h-0 flex-1"}
                style={props.split ? { width: 190 } : undefined}
              >
                <FlatList
                  data={files}
                  keyExtractor={fileKey}
                  initialNumToRender={20}
                  contentInsetAdjustmentBehavior="never"
                  ListEmptyComponent={
                    <Text className="p-3 text-xs text-foreground-muted">
                      {props.revision === null
                        ? "This worktree is clean."
                        : "No files changed in this comparison."}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${fileChangeLabel(item, stash !== null)}, ${item.path}${item.oldPath ? `, previously ${item.oldPath}` : ""}`}
                      accessibilityState={{ selected: item === selectedFile }}
                      onPress={() => setSelectedKey(fileKey(item))}
                      style={{ minHeight: props.split ? REVIEW_ROW_HEIGHT : 48 }}
                      className={cn(
                        "justify-center gap-0.5 px-3 py-1",
                        item === selectedFile ? "bg-primary/10" : "bg-sheet-solid",
                      )}
                    >
                      <Text numberOfLines={1} className="text-xs text-foreground">
                        {item.path}
                      </Text>
                      <View className="flex-row items-center justify-between gap-1">
                        <Text
                          numberOfLines={1}
                          className="min-w-0 shrink text-[11px] leading-[14px] text-foreground-muted"
                        >
                          {fileChangeLabel(item, stash !== null)}
                        </Text>
                        <Text className="text-[11px] leading-[14px] text-foreground-muted">
                          {item.binary
                            ? "Binary"
                            : `+${item.additions ?? "?"} −${item.deletions ?? "?"}`}
                        </Text>
                      </View>
                      <View
                        pointerEvents="none"
                        className="absolute inset-x-0 bottom-0 h-px bg-border-subtle"
                      />
                    </Pressable>
                  )}
                />
              </View>
            ) : null}
            {selectedFile ? (
              <View className="min-h-0 min-w-0 flex-1">
                <View className="px-3">
                  <View
                    style={{ height: REVIEW_ROW_HEIGHT }}
                    className="flex-row items-center gap-1"
                  >
                    <Text
                      selectable
                      numberOfLines={1}
                      className="min-w-0 flex-1 text-xs font-t3-semibold text-foreground"
                    >
                      {selectedFile.path}
                    </Text>
                    <Text className="text-[11px] leading-[14px] text-foreground-muted">
                      {selectedIndex + 1}/{files.length}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Previous changed file"
                      disabled={selectedIndex <= 0}
                      onPress={() => {
                        const file = files[selectedIndex - 1];
                        if (file) setSelectedKey(fileKey(file));
                      }}
                      style={{ minHeight: REVIEW_ROW_HEIGHT, minWidth: REVIEW_ROW_HEIGHT }}
                      className="items-center justify-center disabled:opacity-30"
                    >
                      <Text className="text-lg text-primary-text">‹</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Next changed file"
                      disabled={selectedIndex >= files.length - 1}
                      onPress={() => {
                        const file = files[selectedIndex + 1];
                        if (file) setSelectedKey(fileKey(file));
                      }}
                      style={{ minHeight: REVIEW_ROW_HEIGHT, minWidth: REVIEW_ROW_HEIGHT }}
                      className="items-center justify-center disabled:opacity-30"
                    >
                      <Text className="text-lg text-primary-text">›</Text>
                    </Pressable>
                  </View>
                  {selectedFile.oldPath ? (
                    <Text
                      selectable
                      className="pb-1 text-[11px] leading-[14px] text-foreground-muted"
                    >
                      {selectedFile.status === "copied" ? "Copied" : "Renamed"} from{" "}
                      {selectedFile.oldPath}
                    </Text>
                  ) : null}
                  {selectedFile.stage === "stash-untracked" ||
                  (!props.split && selectedFile.stage !== "committed") ? (
                    <Text className="pb-1 text-[11px] leading-[14px] text-foreground-muted">
                      {selectedFile.stage === "stash-untracked"
                        ? "Saved untracked · compared with empty tree"
                        : selectedFile.stage}
                    </Text>
                  ) : null}
                  <View
                    pointerEvents="none"
                    className="absolute inset-x-0 bottom-0 h-px bg-border"
                  />
                </View>
                {patch.error ? (
                  <EmptyState
                    variant="plain"
                    title="Could not load diff"
                    detail={patch.error}
                    actionLabel="Retry"
                    onAction={patch.refresh}
                  />
                ) : patch.data ? (
                  <GitExplorerDiff
                    result={patch.data}
                    scope={JSON.stringify([
                      target,
                      props.revision,
                      selectedFile.stage,
                      selectedFile.path,
                    ])}
                  />
                ) : (
                  <View className="p-8">
                    <AppActivityIndicator />
                  </View>
                )}
              </View>
            ) : null}
          </View>
          {selectedKey !== null && !selectedFile ? (
            <View className="gap-3 p-4">
              <Text className="text-sm text-foreground-muted">
                This file is no longer in the selected comparison.
              </Text>
              <Button label="Return to changed files" onPress={() => setSelectedKey(null)} />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
