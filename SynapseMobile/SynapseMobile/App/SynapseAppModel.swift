import Foundation
import Observation
import UIKit
import os

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
    private(set) var onlineDesktops: [ReachableDesktop] = []
    /// The computer being viewed. Never changes without the reader asking — see
    /// `ViewedDesktopPreference`.
    private(set) var selectedDesktopClientInstanceId: String?
    private(set) var summary: MobileSummaryPayload?
    private let terminalWidgetPublisher = TerminalWidgetPublisher()
    private var widgetHasLiveSummary = false
    var hasLiveTerminalSummary: Bool { widgetHasLiveSummary && realtime.state.isConnected }
    private(set) var terminalStores: [String: TerminalStore] = [:]
    /// The buttons the last `mobile.toolbar` carried, and which computer sent them.
    /// See `TerminalToolbarState` for why one slot is enough.
    private var toolbar = TerminalToolbarState()
    /// 分组里配了哪些启动命令，和是哪台电脑说的。见 `TerminalGroupCommandState`。
    private var groupCommandState = TerminalGroupCommandState()
    /// The sentences the last `mobile.quickPhrases` carried, and which computer sent
    /// them. See `TerminalQuickPhrasesState` for why "none" and "never heard of it"
    /// have to stay apart.
    private var quickPhrases = TerminalQuickPhrasesState()
    /// The text recently copied on each of the user's computers.
    ///
    /// Unlike the two slots above this is one list per computer rather than one value
    /// with an owner, and unlike them it is written to disk. Both differences have the
    /// same cause: the reader has to be able to open this panel with no computer
    /// reachable at all. See `ClipboardHistoryStore`.
    private let clipboard = ClipboardHistoryStore()
    /// 终端当前目录的 Git 状态，按终端记。见 `TerminalGitStatusState` —— 它守的是
    /// 「不是仓库」与「还没收到回答」这条线。
    private var gitStatus = TerminalGitStatusState()
    /// Sessions where the desktop's own user typed and took the write lease back.
    /// The phone does not ask about this — the next write reclaims it.
    private var preemptedSessions: Set<String> = []
    private(set) var notices = NoticeQueue()

    /// One countdown per visible notice.
    ///
    /// Kept out of the observation graph deliberately: nothing draws a clock, and making
    /// it observable would invalidate every view that reads `notices` each time one is
    /// armed or stopped.
    @ObservationIgnored private var noticeTimers: [String: NoticeTimer] = [:]

    /// The old single slot, kept so the call sites that predate the queue keep compiling
    /// while each gains a tone on its own schedule.
    ///
    /// A setter cannot know a tone, and `.failure` is the honest default: it is what
    /// nearly all of those sites report, and it is the weight the amber banner already
    /// carried. Reading it back gives the newest message, which is the most any caller
    /// ever asked of it.
    var banner: String? {
        get { notices.notices.last?.text }
        set {
            guard let newValue else {
                noticeTimers.values.forEach { $0.task?.cancel() }
                noticeTimers.removeAll()
                notices.removeAll()
                return
            }
            notice(newValue, tone: .failure)
        }
    }

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

    /// Attach intents in flight, by intent id, naming the terminal each is about.
    ///
    /// An attach has no write to be attributed by — nothing was typed into it — but
    /// it does have a terminal it was about, and that is where a refusal belongs.
    /// Without this the answer to "this terminal is gone" had nowhere to land but the
    /// bottom of whatever screen the reader happened to be on.
    private var pendingAttachments: [String: String] = [:]

    /// Results nothing is waiting for, because the request was the app talking to
    /// itself rather than the reader asking for something.
    ///
    /// The sync sent on every connect and the resize that re-asserts a grid claim are
    /// bookkeeping: no reader action is pending on either, and no part of the screen
    /// has "this request failed" as its subject — the list and the device row describe
    /// the state that follows. Reporting them made opening the app look like a random
    /// error. They are logged instead.
    ///
    /// A list rather than a set because a result can be lost with the connection, and
    /// an id that never gets an answer must not live for the life of the app.
    private var quietIntents: [String] = []
    private static let maxQuietIntents = 16

    /// History requests in flight, so a lost reply cannot wedge the loader.
    private var pendingHistory: [String: String] = [:]

    // MARK: - Notices

    /// A countdown, and what is left of it when a finger interrupts.
    private struct NoticeTimer {
        var task: Task<Void, Never>?
        /// When the task fires. Holding the deadline rather than a running countdown is
        /// what lets a drag stop the clock and keep the remainder.
        var deadline: ContinuousClock.Instant
        var remaining: Duration
        /// The revision this clock was armed for, so a re-post of the same id is
        /// recognised as a new clock rather than as the old one still counting.
        var revision: Int
    }

    /// Posts a message to the bottom of the screen.
    ///
    /// `id` names the message rather than the event: posting an id that is already up
    /// replaces its text and restarts its clock instead of stacking a duplicate, which is
    /// what a reconnect loop or the same rejection arriving twice actually needs. It
    /// defaults to the text, so an identical sentence never queues behind itself either.
    ///
    /// `sessionId` 只在**这条说的是某个终端**时给（见 `Notice.sessionId`）。给了这条就只
    /// 画在那个终端（以及没有归属的地方）上；同一个 id 落在两个会话上会互相顶掉，所以
    /// 带会话的消息要把它编进 id。
    func notice(
        _ text: String,
        tone: NoticeTone = .info,
        id: String? = nil,
        sessionId: String? = nil
    ) {
        let key = id ?? "text:\(text)"
        for dropped in notices.post(text, tone: tone, id: key, sessionId: sessionId) {
            cancelNoticeTimer(dropped)
        }
        syncNoticeTimers()
        // The bar is where every failure in the app ends up, so this is the one place
        // that has to feel like one — a refusal that only changes a line of text is,
        // from a finger's distance, indistinguishable from the press not registering.
        //
        // Two conditions, and both are about not crying wolf. `revision == 0` means the
        // id was not already up, so a reconnect loop re-posting the same sentence
        // restarts the message without restarting the buzz. Being in `armed` means it
        // is on screen now rather than queued behind two others — a haptic that lands
        // three seconds before its message reads as belonging to whatever the user was
        // doing at the time. Only failures: a success that matters fires its own, at
        // the call site that knows what succeeded (see `Haptics`).
        if tone == .failure,
           let posted = notices.armed.first(where: { $0.id == key }),
           posted.revision == 0 {
            Haptics.failure()
        }
        // Posted from here rather than from the view: the bar is a transient overlay that
        // never takes focus, so an announcement is the only way the sentence is reached
        // at all — and doing it here means it happens once, however many screens happen
        // to be mounting a copy of the view that draws it.
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text)
        }
    }

    func dismissNotice(_ id: String) {
        cancelNoticeTimer(id)
        notices.remove(id)
        // Taking one away is what makes room for the next: a queued notice spends no time
        // on a clock, so it gets its whole duration once it is actually shown.
        syncNoticeTimers()
    }

    /// A finger is on the bar. Stop the clock, and keep what was left of it.
    func holdNotice(_ id: String) {
        guard var timer = noticeTimers[id], timer.task != nil else { return }
        timer.task?.cancel()
        timer.task = nil
        timer.remaining = max(.zero, ContinuousClock.now.duration(to: timer.deadline))
        noticeTimers[id] = timer
    }

    /// The finger left without throwing the bar away.
    func resumeNotice(_ id: String) {
        guard let timer = noticeTimers[id], timer.task == nil else { return }
        // Never with less than a moment to read: a message that vanishes the instant it
        // snaps back reads as a broken gesture rather than as a timer expiring.
        armNotice(id, duration: max(timer.remaining, .milliseconds(600)))
    }

    /// Arms whatever is visible and unarmed, stops whatever is no longer visible, and
    /// re-arms anything whose message changed underneath it. Idempotent, so every path
    /// that changes the queue can simply call it.
    private func syncNoticeTimers() {
        let visible = notices.armed
        let ids = Set(visible.map(\.id))
        for id in noticeTimers.keys where !ids.contains(id) { cancelNoticeTimer(id) }

        for notice in visible {
            // A new id needs a clock; an id whose revision moved needs a new one. Missing
            // this second case is the old banner's bug, one level down: the clock has to
            // key on the message's content, not on the id merely still being present.
            guard let timer = noticeTimers[notice.id], timer.task != nil else {
                armNotice(notice.id, duration: noticeDuration(for: notice.tone))
                continue
            }
            if timer.revision != notice.revision {
                armNotice(notice.id, duration: noticeDuration(for: notice.tone))
            }
        }
    }

    /// A one-second success is long enough to catch out of the corner of an eye and
    /// nowhere near long enough to hear, and under VoiceOver the announcement is the only
    /// way the sentence arrives at all. Kept here rather than on `NoticeTone` so that what
    /// a tone means stays a pure value a test can assert.
    private func noticeDuration(for tone: NoticeTone) -> Duration {
        if tone == .success, UIAccessibility.isVoiceOverRunning { return .seconds(5) }
        return tone.duration
    }

    private func armNotice(_ id: String, duration: Duration) {
        cancelNoticeTimer(id)
        guard let revision = notices.armed.first(where: { $0.id == id })?.revision else { return }
        noticeTimers[id] = NoticeTimer(
            task: Task { [weak self] in
                try? await Task.sleep(for: duration)
                guard !Task.isCancelled else { return }
                self?.dismissNotice(id)
            },
            deadline: ContinuousClock.now.advanced(by: duration),
            remaining: duration,
            revision: revision
        )
    }

    private func cancelNoticeTimer(_ id: String) {
        noticeTimers[id]?.task?.cancel()
        noticeTimers[id] = nil
    }

    // MARK: - Terminal messages

    /// A few at once at most. One selection can be refused file by file, and a wall of
    /// reasons stacked above the keyboard is its own problem.
    private static let maxTerminalMessages = 4

    /// What the open terminal has to say about something the user just tried.
    private(set) var terminalMessages: [TerminalMessage] = []

    /// Raises a message against one terminal.
    ///
    /// `id` names the message rather than the occurrence, so the same refusal arriving
    /// twice — a retry that fails the same way — replaces rather than stacks.
    func raiseTerminalMessage(
        _ text: String,
        sessionId: String,
        id: String? = nil,
        opensSettings: Bool = false
    ) {
        let key = id ?? "text:\(text)"
        if let index = terminalMessages.firstIndex(where: { $0.id == key }) {
            terminalMessages[index].text = text
            terminalMessages[index].opensSettings = opensSettings
            return
        }
        terminalMessages.append(
            TerminalMessage(id: key, sessionId: sessionId, text: text, opensSettings: opensSettings)
        )
        // Unlike the notice bar, every message on this list is a refusal — a command
        // the computer would not take, a microphone that would not open, a file that
        // would not read — and most of them land while the reason is behind the
        // user's own hand. The early return above means a repeat of the same refusal
        // restarts the sentence without restarting the buzz.
        Haptics.failure()
        if terminalMessages.count > Self.maxTerminalMessages {
            terminalMessages.removeFirst(terminalMessages.count - Self.maxTerminalMessages)
        }
    }

    func dismissTerminalMessage(_ id: String) {
        terminalMessages.removeAll { $0.id == id }
    }

    /// A closed terminal takes its refusals with it: they are about a session that is
    /// no longer open, and nothing on screen is left for them to belong to.
    private func clearTerminalMessages(for sessionId: String) {
        terminalMessages.removeAll { $0.sessionId == sessionId }
    }

    /// The messages that report the network go when the connection comes back: the
    /// sentence they carry stops being true, and one that outlives its own truth
    /// reads as a fresh problem rather than as the same old one.
    ///
    /// Run on every (re)connect, and from here rather than from the terminal screen,
    /// because what they report is the whole phone's state: leaving that screen must
    /// not leave one behind for the user to find on the way back.
    private func clearExpiredTerminalMessages() {
        terminalMessages.removeAll { $0.expiresWithConnectivity }
    }

    // MARK: - File hand-off

    /// Files on their way to the computer, newest last.
    ///
    /// Held here rather than per screen because the transfer outlives the screen:
    /// the user is free to leave the terminal, and a file that is still uploading
    /// or still owed to a computer that is offline has to keep its place.
    private(set) var relayAttachments: [TerminalAttachment] = []
    /// Which attachment an in-flight intent belongs to, so its result lands on the
    /// right chip.
    private var relayByIntent: [String: String] = [:]
    /// Where the bytes for a not-yet-uploaded attachment are. Cleared per file as
    /// soon as it is up, so the temporary copies the pickers made do not outlive
    /// the transfer.
    private var relayPendingFiles: [String: PickedFile] = [:]
    private var relayLedger = RelayLedger()
    private let uploader = FileUploader()
    private var relayDrainTask: Task<Void, Never>?

    var clientInstanceId: String { tokens.clientInstanceId }

    /// How the reader has asked terminals to be laid out.
    ///
    /// Owned here so a summary can move a display mode without a screen in the way.
    /// Taking the grid back on the computer reaches the phone only as a summary, and
    /// the reader may well be looking at the session list when it does — see
    /// `GridClaimLedger`.
    let display = TerminalDisplaySettings()

    /// What this phone last used to start a Claude Code conversation.
    ///
    /// Owned here because starting one is here: the values are worth remembering only
    /// once the computer has accepted them, and the model is the one place that knows
    /// both what was asked and what came back.
    let conversationDefaults = AgentConversationPreferences()

    /// 录音。
    ///
    /// 直连服务端，不经过任何一台电脑——转写发生在云端，结果也在服务端，这和手机端
    /// 既有的「电脑的远程视图」定位不同，所以它不挂在 terminalStores 那一套里。
    let meetings = MeetingStore()
    let notifications = NotificationStore()

    /// 云盘。
    ///
    /// 与录音一样直连服务端，不经过任何一台电脑；它也不是「电脑的远程视图」，所以不挂在
    /// `terminalStores` 那一套里。浏览状态、排序偏好都在 `DriveStore` 上，从 Task 6 起的
    /// 每一屏都从这里取数据。
    let drive = DriveStore()

    /// 正在录的那一条。
    ///
    /// 挂在模型上而不是录音页上，因为它比那一屏活得久：录音页收起之后它还要继续录，
    /// 顶部那枚胶囊、锁屏上的实时活动、控制中心的「完成」摸到的都得是同一个它。
    let recording = MeetingRecordingSession()

    /// 详情页语音视图里那个播放器。挂在模型上是为了让它比详情页活得久一点点：切视图、
    /// 来回点列表都不打断正在播的那一段。
    let playback = MeetingPlayback()

    /// 正在录的那一条在系统里的那一份：锁屏实时活动、灵动岛。
    let liveActivity = MeetingLiveActivityController()

    /// 录音页要不要浮出来。
    ///
    /// 放在模型上而不是列表视图里，因为进这一屏的入口不止一个：列表右上角的加号、
    /// 控制中心的控件、主屏长按图标的快捷操作、以及实时活动上按「开始」。后三个都不
    /// 经过列表，它们只能把这件事挂在这里等列表去接。
    var isRecordingPresented = false

    /// Which terminals this phone is sizing, as the summaries have last said.
    private var gridClaims = GridClaimLedger()

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

        // 实时活动、控制中心控件、主屏快捷操作、Siri 那四个入口的意图都落到这里。
        // 挂在这里而不是某个视图上：锁屏上的「完成」是在后台把 App 拉起来执行的，
        // 那一刻还没有任何界面，但模型已经在了。
        //
        // 走 `install` 而不是直接赋值：万一意图比这里先到（系统在后台拉起 App 的
        // 那一段），它会把动作攒着，挂上的一刻补做。
        RecordingIntentRouter.install { [weak self] action in
            self?.handleRecordingIntent(action)
        }
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
            terminalWidgetPublisher.clear()
        case .unreachable:
            // The credential is intact and only the server was unreachable. Showing
            // the login screen here would tell the user their account is gone when
            // it is not — and retyping a password would not have helped. Staying
            // signed in also lets the connection recover on its own: the socket
            // reconnects, and the next refresh succeeds once the server is back.
            authState = .signedIn
            await startLiveSession()
            // No notice here. The socket's own words are already on screen — the
            // device row of the session list says which kind of wait this is, and it
            // keeps saying it until the connection is back, which a five-second
            // sentence cannot do.
        }
        await resolvePendingRecordings()
    }

    /// 上次没收完的录音，现在收干净。
    ///
    /// 放在启动路径上，是因为用户不该知道发生过异常退出：没有「发现一段未完成的录音」，
    /// 没有丢弃 / 完成两个按钮，那条录音下次出现时就是一条普通录音。
    ///
    /// **只收本机还留着音频的那些**（决策七）。手机和电脑现在录的是同一批数据，而残片
    /// 只在本机——不加这一条，在电脑上打开 Synapse 就会把手机上正在录的那条强行收尾，
    /// 用一个估算的时长和一条平线。
    func resolvePendingRecordings() async {
        guard authState == .signedIn else { return }
        await recording.resolvePendingRecordings(using: apiClient)
    }

    /// Returns the message to show beside the form, or nil once the account is in.
    ///
    /// Handed back rather than pushed to the queue: a sentence about a rejected
    /// credential belongs next to the field it came from, not at the bottom of the
    /// screen. See `LoginView`.
    @discardableResult
    func signIn(email address: String, password: String) async -> String? {
        do {
            try await apiClient.login(email: address, password: password)
            email = address
            authState = .signedIn
            await startLiveSession()
            return nil
        } catch let error as APIError {
            return error.message
        } catch {
            return "登录失败，请稍后重试。"
        }
    }

    /// 提交一条问题反馈。
    ///
    /// 走 `apiClient` 而不是让视图自己拿到它：视图不该知道网络层长什么样。这一页只在
    /// 登录之后的「我的」里可达，所以那个客户端一定已经建好了。
    func submitProblemFeedback(_ content: String) async -> ProblemFeedbackOutcome {
        await apiClient.submitProblemFeedback(content: content)
    }

    func signOut() async {
        stopKeepAlive()
        realtime.disconnect(reason: .unauthenticated)
        terminalStores.removeAll()
        preemptedSessions.removeAll()
        pendingWrites.removeAll()
        openSessions.removeAll()
        pendingHistory.removeAll()
        terminalMessages.removeAll()
        summary = nil
        widgetHasLiveSummary = false
        terminalWidgetPublisher.clear()
        gridClaims = GridClaimLedger()
        selectedDesktopClientInstanceId = nil
        // The remembered computer is account-scoped like everything else here: a
        // client id belongs to one account's machine, so carrying it into the next
        // sign-in would start the next user on a computer that is not theirs.
        viewedDesktops.forget()
        // These are another account's computers' commands, and nothing here is
        // persisted, so the next sign-in starts from the fallback as it should.
        toolbar.reset()
        groupCommandState.reset()
        // 别名的坐标系是"这个人、这一份日志"。换个人接着数 `s3`，会让下一个人
        // 以为那两份日志之间有什么关系。
        DiagnosticLog.resetAliases()
        // 还停着没被消费的通知去向同理：它指的那个终端是上一个账号的，留着会让下一个
        // 人一登录就被带到别人的会话上。
        NotificationRouter.shared.discard()
        // Those are another account's computers' sentences, and nothing here persists.
        quickPhrases.reset()
        // 剪贴板与上面两样不同，它是**落盘**的：不清掉，下一个人登进来会在面板里看到
        // 上一个人复制过的正文。这是本机第一份「内容属于账号、文件留在机器上」的数据。
        clipboard.clearAll()
        // 仓库状态同理，而且它连着电脑上的目录路径：换个人登进来不该看到上一个人
        // 在哪个仓库、哪条分支上。
        gitStatus.reset()
        // 录音是另一个账号的东西，换人之后不该还留在内存里。
        meetings.clear()
        // 云盘同理，而且它连着的是一整棵目录：换个人登进来不该看到上一个人的文件夹名。
        drive.clear()
        // 正在录的那条也是。录着的时候退出登录，本机那份音频留在盘上等下次启动收尾——
        // 但那个账号已经登不上了，收尾会失败，文件也就一直躺着。
        if recording.isRecording { recording.cancel() }
        // 正在播的那一段也是。它会连着一条已经不属于这个账号的 URL 继续放。
        playback.stop()
        // 听过留在本机的那些音频同理：它们是这个账号的录音，换个人登进来不该还在盘上。
        MeetingAudioCache.shared.clearAll()
        // 这台手机上的推送归属也得一起交出去，而且要在 `logout()` 之前 —— 那一步会把凭据
        // 清掉，之后就没有身份可以说这句话了。
        //
        // device token 是按 `(userId, clientInstanceId)` 记的，而 `clientInstanceId` 跨登录
        // 不变：不说这一句，上一个账号的终端审批和转写通知会继续发给这台手机，正文里带着
        // 会话标题和最后一行输出。下一个人点开还会用他的凭据去执行，静默失败。
        do {
            try await apiClient.unregisterPushToken()
        } catch {
            AppLog.network.warning(
                "unregistering this device's push token failed: \(error.localizedDescription, privacy: .public)"
            )
        }
        await apiClient.logout()
        notifications.clear()
        authState = .signedOut
    }

    /// Called by the scene phase. iOS suspends the process in the background and
    /// drops the socket regardless, so the app closes it deliberately and
    /// reconnects with a fresh snapshot on the way back.
    /// 录音列表。转写进行中时会自己刷新到出结果为止，由调用它的视图按需重复调用。
    func reloadMeetings() async {
        await meetings.load(using: apiClient)
    }

    func reloadNotifications(filter: String = "all") async {
        await notifications.load(using: apiClient, filter: filter)
    }

    func loadMoreNotifications() async {
        await notifications.loadMore(using: apiClient)
    }

    func readNotification(_ id: String) async {
        await notifications.ensure(id, using: apiClient)
        await notifications.read(id, using: apiClient)
    }

    func readAllNotifications() async {
        await notifications.readAll(using: apiClient)
    }

    func deleteNotification(_ id: String) async {
        await notifications.delete(id, using: apiClient)
    }

    func loadMeetingDetail(_ meetingId: String) async {
        _ = await meetings.loadDetail(meetingId, using: apiClient)
    }

    func renameMeeting(_ meetingId: String, to title: String) async {
        await meetings.rename(meetingId, to: title, using: apiClient)
    }

    func deleteMeeting(_ meetingId: String) async {
        let deleted = await meetings.delete(meetingId, using: apiClient)
        // 删除不可恢复，做完了要说一声。
        if deleted { notice("已删除") }
    }

    func retryMeetingTranscription(_ meetingId: String) async {
        await meetings.retryTranscription(meetingId, using: apiClient)
    }

    /// 复制全文要的那一段文字。没有文字时返回 nil。
    func meetingTranscript(_ meetingId: String) async -> String? {
        await meetings.transcript(meetingId, using: apiClient)
    }

    /// 开始一段新录音。加号、控制中心、主屏快捷操作、Siri 都落到这里。
    func startRecording() async {
        await recording.start(using: apiClient)
        // 录音真起来了才跟：起都没起来就挂一条实时活动，锁屏上会留一条按了没反应的东西。
        guard recording.isRecording else { return }
        liveActivity.follow(recording)
    }

    /// 实时活动、控制中心、快捷操作上那几个意图的落点。
    ///
    /// 那四个入口共用同一份意图，而意图的定义必须同时编进 App 和扩展（锁屏上那个按钮
    /// 是扩展画的）。扩展里没有录音机，所以意图只把动作送到这里，由模型决定怎么做。
    func handleRecordingIntent(_ action: RecordingIntentAction) {
        switch action {
        case .start:
            guard !recording.isRecording else { return }
            // 走 `NotificationRouter` 而不是直接置标志：录音页是挂在录音 Tab 的列表上的，
            // 用户此刻可能在别的 Tab，那个视图根本没建——直接把标志置上，控制中心和
            // Siri 按下去会什么都没发生。主屏长按那条走的是同一条路。
            NotificationRouter.shared.route(to: .newRecording)
        case .finish:
            guard recording.isRecording else { return discardOrphanActivity() }
            recording.finish()
        case .cancel:
            guard recording.isRecording else { return discardOrphanActivity() }
            recording.cancel()
        }
    }

    /// 锁屏上那两个按钮按在一条已经不存在的录音上时要做的事。
    ///
    /// App 被系统杀掉过，实时活动却还留在锁屏上（系统最长留 8 小时）。这时该做的不是
    /// 「再结束一次」——`finish` / `cancel` 在没录音时本来就是空操作——而是把它收掉，
    /// 不留一个按了没反应的按钮。这条兜底原先写在意图那一侧，但那一刻还不知道有没有
    /// 录音在跑；只有这里知道。
    private func discardOrphanActivity() {
        Task { await RecordingActivityHousekeeping.endOrphans() }
    }

    /// 语音视图要的那几样：音频和波形。都是按需取的，不进列表的载荷。
    ///
    /// 详情一起带过去是因为命中判据要服务端那份 `recording.size`：本机这份音频是不是还有
    /// 效，得跟服务端对一次。
    func loadMeetingAudio(_ detail: MeetingDetail) async {
        await playback.load(meetingId: detail.id, serverSize: detail.recording.size, using: apiClient)
    }

    /// 载入态里那个「重试」：手动催一下，不取代自动恢复。
    func retryMeetingAudio() async {
        await playback.retry(using: apiClient)
    }

    // MARK: - 云盘

    /// 预览与导出要的那三条。
    ///
    /// 薄透传，理由与上面几条一样：`apiClient` 是私有的，视图拿不到网络层。它们不进
    /// `DriveStore` —— 读一段文本、下一份字节都不改浏览状态（`DriveStore` 收
    /// `using client:` 的那套是给它自己的浏览方法的）。浏览那几条透传由 Task 6 补在这一段里。

    func driveContentInspect(itemId: String) async throws -> DriveContentInspect {
        try await apiClient.driveContentInspect(itemId: itemId)
    }

    func driveContentChunk(
        itemId: String,
        versionId: String,
        cursor: String? = nil
    ) async throws -> DriveContentChunk {
        try await apiClient.driveContentChunk(itemId: itemId, versionId: versionId, cursor: cursor)
    }

    /// 下一份字节到本机。进度从别的线程推过来，接的人自己回主线程（见
    /// `DriveFileExport.run`）。
    func downloadDriveItem(
        itemId: String,
        to destination: URL,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws {
        try await apiClient.downloadDriveItem(itemId: itemId, to: destination, onProgress: onProgress)
    }

    func handleScenePhase(_ isActive: Bool) {
        guard authState == .signedIn else { return }
        if isActive {
            // The sync and the re-attach both happen in onConnected, once the
            // socket can actually carry them.
            realtime.connect()
        } else {
            // A widget tap after backgrounding must wait for the next live summary,
            // while the shared snapshot remains available until it becomes stale.
            widgetHasLiveSummary = false
            realtime.disconnect()
        }
    }

    private func startLiveSession() async {
        await refreshDesktops()
        await reloadNotifications()
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
            // Every computer's name, not just the one being viewed: the switch has to
            // be able to name the others, and a computer that has never been viewed
            // has no other way to have introduced itself.
            self.viewedDesktops.remember(
                name: payload.desktopName,
                for: payload.desktopClientInstanceId
            )
            // A summary is per desktop; only adopt the one being viewed. Nothing has
            // been chosen on a phone that has not resolved the list yet, and the first
            // computer to say something is as good an answer as that list would give.
            if self.selectedDesktopClientInstanceId == nil {
                self.selectedDesktopClientInstanceId = payload.desktopClientInstanceId
                self.viewedDesktops.view(payload.desktopClientInstanceId)
            }
            guard payload.desktopClientInstanceId == self.selectedDesktopClientInstanceId else { return }
            self.summary = payload
            self.widgetHasLiveSummary = true
            self.publishTerminalWidgetSnapshot()
            self.pruneTerminalStores(keeping: Set(payload.sessions.map(\.id)))
            self.applyGridClaims(payload.sessions)
            // Only against a list the computer actually sent: an older desktop omits
            // the block entirely, and forgetting the reader's project there would
            // punish them for something that is not theirs.
            if let groups = payload.agentGroups {
                self.conversationDefaults.prune(keepingProjectIds: Set(groups.map(\.projectId)))
            }
        }
        realtime.onFrame = { [weak self] payload in
            guard let self else { return }
            guard payload.desktopClientInstanceId == self.selectedDesktopClientInstanceId else { return }
            let frame = payload.frame
            let store = self.store(for: frame.sessionId)
            store.apply(frame)
            // 屏幕内容记在**这里**，不在 `RealtimeClient.handle`：上面那句已经滤掉了
            // 「用户在看的不是这台电脑」，记在 handle 里会把别人电脑的屏幕也写进日志。
            // 关着开关时连这些行都不会被拼出来 —— 那些行是闭包里取的。
            DiagnosticLog.captureScreen(kind: .frameKind(frame.kind), session: frame.sessionId) {
                frame.lines.map(\.text)
            }
            // 与 `net.history.request` 配对。一页空的就是电脑说"没有更早的了"，
            // 而它在屏幕上和"请求丢了"长得一模一样 —— 只有这一对能分开它们。
            if frame.isHistory {
                DiagnosticLog.record(.historyResponse, [
                    .init(.session, DiagnosticLog.alias(.session, frame.sessionId)),
                    .init(.from, .int(frame.from)),
                    .init(.historyRows, .int(frame.lines.count)),
                    .init(.atHistoryFloor, .bool(store.reachedHistoryFloor)),
                ])
            }
        }
        realtime.onIntentResult = { [weak self] result in
            guard let self else { return }
            // 记在**分流之前**：下面六条分支各自 return，挂在任何一条上都会有别的分支
            // 漏掉 —— 自己发的那几条静默意图、文件中继的回执，都会从这里溜走。
            DiagnosticLog.record(.intentResult, [
                .init(.request, DiagnosticLog.alias(.request, result.intentId)),
                .init(.outcome, .flag(Self.outcomeFlag(result))),
                .init(.reason, .message(RedactedMessage(redacting: result.code ?? ""))),
            ])
            if let sessionId = self.pendingHistory.removeValue(forKey: result.intentId) {
                self.store(for: sessionId).endHistoryLoad()
            }

            if let index = self.quietIntents.firstIndex(of: result.intentId) {
                self.quietIntents.remove(at: index)
                if !result.isAccepted, !result.isNoOp, result.code != "no_result" {
                    AppLog.network.warning("self-issued intent rejected: \(result.code ?? "unknown")")
                }
                return
            }

            // Whoever asked owns the answer, including deciding that there is nothing
            // to say about it. Falling through as well is how one refusal came back as
            // two messages — the caller's and a banner repeating it.
            if let awaiting = self.pendingIntentResults.removeValue(forKey: result.intentId) {
                awaiting(result)
                return
            }

            // A file transfer has its own idea of what a failure means — a refusal
            // because the computer is away is a wait, not an error — so it is
            // answered before the generic handling below, which would report every
            // non-accepted outcome as a banner.
            if self.relayByIntent[result.intentId] != nil {
                self.handleRelayResult(result)
                return
            }

            // `lease_preempted` is the desktop confirming the command did not run,
            // which is the only rejection this client is allowed to replay.
            if result.code == "lease_preempted",
               let write = self.pendingWrites.removeValue(forKey: result.intentId) {
                self.preemptedSessions.insert(write.sessionId)
                if write.replayed {
                    // The one replay already happened and was refused too. Staying
                    // quiet here would be dropping the user's input for real.
                    self.raiseTerminalMessage(
                        result.message ?? "命令没有发送，请重试。",
                        sessionId: write.sessionId
                    )
                } else {
                    Task { await self.replay(write) }
                }
                return
            }

            // An attach is neither a write nor an awaited call, but it still names a
            // terminal, and that is the screen the reader is looking at when it fails.
            if let sessionId = self.pendingAttachments.removeValue(forKey: result.intentId) {
                if !result.isAccepted, !result.isNoOp, result.code != "no_result" {
                    self.raiseTerminalMessage(
                        result.message ?? "这个终端打不开。",
                        sessionId: sessionId
                    )
                }
                return
            }

            let write = self.pendingWrites.removeValue(forKey: result.intentId)
            if !result.isAccepted, !result.isNoOp, result.code != "no_result" {
                // The computer writes this one, and every refusal it can name comes
                // with its own reason. The fallback says what is known here — who
                // refused — rather than inventing a cause, which is what a sentence
                // like "操作没有完成。" did.
                let message = result.message ?? "电脑拒绝了这次操作，但没有说明原因。"
                // Only a write this client can still name has a terminal to belong to.
                // Creating a session or launching a command is awaited instead of
                // queued, so its refusal arrives with nothing to attribute it to —
                // and there is no terminal on screen for it to be shown in.
                if let write {
                    self.raiseTerminalMessage(message, sessionId: write.sessionId)
                } else {
                    self.notice(message, tone: .failure)
                }
            }
        }
        realtime.onTransferProgress = { [weak self] payload in
            self?.applyTransferProgress(payload)
        }
        realtime.onPresence = { [weak self] clientInstanceIds in
            self?.applyPresence(clientInstanceIds)
        }
        realtime.onToolbar = { [weak self] payload in
            self?.toolbar.adopt(payload)
        }
        realtime.onGroupCommands = { [weak self] payload in
            self?.groupCommandState.adopt(payload)
        }
        realtime.onQuickPhrases = { [weak self] payload in
            self?.quickPhrases.adopt(payload)
        }
        // Merged rather than adopted: what arrives is the computer's twenty newest, and
        // the list kept here is longer. Assigning it would cut this one down to twenty
        // every time something was copied anywhere.
        realtime.onClipboard = { [weak self] payload in
            self?.clipboard.merge(payload)
        }
        realtime.onGitStatus = { [weak self] payload in
            self?.gitStatus.adopt(payload)
        }
        realtime.onNotificationChanged = { [weak self] in
            guard let self else { return }
            Task { await self.reloadNotifications(filter: self.notifications.filter) }
        }
        realtime.onConnected = { [weak self] in
            guard let self else { return }
            Task { await self.reloadNotifications(filter: self.notifications.filter) }
            self.clearExpiredTerminalMessages()
            // The computer may have been away for days while this phone was closed;
            // anything it never acknowledged is either obsolete by now or worth one
            // more try before it is.
            Task { await self.sweepRelayLedger() }
            self.retryWaitingAttachments()
            guard let desktop = self.selectedDesktopClientInstanceId else {
                // Nothing is selected because nothing was online when this app
                // started. The connection is the only news we have, so the list
                // has to be fetched here rather than skipped.
                Task { await self.refreshDesktops() }
                return
            }
            // Everything below is addressed to the computer being viewed, and it may
            // be one that is not there: the phone deliberately stays on a computer
            // that has gone away rather than moving itself. An `attach` sent into
            // that is not a quiet intent — it would come back as a refusal shown to
            // someone who did nothing. The list refresh above is what brings it back,
            // and presence pushes the same news.
            guard self.onlineDesktopIds.contains(desktop) else { return }
            self.requestSync(on: desktop)
            // Re-attach everything the user still has open. Without this a terminal
            // entered from a notification stays blank until it is opened by hand.
            for sessionId in self.openSessions {
                self.attach(sessionId, to: desktop)
            }
            // A claim on a terminal's grid does not survive the break — the desktop
            // drops it when the phone goes — so any terminal whose size this phone
            // was deciding has to say so again, or the mode quietly stops applying.
            self.reassertGridClaims()
        }
    }

    // MARK: - Desktops

    /// Which computer this phone is on, remembered across launches.
    private let viewedDesktops = ViewedDesktopPreference()

    var onlineDesktopIds: [String] { onlineDesktops.map(\.clientInstanceId) }

    /// The computer being viewed is one this phone cannot reach right now.
    ///
    /// Says nothing about whether there is anywhere else to go — the screen is the
    /// only thing that knows that, and it says so through `Connectivity`.
    var viewedDesktopIsOffline: Bool {
        guard let viewed = selectedDesktopClientInstanceId else { return false }
        return !onlineDesktopIds.contains(viewed)
    }

    /// What the switch offers: every reachable computer except the one being viewed.
    ///
    /// Empty means the row is not a control. Deliberately *not* "more than one is
    /// online": a phone left on a computer that has gone offline has to be able to
    /// reach the one other computer, and when there is exactly one other that row is
    /// the only way out.
    var desktopSwitchTargets: [ReachableDesktop] {
        let targets = Set(ViewedDesktopPreference.switchTargets(
            online: onlineDesktopIds,
            viewing: selectedDesktopClientInstanceId
        ))
        return onlineDesktops.filter { targets.contains($0.clientInstanceId) }
    }

    /// What to call a computer.
    ///
    /// Four sources in order of authority: the name the computer is announcing right
    /// now, the name the last fetch carried, the last name it ever gave, and finally
    /// its id — which is a poor label but a true one, and better than hiding a
    /// computer the phone simply cannot name.
    func desktopName(_ clientInstanceId: String) -> String {
        if clientInstanceId == selectedDesktopClientInstanceId, let live = summary?.desktopName {
            return live
        }
        if let listed = onlineDesktops.first(where: { $0.clientInstanceId == clientInstanceId }),
           let name = listed.deviceName {
            return name
        }
        return viewedDesktops.name(for: clientInstanceId) ?? clientInstanceId
    }

    /// Adopts the pushed list of reachable computers.
    ///
    /// The list is the whole truth about which computers are *reachable*, so one that
    /// dropped out disappears here rather than lingering until something else triggers
    /// a refresh. It is not the truth about which computer the reader is on: that only
    /// changes because they asked, so a computer going away leaves the phone where it
    /// is and the screen says why.
    private func applyPresence(_ clientInstanceIds: [String]) {
        defer { publishTerminalWidgetSnapshot() }
        let knownNames = onlineDesktops.reduce(into: [String: String]()) { names, desktop in
            if let name = desktop.deviceName { names[desktop.clientInstanceId] = name }
        }
        onlineDesktops = clientInstanceIds.map {
            ReachableDesktop(clientInstanceId: $0, deviceName: knownNames[$0])
        }
        // This payload carries ids only — it is broadcast to every phone of the
        // account and its shape is byte-budgeted. The names come from the list the
        // picker draws, which is worth one request per change of the set.
        Task { await refreshDesktopNames() }
        // A computer appearing is exactly the event the cloud refuses to wait for,
        // so it is the moment to hand over anything that was left waiting.
        retryWaitingAttachments()

        guard let viewing = selectedDesktopClientInstanceId else {
            // Nothing has been chosen yet: the phone was opened before any computer
            // was. Adopting one takes nothing away from anybody, and from here on it
            // is the reader's choice like any other.
            guard let adopted = viewedDesktops.resolve(online: clientInstanceIds) else { return }
            selectedDesktopClientInstanceId = adopted
            Task { await refreshDesktops() }
            return
        }

        if clientInstanceIds.contains(viewing) {
            // Reachable, and it may have just come back: `summary` is nil exactly
            // while it was away.
            if summary == nil { Task { await refreshDesktops() } }
            return
        }

        // The computer being viewed went away. The list it sent describes a machine
        // that is not there, so it goes; the reader does not.
        summary = nil
        widgetHasLiveSummary = false
        // A file the computer had begun fetching is not being fetched any more: it
        // died, or lost the network, partway through. It goes back to waiting rather
        // than staying in a state that claims progress that has stopped, and the
        // next time the computer is reachable the ordinary resend picks it up — from
        // the top, which is exactly the restart that case needs.
        releaseReceivingAttachments()
    }

    /// Puts anything mid-receive back to waiting.
    ///
    /// Deliberately not a resend: the computer being gone is what calls this, so
    /// there is nothing to send to yet.
    private func releaseReceivingAttachments() {
        for attachment in relayAttachments where attachment.state.isReceiving {
            update(attachment.id) { $0.state = .waitingForComputer }
        }
    }

    /// Names for the computers presence only gave ids for.
    ///
    /// Deliberately not the whole of `refreshDesktops`: that one also syncs and hands
    /// over waiting files, and a computer signing in is not news about the computer
    /// being viewed.
    private func refreshDesktopNames() async {
        guard !onlineDesktopIds.isEmpty else { return }
        guard let listed = try? await apiClient.onlineDesktops() else {
            // The ids from presence are still right; only the labels are missing, and
            // `desktopName` falls back to the id rather than to nothing.
            return
        }
        let names = listed.reduce(into: [String: String]()) { names, desktop in
            if let name = desktop.deviceName { names[desktop.clientInstanceId] = name }
        }
        // Fills in what this list can name and leaves the rest of the pushed list
        // alone. Not a replacement for it: presence is the authority on which
        // computers are reachable, and a fetch that is a moment behind it must not
        // be able to take one off the picker.
        onlineDesktops = onlineDesktops.map { desktop in
            guard desktop.deviceName == nil, let name = names[desktop.clientInstanceId] else {
                return desktop
            }
            return ReachableDesktop(clientInstanceId: desktop.clientInstanceId, deviceName: name)
        }
        for (clientInstanceId, name) in names {
            viewedDesktops.remember(name: name, for: clientInstanceId)
        }
    }

    func refreshDesktops() async {
        defer { publishTerminalWidgetSnapshot() }
        do {
            onlineDesktops = try await apiClient.onlineDesktops()
            for desktop in onlineDesktops {
                guard let name = desktop.deviceName else { continue }
                viewedDesktops.remember(name: name, for: desktop.clientInstanceId)
            }
            guard let desktop = viewedDesktops.resolve(online: onlineDesktopIds) else { return }
            selectedDesktopClientInstanceId = desktop

            // Show the last known list immediately rather than an empty screen. Only
            // when the computer is there to open those terminals: a stale list whose
            // every row leads to a terminal that cannot attach is worse than none.
            if summary == nil, onlineDesktopIds.contains(desktop) {
                summary = try? await apiClient.cachedSummary(desktopClientInstanceId: desktop)
                if let name = summary?.desktopName {
                    viewedDesktops.remember(name: name, for: desktop)
                }
            }
            guard onlineDesktopIds.contains(desktop) else { return }
            requestSync(on: desktop)
            // A computer coming back is the third way one can — the others being the
            // socket reconnecting and presence pushing a new list — and it is the only
            // one that happens when a computer returns while this phone never lost its
            // connection. Without this, a file that went back to waiting when that
            // computer dropped would sit there until something unrelated re-resolved.
            retryWaitingAttachments()
        } catch {
            // Nothing to say that the screen is not already saying: the device row
            // carries the socket's own words, and a list that has never been fetched
            // says why in its empty state. Logged because the one case the screen
            // cannot explain is a refresh failing while the socket is up.
            AppLog.network.warning("desktop list refresh failed")
        }
    }

    /// The reader picked a computer: the switch menu, or a notification.
    ///
    /// Honoured even when the computer is not reachable — a notification naming one is
    /// the reader saying which they mean, and landing them somewhere else instead is
    /// the behaviour this replaces.
    func selectDesktop(_ clientInstanceId: String) {
        guard clientInstanceId != selectedDesktopClientInstanceId else { return }
        let outgoing = selectedDesktopClientInstanceId
        if let outgoing, realtime.state.isConnected {
            // The terminals being left are the outgoing computer's, and it holds a write
            // lease on each of them for as long as it thinks this phone is watching.
            // Detaching is what hands those back.
            for sessionId in openSessions {
                detachQuietly(sessionId, from: outgoing)
            }
        }
        selectedDesktopClientInstanceId = clientInstanceId
        viewedDesktops.view(clientInstanceId)
        // The previous computer's list, terminals and in-flight work belong to it.
        summary = nil
        widgetHasLiveSummary = false
        publishTerminalWidgetSnapshot()
        releaseViewing()
        Task { await refreshDesktops() }
    }

    /// Tells a computer this phone is no longer holding its terminals.
    ///
    /// Quiet: the reader's action was "switch computer". Nothing on screen has "the
    /// detach failed" as its subject, and the screens describe the state that follows.
    /// A detach that cannot be delivered is not a problem to report either — the
    /// computer being left may already be gone, and it releases this phone's
    /// attachments on its own when the phone's socket closes.
    private func detachQuietly(_ sessionId: String, from desktopClientInstanceId: String) {
        let intent = MobileIntentRequest(intentId: UUID().uuidString, kind: "detach", sessionId: sessionId)
        rememberQuiet(intent.intentId)
        send(intent, to: desktopClientInstanceId)
    }

    /// Drops everything that only means anything to the computer being left.
    ///
    /// Session ids are the leaving computer's own; anything keyed by one and resolved
    /// against the *current* selection is a wrong-machine bug waiting for a timing
    /// window — a `pendingWrite` replayed after the switch would send the reader's
    /// command to a computer that never heard of that terminal.
    ///
    /// `terminalStores` is not touched: `pruneTerminalStores` removes whatever the new
    /// computer's summary does not list, and doing it here as well would be a second
    /// implementation of the same rule.
    private func releaseViewing() {
        openSessions.removeAll()
        pendingWrites.removeAll()
        pendingAttachments.removeAll()
        pendingHistory.removeAll()
        preemptedSessions.removeAll()
        requestedGrid.removeAll()
        gridSizeTasks.values.forEach { $0.cancel() }
        gridSizeTasks.removeAll()
        stopKeepAliveIfIdle()
        releaseReceivingAttachments()
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

    private func publishTerminalWidgetSnapshot() {
        guard authState == .signedIn, let desktopId = selectedDesktopClientInstanceId else {
            terminalWidgetPublisher.clear()
            return
        }
        let online = onlineDesktopIds.contains(desktopId)
        if !online {
            terminalWidgetPublisher.publish(TerminalWidgetSnapshot(
                capturedAt: .now,
                desktopId: desktopId,
                desktopName: desktopName(desktopId),
                isOnline: false,
                sessions: []
            ))
            return
        }
        guard widgetHasLiveSummary, let summary, summary.desktopClientInstanceId == desktopId else {
            terminalWidgetPublisher.clear()
            return
        }
        terminalWidgetPublisher.publish(TerminalWidgetSnapshot(
            capturedAt: .now,
            desktopId: desktopId,
            desktopName: summary.desktopName,
            isOnline: true,
            sessions: summary.sessions.map {
                TerminalWidgetSession(
                    id: $0.id,
                    title: $0.title,
                    status: $0.status,
                    attentionState: $0.attention.state,
                    attentionKind: $0.attention.kind,
                    cwd: $0.cwd,
                    lastLine: $0.lastLine
                )
            }
        ))
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

    /// 这个终端还开不开得开。规则全在 `TerminalOpenability` 里，这里只把那份列表递过去。
    ///
    /// `desktopClientInstanceId` 不给就是「手机正看着的那台」——列表里的行、待处理里的行
    /// 都是从那台电脑的列表上取下来的，问的就是它。给出来的是那条通知自己记着的那台。
    func terminalOpenability(
        _ sessionId: String,
        on desktopClientInstanceId: String? = nil
    ) -> TerminalOpenability {
        TerminalOpenability.resolve(
            sessionId: sessionId,
            desktopClientInstanceId: desktopClientInstanceId ?? selectedDesktopClientInstanceId,
            summary: summary
        )
    }

    /// 记下一次「打开终端」的判定。
    ///
    /// 这条记录为一个具体的坑而存在：手机上有五条路能进终端页，只有会话列表那一行是当场取
    /// 会话号的，另外四条带的都是**某一刻记下来的号**。它们的请求被拒绝时人会看到一句
    /// 「这个会话已经结束了。」，而那句话当时被画在**另一个**会话的画布上（提示条没有归属，
    /// 见 `Notice.sessionId`）。修是修好了，但「是哪条路在问」在手机上**完全没有记录** ——
    /// 排查只能靠排除法推到「不是正在看着的那个会话」，再往前就没了。
    ///
    /// 所以这里记两样：那个被点名的会话（别名）与问它的那条路。
    func recordTerminalOpen(
        _ sessionId: String,
        decision: TerminalOpenability,
        from origin: TerminalOpenOrigin
    ) {
        guard let fields = Self.terminalOpenRecordFields(
            sessionId: sessionId,
            decision: decision,
            origin: origin
        ) else { return }
        DiagnosticLog.record(.terminalLifecycle, fields)
    }

    /// 上面那条记录长什么样；`nil` 就是「不记」。
    ///
    /// 静态、纯函数：这条记录正是排查里唯一缺的那一格，它自己必须能被单测钉住，而
    /// `SynapseAppModel` 在测试里造不出来（它要网络、要存储、要一个登录的人）。
    nonisolated static func terminalOpenRecordFields(
        sessionId: String,
        decision: TerminalOpenability,
        origin: TerminalOpenOrigin
    ) -> [DiagnosticEntry]? {
        guard let outcome = decision.diagnosticFlag else { return nil }
        return [
            .init(.session, DiagnosticLog.alias(.session, sessionId)),
            .init(.outcome, .flag(outcome)),
            .init(.entry, .flag(origin.diagnosticFlag)),
        ]
    }

    /// Forgets everything about terminals the computer no longer lists.
    ///
    /// The list is the whole truth — the computer sends every session it has, not a
    /// page of them — so a terminal missing from it is gone. That has to include
    /// `openSessions`: leaving an id there meant re-attaching to a terminal the user
    /// closed on the computer every time this app reconnected, for the rest of the
    /// app's life, and each of those attaches came back as a refusal to show someone.
    private func pruneTerminalStores(keeping live: Set<String>) {
        // 先收集再删。原来的写法是在 `.keys` 视图上迭代着删 —— 视图持着字典的缓冲区，
        // 删掉第一个键就会因为非唯一引用把整份字典拷贝一遍（`openSessions` 那个 Set
        // 同理）。这条每次摘要到达都会跑。
        for key in terminalStores.keys.filter({ !live.contains($0) }) {
            terminalStores.removeValue(forKey: key)
            preemptedSessions.remove(key)
            // 那条记录连着一个已经不存在的会话，留着只占一个格子。
            gitStatus.forget(sessionId: key)
        }
        openSessions.formIntersection(live)
        // 会话级的显示模式只对签发它的那台电脑成立，而它每次改动都会整份写回
        // `UserDefaults`。不清理的话，用户开过的每一个终端都会在这里留一条，永久。
        display.prune(keeping: live)
        stopKeepAliveIfIdle()
    }

    // MARK: - Terminal actions

    func openTerminal(_ sessionId: String) {
        openSessions.insert(sessionId)
        startKeepAlive()
        guard let desktop = selectedDesktopClientInstanceId else { return }
        // Idempotent on the desktop, so re-opening is safe; if the socket is not up
        // yet the re-attach on connect covers it.
        attach(sessionId, to: desktop)
    }

    /// Asks the desktop to attach, remembering which terminal the answer is about.
    private func attach(_ sessionId: String, to desktopClientInstanceId: String) {
        let intent = MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "attach",
            sessionId: sessionId
        )
        pendingAttachments[intent.intentId] = sessionId
        send(intent, to: desktopClientInstanceId)
    }

    /// Fetches one page of scrollback below what the terminal already shows.
    ///
    /// Reading, not writing, so it never touches the write lease.
    func requestHistory(_ sessionId: String) {
        guard let desktop = selectedDesktopClientInstanceId else { return }
        let store = store(for: sessionId)
        guard !store.isLoadingHistory, !store.reachedHistoryFloor else { return }

        let before = store.oldestIndex
        let intent = MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "history",
            sessionId: sessionId,
            before: before,
            limit: 200
        )
        store.beginHistoryLoad()
        pendingHistory[intent.intentId] = sessionId
        DiagnosticLog.record(.historyRequest, [
            .init(.session, DiagnosticLog.alias(.session, sessionId)),
            .init(.historyBefore, .int(before)),
            .init(.historyLimit, .int(200)),
        ])
        send(intent, to: desktop)

        // A reply can be lost with the connection; without this the spinner
        // would never clear and the user could not page any further.
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard let self, let stuck = self.pendingHistory.removeValue(forKey: intent.intentId) else { return }
            self.store(for: stuck).endHistoryLoad()
            DiagnosticLog.record(.historyTimeout, [
                .init(.session, DiagnosticLog.alias(.session, stuck)),
                .init(.historyBefore, .int(before)),
            ])
        }
    }

    func closeTerminal(_ sessionId: String) {
        clearTerminalMessages(for: sessionId)
        // Switching computers already detached and forgot the old sessions.
        // Their views may disappear one frame later; never send that detach to the new computer.
        guard openSessions.contains(sessionId) else { return }
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

    /// Asks the computer for a signed realtime-ASR URL.
    ///
    /// The phone never sees the cloud key: the desktop signs the whole URL and this
    /// connects with it as it arrives. Voice input belongs to no terminal, so the
    /// intent carries no session id.
    ///
    /// Every call is a fresh signature and therefore a fresh voice id, which is what
    /// the engine requires per connection — a retry after an interruption must come
    /// back through here rather than reusing the last one.
    /// 向服务端要一条已签名的语音识别会话。
    ///
    /// 不经过电脑：语音识别是平台统一提供的能力，密钥在服务端，手机自己也连得上
    /// 服务端。走电脑反而多一个「电脑得在线」的前提，而那是别的事才需要的。
    func requestAsrSignature() async -> AsrSignOutcome {
        // No banner here: the caller is the voice bar, which says what went wrong in
        // place already. Two different sentences for one failure read as two.
        do {
            let ticket = try await apiClient.asrSession()
            guard let url = URL(string: ticket.url), !ticket.voiceId.isEmpty else {
                AppLog.voice.warning("asr session response was not usable.")
                return .unreachable
            }
            return .signed(AsrSignature(
                url: url,
                voiceId: ticket.voiceId,
                expiresAt: Date(timeIntervalSince1970: TimeInterval(ticket.expiredAt))
            ))
        } catch let error as APIError {
            // 平台没配腾讯云密钥是唯一一个用户改得动的原因，单独报出去；其余都归
            // 「没连上」。
            if error.code == "VOICE_ASR_NOT_CONFIGURED" { return .notConfigured }
            AppLog.voice.warning("asr session request failed: \(error.code ?? "no_code", privacy: .public)")
            return .unreachable
        } catch {
            AppLog.voice.warning("asr session request failed.")
            return .unreachable
        }
    }

    func sendKey(_ sessionId: String, _ key: MobileKey) {
        sendKeys(sessionId, [.key(key)])
    }

    /// Sends several actions as one intent.
    ///
    /// The `keys` intent has always taken an array — it is how a sequence is meant to
    /// travel — and the panel needs it for exactly one thing: an Alt chord is an
    /// Escape prefix followed by the letter, and splitting that into two intents would
    /// let the terminal echo the bare Escape in between.
    ///
    /// An empty list is refused here rather than sent: the computer's schema requires
    /// at least one action, so it would only ever come back rejected.
    func sendKeys(_ sessionId: String, _ actions: [MobileKeyAction]) {
        guard !actions.isEmpty else { return }
        Task {
            await write(MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "keys",
                sessionId: sessionId,
                actions: actions
            ), to: sessionId)
        }
    }

    // MARK: - Terminal toolbar

    /// The buttons shown under the terminal for the computer being viewed.
    ///
    /// This phone's own front row, then the commands the computer holds. Only the
    /// second half is the computer's, and it decides it completely — including by
    /// sending an empty list, which means the user has configured nothing there. The
    /// front row is drawn either way, so the bar is never empty: with no keyboard of
    /// its own, a phone with nothing to press could not answer a TUI at all.
    var activeToolbarButtons: [MobileToolbarButton] {
        toolbar.buttons(forSelected: selectedDesktopClientInstanceId)
    }

    // MARK: - 分组快捷命令

    /// 这个分组配了启动命令没有 —— 有就在分组行上画箭头，点进去先选命令。
    ///
    /// 电脑没说过、或者说得太旧（从没发过这条消息）都是 `false`：那时分组行上不画
    /// 箭头，点一下直接建终端，与这条消息存在之前完全一样。
    func hasGroupCommands(_ groupId: String) -> Bool {
        groupCommandState.hasCommands(for: groupId, onSelected: selectedDesktopClientInstanceId)
    }

    /// 一个分组配的命令，按电脑上的顺序。
    func groupCommands(for groupId: String) -> [MobileGroupCommand] {
        groupCommandState.commands(for: groupId, onSelected: selectedDesktopClientInstanceId)
    }

    /// The Git state of one terminal's directory on the computer being viewed.
    ///
    /// `nil` 是「那台电脑还没回答过」—— 它不等于「不是仓库」：后者是一个答案，会让
    /// ⋯ 菜单里的「Git」不渲染，而前者只是还没到，屏幕上的东西不该因此动一下。
    func gitStatus(for sessionId: String) -> TerminalGitStatusState.Status? {
        gitStatus.status(for: sessionId, onSelected: selectedDesktopClientInstanceId)
    }

    /// 手机端做 Git 操作时要问电脑的那两件事。
    ///
    /// 面板与它下面几页都不直接拿 `model`：它们拿的是一对闭包，这样「先提交、成功了再
    /// 切换」这类时序可以被单独验，而不必先起一个 App。见 `TerminalGitFlow`。
    var gitDesk: TerminalGitDesk {
        TerminalGitDesk(
            send: { [weak self] intent, timeout in
                guard let self else { return nil }
                return await self.runGitIntent(intent, waiting: timeout)
            },
            notice: { [weak self] text, tone, id in
                self?.notice(text, tone: tone, id: id)
            }
        )
    }

    /// 发一个 `git` intent 并等电脑的回答，等不到就是 `nil`。
    ///
    /// 它**不走 `write(_:to:)`**：那条路是为「往终端里打字」准备的 —— 要写租约、要腾出
    /// 控制权、被抢占时还会重放一次。Git 动作一件都不需要：命令在电脑后台跑，不碰 PTY，
    /// 也就没有键盘在前面等着。而且它**绝不能重放**：一次合并跑两遍不是无害的重复。
    ///
    /// 每个动作都在电脑侧自己过权限（读走 `terminal.state.read`，写走
    /// `terminal.git.manage`），审计记录说的是实话：手机让电脑改动了用户的仓库。
    private func runGitIntent(_ intent: MobileIntentRequest, waiting timeout: TimeInterval) async -> MobileIntentResult? {
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else { return nil }
        return await awaitResult(of: intent, sentTo: desktop, timeoutSeconds: timeout)
    }

    /// The 快捷输入 sentences for the computer being viewed, or `nil` for one that has
    /// never described any.
    ///
    /// `nil` is not an empty list, and the panel shows them differently: an empty list
    /// is a computer saying it has none, which the user can act on, while `nil` is a
    /// computer too old to have been asked, which is not the user's configuration
    /// missing and must not be drawn as though it were.
    var activeQuickPhrases: [MobileQuickPhrase]? {
        quickPhrases.phrases(forSelected: selectedDesktopClientInstanceId)
    }

    /// The copied text for the computer being viewed, newest first.
    ///
    /// Empty rather than `nil` when there is nothing, and that is the deliberate
    /// difference from the sentences above: a computer never answers "I have no
    /// clipboard", so there is no second meaning to keep apart. What the reader sees is
    /// their own list either way, and none of it is an ordinary empty state.
    var activeClipboardEntries: [MobileClipboardEntry] {
        clipboard.entries(for: selectedDesktopClientInstanceId)
    }

    /// Empties one computer's list, leaving the computer's own clipboard untouched.
    func clearClipboardHistory(for desktopClientInstanceId: String?) {
        guard let desktopClientInstanceId else { return }
        clipboard.clear(for: desktopClientInstanceId)
    }

    /// Puts one copied item on this phone's clipboard.
    ///
    /// One implementation for both places the list appears, for the same reason the list
    /// itself is one view: what the reader feels afterwards — the buzz and the
    /// confirmation — must not depend on which door they came in through.
    func copyClipboardEntry(_ entry: MobileClipboardEntry) {
        UIPasteboard.general.string = entry.text
        // The buzz is the call site's to send; `notice` only buzzes on its own for a
        // failure. Sending both would make one outcome fire twice.
        Haptics.success()
        // The id is what makes a second tap restart this banner instead of queueing a
        // second one, which is the whole of what the reader needs to see.
        notice("已复制", tone: .success, id: "clipboard.copied")
    }

    /// Runs one of the toolbar's buttons against a terminal.
    ///
    /// The command text is passed on untouched — no trimming, no quoting. The computer
    /// runs the command the user wrote, character for character, and a phone that
    /// tidied it up would be running a different one.
    func runToolbarButton(_ button: MobileToolbarButton, sessionId: String) {
        let intent = button.action.intent(sessionId: sessionId, intentId: UUID().uuidString)
        Task { await write(intent, to: sessionId) }
        // Only when the button submits a line: that is the moment the chip an inserted
        // path was holding has nothing left to undo, which is the same moment the input
        // bar's own send button reaches it.
        if button.action.submitsLine {
            commitDeliveredAttachments(for: sessionId)
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
            raiseTerminalMessage("电脑离线，命令没有发送。", sessionId: write.sessionId)
            return
        }
        await reclaimControl(write.sessionId)
        guard !preemptedSessions.contains(write.sessionId) else {
            raiseTerminalMessage("电脑正在使用这个会话，命令没有发送。", sessionId: write.sessionId)
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

    /// How asking the computer to start a Claude Code conversation ended.
    ///
    /// A reason rather than a bare `nil`, because the panel keeps the reader's three
    /// choices on screen while it says what went wrong — and because one of the reasons
    /// is a computer too old to know this intent at all, which is a different thing to
    /// tell someone than a refusal.
    enum AgentConversationStart: Equatable {
        case created(String)
        case failed(String)
    }

    /// Starts the bundled Claude Code on the computer, in one of its projects.
    ///
    /// The phone names a project and, when the user has chosen, a Provider and tier;
    /// the computer supplies everything else, including the credentials, which are read
    /// there and never travel. `nil` for either of the optional pair means the computer
    /// decides, and it always decides both together — half a choice names no model.
    ///
    /// The grid travels with the creation rather than as a follow-up resize: Claude Code
    /// paints its banner and first prompt within milliseconds, at whatever width the PTY
    /// had, and those lines stay in scrollback at that width.
    func createAgentConversation(
        projectId: String,
        providerId: String?,
        modelTier: MobileModelTier?,
        cols: Int?,
        rows: Int?,
        deviceLabel: String?
    ) async -> AgentConversationStart {
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else {
            return .failed("电脑离线。")
        }

        let result = await awaitResult(
            of: MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "createAgentConversation",
                projectId: projectId,
                providerId: providerId,
                modelTier: modelTier?.rawValue,
                cols: cols,
                rows: rows,
                deviceLabel: deviceLabel
            ),
            sentTo: desktop,
            timeoutSeconds: 10
        )

        guard let result else {
            // Nothing came back at all. The cause a reader can act on is a computer
            // whose Synapse predates this intent: an unknown kind is refused at the
            // edge — by the cloud, or by the desktop — rather than reported, so the
            // request simply disappears. Both ends of that are fixed the same way,
            // and the reader can only do one of them.
            return .failed(Self.desktopTooOldMessage)
        }
        if result.isAccepted, let created = result.createdSessionId {
            // Only what the computer accepted is worth repeating next time.
            conversationDefaults.remember(projectId: projectId, providerId: providerId, modelTier: modelTier)
            return .created(created)
        }
        // The cloud's own timeout, which means the intent reached a computer that did
        // not answer because it does not know the kind. Same advice; the eight-second
        // wait is the only difference.
        if result.code == "timeout" { return .failed(Self.desktopTooOldMessage) }
        return .failed(result.message ?? "电脑没有启动这个对话。")
    }

    /// The one sentence for "this computer's Synapse is too old", used for both the
    /// silent drop and the cloud's timeout because the reader's next step is the same
    /// one, and naming two different causes would only make them doubt the advice.
    private static let desktopTooOldMessage = "电脑端版本太旧，请在电脑上升级 Synapse。"

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
            let intent = MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "resize",
                sessionId: sessionId,
                cols: grid.columns,
                rows: grid.rows,
                deviceLabel: deviceLabel
            )
            // Quiet like the sync: this is the phone stating a size it already shows
            // locally, and a refusal leaves the screen as it was rather than telling
            // the reader to do something.
            self.rememberQuiet(intent.intentId)
            self.send(intent, to: desktop)
        }
    }

    /// Stops deciding a session's grid and asks the desktop's own layout to take over.
    ///
    /// The phone cannot name the size the desktop would have chosen: everything it was
    /// ever told is the size the PTY currently has, which is the phone's. So it gives
    /// up the claim, and the desktop puts the PTY back at its own layout's shape in the
    /// same call rather than on its next fit, which only runs while a pane is on screen.
    ///
    /// The answer is returned rather than dropped, because it decides what the reader's
    /// display mode should say afterwards: a refusal means the terminal is still the
    /// phone's to size, and the caller puts the mode back. See `applyGridRelease` for
    /// what each ending means, and note that a release which never left the phone is
    /// reported as its own case — nothing was refused there, and the reader's choice
    /// has to survive for the reconnect to honour it.
    func releaseGrid(for sessionId: String) async -> GridReleaseOutcome {
        gridSizeTasks[sessionId]?.cancel()
        gridSizeTasks[sessionId] = nil

        // Nothing was claimed, so there is nothing to give back. This is also what
        // keeps a phone that was never in the mode from sending a release at all.
        guard requestedGrid.removeValue(forKey: sessionId) != nil else { return .notSent }
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else {
            return .notSent
        }

        // The desktop answers in milliseconds; this only guards a lost reply, and it
        // is deliberately short because the mode is left alone until it arrives.
        let result = await awaitResult(
            of: MobileIntentRequest(
                intentId: UUID().uuidString,
                kind: "releaseGrid",
                sessionId: sessionId
            ),
            sentTo: desktop,
            timeoutSeconds: 5
        )
        return gridReleaseOutcome(for: result)
    }

    /// Puts each terminal whose grid left this phone back on the computer's layout.
    ///
    /// Run on every summary rather than from the terminal screen, because that is the
    /// one message that arrives whatever the reader is looking at: a claim outlives
    /// the screen it was made from, so the desktop's release can land while the phone
    /// shows the session list.
    private func applyGridClaims(_ sessions: [MobileSummarySession]) {
        for sessionId in gridClaims.apply(sessions: sessions, phoneClientInstanceId: clientInstanceId) {
            // Dropped before the mode moves, so the mode's own change does not send a
            // release for a claim the desktop has already taken.
            forgetClaimedGrid(for: sessionId)
            display.setMode(.desktopDriven, for: sessionId)
        }
    }

    /// Drops a claim without telling the desktop, for a grid the desktop has
    /// already taken back.
    ///
    /// Nothing is sent, because there is nothing to give back: the claim is gone
    /// there, and a `releaseGrid` would be answered with a refusal the reader never
    /// asked for. What this does is stop the phone believing it still holds the
    /// grid — the dedupe in `setGridSize` compares against this map, so a claim left
    /// here would be treated as already made and never re-sent. Without that, going
    /// back to the phone's own layout could not re-claim the size, and the mode
    /// would be a picker that moves and changes nothing.
    func forgetClaimedGrid(for sessionId: String) {
        gridSizeTasks[sessionId]?.cancel()
        gridSizeTasks[sessionId] = nil
        requestedGrid.removeValue(forKey: sessionId)
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

    /// Returns the new session's id, or `nil` after saying why in the notice bar.
    ///
    /// The caller only navigates or does not, so the refusal is answered here rather
    /// than left to fall through to the generic result handling: that one reports a
    /// failure it cannot attribute to anything, and the reader would get the reason
    /// twice or not at all depending on which branch ran first.
    private func performReturningSession(_ intent: MobileIntentRequest) async -> String? {
        guard let desktop = selectedDesktopClientInstanceId, realtime.state.isConnected else {
            banner = "电脑离线。"
            return nil
        }
        guard let result = await awaitResult(of: intent, sentTo: desktop, timeoutSeconds: 10) else {
            banner = "电脑一直没有回答，请重试。"
            return nil
        }
        guard result.isAccepted, let created = result.createdSessionId else {
            // The computer's own words for what it refused, which every failure it can
            // name now carries.
            banner = result.message ?? "电脑没有完成这个操作。"
            return nil
        }
        return created
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
        // **全部 17 种 intent 的唯一漏斗** —— 打字、按键、拉历史、切格数、建会话、
        // 删终端，一条都不落。和下面 `onIntentResult` 里那条配对，往返时延就是两条
        // 相邻记录的时间戳之差，不必再维护一张"什么时候发的"表（那种表要在六条清理
        // 路径上同步维护，漏一条就是内存泄漏）。
        DiagnosticLog.record(.intent, [
            .init(.intent, .intent(DiagnosticIntent.named(intent.kind))),
            .init(.request, DiagnosticLog.alias(.request, intent.intentId)),
            .init(.session, intent.sessionId.map { DiagnosticLog.alias(.session, $0) } ?? .redacted(.session)),
        ])
        // 发给电脑的内容：键入的命令、按下的键、递过去的路径。其余 intent
        // （attach / sync / resize / 拉历史…）是手机自己的动作，没有用户输入。
        DiagnosticLog.captureInput(kind: DiagnosticIntent.named(intent.kind), session: intent.sessionId) {
            Self.capturableText(of: intent)
        }
        realtime.sendIntent(intent, desktopClientInstanceId: desktopClientInstanceId)
    }

    /// 一个 intent 里"用户发出去的东西"。没有用户输入的那种返回 nil —— 那正是
    /// `captureInput` 用来决定要不要记一条的判据。
    private static func capturableText(of intent: MobileIntentRequest) -> String? {
        if let text = intent.text, !text.isEmpty { return text }
        guard let actions = intent.actions, !actions.isEmpty else { return nil }
        return actions.map { action in
            switch action {
            case .text(let value): value
            case .key(let key): key.rawValue
            }
        }.joined(separator: " ")
    }

    /// intent 回执 → 日志里的结果标签。四档的判据与界面上那套完全一致 —— 不另定一套，
    /// 否则日志与屏幕上说的会是两件事。
    private static func outcomeFlag(_ result: MobileIntentResult) -> DiagnosticFlag {
        if result.isAccepted { return .ok }
        if result.isNoOp { return .noop }
        // `no_result` 是"电脑没给答复"，与"电脑拒绝了"要分开：前者可能只是链路丢了。
        if result.code == "no_result" { return .timeout }
        return .rejected
    }

    /// Asks the desktop for a fresh snapshot on this app's own behalf, not the
    /// reader's — see `quietIntents` for what that means for the answer.
    private func requestSync(on desktopClientInstanceId: String) {
        rememberQuiet(realtime.requestSync(desktopClientInstanceId: desktopClientInstanceId))
    }

    private func rememberQuiet(_ intentId: String) {
        quietIntents.append(intentId)
        if quietIntents.count > Self.maxQuietIntents {
            quietIntents.removeFirst(quietIntents.count - Self.maxQuietIntents)
        }
    }

    // MARK: - Keepalive

    /// The desktop holds a write lease for as long as a terminal is open, and has
    /// no other way to tell a phone that is merely idle from one that died.
    /// 心跳只在这一个槽里，而且**取消它的每一条路都要把它置回 nil** —— 入口守卫是
    /// `keepAliveTask == nil`，留下一具取消过（或自己跑完）的尸体在那儿，这一辈子就
    /// 再也起不来了。那之后桌面端按空闲阈值释放写租约，用户每次按键都收到
    /// `lease_preempted`，除了杀进程重开没有别的出路。
    private func startKeepAlive() {
        guard keepAliveTask == nil else { return }
        keepAliveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(AppConfiguration.terminalKeepAliveInterval * 1_000_000_000))
                if Task.isCancelled { return }
                guard let self else { return }
                // 电脑还没解析出来不是「不用再心跳了」，只是「这一拍还没到」：用户开
                // 终端常常早于设备列表回来。这里 `return` 会把任务留成一具尸体，让
                // 心跳再也不发（见上面那段）。
                guard let desktop = self.selectedDesktopClientInstanceId else { continue }
                guard self.realtime.state.isConnected else { continue }
                // A computer that has gone away is kept as the one being viewed, so
                // this loop has to check for itself rather than relying on there being
                // no selection. Pinging one that is not there is answered with a
                // refusal, and a refusal nobody asked for is a message nobody wants.
                guard self.onlineDesktopIds.contains(desktop) else { continue }
                // Quiet for the same reason `requestSync` is: the lease this keeps
                // alive is bookkeeping, and no part of the screen has "the ping
                // failed" as its subject.
                let intent = MobileIntentRequest(intentId: UUID().uuidString, kind: "ping")
                self.rememberQuiet(intent.intentId)
                self.send(intent, to: desktop)
            }
        }
    }

    /// 停掉心跳。取消与置 nil 必须成对：`startKeepAlive` 的守卫看的就是这个槽空不空。
    private func stopKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = nil
    }

    private func stopKeepAliveIfIdle() {
        if openSessions.isEmpty { stopKeepAlive() }
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

    /// What stands between this phone and a terminal, when something does.
    ///
    /// The socket comes first: while it is down the computer list means nothing —
    /// either it is empty because it was never fetched, or it is stale from before the
    /// connection went. Reporting which one it is here keeps every screen from having
    /// to work it out, and from getting it wrong in its own way.
    var connectivity: Connectivity {
        guard realtime.state.isConnected else { return .noServer(realtime.state.label) }
        guard !onlineDesktops.isEmpty else { return .noComputer }
        // The computer being viewed having gone away is its own answer, and only when
        // there is somewhere else to go: with nothing else online the reader is being
        // sent to a machine either way, which is what `.noComputer` already says.
        return viewedDesktopIsOffline ? .viewedComputerOffline : .online
    }

    // MARK: - Sending files to the computer

    /// Takes a selection and starts moving it.
    ///
    /// Nothing here is awaited by the caller: the bytes go up over HTTP at their own
    /// pace, and the terminal stays usable the whole time. The chips appear
    /// immediately so the user can see what was accepted and what was refused
    /// without waiting for a transfer to finish.
    func sendFiles(_ files: [PickedFile], to sessionId: String) {
        let alreadyWaiting = relayAttachments.filter { $0.sessionId == sessionId && !$0.state.isFailed }.count
        let (accepted, rejections) = screenPickedFiles(files, alreadyWaiting: alreadyWaiting)

        for rejection in rejections {
            raiseTerminalMessage(
                rejection.message,
                sessionId: sessionId,
                // Keyed on the reason, so two files refused for the same cause read as
                // one message and two different causes read as two. The single slot
                // this replaces could only ever show the last one.
                id: "pick.\(rejection.message)"
            )
        }
        guard !accepted.isEmpty else { return }

        // Whichever computer this terminal is on, in case the reader switches before
        // the file is handed over. A file belongs to the computer it was picked for,
        // not to whichever one happens to be on screen when its bytes finish going up.
        guard let targetDesktop = selectedDesktopClientInstanceId else { return }
        let uploads = accepted.map { file in
            (
                file,
                TerminalAttachment(
                    id: UUID().uuidString,
                    name: file.name,
                    sessionId: sessionId,
                    desktopClientInstanceId: targetDesktop,
                    intentId: UUID().uuidString,
                    driveItemId: nil,
                    state: .queued
                )
            )
        }
        relayAttachments.append(contentsOf: uploads.map(\.1))
        for (file, attachment) in uploads { relayPendingFiles[attachment.id] = file }
        startRelayDrain()
    }

    /// 起一趟上传，如果还没有在跑的话。
    ///
    /// 闩门是必须的：`uploadAndDeliver` 里的每一步网络往返都会挂起，而挂起期间主
    /// actor 是空的 —— 用户这时再选一个文件就会起第二趟，两趟都在 `.queued` 里看到
    /// **同一个** attachment（状态要到进度回调才往前走），同一份字节于是上传两遍。
    /// 第二份云盘对象没人记得住，`sweepRelayLedger` 永远回收不到它。
    ///
    /// 收尾那一段不能有 await：从「槽清空」到「再看一眼还有没有待传的」之间只要让出
    /// 一次，这中间新加进来的文件就没人认领了。
    private func startRelayDrain() {
        guard relayDrainTask == nil else { return }
        relayDrainTask = Task { [weak self] in
            guard let self else { return }
            await self.drainRelayQueue()
            self.relayDrainTask = nil
            if self.relayAttachments.contains(where: \.needsUpload) { self.startRelayDrain() }
        }
    }

    /// Uploads whatever is waiting to go up, one file at a time.
    ///
    /// Serial on purpose. A batch of nine going up at once would divide the link
    /// nine ways and make every one of them slower to finish, and the user is
    /// watching a per-file progress bar.
    private func drainRelayQueue() async {
        while let next = relayAttachments.first(where: \.needsUpload) {
            guard let file = relayPendingFiles[next.id] else {
                update(next.id) { $0.state = .failed("这个文件已经不在了，请重新选择。") }
                continue
            }
            await uploadAndDeliver(next.id, file: file)
        }
    }

    private func uploadAndDeliver(_ attachmentId: String, file: PickedFile) async {
        let ticket: APIClient.DriveUploadTicket
        do {
            ticket = try await apiClient.prepareDriveUpload(
                name: relayAttachments.first(where: { $0.id == attachmentId })?.name ?? file.name,
                size: file.size,
                mimeType: file.mimeType
            )
        } catch {
            update(attachmentId) { $0.state = .failed(Self.relayMessage(for: error)) }
            discardLocalCopy(attachmentId)
            return
        }

        do {
            try await uploader.upload(
                fileURL: file.url,
                to: ticket.upload.url,
                headers: ticket.upload.headers
            ) { [weak self] fraction in
                Task { @MainActor in self?.update(attachmentId) { $0.state = .uploading(fraction) } }
            }
            _ = try await apiClient.completeDriveUpload(sessionId: ticket.sessionId)
        } catch {
            // The reservation is released so a half-written object does not sit in
            // the bucket waiting for the server's own expiry sweep.
            try? await apiClient.cancelDriveUpload(sessionId: ticket.sessionId)
            update(attachmentId) { $0.state = .failed(Self.relayMessage(for: error)) }
            discardLocalCopy(attachmentId)
            return
        }

        discardLocalCopy(attachmentId)
        // The item id is recorded before the intent is sent, so a transfer that is
        // never confirmed is still reclaimable.
        relayLedger.record(itemId: ticket.item.id)
        update(attachmentId) {
            $0.driveItemId = ticket.item.id
            $0.state = .waitingForComputer
        }
        deliver(attachmentId)
    }

    /// Hands one uploaded file to the computer, or leaves it waiting if there is
    /// none to hand it to.
    ///
    /// A send is safe to repeat: the desktop replays its stored answer for an
    /// `intentId` it has already seen, so a resend after a lost reply cannot put the
    /// same file on the computer twice.
    private func deliver(_ attachmentId: String) {
        guard let attachment = relayAttachments.first(where: { $0.id == attachmentId }),
              let driveItemId = attachment.driveItemId
        else { return }
        // The computer this file was picked for, which is not always the one being
        // viewed: the reader can switch before the bytes are finished going up, and
        // the file still belongs to the terminal it was picked in. Waiting is the
        // right answer there, not a refusal on the other computer.
        let desktop = attachment.desktopClientInstanceId
        guard desktop == selectedDesktopClientInstanceId,
              realtime.state.isConnected,
              // The cloud refuses an intent for a computer that is not there, and it
              // says so as a rejection rather than as a wait — so a file handed to a
              // computer the phone already knows has gone would come back failed
              // instead of staying in the queue. Presence is the only way to know.
              onlineDesktopIds.contains(desktop)
        else {
            update(attachmentId) { $0.state = .waitingForComputer }
            return
        }

        relayByIntent[attachment.intentId] = attachmentId
        send(
            MobileIntentRequest(
                intentId: attachment.intentId,
                kind: "fileUpload",
                sessionId: attachment.sessionId,
                driveItemId: driveItemId,
                fileName: attachment.name
            ),
            to: desktop
        )
    }

    /// Re-sends everything the computer has not answered for.
    ///
    /// The cloud does not queue for an offline computer — it refuses outright — so
    /// the queue has to live here. Called when the computer appears and when the
    /// socket comes back, which are the two moments a refusal can have stopped
    /// being true.
    private func retryWaitingAttachments() {
        guard realtime.state.isConnected, selectedDesktopClientInstanceId != nil else { return }
        for attachment in relayAttachments where attachment.state == .waitingForComputer {
            deliver(attachment.id)
        }
    }

    /// One report from the computer about a file it is fetching.
    ///
    /// Keyed on the intent, which is the same key the answer arrives on. A report
    /// for an intent this phone is no longer tracking is one that crossed the answer
    /// on the way here — the transfer is over, and there is nothing to say about it.
    private func applyTransferProgress(_ payload: MobileTransferProgressPayload) {
        guard let attachmentId = relayByIntent[payload.intentId],
              let attachment = relayAttachments.first(where: { $0.id == attachmentId }),
              let state = attachmentStateAfterTransferProgress(
                  attachment.state,
                  completedBytes: payload.completedBytes,
                  totalBytes: payload.totalBytes
              )
        else { return }

        update(attachmentId) { $0.state = state }
    }

    private func handleRelayResult(_ result: MobileIntentResult) {
        guard let attachmentId = relayByIntent.removeValue(forKey: result.intentId) else { return }

        if result.isAccepted {
            if let landedPath = result.landedPath {
                let name = (landedPath as NSString).lastPathComponent
                if !name.isEmpty {
                    update(attachmentId) { $0.name = name }
                }
            }
            // The desktop has removed the cloud copy; the ledger no longer owes it.
            // Resolved on the item recorded at upload time, not on the result, which
            // does not carry it.
            if let itemId = relayAttachments.first(where: { $0.id == attachmentId })?.driveItemId {
                relayLedger.resolve(itemId: itemId)
            }
            update(attachmentId) { $0.state = .delivered(path: result.landedPath) }
            // A file that landed but could not be typed is a success with a caveat.
            // Saying nothing would leave the user waiting for text that is not coming.
            // A success with a caveat: the file landed, it just could not be typed.
            // `.info` rather than `.failure` because nothing needs doing about it.
            if let message = result.message { notice(message, tone: .info, id: "relay.delivered") }
            return
        }

        // `no_result` and `delivery_failed` mean the computer never answered. The
        // file is safely in the drive, so this is a wait rather than a failure.
        switch result.code {
        case "no_result", "delivery_failed", "timeout":
            update(attachmentId) { $0.state = .waitingForComputer }
        default:
            update(attachmentId) { $0.state = .failed(result.message ?? "电脑没有接收这个文件。") }
        }
    }

    /// Sends a failed transfer again, under a new intent id.
    ///
    /// A refusal is cached by the deskop against the intent id it answered, so
    /// repeating the old one would replay the refusal instead of retrying.
    func retryRelay(_ attachmentId: String) {
        guard let attachment = relayAttachments.first(where: { $0.id == attachmentId }),
              attachment.state.isFailed
        else { return }
        update(attachmentId) {
            $0.intentId = UUID().uuidString
            $0.state = attachment.driveItemId == nil ? .queued : .waitingForComputer
        }
        if attachment.driveItemId == nil {
            startRelayDrain()
        } else {
            deliver(attachmentId)
        }
    }

    /// Takes a file off the strip.
    ///
    /// A file the computer never got is removed from the drive at the same moment:
    /// the user has stopped waiting for it, and leaving a copy behind would be
    /// keeping something nobody asked to keep. A delivered file is left alone —
    /// the desktop already removed its copy, and the file itself is now the user's,
    /// sitting in the folder they can open.
    func dismissRelay(_ attachmentId: String) {
        guard let attachment = relayAttachments.first(where: { $0.id == attachmentId }) else { return }
        relayAttachments.removeAll { $0.id == attachmentId }
        relayPendingFiles.removeValue(forKey: attachmentId)
        relayByIntent = relayByIntent.filter { $0.value != attachmentId }

        guard !attachment.state.isDelivered, let itemId = attachment.driveItemId else { return }
        Task { [weak self] in
            try? await self?.apiClient.permanentlyDeleteDriveItem(itemId: itemId)
            self?.relayLedger.resolve(itemId: itemId)
        }
    }

    /// Takes the chips a submission has committed off the strip.
    ///
    /// Called when a command is actually submitted, which is the only moment the
    /// phone learns the line carrying an inserted path has gone. Until then the chip
    /// is the undo for that insertion and has to stay; afterwards the insertion is
    /// spent, and a chip still offering to take it back would be offering to delete
    /// characters the user has since typed. The files themselves are left alone —
    /// `dismissRelay` does not touch a delivered one — because they are the user's
    /// now, sitting on the computer where the terminal said they are.
    func commitDeliveredAttachments(for sessionId: String) {
        for id in committedAttachmentIds(relayAttachments, sessionId: sessionId) {
            dismissRelay(id)
        }
    }

    /// Takes back what this phone typed, by pressing backspace once per character.
    ///
    /// That is the only undo a terminal offers, and it is why the desktop reports
    /// the path it inserted: the phone cannot count the characters of a path it
    /// never knew. The chips go regardless of the answer — the row describes what
    /// this phone put in the terminal, and the request to remove it has been made.
    func undoTypedPaths(_ attachmentIds: [String]) {
        for id in attachmentIds {
            guard let attachment = relayAttachments.first(where: { $0.id == id }),
                  let path = attachment.insertedPath,
                  !path.isEmpty
            else { continue }
            let count = path.count
            Task { [weak self] in
                var remaining = count
                while remaining > 0 {
                    let chunk = min(remaining, Self.backspaceChunk)
                    remaining -= chunk
                    await self?.write(
                        MobileIntentRequest(
                            intentId: UUID().uuidString,
                            kind: "keys",
                            sessionId: attachment.sessionId,
                            actions: Array(repeating: .key(.backspace), count: chunk)
                        ),
                        to: attachment.sessionId
                    )
                }
            }
        }
        for id in attachmentIds { dismissRelay(id) }
    }

    /// Well under the desktop's 128-action ceiling, so a long path is undone in a
    /// few intents rather than refused as one oversized one.
    private static let backspaceChunk = 64

    /// Removes relayed files whose computer never came back.
    ///
    /// The drive has no expiry and its delete routes leave the bytes in the bucket,
    /// so an undelivered transfer would otherwise stay in the user's drive forever.
    /// Only the phone knows which uploads are still owed a delivery, so only the
    /// phone can decide they have waited long enough.
    private func sweepRelayLedger() async {
        for entry in relayLedger.expired() {
            do {
                try await apiClient.permanentlyDeleteDriveItem(itemId: entry.itemId)
                relayLedger.resolve(itemId: entry.itemId)
                update(byDriveItemId: entry.itemId) {
                    $0.state = .failed("电脑一直没有上线，云端副本已清理。")
                }
            } catch {
                // Left in the ledger so the next sweep tries again; nothing about the
                // user's file has been lost by failing to clean up.
                continue
            }
        }
    }

    /// Drops the copy the picker made, once its bytes are in the drive.
    ///
    /// The pickers write into the app's temporary directory, and a selection can be
    /// a hundred megabytes. Waiting for iOS to reclaim that on its own schedule is
    /// not a plan; the file has served its purpose the moment the upload ends.
    private func discardLocalCopy(_ attachmentId: String) {
        guard let file = relayPendingFiles.removeValue(forKey: attachmentId) else { return }
        try? FileManager.default.removeItem(at: file.url)
    }

    private func update(_ attachmentId: String, _ change: (inout TerminalAttachment) -> Void) {
        guard let index = relayAttachments.firstIndex(where: { $0.id == attachmentId }) else { return }
        apply(change, at: index)
    }

    private func update(byDriveItemId itemId: String, _ change: (inout TerminalAttachment) -> Void) {
        guard let index = relayAttachments.firstIndex(where: { $0.driveItemId == itemId }) else { return }
        apply(change, at: index)
    }

    /// Every attachment state change lands here, which is also where a failure is felt.
    ///
    /// Not at the four call sites that can fail an attachment — a new one would be
    /// added some day and silently not buzz. Not on the state either, but on the
    /// *transition* into it: this same path carries every progress tick, and a chip
    /// whose reason gets rewritten is still the same failure.
    ///
    /// Only the failing half. A delivered file needs nothing done about it and says so
    /// where it landed — the path appears in the terminal the user was just typing in
    /// — and a batch of nine would turn a success into nine interruptions. A file that
    /// did not make it is the one that leaves the user waiting for something that is
    /// never coming, and by then they may have left the screen entirely, because the
    /// transfer outlives it.
    private func apply(_ change: (inout TerminalAttachment) -> Void, at index: Int) {
        let wasFailed = relayAttachments[index].state.isFailed
        change(&relayAttachments[index])
        if !wasFailed, relayAttachments[index].state.isFailed {
            Haptics.failure()
        }
    }

    private static func relayMessage(for error: Error) -> String {
        (error as? APIError)?.message ?? "传输没有完成，请重试。"
    }
}
