import SwiftUI
import UIKit
import UserNotifications

/// 一个设置分类的内容。
///
/// 每个分类一屏，从「我的」的清单里点进来 —— 值放在这里，不在外层的清单上（两个例外
/// 除外，见 `SettingsCategoryRow`）。
struct SettingsView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Environment(\.openURL) private var openURL
    @AppStorage(NotificationBadgePreference.key) private var iconBadge = true
    @State private var showingSignOut = false
    @State private var microphone: MeetingMicrophonePermission = .undetermined
    /// `nil` 就是还没问到 —— 权限查询是异步的，而一个还没问到的答案不该先画一句
    /// 「未询问」再跳成别的。
    @State private var notificationsAllowed: Bool?
    let category: SettingsCategory
    let onSelectDesktop: () -> Void
    let onOpenNotifications: () -> Void

    var body: some View {
        List {
            switch category {
            case .account: accountSection
            case .desktops: desktopsSection
            case .terminal: terminalSection
            case .meetings: meetingsSection
            case .notifications: notificationSections
            case .diagnostics: diagnosticsSection
            case .about: aboutSection
            }
        }
        .listStyle(.insetGrouped)
        .noticeOverlay(model)
        .navigationTitle(category.title)
        .task {
            microphone = MeetingPermission.microphone
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            notificationsAllowed = settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
        }
        .alert("退出登录？", isPresented: $showingSignOut) {
            Button("取消", role: .cancel) {}
            Button("退出", role: .destructive) {
                // A dialog button gets no feedback of its own, and this one empties the
                // app and returns it to the sign-in screen.
                Haptics.warning()
                Task { await model.signOut() }
            }
        } message: {
            Text("本机保存的登录信息会被清除，终端控制将失效。")
        }
    }

    // MARK: - 账号

    @ViewBuilder
    private var accountSection: some View {
        Section("账号") {
            // 只读的值用次要色，与系统「设置」里那些信息行一致：它是给你认的，
            // 不是给你点的，更不该比它自己的标签还显眼。
            LabeledContent("邮箱") {
                Text(model.email ?? "未登录")
                    .foregroundStyle(.secondary)
            }
        }

        Section {
            Button("退出登录", role: .destructive) { showingSignOut = true }
        }
    }

    // MARK: - 电脑

    /// 点一行就换电脑，和「终端」那一屏的设备行是同一件事的两个入口：
    /// 那边是收起来的菜单，这边本来就是一列，直接把行变成按钮。
    ///
    /// 名字一律走 `model.desktopName(_:)`。它有三个来源——那台电脑正在发的 summary、
    /// 设备列表接口带回来的名字、上一回见过的名字——哪一台该用哪一个由那一个函数说了算，
    /// 不在这两处各推一遍。
    @ViewBuilder
    private var desktopsSection: some View {
        Section("已连接的电脑") {
            if model.onlineDesktops.isEmpty {
                // 标题和说明都取自 `model.connectivity`，也就是终端页空态用的同一个来源：
                // 同一件事在一处告诉用户怎么解决（「请在电脑上打开 Synapse 并登录。」或
                // 「请检查这台手机的网络。」），在另一处只丢一句「没有」，两个答案就对不上。
                //
                // `.online` 落不到这里——在线就至少有一台电脑签着。真落到了就按「没有电脑」
                // 说，总比报一句「已连接」强。
                let state = model.connectivity == .online ? .noComputer : model.connectivity
                ContentUnavailableView(
                    state.label,
                    systemImage: "desktopcomputer",
                    description: state.guidance.map { Text($0) }
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(model.onlineDesktops) { desktop in
                    Button {
                        guard desktop.clientInstanceId != model.selectedDesktopClientInstanceId else { return }
                        Haptics.select()
                        onSelectDesktop()
                        model.selectDesktop(desktop.clientInstanceId)
                    } label: {
                        HStack {
                            Circle()
                                .fill(desktop.clientInstanceId == model.selectedDesktopClientInstanceId
                                      ? Theme.running
                                      : Color.secondary)
                                .frame(width: 7, height: 7)
                            Text(model.desktopName(desktop.clientInstanceId))
                                .font(.subheadline)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            if desktop.clientInstanceId == model.selectedDesktopClientInstanceId {
                                Text("当前")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(desktop.clientInstanceId == model.selectedDesktopClientInstanceId)
                    .accessibilityIdentifier("settings-desktop-\(desktop.clientInstanceId)")
                }
            }
        }
    }

    // MARK: - 终端

    /// A density names a cell size, not a column count, so the same choice
    /// reads the same on a phone of any size — the grid recomputes around it.
    ///
    /// It governs the phone-driven mode only, where the pane's width is the
    /// wrap and the density decides how much fits across it. In the
    /// desktop-grid mode the computer's columns decide the size, which is why
    /// that mode's own menu offers no density at all.
    @ViewBuilder
    private var terminalSection: some View {
        Section {
            // 绑定自己拼：`@Bindable` 只能在 `body` 里声明，而这一段是另一个计算属性。
            Picker("显示密度", selection: Binding(
                get: { display.density },
                set: { display.density = $0 }
            )) {
                ForEach(TerminalDensity.allCases, id: \.self) { density in
                    Text(density.label).tag(density)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    // MARK: - 录音

    /// 手机这一端只有一件事是用户能调的：这个权限。转写在服务端，录音本身没有开关。
    @ViewBuilder
    private var meetingsSection: some View {
        Section {
            LabeledContent("麦克风") {
                Text(permissionLabel(microphone != .denied))
                    .foregroundStyle(.secondary)
            }
            Button("在系统设置中打开") { openSystemSettings() }
        } footer: {
            Text("录音与转写都在服务端处理，不依赖任何一台电脑。")
        }
    }

    // MARK: - 通知

    @ViewBuilder
    private var notificationSections: some View {
        Section {
            LabeledContent("系统通知") {
                Text(notificationsAllowed.map(permissionLabel) ?? "…")
                    .foregroundStyle(.secondary)
            }
            Button("在系统设置中打开") { openSystemSettings() }
        } footer: {
            // 关掉系统通知不影响任何功能 —— 这一句必须留着：不写的话，用户会以为关掉它
            // 就再也看不到待处理了，于是他忍着一个每天都弹的提醒。
            Text("关掉系统通知不影响任何功能：应用内的通知中心、待处理提示和图标角标都照常工作。")
        }

        Section("在应用内") {
            Button {
                Haptics.select()
                onOpenNotifications()
            } label: {
                HStack {
                    Text("通知中心")
                    Spacer(minLength: 8)
                    Text(notificationSummary)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // 角标是唯一一个「关掉它不影响功能」的开关：它写的只是 App 图标上那个数字。
            Toggle("图标角标", isOn: $iconBadge)
                .tint(Theme.switchOn)
        }
    }

    /// 「3 条未读 · 1 个待处理」，两样都没有时就不说 —— 一个写着「0 条未读」的行
    /// 不如什么都不写。
    private var notificationSummary: String {
        var parts: [String] = []
        if model.notifications.unreadCount > 0 {
            parts.append("\(model.notifications.unreadCount) 条未读")
        }
        if !model.waitingSessions.isEmpty {
            parts.append("\(model.waitingSessions.count) 个待处理")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - 诊断

    /// 默认开着：让朋友复现一次不容易，"忘了先打开开关"是最没必要的一种浪费。
    /// 关掉只停记录，**不删已有日志** —— 两件事合成一个动作，用户会失去刚表达过的那个意思。
    @ViewBuilder
    private var diagnosticsSection: some View {
        Section {
            Toggle("记录诊断日志", isOn: Binding(
                get: { DiagnosticLog.isEnabled },
                set: { DiagnosticLog.isEnabled = $0 }
            ))
            // 同一个根因：应用根的 tint 在深色下是白色，开关的圆点也是白的。
            // 见 `Theme.switchOn`。
            .tint(Theme.switchOn)
            NavigationLink {
                DiagnosticLogView()
            } label: {
                Text("诊断日志")
            }
        } footer: {
            Text("记录崩溃、网络与终端交互的元数据；终端屏幕内容可以单独关掉。")
        }
    }

    // MARK: - 关于

    /// 版本号从终端顶栏搬到了这里。
    ///
    /// 它的原话是「报问题时引用的号」，那它就该待在一个**为查资料而来**的地方，而不是压在
    /// 会话画布抬头那一行 —— 那儿每多一行字，终端就少一行。
    @ViewBuilder
    private var aboutSection: some View {
        Section {
            LabeledContent("版本") {
                Text(AppVersion.label)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - 权限

    /// 权限只能由系统弹框授予，App 能做的是把状态说清楚，再给一条去系统设置的路。
    /// 所以这里没有「请求」按钮 —— 一个按下去不保证有反应的按钮比没有更差。
    private func permissionLabel(_ allowed: Bool) -> String {
        allowed ? "已允许" : "未允许"
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(url)
    }
}
