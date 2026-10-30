import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  agentMapMetadata,
  agentMapOutput,
  agentMapStatus,
  createThreadAgentMapAtoms,
  deriveThreadAgentMap,
  resolveAgentMapConversation,
} from "./threadAgentMap.ts";
import { threadKey } from "./entities.ts";
import { createEnvironmentThreadDetailAtoms } from "./threadDetail.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE, type EnvironmentThreadState } from "./threadState.ts";
import { v2Now, v2Projection, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const environmentId = EnvironmentId.make("local");
const threadId = v2ThreadShell.id;
const ref = { environmentId, threadId };
const later = DateTime.makeUnsafe("2026-06-20T01:00:00.000Z");
function agent(
  id: string,
  overrides: Partial<OrchestrationV2Subagent> = {},
): OrchestrationV2Subagent {
  return {
    id: NodeId.make(id),
    threadId,
    runId: null,
    parentNodeId: NodeId.make("root"),
    origin: "provider_native",
    createdBy: "agent",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerThreadId: null,
    childThreadId: ThreadId.make(id),
    nativeTaskRef: null,
    prompt: `Assignment for ${id}`,
    title: id,
    model: null,
    status: "completed",
    result: `Result for ${id}`,
    startedAt: v2Now,
    completedAt: v2Now,
    updatedAt: v2Now,
    ...overrides,
  };
}
const derive = (subagents: ReadonlyArray<OrchestrationV2Subagent>, threads = [v2ThreadShell]) =>
  deriveThreadAgentMap({ environmentId, threadId, subagents, threads });

function nativeChild(id: string, parent = threadId): OrchestrationV2ThreadShell {
  return {
    ...v2ThreadShell,
    id: ThreadId.make(id),
    creationSource: "provider",
    lineage: { rootThreadId: threadId, parentThreadId: parent, relationshipToParent: "subagent" },
  };
}

function conversation(
  thread: OrchestrationV2ThreadShell,
  overrides: Partial<OrchestrationV2ThreadProjection> = {},
): OrchestrationV2ThreadProjection {
  return {
    ...v2Projection,
    thread: {
      ...v2Projection.thread,
      id: thread.id,
      title: thread.title,
      lineage: thread.lineage,
      creationSource: thread.creationSource,
      modelSelection: thread.modelSelection,
    },
    ...overrides,
  };
}

function setup() {
  const registry = AtomRegistry.make();
  const requested = new Set<string>();
  const states = Atom.family((_key: string) =>
    Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)),
  );
  const threadsAtom = Atom.family((_id: EnvironmentId) =>
    Atom.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]),
  );
  const environmentIdsAtom = Atom.make<ReadonlyArray<EnvironmentId>>([environmentId]);
  const details = createEnvironmentThreadDetailAtoms((environmentId, threadId) => {
    const key = threadKey({ environmentId, threadId });
    requested.add(key);
    return states(key);
  });
  return {
    registry,
    requested,
    threadsAtom,
    environmentIdsAtom,
    maps: createThreadAgentMapAtoms({ details, threadsAtom, environmentIdsAtom }),
    set(
      ref: ScopedThreadRef,
      projection: OrchestrationV2ThreadProjection | null,
      overrides: Partial<EnvironmentThreadState> = {},
    ) {
      registry.set(
        states(threadKey(ref)),
        AsyncResult.success({
          ...EMPTY_ENVIRONMENT_THREAD_STATE,
          status: "live",
          data: projection === null ? Option.none() : Option.some(projection),
          ...overrides,
        }),
      );
    },
    [Symbol.dispose]: () => registry.dispose(),
  };
}

describe("thread agent map", () => {
  it("keeps native tasks, nested descendants, and workflow members in one tree without duplicating threads", () => {
    const worker = agent("worker", { modelSelection: v2ThreadShell.modelSelection });
    const workflow = agent("workflow", {
      workflow: {
        phases: [],
        agents: [
          {
            index: 0,
            label: "Review",
            childThreadId: ThreadId.make("review"),
            state: "completed",
            prompt: "Review assignment",
            result: "Review output",
          },
        ],
      },
    });
    const child = (id: string, parent: string) => ({
      ...v2ThreadShell,
      id: ThreadId.make(id),
      title: id,
      lineage: {
        rootThreadId: threadId,
        parentThreadId: ThreadId.make(parent),
        relationshipToParent: "subagent" as const,
      },
    });
    const nodes = derive(
      [worker, workflow],
      [
        v2ThreadShell,
        child("worker", threadId),
        child("nested", "worker"),
        child("review", "workflow"),
        child("unrelated", "other"),
      ],
    );
    expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
      ["worker", null],
      ["workflow", null],
      ["workflow:agent:0", "workflow"],
      ["thread:nested", "worker"],
    ]);
    const review = nodes.find((node) => node.kind === "Workflow agent")!;
    expect(review.prompt).toBe("Review assignment");
    expect(review.agent.progress).toBeNull();
    expect(review.agent.result).toBe("Review output");
    expect(nodes[0]?.agent.model).toBe(v2ThreadShell.modelSelection.model);
    expect(agentMapMetadata(nodes[0]!, undefined).model).toBe("GPT-5.4 (configured)");
    const configured = resolveAgentMapConversation(nodes[0]!, {
      environmentId,
      projection: conversation({
        ...child("worker", threadId),
        modelSelection: { ...v2ThreadShell.modelSelection, model: "gpt-6.1" },
      }),
    });
    expect(configured.agent.model).toBe(v2ThreadShell.modelSelection.model);
  });

  it("uses recorded nested parentage even when records arrive out of order", () => {
    const nodes = derive([
      agent("nested", { parentNodeId: NodeId.make("worker") }),
      agent("worker"),
    ]);
    expect(nodes.find((node) => node.id === "nested")?.parentId).toBe("worker");
  });

  it("keeps remote targets environment-scoped and tasks without a conversation inspectable", () => {
    const remote = {
      environmentId: EnvironmentId.make("remote"),
      threadId,
      label: "Build machine",
    };
    const nodes = derive([
      agent("no-thread", { childThreadId: null }),
      agent("remote-task", { origin: "app_owned", childThreadId: null, remoteChild: remote }),
    ]);
    expect(nodes[0]?.target).toBeNull();
    expect(nodes[0]?.prompt).toBe("Assignment for no-thread");
    expect(nodes[1]?.target).toEqual({ environmentId: remote.environmentId, threadId });
    expect(nodes[1]?.thread).toBeNull();
    expect(nodes[1]?.source?.remoteChild?.label).toBe("Build machine");

    using ctx = setup();
    ctx.registry.set(ctx.environmentIdsAtom, [environmentId, remote.environmentId]);
    ctx.set(
      ref,
      conversation(v2ThreadShell, {
        subagents: [
          agent("remote-task", { origin: "app_owned", result: null, remoteChild: remote }),
        ],
      }),
    );
    const atom = ctx.maps.nodeAtom(ref, "remote-task");
    ctx.registry.mount(atom);
    expect(ctx.registry.get(atom)?.detailsState).toBe("loading");
    expect(agentMapOutput(ctx.registry.get(atom)!)).toBeNull();
    ctx.set(
      remote,
      conversation(v2ThreadShell, {
        messages: [
          {
            id: MessageId.make("remote-output"),
            threadId,
            runId: null,
            nodeId: null,
            createdBy: "agent",
            creationSource: "provider",
            role: "assistant",
            text: "Remote result",
            attachments: [],
            streaming: false,
            createdAt: later,
            updatedAt: later,
          },
        ],
      }),
    );
    expect(agentMapOutput(ctx.registry.get(atom)!)).toBe("Remote result");
    ctx.registry.set(ctx.environmentIdsAtom, [environmentId]);
    expect(ctx.registry.get(atom)?.detailsState).toBe("unavailable");
  });

  it("loads a nested task from its owner without fetching every child conversation", () => {
    using ctx = setup();
    const worker = nativeChild("worker");
    const nested = nativeChild("nested", worker.id);
    ctx.registry.set(ctx.threadsAtom(environmentId), [v2ThreadShell, worker, nested]);
    ctx.set(ref, conversation(v2ThreadShell, { subagents: [agent("worker")] }));
    ctx.registry.mount(ctx.maps.nodesAtom(ref));
    expect(ctx.registry.get(ctx.maps.nodesAtom(ref))).toHaveLength(2);
    expect([...ctx.requested]).toEqual([threadKey(ref)]);

    const atom = ctx.maps.nodeAtom(ref, "thread:nested");
    ctx.registry.mount(atom);
    expect(ctx.registry.get(atom)?.detailsState).toBe("loading");
    const task = agent("nested", { model: "gpt-5.4", threadId: worker.id });
    const ownerRef = { environmentId, threadId: worker.id };
    ctx.set(ownerRef, conversation(worker, { subagents: [task] }));
    expect(ctx.registry.get(atom)).toMatchObject({
      id: "thread:nested",
      parentId: "worker",
      source: task,
      prompt: task.prompt,
      detailsState: "ready",
      agent: { model: "gpt-5.4", result: task.result, status: "completed" },
    });
    expect([...ctx.requested]).toEqual([threadKey(ref), threadKey(ownerRef)]);
    ctx.set(ownerRef, conversation(worker, { subagents: [{ ...task, result: "Updated result" }] }));
    expect(agentMapOutput(ctx.registry.get(atom)!)).toBe("Updated result");
  });

  it("recovers native output and completion from the child transcript when no task record exists", () => {
    using ctx = setup();
    const child = nativeChild("native");
    const childRef = { environmentId, threadId: child.id };
    ctx.registry.set(ctx.threadsAtom(environmentId), [v2ThreadShell, child]);
    ctx.set(ref, v2Projection);
    const atom = ctx.maps.nodeAtom(ref, "thread:native");
    ctx.registry.mount(atom);
    expect(ctx.registry.get(atom)?.detailsState).toBe("loading");
    expect(agentMapStatus(ctx.registry.get(atom)!).label).toBe("Loading");
    const childProjection = conversation(child, {
      nodes: [
        {
          id: NodeId.make("native-root"),
          threadId: child.id,
          runId: null,
          parentNodeId: null,
          rootNodeId: NodeId.make("native-root"),
          kind: "root_turn",
          status: "completed",
          countsForRun: false,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          runtimeRequestId: null,
          checkpointScopeId: null,
          startedAt: v2Now,
          completedAt: later,
        },
      ],
      messages: [
        {
          id: MessageId.make("assignment"),
          threadId: child.id,
          runId: null,
          nodeId: null,
          createdBy: "agent",
          creationSource: "provider",
          role: "user",
          text: "Check repairs",
          attachments: [],
          streaming: false,
          createdAt: v2Now,
          updatedAt: v2Now,
        },
      ],
      turnItems: [
        {
          id: TurnItemId.make("native-output"),
          threadId: child.id,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: later,
          completedAt: later,
          updatedAt: later,
          type: "assistant_message",
          messageId: MessageId.make("answer"),
          text: "Repairs checked",
          streaming: false,
        },
      ],
    });
    ctx.set(childRef, childProjection);
    expect(ctx.registry.get(atom)).toMatchObject({
      detailsState: "ready",
      prompt: "Check repairs",
      modelIsConfigured: true,
      agent: {
        status: "completed",
        result: "Repairs checked",
        completedAt: DateTime.formatIso(later),
      },
    });
    expect(agentMapMetadata(ctx.registry.get(atom)!, undefined).model).toBe("GPT-5.4 (configured)");
    ctx.set(childRef, null, { error: Option.some("Connection lost") });
    expect(ctx.registry.get(atom)?.detailsState).toBe("unavailable");
    const inherited = childProjection.turnItems[0]!;
    ctx.set(
      childRef,
      conversation(child, {
        visibleTurnItems: [
          {
            position: 0,
            visibility: "inherited",
            sourceThreadId: threadId,
            sourceItemId: inherited.id,
            item: { ...inherited, threadId },
          },
        ],
      }),
    );
    expect(ctx.registry.get(atom)?.detailsState).toBe("ready");
    expect(agentMapOutput(ctx.registry.get(atom)!)).toBeNull();
  });

  it("clears the old result when an agent resumes and does not mistake waiting for a request", () => {
    const worker = agent("worker");
    const runId = RunId.make("resumed");
    const thread = {
      ...v2ThreadShell,
      id: worker.childThreadId!,
      latestRunRequestedAt: later,
      latestRunStartedAt: later,
      latestRunId: runId,
      activeRunId: runId,
      status: "waiting" as const,
    };
    const [node] = derive([worker], [thread]);
    expect(node?.agent.status).toBe("waiting");
    expect(node?.agent.result).toBeNull();
    expect(node?.agent.startedAt).toBe(DateTime.formatIso(later));
    expect(agentMapStatus(node!)).toEqual({ label: "Waiting", tone: "waiting" });
    expect(derive([worker], [thread]).map((entry) => entry.id)).toEqual(["worker"]);
    expect(
      resolveAgentMapConversation(node!, {
        environmentId,
        projection: conversation(thread),
      }),
    ).toMatchObject({ detailsState: "loading", agent: { result: null, progress: null } });
    const run: OrchestrationV2ThreadProjection["runs"][number] = {
      id: runId,
      threadId: thread.id,
      ordinal: 1,
      providerInstanceId: thread.providerInstanceId,
      modelSelection: thread.modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make("followup"),
      rootNodeId: null,
      activeAttemptId: null,
      status: "waiting",
      requestedAt: later,
      startedAt: DateTime.makeUnsafe("2026-06-20T01:00:05.000Z"),
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    };
    const resumed = resolveAgentMapConversation(node!, {
      environmentId,
      projection: conversation(thread, {
        runs: [
          run,
          {
            ...run,
            id: RunId.make("queued"),
            status: "queued",
            requestedAt: DateTime.makeUnsafe("2026-06-20T02:00:00.000Z"),
          },
        ],
        messages: [
          {
            id: MessageId.make("old"),
            threadId: thread.id,
            runId: null,
            nodeId: null,
            createdBy: "agent",
            creationSource: "provider",
            role: "assistant",
            text: "Old result",
            attachments: [],
            streaming: false,
            createdAt: v2Now,
            updatedAt: v2Now,
          },
          {
            id: run.userMessageId,
            threadId: thread.id,
            runId,
            nodeId: null,
            createdBy: "user",
            creationSource: "web",
            role: "user",
            text: "Follow-up assignment",
            attachments: [],
            streaming: false,
            createdAt: later,
            updatedAt: later,
          },
          {
            id: MessageId.make("current"),
            threadId: thread.id,
            runId,
            nodeId: null,
            createdBy: "agent",
            creationSource: "provider",
            role: "assistant",
            text: "Current progress",
            attachments: [],
            streaming: true,
            createdAt: run.startedAt!,
            updatedAt: run.startedAt!,
          },
        ],
      }),
    });
    expect(resumed.prompt).toBe("Follow-up assignment");
    expect(resumed.agent).toMatchObject({
      status: "waiting",
      result: null,
      progress: "Current progress",
      completedAt: null,
    });
  });
});
