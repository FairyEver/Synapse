import SwiftUI
import UIKit

/// 「我的」的外层：只有分类，值放二级页。
///
/// 例外只有两行 —— 账号与电脑。它们右边显示的不是一个可以调的设置，而是「你现在处在
/// 什么状态」：一眼可见比点进去再退出来有用。其余五个分类右边不画值。
///
/// 分三张卡片：账号与电脑说的是你是谁、在哪台机器上；终端、录音、通知是本机行为的三个面；
/// 诊断与关于是把它交出去的两个出口。iPadOS 的侧边栏是一列平铺，分组在那里不表达 ——
/// 这不是缺陷，系统的侧边栏本来就不分组。
struct SettingsCategoriesView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var selection: SettingsCategory?
    /// 录音那个分类外层显示的是权限状态，与它二级页里那一行同一个读法。
    @State private var microphone: PermissionRow.State = .undetermined

    var body: some View {
        List(selection: $selection) {
            Section {
                row(.account, value: model.email)
                row(.desktops, value: desktopValue, dot: desktopDot)
            }
            Section {
                row(.terminal, value: nil)
                row(.recording, value: microphone.label)
                row(.notifications, value: unreadValue)
            }
            Section {
                row(.diagnostics, value: nil)
                row(.about, value: AppVersion.label)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("我的")
        .task { microphone = Self.currentMicrophoneState() }
        // 用户可能在系统设置里改过。回到前台要重新读一次，否则这一行会一直停在
        // 上次进这一页时看到的样子。
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            microphone = Self.currentMicrophoneState()
        }
    }

    private static func currentMicrophoneState() -> PermissionRow.State {
        switch MeetingPermission.microphone {
        case .granted: .granted
        case .denied: .denied
        case .undetermined: .undetermined
        }
    }

    private var desktopValue: String? {
        guard let id = model.selectedDesktopClientInstanceId else { return nil }
        return model.desktopName(id)
    }

    /// 当前那台电脑在线是绿的，不在线是次要色 —— 与终端页设备行、二级页里的电脑行
    /// 是同一条：全应用只有一处说「这台在不在」。
    private var desktopDot: Color? {
        guard model.selectedDesktopClientInstanceId != nil else { return nil }
        return model.viewedDesktopIsOffline ? Color.secondary : Theme.running
    }

    /// 未读数照角标那条规则封顶（`NotificationText.badgeCount`）：这一行说的是「有没有、
    /// 多到什么程度」，不差那几个位数，而和铃铛、底栏写成两套数字更像两笔账。
    private var unreadValue: String? {
        let count = model.notifications.unreadCount
        return count > 0 ? "\(NotificationText.badgeCount(count)) 条未读" : nil
    }

    private func row(_ category: SettingsCategory, value: String?, dot: Color? = nil) -> some View {
        NavigationLink(value: category) {
            HStack(spacing: 12) {
                Image(systemName: category.symbol)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                Text(category.title)
                Spacer(minLength: 8)
                if let dot {
                    Circle().fill(dot).frame(width: 7, height: 7)
                }
                if let value {
                    Text(value)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityIdentifier("settings-category-\(category.rawValue)")
    }
}
