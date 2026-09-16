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
        return true
    }

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
        [.banner, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
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
