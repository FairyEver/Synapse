import Foundation
import Testing
@testable import SynapseMobile

/// 这几条来自手机外面的入口（「消息」里的记录、推送通知、桌面小组件）带来的都是一个**某一刻
/// 记下来的**会话 id，而那一刻可能早就过去了。
///
/// 这一组守的是那条判据本身，两个方向都要守：
/// - 电脑说「我的列表里没有它了」，或者「它结束了」—— 那就是开不开，别把人送进一块空画布；
/// - 而「还没有一份属于这台电脑的列表」不算 —— 把它读成结束，冷启动和切电脑的那一下会把
///   每一次正常的点击都换成一句「这个会话已经结束了」。
final class TerminalOpenabilityTests {

    @Test func aRunningSessionCanBeOpened() {
        #expect(resolve(sessionId: "s1", desktop: "d1", sessions: [("s1", "running")]) == .openable)
    }

    /// 电脑正在停它，但它还活着 —— 电脑的 `attach` 接受这一种，所以手机也必须接受。
    @Test func aSessionBeingStoppedCanStillBeOpened() {
        #expect(resolve(sessionId: "s1", desktop: "d1", sessions: [("s1", "stopping")]) == .openable)
    }

    /// 就是这一条：那条会话从电脑的列表里消失了，而记录/通知里还留着它的 id。
    /// 旧的写法会照样进终端页，于是手机摆出一块空画布，上面只有电脑回的那句
    /// 「该终端已结束。」—— 而返回的路要人自己找。
    @Test func aSessionTheDesktopNoLongerListsCannotBeOpened() {
        #expect(resolve(sessionId: "s9", desktop: "d1", sessions: [("s1", "running")]) == .ended)
    }

    /// 另一半：「在列表里」不等于「开得开」。电脑会把已经结束的终端留在列表里（它留着它们
    /// 只为让人显式清理），而它同样拒绝打开这些 —— 只按「在列表里」判，这一行点下去得到的
    /// 还是一块空画布，底部写着「已结束」。
    @Test func anEndedSessionInTheListCannotBeOpened() {
        #expect(resolve(sessionId: "s1", desktop: "d1", sessions: [("s1", "ended")]) == .ended)
        #expect(resolve(sessionId: "s1", desktop: "d1", sessions: [("s1", "failed")]) == .ended)
        #expect(resolve(sessionId: "s1", desktop: "d1", sessions: [("s1", "lost")]) == .ended)
    }

    /// 冷启动：通知把人带进来，而列表还没到。这不是「它结束了」。
    @Test func noListYetIsNotEnded() {
        let openability = TerminalOpenability.resolve(
            sessionId: "s1",
            desktopClientInstanceId: "d1",
            summary: nil
        )

        #expect(openability == .unknown)
    }

    /// 换电脑的那一瞬间：手上有一份列表，但不是**那台**电脑的。拿它去判，另一台电脑的
    /// 每一个会话 id 都会读成结束，一次正常的切换会变成一串「已经结束了」。
    @Test func anotherComputersListAnswersNothing() {
        let openability = TerminalOpenability.resolve(
            sessionId: "s1",
            desktopClientInstanceId: "d2",
            // 这份列表是 d1 的，而问题问的是 d2 上的一条会话。
            summary: summary(desktop: "d1", sessions: [("s1", "running")])
        )

        #expect(openability == .unknown)
    }

    /// 一条通知没记着是哪台电脑（老桌面端发的）。无从问起，就不是「没有」。
    @Test func aRequestThatNamesNoComputerAnswersNothing() {
        let openability = TerminalOpenability.resolve(
            sessionId: "s1",
            desktopClientInstanceId: nil,
            summary: summary(desktop: "d1", sessions: [("s1", "running")])
        )

        #expect(openability == .unknown)
    }

    /// 电脑能干地说「一个会话都没有」——那是一份列表，不是一份缺失的列表。
    @Test func anEmptyListIsAnAnswer() {
        #expect(resolve(sessionId: "s1", desktop: "d1", sessions: []) == .ended)
    }

    // MARK: - Fixtures

    private func resolve(
        sessionId: String,
        desktop: String?,
        sessions: [(id: String, status: String)]
    ) -> TerminalOpenability {
        TerminalOpenability.resolve(
            sessionId: sessionId,
            desktopClientInstanceId: desktop,
            summary: summary(desktop: desktop ?? "d1", sessions: sessions)
        )
    }

    private func summary(
        desktop: String,
        sessions: [(id: String, status: String)]
    ) -> MobileSummaryPayload {
        MobileSummaryPayload(
            desktopClientInstanceId: desktop,
            desktopName: "M1",
            revision: 1,
            groups: [],
            workspaces: nil,
            agentGroups: nil,
            agentProviders: nil,
            sessions: sessions.map { session($0.id, status: $0.status) }
        )
    }

    private func session(_ id: String, status: String) -> MobileSummarySession {
        MobileSummarySession(
            id: id,
            groupId: "g1",
            title: id,
            status: status,
            attention: MobileSummaryAttention(state: "not_waiting", kind: "unknown"),
            cwd: "/tmp",
            cols: 54,
            rows: 37,
            startedAt: "2026-01-01T00:00:00.000Z",
            lastLine: "",
            lastOutputSeq: 0,
            gridOwnerId: nil
        )
    }
}
