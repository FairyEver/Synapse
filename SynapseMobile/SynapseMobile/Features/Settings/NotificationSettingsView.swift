import SwiftUI
import UIKit
import UserNotifications

/// 「通知」这个分类。系统通知权限、应用内的通知中心，以及 App 图标角标。
///
/// 关掉系统通知不影响任何功能：应用内的通知中心、待处理提示和图标角标都照常工作。
/// 这是这一页唯一需要说的一句 —— 否则关掉开关的人会以为自己从此收不到东西了。
struct NotificationSettingsView: View {
    @Environment(SynapseAppModel.self) private var model
    let onOpenNotifications: () -> Void

    @State private var system: PermissionRow.State = .undetermined
    @State private var badgeEnabled = NotificationBadgePreference.isEnabled

    var body: some View {
        List {
            Section {
                PermissionRow(title: "系统通知", state: system) {
                    // 权限只能由系统弹框授予，而这里没有别的事要做 —— 弹框由
                    // `UNUserNotificationCenter` 在第一次注册设备令牌时触发。
                    // 这一行的「未请求」落到这里就是去开一次。
                    _ = try? await UNUserNotificationCenter.current()
                        .requestAuthorization(options: [.alert, .badge, .sound])
                    system = await Self.currentSystemState()
                }
            } footer: {
                Text("关掉系统通知不影响任何功能：应用内的通知中心、待处理提示和图标角标都照常工作。")
            }

            Section {
                Button {
                    onOpenNotifications()
                } label: {
                    HStack {
                        Label("通知中心", systemImage: "bell")
                        Spacer(minLength: 8)
                        if model.notifications.unreadCount > 0 {
                            // 与铃铛、底栏同一份写法，见 `NotificationText.badgeCount`。
                            Text("\(NotificationText.badgeCount(model.notifications.unreadCount)) 条未读")
                                .foregroundStyle(.secondary)
                        }
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings-notification-center")

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
