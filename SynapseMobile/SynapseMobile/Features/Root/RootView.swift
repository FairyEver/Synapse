import SwiftUI
import UserNotifications

enum Route: Hashable {
    case terminal(String)
    case meeting(String)
}

struct RootView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
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
        .onChange(of: scenePhase) { _, phase in
            // 会话标记是崩溃的第三种证据：进程被系统杀掉时不会留下任何遗言，
            // 而"文件末尾没有 sessionClose"就是它来过又走了的唯一痕迹。
            DiagnosticLog.record(
                phase == .active ? .sessionOpen : .sessionClose,
                [.init(.scenePhase, .flag(phase == .active ? .active : .inactive))]
            )
            model.handleScenePhase(phase == .active)
        }
        .onChange(of: model.waitingSessions.count) { _, count in
            // Surface waiting work on the tab even when the user is elsewhere.
            let badge = (count > 0 && selectedTab != .inbox) ? count : 0
            Task {
                // Setting the badge needs no permission, but it does need the user to
                // have granted notifications at all. This app treats push as best
                // effort — everything works without it — so a refusal is not an error
                // worth surfacing, and there is no UI here to surface it in anyway.
                try? await UNUserNotificationCenter.current().setBadgeCount(badge)
            }
        }
    }

    private var tabs: some View {
        TabView(selection: $selectedTab) {
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
                // No path binding: the inbox's rows are `NavigationLink`s, which append
                // to the stack on their own.
                InboxView()
                    .navigationDestination(for: Route.self, destination: destination)
            }
            .tabItem { Label("需要我", systemImage: "exclamationmark.circle") }
            .badge(model.waitingSessions.count)
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
        }
    }

    /// Sends a notification tap straight to the terminal that needs attention.
    private func handleRoute(_ destination: NotificationRouter.Destination?) {
        guard let destination else { return }
        switch destination {
        case .terminal(let sessionId, let desktopClientInstanceId):
            model.selectDesktop(desktopClientInstanceId)
            selectedTab = .terminals
            terminalPath = [.terminal(sessionId)]
        case .meeting(let meetingId):
            // 转写结果在服务端，不依赖任何一台电脑，所以这里不需要选桌面。
            selectedTab = .meetings
            meetingPath = [.meeting(meetingId)]
        }
    }
}
