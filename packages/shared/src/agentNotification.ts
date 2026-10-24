import type { OrchestrationV2RuntimeRequest, OrchestrationV2TurnItem } from "@t3tools/contracts";
import type {
  RelayAgentNotification,
  RelayAgentNotificationAction,
} from "@t3tools/contracts/relay";

type QuestionItem = Pick<
  Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>,
  "type" | "requestId" | "questions" | "responseMode"
>;
type ApprovalItem = Pick<
  Extract<OrchestrationV2TurnItem, { type: "approval_request" }>,
  "type" | "requestId" | "prompt" | "reason" | "options"
>;

export function projectAgentNotification(input: {
  readonly request:
    | Pick<OrchestrationV2RuntimeRequest, "id" | "status" | "responseCapability">
    | undefined;
  readonly item: QuestionItem | ApprovalItem | undefined;
}): RelayAgentNotification | undefined {
  const { request, item } = input;
  if (!request || request.status !== "pending" || !item || item.requestId !== request.id) return;
  let body: string;
  let action: RelayAgentNotificationAction | undefined;
  if (item.type === "user_input_request") {
    body = item.questions
      .map((question) =>
        [
          question.question,
          ...question.options.map((option, index) => `${index + 1}. ${option.label}`),
        ].join("\n"),
      )
      .join("\n\n");
    const question = item.questions[0];
    // A notification has one reply field, so larger forms need the full editor.
    if (
      item.questions.length === 1 &&
      question &&
      !question.multiSelect &&
      request.responseCapability.type !== "not_resumable"
    ) {
      const choices =
        question.options.length <= 3
          ? question.options.map((option) => option.value ?? option.label)
          : [];
      const allowText = question.allowCustomAnswer !== false;
      if ((choices.length > 0 || allowText) && choices.every((value) => value.trim().length > 0)) {
        action = { kind: "user_input", questionId: question.id, choices, allowText };
      }
    }
  } else {
    body = [item.reason, item.prompt].filter(Boolean).join("\n\n");
    if (
      item.prompt?.trim() &&
      request.responseCapability.type === "live" &&
      item.options === undefined
    ) {
      action = { kind: "approval" };
    }
  }
  if (!body.trim()) return;
  // Never offer an approval or numbered choice without its complete displayed context.
  if (Array.from(body).length > 700) {
    body = `${Array.from(body).slice(0, 660).join("")}…\nOpen T3 Code to review the full request.`;
    action = undefined;
  }
  if (
    new TextEncoder().encode(JSON.stringify({ requestId: request.id, action })).byteLength > 768
  ) {
    action = undefined;
  }
  return {
    requestId: request.id,
    kind: item.type === "user_input_request" ? "user_input" : "approval",
    body,
    ...(action ? { action } : {}),
  };
}

export function agentNotificationCategory(action: RelayAgentNotificationAction): string {
  return action.kind === "approval"
    ? "t3-approval-v1"
    : `t3-input-${action.choices.length}-${action.allowText ? "reply" : "choice"}-v1`;
}
