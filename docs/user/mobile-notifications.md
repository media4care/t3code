# Mobile notifications

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

With an environment, relay and iOS app that support notification replies, expand a question on your iPhone or paired Apple Watch to reply by text or dictation. Simple questions also offer numbered choices; short approval requests offer **Approve once** and **Reject**. Longer requests, multiple questions, multiple selections and requests that require the conversation editor open in the app. Android displays the question and opens the thread for answers.

Replies use your iPhone's authenticated connection to the environment. Keep the iPhone nearby and online. A locked phone may need you to unlock it and open T3 Code if iOS has stopped the app or its sign-in session needs refreshing. Wait for **Response sent**; **Response not confirmed** means you should check the thread before trying again. Expired questions cannot answer a newer request.

Agent activity publishing shares the question or approval text and its answer choices with the configured relay and notification delivery service. System notification preview settings control who can read that text on the lock screen.

Enable **Ongoing Agent Activity** on Android or **Live Activity Updates** on iOS to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off ongoing activity in Settings to stop future cards.

Ordinary alerts stay quiet while the mobile app is in the foreground. Ongoing activity continues to update. Viewing a thread on another device does not silence your phone's alerts.

Android notifications require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in system Settings. Background delivery requires T3 Connect; a direct or Tailscale connection alone does not enable push notifications. The mobile app does not need to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents push delivery until you open it again.
