import Foundation

/// 一个终端还开不开得开。
///
/// 手机上有五条路能进终端页：会话列表里的行、「消息」里的待处理行、「消息」里一条记录上的
/// 「打开终端」、推送通知、桌面小组件。**只有列表里那一行的 id 是当场从列表上取的**；其余
/// 几条来自某个更早的时刻 —— 一条通知记录记着「它完成那一轮时」的会话 id，而那一刻可能
/// 早就过去了。
///
/// 于是它们都要先问同一个问题：这个 id 现在还成不成立。**判据抄的是电脑那条 `attach` 的
/// 门槛**（`isRunning || isStopping`），不是手机自己发明的：
///
/// - 用「是不是在列表里」当判据是不够的 —— 电脑会把**已经结束**的终端留在列表里（它留着
///   它们只为让人显式清理），而这类终端它同样拒绝打开。手机按「在列表里」进去了，得到的
///   还是一块空画布；
/// - 用「不是运行中」反过来判又会误伤刚建出来的终端 —— 所以这一条只管**进之前**，进去之后
///   的判据是另一回事（见 `TerminalScreen.sessionIsGone`）。
///
/// 三态而不是布尔：`summary == nil`（列表还没到）和「电脑确实开不了它」是两件事。前者是
/// 什么都不知道，等一下就知道了；后者是电脑亲口说的，等多久都不会变。
enum TerminalOpenability: Equatable {
    /// 电脑的列表里有它，而且它活着 —— 就是电脑会接受打开的那种。
    case openable
    /// 开不开了。两种成因，对用户是同一件事：那条会话已经没了（列表里没有它），或者它已经
    /// 结束了（列表里还留着它，而电脑会拒绝）。电脑自己也是这么答的 —— 它的拒绝文案对两种
    /// 情况是同一句。
    case ended
    /// 还没有一份**属于这台电脑**的列表可用：刚启动、刚换电脑、连接还没建立。
    ///
    /// 不是「没有」，只是还不知道。判据必须是「这份列表属于这台电脑」而不只是「有一份列表」
    /// —— 否则在换电脑的瞬间，另一台电脑的列表会让每一个 id 都读成结束，一次正常的切换会
    /// 变成一串「这个会话已经结束了」。
    case unknown

    /// 这个结论在诊断日志里怎么写；`nil` 就是「不记」。
    ///
    /// `openable` 没有词，因为正常打开那一下人自己看得见、不需要日志；而「被拒绝」与
    /// 「还不知道」正是「为什么没进去」的全部价值所在 —— 一次真实的排查里，缺的就是这一格。
    /// 见 `SynapseAppModel.recordTerminalOpen`。
    var diagnosticFlag: DiagnosticFlag? {
        switch self {
        case .openable: nil
        case .ended: .rejected
        case .unknown: .unknown
        }
    }

    static func resolve(
        sessionId: String,
        desktopClientInstanceId: String?,
        summary: MobileSummaryPayload?
    ) -> TerminalOpenability {
        guard let desktopClientInstanceId,
              let summary,
              summary.desktopClientInstanceId == desktopClientInstanceId else {
            return .unknown
        }
        guard let session = summary.sessions.first(where: { $0.id == sessionId }) else {
            return .ended
        }
        return session.canBeOpened ? .openable : .ended
    }
}
