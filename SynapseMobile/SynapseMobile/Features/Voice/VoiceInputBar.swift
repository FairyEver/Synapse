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
    /// 换连接之后等旧连接把最后一句定稿回来的上限。
    ///
    /// 比收尾那条宽：旧连接发完 `end` 还要把手上积着的音频算完，实测这段等待在
    /// 1.1~1.2 秒，1.2 秒的宽限会刚好被超时抢先，拿不到引擎改写后的那一版
    /// —— 也就是接缝处那半截词补不回来。
    private static let settleTimeout = Duration.milliseconds(2_000)

    private var signing: (() async -> AsrSignOutcome)?
    private var capture: AudioCapture?
    /// 活连接：音频正在进的那一条。
    private var session: AsrSession?
    private var loop: Task<Void, Never>?
    private var finalizeWaiter: CheckedContinuation<Void, Never>?
    private var startedAt = Date()
    /// 一次启动的代号。
    ///
    /// `begin()` 要跨三个 await（权限、签名、起引擎），这中间用户随时可能松手取消、
    /// 再按一次，或者来电把采集打断。那些都只把界面收回去是不够的 —— 启动已经离开
    /// 起点，回来时手里会多一个开着的麦克风，音频还在一路推到云端。
    ///
    /// 所以「谁有资格继续」只由这一个数说了算：请求启动时领一个号，**任何结束这种
    /// 启动的动作也要把号推进一格**（`invalidateStart()`），回来的那一趟比对不上就
    /// 自己收摊，一行状态都不许动。
    private var generation = 0

    /// 作废所有还在起飞路上的启动，并返回一个新号给接下来那一次用。
    ///
    /// 号在**这里**推进、而不是在 `begin()` 开头推进，是为了让「先取消、后执行」也
    /// 成立：`start()` 排的那个任务还没轮到跑的时候用户就松了手，如果号是 `begin()`
    /// 自己发的，它醒来后发的号永远是最新的，那道守卫就白设了。
    @discardableResult
    private func invalidateStart() -> Int {
        generation += 1
        return generation
    }

    // MARK: - 轮换

    /// 历次接棒冻结下来的文本，累积着。它在活连接的前面，位置一旦定下就不再动。
    private var seams = AsrSeamAccumulator()
    /// 正在收尾的旧连接：`end` 已经发出去了，等它把最后一句定稿回来。
    private var drain: AsrSession?
    private var drainTimer: Task<Void, Never>?
    /// 预热好的连接：握完手在那儿等着，活连接一撞上停顿就由它接手。
    private var warm: AsrSession?
    /// 暖连接是否已经握手完成。没握完手就接棒，第一包会被丢掉、年龄也会多算。
    private var warmReady = false
    private var warming = false
    private var warmRetryAfter = Date.distantPast
    private var warmBackoff: TimeInterval = 1
    /// 每条连接的代号。回调是建连接时闭包捕获的，改不了接线，只能让它认不出自己。
    private var liveToken = 0
    private var drainToken = 0
    private var warmToken = 0
    private var nextToken = 0
    /// 活连接是否已经握手完成。`connectedAt` 在它之前是上一次录音留下的，不能拿来
    /// 算年龄。
    private var liveReady = false
    /// 活连接就绪的时刻。引擎从这一刻起收音频，它那 60 秒的额度也从这里算。
    private var connectedAt = Date()

    // MARK: - 入口

    /// 点麦克风。要签名这件事由调用方给出，控制器不认识 `SynapseAppModel`。
    func start(signing: @escaping () async -> AsrSignOutcome) {
        guard phase == .idle else { return }
        self.signing = signing
        let token = invalidateStart()
        Task { await begin(token: token) }
    }

    /// 失败之后再来一次。
    ///
    /// 换一条新签名，也就是换一个新的 voiceId —— 每次连接都要新的，中断后旧的一律
    /// 作废。
    func retry() {
        guard case .failed = phase else { return }
        let token = invalidateStart()
        Task { await begin(token: token) }
    }

    /// 用户取消：丢弃全部文本，含已定稿部分。
    func cancel() {
        invalidateStart()
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
        // 这一轮到此为止，所以还在起飞路上的那次启动也到此为止：它已经没有采集可
        // 收尾（`capture` 还是 nil），再往下走只会在收尾之后把麦克风打开，用户会看
        // 到自己刚说完的话被一段新的录音盖掉。
        invalidateStart()
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
        // 点「完成」正好赶在接棒那一下，接缝还没定稿：等它定下来再交，否则交出去的是
        // 引擎马上要改写的版本 —— 实测差的就是接缝处最后半个词。
        if let drainTimer { await drainTimer.value }
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

    private func begin(token: Int) async {
        // 号对不上，就是这次启动在排队的时候已经被取消了。在动任何状态**之前**退出去：
        // 晚到的启动不只是白开一次麦克风，它还会把 `phase` 改回「正在听」、把已经定稿
        // 的文本清掉 —— 用户看到的是刚说完的那句话被一段新录音顶掉。
        guard token == generation else { return }
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
        guard token == generation else { return }

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
        guard token == generation else { return }

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
        guard token == generation else {
            capture.stop()
            return
        }
        self.capture = capture

        nextToken += 1
        liveToken = nextToken
        let session = AsrSession(url: signed.url, events: events(for: liveToken))
        session.connect()
        self.session = session
        liveReady = false
        connectedAt = Date()
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

        // 一拍只取一次，取完立刻决定这一包去哪条连接：分两次取就等于把中间的 200ms
        // 音频切丢了。
        let chunk = capture.pcm.takeChunk(AsrSession.chunkBytes)
        let age = Date().timeIntervalSince(connectedAt)

        if let warm, warmReady,
           AsrRenewal.shouldHandOver(rms: AsrRenewal.rms(ofChunk: chunk), connectionAge: age) {
            handOver(to: warm, chunk: chunk)
        } else {
            session.send(chunk)
            // 接棒得有人接。连接还没握手完时 `connectedAt` 还是上一次录音留下的，
            // 那时候算出来的年龄没有意义 —— 不挡这一下，第一次录音就会立刻去预热。
            if warm == nil, liveReady, AsrRenewal.shouldStartWarming(connectionAge: age) {
                startWarming()
            }
        }

        // 录音不因为没人声而停：引擎那边还在收包，用户接着说就能接上，所以这里只是
        // 把提示摆出来，送包照旧。
        if phase == .listening, transcript.isEmpty, now >= Self.silenceHint {
            phase = .failed(.noSpeech)
        }
    }

    // MARK: - 接棒

    /// 一条连接的回调。代号在建连接时定下 —— `Events` 是不可变字段，接棒之后改不了
    /// 旧连接的接线，只能让它认不出自己该不该说话。
    private func events(for token: Int) -> AsrSession.Events {
        AsrSession.Events(
            onOpen: { [weak self] in self?.handleOpen(token: token) },
            onTranscript: { [weak self] text in
                self?.handleTranscript(text, token: token)
            },
            onFailure: { [weak self] failure in
                self?.handleSocketFailure(failure, token: token)
            },
            onFinished: { [weak self] in self?.handleFinished(token: token) }
        )
    }

    private func handleOpen(token: Int) {
        // 引擎收音频是从握手完成那一刻开始的，年龄也从这里算。
        if token == liveToken {
            liveReady = true
            connectedAt = Date()
        } else if token == warmToken {
            warmReady = true
            AppLog.voice.info("asr warm connection ready")
        }
    }

    /// 只有活连接在写转写。换下去的那一条还在往回吐定稿，但它那一段已经冻结在接缝
    /// 里了，再让它写一次就是跟接缝打架。
    private func handleTranscript(_ text: AsrTranscript, token: Int) {
        guard token == liveToken else { return }
        publish(AsrRenewal.merge(seam: seams.seam, live: text))
    }

    private func handleFinished(token: Int) {
        if token == drainToken {
            settleSeam()
        } else if token == liveToken {
            releaseFinalizeWaiter()
        }
    }

    /// 转写是整体赋值的。接棒期间它一刻都不能空 —— 一空界面就退回占位、确定键置灰，
    /// 三秒之后还会误报「没有听到声音」。
    private func publish(_ text: AsrTranscript) {
        transcript = text
        // 声音来了，刚才那句「没有听到声音」就不成立了。
        if phase == .failed(.noSpeech) { phase = .listening }
    }

    /// 预热一条新连接。它只握手，不出声 —— 引擎的 60 秒额度数的是**收到的音频**，
    /// 这会儿喂它静音等于提前把新额度烧掉。
    ///
    /// 等它是就绪了就摆在那儿，活连接一撞上停顿就接手；这条路要在 46~50 秒这个窗口
    /// 里走完，所以窗口本身就是它能被闲置的上限（4 秒），不会撞上引擎「两包间隔超过
    /// 6 秒就断开」那条。
    private func startWarming() {
        guard !warming, warm == nil, Date() >= warmRetryAfter, let signing else { return }
        warming = true
        nextToken += 1
        warmToken = nextToken
        let token = warmToken

        Task { [weak self] in
            guard let self else { return }
            switch await signing() {
            case .signed(let signed):
                // 签名的这段时间里用户可能已经收尾了，或者又按了一次。
                guard self.warming, token == self.warmToken else { return }
                let session = AsrSession(url: signed.url, events: self.events(for: token))
                session.connect()
                self.warm = session
            case .notConfigured:
                self.warmUpFailed("not configured", token: token)
            case .unreachable:
                self.warmUpFailed("unreachable", token: token)
            }
        }
    }

    /// 预热失败不是用户的事：他要的那条连接还活着，接着说不受影响，这里只是等下一拍
    /// 再试。隔一拍就重试会把签名接口打满，所以退一步再撞。
    private func warmUpFailed(_ reason: String, token: Int) {
        guard token == warmToken else { return }
        AppLog.voice.warning("asr warm-up signing failed: \(reason, privacy: .public)")
        dropWarm()
    }

    /// 接棒。全同步，一拍之内做完 —— 中间一旦 await，这一拍的音频就没人接。
    private func handOver(to next: AsrSession, chunk: Data) {
        let age = Date().timeIntervalSince(connectedAt)
        let retiring = session
        drain = retiring
        drainToken = liveToken
        // 旧连接此刻的文本接在已有接缝后面。它还没定稿（引擎收完 `end` 才会重写最后
        // 一句），所以只能算暂定 —— 但位置从这一刻起就定死了。
        let retiringText = retiring?.transcript.finalText ?? ""
        seams.freeze(retiringText)

        retiring?.finish()
        // 等定稿用的是自己的定时器。`finalizeWaiter` 是单槽的，拿它等接缝，用户这时
        // 点「完成」就会把第一个 continuation 顶掉 —— 那一个永远不会被 resume。
        let token = drainToken
        drainTimer = Task { [weak self] in
            try? await Task.sleep(for: Self.settleTimeout)
            guard let self, self.drainToken == token else { return }
            self.settleSeam()
        }

        session = next
        liveToken = warmToken
        liveReady = true
        connectedAt = Date()
        warm = nil
        warmToken = 0
        warmReady = false
        warming = false
        warmBackoff = 1
        warmRetryAfter = .distantPast

        // 先按接缝发布一次。屏幕上那一段原来就在未定稿那一半（引擎要跑满一分钟才吐
        // 第一个定稿），所以这一步换的是连接，不是画面。
        publish(AsrRenewal.merge(seam: seams.seam, live: next.transcript))
        next.send(chunk)

        // 年龄贴着 46~47 秒是撞上停顿换的，靠近 50 秒是一直没停、到硬顶才换的 ——
        // 线上判断接缝干不干净就看这个数。
        AppLog.voice.info(
            "asr handover frozen=\(retiringText.count, privacy: .public) chars age=\(age, privacy: .public)"
        )
    }

    /// 接缝定稿：拿引擎改写后的那一份**换掉**暂定的那一份。
    ///
    /// `final: 1` 先到就用它；超时或者连接先断，就是手上有什么算什么 —— 到点了还
    /// 挂着不定稿，屏幕上那段字会一直是灰的。
    private func settleSeam() {
        guard let current = seams.seam, current.provisional, let retiring = drain else { return }
        drainToken = 0
        drain = nil
        drainTimer?.cancel()
        drainTimer = nil
        retiring.close()

        // 这次改写只覆盖刚换下去的那一条连接，前面几段原样留着 —— 那是更早的连接说
        // 过的话，引擎从来没听过。
        seams.settle(to: retiring.transcript.finalText)
        if let session { publish(AsrRenewal.merge(seam: seams.seam, live: session.transcript)) }
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
    private func handleSocketFailure(_ failure: AsrSession.Failure, token: Int) {
        // 预热那条出事不是用户的事：他要的那条还活着，接着说照旧。换下去收尾的那条
        // 也一样 —— 它断开是接棒的正常结局，报出来就会变成 46 秒突然弹「网络已断开」。
        guard token == liveToken else {
            if token == warmToken {
                AppLog.voice.warning("asr warm connection failed: \(String(describing: failure), privacy: .public)")
                dropWarm()
            }
            return
        }
        guard phase.isListening else { return }
        AppLog.voice.warning("asr session failed: \(String(describing: failure), privacy: .public)")
        dropWarm()
        loop?.cancel()
        loop = nil
        phase = .failed(.network)
    }

    /// 放掉预热的那条，隔一会儿再试一次。
    ///
    /// 失败多半是网络，隔一拍就重试会在 46~50 秒这个窗口里把签名接口打满。
    private func dropWarm() {
        clearWarm()
        warmRetryAfter = Date().addingTimeInterval(warmBackoff)
        warmBackoff = min(warmBackoff * 2, 4)
    }

    /// 不留重试窗口地放掉（收尾和取消时用）。
    private func clearWarm() {
        warm?.close()
        warm = nil
        warmReady = false
        warmToken = 0
        warming = false
    }

    private func handleInterruption() {
        // 只打断还在录的那一段。收尾的那 1.2 秒里麦克风已经关了、连接也已经在关，
        // 这时候把用户刚说完的话丢掉才是真的损失。
        guard phase.isListening else { return }
        // 打断同样要作废还在起飞路上的启动。`onInterrupted` 是在 `self.capture` 收下
        // 之前就挂上的，所以这一次打断完全可能落在启动还没跑完的时候 —— 不作废，它
        // 醒来照样把那个刚被打断的麦克风收进来。
        invalidateStart()
        loop?.cancel()
        loop = nil
        teardown()
        // 来电和切后台不是用户的取消：已经定稿的文本留着。
        phase = .interrupted
    }

    /// 只放资源，不动 `phase` 和 `transcript` —— 文本该留还是该丢，调用方比这里清楚。
    private func teardown() {
        releaseFinalizeWaiter()
        // 换连接留下的东西一并清掉：接缝和还在收尾的那条不再有归属，定稿也不该在
        // 用户已经拿走文本之后再回来改它。
        drainTimer?.cancel()
        drainTimer = nil
        drain?.close()
        drain = nil
        drainToken = 0
        clearWarm()
        warmBackoff = 1
        warmRetryAfter = .distantPast
        seams.reset()
        liveReady = false
        capture?.stop()
        capture = nil
        session?.close()
        session = nil
    }
}
