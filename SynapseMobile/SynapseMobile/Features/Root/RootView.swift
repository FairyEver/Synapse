import SwiftUI
import UserNotifications

enum Route: Hashable {
    case terminal(String)
    case meeting(String)
    case message(String)
}

struct RootView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    /// 胶囊的浮出与收起是纯装饰，别的地方（`NoticeBar`、终端那几条栏）都已经照这个
    /// 开关做了，这一处漏了。
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab = Tab.terminals
    @State private var terminalPath: [Route] = []
    @State private var meetingPath: [Route] = []
    @State private var inboxPath: [Route] = []
    @State private var settingsPath: [Route] = []

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
        }
        .onChange(of: NotificationRouter.shared.pending) { _, _ in
            handleRoute(NotificationRouter.shared.consume())
        }
        // 锁屏和灵动岛上那张卡被点开。走 URL 而不是 App Intent：卡片是「带我去看」
        // 的那一个，那两个按钮才是「替我做」。这是 Apple 给实时活动定的分工。
        .onOpenURL { url in
            guard RecordingDeepLink.isOpenRecording(url) else { return }
            handleRoute(.liveRecording)
        }
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

    /// 底栏点的是「回这一屏」，不是「切到这一屏」。
    ///
    /// `TabView` 自己不做这件事：点当前选中的那一项，`selectedTab` 没有变化，栈也不动，
    /// 于是停在「消息」的通知详情里、停在某个终端会话里点底栏，看上去像没反应。要的是
    /// 系统那种语义——再点一次当前项，把这一条栈整个弹掉，回到这一屏的根。
    ///
    /// 重按没有「值变了」可以观察（`onChange` 收不到），唯一能收到这次点击的地方就是
    /// 这条绑定的 setter：系统照常把选中的那一项写回来，写的还是同一个值。所以值变了
    /// 就往 `selectedTab` 上落，值没变就是重按。
    ///
    /// 从别的 Tab 切回来不算重按，栈照旧留着——换 Tab 保留原来的位置是系统本来的语义，
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
        case .terminals: terminalPath = []
        case .meetings: meetingPath = []
        case .inbox: inboxPath = []
        case .settings: settingsPath = []
        }
    }

    private var tabs: some View {
        TabView(selection: tabSelection) {
            NavigationStack(path: $terminalPath) {
                SessionListView(path: $terminalPath)
                    .navigationDestination(for: Route.self, destination: destination)
            }
            .tabItem { Label("终端", systemImage: "terminal") }
            .tag(Tab.terminals)

            NavigationStack(path: $meetingPath) {
                MeetingListView()
                    .navigationDestination(for: Route.self, destination: destination)
            }
            .tabItem { Label("录音", systemImage: "waveform") }
            .tag(Tab.meetings)

            NavigationStack(path: $inboxPath) {
                // 不把 path 交给它：这一屏的行都是 `NavigationLink`，自己就会往栈上
                // 追加。`inboxPath` 仍然绑在栈上，因为消息推送要把人直接送进详情。
                InboxView()
                    .navigationDestination(for: Route.self, destination: destination)
            }
            .tabItem { Label("消息", systemImage: "bell") }
            .badge(model.notifications.unreadCount)
            .tag(Tab.inbox)

            NavigationStack(path: $settingsPath) {
                SettingsView()
            }
            .tabItem { Label("我的", systemImage: "person") }
            .tag(Tab.settings)
        }
    }

    @ViewBuilder
    private func destination(_ route: Route) -> some View {
        switch route {
        case .terminal(let sessionId):
            TerminalScreen(sessionId: sessionId)
        case .meeting(let meetingId):
            MeetingDetailView(meetingId: meetingId)
        case .message(let id):
            NotificationDetailView(id: id)
        }
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
            // Only when that computer can actually open it. Pushing the terminal anyway
            // would show a screen with nothing in it and nothing to say; the list, whose
            // device row is now the way to switch, says what happened and what to do.
            if !model.viewedDesktopIsOffline {
                terminalPath = [.terminal(sessionId)]
            }
        case .meeting(let meetingId):
            // 转写结果在服务端，不依赖任何一台电脑，所以这里不需要选桌面。
            selectedTab = .meetings
            meetingPath = [.meeting(meetingId)]
        case .message(let id):
            selectedTab = .inbox
            Task {
                await model.reloadNotifications()
                inboxPath = [.message(id)]
            }
        case .newRecording:
            // 主屏长按图标那一条。先把人带到录音 Tab，再让录音页自己浮出来——否则
            // 用户看到的是一片别的界面盖着一张录音页，退出之后不知道自己回到了哪。
            selectedTab = .meetings
            meetingPath = []
            model.isRecordingPresented = true
        case .liveRecording:
            // 锁屏那张卡。同样先落到录音 Tab，但**只在真的在录的时候**才把录音页浮
            // 出来：起新录音是 `.newRecording` 的事，这里只负责把人带到那一条跟前。
            selectedTab = .meetings
            meetingPath = []
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
}
