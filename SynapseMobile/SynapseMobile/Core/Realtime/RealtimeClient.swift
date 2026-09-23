import Foundation
import Observation
import os

enum RealtimeState: Equatable {
    case idle
    case connecting
    case connected
    case waiting(String)
    case unauthenticated

    var isConnected: Bool { self == .connected }

    /// The socket is down and the client is retrying on its own. The one state whose
    /// *end* nothing on screen marks.
    var isWaiting: Bool {
        if case .waiting = self { return true }
        return false
    }

    var label: String {
        switch self {
        case .idle: return "未连接"
        case .connecting: return "连接中"
        case .connected: return "已连接"
        // The reason was carried on the case from the start and never read, so a phone
        // waiting on its network and a phone waiting on its credential both said
        // "等待网络". Which one it is decides what the user should go and check.
        case .waiting(let reason): return reason.isEmpty ? "等待网络" : reason
        case .unauthenticated: return "需要登录"
        }
    }
}

/// What stands between this phone and a terminal, when something does.
///
/// One value rather than a sentence, because the session list and the terminal both
/// have to say the same thing about the same situation, and two places working it out
/// separately is how they drift apart.
enum Connectivity: Equatable {
    /// The socket is up and at least one computer is signed in.
    case online
    /// The socket is down, so nothing about any computer is knowable from here. Carries
    /// the socket's own words, which tell waiting-on-a-network apart from
    /// waiting-on-a-credential.
    case noServer(String)
    /// The socket is up and no computer is online.
    case noComputer
    /// The socket is up, this phone is on a computer, that computer is not among the
    /// ones online — and at least one other computer is.
    ///
    /// Its own answer rather than a shade of `noComputer`, for the reason those three
    /// are separate at all: the next step differs. `noComputer` tells the reader to go
    /// and turn a computer on; this one tells them the computer they are looking at is
    /// not there, and that the way on is the switch on the row they are already
    /// reading. A computer that is remembered but offline while *nothing* is online
    /// stays `noComputer`: there the reader is being sent to a machine either way.
    case viewedComputerOffline

    /// The one line to show beside the computer's name, and under the terminal's title
    /// when no terminal is open.
    ///
    /// These two used to be the same sentence. A phone that could not reach the server
    /// at all said "电脑离线" — the computer was fine, the list was simply empty because
    /// it had never been fetched — and sent the user to go and look at a computer that
    /// was already running.
    var label: String {
        switch self {
        case .online: return "已连接"
        case .noServer(let reason): return reason
        case .noComputer: return "电脑不在线"
        case .viewedComputerOffline: return "这台电脑不在线"
        }
    }

    /// The next step, for the empty state. Nil when there is nothing for this user to
    /// do — there is no empty state to explain while the connection is fine.
    var guidance: String? {
        switch self {
        case .online: return nil
        case .noServer: return "请检查这台手机的网络。"
        case .noComputer: return "请在电脑上打开 Synapse 并登录。"
        case .viewedComputerOffline: return "点上面那台电脑的名字，可以换到其它电脑。"
        }
    }
}

/// The phone's live connection to the cloud relay.
///
/// Deliberately not a background citizen: iOS suspends the process and drops the
/// socket regardless of what this does, so the app closes it on the way to the
/// background and reconnects with a fresh `sync` on the way back. Keeping a
/// connection "alive" across suspension would only burn battery while producing
/// a stream of gaps anyway.
@MainActor
@Observable
final class RealtimeClient {
    private(set) var state: RealtimeState = .idle

    /// Callbacks are set by the session store, which owns the visible state.
    var onSummary: ((MobileSummaryPayload) -> Void)?
    var onFrame: ((MobileFramePayload) -> Void)?
    var onIntentResult: ((MobileIntentResult) -> Void)?
    /// The computer has begun fetching a file this phone relayed, or moved on with
    /// it. Arrives repeatedly between the intent and its answer, and means nothing
    /// once that answer is here.
    var onTransferProgress: ((MobileTransferProgressPayload) -> Void)?
    /// The user's reachable computers changed. Pushed, so the list stays right
    /// without the phone asking on a schedule.
    var onPresence: (([String]) -> Void)?
    var onNotificationChanged: (() -> Void)?
    /// A computer's terminal buttons. A full snapshot, so it replaces what is held.
    var onToolbar: ((MobileToolbarPayload) -> Void)?
    var onQuickPhrases: ((MobileQuickPhrasesPayload) -> Void)?
    /// A computer's recently copied text. A snapshot, but **not** one that replaces what
    /// is held — the local list is longer than the computer's by design, so whoever
    /// receives this merges it. See `ClipboardHistoryStore`.
    var onClipboard: ((MobileClipboardPayload) -> Void)?
    /// The Git state of the directory one of this phone's terminals is sitting in.
    ///
    /// 点对点，像 `onFrame` 与 `onTransferProgress`：它答的是「你正开着的那个终端」，
    /// 所以载荷里就带着 `sessionId`，手机端按它归档。
    var onGitStatus: ((MobileGitStatusPayload) -> Void)?
    /// Fires when the handshake completes, including after every reconnect.
    /// Anything that must be re-established per connection belongs here: a send
    /// issued before this point is dropped, not queued.
    var onConnected: (() -> Void)?

    /// One session for every socket this client opens.
    ///
    /// A `URLSession` keeps itself and its delegate alive until it is invalidated,
    /// so building a new one per reconnect — and never invalidating it — leaks one
    /// per attempt. On a network that keeps dropping that is a session every few
    /// seconds, for the life of the process.
    private let session = URLSession(configuration: .default)
    private let tokenProvider: @Sendable () async -> APIClient.LiveTokenOutcome
    private let clientInstanceId: String
    private let deviceName: String
    private let appVersion: String

    private var task: URLSessionWebSocketTask?
    private var receiveLoop: Task<Void, Never>?
    private var heartbeatLoop: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var shouldStayConnected = false
    private var generation = 0
    /// 最近一次收到任何服务端流量的时刻。
    ///
    /// 心跳只发不收，而半开连接上 `receive()` 不会报错 —— 对面发的 close 帧到一个
    /// 网络路径已经没了的手机上，什么都不会发生。判据只能是「最近有没有收到东西」，
    /// 见 `AppConfiguration.connectionSilenceTimeout`。
    private var lastServerTrafficAt = Date.distantPast

    init(
        clientInstanceId: String,
        deviceName: String,
        appVersion: String,
        tokenProvider: @escaping @Sendable () async -> APIClient.LiveTokenOutcome
    ) {
        self.clientInstanceId = clientInstanceId
        self.deviceName = deviceName
        self.appVersion = appVersion
        self.tokenProvider = tokenProvider
    }

    func connect() {
        shouldStayConnected = true
        guard task == nil else { return }
        openSocket()
    }

    /// Leaves the socket down until `connect()` is called again. Used when the
    /// app backgrounds and when the account logs out.
    func disconnect(reason: RealtimeState = .idle) {
        shouldStayConnected = false
        teardown()
        state = reason
        DiagnosticLog.record(.disconnect, [
            .init(.reason, .flag(reason == .unauthenticated ? .rejected : .disconnected)),
            .init(.attempt, .int(reconnectAttempt)),
        ])
    }

    /// Asks the cloud for a fresh snapshot. Sent on every reconnect because the
    /// app cannot know what changed while it was suspended.
    ///
    /// Returns the intent id so the caller can decide what, if anything, to say about
    /// the answer — this request is the app's own, not the reader's.
    func requestSync(desktopClientInstanceId: String) -> String {
        sendIntent(
            MobileIntentRequest(intentId: UUID().uuidString, kind: "sync"),
            desktopClientInstanceId: desktopClientInstanceId
        )
    }

    @discardableResult
    func sendIntent(_ intent: MobileIntentRequest, desktopClientInstanceId: String) -> String {
        guard let task, state.isConnected else { return intent.intentId }
        guard let text = LiveWire.text(
            LiveMessageType.mobileIntent,
            MobileIntentPayloadOut(
                desktopClientInstanceId: desktopClientInstanceId,
                mobileClientInstanceId: clientInstanceId,
                intent: intent
            )
        ) else {
            return intent.intentId
        }
        send(text, kind: .intent, on: task)
        return intent.intentId
    }

    /// 所有出站信封的唯一出口。
    ///
    /// 三个 `socket.send` 收在这里而不是在 `LiveWire`（那在 `Core/Protocol`，是协议的
    /// 编码层）上埋点 —— 诊断不该被引进一个只管编解码的地方。这里拿得到的是
    /// **序列化之后的字节数**，那正是要量的东西。
    private func send(_ text: String, kind: DiagnosticFlag, on socket: URLSessionWebSocketTask) {
        DiagnosticLog.record(.send, [
            .init(.kind, .flag(kind)),
            .init(.bytes, .int(text.utf8.count)),
        ])
        socket.send(.string(text)) { _ in }
    }

    // MARK: - Socket lifecycle

    private func openSocket() {
        generation += 1
        let current = generation
        state = .connecting

        Task { [weak self] in
            guard let self else { return }
            switch await self.tokenProvider() {
            case .token(let token):
                await MainActor.run {
                    guard self.generation == current else { return }
                    self.startSocket(token: token, generation: current)
                }
            case .unreachable:
                // Only the path to the server is missing — the account is still
                // signed in and the token is still on disk. Staying in the reconnect
                // loop is the whole difference between "retrying" and "signed out";
                // stopping here is what used to leave the app reporting an offline
                // computer until it was relaunched by hand.
                await MainActor.run {
                    guard self.generation == current else { return }
                    // 到不了服务端，不是凭据的问题 —— 这条路径上账号还是登着的。
                    self.scheduleReconnect(reason: .unavailable)
                }
            case .unauthenticated:
                await MainActor.run {
                    guard self.generation == current else { return }
                    self.shouldStayConnected = false
                    self.state = .unauthenticated
                }
            }
        }
    }

    private func startSocket(token: String, generation current: Int) {
        var request = URLRequest(url: AppConfiguration.liveMobileURL)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30

        let socket = session.webSocketTask(with: request)
        task = socket
        // 静默从这一刻算起。不清的话，上一次连接留下的旧时间戳会让刚建好的这条
        // socket 在第一次心跳时就被判成静默，然后无限重连下去。
        lastServerTrafficAt = Date()
        socket.resume()

        DiagnosticLog.record(.connect, [.init(.attempt, .int(reconnectAttempt))])
        sendHello(on: socket)
        startHeartbeat(on: socket, generation: current)
        receiveLoop = Task { [weak self] in
            await self?.receive(on: socket, generation: current)
        }
    }

    private func sendHello(on socket: URLSessionWebSocketTask) {
        guard let text = LiveWire.text(
            LiveMessageType.hello,
            HelloPayload(
                clientInstanceId: clientInstanceId,
                appVersion: appVersion,
                platform: "ios",
                deviceName: deviceName
            )
        ) else { return }
        send(text, kind: .hello, on: socket)
    }

    private func startHeartbeat(on socket: URLSessionWebSocketTask, generation current: Int) {
        heartbeatLoop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(AppConfiguration.heartbeatInterval * 1_000_000_000))
                if Task.isCancelled { return }
                guard let self, self.generation == current else { return }
                // 对面还在不在，只有「最近有没有收到东西」说得清。半开连接上
                // `receive()` 永远不报错，光靠它，这条 socket 会一直挂着「已连接」
                // 而终端内容是冻住的 —— 用户没有任何线索，只能杀进程重开。
                let silence = Date().timeIntervalSince(self.lastServerTrafficAt)
                if silence > AppConfiguration.connectionSilenceTimeout {
                    AppLog.realtime.warning(
                        "live socket went quiet for \(Int(silence), privacy: .public)s, reconnecting."
                    )
                    self.scheduleReconnect(reason: .timeout)
                    return
                }
                guard let text = LiveWire.text(
                    LiveMessageType.ping,
                    PingPayload(sentAt: ISO8601DateFormatter.wire.string(from: Date()))
                ) else { continue }
                send(text, kind: .ping, on: socket)
            }
        }
    }

    private func receive(on socket: URLSessionWebSocketTask, generation current: Int) async {
        while !Task.isCancelled {
            do {
                let message = try await socket.receive()
                guard generation == current else { return }
                // 收到了东西就是活着 —— 哪怕下面解不出来。这是那条静默看门狗唯一的
                // 输入，放在解码之前，免得协议漂移被读成断线。
                lastServerTrafficAt = Date()
                handle(message)
            } catch {
                guard generation == current else { return }
                let status = reportFailure(of: socket, error: error)
                scheduleReconnect(reason: .failed, status: status)
                return
            }
        }
    }

    /// Discarding this error used to leave "等待网络" as the only evidence that
    /// anything was wrong, and the two causes behind it need opposite reactions:
    /// a rejected handshake is a credential problem, a dropped socket is a network
    /// one. The HTTP status is what tells them apart, so it is worth having.
    @discardableResult
    private func reportFailure(of socket: URLSessionWebSocketTask, error: Error) -> Int? {
        let code = (socket.response as? HTTPURLResponse)?.statusCode
        AppLog.realtime.warning(
            "live socket failed: \(error.localizedDescription, privacy: .public) (http=\(code.map(String.init) ?? "none", privacy: .public))"
        )
        // 也交给下面那条 `net.reconnectScheduled` 带上：一条故障只留一条记录，
        // 而不是"失败了"和"准备重连"各占一条、读的人还要自己对起来。
        return code
    }

    /// Marks the link up, and — when that ends an outage rather than opening the
    /// session's first socket — says so.
    ///
    /// `waiting` is the one state whose end nothing on screen marks: the socket
    /// dropped, the app is retrying by itself, and every screen goes on saying what it
    /// was saying before. Coming back from the background does not pass through it —
    /// that path is `idle` → `connecting` — so a phone put down and picked up again
    /// does not buzz each time. Neither does the first connect of a launch, for the
    /// same reason.
    private func markConnected() {
        let wasRecovering = state.isWaiting
        state = .connected
        // 一次连接成功本身没什么可看的，可它把「断了多久、试了几次才回来」钉住了 ——
        // 那正是「终端忽然不动了」要回答的问题。
        DiagnosticLog.record(.connected, [
            .init(.attempt, .int(reconnectAttempt)),
            .init(.kind, .flag(wasRecovering ? .reconnecting : .connected)),
        ])
        if wasRecovering { Haptics.success() }
    }

    /// 服务端会发、这个客户端也处理得了的消息。
    ///
    /// 单独列出来是为了把「对面还活着」这件事限定在它们身上：认不出的 type 既不该
    /// 被派发，也不该被当成连接健康的证据。
    private static let knownMessageTypes: Set<String> = [
        LiveMessageType.pong,
        LiveMessageType.mobileFrame,
        LiveMessageType.mobileSummary,
        LiveMessageType.mobileIntentResult,
        LiveMessageType.mobileTransferProgress,
        LiveMessageType.mobileDetached,
        LiveMessageType.mobilePresence,
        LiveMessageType.mobileToolbar,
        LiveMessageType.mobileQuickPhrases,
        LiveMessageType.mobileClipboard,
        LiveMessageType.mobileGitStatus,
        LiveMessageType.notificationChanged,
    ]

    /// 复用同一个解码器：每条下行消息都要解一次，而帧在终端持续输出时每秒到好几次。
    private static let decoder = JSONDecoder()

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let raw): data = raw
        @unknown default: return
        }
        guard let header = try? Self.decoder.decode(LiveEnvelopeType.self, from: data) else { return }

        if header.type == LiveMessageType.welcome {
            reconnectAttempt = 0
            markConnected()
            onConnected?()
            return
        }
        guard Self.knownMessageTypes.contains(header.type) else { return }
        // Any server traffic proves the connection is healthy.
        if !state.isConnected { markConnected() }

        switch header.type {
        case LiveMessageType.mobileSummary:
            if let payload = payload(MobileSummaryPayload.self, from: data) {
                onSummary?(payload)
            }
        case LiveMessageType.mobileFrame:
            if let payload = payload(MobileFramePayload.self, from: data) {
                // 每一帧一条：这是回答"电脑到底发了什么、发了多少"的唯一入口。
                // 频率靠缓冲的采样表压（4/s），不在这里判断。
                let frame = payload.frame
                DiagnosticLog.record(.frame, [
                    .init(.session, DiagnosticLog.alias(.session, frame.sessionId)),
                    .init(.kind, .flag(.frameKind(frame.kind))),
                    .init(.from, .int(frame.from)),
                    .init(.rowCount, .int(frame.lines.count)),
                    .init(.bytes, .int(data.count)),
                    .init(.truncated, .bool(frame.truncated)),
                ])
                onFrame?(payload)
            }
        case LiveMessageType.mobileIntentResult:
            if let payload = payload(MobileIntentResultPayload.self, from: data) {
                onIntentResult?(payload.result)
            }
        case LiveMessageType.mobileTransferProgress:
            if let payload = payload(MobileTransferProgressPayload.self, from: data) {
                onTransferProgress?(payload)
            }
        // `mobile.detached` is deliberately not handled. The server sends it to
        // *desktops* when a phone's socket closes — "only the desktops know which
        // terminals that phone had open and therefore which write leases to release"
        // — and there is no path back to a phone. This client decoded it and dispatched
        // it for a long time without it ever firing once; the handler it fed claimed to
        // report a computer dropping and could not.
        // See server/src/mobile-live/mobile-live-relay.service.ts:249.
        case LiveMessageType.mobilePresence:
            if let payload = payload(MobilePresencePayload.self, from: data) {
                onPresence?(payload.desktopClientInstanceIds)
            }
        case LiveMessageType.mobileToolbar:
            if let payload = payload(MobileToolbarPayload.self, from: data) {
                onToolbar?(payload)
            }
        case LiveMessageType.mobileQuickPhrases:
            if let payload = payload(MobileQuickPhrasesPayload.self, from: data) {
                onQuickPhrases?(payload)
            }
        case LiveMessageType.mobileClipboard:
            if let payload = payload(MobileClipboardPayload.self, from: data) {
                onClipboard?(payload)
            }
        case LiveMessageType.mobileGitStatus:
            if let payload = payload(MobileGitStatusPayload.self, from: data) {
                onGitStatus?(payload)
            }
        case LiveMessageType.notificationChanged:
            onNotificationChanged?()
        default:
            // `live.pong`：没有要派发的载荷，它作证的那件事上面已经做了。
            break
        }
    }

    /// 按已经读出来的 `type` 解具体载荷 —— 一次解析，不经中间那棵树。
    private func payload<T: Decodable>(_ type: T.Type, from data: Data) -> T? {
        (try? Self.decoder.decode(PayloadEnvelope<T>.self, from: data))?.payload
    }

    /// - Parameter reason: 这一次为什么重连。**分开记才有用** —— 凭据被拒、对面不发
    ///   东西了、连接自己失败了，在屏幕上都是同一句「等待网络」，而要查的方向完全不同。
    private func scheduleReconnect(
        reason: DiagnosticFlag = .unknownCause,
        status: Int? = nil
    ) {
        teardown(keepIntent: true)
        guard shouldStayConnected else {
            state = .idle
            return
        }
        reconnectAttempt += 1
        // Mirrors the desktop policy: exponential with a 30s cap and jitter, so a
        // server restart does not bring every device back at the same instant.
        let base = min(2.0 * pow(2.0, Double(max(0, reconnectAttempt - 1))), 30.0)
        let delay = base + Double.random(in: 0...(base * 0.3))
        state = .waiting("网络中断，正在重连")

        var fields: [DiagnosticEntry] = [
            .init(.attempt, .int(reconnectAttempt)),
            .init(.delayMs, .durationMs(Int(delay * 1_000))),
            .init(.reason, .flag(reason)),
        ]
        if let status { fields.append(.init(.status, .int(status))) }
        DiagnosticLog.record(.reconnectScheduled, fields)

        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard let self, self.shouldStayConnected else { return }
            await MainActor.run { self.openSocket() }
        }
    }

    private func teardown(keepIntent: Bool = false) {
        if !keepIntent { shouldStayConnected = false }
        generation += 1
        receiveLoop?.cancel()
        heartbeatLoop?.cancel()
        receiveLoop = nil
        heartbeatLoop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }
}
