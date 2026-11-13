import { gitExplorerReferenceColors } from "@t3tools/client-runtime/git-explorer-colors";
import { useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, View } from "react-native";
import type {
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerStash,
  GitExplorerSubmodule,
} from "@t3tools/contracts";
import {
  describeGitExplorerSubmodule,
  gitExplorerBranchRows,
  gitExplorerFolderExpanded,
} from "@t3tools/client-runtime/git-explorer";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { ThreadListV2Section } from "../threads/thread-list-v2-items";
import {
  THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE,
  THREAD_LIST_V2_SIDEBAR_ROW_STYLE,
  selectedThreadRowColors,
} from "../threads/thread-list-v2-row-appearance";
import { GitExplorerBranchRow } from "./GitExplorerBranchRow";
import { GitExplorerBranchDeletion } from "./GitExplorerBranchDeletion";
import { GitExplorerReleaseSheet } from "./GitExplorerReleaseSheet";
import type { GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerBranchActions } from "./useGitExplorerBranchActions";

type CollapsibleSection = "tags" | "stashes" | "submodules";
const SECTION_SYMBOLS = { tags: "tag", stashes: "archivebox", submodules: "cube" } as const;
const SUBMODULE_STATES = {
  "in-sync": { icon: "checkmark", tint: "accent-adaptive-emerald-600-400" },
  "out-of-sync": { icon: "exclamationmark.circle", tint: "accent-warning-foreground" },
  conflicted: { icon: "exclamationmark.triangle", tint: "accent-danger-foreground" },
  uninitialized: { icon: "circle.dashed", tint: "accent-icon-muted" },
} as const;

type BranchRow =
  | {
      readonly kind: "heading";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
      readonly section?: CollapsibleSection;
    }
  | {
      readonly kind: "folder";
      readonly id: string;
      readonly label: string;
      readonly depth: number;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "ref";
      readonly ref: GitExplorerRef;
      readonly displayName: string;
      readonly depth: number;
      readonly statusBranches?: readonly string[];
    }
  | { readonly kind: "stash"; readonly stash: GitExplorerStash }
  | { readonly kind: "submodule"; readonly submodule: GitExplorerSubmodule }
  | { readonly kind: "empty"; readonly id: string; readonly label: string };

export function GitExplorerBranches(props: {
  readonly overview: GitExplorerOverviewResult;
  readonly params: GitExplorerParams;
  readonly active: boolean;
  readonly tablet: boolean;
  /** Styled like the thread and pull request lists, for the workspace list column. */
  readonly sidebar?: { readonly header: ReactNode; readonly bottomInset: number };
  readonly selectedRevision: string | null;
  readonly onSelect: (revision: string) => void;
  readonly onOpenSubmodule: (path: string) => void;
  readonly onRefresh: () => void;
}) {
  const colors = useMemo(
    () => gitExplorerReferenceColors(props.overview.refs),
    [props.overview.refs],
  );
  const rowHeight = props.tablet ? 28 : 36;
  const sidebar = props.sidebar !== undefined;
  const actions = useGitExplorerBranchActions(props.params, props.onRefresh);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());
  const [deleting, setDeleting] = useState<readonly GitExplorerRef[] | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<CollapsibleSection>>(new Set());
  const toggleSection = (section: CollapsibleSection) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  const [toggledFolders, setToggledFolders] = useState<ReadonlySet<string>>(new Set());
  const toggleFolder = (id: string) =>
    setToggledFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const localReferences = props.overview.refs.filter((ref) => ref.kind === "local");
  const selectedReferences = localReferences.filter((ref) => selected.get(ref.name) === ref.hash);
  const toggle = (ref: GitExplorerRef) => {
    if (actions.unavailableReason) return;
    setSelected((current) => {
      const next = new Map(current);
      if (next.get(ref.name) === ref.hash) next.delete(ref.name);
      else next.set(ref.name, ref.hash);
      return next;
    });
  };
  const rows = useMemo(() => {
    const result: BranchRow[] = [];
    const local = props.overview.refs
      .filter((ref) => ref.kind === "local")
      .sort((left, right) => left.name.localeCompare(right.name));
    const batches = new Map<string, readonly string[]>();
    for (let index = 0; index < local.length; index += 32) {
      const batch = local.slice(index, index + 32).map((ref) => ref.name);
      for (const name of batch) batches.set(name, batch);
    }
    const tree = (
      refs: readonly GitExplorerRef[],
      scope: string,
      headBranch: string | null,
      prefix = "",
    ) => {
      const isExpanded = (path: string) =>
        gitExplorerFolderExpanded(path, headBranch, toggledFolders.has(`${scope}${path}`));
      return gitExplorerBranchRows(refs, isExpanded, prefix).map((row): BranchRow => {
        if (row.kind === "folder")
          return {
            kind: "folder",
            id: `${scope}${row.path}`,
            label: row.label,
            depth: row.depth,
            expanded: isExpanded(row.path),
          };
        const statusBranches = batches.get(row.reference.name);
        return {
          kind: "ref",
          ref: row.reference,
          displayName: row.label,
          depth: row.depth,
          ...(statusBranches ? { statusBranches } : {}),
        };
      });
    };
    result.push({ kind: "heading", id: "local", label: "Branches", detail: String(local.length) });
    result.push(...tree(local, "local:", props.overview.headBranch));
    if (local.length === 0)
      result.push({ kind: "empty", id: "no-local", label: "No local branches" });
    const remotes = new Map<string, GitExplorerRef[]>();
    for (const ref of props.overview.refs) {
      if (ref.kind !== "remote") continue;
      const remote = ref.shortName.split("/")[0] ?? ref.shortName;
      const group = remotes.get(remote) ?? [];
      group.push(ref);
      remotes.set(remote, group);
    }
    for (const [remote, refs] of remotes) {
      result.push({ kind: "heading", id: `remote:${remote}`, label: remote, detail: "Remote" });
      result.push(...tree(refs, `remote:${remote}/`, null, `${remote}/`));
    }
    const tags = props.overview.refs.filter((ref) => ref.kind === "tag");
    result.push({
      kind: "heading",
      id: "tags",
      label: "Tags",
      detail: String(tags.length),
      section: "tags",
    });
    if (!collapsed.has("tags")) {
      result.push(
        ...tags.map((ref): BranchRow => ({
          kind: "ref",
          ref,
          displayName: ref.shortName,
          depth: 0,
        })),
      );
      if (tags.length === 0) result.push({ kind: "empty", id: "no-tags", label: "No tags" });
    }
    result.push({
      kind: "heading",
      id: "stashes",
      label: "Stashes",
      detail: String(props.overview.stashes.length),
      section: "stashes",
    });
    if (!collapsed.has("stashes")) {
      result.push(...props.overview.stashes.map((stash): BranchRow => ({ kind: "stash", stash })));
      if (props.overview.stashes.length === 0)
        result.push({ kind: "empty", id: "no-stashes", label: "No saved stashes" });
    }
    const submodules = props.overview.submodules ?? [];
    if (submodules.length > 0) {
      result.push({
        kind: "heading",
        id: "submodules",
        label: "Submodules",
        detail: String(submodules.length),
        section: "submodules",
      });
      if (!collapsed.has("submodules"))
        result.push(
          ...submodules.map((submodule): BranchRow => ({ kind: "submodule", submodule })),
        );
    }
    return result;
  }, [
    props.overview.refs,
    props.overview.stashes,
    props.overview.submodules,
    props.overview.headBranch,
    collapsed,
    toggledFolders,
  ]);
  if (deleting)
    return (
      <GitExplorerBranchDeletion
        references={deleting}
        overview={props.overview}
        params={props.params}
        onRefresh={props.onRefresh}
        onClose={() => setDeleting(null)}
        unavailableReason={actions.unavailableReason}
      />
    );
  const toolbar = (
    <View className={cn("flex-row flex-wrap gap-1", sidebar ? "px-1 pb-1" : "p-1")}>
      <Button
        label={selecting ? "Cancel" : "Select branches"}
        tone="text"
        disabled={actions.unavailableReason !== null && !selecting}
        onPress={() => {
          setSelecting(!selecting);
          setSelected(new Map());
        }}
      />
      {selecting ? (
        <>
          <Button
            label={
              selectedReferences.length === localReferences.length ? "Clear all" : "Select all"
            }
            tone="text"
            disabled={actions.unavailableReason !== null || localReferences.length === 0}
            onPress={() =>
              setSelected(
                selectedReferences.length === localReferences.length
                  ? new Map()
                  : new Map(localReferences.map((ref) => [ref.name, ref.hash])),
              )
            }
          />
          <Button
            label={`Delete selected (${selectedReferences.length})`}
            tone="danger"
            disabled={actions.unavailableReason !== null || selectedReferences.length === 0}
            onPress={() => setDeleting(selectedReferences)}
          />
        </>
      ) : null}
    </View>
  );
  return (
    <View className={sidebar ? "flex-1 bg-drawer" : "flex-1"}>
      {sidebar ? null : toolbar}
      <FlatList
        data={rows}
        keyExtractor={(row) =>
          row.kind === "ref"
            ? row.ref.name
            : row.kind === "stash"
              ? row.stash.name
              : row.kind === "submodule"
                ? `submodule:${row.submodule.path}`
                : row.id
        }
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        windowSize={5}
        contentInsetAdjustmentBehavior={sidebar ? "automatic" : "never"}
        contentContainerStyle={sidebar ? { paddingBottom: props.sidebar?.bottomInset } : undefined}
        ListHeaderComponent={
          props.sidebar ? (
            <>
              {props.sidebar.header}
              {toolbar}
            </>
          ) : undefined
        }
        renderItem={({ item }) => {
          if (item.kind === "heading") {
            const section = item.section;
            if (sidebar) {
              const label = `${item.label} (${item.detail === "Remote" ? "remote" : item.detail})`;
              return (
                <ThreadListV2Section
                  label={label}
                  pane="sidebar"
                  {...(section
                    ? {
                        disclosure: {
                          expanded: !collapsed.has(section),
                          onToggle: () => toggleSection(section),
                          accessibilityLabel: label,
                          accessibilityHint: `${collapsed.has(section) ? "Expands" : "Collapses"} ${item.label.toLowerCase()}.`,
                        },
                      }
                    : {})}
                />
              );
            }
            const content = (
              <>
                <View className="flex-row items-center gap-1">
                  {section ? (
                    <>
                      <SymbolView
                        name={collapsed.has(section) ? "chevron.right" : "chevron.down"}
                        size={10}
                        tintColorClassName="accent-icon-muted"
                      />
                      <SymbolView
                        name={SECTION_SYMBOLS[section]}
                        size={12}
                        tintColorClassName="accent-icon-muted"
                      />
                    </>
                  ) : null}
                  <Text className="text-[11px] leading-[14px] font-t3-semibold text-foreground-muted">
                    {item.label}
                  </Text>
                </View>
                <Text className="text-[10px] leading-[14px] text-foreground-muted">
                  {item.detail}
                </Text>
              </>
            );
            return section ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${item.detail}`}
                accessibilityState={{ expanded: !collapsed.has(section) }}
                onPress={() => toggleSection(section)}
                style={{ height: rowHeight }}
                className="flex-row items-center justify-between bg-card px-3"
              >
                {content}
              </Pressable>
            ) : (
              <View
                style={{ height: 24 }}
                className="flex-row items-center justify-between bg-card px-3"
              >
                {content}
              </View>
            );
          }
          if (item.kind === "submodule") {
            const openable = item.submodule.headHash !== null;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Submodule ${item.submodule.path}. ${describeGitExplorerSubmodule(item.submodule)}.`}
                accessibilityState={{ disabled: !openable }}
                disabled={!openable}
                onPress={() => props.onOpenSubmodule(item.submodule.path)}
                style={sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : { height: rowHeight }}
                className={cn(
                  "flex-row items-center gap-2",
                  sidebar ? "bg-drawer active:bg-thread-hover" : "bg-card px-3",
                )}
              >
                <SymbolView
                  name={SUBMODULE_STATES[item.submodule.state].icon}
                  size={12}
                  tintColorClassName={SUBMODULE_STATES[item.submodule.state].tint}
                />
                <Text
                  numberOfLines={1}
                  className={cn(
                    "min-w-0 flex-1",
                    sidebar ? "text-base font-t3-medium" : "text-[12px] leading-[16px]",
                    openable
                      ? sidebar
                        ? "text-drawer-foreground"
                        : "text-foreground"
                      : sidebar
                        ? "text-drawer-foreground-muted"
                        : "text-foreground-muted",
                  )}
                >
                  {item.submodule.path}
                </Text>
                {openable ? (
                  <SymbolView
                    name="chevron.right"
                    size={10}
                    tintColorClassName="accent-icon-muted"
                  />
                ) : (
                  <Text className="text-[10px] leading-[14px] text-foreground-muted">
                    Not initialized
                  </Text>
                )}
              </Pressable>
            );
          }
          if (item.kind === "folder")
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.id.slice(item.id.indexOf(":") + 1)} branch folder`}
                accessibilityState={{ expanded: item.expanded }}
                onPress={() => toggleFolder(item.id)}
                style={[
                  sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : { height: rowHeight },
                  { paddingLeft: 12 + item.depth * 14 },
                ]}
                className={cn(
                  "flex-row items-center gap-1.5 pr-3",
                  sidebar ? "bg-drawer active:bg-thread-hover" : "bg-card",
                )}
              >
                <SymbolView
                  name={item.expanded ? "chevron.down" : "chevron.right"}
                  size={10}
                  tintColorClassName="accent-icon-muted"
                />
                <SymbolView name="folder.fill" size={13} tintColorClassName="accent-icon-muted" />
                <Text
                  numberOfLines={1}
                  className={cn(
                    "min-w-0 flex-1 font-t3-medium",
                    sidebar
                      ? "text-base text-drawer-foreground"
                      : "text-[12px] leading-[16px] text-foreground",
                  )}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          if (item.kind === "empty")
            return (
              <View
                style={sidebar ? undefined : { height: rowHeight }}
                className={sidebar ? "px-3 py-2" : "justify-center px-3"}
              >
                <Text
                  className={
                    sidebar
                      ? "text-sm text-drawer-foreground-muted"
                      : "text-[11px] leading-[14px] text-foreground-muted"
                  }
                >
                  {item.label}
                </Text>
              </View>
            );
          if (item.kind === "stash") {
            const stashSelected = item.stash.hash === props.selectedRevision;
            const stashRow = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.stash.name}. ${item.stash.subject}. Saved ${new Date(item.stash.createdAt).toLocaleString()}.`}
                accessibilityState={{ selected: item.stash.hash === props.selectedRevision }}
                onPress={() => props.onSelect(item.stash.hash)}
                style={sidebar ? THREAD_LIST_V2_SIDEBAR_ROW_STYLE : { height: rowHeight }}
                className={cn(
                  "flex-row items-center gap-2",
                  sidebar
                    ? stashSelected
                      ? "bg-thread-selected"
                      : "bg-drawer active:bg-thread-hover"
                    : stashSelected
                      ? "bg-primary/10 px-3"
                      : "bg-card px-3",
                )}
              >
                <Text className="rounded-sm bg-subtle-strong px-1 font-mono text-[10px] leading-[14px] text-foreground-muted">
                  {item.stash.name.replace(/^stash@\{(\d+)\}$/, "@$1")}
                </Text>
                <Text
                  numberOfLines={1}
                  className={cn(
                    "min-w-0 flex-1",
                    sidebar
                      ? cn(
                          "text-base font-t3-medium",
                          stashSelected
                            ? selectedThreadRowColors.foregroundClassName
                            : "text-drawer-foreground",
                        )
                      : "text-[12px] leading-[16px] text-foreground",
                  )}
                >
                  {item.stash.subject}
                </Text>
              </Pressable>
            );
            return sidebar ? (
              <View style={THREAD_LIST_V2_SIDEBAR_ROW_CONTAINER_STYLE}>{stashRow}</View>
            ) : (
              stashRow
            );
          }
          return (
            <GitExplorerBranchRow
              branch={item.ref}
              color={colors.get(item.ref.hash) ?? 0}
              displayName={item.displayName}
              depth={item.depth}
              statusBranches={item.statusBranches}
              overview={props.overview}
              params={props.params}
              active={props.active}
              rowHeight={rowHeight}
              sidebar={sidebar}
              selected={item.ref.hash === props.selectedRevision}
              onSelect={props.onSelect}
              actions={actions}
              {...(selecting && item.ref.kind === "local"
                ? {
                    selection: {
                      checked: selected.get(item.ref.name) === item.ref.hash,
                      disabled: actions.unavailableReason !== null,
                      onToggle: () => toggle(item.ref),
                    },
                  }
                : {})}
            />
          );
        }}
      />
      {actions.releaseSheet ? (
        <GitExplorerReleaseSheet params={props.params} {...actions.releaseSheet} />
      ) : null}
    </View>
  );
}
