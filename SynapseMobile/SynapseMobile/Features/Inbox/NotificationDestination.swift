import Foundation

/// 一条通知点下去该去哪。
///
/// 这段判断由通知页里的行和 `.message(id)` 深链共用；无目标的通知可打开全文。
///
/// 三个去向里只有第一个是应用里的位置。网址由通知页按来源决定浏览器；没有去处的那一类
/// 打开全文，由通知页决定呈现方式。
enum NotificationDestination {

    enum Outcome: Equatable {
        /// 走 `NotificationRouter` 的路由。
        case route(NotificationRouter.Destination)
        /// 一条 HTTPS 链接，交给通知页的浏览入口。
        case externalURL(URL)
        /// 没有可去的地方。
        case none
    }

    static func requiresFreshRead(_ item: SynapseNotification) -> Bool {
        item.source == "todo-reminder" || item.source == "drive-discussion"
    }

    static func resolve(_ item: SynapseNotification, origin: URL = AppConfiguration.apiOrigin) -> Outcome {
        if item.source == "drive-discussion" {
            let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
            guard (1...120).contains(item.id.utf8.count), item.id.unicodeScalars.allSatisfy({ allowed.contains($0) }),
                  origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil,
                  var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return .none }
            components.path = "/notifications/\(item.id)/open"
            components.query = nil; components.fragment = nil
            guard let url = components.url else { return .none }
            return .externalURL(url)
        }
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
        if item.source == "mail-internal", let target = item.targetId {
            return .route(.mail(messageId: target))
        }
        if item.source == "todo-reminder" {
            guard let target = item.targetId, TodoReference.isValidID(target) else { return .none }
            return .route(.todo(id: target))
        }
        // 只有 HTTPS 打开。这一条沿用的是详情页里那个判断，不是新加的限制。
        if let raw = item.url, let url = URL(string: raw), url.scheme == "https" {
            return .externalURL(url)
        }
        return .none
    }

    static func actionLabel(for item: SynapseNotification) -> String {
        if item.source == "drive-discussion" {
            guard let meta = item.driveDiscussion, ["annotation", "message"].contains(meta.kind) else { return "查看文档" }
            if meta.action == "replied" { return "查看回复" }
            guard meta.action == "created" else { return "查看文档" }
            return meta.kind == "annotation" ? "查看评论" : "查看留言"
        }
        switch resolve(item) {
        case .route(.terminal): return "打开终端"
        case .route(.meeting): return "查看转写"
        case .route(.mail): return "查看站内信"
        case .route(.todo): return "查看待办"
        case .route: return "查看通知"
        case .externalURL: return "打开链接"
        case .none: return "查看通知"
        }
    }
}
