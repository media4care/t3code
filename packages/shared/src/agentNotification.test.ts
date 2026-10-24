import { describe, expect, it } from "@effect/vitest";
import { ProviderSessionId, RuntimeRequestId } from "@t3tools/contracts";
import { projectAgentNotification } from "./agentNotification.ts";

function question() {
  return {
    request: {
      id: RuntimeRequestId.make("request-1"),
      status: "pending" as const,
      responseCapability: {
        type: "live" as const,
        providerSessionId: ProviderSessionId.make("session"),
      },
    },
    item: {
      type: "user_input_request" as const,
      requestId: RuntimeRequestId.make("request-1"),
      questions: [
        {
          id: "environment",
          header: "Environment",
          question: "Where should I deploy?",
          options: [
            { label: "Staging", description: "Test first", value: "staging" },
            { label: "Production", description: "Release", value: "production" },
          ],
        },
      ],
    },
  };
}

describe("agent notification context", () => {
  it("includes the question and numbered labels while retaining exact answer values", () => {
    expect(projectAgentNotification(question())).toEqual({
      requestId: "request-1",
      kind: "user_input",
      body: "Where should I deploy?\n1. Staging\n2. Production",
      action: {
        kind: "user_input",
        questionId: "environment",
        choices: ["staging", "production"],
        allowText: true,
      },
    });
  });
  it("does not reuse a resolved or mismatched request", () => {
    const input = question();
    expect(
      projectAgentNotification({ ...input, request: { ...input.request, status: "resolved" } }),
    ).toBeUndefined();
    expect(
      projectAgentNotification({
        ...input,
        item: { ...input.item, requestId: RuntimeRequestId.make("older") },
      }),
    ).toBeUndefined();
  });

  it("allows a single asynchronous question to use the normal message response path", () => {
    const input = question();
    expect(
      projectAgentNotification({
        ...input,
        request: { ...input.request, responseCapability: { type: "message" } },
        item: { ...input.item, responseMode: "message" },
      })?.action,
    ).toMatchObject({ kind: "user_input", questionId: "environment" });
  });
  it("keeps multi-question and multi-select forms in the app", () => {
    const input = question();
    expect(
      projectAgentNotification({
        ...input,
        item: { ...input.item, questions: [...input.item.questions, ...input.item.questions] },
      })?.action,
    ).toBeUndefined();
    expect(
      projectAgentNotification({
        ...input,
        item: {
          ...input.item,
          questions: input.item.questions.map((q) => ({ ...q, multiSelect: true })),
        },
      })?.action,
    ).toBeUndefined();
  });
  it("honors disabled custom answers and does not truncate choice values", () => {
    const input = question();
    const item = {
      ...input.item,
      questions: input.item.questions.map((q) => ({ ...q, allowCustomAnswer: false })),
    };
    expect(projectAgentNotification({ ...input, item })?.action).toMatchObject({
      allowText: false,
    });
    expect(
      projectAgentNotification({
        ...input,
        item: {
          ...item,
          questions: item.questions.map((q) => ({
            ...q,
            options: [{ label: "Large", description: "", value: "x".repeat(900) }],
          })),
        },
      })?.action,
    ).toBeUndefined();
  });
  it("does not offer an approval when the displayed command is incomplete", () => {
    const { request } = question();
    const item = { type: "approval_request" as const, requestId: request.id, prompt: "git status" };
    expect(projectAgentNotification({ request, item })?.action).toEqual({ kind: "approval" });
    expect(
      projectAgentNotification({
        request,
        item: { ...item, prompt: "dangerous command ".repeat(100) },
      })?.action,
    ).toBeUndefined();
    expect(
      projectAgentNotification({
        request: { ...request, responseCapability: { type: "not_resumable", reason: "offline" } },
        item,
      })?.action,
    ).toBeUndefined();
  });
});
