import SwiftUI

@main
struct SynapseMobileApp: App {
    /// Needed for the APNs token callback and for notification actions, which run
    /// without any scene attached.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = SynapseAppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // Owned by the model rather than made here: a summary can move a
                // terminal's display mode, and summaries arrive whatever screen is
                // showing.
                .environment(model.display)
                .tint(Theme.ink)
        }
    }
}
