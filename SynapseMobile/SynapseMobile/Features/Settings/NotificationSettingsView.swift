import SwiftUI
import UIKit
import UserNotifications
import os

/// 「通知」这个分类。系统通知权限与 App 图标角标。
///
/// 系统通知权限不影响应用内消息；图标角标仍受系统权限约束。
struct NotificationSettingsView: View {
    @Environment(SynapseAppModel.self) private var model

    @State private var system: PermissionRow.State = .undetermined
    @State private var badgeEnabled = NotificationBadgePreference.isEnabled

    var body: some View {
        List {
            Section {
                PermissionRow(title: "系统通知", state: system) {
                    // 权限只能由系统弹框授予，而这里没有别的事要做 —— 弹框由
                    // `UNUserNotificationCenter` 在第一次注册设备令牌时触发。
                    // 这一行的「未请求」落到这里就是去开一次。
                    do {
                        _ = try await UNUserNotificationCenter.current()
                            .requestAuthorization(options: [.alert, .badge, .sound])
                    } catch {
                        AppLog.network.error("notification authorization request failed: \(error.localizedDescription, privacy: .public)")
                        model.notice("通知权限请求失败，请重试", tone: .failure)
                    }
                    system = await Self.currentSystemState()
                }
            } footer: {
                Text("关闭系统通知后，仍可在 App 内查看消息和待处理事项。")
            }

            Section {
                Toggle("图标角标", isOn: $badgeEnabled)
                    .tint(Theme.switchOn)
                    .accessibilityIdentifier("settings-badge-toggle")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Task { system = await Self.currentSystemState() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { system = await Self.currentSystemState() }
        }
        .onChange(of: badgeEnabled) { _, enabled in
            NotificationBadgePreference.isEnabled = enabled
        }
    }

    private static func currentSystemState() async -> PermissionRow.State {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }
}
