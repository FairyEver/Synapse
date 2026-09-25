import SwiftUI

enum SettingsCategory: String, CaseIterable, Identifiable {
    case account, desktops, terminal, meetings, notifications, diagnostics, about

    var id: Self { self }

    var title: String {
        switch self {
        case .account: "账号"
        case .desktops: "电脑"
        case .terminal: "终端"
        case .meetings: "录音"
        case .notifications: "通知"
        case .diagnostics: "诊断"
        case .about: "关于"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .desktops: "desktopcomputer"
        case .terminal: "terminal"
        case .meetings: "waveform"
        case .notifications: "bell"
        case .diagnostics: "waveform.path.ecg"
        case .about: "info.circle"
        }
    }
}

/// 「我的」。
///
/// 外层只有分类，值在二级页 —— 和 iOS 的「设置」同构。这**两种窗口宽度下都一样**：
/// 紧凑窗口点一行推入那一页，宽窗口右边直接换内容。平铺一屏看着省事，代价是每加一个
/// 设置就长一行，而那正是这一版要改掉的东西。
struct AdaptiveSettingsView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Binding var selection: SettingsCategory?
    let onSelectDesktop: () -> Void
    /// 打开通知面板。「通知中心」那一行走这条 —— 面板挂在根视图上，这里只是另一个入口。
    let onOpenNotifications: () -> Void

    var body: some View {
        if horizontalSizeClass == .compact {
            NavigationStack {
                List(SettingsCategory.allCases) { category in
                    NavigationLink(value: category) {
                        SettingsCategoryRow(category: category)
                    }
                }
                .navigationTitle("我的")
                .navigationDestination(for: SettingsCategory.self) { category in
                    SettingsView(
                        category: category,
                        onSelectDesktop: onSelectDesktop,
                        onOpenNotifications: onOpenNotifications
                    )
                }
            }
        } else {
            AdaptiveFeatureNavigation(
                selection: $selection,
                emptyTitle: "选择设置",
                emptySymbol: "gearshape"
            ) {
                List(SettingsCategory.allCases, selection: $selection) { category in
                    NavigationLink(value: category) {
                        SettingsCategoryRow(category: category)
                    }
                }
                .navigationTitle("我的")
            } detail: { category in
                NavigationStack {
                    SettingsView(
                        category: category,
                        onSelectDesktop: onSelectDesktop,
                        onOpenNotifications: onOpenNotifications
                    )
                }
            }
        }
    }
}

/// 「我的」外层的一行：图标 + 分类名 + 值 + 箭头。
///
/// 只有两行带值，而且这是**「值放二级页」唯一的例外**：账号和电脑反映的是「你现在处在
/// 什么状态」，不是一个可以调的设置 —— 一眼可见比点进去再退出来有用。
private struct SettingsCategoryRow: View {
    @Environment(SynapseAppModel.self) private var model
    let category: SettingsCategory

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: category.symbol)
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .frame(width: 24)
            Text(category.title)
            Spacer(minLength: 8)
            if category == .desktops {
                Circle()
                    // 绿点只在真有电脑连得上时亮：一份**没能取回来**的列表不是一台在线的
                    // 电脑，和终端列表设备行上那一颗是同一个判据。
                    .fill(model.connectivity == .online ? Theme.running : Color.secondary)
                    .frame(width: 7, height: 7)
            }
            if let value {
                Text(value)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var value: String? {
        switch category {
        case .account: model.email
        case .desktops: model.selectedDesktopClientInstanceId.map(model.desktopName)
        default: nil
        }
    }
}
