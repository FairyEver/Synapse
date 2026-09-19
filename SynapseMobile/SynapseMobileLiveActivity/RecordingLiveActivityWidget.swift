import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// 录音住进系统的那一层。
///
/// 这里只画系统模板：名字、计时、波形、两个按钮。没有主屏 Widget，也没有可配置项
/// ——扩展 target 是灵动岛、锁屏实时活动和控制中心控件唯一能待的地方，不是一处
/// 顺带加东西的地方。
@main
struct SynapseRecordingWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivityWidget()
        if #available(iOS 18.0, *) {
            RecordingControlWidget()
        }
    }
}

/// 锁屏实时活动 + 灵动岛三态。
struct RecordingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenRecordingView(context: context)
                .activityBackgroundTint(nil)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "waveform")
                        .foregroundStyle(.tint)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RecordingTimer(state: context.state)
                }
                DynamicIslandExpandedRegion(.center) {
                    RecordingTimer(state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 10) {
                        RecordingLevelBars(levels: context.state.levels)
                            .frame(height: 22)
                        RecordingActivityButtons()
                    }
                }
            } compactLeading: {
                Image(systemName: "waveform")
                    .symbolVariableValue(currentLevel(context.state))
                    .foregroundStyle(.tint)
            } compactTrailing: {
                RecordingTimer(state: context.state)
            } minimal: {
                // 同时有两个实时活动时收成一个圆点：这里没有任何字能显示。
                Image(systemName: "waveform")
                    .symbolVariableValue(currentLevel(context.state))
                    .foregroundStyle(.tint)
            }
            .keylineTint(Color.primary)
        }
    }

    private func currentLevel(_ state: RecordingActivityAttributes.ContentState) -> Double {
        state.levels.last ?? 0
    }
}

/// 锁屏那张卡：录音名、计时、波形、取消 / 完成。
private struct LockScreenRecordingView: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(context.attributes.title)
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 8)
                RecordingTimer(state: context.state)
                    .font(.headline)
                    .monospacedDigit()
            }
            RecordingLevelBars(levels: context.state.levels)
                .frame(height: 26)
            if let reason = context.state.pausedReason {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            RecordingActivityButtons()
        }
        .padding(16)
        .activitySystemActionForegroundColor(.primary)
    }
}

/// 计时。
///
/// 从内容状态里读秒，而不是用 `Text(timerInterval:)`：中断暂停的那几分钟不该计入，
/// 而自走的计时器停不下来。
private struct RecordingTimer: View {
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        Text(Self.format(state.elapsedSeconds))
            .monospacedDigit()
    }

    static func format(_ seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3600
        let minutes = (clamped % 3600) / 60
        let secs = clamped % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%02d:%02d", minutes, secs)
    }
}

/// 滚动波形。
///
/// 与录音页是同一种读法：最新的贴右边缘，旧的往左排，槽位宽度不随数量变。安静时
/// 伏下去，说话时抬起来。
private struct RecordingLevelBars: View {
    let levels: [Double]

    var body: some View {
        GeometryReader { geometry in
            let slots = max(1, levels.count)
            let spacing: CGFloat = 2
            let width = max(1, (geometry.size.width - spacing * CGFloat(slots - 1)) / CGFloat(slots))
            HStack(alignment: .center, spacing: spacing) {
                ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                    Capsule()
                        .frame(width: width, height: barHeight(level, in: geometry.size.height))
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .trailing)
        }
        .foregroundStyle(.tint)
        .accessibilityHidden(true)
    }

    private func barHeight(_ level: Double, in available: CGFloat) -> CGFloat {
        let clamped = min(1, max(0, level))
        return max(2, available * clamped)
    }
}

/// 实时活动上的取消 / 完成。按钮不解锁就能用：`Button(intent:)` 由系统送去 App。
private struct RecordingActivityButtons: View {
    var body: some View {
        HStack(spacing: 12) {
            Button(intent: CancelRecordingIntent()) {
                Text("取消")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button(intent: FinishRecordingIntent()) {
                Text("完成")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .font(.subheadline)
    }
}

private extension Image {
    /// 符效：`variableColor` 自己会动，值由我们推过来的振幅决定。
    func symbolVariableValue(_ value: Double) -> some View {
        let clamped = min(1, max(0, value))
        return symbolEffect(.variableColor.iterative, value: clamped)
    }
}
