import Foundation
import Testing

@testable import SynapseMobile

/// 手机半边：电脑给的那几个数，翻成人看的那几句话。
///
/// 这里最要紧的一条不是措辞，是**三态**：「还没收到回答」与「不是仓库」在屏幕上必须是
/// 同一句话（都退回版本号），与「是仓库」必须是不同的一句。中间那一态是个答案而不是
/// 缺席（见 `TerminalGitStatusState`），所以它不能落到分支那一支去 —— 一个不存在的分支
/// 名会比没有分支名更糟。
struct TerminalGitPresentationTests {

    private let fallback = "运行中 · 1.0.16 (13)"

    private func status(
        branch: String? = "main",
        detachedSha: String? = nil,
        upstream: String? = "origin/main",
        ahead: Int = 0,
        behind: Int = 0,
        changeCount: Int = 0,
        hasConflicts: Bool = false
    ) -> MobileGitStatus {
        MobileGitStatus(
            cwd: "/Users/liy/code/Synapse",
            branch: branch,
            detachedSha: detachedSha,
            upstream: upstream,
            ahead: ahead,
            behind: behind,
            changeCount: changeCount,
            hasConflicts: hasConflicts
        )
    }

    // MARK: - 顶栏第二行

    @Test func saysNothingNewBeforeTheComputerHasAnswered() {
        // 还没收到回答 = 保持现状，一个字都不改。
        #expect(TerminalGitPresentation.secondLine(nil, otherwise: fallback) == fallback)
    }

    @Test func notARepositoryAlsoFallsBackToTheVersionLine() {
        // 与上一条同样的输出，不同的含义：这一条是**一个答案**。它是这一轮最容易做塌的
        // 地方 —— 把它当成「有东西可显示」就会画出一行不存在的分支。
        #expect(TerminalGitPresentation.secondLine(.notARepository, otherwise: fallback) == fallback)
    }

    @Test func showsTheBranchAndTheChangeCount() {
        let line = TerminalGitPresentation.secondLine(.repository(status(changeCount: 3)), otherwise: fallback)
        #expect(line == "main · 3 个改动")
    }

    @Test func aCleanTreeWithUnpushedCommitsSaysHowMany() {
        let line = TerminalGitPresentation.secondLine(.repository(status(ahead: 2)), otherwise: fallback)
        #expect(line == "main · 领先 2")
    }

    @Test func aCleanSyncedTreeIsJustTheBranchName() {
        #expect(TerminalGitPresentation.secondLine(.repository(status()), otherwise: fallback) == "main")
    }

    @Test func changesComeBeforeUnpushedCommits() {
        // 决策四那张表的顺序：有改动说改动。两样都有时说的是更紧急的那一件。
        let line = TerminalGitPresentation.secondLine(.repository(status(ahead: 2, changeCount: 3)), otherwise: fallback)
        #expect(line == "main · 3 个改动")
    }

    @Test func detachedHeadIsNamedAsOne() {
        // 只说一个 sha 会被读成一条分支名，所以后面缀一句。
        let line = TerminalGitPresentation.secondLine(
            .repository(status(branch: nil, detachedSha: "a1b2c3d", upstream: nil)),
            otherwise: fallback
        )
        #expect(line == "a1b2c3d（游离）")
    }

    @Test func neverSaysBehindOnTheSecondLine() {
        // 落后是同步要处理的事，不是抬头要看的告警（决策四）。面板里才说。
        let line = TerminalGitPresentation.secondLine(.repository(status(behind: 5)), otherwise: fallback)
        #expect(line == "main")
    }

    @Test func theGitEntryExistsOnlyForARepository() {
        #expect(TerminalGitPresentation.isRepository(.repository(status())))
        #expect(!TerminalGitPresentation.isRepository(.notARepository))
        #expect(!TerminalGitPresentation.isRepository(nil))
    }

    // MARK: - 面板那四行

    @Test func thePanelSaysWhatTheComputerSaid() {
        #expect(TerminalGitPresentation.remoteLabel(status()) == "origin/main")
        #expect(TerminalGitPresentation.remoteLabel(status(upstream: nil)) == "未设置")
        #expect(TerminalGitPresentation.syncLabel(status()) == "与上次获取的远端一致")
        #expect(TerminalGitPresentation.syncLabel(status(ahead: 2)) == "领先 2 个提交")
        #expect(TerminalGitPresentation.syncLabel(status(behind: 3)) == "落后 3 个提交")
        #expect(TerminalGitPresentation.syncLabel(status(ahead: 2, behind: 3)) == "领先 2，落后 3")
        #expect(TerminalGitPresentation.syncLabel(status(upstream: nil)) == "未设置远端")
        #expect(TerminalGitPresentation.changeLabel(status(changeCount: 3)) == "3 个文件已更改")
        #expect(TerminalGitPresentation.changeLabel(status()) == "工作区干净")
    }

    // MARK: - 四个动作什么时候可点

    @Test func commitNeedsChanges() {
        #expect(TerminalGitPresentation.canCommit(status(changeCount: 1)))
        #expect(!TerminalGitPresentation.canCommit(status()))
    }

    @Test func pushIsAvailableForUnpushedCommitsOrForAFirstPush() {
        #expect(TerminalGitPresentation.canPush(status(ahead: 1)))
        // 没有上游时也要能点：那正是「首次推送」这个动作存在的理由。
        #expect(TerminalGitPresentation.canPush(status(upstream: nil)))
        #expect(!TerminalGitPresentation.canPush(status()))
    }

    @Test func aBranchWithNoUpstreamSaysFirstPush() {
        #expect(TerminalGitPresentation.pushTitle(status(upstream: nil)) == "首次推送")
        #expect(TerminalGitPresentation.pushTitle(status()) == "推送")
    }

    // MARK: - 分支列表的搜索

    @Test func filtersBranchesByName() {
        let branches = [branch("main", current: true), branch("feature/Login"), branch("fix/scroll")]
        #expect(TerminalGitPresentation.matchingBranches(branches, query: "").count == 3)
        #expect(TerminalGitPresentation.matchingBranches(branches, query: "  ").count == 3)
        // 大小写不敏感：`Feature/` 与 `feature/` 在用户眼里是同一个东西。
        #expect(TerminalGitPresentation.matchingBranches(branches, query: "LOGIN").map(\.name) == ["feature/Login"])
        // 搜不到就是空，交给空态去说 —— 不是悄悄退回全部。
        #expect(TerminalGitPresentation.matchingBranches(branches, query: "nope").isEmpty)
    }

    private func branch(_ name: String, current: Bool = false) -> MobileGitBranch {
        MobileGitBranch(name: name, current: current)
    }

    // MARK: - 远端分支

    @Test func groupsRemoteBranchesWithoutReorderingThem() {
        let branches = [
            remote("origin", "main"),
            remote("origin", "dev"),
            remote("team/fork", "main"),
        ]

        let groups = TerminalGitPresentation.remoteBranchGroups(branches)

        // 只切开，不重排：顺序由电脑给（远端名 → 分支名），手机上再排一次就是第二份规则。
        #expect(groups.map(\.remote) == ["origin", "team/fork"])
        #expect(groups[0].branches.map(\.name) == ["main", "dev"])
        #expect(groups[1].branches.map(\.name) == ["main"])
    }

    @Test func anEmptyRemoteListHasNoGroups() {
        #expect(TerminalGitPresentation.remoteBranchGroups([]).isEmpty)
    }

    @Test func filtersRemoteBranchesByTheirQualifiedName() {
        let branches = [remote("origin", "main"), remote("origin", "feature/Login"), remote("team/fork", "dev")]

        #expect(TerminalGitPresentation.matchingRemoteBranches(branches, query: "").count == 3)
        #expect(TerminalGitPresentation.matchingRemoteBranches(branches, query: "   ").count == 3)
        // 那一行写的就是限定名，用户照着屏幕打什么就该中什么。
        // 打限定名命中（那一行写的就是它），打裸分支名也命中。
        #expect(TerminalGitPresentation.matchingRemoteBranches(branches, query: "origin/main").map(\.name)
            == ["main"])
        #expect(TerminalGitPresentation.matchingRemoteBranches(branches, query: "dev").map(\.qualifiedName)
            == ["team/fork/dev"])
        // 大小写不敏感，与本地分支同一口径。
        #expect(TerminalGitPresentation.matchingRemoteBranches(branches, query: "LOGIN").map(\.name)
            == ["feature/Login"])
        #expect(TerminalGitPresentation.matchingRemoteBranches(branches, query: "nope").isEmpty)
    }

    /// 远端名本身可以含 `/`，所以限定名的拼法不能被拆歧义掉。
    @Test func aRemoteNameContainingASlashStillQualifies() {
        #expect(remote("team/fork", "dev").qualifiedName == "team/fork/dev")
    }

    private func remote(_ remote: String, _ name: String) -> MobileGitRemoteBranch {
        MobileGitRemoteBranch(remote: remote, name: name)
    }
}
