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
        /// 打开一个终端。`entry` 说这一下是从哪条路来的，一路带到判据那里去记日志。
        ///
        /// 记它是因为五条路里只有会话列表那一行是当场取会话号的：判据拒绝一次请求时，
        /// 「是谁在问」决定了那是设计里预料到的事，还是列表本身出了错。见 `TerminalOpenOrigin`。
        case terminal(sessionId: String, desktopClientInstanceId: String, entry: TerminalOpenOrigin)
        case meeting(meetingId: String)
        case message(id: String)
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

/// 一次「打开终端」请求是从哪条路来的。
///
/// 手机上有五条路能进终端页（见 `TerminalOpenability`），而**只有会话列表那一行是当场取
/// 会话号的**：另外四条带的都是某一刻记下来的号，那条会话后来结束、被删都不会让那份记录
/// 失效。于是判据拒绝一次请求时，「是哪条路在问」就成了排查里唯一还没有答案的那一格 ——
/// 它区分的是「一条旧通知 / 旧记录 / 小组件快照在问一个已经结束的会话」（上一版设计里
/// 预料到的事，文案本身没说错），与「会话列表这条路自己出了问题」（判据或列表有缺陷，
/// 完全另一件事，修法也不同）。
///
/// 一次真实的排查里，缺的正是这一格：手机上拒绝时什么都不记，只能靠排除法推到「不是正在
/// 看着的那个会话」，再往前就没了。所以这个值**一路带到记录的落点**，而不是当场记一条 ——
/// 排队的请求会在几秒后才被判定，那一刻「谁在问」已经不在栈上了。
enum TerminalOpenOrigin: String, Equatable, Sendable {
    /// 会话列表点一行。唯一一个当场取号的入口。
    case sessionList
    /// 点了一条推送通知。
    case pushNotification
    /// 「消息」里一条记录上的「打开终端」。
    case inboxRecord
    /// 桌面小组件的一行。它带的是快照那一刻的会话号，本来就可能已经旧了。
    case homeWidget
    /// 上一份列表还没到时排下的那个请求，现在轮到它了。
    case queuedRequest

    /// 记录里用哪个标签。五个入口各有自己的词：混成一个，就分不出「列表这条路出了问题」
    /// 和「一条旧记录在问」——而这正是这条记录要回答的那一件事。
    var diagnosticFlag: DiagnosticFlag {
        switch self {
        case .sessionList: .sessionList
        case .pushNotification: .pushNotification
        case .inboxRecord: .inboxRecord
        case .homeWidget: .homeWidget
        case .queuedRequest: .queuedRequest
        }
    }
}
