import {
  isProviderNativeSubagentThread,
  ThreadId,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { formatSubagentDisplayTitle, resolveSubagentMetadata } from "./subagentDisplay.ts";
import { formatModelSelectionEffort } from "./threadExecution.ts";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
} from "./subagentRuntime.ts";

export interface ThreadAgentMapNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly ownerThreadId: ThreadId;
  readonly agent: RuntimeSubagent;
  readonly source: OrchestrationV2Subagent | null;
  readonly thread: OrchestrationV2ThreadShell | null;
  readonly target: ScopedThreadRef | null;
  readonly kind: "Native" | "Delegated" | "Workflow" | "Workflow agent";
  readonly prompt: string | null;
}

function shellStatus(status: OrchestrationV2ThreadShell["status"]): RuntimeSubagent["status"] {
  switch (status) {
    case "preparing":
    case "starting":
    case "queued":
      return "pending";
    case "rolled_back":
      return "interrupted";
    default:
      return status;
  }
}

function currentAgent(
  agent: RuntimeSubagent,
  thread: OrchestrationV2ThreadShell | null,
  native: boolean,
) {
  if (thread === null || isActiveSubagentStatus(agent.status)) return agent;
  const newerRun =
    thread.latestRunRequestedAt != null &&
    DateTime.toEpochMillis(thread.latestRunRequestedAt) >
      Date.parse(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
  if (thread.activityRunStatus == null && !newerRun) return agent;
  const startedAt = thread.activityRunStatus
    ? thread.activityRunStartedAt
    : thread.latestRunStartedAt;
  const completedAt = thread.activityRunStatus ? null : thread.latestRunCompletedAt;
  return {
    ...agent,
    status: shellStatus(thread.activityRunStatus ?? thread.status),
    startedAt: startedAt ? DateTime.formatIso(startedAt) : null,
    completedAt: completedAt ? DateTime.formatIso(completedAt) : null,
    model: native ? null : thread.modelSelection.model,
    effort: null,
    usage: null,
    progress: null,
    result: null,
    error: null,
  };
}

export function deriveThreadAgentMap(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
}): ReadonlyArray<ThreadAgentMapNode> {
  const shells = new Map(input.threads.map((thread) => [thread.id, thread]));
  const sources = new Map(input.subagents.map((source) => [source.id as string, source]));
  const nodes: ThreadAgentMapNode[] = projectedSubagentsToRuntime(input.subagents).map(
    (runtime) => {
      const source = sources.get(runtime.parentAgentId ?? runtime.id)!;
      const member = runtime.kind === "workflow_agent";
      const remote = member ? undefined : source.remoteChild;
      const childThreadId =
        runtime.childThreadId === null ? null : ThreadId.make(runtime.childThreadId);
      const target = remote
        ? { environmentId: remote.environmentId, threadId: remote.threadId }
        : childThreadId === null
          ? null
          : {
              environmentId: source.remoteChild?.environmentId ?? input.environmentId,
              threadId: childThreadId,
            };
      const thread =
        target?.environmentId === input.environmentId
          ? (shells.get(target.threadId) ?? null)
          : null;
      const agent = currentAgent(runtime, thread, source.origin === "provider_native");
      return {
        id: runtime.id,
        parentId: runtime.parentAgentId,
        ownerThreadId: input.threadId,
        agent: {
          ...agent,
          title: formatSubagentDisplayTitle(agent.title || "Subagent"),
          // Workflow progress carries the assignment, not a reported activity update.
          progress: member ? null : agent.progress,
        },
        source,
        thread,
        target,
        kind: member
          ? "Workflow agent"
          : source.workflow
            ? "Workflow"
            : source.origin === "provider_native"
              ? "Native"
              : "Delegated",
        prompt: member
          ? (source.workflow?.agents.find((candidate) => candidate.index === runtime.agentIndex)
              ?.prompt ?? null)
          : source.prompt,
      };
    },
  );
  const represented = new Map<ThreadId, string>();
  for (const node of nodes) {
    if (
      node.target?.environmentId === input.environmentId &&
      node.target.threadId !== input.threadId
    ) {
      represented.set(node.target.threadId, node.id);
    }
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.parentId !== null) continue;
    const recordedParent = node.source?.parentNodeId;
    const parentThread = node.thread?.lineage.parentThreadId;
    const parentId =
      recordedParent && nodeIds.has(recordedParent)
        ? recordedParent
        : parentThread
          ? represented.get(parentThread)
          : undefined;
    if (parentId && parentId !== node.id) nodes[index] = { ...node, parentId };
  }
  const children = new Map<ThreadId, OrchestrationV2ThreadShell[]>();
  for (const thread of input.threads) {
    const parent = thread.lineage.parentThreadId;
    if (parent === null || thread.lineage.relationshipToParent !== "subagent") continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(thread);
    children.set(parent, siblings);
  }
  const queue = [input.threadId, ...represented.keys()];
  const visited = new Set<ThreadId>();
  for (let index = 0; index < queue.length; index += 1) {
    const parentThreadId = queue[index]!;
    if (visited.has(parentThreadId)) continue;
    visited.add(parentThreadId);
    for (const thread of children.get(parentThreadId) ?? []) {
      if (thread.id === input.threadId || visited.has(thread.id)) continue;
      queue.push(thread.id);
      if (represented.has(thread.id)) continue;
      const id = `thread:${thread.id}`;
      represented.set(thread.id, id);
      const [agent] = projectedSubagentsToRuntime([
        {
          id,
          title: thread.title,
          prompt: "",
          model: isProviderNativeSubagentThread(thread) ? null : thread.modelSelection.model,
          status: shellStatus(thread.activityRunStatus ?? thread.status),
          result: null,
          childThreadId: thread.id,
          startedAt: thread.activityRunStartedAt ?? thread.latestRunStartedAt ?? null,
          completedAt: thread.activityRunStatus ? null : (thread.latestRunCompletedAt ?? null),
          updatedAt: thread.updatedAt,
        },
      ]);
      nodes.push({
        id,
        parentId: represented.get(parentThreadId) ?? null,
        ownerThreadId: parentThreadId,
        agent: { ...agent!, title: formatSubagentDisplayTitle(thread.title) },
        source: null,
        thread,
        target: { environmentId: input.environmentId, threadId: thread.id },
        kind: isProviderNativeSubagentThread(thread) ? "Native" : "Delegated",
        prompt: null,
      });
    }
  }
  return nodes;
}

export function agentMapMetadata(node: ThreadAgentMapNode, provider: ServerProvider | undefined) {
  const reportedSelection =
    node.kind === "Workflow agent" ? undefined : node.source?.modelSelection;
  const selection =
    reportedSelection?.model === node.agent.model
      ? reportedSelection
      : node.kind === "Delegated" && node.thread?.modelSelection.model === node.agent.model
        ? node.thread.modelSelection
        : undefined;
  return {
    model: resolveSubagentMetadata({ model: node.agent.model, provider }).modelLabel,
    effort:
      node.agent.effort ??
      (selection ? formatModelSelectionEffort(selection, provider?.models) : null),
    provider: provider?.displayName ?? node.source?.driver ?? "Provider not reported",
  };
}

export function agentMapStatus(node: ThreadAgentMapNode) {
  if (node.thread?.pendingRuntimeRequest != null)
    return { label: "Needs input", tone: "waiting" } as const;
  switch (node.agent.status) {
    case "running":
      return { label: "Working", tone: "working" } as const;
    case "pending":
      return { label: "Queued", tone: "working" } as const;
    case "waiting":
      return { label: "Waiting", tone: "waiting" } as const;
    case "completed":
      return { label: "Done", tone: "done" } as const;
    case "failed":
      return { label: "Failed", tone: "failed" } as const;
    case "cancelled":
      return { label: "Cancelled", tone: "stopped" } as const;
    case "interrupted":
      return { label: "Interrupted", tone: "stopped" } as const;
    case "idle":
      return { label: "Idle", tone: "stopped" } as const;
  }
}
