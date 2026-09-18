import SwiftUI

/// 按住说话时浮在输入栏上方的那一层。
///
/// 形状照产品负责人的可交互原型（`长按说话录音交互设计`）：**上面两颗等宽的大方块**
/// —— 手指上滑停在「取消」或「固定」上，松手就按停在哪一块办；**下面一块录音面板**
/// —— 状态、计时、转写、以及把三条出路一次说完的一行提示。
///
/// 尺度和颜色一律用苹果自己的：字体全是语义字号，颜色全是系统语义色或本 app 已有的
/// 那一对（`Theme.ink` / `Theme.paper`），间距取 8 / 12 / 16 这几档。只有原型里没有
/// 对应物的两个高度写了常量，并在各自那里写明为什么是这个数。
///
/// 为什么做成浮层而不是像键盘那样占版面：这套交互要手指**停在某个位置**才选中，而那
/// 两块必须和手指同时看得见。占版面会把终端挤上去，滑动过程中视线得在两处来回。
struct TerminalVoiceDock: View {
    let presentation: HoldToTalkPresentation
    /// 两块方块的位置量出来报回去 —— 手势的命中判定用的就是它们。
    @Binding var cancelZoneRect: CGRect
    @Binding var lockZoneRect: CGRect
    /// 固定之后面板上那枚「取消」。
    let onCancelLocked: () -> Void

    /// 两颗方块之间的间距，以及方块与面板之间、整层与屏幕边缘之间的间距。
    ///
    /// 三处都用 16：它们是同一种关系（两个并列的东西之间的距离），而 16 是这套界面
    /// 里已经在用的档位，不引入新数值。
    private static let gutter: CGFloat = 16

    /// 方块的高度。
    ///
    /// 它是**滑动目标**不是点按目标：手指在动，要够大够稳。取 88 = 两倍最小点按尺寸
    /// （44），和系统对「一块大的、手指不用看就能停在上面」的取向一致。
    private static let zoneHeight: CGFloat = 88

    /// 转写区的高度：正好三行正文。
    ///
    /// 固定而不是随字长，是因为按住的那几秒里每认出一个字面板就长高一点，手指底下
    /// 正在滑的两块会跟着上下跳。三行是「够读到刚说的那句」和「不占掉太多终端」之间
    /// 的取舍，按 `.body` 的行高算出来。
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
    /// 上那一点红、计时旁边的柱子都用它，两个方块里「取消」的实心填充也是它 ——
    /// 这个界面上只有一个红，意思只有一个。
    private static let recordingColor = Color(uiColor: .systemRed)

    /// 手势与方块共用的坐标系名字，与 `TerminalScreen` 里那一处必须是同一个字符串。
    private static let voiceSpace = "terminalVoice"

    var body: some View {
        VStack(spacing: Self.gutter) {
            if presentation.zonesVisible {
                HStack(spacing: Self.gutter) {
                    zone(
                        .cancel,
                        icon: "xmark",
                        label: "取消",
                        armed: presentation.cancelReady,
                        fill: Color(uiColor: .systemRed)
                    )
                    // 量出来的位置报回给手势，报在**手势所用的同一个坐标系**里。
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.voiceSpace)) }
                        action: { cancelZoneRect = $0 }
                    zone(
                        .lock,
                        icon: "pin",
                        label: "固定",
                        armed: presentation.lockReady,
                        fill: Theme.ink
                    )
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(Self.voiceSpace)) }
                        action: { lockZoneRect = $0 }
                }
            }

            if presentation.panelVisible {
                panel
            }
        }
        .padding(.horizontal, Self.gutter)
    }

    // MARK: - 方块

    private enum Zone { case cancel, lock }

    /// 一颗方块。
    ///
    /// 静止时**只有图标**，手指滑进这一块才显出「取消 / 固定」两个字。两块挨着放，
    /// 常驻的标签会把方块填满字；而真正需要读它的时刻是「手指已经停在上面、正在确认
    /// 这是不是我想要的那块」—— 那一刻才显示，信息来得正好。
    private func zone(
        _ zone: Zone,
        icon: String,
        label: String,
        armed: Bool,
        fill: Color
    ) -> some View {
        // 另一块被选中时这一块退到后面去 —— 一眼看出手指现在压在哪一块上。
        let dimmed = (presentation.cancelReady || presentation.lockReady) && !armed

        return VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title)
            Text(label)
                .font(.subheadline.weight(.semibold))
                // 一直占着位置、只是不显示：选中时字冒出来会把这颗方块撑高，而它旁边
                // 那颗不会跟着动 —— 两块高度就不一样了。
                .opacity(armed ? 1 : 0)
        }
        // 未选中时浮在终端的深色画面上，所以用白字；选中之后底色变成一块实心填充，
        // 字跟着换成那个填充上读得出的颜色 —— 也就是 app 里其它实心按钮用的那一对。
        .foregroundStyle(armed ? Theme.paper : .white)
        .frame(maxWidth: .infinity, minHeight: Self.zoneHeight)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(armed ? AnyShapeStyle(fill) : AnyShapeStyle(.white.opacity(0.12)))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.white.opacity(armed ? 0 : 0.2), lineWidth: 1)
        }
        .scaleEffect(armed ? 1.04 : 1)
        .opacity(dimmed ? 0.55 : 1)
        // 一颗方块是一个元素，不是「图标 + 字」两个：读屏读到它时要说的是「取消」，
        // 而不是先念一个没有名字的叉、再念「取消」。
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier(zone == .cancel ? "voice-zone-cancel" : "voice-zone-pin")
        .accessibilityLabel(label)
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
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.paper)
                .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.5), lineWidth: 1)
        }
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
}
