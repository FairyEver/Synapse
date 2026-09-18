import Testing

@testable import SynapseMobile

/// 按住式下输入栏与气泡各显示什么，以及说完之后那句字往哪里落。
///
/// 每一条钉的都是「屏幕上会不会说错话」：锁上了还在教人松手、手指走了气泡还在、
/// 一个字都没听到却把发送键点亮。判定顺序本身就是规格，所以顺序错了这里会红。
struct HoldToTalkPresentationTests {
    private func presentation(
        _ phase: VoiceInputController.Phase,
        _ transcript: AsrTranscript = .empty,
        voiceMode: Bool = true,
        hasDraft: Bool = false,
        gesture: HoldToTalkGesture.Outcome = .speaking,
        locked: Bool = false
    ) -> HoldToTalkPresentation {
        HoldToTalkPresentation(
            phase: phase,
            voiceMode: voiceMode,
            hasDraft: hasDraft,
            transcript: transcript,
            gesture: gesture,
            locked: locked
        )
    }

    private let spoken = AsrTranscript(stable: "把日志拉出来", unstable: "")

    // MARK: - 键盘态

    @Test func theKeyboardBarIsLeftAlone() {
        let value = presentation(.idle, voiceMode: false)
        #expect(value.barIsVoice == false)
        #expect(value.fieldPressed == false)
        #expect(value.controlsEnabled)
        #expect(value.bubbleVisible == false)
        #expect(value.lockTitle.isEmpty)
    }

    /// 发送键的启用照旧只看输入框里有没有字。
    @Test func sendFollowsTheDraftInKeyboardMode() {
        #expect(presentation(.idle, voiceMode: false).sendEnabled == false)
        #expect(presentation(.idle, voiceMode: false, hasDraft: true).sendEnabled)
    }

    // MARK: - 语音态（还没按）

    @Test func voiceModeWaitsToBeHeld() {
        let value = presentation(.idle)
        #expect(value.barIsVoice)
        #expect(value.fieldLabel == "按住 说话")
        #expect(value.fieldPressed == false)
        #expect(value.bubbleVisible == false)
        // ＋ 与切换键都还能用：此刻手指不在栏上。
        #expect(value.controlsEnabled)
    }

    /// 语音态下没有可发的文字 —— 说出来的那句走的是「松手即发送」，不经过发送键。
    @Test func voiceModeLeavesSendOut() {
        #expect(presentation(.idle, hasDraft: true).sendEnabled == false)
    }

    // MARK: - 按住

    @Test func holdingShowsTheBubbleAndDimsTheRest() {
        let value = presentation(.listening)
        #expect(value.fieldPressed)
        #expect(value.fieldLabel == "聆听中")
        #expect(value.controlsEnabled == false)
        #expect(value.bubbleVisible)
        #expect(value.bubbleTone == .normal)
        #expect(value.hint == "松开 转文字")
    }

    /// 气泡里一个字都还没有时得说点什么，否则按住的那几秒是一片空白。
    @Test func anEmptyBubbleSaysItIsListening() {
        #expect(presentation(.listening).placeholder == "聆听中")
        #expect(presentation(.listening).bubbleText.isEmpty)
        #expect(presentation(.listening).bubbleText.caret == false)
    }

    @Test func theBubbleCarriesWhatWasHeard() {
        let value = presentation(.listening, spoken)
        #expect(value.bubbleText.stable == "把日志拉出来")
        #expect(value.bubbleText.caret)
        #expect(value.placeholder.isEmpty)
    }

    /// 未定稿的那半句用户已经在屏幕上看见了，所以它也要出现在气泡里。
    @Test func aStillChangingSentenceIsShownToo() {
        let value = presentation(.listening, AsrTranscript(stable: "", unstable: "git sta"))
        #expect(value.bubbleText.unstable == "git sta")
        #expect(value.bubbleText.caret)
        #expect(value.placeholder.isEmpty)
    }

    // MARK: - 滑动

    @Test func slidingLeftReadiesTheCancel() {
        let value = presentation(.listening, spoken, gesture: .cancelling)
        #expect(value.cancelReady)
        #expect(value.lockReady == false)
        #expect(value.bubbleTone == .cancel)
        #expect(value.hint == "松开 取消")
        #expect(value.fieldLabel == "松开 取消")
    }

    @Test func slidingRightReadiesTheLock() {
        let value = presentation(.listening, spoken, gesture: .locking)
        #expect(value.lockReady)
        #expect(value.cancelReady == false)
        #expect(value.bubbleTone == .lock)
        #expect(value.hint == "松开 锁定")
        #expect(value.fieldLabel == "松开 锁定")
    }

    /// 滑回阈值以内要退干净：配色、提示、两侧的高亮一起复原。
    @Test func slidingBackUndoesAllThreeSignals() {
        let value = presentation(.listening, spoken, gesture: .speaking)
        #expect(value.cancelReady == false)
        #expect(value.lockReady == false)
        #expect(value.bubbleTone == .normal)
        #expect(value.hint == "松开 转文字")
        #expect(value.fieldLabel == "聆听中")
    }

    // MARK: - 收尾中

    /// 手指已经松开了，这时候还摆着一句「松开 取消」是一句作废的指导。
    @Test func wrappingUpIgnoresTheGesture() {
        let value = presentation(.finalizing, spoken, gesture: .cancelling)
        #expect(value.hint == "转文字中")
        #expect(value.cancelReady == false)
        #expect(value.lockReady == false)
        #expect(value.bubbleTone == .normal)
    }

    /// 气泡要留到文字落定为止：先消失再冒字是两段感。
    @Test func theBubbleStaysUpWhileWrappingUp() {
        let value = presentation(.finalizing, spoken)
        #expect(value.bubbleVisible)
        #expect(value.fieldPressed == false)
        #expect(value.controlsEnabled == false)
    }

    // MARK: - 失败

    /// 静音满 3 秒只是换一句话：麦克风还开着，用户接着说就能接上。
    @Test func silenceHintReplacesTheWordsWithoutEndingTheHold() {
        let value = presentation(.failed(.noSpeech))
        #expect(value.fieldPressed)
        #expect(value.bubbleVisible)
        #expect(value.placeholder == "没有听到声音")
        #expect(value.hint == "松开 转文字")
    }

    /// 已经听到的字比失败本身重要。
    @Test func aFailureKeepsWhatWasHeardOnScreen() {
        let value = presentation(.failed(.noSpeech), spoken)
        #expect(value.placeholder.isEmpty)
        #expect(value.bubbleText.stable == "把日志拉出来")
    }

    /// 连接没了就没有可按住的东西，气泡立刻让位（视图随即收尾）。
    @Test func aDeadConnectionDoesNotKeepTheBubbleUp() {
        #expect(presentation(.failed(.network)).bubbleVisible == false)
        #expect(presentation(.failed(.network)).hint.isEmpty)
    }

    @Test func anInterruptionDoesNotKeepTheBubbleUpEither() {
        #expect(presentation(.interrupted, spoken).bubbleVisible == false)
    }

    // MARK: - 锁定态

    /// 手指走了，气泡就没有存在的理由：落点回到输入栏本体（§3.7、§4.9）。
    @Test func lockingMovesTheWordsIntoTheBar() {
        let value = presentation(.listening, spoken, locked: true)
        #expect(value.locked)
        #expect(value.bubbleVisible == false)
        #expect(value.lockTitle == "录音中")
        #expect(value.lockText.stable == "把日志拉出来")
        #expect(value.lockText.caret)
        // 那一格画的已经是转写栏，不是按钮。
        #expect(value.fieldLabel.isEmpty)
    }

    /// 锁上之后手指不在了，手势就该停止说话 —— 否则「松开 取消」会挂在一个已经
    /// 松开的屏幕上。
    @Test func aLockedBarStopsSpeakingForTheFinger() {
        let value = presentation(.listening, spoken, gesture: .cancelling, locked: true)
        #expect(value.cancelReady == false)
        #expect(value.lockReady == false)
        #expect(value.bubbleTone == .normal)
        #expect(value.hint.isEmpty)
    }

    // MARK: - 该不该发（§4.7、§8.28）

    @Test func nothingHeardMeansNothingHappens() {
        #expect(VoiceLanding.resolve(transcript: nil, draft: "") == .nothing)
        #expect(VoiceLanding.resolve(transcript: "", draft: "") == .nothing)
        #expect(VoiceLanding.resolve(transcript: "   ", draft: "") == .nothing)
        #expect(VoiceLanding.resolve(transcript: "\n\t", draft: "已经有字了") == .nothing)
    }

    /// 说一句话就是发一句话 —— 这时候再让用户点一次发送正是这次要改掉的东西。
    @Test func anEmptyDraftMeansSend() {
        #expect(VoiceLanding.resolve(transcript: "把日志拉出来", draft: "") == .send("把日志拉出来"))
    }

    /// 输入框里有字说明用户在编辑：把他的半句话和刚说的半句一起送走是危险的一侧。
    @Test func aFullDraftMeansAppend() {
        #expect(
            VoiceLanding.resolve(transcript: "把日志拉出来", draft: "cd /tmp")
                == .append("cd /tmp 把日志拉出来")
        )
    }

    /// 只有未定稿的尾巴也算听到了 —— 那是用户刚说的话。
    @Test func anUnsettledTailIsStillHeard() {
        #expect(VoiceLanding.resolve(transcript: "git sta", draft: "") == .send("git sta"))
    }

    @Test func theTextIsTrimmedBeforeItLands() {
        #expect(VoiceLanding.resolve(transcript: "  把日志拉出来 ", draft: "") == .send("把日志拉出来"))
    }

    // MARK: - Controller 自己那一层

    /// 按住式只用得上 `start` / `confirm` / `cancel`，`retry` 就没人调了。它留在控制器
    /// 上不动，所以它和它的判据照样钉住 —— 哪天有人把这条规则改了，这里要红。
    @Test func onlyTheFailuresWorthRetryingAreRetryable() {
        #expect(VoiceInputController.Failure.noSpeech.isRetryable)
        #expect(VoiceInputController.Failure.network.isRetryable)
        // 要在这次通话之外先被解决，原地再点一次不会变。
        #expect(VoiceInputController.Failure.notConfigured.isRetryable == false)
    }
}
