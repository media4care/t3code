import { describe, expect, it, vi } from "vite-plus/test";
import {
  createAgentNotificationActionHandler,
  parseAgentNotificationAction,
} from "./notificationActions";

function response(actionIdentifier = "t3.reply", userText = "Use staging") {
  return {
    actionIdentifier,
    userText,
    notification: {
      request: {
        identifier: "push-1",
        content: {
          data: {
            environmentId: "env-1",
            threadId: "thread-1",
            request: {
              requestId: "request-1",
              action: {
                kind: "user_input",
                questionId: "environment",
                choices: ["staging", "production"],
                allowText: true,
              },
            },
          },
        },
      },
    },
  };
}

describe("notification replies", () => {
  it("routes dictated text to the exact environment, thread, request and question", () => {
    expect(parseAgentNotificationAction(response())).toEqual({
      kind: "respond",
      environmentId: "env-1",
      threadId: "thread-1",
      requestId: "request-1",
      answers: { environment: "Use staging" },
    });
    expect(parseAgentNotificationAction(response("t3.choice.1"))).toMatchObject({
      answers: { environment: "production" },
    });
  });
  it("rejects empty replies, unavailable choices and actions from a different category", () => {
    for (const value of [
      response("t3.reply", " \n "),
      response("t3.choice.2"),
      response("t3.approve"),
    ]) {
      expect(parseAgentNotificationAction(value)).toEqual({ kind: "invalid" });
    }
    const value = response();
    value.notification.request.content.data.request.action.allowText = false;
    expect(parseAgentNotificationAction(value)).toEqual({ kind: "invalid" });
  });
  it("ignores ordinary taps and never infers a request from an old navigation-only push", () => {
    expect(
      parseAgentNotificationAction(response("expo.modules.notifications.actions.DEFAULT")),
    ).toEqual({ kind: "ignored" });
    expect(
      parseAgentNotificationAction({
        actionIdentifier: "t3.reply",
        notification: { request: { identifier: "old-push" } },
      }),
    ).toEqual({ kind: "invalid" });
  });
  it("limits approvals to this request, without session or permanent grants", () => {
    const value = response("t3.approve");
    const approval = {
      ...value,
      notification: {
        request: {
          ...value.notification.request,
          content: {
            data: {
              environmentId: "env-2",
              threadId: "thread-2",
              request: { requestId: "approval-2", action: { kind: "approval" } },
            },
          },
        },
      },
    };
    expect(parseAgentNotificationAction(approval)).toEqual({
      kind: "respond",
      environmentId: "env-2",
      threadId: "thread-2",
      requestId: "approval-2",
      decision: "accept",
    });
    expect(
      parseAgentNotificationAction({ ...approval, actionIdentifier: "t3.reject" }),
    ).toMatchObject({ decision: "decline" });
  });
  it("sends only once when the initial response and listener arrive concurrently", async () => {
    const delivery = Promise.withResolvers<boolean>();
    const send = vi.fn(() => delivery.promise);
    const finish = vi.fn(async () => {});
    const handle = createAgentNotificationActionHandler({ send, finish });
    const first = handle(response());
    const second = handle(response());
    expect(send).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    delivery.resolve(true);
    await Promise.all([first, second]);
    expect(finish).toHaveBeenCalledWith("push-1", "t3.reply", true);
    await handle(response());
    expect(send).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(3);
  });
  it("reports rejected or disconnected delivery rather than claiming the reply was sent", async () => {
    const finish = vi.fn(async () => {});
    const handle = createAgentNotificationActionHandler({
      send: () => Promise.reject(new Error("stale request")),
      finish,
    });
    await handle(response());
    expect(finish).toHaveBeenCalledExactlyOnceWith("push-1", "t3.reply", false);
  });

  it("does not send if JavaScript starts after the native execution window expired", async () => {
    using _now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const send = vi.fn(async () => true);
    const finish = vi.fn(async () => {});
    const handle = createAgentNotificationActionHandler({ send, finish });
    await handle(response(), 999);
    expect(send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledExactlyOnceWith("push-1", "t3.reply", false);
  });
  it("cancels a background reply that cannot connect within the execution window", async () => {
    vi.useFakeTimers();
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    const finish = vi.fn(async () => {});
    const handle = createAgentNotificationActionHandler({
      send: (_answer, signal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve(false), { once: true }),
        ),
      finish,
    });
    const work = handle(response());
    await vi.advanceTimersByTimeAsync(20_000);
    await work;
    expect(finish).toHaveBeenCalledExactlyOnceWith("push-1", "t3.reply", false);
  });
});
