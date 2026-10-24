import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type {
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerStash,
} from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { GitExplorerBranchRow } from "./GitExplorerBranchRow";
import { GitExplorerBranchDeletion } from "./GitExplorerBranchDeletion";
import type { GitExplorerParams } from "./useGitExplorer";
import { useGitExplorerBranchActions } from "./useGitExplorerBranchActions";

type BranchRow =
  | {
      readonly kind: "heading";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
    }
  | {
      readonly kind: "ref";
      readonly ref: GitExplorerRef;
      readonly displayName: string;
      readonly statusBranches?: readonly string[];
    }
  | { readonly kind: "stash"; readonly stash: GitExplorerStash }
  | { readonly kind: "empty"; readonly id: string; readonly label: string };

export function GitExplorerBranches(props: {
  readonly overview: GitExplorerOverviewResult;
  readonly params: GitExplorerParams;
  readonly active: boolean;
  readonly tablet: boolean;
  readonly selectedRevision: string | null;
  readonly onSelect: (revision: string) => void;
  readonly onRefresh: () => void;
}) {
  const rowHeight = props.tablet ? 28 : 36;
  const actions = useGitExplorerBranchActions(props.params, props.onRefresh);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());
  const [deleting, setDeleting] = useState<readonly GitExplorerRef[] | null>(null);
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
    const batches: string[][] = [];
    for (let index = 0; index < local.length; index += 32)
      batches.push(local.slice(index, index + 32).map((ref) => ref.name));
    result.push({ kind: "heading", id: "local", label: "Branches", detail: String(local.length) });
    result.push(
      ...local.map((ref, index): BranchRow => ({
        kind: "ref",
        ref,
        displayName: ref.shortName,
        statusBranches: batches[Math.floor(index / 32)],
      })),
    );
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
      result.push(
        ...refs.map((ref): BranchRow => ({
          kind: "ref",
          ref,
          displayName: ref.shortName.slice(remote.length + 1) || ref.shortName,
        })),
      );
    }
    const tags = props.overview.refs.filter((ref) => ref.kind === "tag");
    result.push({ kind: "heading", id: "tags", label: "Tags", detail: String(tags.length) });
    result.push(
      ...tags.map((ref): BranchRow => ({ kind: "ref", ref, displayName: ref.shortName })),
    );
    if (tags.length === 0) result.push({ kind: "empty", id: "no-tags", label: "No tags" });
    result.push({
      kind: "heading",
      id: "stashes",
      label: "Stashes",
      detail: String(props.overview.stashes.length),
    });
    result.push(...props.overview.stashes.map((stash): BranchRow => ({ kind: "stash", stash })));
    if (props.overview.stashes.length === 0)
      result.push({ kind: "empty", id: "no-stashes", label: "No saved stashes" });
    return result;
  }, [props.overview.refs, props.overview.stashes]);
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
  return (
    <View className="flex-1">
      <View className="flex-row flex-wrap gap-1 p-1">
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
      <FlatList
        data={rows}
        keyExtractor={(row) =>
          row.kind === "ref" ? row.ref.name : row.kind === "stash" ? row.stash.name : row.id
        }
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        windowSize={5}
        contentInsetAdjustmentBehavior="never"
        renderItem={({ item }) => {
          if (item.kind === "heading")
            return (
              <View
                style={{ height: 24 }}
                className="flex-row items-center justify-between bg-card px-3"
              >
                <View className="flex-row items-center gap-1">
                  {item.id === "tags" || item.id === "stashes" ? (
                    <SymbolView
                      name={item.id === "tags" ? "tag" : "archivebox"}
                      size={12}
                      tintColorClassName="accent-icon-muted"
                    />
                  ) : null}
                  <Text className="text-[11px] leading-[14px] font-t3-semibold text-foreground-muted">
                    {item.label}
                  </Text>
                </View>
                <Text className="text-[10px] leading-[14px] text-foreground-muted">
                  {item.detail}
                </Text>
              </View>
            );
          if (item.kind === "empty")
            return (
              <View style={{ height: rowHeight }} className="justify-center px-3">
                <Text className="text-[11px] leading-[14px] text-foreground-muted">
                  {item.label}
                </Text>
              </View>
            );
          if (item.kind === "stash")
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.stash.name}. ${item.stash.subject}. Saved ${new Date(item.stash.createdAt).toLocaleString()}.`}
                accessibilityState={{ selected: item.stash.hash === props.selectedRevision }}
                onPress={() => props.onSelect(item.stash.hash)}
                style={{ height: rowHeight }}
                className={cn(
                  "flex-row items-center gap-2 px-3",
                  item.stash.hash === props.selectedRevision ? "bg-primary/10" : "bg-card",
                )}
              >
                <Text className="rounded-sm bg-subtle-strong px-1 font-mono text-[10px] leading-[14px] text-foreground-muted">
                  {item.stash.name.replace(/^stash@\{(\d+)\}$/, "@$1")}
                </Text>
                <Text
                  numberOfLines={1}
                  className="min-w-0 flex-1 text-[12px] leading-[16px] text-foreground"
                >
                  {item.stash.subject}
                </Text>
              </Pressable>
            );
          return (
            <GitExplorerBranchRow
              branch={item.ref}
              displayName={item.displayName}
              statusBranches={item.statusBranches}
              overview={props.overview}
              params={props.params}
              active={props.active}
              rowHeight={rowHeight}
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
    </View>
  );
}
