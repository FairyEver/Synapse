import SwiftUI

enum SettingsCategory: String, CaseIterable, Identifiable {
    case account, terminal, desktops, diagnostics

    var id: Self { self }

    var title: String {
        switch self {
        case .account: "账号"
        case .terminal: "终端"
        case .desktops: "已连接的电脑"
        case .diagnostics: "诊断"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .terminal: "terminal"
        case .desktops: "desktopcomputer"
        case .diagnostics: "waveform.path.ecg"
        }
    }
}

struct AdaptiveSettingsView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Binding var selection: SettingsCategory?
    let onSelectDesktop: () -> Void

    var body: some View {
        if horizontalSizeClass == .compact {
            NavigationStack {
                SettingsView(onSelectDesktop: onSelectDesktop)
            }
        } else {
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
}
