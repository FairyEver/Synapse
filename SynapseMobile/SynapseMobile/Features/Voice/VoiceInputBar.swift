import SwiftUI
import os

/// 录音态的状态机：权限、采集、连接、送包节奏、收尾。录音的界面不在这里 ——
/// 转写落在手指上方的气泡里、锁定之后回到 `TerminalScreen.inputBar`，摆成什么样
/// 由 `HoldToTalkPresentation` 决定。
///
/// 它要在视图重建之间活着：转写和引擎的连接都不该因为一次重绘而重来。
@MainActor
@Observable
final class VoiceInputController {
    /// 失败时要给用户看的东西。允许的文案只有这几句，别的一律不编。
    enum Failure: Equatable {
        case noSpeech
        case network
        /// 平台还没有配语音识别。
        ///
        /// 和「网络已断开」分开：两者的下一步完全不同（等网络 vs 等配置），说成
        /// 断网会把人支到错的方向去。密钥在服务端，不在电脑上，所以这里不写
        /// 「电脑上」—— 那句话在签名搬到服务端之后就不再成立。
        case notConfigured

        var message: String {
            switch self {
            case .noSpeech: return "没有听到声音"
            case .network: return "网络已断开"
            case .notConfigured: return "语音识别未配置"
            }
        }

        /// 换一条签名就能接着说的失败才值得给重试。
        ///
        /// `.notConfigured` 要在这次通话之外先被解决，原地再点一次不会变。
        var isRetryable: Bool { self != .notConfigured }
    }

    enum Phase: Equatable {
        /// 没在录音，`inputBar` 照常。
        case idle
        /// 在录，音频正在送。
        case listening
        /// 点了完成，等引擎把最后一句定稿回来。
        case finalizing
        /// 出错了，但文本还在，用户可以重试或者直接完成。
        case failed(Failure)
        /// 被来电或切后台打断：不录了，已经定稿的文本留着等用户处置。
        case interrupted

        /// 麦克风还开着、音频还在送。
        ///
        /// `noSpeech` 只是把提示摆出来，录音本身没有停 —— 用户接着说就能接上，所以
        /// 指示不能跟着一起熄掉，那会让人以为要重来一次。
        var isListening: Bool {
            if case .failed(.noSpeech) = self { return true }
            return self == .listening
        }
    }

    private(set) var phase: Phase = .idle
    private(set) var transcript = AsrTranscript.empty
    /// 这次录音已经录了多久。录音界面里没有计时，所以它不再被显示 —— 留着是因为
    /// 节拍本身还要用它判断静音，只是不再是给人看的。
    private(set) var elapsed: TimeInterval = 0
    /// 不进录音态时给用户看的一句话。调用方转发给 banner。
    var notice: String?

    /// 这条 bar 是否该顶掉 `inputBar`。
    var isActive: Bool { phase != .idle }

    /// 送包节奏。快于实时、或两包间隔超过 6 秒，引擎都会主动断开。
    private static let sendInterval = Duration.milliseconds(200)
    /// 约 3 秒没有出字就提示「没有听到声音」，但不自动结束录音。
    private static let silenceHint: TimeInterval = 3
    /// 点完成后等引擎把最后一句定稿回来的上限。
    private static let finalizeTimeout = Duration.milliseconds(1_200)

    private var signing: (() async -> AsrSignOutcome)?
    private var capture: AudioCapture?
    private var session: AsrSession?
    private var loop: Task<Void, Never>?
    private var finalizeWaiter: CheckedContinuation<Void, Never>?
    private var startedAt = Date()
    /// 一次录音的代号。异步的启动过程里用户可能已经按了取消，回来时要认得出。
    private var generation = 0

    // MARK: - 入口

    /// 点麦克风。要签名这件事由调用方给出，控制器不认识 `SynapseAppModel`。
    func start(signing: @escaping () async -> AsrSignOutcome) {
        guard phase == .idle else { return }
        self.signing = signing
        Task { await begin() }
    }

    /// 失败之后再来一次。
    ///
    /// 换一条新签名，也就是换一个新的 voiceId —— 每次连接都要新的，中断后旧的一律
    /// 作废。
    func retry() {
        guard case .failed = phase else { return }
        Task { await begin() }
    }

    /// 用户取消：丢弃全部文本，含已定稿部分。
    func cancel() {
        loop?.cancel()
        loop = nil
        teardown()
        transcript = .empty
        elapsed = 0
        phase = .idle
    }

    /// 完成：收尾，等引擎把最后一句定稿回来，返回要落进输入框的文本。
    ///
    /// 没识别到东西时返回 nil 并把「没有听到声音」摆出来 —— 空结果和没人声是同一
    /// 件事，静悄悄地回到 idle 只会让人以为话说出去了。
    func confirm() async -> String? {
        guard isActive else { return nil }
        loop?.cancel()
        loop = nil

        if let capture, let session {
            // 收尾前把缓冲里剩的采样送出去，最后一帧才不会被丢掉。
            for chunk in capture.pcm.drain(AsrSession.chunkBytes) { session.send(chunk) }
            session.finish()
        }
        phase = .finalizing
        // 网络已经断了就没有什么可等的了。
        if let session, !session.isClosed { await waitForFinalize() }
        capture?.stop()

        // 等待期间用户可能已经取消了，那这次完成就作废。
        guard phase == .finalizing else { return nil }
        let text = transcript.finalText
        teardown()
        guard !text.isEmpty else {
            phase = .failed(.noSpeech)
            return nil
        }
        phase = .idle
        return text
    }

    // MARK: - 一次录音

    private func begin() async {
        generation += 1
        let current = generation
        teardown()
        transcript = .empty
        elapsed = 0
        startedAt = Date()
        phase = .listening

        // 权限先问。被拒就根本不进录音态：一条录不到任何东西的 bar，只会让人以为是
        // 自己没说话。
        guard await AudioCapture.requestPermission() else {
            phase = .idle
            notice = "麦克风权限未开启 · 设置 › Synapse › 麦克风"
            return
        }
        guard current == generation else { return }

        let signed: AsrSignature
        switch await signing?() {
        case .signed(let value): signed = value
        case .notConfigured:
            phase = .failed(.notConfigured)
            return
        default:
            phase = .failed(.network)
            return
        }
        guard current == generation else { return }

        let capture = AudioCapture()
        capture.onInterrupted = { [weak self] in self?.handleInterruption() }
        do {
            // 起引擎是阻塞的，放在主线程之外做 —— 这一步正好落在「按住 说话」按下
            // 的那一刻，占着主线程会把面板浮上来那一下冻住。
            try await capture.startOffMainThread()
        } catch {
            AppLog.voice.warning("microphone capture failed to start.")
            phase = .failed(.network)
            return
        }
        // 起引擎这段时间里用户可能已经取消了，或者又按了一次。那段录音没人认领，
        // 别把它收进来 —— 它的麦克风还开着。
        guard current == generation else {
            capture.stop()
            return
        }
        self.capture = capture

        let session = AsrSession(url: signed.url, events: AsrSession.Events(
            onTranscript: { [weak self] transcript in
                guard let self else { return }
                self.transcript = transcript
                // 声音来了，刚才那句「没有听到声音」就不成立了。
                if self.phase == .failed(.noSpeech) { self.phase = .listening }
            },
            onFailure: { [weak self] failure in self?.handleSocketFailure(failure) },
            onFinished: { [weak self] in self?.releaseFinalizeWaiter() }
        ))
        session.connect()
        self.session = session
        // 只记 voiceId。签名 URL 里带着入场券，日志里不留。
        AppLog.voice.info("asr session opened voiceId=\(signed.voiceId, privacy: .public)")

        startLoop()
    }

    /// 按绝对时刻排下一拍，而不是每次睡固定的 200ms：定时器一旦被系统拖慢，累积的
    /// 偏差就是送出去的音频比真实时间短。
    private func startLoop() {
        loop = Task { [weak self] in
            let clock = ContinuousClock()
            let start = clock.now
            var tick = 0
            while !Task.isCancelled {
                tick += 1
                try? await Task.sleep(
                    until: start.advanced(by: Self.sendInterval * tick),
                    clock: clock
                )
                guard let self, !Task.isCancelled else { return }
                self.sendOneChunk()
            }
        }
    }

    private func sendOneChunk() {
        guard let capture, let session else { return }
        let now = Date().timeIntervalSince(startedAt)
        // 只在整秒变化时才写：这个值驱动整屏重算（终端画布也是它的一部分），200ms
        // 一次没有意义。
        if Int(now) != Int(elapsed) { elapsed = now }
        session.send(capture.pcm.takeChunk(AsrSession.chunkBytes))
        // 录音不因为没人声而停：引擎那边还在收包，用户接着说就能接上，所以这里只是
        // 把提示摆出来，送包照旧。
        if phase == .listening, transcript.isEmpty, now >= Self.silenceHint {
            phase = .failed(.noSpeech)
        }
    }

    // MARK: - 收尾与失败

    private func waitForFinalize() async {
        await withCheckedContinuation { continuation in
            finalizeWaiter = continuation
            Task { [weak self] in
                try? await Task.sleep(for: Self.finalizeTimeout)
                self?.releaseFinalizeWaiter()
            }
        }
    }

    private func releaseFinalizeWaiter() {
        guard let waiter = finalizeWaiter else { return }
        finalizeWaiter = nil
        waiter.resume()
    }

    /// 服务端拒绝和连接断开，对用户是同一件事：这次识别没成。区别只留在日志里。
    ///
    /// 提示了「没有听到声音」的录音也在这里：麦克风虽然还开着，连接已经没了，再往
    /// 一个断掉的 socket 里补静音只会把提示一直挂着。
    private func handleSocketFailure(_ failure: AsrSession.Failure) {
        guard phase.isListening else { return }
        AppLog.voice.warning("asr session failed: \(String(describing: failure), privacy: .public)")
        loop?.cancel()
        loop = nil
        phase = .failed(.network)
    }

    private func handleInterruption() {
        // 只打断还在录的那一段。收尾的那 1.2 秒里麦克风已经关了、连接也已经在关，
        // 这时候把用户刚说完的话丢掉才是真的损失。
        guard phase.isListening else { return }
        loop?.cancel()
        loop = nil
        teardown()
        // 来电和切后台不是用户的取消：已经定稿的文本留着。
        phase = .interrupted
    }

    /// 只放资源，不动 `phase` 和 `transcript` —— 文本该留还是该丢，调用方比这里清楚。
    private func teardown() {
        releaseFinalizeWaiter()
        capture?.stop()
        capture = nil
        session?.close()
        session = nil
    }
}
