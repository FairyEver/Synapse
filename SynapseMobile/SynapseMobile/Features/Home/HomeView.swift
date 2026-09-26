import SwiftUI

/// 主页：所有入口，以及「有没有人需要你」。
///
/// 它是本次导航改版的落点 —— 底栏不再为每一个功能开一格，新能力一律进这里的「功能」清单，
/// 所以这一页会长，而底栏永远是三格。
///
/// 顶上那张待处理卡只在真有会话卡住时出现。它和终端列表行上的琥珀徽章读的是同一份
/// `waitingSessions`，不引入第二套状态；没有内容就不占位置。
///
/// 这一页**不自带 `NavigationStack`**：栈由 `RootView` 拿着（`homePath`），因为深链要能把
/// 主页直接推到某一屏上，而那些请求不是从这一页里发出来的。
struct HomeView: View {
    @Environment(SynapseAppModel.self) private var model

    let onOpenNotifications: () -> Void
    let onOpenRecordings: () -> Void
    let onOpenDrive: () -> Void
    let onOpenClipboard: () -> Void
    let onNewSession: () -> Void
    /// 打开一个正卡着等人的会话。参数是会话 id。
    let onOpenWaitingSession: (String) -> Void
    /// 换到另一台电脑。参数是电脑的 `clientInstanceId`。
    ///
    /// 交给 `RootView` 而不是这一页自己调 `selectDesktop`，是因为换电脑**不止**换这一页的
    /// 上下文：终端那一格的选择，以及一个还在等判定的打开请求，都指向前一台电脑的会话。
    /// 清掉它们要碰的是那一格的导航状态，不是这一页的东西。
    let onSwitchComputer: (String) -> Void

    var body: some View {
        List {
            if !model.waitingSessions.isEmpty {
                Section { attentionCard }
                    .listSectionSpacing(.compact)
            }

            Section {
                row(
                    title: "录音",
                    subtitle: "会议录音、转写与回听",
                    symbol: "waveform",
                    value: recordingCount,
                    action: onOpenRecordings
                )
                row(
                    title: "云盘",
                    subtitle: "服务端上的文件",
                    symbol: "internaldrive",
                    value: nil,
                    action: onOpenDrive
                )
                row(
                    title: "新建会话",
                    subtitle: "在当前电脑上开一个终端",
                    symbol: "plus",
                    value: nil,
                    action: onNewSession
                )
                .disabled(newSessionUnavailable)
                row(
                    title: "剪贴板历史",
                    subtitle: "这台电脑上复制过的内容",
                    symbol: "doc.on.clipboard",
                    value: nil,
                    action: onOpenClipboard
                )
            } header: {
                Text("功能")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("主页")
        .toolbar {
            homeToolbar
        }
    }

    /// 顶栏那两枚：先切换器，后铃铛。
    ///
    /// 声明顺序定下两者的先后。分开声明定下的是它们**各是各的**：iOS 26 会把同一个
    /// placement 上的项并进同一块共享背景 —— 两枚互不相干的控件挤进一个胶囊里，看起来
    /// 就是一枚。`ToolbarSpacer(.fixed)` 是系统给的分家方式：它把两侧分成各自一组，各拿
    /// 各的背景，于是又变回两枚按钮。iOS 18 上没有这层共享背景，两枚本来就分开画，那一支
    /// 保持原样（`ToolbarItemGroup` 是那里定住先后最直接的写法）。
    @ToolbarContentBuilder
    private var homeToolbar: some ToolbarContent {
        if #available(iOS 26.0, *) {
            ToolbarItem(placement: .topBarTrailing) { desktopSwitcher }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) { bell }
        } else {
            ToolbarItemGroup(placement: .topBarTrailing) {
                desktopSwitcher
                bell
            }
        }
    }

    /// 这台手机在哪一台电脑上，以及 —— 有地方可去的时候 —— 怎么换过去。
    ///
    /// 终端页的设备行回答的是同一个问题，用的是同一份词汇和同一个 `selectDesktop`；这里
    /// 是那件事在主页的快捷方式（spec §4.3：功能是目录，终端页上保留同一件事的快捷方式）。
    /// 放这里是因为主页那两行文案都在引用「当前这台电脑」——「在当前电脑上开一个终端」
    /// 「这台电脑上复制过的内容」—— 而这一页在此之前从没说出过它是哪一台。
    ///
    /// 用 `Menu` 而不是一屏：在两三台电脑之间挑一个不值得开一层导航。只有真别处可去时它才
    /// 是控件，箭头和命中区才出现；这包括它存在的那个理由 —— 一台进了离线状态的电脑，那
    /// 另一台是唯一的出路。
    @ViewBuilder
    private var desktopSwitcher: some View {
        if model.desktopSwitchTargets.isEmpty {
            desktopIdentity
        } else {
            Menu {
                ForEach(model.desktopSwitchTargets) { desktop in
                    Button {
                        Haptics.select()
                        onSwitchComputer(desktop.clientInstanceId)
                    } label: {
                        Text(model.desktopName(desktop.clientInstanceId))
                    }
                    .accessibilityIdentifier("home-switch-computer-option-\(desktop.clientInstanceId)")
                }
            } label: {
                desktopIdentity
            }
            // 和终端页那一枚用不同的 id：屏幕上同时存在两个 `switch-computer` 会让无障碍
            // 和 UI 测试都读到不确定的那一个。
            .accessibilityIdentifier("home-switch-computer")
            .accessibilityHint("切换到其它电脑")
        }
    }

    /// 画法与判据在 `DesktopIdentityLabel`，和终端页设备行是同一份。
    private var desktopIdentity: some View {
        DesktopIdentityLabel(
            name: model.selectedDesktopClientInstanceId.map(model.desktopName),
            isOnline: model.connectivity == .online,
            showsSwitchAffordance: !model.desktopSwitchTargets.isEmpty
        )
    }

    /// 常驻的那一枚铃铛。
    ///
    /// 角标用系统红，不跟 `Theme.attention`：底栏主页那一格的未读数由系统 `.badge`
    /// 画，也是这个红，两处读的是同一个数字，颜色不一致就会像两套计数。红在这里只
    /// 表示「有未读」，不表示出错；琥珀仍然只留给「有人在等你回话」。
    ///
    /// 角标挑在铃铛框的右上角外，于是它落在**这一项自己的内容框之外** —— 而 iOS 26
    /// 起工具栏项自带背景，并把项的内容裁进背景里那块约 36pt 见方的地方（44pt 的圆往
    /// 里收 4pt）。原先那 9/-8 的位移正好把角标推出框外，顶边和右边各被切掉一截。
    /// 位移收到 `badgeOffset` 里那块框内，角标就完整了；iOS 18 没有这层背景也没有这层
    /// 裁剪，原来的位移在那里本来就是完整的。
    ///
    /// 约束是那块框，不是铃铛：以后动这个按钮的背景、尺寸或图标，都要重新确认角标还在
    /// 框内 —— 越界不会报错，只会被安静地切掉一角。
    ///
    /// 角标还要按自己的内容定宽（`fixedSize`）：`.overlay` 只把铃铛那点宽度提给它，四位数
    /// 在里面放不下就会折成两行，红底变成一块竖着的疙瘩。定宽之后它随数字向左长，右边始终
    /// 挂在铃铛的右上角上，多少位都还是一行。位数太多时左端会顶到上面那块框，框得住四位数
    /// ——够用了，真到了五位数再谈怎么缩。
    private var bell: some View {
        Button(action: onOpenNotifications) {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if model.notifications.unreadCount > 0 {
                        Text("\(model.notifications.unreadCount)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color.white)
                            .lineLimit(1)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Color(uiColor: .systemRed), in: Capsule())
                            .fixedSize()
                            .offset(x: badgeOffset.x, y: badgeOffset.y)
                    }
                }
        }
        .accessibilityIdentifier("home-notifications")
        .accessibilityLabel(
            model.notifications.unreadCount > 0
                ? "通知，\(model.notifications.unreadCount) 条未读"
                : "通知"
        )
    }

    /// 角标相对铃铛右上角的位移，判据见 `bell` 的说明。
    ///
    /// 两版差的不是口味：iOS 26 那 36pt 的内容框只容得下 4pt，再多一点就会被裁；
    /// iOS 18 上把角标推到框外才是它原本的样子。
    private var badgeOffset: (x: CGFloat, y: CGFloat) {
        if #available(iOS 26.0, *) { (4, -4) } else { (9, -8) }
    }

    /// 「N 个会话在等你」。
    ///
    /// 一条时直接进那个会话；多条时打开通知面板的「待处理」段 —— 卡片上写着 N，
    /// 却只把人送进其中一个，另外几个就藏起来了。
    private var attentionCard: some View {
        Button {
            let waiting = model.waitingSessions
            if waiting.count == 1, let only = waiting.first {
                onOpenWaitingSession(only.id)
            } else {
                onOpenNotifications()
            }
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(Theme.attention)
                    .frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(model.waitingSessions.count) 个会话在等你")
                        .font(.headline)
                        .foregroundStyle(Theme.attention)
                    Text("终端有输出，需要你回复")
                        .font(.subheadline)
                        .foregroundStyle(Theme.attention)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.attention)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
        .listRowBackground(Theme.attentionFill)
        .accessibilityIdentifier("home-attention")
    }

    /// 录音条数。为 0 时不显示值 —— 一个写着「0 条」的入口是在报告空，不是在报告有什么。
    private var recordingCount: String? {
        let count = model.meetings.meetings.count
        return count > 0 ? "\(count) 条" : nil
    }

    /// 与终端列表右上角那个 ＋ 同一条判据：电脑不在，建出来的东西会被一台没听说过它的
    /// 电脑拒绝。
    private var newSessionUnavailable: Bool {
        model.selectedDesktopClientInstanceId == nil || model.viewedDesktopIsOffline
    }

    private func row(
        title: String,
        subtitle: String,
        symbol: String,
        value: String?,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if let value {
                    Text(value)
                        .foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home-feature-\(title)")
    }
}
