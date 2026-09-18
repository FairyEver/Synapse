import Foundation

/// 按住式下浮层与输入栏各显示什么。
///
/// 与 `VoiceInputController` 同一个形状：不认识视图，只认识控制器交出来的状态，能被
/// 单测完整覆盖。视图负责画，判定负责说 —— 文案只在这一个文件里出现一次。
///
/// 这一版的排布：按住之后**输入栏上方浮出一块录音面板**；手指往上滑压到面板上，面板
/// 上盖一层与它同样尺寸、左右一分为二的蒙层（左取消 / 右固定）。
struct HoldToTalkPresentation: Equatable {
    /// 转写的两级呈现：已定稿的正常色，还在变的当前句次要色，末尾一个光标。
    struct Transcript: Equatable {
        let stable: String
        let unstable: String
        let caret: Bool

        var isEmpty: Bool { stable.isEmpty && unstable.isEmpty }

        static let empty = Transcript(stable: "", unstable: "", caret: false)

        init(stable: String, unstable: String, caret: Bool) {
            self.stable = stable
            self.unstable = unstable
            self.caret = caret
        }

        init(_ transcript: AsrTranscript) {
            self.init(
                stable: transcript.stable,
                unstable: transcript.unstable,
                // 有字才有光标：它就是落点，不是装饰。
                caret: !transcript.isEmpty
            )
        }
    }

    /// 浮层的配色：普通 / 取消就绪（红）/ 固定就绪（品牌色）。
    enum Tone: Equatable {
        case normal
        case cancel
        case lock
    }

    /// 输入框那一格是「按住 说话」而不是文本域。
    let barIsVoice: Bool
    /// 已经固定，录音继续。
    let locked: Bool
    /// 手指压着、正在录。
    let recording: Bool
    /// 输入栏那一格上写的字。
    let barLabel: String
    /// 面板上那层蒙层盖上了 —— 手指正压着面板，松手会落在左半或右半。
    let choicesVisible: Bool
    /// 手指压在哪一半上。它决定蒙层两半各自的样子。
    let cancelReady: Bool
    let lockReady: Bool
    /// 录音面板出现了：录着、收尾中、或者已固定。
    let panelVisible: Bool
    /// 面板第一行左边那几个字。
    let stateText: String
    /// 面板与方块的配色。
    let tone: Tone
    /// 面板里的转写。
    let text: Transcript
    /// 一个字都还没有时面板里显示的那句话。空串表示正文一定有字。
    let placeholder: String
    /// 面板最后一行。
    let hint: String
    /// 已录时长，`00:01`。
    let timerText: String
    /// 同一件事的秒数。波形按它取一帧 —— 免得为了一根会动的柱子再开一条计时源。
    let timerSeconds: Int
    /// 切换键与 ＋。按住期间和收尾中都不接受。
    let controlsEnabled: Bool
    /// 发送键。语音态一律不可点 —— 此刻没有可发的文字。
    let sendEnabled: Bool

    /// 输入栏那一格的字。这一格从头到尾都在原位，只是称呼跟着走。
    static let idleLabel = "按住 说话"
    static let releaseToSendLabel = "松手 发送"
    static let releaseToCancelLabel = "松手 取消"
    static let releaseToPinLabel = "松手 固定"
    static let finishLabel = "完成"

    /// 面板最后一行。
    ///
    /// 它只在**手指不在面板上**的时候看得见 —— 手指一压上去，整块面板就被蒙层盖住了。
    /// 所以这一句要说的是那两个去处在哪，而不是「松手会怎样」：后者已经写在输入栏那一格
    /// 上了（`barLabel`），这里再说一遍是同一件事在两处说。
    ///
    /// **不写「左」「右」。** 它只在按住的那几秒里露一次脸，要在一眼里读完；左右是滑上去
    /// 之后蒙层自己摆出来的（那两半上就写着「取消」「固定」），不用提前背。
    /// 也不写「面板」—— 屏幕上看不见这个名字。
    static let idleHint = "上滑可取消或固定"
    static let lockedHint = "点击底部「完成」结束并发送"

    /// 面板第一行左边。
    ///
    /// 说的是**这次交互在干什么**：把说的话变成字，不是「录下来」。声音是边收边转的，
    /// 客户端与服务端都不落盘 —— 一个字都没认出来时也不会留下录音。
    static let recordingState = "识别中"
    static let lockedState = "已固定 · 持续识别"

    /// 来电或切后台把这次识别打断了。
    static let interruptedNotice = "识别被打断"

    /// 一个字都还没认出来时，面板正文里那句话。
    ///
    /// **与 `recordingState` 是两件事，不能复用**：状态行已经在说「识别中」，正文再写一遍
    /// 就是同一句话在一屏上出现两次。正文这一格说的是用户现在该干什么。
    static let emptyPlaceholder = "请说话"

    /// 麦克风权限被拒时那条提示。
    ///
    /// 与 `VoiceInputController.begin()` 里那句是同一句话。控制器这一轮一个字不改，
    /// 所以这里放一份常量给切换键的预检用 —— 它要在**进语音态之前**就把话说了，而
    /// 控制器那条路只走得通「已经按下去」之后。改文案时两处一起改。
    static let microphoneDeniedNotice = "麦克风权限未开启 · 设置 › Synapse › 麦克风"

    init(
        phase: VoiceInputController.Phase,
        voiceMode: Bool,
        hasDraft: Bool,
        transcript: AsrTranscript = .empty,
        elapsed: TimeInterval = 0,
        gesture: HoldToTalkGesture.Outcome = .speaking,
        locked: Bool = false
    ) {
        let text = Transcript(transcript)
        // 麦克风还开着、音频还在送。`failed(.noSpeech)` 也算：它只是把「没有听到
        // 声音」摆出来，录音并没有停。
        let listening = phase.isListening
        // 手指已经离开，但收尾还没回来。这段时间里输入栏那一格维持录音态的样子，
        // 差一个键回到亮起，会让人以为可以接着按。
        let wrappingUp = phase == .finalizing

        self.locked = locked
        barIsVoice = voiceMode || phase != .idle
        recording = listening && !locked
        barLabel = Self.labelForBar(recording: listening && !locked, locked: locked, gesture: gesture)
        // 蒙层不是一按就盖：手指得真的压到面板上（`gesture` 就是「压在面板上」这件事
        // 判出来的结果），所以录着还不够。
        choicesVisible = recording && gesture != .speaking
        cancelReady = recording && gesture == .cancelling
        lockReady = recording && gesture == .locking
        panelVisible = listening || wrappingUp || locked
        stateText = locked ? Self.lockedState : Self.recordingState
        tone = locked ? .lock : (recording ? Self.toneFor(gesture) : .normal)
        self.text = text
        // 一个字都还没有时，面板里得说点什么，否则按住的那几秒是一片空白。
        // 静音满 3 秒是控制器给的那条既有语义：识别继续，只是换一句话。
        placeholder = text.isEmpty
            ? (phase == .failed(.noSpeech) ? VoiceInputController.Failure.noSpeech.message : Self.emptyPlaceholder)
            : ""
        hint = Self.hint(visible: listening || wrappingUp || locked, locked: locked, wrappingUp: wrappingUp)
        timerText = Self.timer(elapsed)
        timerSeconds = max(0, Int(elapsed))
        controlsEnabled = !(listening || wrappingUp) && !locked
        // 语音态下没有可发的文字：说出来的那句走的是「松手即发送」，不经过这个键。
        sendEnabled = !barIsVoice && hasDraft
    }

    private static func labelForBar(
        recording: Bool,
        locked: Bool,
        gesture: HoldToTalkGesture.Outcome
    ) -> String {
        if locked { return finishLabel }
        guard recording else { return idleLabel }
        switch gesture {
        case .cancelling: return releaseToCancelLabel
        case .locking: return releaseToPinLabel
        case .speaking: return releaseToSendLabel
        }
    }

    private static func toneFor(_ gesture: HoldToTalkGesture.Outcome) -> Tone {
        switch gesture {
        case .cancelling: return .cancel
        case .locking: return .lock
        case .speaking: return .normal
        }
    }

    private static func hint(
        visible: Bool,
        locked: Bool,
        wrappingUp: Bool
    ) -> String {
        guard visible else { return "" }
        if locked { return lockedHint }
        if wrappingUp { return "转文字中" }
        return idleHint
    }

    /// `00:07`。分和秒都补零，好在录音时数字不跳宽度。
    static func timer(_ elapsed: TimeInterval) -> String {
        let total = max(0, Int(elapsed))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

/// 一次语音输入结束时，转写该往哪里落。
///
/// 这是分流的**唯一一处实现**：松手即发送那条与锁定态「完成」那条都走它。写两份
/// 必然会漂开 —— 其中一份改了 trim、另一份没改，用户就会看到同一句话在两条路上
/// 落成两个样子。
enum VoiceLanding: Equatable {
    /// `draft` 本来空着 —— 说一句话就是发一句话，直接送出去。
    case send(String)
    /// `draft` 里已经有字 —— 用户正在编辑，追加进去等他确认。
    case append(String)
    /// 一个字都没识别到：不发，也不落。
    case nothing

    static func resolve(transcript: String?, draft: String) -> VoiceLanding {
        // 纯空白按空处理，与 `AsrTranscript.finalText` 同一条口径：多一道门槛是为了
        // 让「该不该发」在纯值这一层就是完整的，不依赖上游已经 trim 过。
        let heard = (transcript ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !heard.isEmpty else { return .nothing }
        // 「原内容 + 一个空格 + 转写」，与改造前点击式那条追加规则逐字一致 —— 换了
        // 手势不该换来另一种拼接方式。
        return draft.isEmpty ? .send(heard) : .append(draft + " " + heard)
    }
}
