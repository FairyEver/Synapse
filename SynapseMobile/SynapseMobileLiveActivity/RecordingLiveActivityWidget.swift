import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// System surfaces for recording and remote terminals share one WidgetKit extension.
@main
struct SynapseWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivityWidget()
        TerminalHomeWidget()
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

/// 那枚停止键的直径。
///
/// 锁屏卡片和灵动岛**用同一个数**。上一版这里分两档（锁屏 52、灵动岛 34），理由是灵动岛
/// 那条窄缝放不下；2026-09-20 用户看过真机之后要求「灵动岛应该类似锁屏界面那个活动卡片的
/// 布局和尺寸」，于是统一成一档。52 pt 在 Apple 的最小可点区域（44 pt）之上。
///
/// 这个数在灵动岛那一侧还兼一个作用：它是**两块的公共高度**，对齐靠的就是它，见
/// `RecordingLiveActivityWidget` 里那段注释。
private enum RecordingButtonSize {
    static let diameter: CGFloat = 52
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
/// 波形，读不出音量。去掉之后这两件事都放大了，而且**锁屏和灵动岛用的是同一套尺寸**：
/// 计时 `.title`、停止键 52 pt。
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
                // **两块给同一个高度**，就是停止键的直径。这不是排版偏好，是这里唯一能让
                // 两件东西对齐的办法：实测展开态的两块区域是**顶端对齐**的——内容顶边固定
                // 落在距药丸顶边约 17.3 pt 处，内容多高就从那里往下长，而不是在药丸里居中
                // （拿旧布局当对照组：两块内容的中心各差 6 pt，顶边却落在同一处）。两边各长
                // 各的，中心自然错开：.title2 那行计时比 34 pt 的按钮中心高 3.8 pt。框成同
                // 一个高度、各自居中，两个中心才重合。
                //
                // 52 pt 顺带把「整行坐得偏高」也一并解决：药丸高 84 pt 是系统定死的（点阵
                // 那版、34 pt 那版、52 pt 这版量下来都是 84~85 pt，与内容无关），52 pt 的
                // 内容从 17.3 pt 起落到 17.3…69.3，中心 43.3 pt，比药丸中线低 1.5 pt——
                // 肉眼就是居中。上一版 34 pt 的内容中心在 34.8 pt，高 7 pt，那才是「圆心不
                // 重合」的来源。
                //
                // 左右仍然不自己加 padding：留白由系统给，实测 19.0 / 18.0 pt（差的那 1 pt
                // 是数字字形自带的边距），已经是对称的。
                DynamicIslandExpandedRegion(.leading) {
                    RecordingTimer(state: context.state)
                        .font(.title)
                        .fontWeight(.semibold)
                        .foregroundStyle(RecordingPalette.accent)
                        // 窄缝里放得下「00:00」，放不下「1:23:45」。宁可让字缩一点，也不要
                        // 让它折成两行——旧布局就是这样折过。
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(height: RecordingButtonSize.diameter)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RecordingStopButton(diameter: RecordingButtonSize.diameter)
                        .frame(height: RecordingButtonSize.diameter)
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
                RecordingStopButton(diameter: RecordingButtonSize.diameter)
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
