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
        }
    }

    /// The next step, for the empty state. Nil when there is nothing for this user to
    /// do — there is no empty state to explain while the connection is fine.
    var guidance: String? {
        switch self {
        case .online: return nil
        case .noServer: return "请检查这台手机的网络。"
        case .noComputer: return "请在电脑上打开 Synapse 并登录。"
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
    }

    /// Asks the cloud for a fresh snapshot. Sent on every reconnect because the
    /// app cannot know what changed while it was suspended.
    func requestSync(desktopClientInstanceId: String) {
        sendIntent(
            MobileIntentRequest(intentId: UUID().uuidString, kind: "sync"),
            desktopClientInstanceId: desktopClientInstanceId
        )
    }

    @discardableResult
    func sendIntent(_ intent: MobileIntentRequest, desktopClientInstanceId: String) -> String {
        guard let task, state.isConnected else { return intent.intentId }
        let envelope = OutboundEnvelope.make(
            LiveMessageType.mobileIntent,
            MobileIntentPayloadOut(
                desktopClientInstanceId: desktopClientInstanceId,
                mobileClientInstanceId: clientInstanceId,
                intent: intent
            )
        )
        guard let data = try? JSONEncoder().encode(envelope),
              let text = String(data: data, encoding: .utf8) else {
            return intent.intentId
        }
        task.send(.string(text)) { _ in }
        return intent.intentId
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
                    self.scheduleReconnect()
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
        socket.resume()

        sendHello(on: socket)
        startHeartbeat(on: socket, generation: current)
        receiveLoop = Task { [weak self] in
            await self?.receive(on: socket, generation: current)
        }
    }

    private func sendHello(on socket: URLSessionWebSocketTask) {
        let envelope = OutboundEnvelope.make(
            LiveMessageType.hello,
            HelloPayload(
                clientInstanceId: clientInstanceId,
                appVersion: appVersion,
                platform: "ios",
                deviceName: deviceName
            )
        )
        guard let data = try? JSONEncoder().encode(envelope),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    private func startHeartbeat(on socket: URLSessionWebSocketTask, generation current: Int) {
        heartbeatLoop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(AppConfiguration.heartbeatInterval * 1_000_000_000))
                if Task.isCancelled { return }
                guard let self, self.generation == current else { return }
                let envelope = OutboundEnvelope.make(
                    LiveMessageType.ping,
                    PingPayload(sentAt: ISO8601DateFormatter().string(from: Date()))
                )
                guard let data = try? JSONEncoder().encode(envelope),
                      let text = String(data: data, encoding: .utf8) else { continue }
                socket.send(.string(text)) { _ in }
            }
        }
    }

    private func receive(on socket: URLSessionWebSocketTask, generation current: Int) async {
        while !Task.isCancelled {
            do {
                let message = try await socket.receive()
                guard generation == current else { return }
                handle(message)
            } catch {
                guard generation == current else { return }
                reportFailure(of: socket, error: error)
                scheduleReconnect()
                return
            }
        }
    }

    /// Discarding this error used to leave "等待网络" as the only evidence that
    /// anything was wrong, and the two causes behind it need opposite reactions:
    /// a rejected handshake is a credential problem, a dropped socket is a network
    /// one. The HTTP status is what tells them apart, so it is worth having.
    private func reportFailure(of socket: URLSessionWebSocketTask, error: Error) {
        let status = (socket.response as? HTTPURLResponse).map { String($0.statusCode) } ?? "none"
        AppLog.realtime.warning(
            "live socket failed: \(error.localizedDescription, privacy: .public) (http=\(status, privacy: .public))"
        )
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let raw): data = raw
        @unknown default: return
        }
        guard let envelope = try? JSONDecoder().decode(LiveEnvelope.self, from: data) else { return }

        switch envelope.type {
        case LiveMessageType.welcome:
            reconnectAttempt = 0
            state = .connected
            onConnected?()
        case LiveMessageType.pong, LiveMessageType.mobileFrame,
             LiveMessageType.mobileSummary, LiveMessageType.mobileIntentResult,
             LiveMessageType.mobileTransferProgress,
             LiveMessageType.mobileDetached, LiveMessageType.mobilePresence:
            // Any server traffic proves the connection is healthy.
            if !state.isConnected { state = .connected }
            dispatch(envelope)
        default:
            break
        }
    }

    private func dispatch(_ envelope: LiveEnvelope) {
        switch envelope.type {
        case LiveMessageType.mobileSummary:
            if let payload = envelope.payload.decode(MobileSummaryPayload.self) {
                onSummary?(payload)
            }
        case LiveMessageType.mobileFrame:
            if let payload = envelope.payload.decode(MobileFramePayload.self) {
                onFrame?(payload)
            }
        case LiveMessageType.mobileIntentResult:
            if let payload = envelope.payload.decode(MobileIntentResultPayload.self) {
                onIntentResult?(payload.result)
            }
        case LiveMessageType.mobileTransferProgress:
            if let payload = envelope.payload.decode(MobileTransferProgressPayload.self) {
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
            if let payload = envelope.payload.decode(MobilePresencePayload.self) {
                onPresence?(payload.desktopClientInstanceIds)
            }
        default:
            break
        }
    }

    private func scheduleReconnect() {
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
