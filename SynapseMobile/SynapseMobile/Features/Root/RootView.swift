import SwiftUI
import UserNotifications

struct RootView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    /// 胶囊的浮出与收起是纯装饰，别的地方（`NoticeBar`、终端那几条栏）都已经照这个
    /// 开关做了，这一处漏了。
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab = Tab.terminals
    @State private var terminalSelection: String?
    @State private var meetingSelection: String?
    @State private var inboxSelection: String?
    @State private var settingsSelection: SettingsCategory?
    @State private var pendingWidgetTarget: TerminalWidgetLink.Target?
    /// 一个还没能判定的打开终端请求。
    ///
    /// 只在一种情况下存在：请求带来了一个会话 id，而**当下没有一份属于那台电脑的列表**可问
    /// （刚冷启动、刚切过电脑）。那不是「这个终端没有了」，是什么都还不知道，所以要留住它，
    /// 等下一份列表到了再判 —— 丢掉它就等于把用户点的那一下当作没发生。
    @State private var pendingTerminalOpen: PendingTerminalOpen?

    private enum Tab: Hashable {
        case terminals, meetings, inbox, settings
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
                    // 录音页收起之后，录音还在继续。这枚胶囊是「还在录、而且随时能停」
                    // 唯一的落点——没有它，用户收起那一屏就再也找不到自己在录的那条了。
                    //
                    // `safeAreaInset` 而不是 `overlay`：胶囊要**占自己的一条带子**，不能
                    // 盖在别人身上。`.overlay(alignment: .top)` 是贴在 `TabView` 的顶边
                    // 往下 4pt，落到的正是四个 tab 各自的导航栏那一带——录着音切到「终端」
                    // 压住的是大标题和右上角的加号，切到某个终端会话压住的是那一屏自绘的
                    // 标题栏。原型把它放在 `top:59px`（状态栏正下方），要的是那个位置；
                    // 区别只在：那样画是盖着，这样画是让开。
                    //
                    // 代价是整个 `TabView` 的内容在录音期间下移一条带子。终端的画布也跟着
                    // 变矮，于是会照常向电脑报一次网格——和开关键盘面板时走的是同一条路。
                    .safeAreaInset(edge: .top, spacing: 0) {
                        // 只在真的在录的时候浮出来。`.saving` 不是——那会儿录音页已经
                        // 收了、界面也回了列表，留一枚按不动的「完成」在顶上只是碍事。
                        if model.recording.isRecording {
                            RecordingCapsule()
                                .padding(.top, 4)
                                .padding(.bottom, 8)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                    .animation(reduceMotion ? nil : .snappy, value: model.recording.phase)
            }
        }
        .task {
            await model.bootstrap()
            // A tap that launched the app parked its destination before any view
            // existed, so the change observer would never have fired.
            handleRoute(NotificationRouter.shared.consume())
            resolveExternalTerminalRequests()
        }
        .onChange(of: NotificationRouter.shared.pending) { _, _ in
            handleRoute(NotificationRouter.shared.consume())
        }
        // 锁屏和灵动岛上那张卡被点开。走 URL 而不是 App Intent：卡片是「带我去看」
        // 的那一个，那两个按钮才是「替我做」。这是 Apple 给实时活动定的分工。
        .onOpenURL { url in
            if RecordingDeepLink.isOpenRecording(url) {
                handleRoute(.liveRecording)
            } else if let target = TerminalWidgetLink.target(from: url) {
                pendingWidgetTarget = target
                openPendingWidgetTarget()
            }
        }
        .onChange(of: model.authState) { _, state in
            if state == .signedOut {
                terminalSelection = nil
                meetingSelection = nil
                inboxSelection = nil
                settingsSelection = nil
                // 一个等着判定的打开请求也是「按会话 id 记住的东西」，登出之后它连属于
                // 哪台电脑都无从谈起。
                pendingTerminalOpen = nil
                selectedTab = .terminals
            }
            resolveExternalTerminalRequests()
        }
        .onChange(of: model.summary?.revision) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: model.hasLiveTerminalSummary) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: model.onlineDesktopIds) { _, _ in resolveExternalTerminalRequests() }
        .onChange(of: scenePhase) { _, phase in
            // 会话标记是崩溃的第三种证据：进程被系统杀掉时不会留下任何遗言，
            // 而"文件末尾没有 sessionClose"就是它来过又走了的唯一痕迹。
            DiagnosticLog.record(
                phase == .active ? .sessionOpen : .sessionClose,
                [.init(.scenePhase, .flag(phase == .active ? .active : .inactive))]
            )
            model.handleScenePhase(phase == .active)
        }
        .onChange(of: model.notifications.unreadCount) { _, count in
            let badge = count
            Task {
                // Setting the badge needs no permission, but it does need the user to
                // have granted notifications at all. This app treats push as best
                // effort — everything works without it — so a refusal is not an error
                // worth surfacing, and there is no UI here to surface it in anyway.
                try? await UNUserNotificationCenter.current().setBadgeCount(badge)
            }
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
            set: { requestTerminal($0) }
        )
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
                if tab == selectedTab {
                    popToRoot(tab)
                } else {
                    selectedTab = tab
                }
            }
        )
    }

    private func popToRoot(_ tab: Tab) {
        switch tab {
        case .terminals:
            terminalSelection = nil
            // 「回到这一屏的列表」把等着的那个打开请求也一并作废：人已经往下走了，
            // 再把他拽进一个终端页不是他要的。
            pendingTerminalOpen = nil
        case .meetings: meetingSelection = nil
        case .inbox: inboxSelection = nil
        case .settings: settingsSelection = nil
        }
    }

    private var tabs: some View {
        TabView(selection: tabSelection) {
            AdaptiveFeatureNavigation(
                selection: terminalEntry,
                emptyTitle: "选择会话",
                emptySymbol: "terminal"
            ) {
                // 两个入口分开给：`selection` 是「用户挑了哪一个」，每一步都要过闸门；
                // `onOpenCreated` 是「电脑刚把这条终端交给我们」，它不必过。
                SessionListView(selection: terminalEntry, onOpenCreated: openFreshTerminal)
            } detail: { sessionId in
                TerminalScreen(sessionId: sessionId) { terminalSelection = nil }
            }
            .tabItem { Label("终端", systemImage: "terminal") }
            .tag(Tab.terminals)

            AdaptiveFeatureNavigation(
                selection: $meetingSelection,
                emptyTitle: "选择录音",
                emptySymbol: "waveform"
            ) {
                MeetingListView(selection: $meetingSelection)
            } detail: { meetingId in
                MeetingDetailView(meetingId: meetingId) { meetingSelection = nil }
            }
            .tabItem { Label("录音", systemImage: "waveform") }
            .tag(Tab.meetings)

            AdaptiveFeatureNavigation(
                selection: $inboxSelection,
                emptyTitle: "选择消息",
                emptySymbol: "bell"
            ) {
                InboxView(selection: $inboxSelection) { sessionId in
                    selectedTab = .terminals
                    // 走同一道闸门：待处理那一行是从列表上取的，本来就在，但它可能在
                    // 「这一行画出来」和「手指落下去」之间结束掉。
                    requestTerminal(sessionId)
                }
            } detail: { id in
                NotificationDetailView(id: id)
            }
            .tabItem { Label("消息", systemImage: "bell") }
            .badge(model.notifications.unreadCount)
            .tag(Tab.inbox)

            AdaptiveSettingsView(selection: $settingsSelection) {
                terminalSelection = nil
            }
            .tabItem { Label("我的", systemImage: "person") }
            .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
    }

    /// Sends a notification tap straight to the terminal that needs attention.
    private func handleRoute(_ destination: NotificationRouter.Destination?) {
        guard let destination else { return }
        switch destination {
        case .terminal(let sessionId, let desktopClientInstanceId):
            // Naming a computer is the reader saying which one they mean, so this is
            // honoured even when that computer is not reachable — landing them on
            // another one instead is the behaviour the switch exists to remove.
            model.selectDesktop(desktopClientInstanceId)
            selectedTab = .terminals
            // Only when that computer can actually open it. Selecting the terminal anyway
            // would show a screen with nothing in it and nothing to say; the list, whose
            // device row is now the way to switch, says what happened and what to do.
            //
            // 「能打开」现在是两个条件，不是一个：那台电脑在线，**而且**它的列表里还有这个
            // 会话。一条通知记着的是「它完成那一轮时」的会话 id，那条会话后来结束了、被删了
            // 都不会让这条记录失效，所以这个 id 的存在必须当场再问一次。
            if !model.viewedDesktopIsOffline {
                requestTerminal(sessionId, on: desktopClientInstanceId)
            }
        case .meeting(let meetingId):
            // 转写结果在服务端，不依赖任何一台电脑，所以这里不需要选桌面。
            selectedTab = .meetings
            meetingSelection = meetingId
        case .message(let id):
            selectedTab = .inbox
            Task {
                await model.reloadNotifications()
                inboxSelection = id
            }
        case .newRecording:
            // 主屏长按图标那一条。先把人带到录音 Tab，再让录音页自己浮出来——否则
            // 用户看到的是一片别的界面盖着一张录音页，退出之后不知道自己回到了哪。
            selectedTab = .meetings
            meetingSelection = nil
            model.isRecordingPresented = true
        case .liveRecording:
            // 锁屏那张卡。同样先落到录音 Tab，但**只在真的在录的时候**才把录音页浮
            // 出来：起新录音是 `.newRecording` 的事，这里只负责把人带到那一条跟前。
            selectedTab = .meetings
            meetingSelection = nil
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

    /// 进终端页的唯一入口，连同它唯一的判据。
    ///
    /// 会话列表里的行、「消息」里的待处理行、「消息」里一条记录上的「打开终端」、推送通知、
    /// 桌面小组件 —— 五条路都落在这里，所以「这个终端还开不开得开」这个问题只回答一次。
    ///
    /// 判据是**电脑送来的那份列表里还有没有它**（见 `TerminalOpenability`）。这不是保守，
    /// 是唯一说得通的一条：另外三条路带来的 id 都来自某个更早的时刻，而那一刻可能早就过去了。
    /// 旧的写法是直接进终端页 —— 于是手机把人送进一块空画布，画布上只有电脑回的那句
    /// 「该终端已结束。」，而返回的路要人自己找。
    private func requestTerminal(_ sessionId: String?, on desktopClientInstanceId: String? = nil) {
        guard let sessionId else {
            terminalSelection = nil
            pendingTerminalOpen = nil
            return
        }
        switch model.terminalOpenability(sessionId, on: desktopClientInstanceId) {
        case .openable:
            pendingTerminalOpen = nil
            terminalSelection = sessionId
        case .ended:
            pendingTerminalOpen = nil
            // 不当着人的面开一块空白：就地说明为什么没进去。
            //
            // 与电脑那条拒绝同一个语气（电脑回的是「该终端已结束。」，落在手机上就是一条
            // 拒绝），因为这就是同一件事被两个地方说出来 —— 只是这一次那个人还没有被送进
            // 一块空画布里去听它。
            //
            // 这句话是**关于 `sessionId` 这个会话的**，所以带上它：五条路里只有会话列表
            // 那一行是当场取的 id，通知、消息里的记录、桌面小组件和等下一份列表的挂起请求
            // 带来的都是某一刻记下的 id —— 那次拒绝发生时，人很可能已经站在**另一个**会话里
            // 了。不带归属的话，这句「这个会话已经结束了。」就会画在那个好好的会话的画布上，
            // 读起来正是「我正在用的这个结束了」。见 `Notice.sessionId`。
            //
            // id 里带上会话：同一个 id 在队列里只有一条，两个会话各自被拒绝时不该互相顶掉。
            model.notice(
                "这个会话已经结束了。",
                tone: .failure,
                id: "terminal.ended.\(sessionId)",
                sessionId: sessionId
            )
        case .unknown:
            // 列表还没到。留到下一份列表，别把人这一下丢掉。
            pendingTerminalOpen = PendingTerminalOpen(
                sessionId: sessionId,
                desktopClientInstanceId: desktopClientInstanceId
            )
        }
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
        pendingTerminalOpen = nil
        terminalSelection = sessionId
    }

    /// 判定那个还没能判定的请求。列表、连接、登录态任一变一次都会走这里。
    private func resolvePendingTerminalOpen() {
        guard let pending = pendingTerminalOpen else { return }
        // 换过电脑就不算数了。手机端按会话 id 记住的东西都只对签发它的那台电脑成立，
        // 而这一类最容易出事的正是「等下一次」的东西：等到了、电脑却已经不是那台了，
        // 就会打到一个没听说过这个终端的电脑上。
        if let named = pending.desktopClientInstanceId,
           named != model.selectedDesktopClientInstanceId {
            pendingTerminalOpen = nil
            return
        }
        requestTerminal(pending.sessionId, on: pending.desktopClientInstanceId)
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
        selectedTab = .terminals
        terminalSelection = nil
        guard let desktopId = target.desktopId else {
            pendingWidgetTarget = nil
            return
        }
        if model.selectedDesktopClientInstanceId != desktopId {
            model.selectDesktop(desktopId)
        }
        guard let sessionId = target.sessionId else {
            pendingWidgetTarget = nil
            return
        }
        guard !model.viewedDesktopIsOffline else {
            pendingWidgetTarget = nil
            return
        }
        guard model.hasLiveTerminalSummary,
              let summary = model.summary,
              summary.desktopClientInstanceId == desktopId else { return }
        // 判据和通知那条路是同一条，只是这里多一个前置条件：列表必须是**刚从那台电脑的
        // 连接上收到的**。小组件的快照可以躺很久，而拿一份陈旧的列表去判，每一条都会读成
        // 「它还在」—— 那正是这道闸门要挡的东西。
        requestTerminal(sessionId, on: desktopId)
        pendingWidgetTarget = nil
    }
}

/// 一个带来了会话 id、却还没有一份列表可问的打开请求。
///
/// `desktopClientInstanceId` 是请求自己记着的那台电脑，不是「现在看着的那台」：一条通知
/// 说的是「这条会话在**那台**电脑上」，等列表也要等那台的那一份。
private struct PendingTerminalOpen: Equatable {
    let sessionId: String
    let desktopClientInstanceId: String?
}
