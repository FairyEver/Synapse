import Foundation

/// 按住式下输入栏与气泡各显示什么。
///
/// 与 `VoiceInputController` 同一个形状：不认识视图，只认识控制器交出来的状态，能被
/// 单测完整覆盖。视图负责画，判定负责说 —— 文案与阈值都只在这两个文件里出现一次。
///
/// 判定顺序本身就是规格，不要重排：
///
/// 1. 锁定优先 —— 手指走了、气泡就没有存在的理由（§4.9），§3.7 的「落点唯一」在
///    输入栏本体上重新成立。
/// 2. 失败态里的「没有听到声音」不算失败 —— 录音还在继续，用户接着说就能接上
///    （§5.4），所以它仍然算按着。
/// 3. 收尾中不再认手势 —— 手指已经松开了，这时候把「松开 取消」摆出来是一句
///    已经作废的指导（§4.6）。
struct HoldToTalkPresentation: Equatable {
    /// 转写的两级呈现：已定稿的正常色，还在变的当前句次要色，末尾一个光标（§3.7）。
    ///
    /// 气泡与锁定栏共用同一份 —— 它们显示的是同一段字，只是落在屏幕上的位置不同。
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

    /// 气泡的配色（§4.5）：普通 / 取消就绪（红）/ 锁定就绪（深）。
    enum Tone: Equatable {
        case normal
        case cancel
        case lock
    }

    /// 输入框那一格是「按住 说话」而不是文本域。
    let barIsVoice: Bool
    /// 输入栏换成了录音会话栏。**唯一允许改几何的状态**（§4.1、§4.9）。
    let locked: Bool
    /// 那一格画成按压态。
    let fieldPressed: Bool
    /// 那一格中间那行字：`按住 说话` / `聆听中` / `松开 取消` / `松开 锁定`。
    /// 空串表示锁定态 —— 那一格画的已经是转写栏，不是按钮（§4.9）。
    let fieldLabel: String
    /// 手势图例两侧什么时候高亮（§4.5）。
    let cancelReady: Bool
    let lockReady: Bool
    /// 切换键与 ＋。按住期间和收尾中都淡出且不可点。
    let controlsEnabled: Bool
    /// 发送键。语音态一律不可点 —— 此刻没有可发的文字（§4.3）。
    let sendEnabled: Bool

    /// 气泡。锁定之后不显示：手指走了，它的差事交给输入栏那一格。
    let bubbleVisible: Bool
    let bubbleTone: Tone
    let bubbleText: Transcript
    /// 气泡主体为空时显示的那句话。空串表示主体一定有字。
    let bubblePlaceholder: String
    /// 气泡下方那行提示。
    let hint: String

    /// 锁定栏中间那三行。
    let lockText: Transcript
    /// 锁定栏顶上那行。空串表示不在锁定态。
    let lockTitle: String

    /// 锁定栏两端的文案。不随状态变，所以是常量而不是字段 —— 它们照旧只在这一个
    /// 文件里出现。
    static let lockCancelLabel = "放弃"
    static let lockConfirmLabel = "确定"

    init(
        phase: VoiceInputController.Phase,
        voiceMode: Bool,
        hasDraft: Bool,
        transcript: AsrTranscript = .empty,
        gesture: HoldToTalkGesture.Outcome = .speaking,
        locked: Bool = false
    ) {
        let text = Transcript(transcript)
        // 麦克风还开着、音频还在送。`failed(.noSpeech)` 也算：它只是把「没有听到
        // 声音」摆出来，录音并没有停。
        let recording = phase.isListening
        // 手指已经离开，但收尾还没回来。这段时间里输入栏其余部分维持录音态的淡出
        // 状态（§4.6）—— 差一个键回到亮起，会让人以为可以接着按。
        let wrappingUp = phase == .finalizing

        self.locked = locked
        barIsVoice = voiceMode || phase != .idle
        fieldPressed = recording && !locked
        // 锁定之后手指不在了，那一格讲的就不再是手势，而是录音本身。
        fieldLabel = Self.fieldLabel(
            pressed: recording && !locked,
            locked: locked,
            gesture: gesture
        )
        cancelReady = fieldPressed && gesture == .cancelling
        lockReady = fieldPressed && gesture == .locking
        controlsEnabled = !(recording || wrappingUp) && !locked
        // 语音态下没有可发的文字：说出来的那句走的是「松手即发送」，不经过这个键。
        sendEnabled = !barIsVoice && hasDraft

        bubbleVisible = (recording || wrappingUp) && !locked
        bubbleTone = fieldPressed ? Self.tone(gesture) : .normal
        bubbleText = text
        // 一个字都还没有时，气泡里得说点什么，否则按住的那几秒是一片空白。
        // 静音满 3 秒是控制器给的那条既有语义（§5.4）：录音继续，只是换一句话。
        bubblePlaceholder = text.isEmpty
            ? (phase == .failed(.noSpeech) ? VoiceInputController.Failure.noSpeech.message : "聆听中")
            : ""
        hint = Self.hint(visible: bubbleVisible, wrappingUp: wrappingUp, gesture: gesture)

        lockText = text
        lockTitle = locked ? "录音中" : ""
    }

    private static func fieldLabel(
        pressed: Bool,
        locked: Bool,
        gesture: HoldToTalkGesture.Outcome
    ) -> String {
        if locked { return "" }
        guard pressed else { return "按住 说话" }
        switch gesture {
        case .cancelling: return "松开 取消"
        case .locking: return "松开 锁定"
        case .speaking: return "聆听中"
        }
    }

    private static func tone(_ gesture: HoldToTalkGesture.Outcome) -> Tone {
        switch gesture {
        case .cancelling: return .cancel
        case .locking: return .lock
        case .speaking: return .normal
        }
    }

    private static func hint(
        visible: Bool,
        wrappingUp: Bool,
        gesture: HoldToTalkGesture.Outcome
    ) -> String {
        guard visible else { return "" }
        if wrappingUp { return "转文字中" }
        switch gesture {
        case .cancelling: return "松开 取消"
        case .locking: return "松开 锁定"
        case .speaking: return "松开 转文字"
        }
    }
}

/// 一次语音输入结束时，转写该往哪里落（§4.7）。
///
/// 这是分流的**唯一一处实现**：松手即发送那条与锁定态「确定」那条都走它。写两份
/// 必然会漂开 —— 其中一份改了 trim、另一份没改，用户就会看到同一句话在两条路上
/// 落成两个样子。
enum VoiceLanding: Equatable {
    /// `draft` 本来空着 —— 说一句话就是发一句话，直接送出去。
    case send(String)
    /// `draft` 里已经有字 —— 用户正在编辑，追加进去等他确认。
    case append(String)
    /// 一个字都没识别到：不发，也不落（§5.3）。
    case nothing

    /// - Parameters:
    ///   - transcript: `VoiceInputController.confirm()` 交回来的文本，没识别到是 nil。
    ///   - draft: 按住之前输入框里已经有的内容。
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
