# Mobile notifications

Get push alerts, Live Activities, and home-screen widgets on iOS and Android when agents finish, fail, or need your approval or input.

## Prerequisites

- Sign in to **T3 Connect** on both your phone and host machine (direct/Tailscale connections alone do not deliver background push notifications).
- Enable **Publish agent activity** in **Settings → Sharing & access** on the host.
- Enable **Device Notifications** in **Settings → Notifications** on mobile (Android requires Android 7.0+ and Google Play services).

## Live updates and widgets

- **Live progress**: Enable **Live Activity Updates** (iOS), **Agent Live Updates** (Android 16+, check **Live Update Settings** if missing), or **Ongoing Agent Activity** (older Android). Finished results stay visible for up to 15 minutes.
- **Silent live updates (Android 8+)**: Keep **Ongoing agent activity** on and disable **Agent alerts** in Android system notification settings.
- **iOS widget**: Add the **Agent Activity** widget to your Home Screen or Lock Screen (refreshes when you open T3; marks unfinished work stale after 10 minutes).

## Reply from a notification

With an environment, relay and iOS app that support notification replies, expand a question on your iPhone or paired Apple Watch to reply by text or dictation. Simple questions also offer numbered choices; short approval requests offer **Approve once** and **Reject**. Longer requests, multiple questions, multiple selections and requests that require the conversation editor open in the app. Android displays the question and opens the thread for answers.

Replies use your iPhone's authenticated connection to the environment. Keep the iPhone nearby and online. A locked phone may need you to unlock it and open T3 Code if iOS has stopped the app or its sign-in session needs refreshing. Wait for **Response sent**; **Response not confirmed** means you should check the thread before trying again. Expired questions cannot answer a newer request.

Agent activity publishing shares the question or approval text and its answer choices with the configured relay and notification delivery service. System notification preview settings control who can read that text on the lock screen.

## Notes

- Ordinary alerts are muted while the mobile app is in the foreground, though viewing a thread on another device does not silence your phone.
- Force-stopping T3 Code in Android system Settings pauses push delivery until you reopen the app.
