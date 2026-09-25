import SwiftUI

/// 「我的」的七个分类。
///
/// 顺序即显示顺序，也即 iPadOS 侧边栏里的顺序。分三组看：账号与电脑说的是「你现在是谁、
/// 在哪台机器上」；终端、录音、通知是本机行为的三个面；诊断与关于是把它交出去的两个出口。
enum SettingsCategory: String, CaseIterable, Identifiable {
    case account, desktops, terminal, recording, notifications, diagnostics, about

    var id: Self { self }

    var title: String {
        switch self {
        case .account: "账号"
        case .desktops: "电脑"
        case .terminal: "终端"
        case .recording: "录音"
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
        case .recording: "waveform"
        case .notifications: "bell"
        case .diagnostics: "waveform.path.ecg"
        case .about: "info.circle"
        }
    }
}

/// 「我的」。
///
/// 外层只有分类，点进去才是设置。这一条**两种宽度下都一样**：iPhone 上
/// `NavigationSplitView` 折叠成单列下钻，于是「我的」在两种设备上是同一件事，
/// 换掉的是原来那个 compact 特判 —— 它把账号、显示密度、电脑、诊断四段**平铺在一屏**，
/// 每加一个设置就长一行。七个分类之后那样已经读不动了。
struct AdaptiveSettingsView: View {
    @Binding var selection: SettingsCategory?
    let onSelectDesktop: () -> Void

    var body: some View {
        AdaptiveFeatureNavigation(
            selection: $selection,
            emptyTitle: "选择设置",
            emptySymbol: "gearshape"
        ) {
            List(SettingsCategory.allCases, selection: $selection) { category in
                NavigationLink(value: category) {
                    Label(category.title, systemImage: category.symbol)
                }
            }
            .navigationTitle("我的")
        } detail: { category in
            NavigationStack {
                SettingsView(category: category, onSelectDesktop: onSelectDesktop)
            }
        }
    }
}
