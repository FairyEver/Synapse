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
/// 尺度和颜色一律用苹果自己的：字体全是语义字号，颜色全是系统语义色或本 app 已有的
/// 那一对（`Theme.ink` / `Theme.paper`），间距取 8 / 12 / 16 这几档。只有转写区的高度
/// 写了常量，并在那里写明为什么是这个数。
struct TerminalVoiceDock: View {
    let presentation: HoldToTalkPresentation
    /// 面板量出来的位置，报在**手势所用的那个坐标系**里 —— 左右两半的判定用的就是它。
    @Binding var panelRect: CGRect
    /// 固定之后面板上那枚「取消」。
    let onCancelLocked: () -> Void

    /// 面板与屏幕左、右、下三边之间的距离。
    ///
    /// 三边同一个数：它们是同一种关系（浮层与屏幕边缘之间的距离）。下边这一份是后补的
    /// —— 少了它，面板的圆角正好顶在工具栏的上沿，看着像被工具栏切掉了一块。
    private static let gutter: CGFloat = 16

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

    /// 面板与蒙层的圆角。
    private static let cornerRadius: CGFloat = 12

    /// 正在录音的那个记号色。
    ///
    /// 红是苹果自己给「正在录」的颜色（录屏、录音时状态栏那一颗就是它），整个面板
    /// 上那一点红、计时旁边的柱子、以及蒙层左半的实心填充都用它 —— 这个界面上只有
    /// 一个红，意思只有一个。
    private static let recordingColor = Color(uiColor: .systemRed)

    /// 手势与面板共用的坐标系名字，与 `TerminalScreen` 里那一处必须是同一个字符串。
    private static let voiceSpace = "terminalVoice"

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
                    .foregroundStyle(.secondary)

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
        .background {
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .fill(Theme.paper)
                .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
        }
        .overlay {
            RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.5), lineWidth: 1)
        }
        // 蒙层与面板同尺寸，所以直接盖在它上面。多一层 `overlay` 而不是让面板为它让位：
        // 手指压上来的那一刻，面板自己不能动 —— 判定用的正是它量出来的那块矩形。
        .overlay {
            if presentation.choicesVisible {
                choiceMask
            }
        }
        // 量出来的位置报回给手势，报在**手势所用的同一个坐标系**里。
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.voiceSpace)) }
            action: { panelRect = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voice-panel")
    }

    /// 正在认出来的字：已定稿的正常色，还在变的次要色，末尾一根光标。
    private var transcript: some View {
        let text: Text
        if presentation.text.isEmpty {
            text = Text(verbatim: presentation.placeholder).foregroundStyle(.secondary)
        } else {
            let caret = presentation.text.caret
                ? Text(verbatim: "▏").foregroundStyle(Self.recordingColor)
                : Text(verbatim: "")
            text = Text(presentation.text.stable)
                + Text(presentation.text.unstable).foregroundStyle(.secondary)
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
                fill: Theme.ink
            )
        }
        .clipShape(RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous))
    }

    /// 蒙层的一半。
    ///
    /// 压着的那一半填成实心并显出自己的名字，另一半退到后面去。这就是「已经滑到这个
    /// 区域上了」的那条反馈：手指正压在上面，眼睛未必看得见它，所以给的是整半块变色
    /// 这么大的变化；而此刻手指底下唯一需要读的东西，也就是这两个字。
    private func half(
        _ half: Half,
        icon: String,
        label: String,
        armed: Bool,
        fill: Color
    ) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title)
            Text(label)
                .font(.subheadline.weight(.semibold))
                // 一直占着位置、只是不显示：显出来会把这半块撑高，而它旁边那半不会
                // 跟着动 —— 两半就不一样大了。
                .opacity(armed ? 1 : 0)
        }
        // 未选中时读在那块系统灰底上，选中之后底色变成一块实心填充，字跟着换成那个填充
        // 上读得出的颜色 —— 也就是 app 里其它实心按钮用的那一对（`Theme.ink` /
        // `Theme.paper` 各自跟着外观走，两种模式下都读得出来）。
        .foregroundStyle(armed ? Theme.paper : Theme.ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(armed ? fill : Color(uiColor: .secondarySystemBackground))
        // 一整半块蒙层是一个元素，不是「图标 + 字」两个：读屏读到它时要说的是「取消」，
        // 而不是先念一个没有名字的叉、再念「取消」。
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier(half == .cancel ? "voice-zone-cancel" : "voice-zone-pin")
        .accessibilityLabel(label)
    }
}
