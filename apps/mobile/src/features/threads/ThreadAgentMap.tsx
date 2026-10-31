import { useAtomValue } from "@effect/atom-react";
import {
  agentMapMetadata,
  agentMapStatus,
  agentMapEmptyDetail,
  agentMapOutput,
  type ThreadAgentMapNode,
} from "@t3tools/client-runtime/state/thread-agent-map";
import { subagentDetailPreview } from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveWorkflowGroups,
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import { deriveSubagentElapsedMs, formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { environmentThreadDetails, threadAgentMaps, useThreadFamily } from "../../state/threads";
import { useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { SubagentStopButton } from "./SubagentStopButton";
import { ThreadWorkflowGroup } from "./ThreadWorkflowGroup";
import { useVisibleSecondClock } from "./use-visible-second-clock";

const STATUS_CLASSES = {
  working: "text-primary-text",
  waiting: "text-adaptive-amber-600-400",
  done: "text-adaptive-emerald-600-400",
  failed: "text-danger",
  stopped: "text-foreground-muted",
};

export function ThreadAgentMap(props: {
  target: ScopedThreadRef;
  onOpen: (target: ScopedThreadRef) => void;
}) {
  useThreadFamily(props.target.environmentId, props.target.threadId);
  const projection = useAtomValue(
    environmentThreadDetails.quietThreadAtom(props.target),
  )?.projection;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(24);
  const nodes = useAtomValue(threadAgentMaps.nodesAtom(props.target));
  const children = new Map<string | null, ThreadAgentMapNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const rows: Array<{ node: ThreadAgentMapNode; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      rows.push({ node, depth });
      if (!collapsed.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return (
    <View className="gap-4 pt-4">
      <View className="rounded-2xl border border-border bg-card p-4">
        <Text className="font-t3-medium text-sm">{projection?.thread.title ?? "Thread"}</Text>
        <Text className="mt-1 text-xs text-foreground-muted">
          {nodes.length} agents across this thread
        </Text>
      </View>
      {rows.length === 0 ? (
        <Text className="py-4 text-center text-sm text-foreground-muted">
          No subagents launched in this thread.
        </Text>
      ) : null}
      {rows.slice(0, limit).map(({ node, depth }) => (
        <AgentMapRow
          key={node.id}
          node={node}
          depth={depth}
          target={props.target}
          selected={selectedId === node.id}
          collapsed={collapsed.has(node.id)}
          childCount={children.get(node.id)?.length ?? 0}
          onOpen={props.onOpen}
          onSelect={() => setSelectedId(selectedId === node.id ? null : node.id)}
          onCollapse={() =>
            setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            })
          }
        />
      ))}
      {rows.length > limit ? (
        <Button
          tone="text"
          label={`Show ${Math.min(24, rows.length - limit)} more agents`}
          onPress={() => setLimit(limit + 24)}
        />
      ) : null}
    </View>
  );
}

function AgentMapRow(props: {
  node: ThreadAgentMapNode;
  depth: number;
  target: ScopedThreadRef;
  selected: boolean;
  collapsed: boolean;
  childCount: number;
  onSelect: () => void;
  onCollapse: () => void;
  onOpen: (target: ScopedThreadRef) => void;
}) {
  const node = useAtomValue(threadAgentMaps.nodeAtom(props.target, props.node.id)) ?? props.node;
  const configs = useServerConfigs();
  const provider = configs
    .get(
      node.source?.remoteChild?.environmentId ??
        node.target?.environmentId ??
        props.target.environmentId,
    )
    ?.providers.find(
      (candidate) =>
        candidate.instanceId ===
        (node.source?.providerInstanceId ?? node.thread?.providerInstanceId),
    );
  const metadata = agentMapMetadata(node, provider);
  const status = agentMapStatus(node);

  const driver = provider?.driver ?? node.source?.driver;
  return (
    <View
      className="border-l border-border pl-4"
      style={{ marginLeft: Math.min(props.depth, 3) * 16 }}
    >
      <View className="absolute left-0 top-8 h-px w-4 bg-border" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${metadata.provider}, ${metadata.model}, ${node.agent.title}, ${status.label}`}
        accessibilityState={{ expanded: props.selected }}
        onPress={props.onSelect}
        className={cn(
          "gap-3 rounded-2xl border border-border bg-card p-4 active:bg-subtle",
          props.selected && "border-primary bg-primary/5",
        )}
      >
        <View className="flex-row items-center gap-2">
          {driver ? <ProviderIcon provider={driver} iconUrl={provider?.iconUrl} size={18} /> : null}
          <View className="min-w-0 flex-1">
            <Text className="font-t3-medium text-xs">{metadata.model}</Text>
          </View>
          <Text className="text-xs text-foreground-muted">{node.kind}</Text>
        </View>
        <View className="gap-1">
          <Text className="font-t3-medium text-base">{node.agent.title}</Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {subagentDetailPreview(node.agent) ?? agentMapEmptyDetail(node)}
          </Text>
        </View>
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className={cn("font-t3-medium text-xs", STATUS_CLASSES[status.tone])}>
            {status.label}
          </Text>
          <AgentElapsed agent={node.agent} />
        </View>
        {node.source?.remoteChild ? (
          <Text className="text-xs text-foreground-muted">on {node.source.remoteChild.label}</Text>
        ) : null}
      </Pressable>
      {props.selected ? (
        <AgentInspector
          key={node.id}
          node={node}
          target={props.target}
          provider={provider}
          onOpen={props.onOpen}
        />
      ) : null}
      {props.childCount > 0 ? (
        <Button
          tone="text"
          label={`${props.collapsed ? "Show" : "Hide"} ${props.childCount} ${props.childCount === 1 ? "child" : "children"}`}
          onPress={props.onCollapse}
        />
      ) : null}
    </View>
  );
}

function AgentElapsed({ agent }: { agent: RuntimeSubagent }) {
  const nowMs = useVisibleSecondClock(isActiveSubagentStatus(agent.status));
  const elapsedMs = deriveSubagentElapsedMs(agent, nowMs);
  return elapsedMs === null ? null : (
    <Text
      accessibilityLabel={`Total time: ${formatDuration(elapsedMs)}`}
      className="text-xs tabular-nums text-foreground-muted"
    >
      {formatDuration(elapsedMs)}
    </Text>
  );
}

function AgentInspector(props: {
  node: ThreadAgentMapNode;
  target: ScopedThreadRef;
  provider: ServerProvider | undefined;
  onOpen: (target: ScopedThreadRef) => void;
}) {
  const [tab, setTab] = useState<"output" | "prompt" | "details">("output");
  const node = props.node;
  const { presentationById } = useEnvironments();
  const metadata = agentMapMetadata(node, props.provider);
  const output = agentMapOutput(node);
  const missing = node.detailsState === "loading" ? "Loading…" : "Unavailable";
  const canOpen = node.target !== null && presentationById.has(node.target.environmentId);
  const workflow =
    node.kind === "Workflow" && node.source && !node.source.remoteChild
      ? deriveWorkflowGroups(projectedSubagentsToRuntime([node.source]))[0]
      : undefined;
  return (
    <View className="mt-2 gap-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row gap-4">
        {(["output", "prompt", "details"] as const).map((id) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            onPress={() => setTab(id)}
            className={cn(
              "min-h-11 justify-center border-b-2 border-transparent",
              tab === id && "border-primary",
            )}
          >
            <Text
              className={cn(
                "text-sm capitalize text-foreground-muted",
                tab === id && "font-t3-medium text-foreground",
              )}
            >
              {id}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "details" ? (
        <View className="gap-2">
          <Text className="text-xs text-foreground-muted">Model: {metadata.model}</Text>
          <Text className="text-xs text-foreground-muted">
            Effort: {metadata.effort ?? missing}
          </Text>
          <Text className="text-xs text-foreground-muted">
            Started:{" "}
            {node.agent.startedAt ? new Date(node.agent.startedAt).toLocaleString() : missing}
          </Text>
          <Text className="text-xs text-foreground-muted">
            Completed:{" "}
            {node.agent.completedAt ? new Date(node.agent.completedAt).toLocaleString() : missing}
          </Text>
          {node.agent.phaseTitle ? (
            <Text className="text-xs text-foreground-muted">Phase: {node.agent.phaseTitle}</Text>
          ) : null}
          {node.agent.usage ? (
            <Text className="text-xs text-foreground-muted">
              Tokens: {node.agent.usage.totalTokens.toLocaleString()}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text selectable className="text-sm leading-6">
          {tab === "prompt"
            ? node.prompt || agentMapEmptyDetail(node, "prompt")
            : output || agentMapEmptyDetail(node)}
        </Text>
      )}
      {tab === "details" && workflow && node.source ? (
        <ThreadWorkflowGroup
          environmentId={props.target.environmentId}
          subagent={node.source}
          group={workflow}
          onOpen={(threadId) =>
            props.onOpen({ environmentId: props.target.environmentId, threadId })
          }
        />
      ) : null}
      {!canOpen ? (
        <Text className="text-xs text-foreground-muted">
          {node.target === null
            ? "This provider has not exposed a separate conversation."
            : `Connect to ${node.source?.remoteChild?.label ?? "the environment"} to open the conversation.`}
        </Text>
      ) : null}
      <View className="flex-row items-center justify-between gap-2">
        <Button
          label="Conversation"
          disabled={!canOpen}
          onPress={() => {
            if (canOpen && node.target) props.onOpen(node.target);
          }}
        />
        {node.source && node.kind !== "Workflow agent" && !(tab === "details" && workflow) ? (
          <SubagentStopButton environmentId={props.target.environmentId} subagent={node.source} />
        ) : null}
      </View>
    </View>
  );
}
