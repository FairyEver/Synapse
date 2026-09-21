import Foundation

/// 终端当前目录的 Git 状态，按「哪个终端」记，并且记住是哪台电脑说的。
///
/// 这个类型存在的理由是**三态**，而不是一个可选的 `MobileGitStatus`：
///
/// - 还没收到回答 → `nil`：顶栏第二行保持现状不动（显示版本号那一行）；
/// - 收到了，但那个目录不是 Git 仓库 → `.notARepository`：第二行也退回版本号，
///   但这是**一个答案**，而且 ⋯ 菜单里的「Git」不渲染；
/// - 收到了，是个仓库 → `.repository(status)`：第二行显示分支与改动数。
///
/// 把前两者合成一个 `nil` 是这一轮最容易做塌的地方：一台还没回答的电脑与一个不是仓库
/// 的目录在屏幕上长得一样，含义却完全不同 —— 前者是「等一下就好」，后者是「这里没有
/// Git 可看」。所以「缺席」与「不是仓库」在这里是两个值，`TerminalQuickPhrasesState`
/// 用 `Optional` 而不是空数组守的也是同一条线。
///
/// 按 `sessionId` 分开记：同一个手机可以同时开着好几个终端（`attach` 是每个会话一次），
/// 而这条消息是点对点发的、一次只讲一个会话。归档时再按「哪台电脑」过滤一遍 —— 载荷
/// 自己带着发件人，手机只认正在看的那台电脑。
struct TerminalGitStatusState: Equatable {
    /// 一个会话的一次回答。`status` 为 `nil` 就是那个「不是仓库」的答案。
    private struct Answer: Equatable {
        let desktopClientInstanceId: String
        let status: MobileGitStatus?
    }

    private var bySession: [String: Answer] = [:]

    /// 三态的那三个值。缺席由 `answer(...)` 返回 `nil` 表达。
    enum Status: Equatable {
        case notARepository
        case repository(MobileGitStatus)
    }

    /// 收到就替换掉这个会话上一次的答案 —— 整份是快照，不是增量。
    ///
    /// 不判断发件人是不是正在看的那台电脑：`sync` 发给它选中的那台，所以别台电脑的
    /// 消息是「早一步的答案迟到了」，不是错误。留着只占一个格子，用户切回去就省一次
    /// 往返 —— 与 `TerminalToolbarState` 同一条规矩。
    mutating func adopt(_ payload: MobileGitStatusPayload) {
        bySession[payload.sessionId] = Answer(
            desktopClientInstanceId: payload.desktopClientInstanceId,
            status: payload.status
        )
    }

    /// 退出登录时清掉：这是另一个账号的电脑的仓库状态，而且它连着目录路径。
    mutating func reset() {
        bySession = [:]
    }

    /// 正在看的电脑上、某个会话的答案，或者 `nil` —— 那台电脑还没回答过。
    func status(for sessionId: String, onSelected desktopClientInstanceId: String?) -> Status? {
        guard let desktopClientInstanceId,
              let answer = bySession[sessionId],
              answer.desktopClientInstanceId == desktopClientInstanceId
        else { return nil }
        guard let status = answer.status else { return .notARepository }
        return .repository(status)
    }

    /// 终端关掉之后那条记录没有意义了，顺手带走 —— 它连着一个已经不存在的会话。
    mutating func forget(sessionId: String) {
        bySession.removeValue(forKey: sessionId)
    }
}
