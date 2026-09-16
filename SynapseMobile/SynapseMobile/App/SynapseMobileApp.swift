import SwiftUI

@main
struct SynapseMobileApp: App {
    /// Needed for the APNs token callback and for notification actions, which run
    /// without any scene attached.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = SynapseAppModel()
    @State private var display = TerminalDisplaySettings()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(display)
                .tint(Theme.ink)
        }
    }
}
