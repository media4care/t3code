import { requireOptionalNativeModule } from "expo";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { createAgentNotificationActionHandler } from "./notificationActions";

const native = requireOptionalNativeModule<{
  finishNotificationAction?: (identifier: string, action: string, sent: boolean) => Promise<void>;
  notificationActionDeadline?: (identifier: string, action: string) => Promise<number>;
}>("T3NativeControls");

if (
  Platform.OS === "ios" &&
  native?.finishNotificationAction &&
  native.notificationActionDeadline
) {
  const finish = native.finishNotificationAction;
  const deadline = native.notificationActionDeadline;
  const handle = createAgentNotificationActionHandler({
    send: async (answer, signal, expiresAt) => {
      const { sendAgentNotificationAnswer } = await import("./sendNotificationAnswer");
      return sendAgentNotificationAnswer(answer, signal, expiresAt);
    },
    finish,
  });
  const receive = (response: Notifications.NotificationResponse) => {
    if (!response.actionIdentifier.startsWith("t3.")) return;
    void deadline(response.notification.request.identifier, response.actionIdentifier)
      .then((expiresAt) => handle(response, expiresAt))
      .catch(() => {
        console.warn("Could not finish handling the notification action.");
      });
  };
  // A background launch need not mount the navigation tree.
  Notifications.addNotificationResponseReceivedListener(receive);
  const response = Notifications.getLastNotificationResponse();
  if (response) receive(response);
}
