import SwiftUI

/// 通知面板的壳。
///
/// 面板是一个**覆盖层**，不是导航栈里的一层：它从主页右上角的铃铛浮上来，关掉它就回到
/// 刚才那一屏，而不是在栈里留下一条「刚才我看过通知」的痕迹。所以它用 `.sheet` 而不是
/// 推入的一屏。
///
/// 它自带 `NavigationStack`：`InboxView` 的导航栏（标题、「全部已读」）得有一个栏可挂。
struct NotificationPanel: View {
    /// 点了一条通知：按它自己的目标去。宿主负责先关掉面板。
    let onOpen: (SynapseNotification) -> Void
    /// 待处理那一段点了一行。
    let onOpenTerminal: (String) -> Void

    var body: some View {
        NavigationStack {
            InboxView(onOpen: onOpen, onOpenTerminal: onOpenTerminal)
        }
    }
}
