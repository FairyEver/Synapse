import Testing

@testable import SynapseMobile

/// 录音期间输入栏该显示什么。
///
/// 三端各写一遍这套判断会自然地漂开，所以它被抽成一个纯值。下面每一条钉的都是
/// 「屏幕上会不会说错话」：还在录却说没听到、没听到东西却把确认键递给用户、断网
/// 之后把已经识别出来的那句丢掉。判定顺序本身就是规格，所以顺序错了这里会红。
struct VoiceInputPresentationTests {
    private func presentation(
        _ phase: VoiceInputController.Phase,
        _ transcript: AsrTranscript = .empty
    ) -> VoiceInputPresentation {
        VoiceInputPresentation(phase: phase, transcript: transcript)
    }

    private let spoken = AsrTranscript(stable: "把日志拉出来", unstable: "")

    // MARK: - 空闲

    @Test func idleLeavesTheBarAlone() {
        let value = presentation(.idle)
        #expect(value.active == false)
        #expect(value.right == .send)
        #expect(value.placeholder.isEmpty)
        #expect(value.caretVisible == false)
    }

    // MARK: - 录音

    @Test func listeningWithNothingHeardYetSaysSoAndGreysOutConfirm() {
        let value = presentation(.listening)
        #expect(value.active == true)
        #expect(value.placeholder == "聆听中")
        #expect(value.caretVisible == false)
        #expect(value.right == .confirmDisabled)
    }

    @Test func hearingSomethingTakesThePlaceholderAwayAndOffersConfirm() {
        let value = presentation(.listening, spoken)
        #expect(value.placeholder.isEmpty)
        #expect(value.caretVisible == true)
        #expect(value.right == .confirm)
    }

    /// 未定稿的那半句用户已经在屏幕上看见了，所以它也算「听到了东西」。
    @Test func aStillChangingSentenceStillCountsAsHeard() {
        let value = presentation(.listening, AsrTranscript(stable: "", unstable: "git sta"))
        #expect(value.right == .confirm)
        #expect(value.caretVisible == true)
    }

    @Test func blankResultsAreNotSomethingToSubmit() {
        let value = presentation(.listening, AsrTranscript(stable: "  ", unstable: ""))
        #expect(value.right == .confirmDisabled)
    }

    // MARK: - 失败

    /// 继续显示「聆听中」会让用户以为还在录。
    @Test func aFailureSaysWhatWentWrong() {
        let value = presentation(.failed(.network))
        #expect(value.active == true)
        #expect(value.placeholder == "网络已断开")
    }

    @Test func aRetryableFailureOffersRetryWhenNothingWasHeard() {
        #expect(presentation(.failed(.noSpeech)).right == .retry)
    }

    @Test func anUnfixableFailureGreysOutRetry() {
        #expect(presentation(.failed(.notConfigured)).right == .retryDisabled)
        #expect(presentation(.failed(.notConfigured)).placeholder == "语音识别未配置")
    }

    /// 已经听到的字比失败本身重要：重试和取消都会把这次录音连同转写一起清掉，
    /// 不能拿它们当断网后唯一的出口。
    @Test func aFailureThatStillHeardSomethingKeepsItReachable() {
        let value = presentation(.failed(.network), spoken)
        #expect(value.placeholder == "网络已断开")
        #expect(value.right == .confirm)
    }

    @Test func anUnfixableFailureAlsoKeepsWhatWasHeard() {
        #expect(presentation(.failed(.notConfigured), spoken).right == .confirm)
    }

    // MARK: - 收尾与被中断

    /// 用户刚点过确认，这里再把键交回去只会把收尾重复提交一次。
    @Test func finalizingDoesNotOfferConfirmAgain() {
        #expect(presentation(.finalizing, spoken).right == .confirmDisabled)
        #expect(presentation(.finalizing, spoken).caretVisible == true)
    }

    /// 来电和切后台不是用户的取消：已经定稿的文本留着等他处置。
    @Test func anInterruptionKeepsWhatWasAlreadySettled() {
        let value = presentation(.interrupted, spoken)
        #expect(value.active == true)
        #expect(value.right == .confirm)
        #expect(value.placeholder.isEmpty)
    }

    @Test func anInterruptionBeforeAnySpeechHasNothingToOffer() {
        #expect(presentation(.interrupted).right == .confirmDisabled)
    }

    // MARK: - Failure 自己那一层

    @Test func onlyTheFailuresWorthRetryingAreRetryable() {
        #expect(VoiceInputController.Failure.noSpeech.isRetryable)
        #expect(VoiceInputController.Failure.network.isRetryable)
        // 要在这次通话之外先被解决，原地再点一次不会变。
        #expect(VoiceInputController.Failure.notConfigured.isRetryable == false)
    }
}
