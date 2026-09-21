import Foundation
import Testing

@testable import SynapseMobile

/// 手机半边：解开电脑推来的 Git 状态，并决定「没什么可显示」是哪一种没什么。
///
/// 这里几乎每一条都不是选择 —— 分支名、改动数、领先落后都是电脑的事实，原样显示。
/// 真正是选择的是那个**三态**：还没收到回答、不是仓库、是仓库。前两者在屏幕上长得
/// 一样（第二行都退回版本号），含义却相反：一个是「等一下就好」，一个是「这里没有
/// Git 可看」，而后者还要把 ⋯ 菜单里的那一行收起来。
struct TerminalGitStatusTests {

    // MARK: - 解码

    private func decode(_ json: String) -> MobileGitStatusPayload? {
        try? JSONDecoder().decode(MobileGitStatusPayload.self, from: Data(json.utf8))
    }

    private func payload(
        status: MobileGitStatus?,
        desktopClientInstanceId: String = "desktop-1",
        sessionId: String = "sess-1"
    ) -> MobileGitStatusPayload {
        MobileGitStatusPayload(
            desktopClientInstanceId: desktopClientInstanceId,
            mobileClientInstanceId: "phone-1",
            sessionId: sessionId,
            revision: 1,
            status: status
        )
    }

    private func status(
        branch: String? = "main",
        detachedSha: String? = nil,
        ahead: Int = 0,
        changeCount: Int = 0
    ) -> MobileGitStatus {
        MobileGitStatus(
            cwd: "/Users/liy/code/Synapse",
            branch: branch,
            detachedSha: detachedSha,
            upstream: "origin/main",
            ahead: ahead,
            behind: 0,
            changeCount: changeCount,
            hasConflicts: false
        )
    }

    @Test func decodesARepositorySnapshot() throws {
        let decoded = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "mobileClientInstanceId": "phone-1",
          "sessionId": "sess-1",
          "revision": 3,
          "status": {
            "cwd": "/Users/liy/code/Synapse",
            "branch": "main",
            "upstream": "origin/main",
            "ahead": 2,
            "behind": 1,
            "changeCount": 3,
            "hasConflicts": false
          }
        }
        """))

        #expect(decoded.sessionId == "sess-1")
        #expect(decoded.revision == 3)
        let status = try #require(decoded.status)
        #expect(status.cwd == "/Users/liy/code/Synapse")
        #expect(status.branch == "main")
        #expect(status.ahead == 2)
        #expect(status.behind == 1)
        #expect(status.changeCount == 3)
        #expect(status.hasConflicts == false)
        // 缺席而不是 null：游离 HEAD 没有分支名。
        #expect(status.detachedSha == nil)
    }

    @Test func readsNotARepositoryOutOfANullStatus() throws {
        // `null` 是一个答案，不是缺席。这一条与下一条一起把那个三态钉住。
        let decoded = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "mobileClientInstanceId": "phone-1",
          "sessionId": "sess-1",
          "revision": 1,
          "status": null
        }
        """))

        #expect(decoded.status == nil)
    }

    @Test func keepsDetachedHeadApartFromNoBranch() throws {
        let decoded = try #require(decode("""
        {
          "desktopClientInstanceId": "desktop-1",
          "mobileClientInstanceId": "phone-1",
          "sessionId": "sess-1",
          "revision": 1,
          "status": {
            "cwd": "/tmp",
            "branch": null,
            "detachedSha": "0a1b2c3",
            "upstream": null,
            "ahead": 0,
            "behind": 0,
            "changeCount": 0,
            "hasConflicts": true
          }
        }
        """))

        let status = try #require(decoded.status)
        #expect(status.branch == nil)
        #expect(status.detachedSha == "0a1b2c3")
        #expect(status.upstream == nil)
        #expect(status.hasConflicts)
    }

    // MARK: - 三态

    @Test func saysNothingAtAllForAComputerThatHasNotAnswered() {
        var state = TerminalGitStatusState()

        // 还没回答 = `nil`。第二行保持现状不动。
        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == nil)
    }

    @Test func tellsNotARepositoryApartFromNoAnswerYet() {
        var state = TerminalGitStatusState()
        state.adopt(payload(status: nil))

        // 这两条是同一个类型上的两个不同值，也是这个类型存在的全部理由：屏幕上它们
        // 都是「第二行显示版本号」，而含义相反。
        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == .notARepository)
        // 另一个会话仍然是「还没回答」—— 答案是按终端记的。
        #expect(state.status(for: "sess-2", onSelected: "desktop-1") == nil)
    }

    @Test func givesBackTheRepositoryItWasSent() {
        var state = TerminalGitStatusState()
        state.adopt(payload(status: status(branch: "release", changeCount: 3)))

        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == .repository(status(branch: "release", changeCount: 3)))
    }

    @Test func ignoresAnAnswerFromAComputerThatIsNotTheOneOnScreen() {
        var state = TerminalGitStatusState()
        state.adopt(payload(status: status(), desktopClientInstanceId: "desktop-2"))

        // 手机只认正在看的那台电脑：另一台的仓库状态画在这台的分支行上，说的是别人的事。
        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == nil)
        // 也没有电脑被选中时同理。
        #expect(state.status(for: "sess-1", onSelected: nil) == nil)
        #expect(state.status(for: "sess-1", onSelected: "desktop-2") != nil)
    }

    @Test func replacesTheAnswerForTheSessionItIsAbout() {
        var state = TerminalGitStatusState()
        state.adopt(payload(status: status(changeCount: 3)))
        state.adopt(payload(status: status(changeCount: 0)))

        // 整份是快照：电脑说了算，手机不合并。
        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == .repository(status(changeCount: 0)))
    }

    @Test func forgetsEverythingOnSignOut() {
        var state = TerminalGitStatusState()
        state.adopt(payload(status: status()))

        state.reset()

        // 仓库状态连着电脑上的目录路径：换个人登进来不该看到上一个人在哪个仓库上。
        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == nil)
    }

    @Test func forgetsATerminalThatIsGone() {
        var state = TerminalGitStatusState()
        state.adopt(payload(status: status()))
        state.adopt(payload(status: status(), sessionId: "sess-2"))

        state.forget(sessionId: "sess-1")

        #expect(state.status(for: "sess-1", onSelected: "desktop-1") == nil)
        #expect(state.status(for: "sess-2", onSelected: "desktop-1") != nil)
    }
}
