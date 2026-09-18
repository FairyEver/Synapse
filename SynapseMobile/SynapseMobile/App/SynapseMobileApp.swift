import SwiftUI

@main
struct SynapseMobileApp: App {
    /// Needed for the APNs token callback and for notification actions, which run
    /// without any scene attached.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = SynapseAppModel()

    init() {
        // 尽早：越早开始记，越可能记下"启动就崩"那一类。它自己不阻塞 ——
        // 建目录失败就整个子系统关掉，App 一个字都不用知道。
        DiagnosticLog.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // Owned by the model rather than made here: a summary can move a
                // terminal's display mode, and summaries arrive whatever screen is
                // showing.
                .environment(model.display)
                // Owned by the model for the same reason: what was last used is
                // recorded where the request was decided, not where it was drawn.
                .environment(model.conversationDefaults)
                .tint(Theme.ink)
        }
    }
}
