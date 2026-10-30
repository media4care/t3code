import {
  isProviderNativeSubagentThread,
  ThreadId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { formatSubagentDisplayTitle, resolveSubagentMetadata } from "./subagentDisplay.ts";
import { formatModelSelectionEffort } from "./threadExecution.ts";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
} from "./subagentRuntime.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import type { EnvironmentThread } from "./models.ts";
import type { createEnvironmentThreadDetailAtoms } from "./threadDetail.ts";

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
  readonly modelSelection?: ModelSelection;
  readonly modelIsConfigured?: boolean;
  readonly detailsState?: "loading" | "ready" | "unavailable";
}

function shellStatus(
  status: OrchestrationV2ThreadShell["status"] | RuntimeSubagent["status"],
): RuntimeSubagent["status"] {
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
      const agent = currentAgent(
        {
          ...runtime,
          model: runtime.model ?? (member ? null : (source.modelSelection?.model ?? null)),
        },
        thread,
        source.origin === "provider_native",
      );
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
        modelIsConfigured:
          source.origin === "provider_native" && runtime.model === null && agent.model !== null,
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
          model: thread.modelSelection.model,
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
        modelSelection: thread.modelSelection,
        modelIsConfigured: isProviderNativeSubagentThread(thread),
      });
    }
  }
  return nodes;
}

export function agentMapMetadata(node: ThreadAgentMapNode, provider: ServerProvider | undefined) {
  const reportedSelection =
    node.modelSelection ??
    (node.kind === "Workflow agent" ? undefined : node.source?.modelSelection);
  const selection =
    reportedSelection?.model === node.agent.model
      ? reportedSelection
      : node.kind === "Delegated" && node.thread?.modelSelection.model === node.agent.model
        ? node.thread.modelSelection
        : undefined;
  return {
    model: node.agent.model
      ? `${resolveSubagentMetadata({ model: node.agent.model, provider }).modelLabel}${node.modelIsConfigured ? " (configured)" : ""}`
      : node.detailsState === "loading"
        ? "Loading model…"
        : "Model unavailable",
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
      if (node.source === null && node.kind === "Native") {
        return {
          label: node.detailsState === "loading" ? "Loading" : "Status unavailable",
          tone: "stopped",
        } as const;
      }
      return { label: "Idle", tone: "stopped" } as const;
  }
}

export function agentMapOutput(node: ThreadAgentMapNode) {
  return node.agent.status === "failed"
    ? (node.agent.error ?? node.agent.result ?? node.agent.progress)
    : (node.agent.result ?? node.agent.progress);
}

export function agentMapEmptyDetail(
  node: ThreadAgentMapNode,
  field: "output" | "prompt" = "output",
) {
  if (node.detailsState === "loading") return "Loading agent details…";
  if (node.detailsState === "unavailable") return "Could not load agent details.";
  if (field === "prompt") return "Assignment unavailable.";
  return isActiveSubagentStatus(node.agent.status) ? "Waiting for output." : "Output unavailable.";
}

export function resolveAgentMapConversation(
  node: ThreadAgentMapNode,
  child: EnvironmentThread,
): ThreadAgentMapNode {
  if (
    node.target?.environmentId !== child.environmentId ||
    node.target.threadId !== child.projection.thread.id
  )
    return node;
  const { projection } = child;
  const expectedRunId = node.thread?.activeRunId ?? node.thread?.latestRunId;
  if (expectedRunId && !projection.runs.some((entry) => entry.id === expectedRunId))
    return { ...node, detailsState: "loading" };
  const run = projection.runs
    .filter(
      (entry) =>
        entry.threadId === projection.thread.id && (!expectedRunId || entry.id === expectedRunId),
    )
    .reduce<(typeof projection.runs)[number] | null>(
      (latest, candidate) =>
        latest === null ||
        DateTime.toEpochMillis(candidate.requestedAt) > DateTime.toEpochMillis(latest.requestedAt)
          ? candidate
          : latest,
      null,
    );
  const root = projection.nodes
    .filter(
      (entry) =>
        entry.threadId === projection.thread.id &&
        entry.runId === (run?.id ?? null) &&
        entry.kind === "root_turn" &&
        entry.parentNodeId === null,
    )
    .reduce<(typeof projection.nodes)[number] | null>(
      (latest, candidate) =>
        latest === null ||
        DateTime.toEpochMillis(
          candidate.startedAt ?? candidate.completedAt ?? projection.thread.createdAt,
        ) >=
          DateTime.toEpochMillis(
            latest.startedAt ?? latest.completedAt ?? projection.thread.createdAt,
          )
          ? candidate
          : latest,
      null,
    );
  const resumed =
    run !== null &&
    node.source !== null &&
    DateTime.toEpochMillis(run.requestedAt) >
      DateTime.toEpochMillis(
        node.source.completedAt ?? node.source.startedAt ?? node.source.updatedAt,
      );
  const execution = run ?? root;
  const status =
    execution && (node.source === null || node.agent.status === "idle" || resumed)
      ? shellStatus(execution.status)
      : node.agent.status;
  const startedAt =
    (resumed ? null : node.agent.startedAt) ??
    (execution?.startedAt ? DateTime.formatIso(execution.startedAt) : null);
  const since = run !== null || startedAt === null ? -Infinity : Date.parse(startedAt);
  const belongsToRun = (entry: { threadId: ThreadId; runId: string | null }) =>
    entry.threadId === projection.thread.id && entry.runId === (run?.id ?? null);
  const messages = projection.messages.filter(
    (message) => belongsToRun(message) && DateTime.toEpochMillis(message.createdAt) >= since,
  );
  const assistant = projection.turnItems
    .filter(
      (item) =>
        item.type === "assistant_message" &&
        belongsToRun(item) &&
        DateTime.toEpochMillis(item.startedAt ?? item.updatedAt) >= since,
    )
    .sort((left, right) => right.ordinal - left.ordinal)
    .find(
      (item) =>
        item.type === "assistant_message" &&
        (item.text.trim() ||
          messages.some((message) => message.id === item.messageId && message.text.trim())),
    );
  const assistantMessage = messages
    .filter((message) => message.role === "assistant" && message.text.trim())
    .sort(
      (left, right) =>
        DateTime.toEpochMillis(right.createdAt) - DateTime.toEpochMillis(left.createdAt),
    )[0];
  const output =
    assistant?.type === "assistant_message"
      ? assistant.text.trim() ||
        messages.find((message) => message.id === assistant.messageId)?.text
      : assistantMessage?.text;
  const prompt = messages
    .filter(
      (message) =>
        message.role === "user" && message.notification === undefined && message.text.trim(),
    )
    .sort(
      (left, right) =>
        DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
    )[0]?.text;
  const selection =
    !resumed && node.agent.model && !node.modelIsConfigured
      ? node.modelSelection
      : ((!resumed && node.kind !== "Workflow agent" ? node.source?.modelSelection : undefined) ??
        run?.modelSelection ??
        projection.thread.modelSelection);
  return {
    ...node,
    prompt: (resumed ? prompt || node.prompt : node.prompt || prompt) || null,
    ...(selection ? { modelSelection: selection } : {}),
    modelIsConfigured:
      selection !== undefined &&
      run === null &&
      (node.modelIsConfigured === true || node.agent.model === null),
    agent: {
      ...node.agent,
      model: selection?.model ?? node.agent.model,
      status,
      startedAt,
      completedAt: isActiveSubagentStatus(status)
        ? null
        : ((resumed ? null : node.agent.completedAt) ??
          (execution?.completedAt ? DateTime.formatIso(execution.completedAt) : null)),
      result:
        (resumed ? null : node.agent.result) ??
        (!isActiveSubagentStatus(status) && status !== "failed" ? (output ?? null) : null),
      progress:
        (resumed ? null : node.agent.progress) ??
        (isActiveSubagentStatus(status) ? (output ?? null) : null),
      error:
        (resumed ? null : node.agent.error) ??
        (status === "failed" ? (node.thread?.lastError ?? output ?? null) : null),
    },
  };
}

export function createThreadAgentMapAtoms(input: {
  readonly details: Pick<
    ReturnType<typeof createEnvironmentThreadDetailAtoms>,
    "quietThreadAtom" | "stateAtom" | "statusAtom" | "errorAtom"
  >;
  readonly threadsAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyArray<OrchestrationV2ThreadShell>>;
  readonly environmentIdsAtom: Atom.Atom<ReadonlyArray<EnvironmentId>>;
}) {
  const nodes = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    return Atom.make((get) =>
      deriveThreadAgentMap({
        ...ref,
        subagents: get(input.details.quietThreadAtom(ref))?.projection.subagents ?? [],
        threads: get(input.threadsAtom(ref.environmentId)),
      }),
    ).pipe(Atom.setIdleTTL(0));
  });
  const resolved = Atom.family((key: string) => {
    const [rootKey, id] = JSON.parse(key) as [string, string];
    const ref = parseThreadKey(rootKey);
    return Atom.make((get): ThreadAgentMapNode | null => {
      let node = get(nodes(rootKey)).find((entry) => entry.id === id);
      if (!node) return null;
      if (node.source === null) {
        const ownerRef = { environmentId: ref.environmentId, threadId: node.ownerThreadId };
        const owner = get(input.details.quietThreadAtom(ownerRef));
        if (
          owner === null &&
          !get(input.details.errorAtom(ownerRef)) &&
          get(input.details.statusAtom(ownerRef)) !== "deleted"
        )
          return { ...node, detailsState: "loading" };
        if (owner !== null) {
          const target = node.target;
          const source = deriveThreadAgentMap({
            ...ownerRef,
            subagents: owner.projection.subagents,
            threads: node.thread ? [node.thread] : [],
          }).find(
            (entry) =>
              entry.target !== null &&
              target !== null &&
              entry.target.environmentId === target.environmentId &&
              entry.target.threadId === target.threadId &&
              entry.source !== null,
          );
          if (source)
            node = {
              ...source,
              id: node.id,
              parentId: node.parentId,
              ownerThreadId: node.ownerThreadId,
            };
        }
      }
      if (
        node.target !== null &&
        (node.source === null || !node.agent.model || !node.prompt || !agentMapOutput(node))
      ) {
        if (!get(input.environmentIdsAtom).includes(node.target.environmentId))
          return { ...node, detailsState: "unavailable" };
        const state = get(input.details.stateAtom(node.target));
        const projection = Option.getOrNull(state.data);
        if (projection !== null)
          node = resolveAgentMapConversation(node, {
            environmentId: node.target.environmentId,
            projection,
          });
        else
          return {
            ...node,
            detailsState:
              Option.isSome(state.error) || state.status === "deleted" ? "unavailable" : "loading",
          };
      }
      return { ...node, detailsState: node.detailsState ?? "ready" };
    }).pipe(Atom.setIdleTTL(0));
  });
  return {
    nodesAtom: (ref: ScopedThreadRef) => nodes(threadKey(ref)),
    nodeAtom: (ref: ScopedThreadRef, id: string) => resolved(JSON.stringify([threadKey(ref), id])),
  };
}
