import SwiftUI

enum Route: Hashable {
    case terminal(String)
}

struct RootView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = Tab.terminals
    @State private var terminalPath: [Route] = []
    @State private var inboxPath: [Route] = []
    @State private var settingsPath: [Route] = []

    private enum Tab: Hashable {
        case terminals, inbox, settings
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
            model.handleScenePhase(phase == .active)
        }
        .onChange(of: model.waitingSessions.count) { _, count in
            // Surface waiting work on the tab even when the user is elsewhere.
            if count > 0, selectedTab != .inbox {
                UIApplication.shared.applicationIconBadgeNumber = count
            } else {
                UIApplication.shared.applicationIconBadgeNumber = 0
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

            NavigationStack(path: $inboxPath) {
                InboxView(path: $inboxPath)
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
        }
    }
}
