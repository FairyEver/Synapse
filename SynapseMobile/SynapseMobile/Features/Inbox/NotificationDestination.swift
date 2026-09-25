import Foundation

/// 一条通知点下去该去哪。
///
/// 这段判断原本住在 `NotificationDetailView` 里。详情页随导航改版取消（通知的价值在
/// 「带你去哪」，不在「读它的全文」），而判断本身有了不止一个消费者 —— 通知面板里的行，
/// 以及 `.message(id)` 深链 —— 所以它得独立出来，不能跟着那一页一起消失。
///
/// 三个去向里只有第一个是应用里的位置。外部链接不是，它交给系统浏览器；没有去处的那一类
/// 留在原地让人读，这正是取消详情页之后它们的归宿。
enum NotificationDestination {

    enum Outcome: Equatable {
        /// 走 `NotificationRouter` 的路由。
        case route(NotificationRouter.Destination)
        /// 一条外部链接，交给 `openURL`。
        case externalURL(URL)
        /// 没有可去的地方。
        case none
    }

    static func resolve(_ item: SynapseNotification) -> Outcome {
        // 终端的两类来源指名同一个会话。`deviceId` 为空串是既有写法：老桌面端发的通知
        // 不带电脑 id，而路由那边把空串读成「没指名电脑」，会退回当前看着的那一台。
        if item.source == "terminal-attention" || item.source == "terminal-complete",
           let target = item.targetId {
            return .route(.terminal(
                sessionId: target,
                desktopClientInstanceId: item.deviceId ?? "",
                entry: .inboxRecord
            ))
        }
        // 转写结果在服务端，不依赖任何一台电脑。
        if item.source == "meeting-transcription", let target = item.targetId {
            return .route(.meeting(meetingId: target))
        }
        // 只有 HTTPS 打开。这一条沿用的是详情页里那个判断，不是新加的限制。
        if let raw = item.url, let url = URL(string: raw), url.scheme == "https" {
            return .externalURL(url)
        }
        return .none
    }
}
