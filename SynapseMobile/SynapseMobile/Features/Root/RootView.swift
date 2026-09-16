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
        .overlay(alignment: .top) {
            if let banner = model.banner {
                ToastBanner(text: banner) { model.banner = nil }
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: model.banner)
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

/// Short-lived message. Used for failures that have no natural home on screen —
/// a rejected intent, a dropped desktop — rather than for narration.
struct ToastBanner: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundStyle(Theme.attention)
            Text(text)
                .font(.system(size: 13))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .onTapGesture(perform: onDismiss)
        .task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            onDismiss()
        }
    }
}
