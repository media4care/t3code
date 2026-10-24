import ExpoModulesCore
import ExpoNotifications
import UIKit
@preconcurrency import UserNotifications

public final class T3NotificationActionSubscriber: ExpoAppDelegateSubscriber, NotificationDelegate {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    T3NotificationActions.registerCategories()
    NotificationCenterManager.shared.addDelegate(self)
    return true
  }

  public func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    guard response.actionIdentifier.hasPrefix("t3.") else { return false }
    DispatchQueue.main.async {
      T3NotificationActions.begin(response)
    }
    // Expo must retain a cold-start response until its JS emitter is ready.
    return false
  }
}

@MainActor
enum T3NotificationActions {
  private struct Pending {
    let task: UIBackgroundTaskIdentifier
    let content: UNNotificationContent
    let timeout: DispatchWorkItem
    let expiresAt: Double
  }
  private static var pending: [String: Pending] = [:]

  private static func key(_ identifier: String, _ action: String) -> String {
    "\(identifier.count):\(identifier)\(action)"
  }

  static func begin(_ response: UNNotificationResponse) {
    let identifier = response.notification.request.identifier
    let action = response.actionIdentifier
    let key = key(identifier, action)
    guard pending[key] == nil else { return }
    let timeout = DispatchWorkItem { finish(identifier: identifier, action: action, sent: false) }
    let task = UIApplication.shared.beginBackgroundTask(withName: "T3 notification reply") {
      finish(identifier: identifier, action: action, sent: false)
    }
    pending[key] = Pending(task: task, content: response.notification.request.content, timeout: timeout,
                           expiresAt: Date().timeIntervalSince1970 * 1000 + 20_000)
    // Expo acknowledges the OS callback before JS finishes, so own the execution lease.
    DispatchQueue.main.asyncAfter(deadline: .now() + 23, execute: timeout)
  }

  static func deadline(identifier: String, action: String) -> Double {
    pending[key(identifier, action)]?.expiresAt ?? 0
  }

  static func finish(identifier: String, action: String, sent: Bool) {
    guard let entry = pending.removeValue(forKey: key(identifier, action)) else { return }
    entry.timeout.cancel()
    let content = UNMutableNotificationContent()
    content.title = sent ? "Response sent" : "Response not confirmed"
    content.body = sent
      ? entry.content.title
      : "Open T3 Code on your iPhone to check the request and respond."
    content.sound = .default
    if var data = entry.content.userInfo["body"] as? [String: Any] {
      data.removeValue(forKey: "request")
      content.userInfo = data
    }
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: "t3-response-\(identifier)", content: content, trigger: nil)
    ) { _ in
      if entry.task != .invalid {
        DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(entry.task) }
      }
    }
  }

  static func registerCategories() {
    let reply = UNTextInputNotificationAction(
      identifier: "t3.reply", title: "Reply", options: [],
      textInputButtonTitle: "Send", textInputPlaceholder: "Your answer"
    )
    var categories = Set<UNNotificationCategory>()
    for count in 0...3 {
      for allowText in [false, true] where count > 0 || allowText {
        var actions: [UNNotificationAction] = allowText ? [reply] : []
        actions += (0..<count).map { index in
          UNNotificationAction(identifier: "t3.choice.\(index)", title: "Option \(index + 1)", options: [])
        }
        let suffix = allowText ? "reply" : "choice"
        categories.insert(UNNotificationCategory(
          identifier: "t3-input-\(count)-\(suffix)-v1", actions: actions, intentIdentifiers: [], options: []
        ))
      }
    }
    categories.insert(UNNotificationCategory(
      identifier: "t3-approval-v1",
      actions: [
        UNNotificationAction(identifier: "t3.reject", title: "Reject", options: []),
        // Watch Double Tap selects the first nondestructive action, never approval.
        UNNotificationAction(identifier: "t3.approve", title: "Approve once", options: [.destructive]),
      ], intentIdentifiers: [], options: []
    ))
    let registered = categories
    UNUserNotificationCenter.current().getNotificationCategories { existing in
      let retained = existing.filter { !$0.identifier.hasPrefix("t3-input-") && $0.identifier != "t3-approval-v1" }
      UNUserNotificationCenter.current().setNotificationCategories(Set(retained).union(registered))
    }
  }
}
