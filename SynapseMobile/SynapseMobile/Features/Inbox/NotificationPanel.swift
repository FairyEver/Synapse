import SwiftUI

/// 通知面板。主页右上角那枚铃铛打开的就是它。
///
/// 它是一个**覆盖层**，不是一个位置 —— 通知的意义是「带你去某个地方」，读完它本身没有
/// 价值。所以点一条就把它收起来，直接去往目标：比「进一个消息位置 → 列表 → 详情 → 再跳转」
/// 少两步。
///
/// 取消详情页的代价是正文只能进到行里（最多两行）。这是划算的：通知的正文几乎总是
/// 一句话能说完的，而它要换来的那两步，是每一次点通知都要付的。
struct NotificationPanel: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// 「待处理」段里的行打开一个终端会话。
    let onOpenTerminal: (String) -> Void

    var body: some View {
        NavigationStack {
            InboxView(onOpenTerminal: openTerminal) { item in
                open(item)
            }
            .navigationTitle("通知")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // sheet 会盖住底层屏幕挂的那条通知覆盖层，所以这一层要自己再挂一次 ——
        // 与剪贴板 sheet 同一个做法。
        .noticeOverlay(model)
    }

    /// 点一条通知：先标已读，再按它自己的去向往外走。
    ///
    /// 走之前就收起来。留着一个盖住目标的 sheet，等于让人再点一次「完成」才看得见
    /// 他刚刚要求去的地方。
    private func open(_ item: SynapseNotification) {
        Task { await model.readNotification(item.id) }
        switch NotificationDestination.resolve(item) {
        case .route(let destination):
            dismiss()
            NotificationRouter.shared.route(to: destination)
        case .externalURL(let url):
            dismiss()
            openURL(url)
        case .none:
            // 没有去处的那一类留在原地读 —— 收起面板等于把它从眼前拿走。
            break
        }
    }

    private func openTerminal(_ sessionId: String) {
        dismiss()
        onOpenTerminal(sessionId)
    }
}
