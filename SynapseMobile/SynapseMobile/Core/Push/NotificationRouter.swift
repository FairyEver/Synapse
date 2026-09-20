import Foundation
import Observation

/// Where a notification tap should take the user.
///
/// The delegate that receives the tap is not the view layer, and on a cold launch
/// it runs before any scene exists. So the destination is parked here and the UI
/// picks it up whenever it becomes able to act on it.
///
/// This is the half of a notification that makes it useful. Delivering an alert
/// that says a session needs attention, then dropping the user on a list they
/// have to search, misses the point of the feature.
@Observable
final class NotificationRouter {
    static let shared = NotificationRouter()

    enum Destination: Equatable {
        case terminal(sessionId: String, desktopClientInstanceId: String)
        case meeting(meetingId: String)
        /// 开始一段新录音。目前只有主屏长按图标那条快捷操作会用它。
        case newRecording
        /// 看正在录的那一条。锁屏和灵动岛上那张卡点开时用它。
        ///
        /// 和 `.newRecording` 是两件事，不能合并：这个只把录音页浮出来，**不起新录音**
        /// ——卡片还在、录音却已经没了（App 被系统杀掉过）时，凭空起一条正是用户没要的。
        case liveRecording
    }

    /// Non-nil until the UI consumes it.
    var pending: Destination?

    private init() {}

    func route(to destination: Destination) {
        pending = destination
    }

    func consume() -> Destination? {
        defer { pending = nil }
        return pending
    }

    /// 丢掉一条还没被消费的去向。
    ///
    /// 退出登录要用：这条通知可能是上一个账号还在时收到、点开、停在那里的，它指的
    /// 终端或录音都不属于下一个人。留着它，下一个人登录进去会被直接带到别人的会话上，
    /// 而那里只会说「这个终端打不开」——一句话都说明不了。
    func discard() {
        pending = nil
    }
}
