import Foundation
import Observation
import UIKit

/// Root application state.
///
/// Owns the three things that outlive any screen: the credentials, the live
/// connection, and the terminal views. Everything else is derived.
@MainActor
@Observable
final class SynapseAppModel {
    enum AuthState: Equatable {
        case restoring
        case signedOut
        case signedIn
    }

    private(set) var authState: AuthState = .restoring
    private(set) var email: String?
    private(set) var onlineDesktops: [String] = []
    private(set) var selectedDesktopClientInstanceId: String?
    private(set) var summary: MobileSummaryPayload?
    private(set) var connectionState: RealtimeState = .idle
    private(set) var terminalStores: [String: TerminalStore] = [:]
    /// Sessions where the desktop's own user typed and took the write lease back.
    /// The phone does not ask about this — the next write reclaims it.
    private var preemptedSessions: Set<String> = []
    var banner: String?

    private let tokens = TokenStore()
    private var apiClient: APIClient!
    private var realtime: RealtimeClient!
    private var keepAliveTask: Task<Void, Never>?
    private var pendingIntentResults: [String: (MobileIntentResult) -> Void] = [:]

    /// A write the desktop has not answered yet.
    ///
    /// The whole intent is kept, not just the session it belongs to: a rejected
    /// result carries no session id, so this is how a rejection is traced back to
    /// its session *and* replayed once the lease is back.
    private struct PendingWrite {
        let sessionId: String
        let intent: MobileIntentRequest
        /// Set on the replay itself, so a write is never replayed twice.
        let replayed: Bool
    }

    private var pendingWrites: [String: PendingWrite] = [:]
    /// Terminals the UI currently has open. Re-attached after every reconnect,
    /// because an attach sent before the socket is ready is dropped.
    private var openSessions: Set<String> = []
    /// History requests in flight, so a lost reply cannot wedge the loader.
    private var pendingHistory: [String: String] = [:]

    var clientInstanceId: String { tokens.clientInstanceId }

    init() {
        apiClient = APIClient(tokens: tokens) { [weak self] in
            Task { @MainActor in await self?.handleCredentialsChanged() }
        }
        realtime = RealtimeClient(
            clientInstanceId: tokens.clientInstanceId,
            deviceName: UIDevice.current.name,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0",
            tokenProvider: { [weak apiClient] in
                await apiClient?.liveTokenOutcome() ?? .unauthenticated
            }
        )
        wireRealtime()
    }

    // MARK: - Lifecycle

    func bootstrap() async {
        email = tokens.accountEmail
        switch await apiClient.restoreSession() {
        case .restored:
            authState = .signedIn
            await startLiveSession()
        case .noCredentials:
            authState = .signedOut
        case .unreachable:
            // The credential is intact and only the server was unreachable. Showing
            // the login screen here would tell the user their account is gone when
            // it is not — and retyping a password would not have helped. Staying
            // signed in also lets the connection recover on its own: the socket
            // reconnects, and the next refresh succeeds once the server is back.
            authState = .signedIn
            await startLiveSession()
            banner = "连不上服务器，正在重试。"
        }
    }

    func signIn(email address: String, password: String) async {
        do {
            try await apiClient.login(email: address, password: password)
            email = address
            authState = .signedIn
            await startLiveSession()
        } catch let error as APIError {
            banner = error.message
        } catch {
            banner = "登录失败，请稍后重试。"
        }
    }

    func signOut() async {
        keepAliveTask?.cancel()
        realtime.disconnect(reason: .unauthenticated)
        terminalStores.removeAll()
        preemptedSessions.removeAll()
        pendingWrites.removeAll()
        openSessions.removeAll()
        pendingHistory.removeAll()
        summary = nil
        selectedDesktopClientInstanceId = nil
        await apiClient.logout()
        authState = .signedOut
    }

    /// Called by the scene phase. iOS suspends the process in the background and
    /// drops the socket regardless, so the app closes it deliberately and
    /// reconnects with a fresh snapshot on the way back.
    func handleScenePhase(_ isActive: Bool) {
        guard authState == .signedIn else { return }
        if isActive {
            // The sync and the re-attach both happen in onConnected, once the
            // socket can actually carry them.
            realtime.connect()
        } else {
            realtime.disconnect()
        }
    }

    private func startLiveSession() async {
        await refreshDesktops()
        realtime.connect()
        #if targetEnvironment(simulator)
        // The simulator cannot obtain a real APNs token; registration is a no-op
        // there and the in-app inbox is the whole surface.
        #else
        await PushRegistrar.shared.requestAuthorizationAndRegister { [weak self] token in
            guard let self else { return }
            Task { await self.registerPushToken(token) }
        }
        #endif
    }

    private func handleCredentialsChanged() async {
        if await !apiClient.hasStoredCredentials, authState == .signedIn {
            Task { await signOut() }
        }
    }

    private func wireRealtime() {
        realtime.onSummary = { [weak self] payload in
            guard let self else { return }
            // A summary is per desktop; only adopt the one being viewed.
            if self.selectedDesktopClientInstanceId == nil {
                self.selectedDesktopClientInstanceId = payload.desktopClientInstanceId
            }
            guard payload.desktopClientInstanceId == self.selectedDesktopClientInstanceId else { return }
            self.summary = payload
            self.pruneTerminalStores(keeping: Set(payload.sessions.map(\.id)))
        }
        realtime.onFrame = { [weak self] payload in
            guard let self else { return }
            guard payload.desktopClientInstanceId == self.selectedDesktopClientInstanceId else { return }
            self.store(for: payload.frame.sessionId).apply(payload.frame)
        }
        realtime.onIntentResult = { [weak self] result in
            guard let self else { return }
            if let sessionId = self.pendingHistory.removeValue(forKey: result.intentId) {
                self.store(for: sessionId).endHistoryLoad()
            }
            self.pendingIntentResults.removeValue(forKey: result.intentId)?(result)

            // `lease_preempted` is the desktop confirming the command did not run,
            // which is the only rejection this client is allowed to replay.
            if result.code == "lease_preempted",
               let write = self.pendingWrites.removeValue(forKey: result.intentId) {
                self.preemptedSessions.insert(write.sessionId)
                if write.replayed {
                    // The one replay already happened and was refused too. Staying
                    // quiet here would be dropping the user's input for real.
                    self.banner = result.message ?? "命令没有发送，请重试。"
                } else {
                    Task { await self.replay(write) }
                }
                return
            }

            self.pendingWrites.removeValue(forKey: result.intentId)
            if !result.isAccepted, !result.isNoOp, result.code != "no_result" {
                self.banner = result.message ?? "操作没有完成。"
            }
        }
        realtime.onDesktopDetached = { [weak self] _ in
            self?.banner = "电脑已断开连接。"
        }
        realtime.onPresence = { [weak self] clientInstanceIds in
            self?.applyPresence(clientInstanceIds)
        }
        realtime.onConnected = { [weak self] in
            guard let self else { return }
            guard let desktop = self.selectedDesktopClientInstanceId else {
                // Nothing is selected because nothing was online when this app
                // started. The connection is the only news we have, so the list
                // has to be fetched here rather than skipped.
                Task { await self.refreshDesktops() }
                return
            }
            self.realtime.requestSync(desktopClientInstanceId: desktop)
            // Re-attach everything the user still has open. Without this a terminal
            // entered from a notification stays blank until it is opened by hand.
            for sessionId in self.openSessions {
                self.send(
                    MobileIntentRequest(intentId: UUID().uuidString, kind: "attach", sessionId: sessionId),
                    to: desktop
                )
            }
            // A claim on a terminal's grid does not survive the break — the desktop
            // drops it when the phone goes — so any terminal whose size this phone
            // was deciding has to say so again, or the mode quietly stops applying.
            self.reassertGridClaims()
        }
    }

    // MARK: - Desktops

    /// Adopts the pushed list of reachable computers.
    ///
    /// The list is the whole truth, so a computer that dropped out disappears
    /// here rather than lingering until something else triggers a refresh. The
    /// server only sends this when the list actually changes, so there is no
    /// further filtering to do.
    private func applyPresence(_ clientInstanceIds: [String]) {
        onlineDesktops = clientInstanceIds
        let selectedIsReachable = selectedDesktopClientInstanceId
            .map(clientInstanceIds.contains) ?? false
        if selectedIsReachable { return }

        // Either nothing was selected because nothing was online yet — the phone
        // was opened before the computer was — or the computer being viewed just
        // went away. Both are answered the same way: resolve again from scratch.
        summary = nil
        selectedDesktopClientInstanceId = nil
        Task { await refreshDesktops() }
    }

    func refreshDesktops() async {
        do {
            onlineDesktops = try await apiClient.onlineDesktops()
            if selectedDesktopClientInstanceId == nil
                || !(selectedDesktopClientInstanceId.map(onlineDesktops.contains) ?? false) {
                selectedDesktopClientInstanceId = onlineDesktops.first
            }
            if let desktop = selectedDesktopClientInstanceId {
                // Show the last known list immediately rather than an empty screen.
                if summary == nil {
                    summary = try? await apiClient.cachedSummary(desktopClientInstanceId: desktop)
                }
                realtime.requestSync(desktopClientInstanceId: desktop)
            }
        } catch {
            banner = "无法获取电脑列表。"
        }
    }

    func selectDesktop(_ clientInstanceId: String) {
        guard clientInstanceId != selectedDesktopClientInstanceId else { return }
        selectedDesktopClientInstanceId = clientInstanceId
        // The previous list belongs to another machine; showing it against this
        // one would be worse than showing nothing for a moment.
        summary = nil
        Task { await refreshDesktops() }
    }

    // MARK: - Sessions

    var sessions: [MobileSummarySession] {
        summary?.sessions ?? []
    }

    func sessions(inGroup groupId: String) -> [MobileSummarySession] {
        sessions.filter { $0.groupId == groupId }
    }

    /// The tabs of a group that hold a split. Empty for a desktop that sends no
    /// `workspaces`, which covers both an older one and one with no splits at all.
    func splitTabs(inGroup groupId: String) -> [MobileSummaryWorkspace] {
        (summary?.workspaces ?? []).filter { $0.groupId == groupId }
    }

    var waitingSessions: [MobileSummarySession] {
        sessions.filter { $0.attention.isWaiting }
    }

    func groupName(_ groupId: String) -> String {
        summary?.groups.first { $0.id == groupId }?.name ?? "会话"
    }

    func store(for sessionId: String) -> TerminalStore {
        if let existing = terminalStores[sessionId] { return existing }
        let created = TerminalStore()
        terminalStores[sessionId] = created
        return created
    }

    func session(_ sessionId: String) -> MobileSummarySession? {
        sessions.first { $0.id == sessionId }
    }

    private func pruneTerminalStores(keeping live: Set<String>) {
        for key in terminalStores.keys where !live.contains(key) {
            terminalStores.removeValue(forKey: key)
            preemptedSessions.remove(key)
        }
    }

    // MARK: - Terminal actions

    func openTerminal(_ sessionId: String) {
        openSessions.insert(sessionId)
        startKeepAlive()
        guard let desktop = selectedDesktopClientInstanceId else { return }
        // Idempotent on the desktop, so re-opening is safe; if the socket is not up
        // yet the re-attach on connect covers it.
        send(MobileIntentRequest(intentId: UUID().uuidString, kind: "attach", sessionId: sessionId),
             to: desktop)
    }

    /// Fetches one page of scrollback below what the terminal already shows.
    ///
    /// Reading, not writing, so it never touches the write lease.
    func requestHistory(_ sessionId: String) {
        guard let desktop = selectedDesktopClientInstanceId else { return }
        let store = store(for: sessionId)
        guard !store.isLoadingHistory, !store.reachedHistoryFloor else { return }

        let intent = MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "history",
            sessionId: sessionId,
            before: store.oldestIndex,
            limit: 200
        )
        store.beginHistoryLoad()
        pendingHistory[intent.intentId] = sessionId
        send(intent, to: desktop)

        // A reply can be lost with the connection; without this the spinner
        // would never clear and the user could not page any further.
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard let self, let stuck = self.pendingHistory.removeValue(forKey: intent.intentId) else { return }
            self.store(for: stuck).endHistoryLoad()
        }
    }

    func closeTerminal(_ sessionId: String) {
        guard let desktop = selectedDesktopClientInstanceId else { return }
        send(MobileIntentRequest(intentId: UUID().uuidString, kind: "detach", sessionId: sessionId),
             to: desktop)
        openSessions.remove(sessionId)
        preemptedSessions.remove(sessionId)
        stopKeepAliveIfIdle()
    }

    /// Takes the write lease back from the desktop, which is the only thing the
    /// unlock intent still means.
    ///
    /// Resolves once the desktop has answered, because the write that follows it
    /// is rejected if the lease has not actually changed hands yet — the gateway
    /// executes intents concurrently, so sending both without waiting would race.
    private func reclaimControl(_ sessionId: String) async {
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else { return }
        let result = await awaitResult(
            of: MobileIntentRequest(intentId: UUID().uuidString, kind: "unlock", sessionId: sessionId),
            sentTo: desktop,
            timeoutSeconds: 5
        )
        // Cleared only on confirmation, so a reclaim that never landed is retried
        // by the next write rather than silently losing that write too.
        if result?.isAccepted == true { preemptedSessions.remove(sessionId) }
    }

    func sendCommand(_ sessionId: String, text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        Task {
            await write(MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "command",
                sessionId: sessionId,
                text: text
            ), to: sessionId)
        }
    }

    func sendKey(_ sessionId: String, _ key: MobileKey) {
        Task {
            await write(MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "keys",
                sessionId: sessionId,
                actions: [.key(key)]
            ), to: sessionId)
        }
    }

    /// The takeover the user never asks for: a terminal the desktop has taken back
    /// is reclaimed on the way to the write, so typing here just works.
    private func write(_ intent: MobileIntentRequest, to sessionId: String) async {
        if preemptedSessions.contains(sessionId) {
            await reclaimControl(sessionId)
        }
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else { return }
        pendingWrites[intent.intentId] = PendingWrite(
            sessionId: sessionId,
            intent: intent,
            replayed: false
        )
        send(intent, to: desktop)
    }

    /// Sends a refused write again, after taking the lease back.
    ///
    /// This is the only replay in the client, and it is deliberately narrow:
    ///
    /// - It is reached from exactly one place, `lease_preempted`, because that code
    ///   is the desktop confirming the command did **not** run. Replaying it
    ///   therefore cannot execute anything twice.
    /// - Timeouts, dropped connections and `no_result` are never replayed. In those
    ///   cases the command may already have run, and what the user typed could be
    ///   `rm`.
    /// - At most one replay per write. A second refusal is reported to the user,
    ///   never retried again.
    ///
    /// Interrupting someone mid-keystroke is worth one silent retry; it is not
    /// worth turning into a loop.
    private func replay(_ write: PendingWrite) async {
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else {
            banner = "电脑离线，命令没有发送。"
            return
        }
        await reclaimControl(write.sessionId)
        guard !preemptedSessions.contains(write.sessionId) else {
            banner = "电脑正在使用这个终端，命令没有发送。"
            return
        }
        // The gateway answers a repeated intentId from its cache, which would hand
        // back the rejection rather than running the command, so replay as a new
        // intent. `replayed` marks it so this one can never be replayed again.
        var resent = write.intent
        resent.intentId = UUID().uuidString
        pendingWrites[resent.intentId] = PendingWrite(
            sessionId: write.sessionId,
            intent: resent,
            replayed: true
        )
        send(resent, to: desktop)
    }

    func stop(_ sessionId: String) {
        guard let desktop = selectedDesktopClientInstanceId else { return }
        send(MobileIntentRequest(intentId: UUID().uuidString, kind: "stop", sessionId: sessionId),
             to: desktop)
    }

    /// Removes a terminal. The desktop stops it first when it is still running,
    /// because a live session cannot be deleted; the row disappears once the
    /// session is gone from the next summary.
    func delete(_ sessionId: String) {
        guard let desktop = selectedDesktopClientInstanceId else { return }
        send(MobileIntentRequest(intentId: UUID().uuidString, kind: "delete", sessionId: sessionId),
             to: desktop)
    }

    func rename(_ sessionId: String, to title: String) {
        guard let desktop = selectedDesktopClientInstanceId, !title.isEmpty else { return }
        send(MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "rename",
            sessionId: sessionId,
            title: title
        ), to: desktop)
    }

    /// Creates a terminal and returns its id once the desktop reports it, so the
    /// caller can navigate straight to a live session.
    func createSession(groupId: String, title: String? = nil) async -> String? {
        await performReturningSession(
            MobileIntentRequest(intentId: UUID().uuidString, kind: "create", title: title, groupId: groupId)
        )
    }

    func launchCommand(groupId: String, commandId: String) async -> String? {
        await performReturningSession(
            MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "launchCommand",
                groupId: groupId,
                commandId: commandId
            )
        )
    }

    // MARK: - Grid size

    /// The grid the phone last asked the desktop to adopt, so a repeat is not sent.
    private var requestedGrid: [String: DesktopGrid] = [:]
    private var gridSizeTasks: [String: Task<Void, Never>] = [:]

    /// Tells the desktop to adopt the phone's grid, for the display mode where the
    /// phone drives the size so its own rendering is exact rather than wrapped.
    ///
    /// Debounced: the pane's measured size settles over several layout passes after
    /// a rotation, and each one is a candidate grid. Sending them all would resize
    /// the PTY repeatedly while the user is still turning the phone, and a
    /// full-screen program redraws for every one.
    ///
    /// Nothing is awaited. The reply carries no dimensions, so the phone keeps
    /// rendering what it measured and corrects from the next summary.
    func setGridSize(_ grid: DesktopGrid, for sessionId: String, deviceLabel: String) {
        guard grid.columns > 0, grid.rows > 0 else { return }
        guard requestedGrid[sessionId] != grid else { return }

        gridSizeTasks[sessionId]?.cancel()
        gridSizeTasks[sessionId] = Task { [weak self] in
            try? await Task.sleep(
                nanoseconds: UInt64(AppConfiguration.terminalGridDebounce * 1_000_000_000)
            )
            guard !Task.isCancelled, let self,
                  let desktop = self.selectedDesktopClientInstanceId,
                  self.realtime.state.isConnected
            else { return }

            self.requestedGrid[sessionId] = grid
            self.send(
                MobileIntentRequest(
                    intentId: UUID().uuidString,
                    kind: "resize",
                    sessionId: sessionId,
                    cols: grid.columns,
                    rows: grid.rows,
                    deviceLabel: deviceLabel
                ),
                to: desktop
            )
        }
    }

    /// Stops deciding a session's grid and lets the desktop's own layout take over.
    ///
    /// The phone cannot restore the desktop's size by itself: everything it was ever
    /// told is the size the PTY currently has, which is the phone's. So it gives up
    /// the claim and the desktop re-fits.
    func releaseGrid(for sessionId: String) {
        gridSizeTasks[sessionId]?.cancel()
        gridSizeTasks[sessionId] = nil

        // Nothing was claimed, so there is nothing to give back. This is also what
        // keeps a phone that was never in the mode from sending a release at all.
        guard requestedGrid.removeValue(forKey: sessionId) != nil else { return }
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else { return }

        send(
            MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "releaseGrid",
                sessionId: sessionId
            ),
            to: desktop
        )
    }

    /// Says it again after a reconnect.
    ///
    /// The desktop releases a phone's claim when it disconnects, so a claim made
    /// before the break does not survive it and the mode would silently stop being
    /// in effect. Re-sending is the whole recovery: there is nothing to reconcile,
    /// because the size the phone wants has not changed.
    func reassertGridClaims() {
        let claims = requestedGrid
        guard !claims.isEmpty else { return }
        requestedGrid.removeAll()
        gridSizeTasks.values.forEach { $0.cancel() }
        gridSizeTasks.removeAll()

        let label = UIDevice.current.name
        for (sessionId, grid) in claims {
            setGridSize(grid, for: sessionId, deviceLabel: label)
        }
    }

    private func performReturningSession(_ intent: MobileIntentRequest) async -> String? {
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else {
            banner = "电脑离线。"
            return nil
        }
        guard let result = await awaitResult(of: intent, sentTo: desktop, timeoutSeconds: 10) else {
            return nil
        }
        return result.isAccepted ? result.createdSessionId : nil
    }

    /// Sends one intent and waits for the desktop's answer, or resolves nil if the
    /// reply never arrives. Used wherever the next step depends on what it decided.
    private func awaitResult(
        of intent: MobileIntentRequest,
        sentTo desktopClientInstanceId: String,
        timeoutSeconds: Double
    ) async -> MobileIntentResult? {
        await withCheckedContinuation { continuation in
            var resumed = false
            pendingIntentResults[intent.intentId] = { result in
                guard !resumed else { return }
                resumed = true
                continuation.resume(returning: result)
            }
            send(intent, to: desktopClientInstanceId)
            // The desktop answers in milliseconds; this only guards a lost reply.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                guard let self, !resumed else { return }
                self.pendingIntentResults.removeValue(forKey: intent.intentId)
                resumed = true
                continuation.resume(returning: nil)
            }
        }
    }

    private func send(_ intent: MobileIntentRequest, to desktopClientInstanceId: String) {
        realtime.sendIntent(intent, desktopClientInstanceId: desktopClientInstanceId)
    }

    // MARK: - Keepalive

    /// The desktop holds a write lease for as long as a terminal is open, and has
    /// no other way to tell a phone that is merely idle from one that died.
    private func startKeepAlive() {
        guard keepAliveTask == nil else { return }
        keepAliveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(AppConfiguration.terminalKeepAliveInterval * 1_000_000_000))
                if Task.isCancelled { return }
                guard let self, let desktop = self.selectedDesktopClientInstanceId else { return }
                guard self.realtime.state.isConnected else { continue }
                self.send(MobileIntentRequest(intentId: UUID().uuidString, kind: "ping"), to: desktop)
            }
        }
    }

    private func stopKeepAliveIfIdle() {
        if openSessions.isEmpty {
            keepAliveTask?.cancel()
            keepAliveTask = nil
        }
    }

    // MARK: - Push

    func registerPushToken(_ token: String) async {
        do {
            try await apiClient.registerPushToken(
                token,
                deviceName: UIDevice.current.name,
                appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0"
            )
        } catch {
            // Not fatal: the in-app inbox still works without notifications.
        }
    }

    func summaryConnectivityLabel() -> String {
        if onlineDesktops.isEmpty { return "电脑离线" }
        return realtime.state.label
    }
}
