import SwiftUI
import UserNotifications

struct RootView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    /// 功能页切换尊重系统的减弱动态效果设置。
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab = Tab.home
    @State private var terminalSelection: String?
    /// 主页那一路的栈，和它记着的录音选择。
    ///
    /// 两样都归主页 —— 录音列表住在主页里。而**栈本身放在这里**：推送、Widget 和主屏
    /// 快捷方式带来的深链要能把主页直接推到某一屏上，那些请求不是从主页里发出来的。
    @State private var homePath: [HomeRoute] = []
    @State private var meetingSelection: String?
    @State private var mailSelection: String?
    @State private var settingsSelection: SettingsCategory?
    /// 通知页的全文选择。深链和通知列表共用这一份导航状态。
    @State private var notificationToRead: SynapseNotification?
    @State private var notificationFilter = "pending"
    @State private var notificationWebLink: WebLink?
    /// 会话创建那张 sheet。同样挂在根上：主页那一行与终端列表右上角的 ＋ 打开的是同一个。
    @State private var isNewSessionPresented = false
    /// 「我的 → 通知」里那一个开关。关掉只是不往 App 图标上写数字，别的都不受影响。
    @AppStorage(NotificationBadgePreference.key) private var badgeEnabled = true
    @State private var pendingWidgetTarget: PendingExternalTerminalOpen?
    /// 一个还没能判定的打开终端请求。
    ///
    /// 只在一种情况下存在：请求带来了一个会话 id，而**当下没有一份属于那台电脑的列表**可问
    /// （刚冷启动、刚切过电脑）。那不是「这个终端没有了」，是什么都还不知道，所以要留住它，
    /// 等下一份列表到了再判 —— 丢掉它就等于把用户点的那一下当作没发生。
    @State private var pendingTerminalOpen: PendingTerminalOpen?
    @State private var notificationOpenRequest = UUID()

    /// 底栏的四个顶层分区，顺序固定为主页、终端、通知、我的。
    private enum Tab: Hashable {
        case home, terminals, notifications, settings
    }

    var body: some View {
        Group {
            switch model.authState {
            case .restoring:
                ProgressView()
            case .signedOut:
                LoginView()
            case .signedIn:
                tabs
            }
        }
        .task {
            await model.bootstrap()
            // A tap that launched the app parked its destination before any view
            // existed, so the change observer would never have fired.
            handleRoute(NotificationRouter.shared.consume())
            resolveExternalTerminalRequests()
        }
        .fullScreenCover(item: $notificationWebLink) { target in
            LinkBrowser(url: target.url) { notificationWebLink = nil }
        }
        .onChange(of: NotificationRouter.shared.pending) { _, _ in
            handleRoute(NotificationRouter.shared.consume())
        }
        // 锁屏和灵动岛上那张卡被点开。走 URL 而不是 App Intent：卡片是「带我去看」
        // 的那一个，那两个按钮才是「替我做」。这是 Apple 给实时活动定的分工。
        .onOpenURL { url in
            beginNavigationRequest()
            if url.scheme == "synapse", url.host == "mail", let id = url.pathComponents.dropFirst().first, !id.isEmpty {
                mailSelection = id
                homePath = [.mail]
                selectedTab = .home
            } else if RecordingDeepLink.isOpenRecording(url) {
                handleRoute(.liveRecording)
            } else if let target = TerminalWidgetLink.target(from: url) {
                pendingWidgetTarget = PendingExternalTerminalOpen(
                    desktopId: target.desktopId, sessionId: target.sessionId, origin: .homeWidget
                )
                openPendingWidgetTarget()
            }
        }
        .onChange(of: model.authState) { _, state in
            if state == .signedOut {
                terminalSelection = nil
                homePath = []
                meetingSelection = nil
                mailSelection = nil
                settingsSelection = nil
                notificationToRead = nil
                notificationFilter = "pending"
                notificationWebLink = nil
                isNewSessionPresented = false
                // 一个等着判定的打开请求也是「按会话 id 记住的东西」，登出之后它连属于
                // 哪台电脑都无从谈起。
                pendingTerminalOpen = nil
                notificationOpenRequest = UUID()
                selectedTab = .home
            }
            resolveExternalTerminalRequests()
        }
        .onChange(of: model.accountIdentityGeneration) { _, _ in
            // A widget waiting for a live list and a notification waiting for REST
            // are still the outgoing account's requests, even while logout drains.
            pendingWidgetTarget = nil
            pendingTerminalOpen = nil
            terminalSelection = nil
            notificationToRead = nil
            notificationFilter = "pending"
            notificationWebLink = nil
            notificationOpenRequest = UUID()
        }
        .onChange(of: model.selectedDesktopClientInstanceId) { _, _ in
            if let pending = pendingTerminalOpen,
               !pending.belongs(to: model.selectedDesktopClientInstanceId) {
                pendingTerminalOpen = nil
            }
            if let desktopId = pendingWidgetTarget?.desktopId,
               desktopId != model.selectedDesktopClientInstanceId {
                pendingWidgetTarget = nil
            }
        }
        .onChange(of: model.summary?.revision) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: model.hasLiveTerminalSummary) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: model.onlineDesktopIds) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: model.hasCurrentDesktopPresence) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: scenePhase) { _, phase in
            // 会话标记是崩溃的第三种证据：进程被系统杀掉时不会留下任何遗言，
            // 而"文件末尾没有 sessionClose"就是它来过又走了的唯一痕迹。
            DiagnosticLog.record(
                phase == .active ? .sessionOpen : .sessionClose,
                [.init(.scenePhase, .flag(phase == .active ? .active : .inactive))]
            )
            model.handleScenePhase(phase == .active)
        }
        .onChange(of: model.notifications.unreadCount) { _, count in writeBadge(unreadCount: count) }
        .onChange(of: badgeEnabled) { _, _ in
            writeBadge(unreadCount: model.notifications.unreadCount)
        }
    }

    /// 会话列表写给导航的那条选择：读的是真相，写的是请求。
    ///
    /// 读和写必须分开 —— 列表要能如实画出「现在开着哪一个」，而**要开哪一个**得先过闸门。
    /// 列表和 `NavigationSplitView` 都只认一条绑定，所以闸门就装在这条绑定的 setter 上：
    /// 用户点行写进来的那个选择，从这里过。（另外四条路 —— 待处理行、消息里的记录、推送
    /// 通知、桌面小组件 —— 不经过绑定，它们各自调 `requestTerminal`，同一个判据。）
    ///
    /// 退回列表（`nil`）不经过判据：清空永远成立。
    private var terminalEntry: Binding<String?> {
        Binding(
            get: { terminalSelection },
            set: {
                beginNavigationRequest()
                requestTerminal($0, from: .sessionList)
            }
        )
    }

    private func beginNavigationRequest() {
        notificationOpenRequest = UUID()
        pendingWidgetTarget = nil
    }

    /// Re-selecting a tab returns to that feature's list at every window width.
    ///
    /// `TabView` does not clear a split-view selection when tapping the current tab.
    ///
    /// 重按没有「值变了」可以观察（`onChange` 收不到），唯一能收到这次点击的地方就是
    /// 这条绑定的 setter：系统照常把选中的那一项写回来，写的还是同一个值。所以值变了
    /// 就往 `selectedTab` 上落，值没变就是重按。
    ///
    /// 从别的 Tab 切回来不算重按，选中项照旧留着——换 Tab 保留原来的位置是系统本来的语义，
    /// 和重按是两件事。
    private var tabSelection: Binding<Tab> {
        Binding(
            get: { selectedTab },
            set: { tab in
                beginNavigationRequest()
                if tab == selectedTab {
                    popToRoot(tab)
                } else {
                    selectedTab = tab
                }
            }
        )
    }

    private func popToRoot(_ tab: Tab) {
        beginNavigationRequest()
        switch tab {
        case .home:
            // 回到主页的顶上：栈清空，那一路记着的录音选择也一并作废。
            homePath = []
            meetingSelection = nil
            mailSelection = nil
        case .terminals:
            terminalSelection = nil
            // 「回到这一屏的列表」把等着的那个打开请求也一并作废：人已经往下走了，
            // 再把他拽进一个终端页不是他要的。
            pendingTerminalOpen = nil
            pendingWidgetTarget = nil
        case .notifications:
            notificationToRead = nil
        case .settings: settingsSelection = nil
        }
    }

    /// 主页那一格。
    ///
    /// 这一格有「功能清单 → 功能页」两层，而**功能页不是主页栈里的一层**：录音页与云盘页
    /// 各自带一个 `NavigationSplitView`（录音那份是 `AdaptiveFeatureNavigation`），而分栏
    /// 自己带一条导航栏。把分栏推进主页的栈里，屏幕上会同时出现两条栏——上面那条只剩系统的
    /// 返回键，标题和加号落在下面那条，中间空出整整一条标题带（2026-09-25 真机截图；iPhone
    /// 与 iPadOS 都是这个形状，宽窗下并排的详情列也一并没了）。所以它们是**这一格的一页**：
    /// 进它时换掉的是这一格的内容，不是往栈里推一层，返回走那一页自己那枚返回键。
    ///
    /// 这一条 path 因此有两种读法，`homePage` 把它们分开：栈上那一层（剪贴板历史）和
    /// 「这一格现在归谁」。剪贴板历史照旧留在栈里：它是一条普通页，推进去只有一条栏，
    /// 没有这个问题。
    @ViewBuilder
    private var homeTab: some View {
        Group {
            switch homePage {
            case .recordings:
                recordingsPage
            case .drive:
                drivePage
            case .mail:
                mailPage
            case .clipboard, .none:
                NavigationStack(path: $homePath) {
                    HomeView(
                        onOpenRecordings: openRecordingsFromHome,
                        onOpenPendingNotifications: {
                            beginNavigationRequest()
                            notificationFilter = "pending"
                            notificationToRead = nil
                            selectedTab = .notifications
                        },
                        onOpenDrive: { openDrive() },
                        onOpenMail: {
                            beginNavigationRequest()
                            homePath = [.mail]
                        },
                        onOpenClipboard: {
                            beginNavigationRequest()
                            homePath.append(.clipboard)
                        },
                        onNewSession: {
                            beginNavigationRequest()
                            isNewSessionPresented = true
                        },
                        onOpenWaitingSession: openWaitingSession,
                        onSwitchComputer: {
                            beginNavigationRequest()
                            switchComputer($0)
                        }
                    )
                    .noticeOverlay(model)
                    .navigationDestination(for: HomeRoute.self) { route in
                        switch route {
                        case .clipboard:
                            ClipboardHistoryView()
                        case .recordings, .drive, .mail:
                            // 走不到这一支：功能页换的是这一格的内容，不是往栈里推（见上）。
                            // 留着它只为让这个 switch 对 `HomeRoute` 保持穷尽。
                            EmptyView()
                        }
                    }
                }
            }
        }
        // 换页那一下给一层淡入，别硬切；减弱动态效果时不加。
        //
        // 盯的是「现在是不是一个功能页」这一件事，不是某一个功能：盯 `homePath` 的话，
        // 推剪贴板历史那一下也会被这条动画接管，把系统的推入换成淡入；盯单个功能的话，
        // 以后每加一个功能页都要记得回来改这一条，漏的那一次就是同一处毛病。
        //
        // **只用 `.animation(value:)` 这一种写法。** 2026-09-25 在 iPad 全屏宽度下试过给它
        // 配上 `.transition`（进场、退场、`.asymmetric` 各种组合）：换页时拆掉的是一整棵
        // 分栏子树，辅助功能同时又在查导航栏，极容易踩到 SwiftUI 的一个重入缺陷
        // （`AttributeGraph` 断言失败 → `SIGABRT`）。**注意那条缺陷不是动画引出来的** ——
        // 不给动画、换成硬切，2/2 照样踩到；把换页推迟一帧等拆解完，3/3 也照样。省掉
        // `transition` 只是少一份风险。堆栈、逐种试过的改法与「触发条件至今没定死」那件事
        // 写在 `docs/agents/mobile-adaptive-layout.md` 的导航结构那一节。
        .animation(reduceMotion ? nil : .snappy, value: homePage != nil)
    }

    /// 这一格现在被哪个功能页占着；没有功能页时是 `nil`（这一格画的是主页那张清单）。
    ///
    /// 从这一条 path 上读，是因为进功能页的入口都往它上面写（深链走 `openRecording`，
    /// 主页那一行走 `openDrive`）：「这一格归谁」和 path 是同一件事的两种读法，分开存
    /// 两份就会分叉。
    private var homePage: HomeRoute? {
        switch homePath.last {
        case .recordings: return .recordings
        case .drive: return .drive
        case .mail: return .mail
        case .clipboard, .none: return nil
        }
    }

    /// 录音页：列表 + 详情，宽窗并排、紧凑窗下钻，整页归这一格所有（见 `homeTab`）。
    ///
    /// 返回主页那枚键由这一页自己带，落在分栏列表那一条栏上——和加号同一行。
    private var recordingsPage: some View {
        AdaptiveFeatureNavigation(
            selection: $meetingSelection,
            emptyTitle: "选择录音",
            emptySymbol: "waveform"
        ) {
            MeetingListView(selection: $meetingSelection)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            popToRoot(.home)
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .accessibilityLabel("主页")
                        .accessibilityIdentifier("recordings-back-home")
                    }
                }
        } detail: { meetingId in
            NavigationStack {
                MeetingDetailView(meetingId: meetingId) {
                    if meetingSelection == meetingId { meetingSelection = nil }
                }
            }
        }
        .noticeOverlay(model)
    }

    /// 云盘页：和录音页同构，整页归这一格所有（见 `homeTab`）。
    ///
    /// 它自己带那条 `NavigationStack` 与根层那枚返回键（往里走是系统那枚），所以这里只把它
    /// 摆出来，**不放进任何 `NavigationStack`** —— 进去以后文件夹下钻、回收站、分享管理
    /// 都在它自己那条栈上。
    private var drivePage: some View {
        DriveBrowserView(onExit: { popToRoot(.home) })
    }

    private var mailPage: some View {
        MailView(selection: $mailSelection, onExit: { popToRoot(.home) })
    }

    private var tabs: some View {
        TabView(selection: tabSelection) {
            homeTab
                .tabItem { Label("主页", systemImage: "house") }
            .tag(Tab.home)

            AdaptiveFeatureNavigation(
                selection: terminalEntry,
                emptyTitle: "选择会话",
                emptySymbol: "terminal"
            ) {
                // 两个入口分开给：`selection` 是「用户挑了哪一个」，每一步都要过闸门；
                // `onOpenCreated` 是「电脑刚把这条终端交给我们」，它不必过。
                SessionListView(selection: terminalEntry, onOpenCreated: openFreshTerminal,
                    onBeginNavigation: beginNavigationRequest)
            } detail: { sessionId in
                TerminalScreen(sessionId: sessionId) { terminalSelection = nil }
            }
            .tabItem { Label("终端", systemImage: "terminal") }
            .tag(Tab.terminals)

            NotificationView(
                readingNotification: $notificationToRead,
                onOpenTerminal: openWaitingSession,
                onOpenExternal: openNotificationExternalURL,
                filter: $notificationFilter
            )
            .tabItem { Label("通知", systemImage: "bell") }
            .badge(unreadBadge)
            .tag(Tab.notifications)

            AdaptiveSettingsView(selection: $settingsSelection) {
                terminalSelection = nil
                pendingTerminalOpen = nil
            }
            .tabItem { Label("我的", systemImage: "person") }
            .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
        .newSessionSheet(isPresented: $isNewSessionPresented, onOpenCreated: openNewlyCreatedFromHome)
    }

    /// 通知底栏的角标：99 条以内照实写，100 条起「99+」。
    private var unreadBadge: String? {
        let count = model.notifications.unreadCount
        return count > 0 ? NotificationText.badgeCount(count) : nil
    }

    /// 从主页那张待处理卡进一个会话。
    ///
    /// 走 `requestTerminal` 同一道闸门：那条会话可能在卡片画出来与手指落下去之间结束掉。
    private func openWaitingSession(_ sessionId: String) {
        beginNavigationRequest()
        if requestTerminal(sessionId, from: .homePending) { selectedTab = .terminals }
    }

    /// 主页顶栏换了一台电脑。
    ///
    /// 先清掉终端那一格的选择：那条选择是按会话 id 记住的，而会话 id 只对签发它的那台电脑
    /// 成立。留着它，人切到终端那一格就会落进一个属于上一台电脑的终端页。清空永远成立，不
    /// 需要过闸门 —— 与 `popToRoot(.terminals)` 是同一条理由、同一个动作，那里也是这么做的。
    ///
    /// 等着列表的请求也属于旧电脑；与选择一起清除。
    private func switchComputer(_ clientInstanceId: String) {
        if clientInstanceId != model.selectedDesktopClientInstanceId {
            terminalSelection = nil
            pendingTerminalOpen = nil
            if pendingWidgetTarget?.desktopId != clientInstanceId { pendingWidgetTarget = nil }
        }
        model.selectDesktop(clientInstanceId)
    }

    /// 写作 App 图标角标的数字。
    ///
    /// 开关关掉时写 0 —— 也就是把已经画上去的数字擦掉，而不是什么都不做：什么都不做的话，
    /// 关掉它的那一刻角标还挂在那儿。
    ///
    /// Setting the badge needs no permission, but it does need the user to have granted
    /// notifications at all. This app treats push as best effort — everything works
    /// without it — so a refusal is not an error worth surfacing, and there is no UI
    /// here to surface it in anyway.
    private func writeBadge(unreadCount: Int) {
        let badge = NotificationBadgePreference.badgeCount(unreadCount: unreadCount)
        Task {
            try? await UNUserNotificationCenter.current().setBadgeCount(badge)
        }
    }

    /// Sends a notification tap straight to the terminal that needs attention.
    private func handleRoute(_ destination: NotificationRouter.Destination?) {
        guard let destination else { return }
        beginNavigationRequest()
        switch destination {
        case .terminal(let sessionId, let desktopClientInstanceId, let entry):
            // Naming a computer is the reader saying which one they mean, so this is
            // honoured even when that computer is not reachable — landing them on
            // another one instead is the behaviour the switch exists to remove.
            pendingWidgetTarget = PendingExternalTerminalOpen(
                desktopId: desktopClientInstanceId.isEmpty ? model.selectedDesktopClientInstanceId : desktopClientInstanceId,
                sessionId: sessionId,
                origin: entry
            )
            openPendingWidgetTarget()
        case .meeting(let meetingId):
            // 转写结果在服务端，不依赖任何一台电脑，所以这里不需要选桌面。
            openRecording(meetingId)
        case .mail(let messageId):
            mailSelection = messageId
            selectedTab = .home
            homePath = [.mail]
        case .message(let id):
            openNotification(id)
        case .newRecording:
            // 主屏长按图标那一条。先把人带到录音列表，再让录音页自己浮出来——否则
            // 用户看到的是一片别的界面盖着一张录音页，退出之后不知道自己回到了哪。
            openRecording(nil)
            model.isRecordingPresented = true
        case .liveRecording:
            // 锁屏那张卡。同样先落到录音列表，但**只在真的在录的时候**才把录音页浮
            // 出来：起新录音是 `.newRecording` 的事，这里只负责把人带到那一条跟前。
            openRecording(nil)
            if model.recording.isRecording {
                model.isRecordingPresented = true
            } else {
                // 卡片还在、录音却没了：App 被系统杀掉过（系统最长把实时活动留 8 小时）。
                // 那条录音会在启动时被静默收尾、照常出现在列表里，所以这里只把锁屏上
                // 那条已经不作数的活动收掉，不凭空起一条新的。
                Task { await RecordingActivityHousekeeping.endOrphans() }
            }
        }
    }

    /// 把人送到主页那一格 → 录音列表，落在某一条录音上（`nil` 就是落在列表上）。
    ///
    /// 深链里所有「看录音」的落点都从这一个函数过：录音不在底栏上了，它是主页那一格的
    /// 一页，而那一页由根视图拿着的那一条 `homePath` 指认（见 `homeTab`）。
    private func openRecording(_ meetingId: String?) {
        beginNavigationRequest()
        selectedTab = .home
        meetingSelection = meetingId
        homePath = [.recordings]
    }

    private func openRecordingsFromHome() {
        openRecording(nil)
        if model.recording.isRecording { model.isRecordingPresented = true }
    }

    /// 把人送到主页那一格 → 云盘。
    ///
    /// 与 `openRecording` 同一件事：云盘同样是「这一格的一页」，落点由同一条 `homePath`
    /// 指认，只是它没有要选中的条目——进去就停在根层（`DriveBrowserView.enter`）。
    private func openDrive() {
        beginNavigationRequest()
        selectedTab = .home
        homePath = [.drive]
    }

    /// 一条通知被点开，但只有它的 id。
    ///
    /// 先拉一次列表再判：一条通知记着的是「它完成那一轮时」的会话 id，那条会话后来
    /// 结束了、被删了都不会让这条记录失效，所以这个 id 今天还指不指得动要当场问一次。
    /// 列表到达之后才解析，是因为 `deviceId` / `targetId` 都在通知自己身上，
    /// 而解析要用的 `model.notifications.items` 也在这一刻才更新。
    private func openNotification(_ id: String) {
        let account = model.accountIdentityGeneration
        let request = UUID()
        notificationOpenRequest = request
        selectedTab = .notifications
        Task {
            guard model.isCurrentAccount(account), notificationOpenRequest == request else { return }
            await model.reloadNotifications()
            guard model.isCurrentAccount(account), notificationOpenRequest == request else { return }
            // readNotification first ensures this exact id: the latest page can no
            // longer contain a notification that is still valid in an older page.
            await model.readNotification(id)
            guard model.isCurrentAccount(account), notificationOpenRequest == request else { return }
            guard let item = model.notifications.items.first(where: { $0.id == id }) else {
                // 拉回来却没有这一条（已过期、已在别处删掉）。留在通知页，让人看到
                // 当前仍然有效的通知。
                model.notice("无法打开这条通知", tone: .failure)
                return
            }
            switch NotificationDestination.resolve(item) {
            case .route(let destination):
                handleRoute(destination)
            case .externalURL(let url):
                openNotificationExternalURL(url)
            case .none:
                notificationToRead = item
            }
        }
    }

    private func openNotificationExternalURL(_ url: URL) {
        if SynapseWebLink.isTrusted(url) {
            notificationWebLink = WebLink(url: url)
        } else {
            openURL(url)
        }
    }

    /// 进终端页的唯一入口，连同它唯一的判据。
    ///
    /// 会话列表里的行、「消息」里的待处理行、「消息」里一条记录上的「打开终端」、推送通知、
    /// 桌面小组件 —— 五条路都落在这里，所以「这个终端还开不开得开」这个问题只回答一次。
    ///
    /// 判据是**电脑送来的那份列表里还有没有它**（见 `TerminalOpenability`）。这不是保守，
    /// 是唯一说得通的一条：另外三条路带来的 id 都来自某个更早的时刻，而那一刻可能早就过去了。
    /// 旧的写法是直接进终端页 —— 于是手机把人送进一块空画布，画布上只有电脑回的那句
    /// 「该终端已结束。」，而返回的路要人自己找。
    @discardableResult private func requestTerminal(
        _ sessionId: String?,
        on desktopClientInstanceId: String? = nil,
        from origin: TerminalOpenOrigin
    ) -> Bool {
        guard let sessionId else {
            terminalSelection = nil
            pendingTerminalOpen = nil
            return false
        }
        let decision = model.terminalOpenability(sessionId, on: desktopClientInstanceId)
        let navigation = TerminalOpenNavigation(requestedSession: sessionId,
            currentSelection: terminalSelection, decision: decision)
        terminalSelection = navigation.selection
        // 没能进去的两种在这里各留一条记录，连同**是谁在问**一起（见 `TerminalOpenOrigin`）。
        // 它排在这个 switch 之前而不是某个分支里，是因为下面那个 `.unknown` 会把请求排进
        // 队列、过几秒才轮到 —— 那一刻「谁在问」已经不在栈上了，只能由这里带过去。
        model.recordTerminalOpen(sessionId, decision: decision, from: origin)
        switch decision {
        case .openable:
            pendingTerminalOpen = nil
        case .ended:
            pendingTerminalOpen = nil
            // It names the attempted destination rather than claiming that the
            // still-selected terminal ended, so the current host can show it.
            if let message = navigation.rejectionNotice {
                model.notice(message, tone: .failure, id: "terminal.ended.\(sessionId)")
            }
        case .unknown:
            // 列表还没到。留到下一份列表，别把人这一下丢掉。
            pendingTerminalOpen = PendingTerminalOpen(
                sessionId: sessionId,
                requestedDesktop: desktopClientInstanceId,
                currentDesktop: model.selectedDesktopClientInstanceId
            )
        }
        return navigation.activatesTerminalTab
    }

    /// 打开一个**手机自己刚让电脑建出来**的终端。
    ///
    /// 它不经过判据，而且这是对的：那个 id 是电脑亲口回给手机的（`create` / `launchCommand`
    /// 的结果，或者「开始对话」的结果），它一定存在 —— 不存在的可能性不在这一条路上。
    ///
    /// 反过来才危险：这类终端出现在列表上要等下一份 summary 到达，而那一瞬间「列表里没有
    /// 它」是**列表还没跟上**。拿判据去问，用户按下「开始对话」得到的第一句话会是
    /// 「这个会话已经结束了」。
    private func openFreshTerminal(_ sessionId: String) {
        beginNavigationRequest()
        pendingTerminalOpen = nil
        terminalSelection = sessionId
    }

    /// 主页上刚建出来的那个终端。
    ///
    /// 和终端那一页建出来的是同一样东西，只是按下按钮的那一屏不在终端里 —— 所以要先把人
    /// 带到终端那一格，再打开它。不切的话，用户会停在自己刚建出终端的那个清单上，而终端
    /// 在另一格里。
    private func openNewlyCreatedFromHome(_ sessionId: String) {
        selectedTab = .terminals
        openFreshTerminal(sessionId)
    }

    /// 判定那个还没能判定的请求。列表、连接、登录态任一变一次都会走这里。
    private func resolvePendingTerminalOpen() {
        guard let pending = pendingTerminalOpen else { return }
        // 换过电脑就不算数了。手机端按会话 id 记住的东西都只对签发它的那台电脑成立，
        // 而这一类最容易出事的正是「等下一次」的东西：等到了、电脑却已经不是那台了，
        // 就会打到一个没听说过这个终端的电脑上。
        if !pending.belongs(to: model.selectedDesktopClientInstanceId) {
            pendingTerminalOpen = nil
            return
        }
        // 排队时是谁点的，到这一刻已经不在栈上了 —— 那个来源在排进队列时就记过一次
        // （见 `requestTerminal`），这里只说明「现在轮到它了」。
        requestTerminal(pending.sessionId, on: pending.desktopClientInstanceId, from: .queuedRequest)
    }

    /// 所有「来自手机外面」的打开请求都在这一个入口里收口。
    ///
    /// 两件事被排在同一个函数里，是因为它们要等的是同一批事件：一份属于那台电脑的列表、
    /// 一次连接建立、一次登录态变化。分开写就有两处要各自记得挂这四条 `onChange`。
    private func resolveExternalTerminalRequests() {
        resolvePendingTerminalOpen()
        openPendingWidgetTarget()
    }

    private func openPendingWidgetTarget() {
        guard model.authState == .signedIn, let target = pendingWidgetTarget else { return }
        if let desktopId = target.desktopId, model.selectedDesktopClientInstanceId != desktopId {
            switchComputer(desktopId)
        }
        switch target.resolve(
            currentDesktopId: model.selectedDesktopClientInstanceId,
            hasCurrentPresence: model.hasCurrentDesktopPresence,
            onlineDesktopIds: model.onlineDesktopIds,
            hasLiveSummary: model.hasLiveTerminalSummary,
            summary: model.summary
        ) {
        case .waiting:
            return
        case .list:
            selectedTab = .terminals
            terminalSelection = nil
            pendingWidgetTarget = nil
        case .terminal(let sessionId, let desktopId):
            if requestTerminal(sessionId, on: desktopId, from: target.origin) { selectedTab = .terminals }
            pendingWidgetTarget = nil
        }
    }
}
