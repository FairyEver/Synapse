import SwiftUI

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

    var body: some View {
        List(selection: $selection) {
            Section {
                row(.account, value: model.email)
                row(.desktops, value: desktopValue, dot: desktopDot)
            }
            Section {
                row(.terminal, value: nil)
                row(.recording, value: nil)
                row(.notifications, value: unreadValue)
            }
            Section {
                row(.diagnostics, value: nil)
                row(.about, value: AppVersion.label)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("我的")
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

    private var unreadValue: String? {
        let count = model.notifications.unreadCount
        return count > 0 ? "\(count) 条未读" : nil
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
