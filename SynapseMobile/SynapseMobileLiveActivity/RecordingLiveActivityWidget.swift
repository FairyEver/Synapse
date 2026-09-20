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
///
/// 这里能动的只有内容：卡片本身、它的圆角、外边距、以及锁屏右上角那个系统画的关闭
/// 按钮都不归我们画。所以两条形态共用同一套内容——同一枚图标、同一口钟、同一条波形、
/// 同样两个按钮——差别只在排布和字号。
///
/// 颜色一律用语义色（`.primary` / `.secondary`），不引入第二种颜色：灵动岛的底是
/// 系统固定的纯黑、字色固定纯白，Apple 明说不许改；锁屏上跟着系统材质走，比我们
/// 自己抹一层准。
///
/// 另外两处是照着 Apple 的规范特意**没有**做的：没有 `keylineTint`（那道描边留给
/// 系统自己的判断，硬漆成纯白会变成一圈很重的白边），锁屏也不自己加粗边框。
struct RecordingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenRecordingView(context: context)
                // 背景交给系统：锁屏那块材质在浅色和深色下都比我们自己涂一层准。
                .activityBackgroundTint(nil)
                // 系统在右上角另画一个关闭按钮，颜色要跟着内容走。
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RecordingGlyph(levels: context.state.levels)
                        .font(.title3)
                }
                // 计时只放一处：上排右边。左边那个位置留给录音这件事本身（波形）。
                DynamicIslandExpandedRegion(.trailing) {
                    RecordingTimer(state: context.state)
                        .font(.title3)
                        .fontWeight(.semibold)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 12) {
                        RecordingLevelBars(levels: context.state.levels)
                            .frame(height: 20)
                        RecordingActivityButtons()
                    }
                }
            } compactLeading: {
                RecordingGlyph(levels: context.state.levels)
            } compactTrailing: {
                RecordingTimer(state: context.state)
            } minimal: {
                // 同时有两个实时活动时收成一个圆点：这里没有任何字能显示。
                RecordingGlyph(levels: context.state.levels)
            }
        }
    }
}

/// 锁屏那张卡：录音名、计时、波形、取消 / 完成。
///
/// 只排三行。系统对锁屏形态的高度上限是 160 pt，超了会被截——所以这里不追求信息量，
/// 追求一眼看清「在录、录了多久、怎么停」。
private struct LockScreenRecordingView: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            RecordingLevelBars(levels: context.state.levels)
                .frame(height: 24)
            if let reason = context.state.pausedReason {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            RecordingActivityButtons()
        }
        .padding(RecordingActivityLimits.contentMargin)
    }

    /// 计时和名字共处一行，但差着两档字重与字号。
    ///
    /// Apple 对实时活动的要求是「用大字号、中等以上的字重」，而这一行里真正要看的是
    /// 计时——名字只是让人认出这是哪一条。原来两样都是 `.headline`，谁也不比谁重要，
    /// 于是在一块本来就只有一百多 pt 高的卡片上，两行字在争同一个位置。
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
                .foregroundStyle(.primary)
        }
    }
}

/// 那枚跟着声音动的波形图标。
///
/// 用 `variableColor`：它表达的是「量」，而这里的量正好是麦克风听到了多响——不是装饰，
/// 是 App 一直在算的那个数。
///
/// 颜色用 `.primary` 而不是 `.tint`：扩展里没有 App 的 accent（App 内是 `Theme.ink`，
/// 也就是 `.primary`），`.tint` 在扩展里会落回系统蓝，压在灵动岛那块纯黑上既不是这个
/// App 的样子，也看不清。
private struct RecordingGlyph: View {
    let levels: [Double]

    var body: some View {
        Image(systemName: "waveform")
            .symbolEffect(.variableColor.iterative, value: currentLevel)
            .foregroundStyle(.primary)
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

/// 滚动波形。
///
/// 与录音页是同一种读法，也是同一套比例：最新的贴右边缘，旧的往左排，**柱宽和间距
/// 都是固定的**（和 `MeetingAudio` 共用同一组值），一格放不下就少画几条，而不是把手里
/// 这几十个采样拉满整行。
///
/// 这一条是这次改动的重点。原来是「有几个采样就把宽度分成几份」，于是 32 个采样在
/// 一整行里变成 32 根又粗又扁的方块——而录音页上那条是 1.5 pt 宽、1.1 pt 间距的细柱。
/// 同一个东西在两处长得不一样，锁屏那条就显得很别扭。
private struct RecordingLevelBars: View {
    let levels: [Double]

    var body: some View {
        GeometryReader { geometry in
            let pitch = RecordingActivityLimits.barWidth + RecordingActivityLimits.barGap
            let slots = max(1, Int(floor(geometry.size.width / pitch)))
            let visible = min(levels.count, slots)
            HStack(alignment: .center, spacing: RecordingActivityLimits.barGap) {
                ForEach(Array(levels.suffix(visible).enumerated()), id: \.offset) { _, level in
                    Capsule()
                        .frame(
                            width: RecordingActivityLimits.barWidth,
                            height: barHeight(level, in: geometry.size.height)
                        )
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .trailing)
        }
        .foregroundStyle(.primary)
        .accessibilityHidden(true)
    }

    /// 半高最多到画布的一半，再留一成边距——和录音页那条一样，柱子不会顶到框上。
    private func barHeight(_ level: Double, in available: CGFloat) -> CGFloat {
        let clamped = min(1, max(0, level))
        return max(1, available * clamped * 0.9)
    }
}

/// 实时活动上的取消 / 完成。
///
/// 按钮不必解锁就能按，前提是它们得在 **App 的进程**里执行——见 `RecordingIntents.swift`
/// 里 `LiveActivityIntent` 那一段。那是这两个按钮唯一的开关，画得再好，执行落在扩展
/// 进程里也是白按。
///
/// 颜色跟着 App 里那套走：填充用 `.primary`、文字交给系统挑对比色，与录音页上「确定的
/// 那一个」同一套（那里是 `Theme.ink` 作填充、`Theme.paper` 作文字，`ink` 就是
/// `.primary`）。App 在根视图上把 accent 覆盖成了 `.primary`，这里补上同一件事——
/// 否则扩展拿不到那个覆盖，实心那颗会变成系统蓝，和 App 里不是同一个颜色。
private struct RecordingActivityButtons: View {
    var body: some View {
        HStack(spacing: 10) {
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
            .tint(.primary)
        }
        .font(.subheadline)
    }
}
