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
    let onOpenClipboard: () -> Void
    let onNewSession: () -> Void
    /// 打开一个正卡着等人的会话。参数是会话 id。
    let onOpenWaitingSession: (String) -> Void

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
            ToolbarItem(placement: .topBarTrailing) { bell }
        }
    }

    /// 常驻的那一枚铃铛。角标用 `Theme.attention` —— 全应用只有这一个颜色说
    /// 「有人需要你」，与会话行的「等待输入」徽章同色同义。
    private var bell: some View {
        Button(action: onOpenNotifications) {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if model.notifications.unreadCount > 0 {
                        Text("\(model.notifications.unreadCount)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Theme.attentionFill)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Theme.attention, in: Capsule())
                            .offset(x: 6, y: -4)
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
