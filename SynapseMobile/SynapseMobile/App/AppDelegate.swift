import Foundation
import UIKit
import UserNotifications

/// Handles the two things SwiftUI cannot: the APNs token callback and
/// notification actions.
///
/// An action can arrive with the app suspended and no UI running, so it does not
/// go through `SynapseAppModel`. It builds its own client from the keychain and
/// submits the intent over HTTP — the request carries the answer back, because
/// there is no websocket open to receive one on.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // 主屏长按 App 图标：「开始录音」排第一。
        //
        // 这一条不依赖任何一台电脑，也不依赖这个账号在线——录音采在手机上。所以它排在
        // 所有和电脑有关的入口前面，是「掏出手机想立刻记点什么」最短的那条路。
        application.shortcutItems = [
            UIApplicationShortcutItem(
                type: Self.startRecordingShortcutType,
                localizedTitle: "开始录音",
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "waveform"),
                userInfo: nil
            )
        ]
        return true
    }

    /// 主屏快捷操作被我按下的那一次。
    ///
    /// 走 `NotificationRouter` 而不是直接开录音：这条路径可能在任何界面之前跑完，而
    /// 「把用户带到录音页」是界面的事。和通知点击同一条路，也就和它同一套顺序保证。
    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard shortcutItem.type == Self.startRecordingShortcutType else {
            completionHandler(false)
            return
        }
        NotificationRouter.shared.route(to: .newRecording)
        completionHandler(true)
    }

    private static let startRecordingShortcutType = "com.liy.SynapseMobile.startRecording"

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushRegistrar.shared.handleDeviceToken(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushRegistrar.shared.handleRegistrationFailure() }
    }

    /// Terminal alerts are worth showing even while the app is in front — the user
    /// may be looking at one terminal while another blocks.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        if notification.request.content.userInfo["notificationLevel"] as? String == "passive" {
            return []
        }
        return [.banner, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let notificationId = info["notificationId"] as? String {
            NotificationRouter.shared.route(to: .message(id: notificationId))
            return
        }
        // 转写完成的通知只带一个录音号：结果在服务端，点开直接看那一段文字，不需要电脑
        // 在线，也没有要在锁屏上做的决定。
        if let meetingId = info["meetingId"] as? String {
            NotificationRouter.shared.route(to: .meeting(meetingId: meetingId))
            return
        }
        guard let desktopClientInstanceId = info["desktopClientInstanceId"] as? String,
              let sessionId = info["sessionId"] as? String else { return }

        // A plain tap opens the app on the session that needs attention. Answering
        // on the lock screen is the shortcut; this is the path for someone who
        // wants to look before deciding.
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            NotificationRouter.shared.route(
                to: .terminal(sessionId: sessionId, desktopClientInstanceId: desktopClientInstanceId)
            )
            return
        }

        let decision: String?
        switch response.actionIdentifier {
        case NotificationAction.approve: decision = "approve"
        case NotificationAction.deny: decision = "deny"
        default: decision = nil
        }
        guard let decision else { return }

        // Runs with no scene attached, so it cannot go through the app model.
        // The request carries the answer back rather than waiting for one on a
        // socket that is not open.
        let tokens = TokenStore()
        let client = APIClient(tokens: tokens) {}
        // Only a restored session is any use here: if the server cannot be reached
        // the answer cannot be delivered either, so there is nothing to do.
        guard await client.restoreSession() == .restored else { return }

        let intent = MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "keys",
            sessionId: sessionId,
            actions: decision == "approve"
                // The permission prompt selects "1. Yes" on Enter.
                ? [.key(.enter)]
                : [.key(.escape)]
        )
        _ = try? await client.submitIntent(
            desktopClientInstanceId: desktopClientInstanceId,
            intent: intent,
            waitForResult: true
        )
    }
}
