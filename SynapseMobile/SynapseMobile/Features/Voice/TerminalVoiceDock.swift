import SwiftUI

/// 按住说话时浮在输入栏上方的那一层。
///
/// 只有一块**录音面板**：状态、计时、电平、转写，以及一行说清两个去处在哪的提示。
/// 手指往上滑压到面板上，面板上就盖上一层与它**同样尺寸、左右一分为二**的蒙层 ——
/// 左半「取消」、右半「固定」，压在哪一半，哪一半就填成实心并显出自己的名字。
///
/// 去路为什么长在**面板**上，而不是像上一版那样在面板上面另摆两颗方块：要够着那两颗
/// 方块，手指得越过整块面板，而面板本身在按住期间是一块不接任何点击的空地 —— 拿它当
/// 落点，滑动的总路程就只剩「输入栏到面板」这一段，滑到之后要选的那两半又是整块面板
/// 那么大。省下的不只是距离，还有「往上再找一层」的那一次视线移动。
///
/// **没有一处是半透明的。** 面板用 `Theme.paper`（就是 `systemBackground`），浅色下
/// 是白的、深色下是黑的，跟着系统走；蒙层那一半用系统的灰。材质试过两版都退回来了：
/// 一是它把终端那些高对比小字糊成灰斑，二是材质上的文字会走「vibrancy」那一档 ——
/// 屏幕上就是**字在、颜色却和底一样**，只剩红色的光标看得见。
///
/// 颜色一律写明、一律取自系统语义色：`Theme.ink` / `Theme.paper` 各自跟着明暗翻转，
/// 没有一个地方靠继承。
///
/// 动效只留在**手指底下**：两半之间的换场用短促的 `easeOut`（动画得跟着手指走，
/// 不能自说自话）。浮上来那一下在 `TerminalScreen` 里，是一个带回弹的弹簧。
struct TerminalVoiceDock: View {
    let presentation: HoldToTalkPresentation
    /// 面板量出来的位置，报在**手势所用的那个坐标系**里 —— 左右两半的判定用的就是它。
    @Binding var panelRect: CGRect
    /// 固定之后面板上那枚「取消」。
    let onCancelLocked: () -> Void

    /// 「减弱动态效果」开着的时候，缩放和弹性都不该出现 —— 那是这个开关要拿掉的东西。
    /// 留淡入淡出，因为它不产生位移。
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 面板与屏幕左、右、下三边之间的距离。
    ///
    /// 三边同一个数：它们是同一种关系（浮层与屏幕边缘之间的距离）。下边这一份是后补的
    /// —— 少了它，面板的圆角正好顶在工具栏的上沿，看着像被工具栏切掉了一块。
    private static let gutter: CGFloat = 16

    /// 浮层的圆角。与 `NoticeBar` 同一个数：app 里浮在内容之上的玻璃面是同一档。
    private static let cornerRadius: CGFloat = 14

    /// 转写区的高度：正好三行正文。
    ///
    /// 固定而不是随字长，是因为按住的那几秒里每认出一个字面板就长高一点，手指底下
    /// 正压着的那层蒙层会跟着上下跳。三行是「够读到刚说的那句」和「不占掉太多终端」
    /// 之间的取舍，按 `.body` 的行高算出来。
    private static let transcriptHeight: CGFloat = 66

    /// 波形一根柱子的宽与高。
    ///
    /// 图形尺寸，不是排版尺寸 —— 它跟着旁边那行 `.subheadline` 的文字高度走，不参与
    /// 字号层级。
    private static let barWidth: CGFloat = 3
    private static let barHeight: CGFloat = 16

    /// 正在录音的那个记号色。
    ///
    /// 红是苹果自己给「正在录」的颜色（录屏、录音时状态栏那一颗就是它），整个面板
    /// 上那一点红、计时旁边的柱子、以及蒙层左半的实心填充都用它 —— 这个界面上只有
    /// 一个红，意思只有一个。
    private static let recordingColor = Color(uiColor: .systemRed)

    /// 手势与面板共用的坐标系名字，与 `TerminalScreen` 里那一处必须是同一个字符串。
    private static let voiceSpace = "terminalVoice"

    /// 手指在两半之间移动时那一下换场。
    ///
    /// **短、不弹、不回冲。** 手指正压着屏幕，这一下必须跟着手指走 —— 要的是「滑过去
    /// 就立刻看到变了」，不是一场表演；有回冲的弹簧会让高亮慢半拍才落到手指底下。
    private var armAnimation: Animation? {
        reduceMotion ? nil : .easeOut(duration: 0.16)
    }

    /// 蒙层盖上与撤走。比换场还短一点：它表示的是「手到了」这件事本身。
    private var maskAnimation: Animation? {
        reduceMotion ? nil : .easeOut(duration: 0.15)
    }

    var body: some View {
        panel
            .padding(.horizontal, Self.gutter)
            .padding(.bottom, Self.gutter)
    }

    // MARK: - 面板

    private var panel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Self.recordingColor)
                        .frame(width: 8, height: 8)
                    Text(presentation.stateText)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Self.recordingColor)
                }

                Spacer(minLength: 0)

                Text(presentation.timerText)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)

                waveform
            }

            ScrollView {
                transcript
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: Self.transcriptHeight)
            .scrollIndicators(.hidden)

            HStack(spacing: 8) {
                Text(presentation.hint)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)

                if presentation.locked {
                    // 固定之后手指早走了，长录要收摊的话这是面板上唯一的退路。
                    Button("取消", role: .destructive, action: onCancelLocked)
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(Color(uiColor: .systemRed))
                        .accessibilityIdentifier("voice-lock-cancel")
                }
            }
        }
        .padding(16)
        // 实色，跟着明暗走（理由写在文件顶上）。
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .overlay {
            // 面板与终端画面之间那条发丝线。深色下两块底色都不深不浅地挨着，没有这条
            // 线整块面板就没有形状。
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .strokeBorder(Color(uiColor: .separator), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
        // 蒙层与面板同尺寸，所以直接盖在它上面。多一层 `overlay` 而不是让面板为它让位：
        // 手指压上来的那一刻，面板自己不能动 —— 判定用的正是它量出来的那块矩形。
        .overlay {
            if presentation.choicesVisible {
                choiceMask
                    .transition(.opacity)
            }
        }
        .animation(maskAnimation, value: presentation.choicesVisible)
        // 量出来的位置报回给手势，报在**手势所用的同一个坐标系**里。
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.voiceSpace)) }
            action: { panelRect = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voice-panel")
    }

    /// 正在认出来的字：已定稿的正常色，还在变的次要色，末尾一根光标。
    ///
    /// **三段都写明颜色，一段都不靠继承。** 已定稿那一段曾经是唯一没有写明的一处
    /// （气泡那版有，换成面板时丢了），它继承到的东西在不同的底子上不一定是字色 ——
    /// 屏幕上就是「字在、看不见」。
    private var transcript: some View {
        let text: Text
        if presentation.text.isEmpty {
            text = Text(verbatim: presentation.placeholder).foregroundStyle(Color.secondary)
        } else {
            let caret = presentation.text.caret
                ? Text(verbatim: "▏").foregroundStyle(Self.recordingColor)
                : Text(verbatim: "")
            text = Text(presentation.text.stable).foregroundStyle(Theme.ink)
                + Text(presentation.text.unstable).foregroundStyle(Color.secondary)
                + caret
        }
        return text
            .font(.body)
            .accessibilityIdentifier("voice-transcript")
    }

    /// 电平条。
    ///
    /// **它现在只表示「在收」，不表示「收得响」**：真机的电平还没接进这条线（归语音
    /// 那一轮），柱子按录音时长走一个稳定的起伏。接上真实电平时只换这一处。
    private var waveform: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(waveformLevels.enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(Self.recordingColor)
                    .frame(width: Self.barWidth, height: Self.barHeight)
                    .scaleEffect(y: level, anchor: .center)
            }
        }
        .frame(height: Self.barHeight)
        .accessibilityHidden(true)
    }

    private var waveformLevels: [CGFloat] {
        let frames: [[CGFloat]] = [
            [0.42, 0.86, 0.58, 1.0, 0.5],
            [0.66, 0.98, 0.44, 0.78, 0.62],
            [0.5, 0.72, 1.0, 0.52, 0.88],
            [0.9, 0.48, 0.76, 0.6, 1.0],
            [0.58, 1.0, 0.62, 0.86, 0.46],
        ]
        return frames[max(0, presentation.timerSeconds) % frames.count]
    }

    // MARK: - 蒙层

    private enum Half { case cancel, lock }

    /// 手指压到面板上时盖上去的那一层。
    ///
    /// 中线与判定用的是同一条（同一块 `panelRect` 的 `midX`）—— 画出来的分界和判定的
    /// 分界是同一处，不是两处各算一遍。
    private var choiceMask: some View {
        HStack(spacing: 0) {
            half(
                .cancel,
                icon: "xmark",
                label: "取消",
                armed: presentation.cancelReady,
                fill: Self.recordingColor
            )
            half(
                .lock,
                icon: "pin",
                label: "固定",
                armed: presentation.lockReady,
                // `.opacity(1)` 不是多余的：`Theme.ink` 就是 `Color.primary`，而它当**填充**
                // 用的时候按「主要前景」那一档算，不带着这个透明度就落不成实色 —— 实测下来
                // 是一块中间调的灰，「固定」两个字压在上面既不像选中、也读不清。app 里另外
                // 两个实心按钮（登录、开始对话）也是这么写的。
                fill: Theme.ink.opacity(1)
            )
        }
        // 两半裁进面板的圆角里，各自上色 —— 两块都是实色，没有一处靠透光说话。
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
        .animation(armAnimation, value: presentation.cancelReady)
    }

    /// 蒙层的一半。
    ///
    /// **一次只画一样东西，而且都画在正中间**：手指还没滑过来时是图标，滑上来之后换成
    /// 名字，一个淡出一个淡入，位置不动。两样摞着放（图标在上、名字在下面留着位）会让
    /// 没选中的那半顶着一个偏上的图标、底下空着 —— 图标看着像从中间掉出去了。
    ///
    /// 没压着的那半用苹果那套「未选中」的样子：系统灰底加一个次要色的图标。压着的那半
    /// 反过来 —— 整块实心加上对比色文字，一眼看出手指在哪。
    private func half(
        _ half: Half,
        icon: String,
        label: String,
        armed: Bool,
        fill: Color
    ) -> some View {
        ZStack {
            Image(systemName: icon)
                .font(.largeTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(armed ? Theme.paper : Color.secondary)
                .opacity(armed ? 0 : 1)
            Text(label)
                .font(.title3.weight(.semibold))
                .foregroundStyle(armed ? Theme.paper : Color.secondary)
                .opacity(armed ? 1 : 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // 没压着的那半是一块系统灰，不透明 —— 它盖住的是转写，不该透出什么来。
        .background(armed ? fill : Color(uiColor: .secondarySystemBackground))
        // 一整半块蒙层是一个元素，不是「图标 + 字」两个：读屏读到它时要说的是「取消」，
        // 而不是先念一个没有名字的叉、再念「取消」。
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier(half == .cancel ? "voice-zone-cancel" : "voice-zone-pin")
        .accessibilityLabel(label)
    }
}
