import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// 录音住进系统的那一层。
///
/// 这里只画系统模板：计时、一枚停止键、一颗表明「在录」的红点。没有主屏 Widget，也没有
/// 可配置项——扩展 target 是灵动岛、锁屏实时活动和控制中心控件唯一能待的地方，不是一处
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

/// 那枚停止键的两种尺寸。
///
/// 尺寸分两档是因为两处的宽度差着一个量级：锁屏那张卡拿的是整幅宽度，灵动岛那一行只有
/// 贴着传感器挖孔的一条窄缝。**没有第三档**——多一档就要多解释一次它为什么是那个数。
private enum RecordingButtonSize {
    /// 锁屏：Apple 的最小可点区域是 44 pt，这里再大一档。它现在是整张卡上唯一能按的东西，
    /// 没有理由缩着。
    static let lockScreen: CGFloat = 52
    /// 灵动岛展开态：落在计时那一行的右端。
    static let expanded: CGFloat = 34
}

/// 「在录」的那颗红点。
///
/// 它只表达一件事：在录。**不跟着声音动**——上一版这个位置是一个 `waveform` 图标，用真实
/// 振幅驱动 `variableColor`，2026-09-20 用户看过真机之后要求去掉：那是个泛泛的音波符号，
/// 读不出一条录音里的任何东西。灵动岛收起、以及同时有两条实时活动被收成一个圆点时，界面
/// 上只剩得下它。
private struct RecordingDot: View {
    let diameter: CGFloat

    var body: some View {
        Circle()
            .fill(RecordingPalette.accent)
            .frame(width: diameter, height: diameter)
    }
}

/// 锁屏实时活动 + 灵动岛三态。
///
/// 内容只剩两件：**录了多久**，和**怎么停**。上一版中间那条点阵（语音备忘录那种圆点加一根
/// 播放头）已经去掉，理由是它右半边是补出来的占位圆点、左半边是压成一颗点的振幅——看着像
/// 波形，读不出音量。去掉之后这两件事都放大了：锁屏上计时到 `.title`、停止键 52 pt。
struct RecordingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenRecordingView(context: context)
                // 卡片本身点一下开 App 的录音界面 —— 不是把这一条结束掉，结束是那枚停止键的
                // 事。Apple 给的机制就是这条：要开 App 用链接，要做事用 App Intent，两者不要
                // 互相冒充。
                .widgetURL(URL(string: RecordingDeepLink.openRecording))
                // 背景交给系统：锁屏那块材质在浅色和深色下都比我们自己涂一层准。
                .activityBackgroundTint(nil)
                // 系统在右上角另画一个关闭按钮，颜色要跟着内容走。
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                // 一行：左边计时，右边停止键。传感器挖孔在中间，内容只能贴着两头放。
                //
                // 左右两个区域都**不自己加 padding**：灵动岛每一块都有系统给的默认 content
                // margin，Apple 的原话是内容和岛的形状同心、四周留一样的边距、别贴到边上。
                // 自己再塞一圈只会和默认值叠。两边都不加，实测左右留白 19.0 / 18.0 pt
                // （差的那 1 pt 是数字字形自带的边距），已经是对称的。
                DynamicIslandExpandedRegion(.leading) {
                    RecordingTimer(state: context.state)
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundStyle(RecordingPalette.accent)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RecordingStopButton(diameter: RecordingButtonSize.expanded)
                }
            } compactLeading: {
                // 收起时左边原来也是个 `waveform` 图标，同样去掉了：换成那颗红点，它至少
                // 说的是真话——正在录。
                RecordingDot(diameter: 10)
            } compactTrailing: {
                RecordingTimer(state: context.state)
                    .foregroundStyle(RecordingPalette.accent)
            } minimal: {
                // 同时有两个实时活动时收成一个圆点：这里放不下任何字。
                RecordingDot(diameter: 12)
            }
            // 把系统留给 `.bottom` 区域的那条底部空带收掉，否则整行会被顶高。
            //
            // 实测（iPhone 17 Pro / iOS 26.7，截图逐像素量的）：展开态是一枚 373 × 84 pt
            // 的胶囊（圆角是高度的一半，逐行验过），而计时和停止键的中心落在距顶边
            // 34.8 pt 处——比胶囊中线高 7.0 pt，右边那颗按钮因此看着浮在右端半圆的上半
            // 边。只有一种解释对得上：区域内容是在 [顶边距, 高 − 底边距] 这条带里居中的，
            // 反推系统默认底边距约 14 pt，带高 70 pt、中心 35 pt。
            //
            // `.bottom` 归零之后内容区就是整枚胶囊，中心回到 42 pt，和胶囊中线重合——
            // 计时和那颗按钮落回同一条中线上。
            .contentMargins(.bottom, 0, for: .expanded)
        }
    }
}

/// 锁屏那张卡：左边计时，右边一枚停止键。
///
/// **一行，就这两件。** 上一版左边是「录音名 + 计时」竖着排、停止键另起一行居中，用户
/// 看过真机之后要求把名字去掉、把时间挪到左边和停止键并排——这样一眼是「录了多久」和
/// 「怎么停」，中间不再隔着一行空。
///
/// 对齐靠两件事：`HStack` 默认垂直居中，所以计时和 52 pt 的停止键落在同一条中线上；
/// 外边距用 HIG 给锁屏形态定的那 14 pt（见 `RecordingActivityLimits.contentMargin`）。
/// 系统对锁屏形态的高度上限是 160 pt，一行远够。
private struct LockScreenRecordingView: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                RecordingTimer(state: context.state)
                    .font(.title)
                    .fontWeight(.semibold)
                    .foregroundStyle(RecordingPalette.accent)
                Spacer(minLength: 12)
                RecordingStopButton(diameter: RecordingButtonSize.lockScreen)
            }
            // 被系统中断占着麦克风时才有的一行。此时计时是不动的，没有它这张卡看着像坏了。
            if let reason = context.state.pausedReason {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(RecordingActivityLimits.contentMargin)
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

/// 锁屏和灵动岛上**唯一**的那枚按钮：停止。
///
/// 形状照语音备忘录那枚停止键：一圈环套着一个实心方块，方块是红的。**没有文字**（语音
/// 备忘录也没有），读屏靠 `accessibilityLabel`。
///
/// 上一版这里并排放着两枚——完成的方块和一柄取消的叉，用户看过真机之后要求只留一枚：
/// 两枚挨在一起谁也大不起来，而且锁屏上按它们要先认证解锁，取消这一个动作本来也不该在
/// 没解锁的锁屏上做。取消录音仍然做得了，在 App 内——卡片点一下就是录音页。
///
/// 按钮不必解锁就能按，前提是它得在 **App 的进程**里执行——见 `RecordingIntents.swift` 里
/// `LiveActivityIntent` 那一段。那是这枚按钮唯一的开关，画得再好，执行落在扩展进程里也是
/// 白按。
private struct RecordingStopButton: View {
    let diameter: CGFloat

    var body: some View {
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
