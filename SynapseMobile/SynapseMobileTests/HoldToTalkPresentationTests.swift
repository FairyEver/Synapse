import Foundation
import Testing

@testable import SynapseMobile

/// 按住说话时浮层与输入栏各显示什么，以及说完之后那句字往哪里落。
///
/// 每一条钉的都是「屏幕上会不会说错话」：固定了还在教人松手、手指走了蒙层还盖着、
/// 一个字都没听到却把发送键点亮。判定顺序本身就是规格，所以顺序错了这里会红。
struct HoldToTalkPresentationTests {
    private func presentation(
        _ phase: VoiceInputController.Phase,
        _ transcript: AsrTranscript = .empty,
        voiceMode: Bool = true,
        hasDraft: Bool = false,
        elapsed: TimeInterval = 0,
        gesture: HoldToTalkGesture.Outcome = .speaking,
        locked: Bool = false
    ) -> HoldToTalkPresentation {
        HoldToTalkPresentation(
            phase: phase,
            voiceMode: voiceMode,
            hasDraft: hasDraft,
            transcript: transcript,
            elapsed: elapsed,
            gesture: gesture,
            locked: locked
        )
    }

    private let spoken = AsrTranscript(stable: "把日志拉出来", unstable: "")

    // MARK: - 键盘态

    @Test func theKeyboardBarIsLeftAlone() {
        let value = presentation(.idle, voiceMode: false)
        #expect(value.barIsVoice == false)
        #expect(value.recording == false)
        #expect(value.choicesVisible == false)
        #expect(value.panelVisible == false)
        #expect(value.controlsEnabled)
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
        #expect(value.barLabel == "按住 说话")
        #expect(value.recording == false)
        #expect(value.panelVisible == false)
        // ＋ 与切换键都还能用：此刻手指不在栏上。
        #expect(value.controlsEnabled)
    }

    /// 语音态下没有可发的文字 —— 说出来的那句走的是「松手即发送」，不经过发送键。
    @Test func voiceModeLeavesSendOut() {
        #expect(presentation(.idle, hasDraft: true).sendEnabled == false)
    }

    // MARK: - 按住

    @Test func holdingShowsThePanelAndDimsTheRest() {
        let value = presentation(.listening)
        #expect(value.recording)
        // 输入栏那一格说的是「松手会发生什么」，不是「我在听」。
        #expect(value.barLabel == "松手 发送")
        #expect(value.controlsEnabled == false)
        #expect(value.panelVisible)
        #expect(value.tone == .normal)
        #expect(value.hint == "上滑可取消或固定")
    }

    /// **蒙层不是一按就盖。** 它由「往上滑压到面板上」请出来 —— 一按就摆出两个选项，
    /// 等于在用户还没表达意图之前先替他决定这一句可能要说错。
    @Test func theChoiceMaskWaitsForTheFingerToReachThePanel() {
        #expect(presentation(.listening).choicesVisible == false)
        #expect(presentation(.listening, gesture: .cancelling).choicesVisible)
        #expect(presentation(.listening, gesture: .locking).choicesVisible)
        // 固定之后手指早走了，蒙层没有存在的理由。
        #expect(presentation(.listening, gesture: .locking, locked: true).choicesVisible == false)
    }

    /// 面板里一个字都还没有时得说点什么，否则按住的那几秒是一片空白。
    ///
    /// 说的是**用户该干什么**，不是「我在识别」—— 后者已经写在状态行上了，正文再写一遍
    /// 就是同一句话在一屏上出现两次。
    @Test func anEmptyPanelAsksForWords() {
        #expect(presentation(.listening).placeholder == "请说话")
        #expect(presentation(.listening).placeholder != presentation(.listening).stateText)
        #expect(presentation(.listening).text.isEmpty)
        #expect(presentation(.listening).text.caret == false)
    }

    @Test func thePanelCarriesWhatWasHeard() {
        let value = presentation(.listening, spoken)
        #expect(value.text.stable == "把日志拉出来")
        #expect(value.text.caret)
        #expect(value.placeholder.isEmpty)
    }

    /// 未定稿的那半句用户已经在屏幕上看见了，所以它也要出现在面板里。
    @Test func aStillChangingSentenceIsShownToo() {
        let value = presentation(.listening, AsrTranscript(stable: "", unstable: "git sta"))
        #expect(value.text.unstable == "git sta")
        #expect(value.text.caret)
        #expect(value.placeholder.isEmpty)
    }

    // MARK: - 压在面板的哪一半上

    @Test func pressingTheLeftHalfReadiesTheCancel() {
        let value = presentation(.listening, spoken, gesture: .cancelling)
        #expect(value.choicesVisible)
        #expect(value.cancelReady)
        #expect(value.lockReady == false)
        #expect(value.tone == .cancel)
        #expect(value.barLabel == "松手 取消")
        // 面板这一行此刻被蒙层盖着，它说什么是「手指不在面板上」时才需要管的事。
        #expect(value.hint == "上滑可取消或固定")
    }

    @Test func pressingTheRightHalfReadiesTheLock() {
        let value = presentation(.listening, spoken, gesture: .locking)
        #expect(value.choicesVisible)
        #expect(value.lockReady)
        #expect(value.cancelReady == false)
        #expect(value.tone == .lock)
        #expect(value.barLabel == "松手 固定")
    }

    /// 手指滑下面板要退干净：蒙层、配色、输入栏那一格的三个信号一起复原。
    @Test func slidingBackOffThePanelUndoesAllOfThem() {
        let value = presentation(.listening, spoken, gesture: .speaking)
        #expect(value.choicesVisible == false)
        #expect(value.cancelReady == false)
        #expect(value.lockReady == false)
        #expect(value.tone == .normal)
        #expect(value.barLabel == "松手 发送")
    }

    // MARK: - 收尾中

    /// 手指已经松开了，这时候还摆着一句「松手取消」是一句作废的指导。
    @Test func wrappingUpIgnoresTheGesture() {
        let value = presentation(.finalizing, spoken, gesture: .cancelling)
        #expect(value.hint == "转文字中")
        #expect(value.cancelReady == false)
        #expect(value.lockReady == false)
        #expect(value.tone == .normal)
        #expect(value.choicesVisible == false)
    }

    /// 面板要留到文字落定为止：先消失再冒字是两段感。
    @Test func thePanelStaysUpWhileWrappingUp() {
        let value = presentation(.finalizing, spoken)
        #expect(value.panelVisible)
        #expect(value.recording == false)
        #expect(value.controlsEnabled == false)
    }

    // MARK: - 失败

    /// 静音满 3 秒只是换一句话：麦克风还开着，用户接着说就能接上。
    @Test func silenceHintReplacesTheWordsWithoutEndingTheHold() {
        let value = presentation(.failed(.noSpeech))
        #expect(value.recording)
        #expect(value.panelVisible)
        #expect(value.placeholder == "没有听到声音")
        #expect(value.hint == "上滑可取消或固定")
    }

    /// 已经听到的字比失败本身重要。
    @Test func aFailureKeepsWhatWasHeardOnScreen() {
        let value = presentation(.failed(.noSpeech), spoken)
        #expect(value.placeholder.isEmpty)
        #expect(value.text.stable == "把日志拉出来")
    }

    /// 连接没了就没有可按住的东西，面板立刻让位（视图随即收尾）。
    @Test func aDeadConnectionDoesNotKeepThePanelUp() {
        #expect(presentation(.failed(.network)).panelVisible == false)
        #expect(presentation(.failed(.network)).hint.isEmpty)
    }

    @Test func anInterruptionDoesNotKeepThePanelUpEither() {
        #expect(presentation(.interrupted, spoken).panelVisible == false)
    }

    // MARK: - 固定

    /// 固定之后手指走了，面板接着显示同一段字 —— 只是那层「走哪条路」的蒙层收起来了。
    @Test func lockingKeepsThePanelAndTakesTheChoiceMaskAway() {
        let value = presentation(.listening, spoken, locked: true)
        #expect(value.locked)
        #expect(value.panelVisible)
        #expect(value.choicesVisible == false)
        #expect(value.stateText == "已固定 · 持续识别")
        #expect(value.text.stable == "把日志拉出来")
        // 那一格画的已经是「完成」，不再是按住说话。
        #expect(value.barLabel == "完成")
        #expect(value.hint == "点击底部「完成」结束并发送")
    }

    /// 固定之后手指不在了，手势就该停止说话 —— 否则「松手取消」会挂在一个已经
    /// 松开的屏幕上。
    @Test func aLockedBarStopsSpeakingForTheFinger() {
        let value = presentation(.listening, spoken, gesture: .cancelling, locked: true)
        #expect(value.cancelReady == false)
        #expect(value.lockReady == false)
        #expect(value.choicesVisible == false)
        #expect(value.tone == .lock)
        #expect(value.controlsEnabled == false)
    }

    // MARK: - 计时

    /// 面板右上角那个数：分秒都补零，录音时数字不会跳宽度。
    @Test func theTimerIsPaddedSoItDoesNotJump() {
        #expect(HoldToTalkPresentation.timer(0) == "00:00")
        #expect(HoldToTalkPresentation.timer(7) == "00:07")
        #expect(HoldToTalkPresentation.timer(61) == "01:01")
        #expect(HoldToTalkPresentation.timer(600) == "10:00")
        // 负数是没意义的输入，不该画成负号。
        #expect(HoldToTalkPresentation.timer(-3) == "00:00")
    }

    @Test func theTimerReachesThePanel() {
        let value = presentation(.listening, elapsed: 12)
        #expect(value.timerText == "00:12")
        #expect(value.timerSeconds == 12)
    }

    // MARK: - 该不该发

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
