import { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { RelayAgentNotificationAction } from "@t3tools/contracts/relay";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { dataFromNotificationResponse } from "./notificationPayload";

const ActionData = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  request: Schema.Struct({ requestId: RuntimeRequestId, action: RelayAgentNotificationAction }),
});
const decodeActionData = Schema.decodeUnknownOption(ActionData);

export function parseAgentNotificationAction(response: {
  readonly actionIdentifier: string;
  readonly userText?: string;
  readonly notification: { readonly request: { readonly identifier: string } };
}) {
  if (!response.actionIdentifier.startsWith("t3.")) return { kind: "ignored" as const };
  const decoded = decodeActionData(dataFromNotificationResponse(response));
  if (Option.isNone(decoded)) return { kind: "invalid" as const };
  const { environmentId, threadId, request } = decoded.value;
  const base = { environmentId, threadId, requestId: request.requestId };
  if (request.action.kind === "approval") {
    if (response.actionIdentifier === "t3.approve" || response.actionIdentifier === "t3.reject") {
      return {
        kind: "respond" as const,
        ...base,
        decision:
          response.actionIdentifier === "t3.approve" ? ("accept" as const) : ("decline" as const),
      };
    }
  } else {
    const action = request.action;
    if (action.choices.length > 3) return { kind: "invalid" as const };
    const match = /^t3\.choice\.([0-2])$/.exec(response.actionIdentifier);
    const answer = match
      ? action.choices[Number(match[1])]
      : response.actionIdentifier === "t3.reply" && action.allowText
        ? response.userText?.trim()
        : undefined;
    if (answer && answer.length <= 4096) {
      return { kind: "respond" as const, ...base, answers: { [action.questionId]: answer } };
    }
  }
  return { kind: "invalid" as const };
}

export type AgentNotificationAnswer = Extract<
  ReturnType<typeof parseAgentNotificationAction>,
  { kind: "respond" }
>;

export function createAgentNotificationActionHandler(dependencies: {
  readonly send: (
    answer: AgentNotificationAnswer,
    signal: AbortSignal,
    expiresAt: number,
  ) => Promise<boolean>;
  readonly finish: (identifier: string, action: string, sent: boolean) => Promise<void>;
}) {
  const handled = new Map<string, Promise<boolean>>();
  return (
    response: Parameters<typeof parseAgentNotificationAction>[0],
    expiresAt = Date.now() + 20_000,
  ): Promise<void> => {
    const answer = parseAgentNotificationAction(response);
    if (answer.kind === "ignored") return Promise.resolve();
    const identifier = response.notification.request.identifier;
    const key = JSON.stringify([identifier, response.actionIdentifier, response.userText]);
    const existing = handled.get(key);
    if (existing)
      return existing.then((sent) =>
        dependencies.finish(identifier, response.actionIdentifier, sent),
      );
    const work = (async () => {
      const controller = new AbortController();
      // Stay inside iOS's short execution window, including cold runtime startup.
      const timeout = setTimeout(() => controller.abort(), Math.max(0, expiresAt - Date.now()));
      let sent = false;
      try {
        if (answer.kind === "respond" && Date.now() < expiresAt)
          sent = await dependencies.send(answer, controller.signal, expiresAt);
      } catch {
        // Report delivery failure without logging the question, reply or credentials.
      } finally {
        clearTimeout(timeout);
      }
      return sent;
    })();
    handled.set(key, work);
    if (handled.size > 100) handled.delete(handled.keys().next().value!);
    return work.then((sent) => dependencies.finish(identifier, response.actionIdentifier, sent));
  };
}
