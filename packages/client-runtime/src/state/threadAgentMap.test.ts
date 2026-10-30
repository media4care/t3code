import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { agentMapMetadata, agentMapStatus, deriveThreadAgentMap } from "./threadAgentMap.ts";
import { v2Now, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const environmentId = EnvironmentId.make("local");
const threadId = v2ThreadShell.id;
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

describe("thread agent map", () => {
  it("keeps native tasks, nested descendants, and workflow members in one tree without duplicating threads", () => {
    const worker = agent("worker");
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
    expect(agentMapMetadata(nodes[0]!, undefined).model).toBe("Not reported");
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
  });

  it("clears the old result when an agent resumes and does not mistake waiting for a request", () => {
    const worker = agent("worker");
    const later = DateTime.makeUnsafe("2026-06-20T01:00:00.000Z");
    const thread = {
      ...v2ThreadShell,
      id: worker.childThreadId!,
      latestRunRequestedAt: later,
      latestRunStartedAt: later,
      status: "waiting" as const,
    };
    const [node] = derive([worker], [thread]);
    expect(node?.agent.status).toBe("waiting");
    expect(node?.agent.result).toBeNull();
    expect(node?.agent.startedAt).toBe(DateTime.formatIso(later));
    expect(agentMapStatus(node!)).toEqual({ label: "Waiting", tone: "waiting" });
    expect(derive([worker], [thread]).map((entry) => entry.id)).toEqual(["worker"]);
  });
});
