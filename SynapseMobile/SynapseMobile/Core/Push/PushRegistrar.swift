import Foundation
import UIKit
import UserNotifications

/// Registers for terminal notifications and exposes the APNs device token.
///
/// Everything here is best effort. A phone that refuses notifications, or a
/// simulator that cannot obtain a token at all, still has a fully working app:
/// the in-app inbox is the source of truth and pushes are only a way to reach
/// the user sooner.
@MainActor
final class PushRegistrar: NSObject {
    static let shared = PushRegistrar()

    private var onToken: ((String) -> Void)?

    func requestAuthorizationAndRegister(onToken: @escaping (String) -> Void) async {
        self.onToken = onToken
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }

        // Actions on the notification itself, so a permission prompt can be
        // answered from the lock screen without opening the app.
        let approve = UNNotificationAction(
            identifier: NotificationAction.approve,
            title: "允许一次",
            options: []
        )
        let deny = UNNotificationAction(
            identifier: NotificationAction.deny,
            title: "拒绝",
            options: [.destructive]
        )
        let category = UNNotificationCategory(
            identifier: NotificationAction.category,
            actions: [approve, deny],
            intentIdentifiers: [],
            options: []
        )
        // 转写完成的通知没有要在锁屏上做的决定，点开就是看逐字稿，所以只登记一个
        // 没有动作的 category —— 服务端按名字投递，名字必须在这里有一份。
        let meetingCategory = UNNotificationCategory(
            identifier: NotificationCategory.meetingTranscription,
            actions: [],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([category, meetingCategory])
        // AppDelegate owns the notification-centre delegate. Claiming it here too
        // would silently replace the object that handles notification taps, and a
        // delegate that does not implement `didReceive` turns every tap into a no-op.
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Called from the app delegate once APNs hands back a token.
    func handleDeviceToken(_ data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        onToken?(token)
    }

    func handleRegistrationFailure() {
        // Nothing to do: the app works without push.
    }
}

enum NotificationCategory {
    static let meetingTranscription = "MEETING_TRANSCRIPTION"
}

enum NotificationAction {
    static let category = "TERMINAL_APPROVAL"
    static let approve = "TERMINAL_APPROVE"
    static let deny = "TERMINAL_DENY"
}
