import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { formatGitExplorerSync } from "@t3tools/client-runtime/git-explorer";
import type {
  GitExplorerOverviewResult,
  GitExplorerRef,
  GitExplorerStash,
} from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";

type BranchRow =
  | {
      readonly kind: "heading";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
    }
  | { readonly kind: "ref"; readonly ref: GitExplorerRef; readonly displayName: string }
  | { readonly kind: "stash"; readonly stash: GitExplorerStash }
  | { readonly kind: "empty"; readonly id: string; readonly label: string };

function syncMark(ref: GitExplorerRef) {
  if (ref.kind !== "local") return null;
  if (ref.upstreamMissing) return "!";
  if (!ref.upstream) return "—";
  if (ref.ahead === null || ref.behind === null) return "?";
  if (ref.ahead === 0 && ref.behind === 0) return "✓";
  return [ref.ahead > 0 ? `↑${ref.ahead}` : "", ref.behind > 0 ? `↓${ref.behind}` : ""]
    .filter(Boolean)
    .join(" ");
}

export function GitExplorerBranches(props: {
  readonly overview: GitExplorerOverviewResult;
  readonly tablet: boolean;
  readonly selectedRevision: string | null;
  readonly onSelect: (revision: string) => void;
}) {
  const rowHeight = props.tablet ? 28 : 36;
  const rows = useMemo(() => {
    const result: BranchRow[] = [];
    const local = props.overview.refs.filter((ref) => ref.kind === "local");
    result.push({ kind: "heading", id: "local", label: "Branches", detail: String(local.length) });
    result.push(
      ...local.map((ref): BranchRow => ({ kind: "ref", ref, displayName: ref.shortName })),
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
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) =>
        row.kind === "ref" ? row.ref.name : row.kind === "stash" ? row.stash.name : row.id
      }
      initialNumToRender={24}
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
              <Text className="text-[11px] leading-[14px] text-foreground-muted">{item.label}</Text>
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
        const ref = item.ref;
        const mark = syncMark(ref);
        const current =
          ref.kind === "local" &&
          (ref.shortName === props.overview.headBranch || ref.name === props.overview.headBranch);
        const slash = item.displayName.lastIndexOf("/");
        const prefix = item.displayName.slice(0, slash + 1);
        const leaf = item.displayName.slice(slash + 1);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${ref.shortName}. ${current ? "Currently checked out. " : ""}${ref.kind === "tag" ? "Tag" : ref.kind === "remote" ? "Remote-tracking branch" : formatGitExplorerSync(ref)}${ref.upstream ? `. Tracks ${ref.upstream}` : ""}`}
            accessibilityState={{ selected: ref.hash === props.selectedRevision }}
            onPress={() => props.onSelect(ref.hash)}
            style={{ height: rowHeight }}
            className={cn(
              "flex-row items-center gap-1 px-3",
              ref.hash === props.selectedRevision ? "bg-primary/10" : "bg-card",
            )}
          >
            {current ? (
              <View
                style={{ width: 2, height: 14, top: (rowHeight - 14) / 2 }}
                className="absolute left-0 rounded-r-sm bg-primary"
              />
            ) : null}
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              className="min-w-0 flex-1 text-[12px] leading-[16px]"
            >
              {prefix ? <Text className="text-foreground-muted">{prefix}</Text> : null}
              <Text
                className={cn(
                  "font-t3-medium",
                  current ? "font-t3-semibold text-primary-text" : "text-foreground",
                )}
              >
                {leaf}
              </Text>
            </Text>
            {mark ? (
              <Text
                numberOfLines={1}
                style={{ width: 52, textAlign: "right" }}
                className={cn(
                  "text-[10px] leading-[14px]",
                  ref.upstreamMissing || (ref.behind ?? 0) > 0
                    ? "text-warning-foreground"
                    : (ref.ahead ?? 0) > 0
                      ? "text-primary-text"
                      : "text-foreground-muted",
                )}
              >
                {mark}
              </Text>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
