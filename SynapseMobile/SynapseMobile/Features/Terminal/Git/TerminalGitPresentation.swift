import Foundation

/// 这一轮所有「电脑给的那几个数，翻成人看的一句话」都在这里。
///
/// 全是纯函数，因为它们是**同一条规矩在不同地方的说法**，而那条规矩有一条必须守住的
/// 边界：电脑还没回答（`nil`）与电脑答「不是仓库」在屏幕上是同一句话（都退回版本号），
/// 与「是仓库」必须是不同的一句。判据只写在这里一次 —— 写进视图就等于让它跟着视图一起
/// 只被眼睛验，而这一轮最容易做塌的正是这里（见 `TerminalGitStatusState`）。
enum TerminalGitPresentation {

    // MARK: - 顶栏第二行

    /// 顶栏第二行。`nil` 与 `.notARepository` 都返回 `fallback`（现状那一句）。
    static func secondLine(_ status: TerminalGitStatusState.Status?, otherwise fallback: String) -> String {
        guard case .repository(let git) = status else { return fallback }
        return secondLine(git)
    }

    /// 是仓库时的第二行。
    ///
    /// 顺序就是设计文档决策四那张表：有改动说改动，干净但有未推送说领先，两样都没有就
    /// 只说分支。**不显示落后** —— 落后是「同步」要处理的事，不是抬头要看的告警。
    static func secondLine(_ status: MobileGitStatus) -> String {
        let name = branchLabel(status)
        if status.changeCount > 0 { return "\(name) · \(status.changeCount) 个改动" }
        if status.ahead > 0 { return "\(name) · 领先 \(status.ahead)" }
        return name
    }

    /// ⋯ 菜单里要不要出现「Git」那一行。
    ///
    /// 与第二行同一个判据：不是仓库时既不显示分支，也不摆一个点开是空的入口。
    static func isRepository(_ status: TerminalGitStatusState.Status?) -> Bool {
        if case .repository = status { return true }
        return false
    }

    /// 分支名，或者说明它没有分支名。
    ///
    /// 游离 HEAD 只说一个 sha 会被读成一条分支名，所以后面缀一句。
    static func branchLabel(_ status: MobileGitStatus) -> String {
        if let branch = status.branch { return branch }
        guard let sha = status.detachedSha else { return "游离 HEAD" }
        return "\(sha)（游离）"
    }

    // MARK: - 面板上的四行状态

    /// 远端那一行。没有上游时说的是「没设」而不是空 —— 空行什么都说明不了。
    static func remoteLabel(_ status: MobileGitStatus) -> String {
        status.upstream ?? "未设置"
    }

    static func syncLabel(_ status: MobileGitStatus) -> String {
        guard status.upstream != nil else { return "未设置远端" }
        if status.ahead > 0, status.behind > 0 { return "领先 \(status.ahead)，落后 \(status.behind)" }
        if status.ahead > 0 { return "领先 \(status.ahead) 个提交" }
        if status.behind > 0 { return "落后 \(status.behind) 个提交" }
        return "已与远端一致"
    }

    /// 改动那一行。**只有数量**：手机端不接收文件清单（设计文档决策六）。
    static func changeLabel(_ status: MobileGitStatus) -> String {
        status.changeCount > 0 ? "\(status.changeCount) 个文件已更改" : "工作区干净"
    }

    // MARK: - 四个动作什么时候可点

    /// 有改动才提交。没有改动时那一行不可点，右侧写「无改动」。
    static func canCommit(_ status: MobileGitStatus) -> Bool {
        status.changeCount > 0
    }

    static func commitUnavailableLabel(_ status: MobileGitStatus) -> String { "无改动" }

    /// 有未推送提交、或者根本没有上游（那就是「首次推送」要办的事）。
    static func canPush(_ status: MobileGitStatus) -> Bool {
        status.upstream == nil || status.ahead > 0
    }

    static func pushTitle(_ status: MobileGitStatus) -> String {
        status.upstream == nil ? "首次推送" : "推送"
    }

    static func pushUnavailableLabel(_ status: MobileGitStatus) -> String { "无未推送提交" }

    // MARK: - 分支列表的搜索

    /// 名字命中的本地分支。空查询就是全部。
    ///
    /// 大小写不敏感，因为分支名里的 `Feature/` 与 `feature/` 在用户眼里是同一个东西；
    /// 前后空白不算查询内容，那是手指在搜索框里蹭出来的。
    static func matchingBranches(_ branches: [MobileGitBranch], query: String) -> [MobileGitBranch] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return branches }
        return branches.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    // MARK: - 远端分支列表

    /// 按远端切段。**不重排**：顺序由电脑给（远端名 → 分支名）——
    /// 手机再排一次就是第二份排序规则，两份迟早会分叉。
    static func remoteBranchGroups(_ branches: [MobileGitRemoteBranch]) -> [TerminalGitRemoteBranchGroup] {
        var groups: [TerminalGitRemoteBranchGroup] = []
        for branch in branches {
            if let last = groups.indices.last, groups[last].remote == branch.remote {
                groups[last].branches.append(branch)
            } else {
                groups.append(TerminalGitRemoteBranchGroup(remote: branch.remote, branches: [branch]))
            }
        }
        return groups
    }

    /// 名字命中的远端分支。空查询就是全部。
    ///
    /// 匹配**限定名**（`origin/dev`）：那一行写的就是限定名，用户照着屏幕打什么就该中什么，
    /// 所以打 `origin/dev` 与打 `dev` 都命中。大小写与首尾空白的口径与本地分支一致。
    static func matchingRemoteBranches(
        _ branches: [MobileGitRemoteBranch],
        query: String
    ) -> [MobileGitRemoteBranch] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return branches }
        return branches.filter { $0.qualifiedName.localizedCaseInsensitiveContains(trimmed) }
    }
}

/// 远端列表里的一段：一个远端，和它下面那几条。
struct TerminalGitRemoteBranchGroup: Identifiable, Equatable {
    let remote: String
    var branches: [MobileGitRemoteBranch]

    var id: String { remote }
}
