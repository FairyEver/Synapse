import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// 录音住进系统的那一层。
///
/// 这里只画系统模板：点阵、计时、两个圆形按钮。没有主屏 Widget，也没有可配置项
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

/// 录音的那**一个**颜色。
///
/// 系统红，和语音备忘录同一个。它只出现在锁屏和灵动岛上：App 内（录音页、列表、
/// 详情）保持原来的单色，所以点开 App 之后不会有第二个颜色跟着进来。设计文档第 89
/// 行原来写的是「Synapse 不引入语音备忘录的红色」，2026-09-20 按用户要求改成
/// 「只限实时活动」——这一条要看就以设计文档里的补记为准。
private enum RecordingPalette {
    static let accent = Color.red
}

/// 锁屏实时活动 + 灵动岛三态。
///
/// 形状照语音备忘录那条抄：一条圆点排成的点阵、一颗红色的计时、一枚圆形的停止键。
/// 卡片本身、它的圆角、外边距，以及外面那个宽药丸都是系统的——第三方拿到的宽度和
/// 系统 App 一样，区别只在内容怎么排。
struct RecordingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenRecordingView(context: context)
                // 卡片本身点一下开 App 的录音界面 —— 不是把这一条结束掉，结束是下面那
                // 两个按钮的事。Apple 的规范也是这么分的：要开 App 用链接，要做事用
                // App Intent，两者不要互相冒充。
                .widgetURL(URL(string: RecordingDeepLink.openRecording))
                // 背景交给系统：锁屏那块材质在浅色和深色下都比我们自己涂一层准。
                .activityBackgroundTint(nil)
                // 系统在右上角另画一个关闭按钮，颜色要跟着内容走。
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                // 一行：点阵在左，计时和停止键在右。语音备忘录在灵动岛上就是这一行，
                // 不再往下堆第二排。
                DynamicIslandExpandedRegion(.leading) {
                    RecordingDotStrip(levels: context.state.levels)
                        .frame(height: 22)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 10) {
                        RecordingTimer(state: context.state)
                            .font(.title3)
                            .fontWeight(.semibold)
                            .foregroundStyle(RecordingPalette.accent)
                        RecordingActivityButtons(diameter: 28)
                    }
                }
            } compactLeading: {
                RecordingGlyph(levels: context.state.levels)
            } compactTrailing: {
                RecordingTimer(state: context.state)
                    .foregroundStyle(RecordingPalette.accent)
            } minimal: {
                // 同时有两个实时活动时收成一个圆点：这里没有任何字能显示。
                RecordingGlyph(levels: context.state.levels)
            }
        }
    }
}

/// 锁屏那张卡：录音名、计时、点阵、取消 / 完成。
///
/// 只排三行。系统对锁屏形态的高度上限是 160 pt，超了会被截——所以这里不追求信息量，
/// 追求一眼看清「在录、录了多久、怎么停」。
private struct LockScreenRecordingView: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            RecordingDotStrip(levels: context.state.levels)
                .frame(height: 24)
            if let reason = context.state.pausedReason {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack {
                Spacer(minLength: 0)
                RecordingActivityButtons(diameter: 44)
                Spacer(minLength: 0)
            }
        }
        .padding(RecordingActivityLimits.contentMargin)
    }

    /// 计时和名字共处一行，但差着两档字重与字号。
    ///
    /// Apple 对实时活动的要求是「用大字号、中等以上的字重」，而这一行里真正要看的是
    /// 计时——名字只是让人认出这是哪一条。计时用那一个红色，和点阵、按钮是同一个。
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(context.attributes.title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            RecordingTimer(state: context.state)
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundStyle(RecordingPalette.accent)
        }
    }
}

/// 那枚跟着声音动的波形图标。
///
/// 用 `variableColor`：它表达的是「量」，而这里的量正好是麦克风听到了多响——不是装饰，
/// 是 App 一直在算的那个数。
private struct RecordingGlyph: View {
    let levels: [Double]

    var body: some View {
        Image(systemName: "waveform")
            .symbolEffect(.variableColor.iterative, value: currentLevel)
            .foregroundStyle(RecordingPalette.accent)
    }

    private var currentLevel: Double {
        min(1, max(0, levels.last ?? 0))
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

/// 那条点阵。
///
/// 形状是语音备忘录的：一排分开的小圆点，中间一根红色竖线当播放头。竖线左边是**已经
/// 录到的**，右边的圆点小一圈、压暗，是**还没到的**——所以这条点阵无论录了多久都保持
/// 同一个形状，播放头不会跑到最右边去。
///
/// 与语音备忘录唯一的不同是**每颗点的实际高度**：这些点带的是真实的麦克风振幅（和
/// 录音页、电脑端同一套读法），所以说话时它们会高起来、安静时缩成一颗点。语音备忘录
/// 那条是等高的进度点，不带音量。
private struct RecordingDotStrip: View {
    let levels: [Double]

    var body: some View {
        GeometryReader { geometry in
            let limits = RecordingActivityLimits.self
            let pitch = limits.dotWidth + limits.dotGap
            // 播放头占掉一格的位置，剩下的按比例分给左右两段。
            let slots = max(2, Int(floor((geometry.size.width + limits.dotGap) / pitch)))
            let units = slots - 1
            let played = max(1, min(units - 1, Int((CGFloat(units) * limits.playheadFraction).rounded())))
            let remaining = units - played
            // 播放头左边的格子**永远是那么多个**：刚开始录、采样还不够铺满的时候，
            // 缺的那几格用安静的圆点补上。不补的话播放头会贴着最后一颗点跑，等它慢慢
            // 挪到 59% —— 那是「进度条」，不是这条点阵要的样子。
            let history: [Double] = {
                let recent = levels.suffix(played)
                guard recent.count < played else { return Array(recent) }
                return Array(repeating: 0, count: played - recent.count) + recent
            }()

            HStack(alignment: .center, spacing: limits.dotGap) {
                ForEach(Array(history.enumerated()), id: \.offset) { _, level in
                    Capsule()
                        .fill(RecordingPalette.accent)
                        .frame(width: limits.dotWidth, height: dotHeight(level, in: geometry.size.height))
                }
                Capsule()
                    .fill(RecordingPalette.accent)
                    .frame(width: limits.playheadWidth, height: geometry.size.height * 0.62)
                    .frame(width: limits.dotWidth)
                ForEach(0..<remaining, id: \.self) { _ in
                    Capsule()
                        .fill(.tertiary)
                        .frame(width: limits.dotWidth, height: limits.placeholderDotHeight)
                        .frame(height: geometry.size.height)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
        }
        .accessibilityHidden(true)
    }

    /// 安静的圆点也有一颗点的高度，说话时往上长——最高的那颗也不顶到框上。
    private func dotHeight(_ level: Double, in available: CGFloat) -> CGFloat {
        let limits = RecordingActivityLimits.self
        let clamped = min(1, max(0, level))
        let ceiling = max(limits.minimumDotHeight, available * 0.45)
        return limits.minimumDotHeight + (ceiling - limits.minimumDotHeight) * clamped
    }
}

/// 实时活动上的取消 / 完成。
///
/// 形状照语音备忘录那枚停止键：一圈环套着一个实心方块。这里有两枚——完成的实心块是
/// 那个红色，取消的是一个叉。**没有文字**：语音备忘录也没有，文字会把这条点阵挤窄。
/// 每一个都带 `accessibilityLabel`，读屏时仍然念得出「取消」「完成」。
///
/// 按钮不必解锁就能按，前提是它们得在 **App 的进程**里执行——见 `RecordingIntents.swift`
/// 里 `LiveActivityIntent` 那一段。那是这两个按钮唯一的开关，画得再好，执行落在扩展
/// 进程里也是白按。
private struct RecordingActivityButtons: View {
    /// 圆形按钮的直径。
    ///
    /// 锁屏上给 44pt —— Apple 的最小可点区域，也差不多就是量到的语音备忘录那枚（42）。
    /// 灵动岛那一行要在计时右边挤下两枚，只能给 28pt，**这一处是比语音备忘录小的**：
    /// 它那枚 42pt 是单独一枚，我们有两枚。
    let diameter: CGFloat

    var body: some View {
        HStack(spacing: diameter * 0.34) {
            Button(intent: CancelRecordingIntent()) {
                Image(systemName: "xmark")
                    .font(.system(size: diameter * 0.34, weight: .bold))
                    .foregroundStyle(.primary)
                    .frame(width: diameter, height: diameter)
                    .background(Circle().strokeBorder(.primary.opacity(0.55), lineWidth: diameter * 0.07))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("取消")

            Button(intent: FinishRecordingIntent()) {
                RoundedRectangle(cornerRadius: diameter * 0.15, style: .continuous)
                    .fill(RecordingPalette.accent)
                    .frame(width: diameter * 0.42, height: diameter * 0.42)
                    .frame(width: diameter, height: diameter)
                    .background(Circle().strokeBorder(.primary, lineWidth: diameter * 0.075))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("完成")
        }
    }
}
