import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  respondToThreadApproval,
  respondToThreadUserInput,
} from "@t3tools/client-runtime/operations";
import { createEnvironmentCommand, executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { CommandId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/reactivity";
import * as Crypto from "expo-crypto";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import type { AgentNotificationAnswer } from "./notificationActions";

const command = createEnvironmentCommand(connectionAtomRuntime, {
  label: "notification:respond",
  execute: Effect.fn("Notification.respond")(function* (input: {
    answer: AgentNotificationAnswer;
    commandId: CommandId;
    signal: AbortSignal;
    expiresAt: number;
  }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    yield* supervisor.retryNow;
    yield* SubscriptionRef.changes(supervisor.session).pipe(
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runDrain,
    );
    // A timed-out background startup must never approve later when the phone unlocks.
    yield* Effect.sync(() => {
      input.signal.throwIfAborted();
      if (Date.now() >= input.expiresAt) throw new Error("Notification reply expired.");
    });
    const { answer, commandId } = input;
    const common = { commandId, threadId: answer.threadId, requestId: answer.requestId };
    return "decision" in answer
      ? yield* respondToThreadApproval({ ...common, decision: answer.decision })
      : yield* respondToThreadUserInput({ ...common, answers: answer.answers });
  }),
});

export async function sendAgentNotificationAnswer(
  answer: AgentNotificationAnswer,
  signal: AbortSignal,
  expiresAt: number,
): Promise<boolean> {
  // Replayed OS callbacks reuse the server's durable command receipt.
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(answer),
  );
  signal.throwIfAborted();
  const atom = Atom.make(
    Effect.promise(() =>
      command.run(appAtomRegistry, {
        environmentId: answer.environmentId,
        input: { answer, commandId: CommandId.make(`notification-${digest}`), signal, expiresAt },
      }),
    ),
  ).pipe(Atom.setIdleTTL(0));
  const result = await executeAtomQuery(appAtomRegistry, atom, {
    signal,
    reportDefect: false,
    reportFailure: false,
  });
  return result._tag === "Success" && result.value._tag === "Success";
}
