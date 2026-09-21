import Foundation

/// 手机端做 Git 操作时要问电脑的两件事：发一个 intent，说一句话。
///
/// 捆在一起是因为它们总是一起出现，而且**它们是 flow 唯一看不见的东西**。flow 不认识
/// `SynapseAppModel`，这不是洁癖：这一轮真要验的不是画面对不对，是**时序** ——
/// 「提交并切换」为什么是两个 intent 而不是一个复合动作、冲突为什么不问「要不要重试」，
/// 都是需要有上下游才能钉住的东西。
@MainActor
struct TerminalGitDesk {
    /// 发一个 `git` intent 并等电脑回答；等不到就是 `nil`。
    let send: @MainActor (MobileIntentRequest, TimeInterval) async -> MobileIntentResult?
    /// 说一句给用户看的话。参数与 `SynapseAppModel.notice` 一致。
    let notice: @MainActor (String, NoticeTone, String) -> Void
}

/// 手机点的那一下，在电脑上要做的事。
enum TerminalGitPendingSwitch: Equatable, Identifiable {
    /// 切到这条分支。
    case checkout(String)
    /// 新建这条分支（起点缺席＝从当前 HEAD 起）之后直接切过去。
    case createBranch(name: String, from: String?)
    /// 与这条分支合并。
    case merge(branch: String, direction: TerminalGitMergeDirection)
    /// 迁出这条远端分支。`localBranch` 缺席＝建一条同名的跟踪分支。
    case checkoutRemote(remote: String, branch: String, localBranch: String?)

    var id: String {
        switch self {
        case .checkout(let branch): return "checkout:\(branch)"
        case .createBranch(let name, let from): return "create:\(name):\(from ?? "")"
        case .merge(let branch, let direction): return "merge:\(direction.rawValue):\(branch)"
        case .checkoutRemote(let remote, let branch, let localBranch):
            return "checkoutRemote:\(remote)/\(branch):\(localBranch ?? "")"
        }
    }

    /// 「丢弃改动」这一步对哪些成立。
    ///
    /// `checkout` 与 `checkoutRemote` 都成立：前者是 `checkout -f`，后者是
    /// `checkout -f -b <local> --track <remote>/<branch>` —— **这条原语 git 有**。
    /// 而且同一件事说不通会很难看：本地 `feature-x` 跟踪着 `origin/feature-x` 时，
    /// 从「分支」行进去有三个选项、从远端列表进来只有两个，用户看到的是同一个操作。
    ///
    /// 新建与合并仍然只有两个：git 没有「把改动丢掉、但留在原地新建一条分支」这条原语
    /// —— 少一个选项，不是少一次确认。
    var canDiscardChanges: Bool {
        switch self {
        case .checkout, .checkoutRemote: return true
        case .createBranch, .merge: return false
        }
    }
}

/// 填另一个本地名那一页要的全部东西。
///
/// 名字存在这里、不存在视图的临时状态里：失败之后那一页要留着，用户刚打的字也要留着。
struct TerminalGitLocalNamePrompt: Identifiable, Equatable {
    let remote: String
    let branch: String
    /// **电脑给的原话**：这一页为什么在问。不改写、不翻译。
    var message: String
    /// 用户打的字。默认空 —— 不做任何猜测（猜一个名字然后建错分支，比多打几个字糟）。
    var name: String = ""

    var qualifiedName: String { "\(remote)/\(branch)" }
    var id: String { qualifiedName }
}

/// 合并的方向。`rawValue` 就是线上的值，见 `shared/src/mobile-live.ts`。
enum TerminalGitMergeDirection: String, CaseIterable, Identifiable {
    /// 把其他分支合并到当前分支，合完停在原地。
    case intoCurrent
    /// 把当前分支的成果并进选中的分支：切过去、合并、再切回来。
    case outOfCurrent

    var id: String { rawValue }

    var label: String {
        switch self {
        case .intoCurrent: return "把其他分支合并到当前分支"
        case .outOfCurrent: return "把当前分支合并到其他分支"
        }
    }

    /// 第二行说明：这一行下面写清它实际会走的链路，不让用户以为终端没动过。
    func detail(currentBranch: String) -> String {
        switch self {
        case .intoCurrent: return "合进 \(currentBranch)，合完停在这里"
        case .outOfCurrent: return "先切过去、合并、再切回 \(currentBranch)"
        }
    }
}

/// 一次失败要说的话。
///
/// 标题是**动作名**，正文是**电脑返回的原文** —— 不改写、不翻译、不替它编一个原因。
/// 电脑真的什么都没说时才退回「电脑没有完成这个操作」。
struct TerminalGitFailure: Identifiable, Equatable {
    /// 「下一步」：能给的都要给。推送被拒给「同步」，同步遇脏给「去提交」。
    enum Next: Equatable {
        case sync
        case commit
    }

    let id = UUID()
    let title: String
    let message: String
    var next: Next?
}

/// 面板与它下面那几页的状态机。
///
/// 它只管两件事：**导航走到了哪一页**，以及**从电脑的回答里长出来的那三种界面** ——
/// 脏工作区的三选一、合并冲突页、错误弹窗。画面由 `TerminalGitPanel` 与它的子页画，
/// 动作的时序全部在这里，因为时序才是会做错的那一半。
@MainActor
@Observable
final class TerminalGitFlow: Identifiable {

    /// 面板里能走到的那几页。
    enum Route: Hashable {
        /// 分支列表。三个地方用它，选中的去向由 `purpose` 决定。
        case branches(TerminalGitBranchPurpose)
        case newBranch
        case commit
        case merge
        /// 远端分支列表。
        case remoteBranches
        /// 同名本地分支不能直接用，要另一个名字。**推一页而不是弹一张表**：
        /// 失败弹窗挂在面板上，表盖在面板之上时弹窗会被它挡住。
        case remoteLocalName
    }

    let sessionId: String

    /// 一个终端一个面板：这一次弹出来的讲的就是这个会话的事，所以会话 id 就是它的身份。
    var id: String { sessionId }

    var path: [Route] = []
    /// 手上有一个动作正在电脑上跑。它只管把动作行按住，不管画面遮罩。
    var isBusy = false

    // MARK: 分支列表

    var branches: [MobileGitBranch] = []
    var branchQuery = ""
    var isLoadingBranches = false

    // MARK: 远端分支

    var remoteBranches: [MobileGitRemoteBranch] = []
    var remoteBranchQuery = ""
    var isLoadingRemoteBranches = false
    /// 重名时要另一个本地名：这一页为什么在问（电脑原话）与用户打的字。
    var localNamePrompt: TerminalGitLocalNamePrompt?

    // MARK: 新建分支

    var newBranchName = ""
    /// 起点。`nil` ＝ 从当前 HEAD 起（电脑那边就是这样理解缺席的），显示时换成当前分支名。
    var newBranchFrom: String?

    // MARK: 提交

    var commitMessage = ""
    /// 「提交后立即推送」，**默认关**：推送是对外动作，不该在用户没要求时发生。
    var pushAfterCommit = false

    // MARK: 合并

    var mergeDirection: TerminalGitMergeDirection = .intoCurrent
    var mergeBranch: String?

    // MARK: 三种从回答里长出来的界面

    /// 脏工作区，要用户先选一个走法。
    var decision: TerminalGitPendingSwitch?
    /// 「丢弃改动并切换」的二次确认。确认之后才真的丢。
    var discardConfirmation: TerminalGitPendingSwitch?
    /// 合并冲突的结论。这一页**只说明与复制** —— 没有任何解决冲突的入口，
    /// 那次合并已经自动取消并回退过了。
    var conflict: MobileGitConflict?
    /// 失败的原话。
    var failure: TerminalGitFailure?

    /// 「提交并切换」带过来的那一步：提交**成功之后**才做。
    private var pendingSwitch: TerminalGitPendingSwitch?

    /// 电脑没回答时，既有动作说这一句。
    static let unansweredDefault = "电脑一直没有回答。"

    /// 电脑没回答时，这一组新动作说这一句 —— 它们是可照做的。
    ///
    /// 新动作在**旧电脑端**上会被整帧丢弃（那边不认识这个 `action`），手机只会等到超时；
    /// 而「升级电脑端」正是用户能做的那一件事。既有动作不换这句：它们的电脑端一定认识。
    static let unansweredRetryable =
        "电脑端没有回答。如果电脑上的 Synapse 不是最新版，先升级它再试。"

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    /// 面板每次打开都从头开始：上一次退出时停在哪一页、填了一半的表单、还没点的那句话，
    /// 都不是这一次要接着做的事。
    func prepare() {
        path = []
        isBusy = false
        branches = []
        branchQuery = ""
        isLoadingBranches = false
        newBranchName = ""
        newBranchFrom = nil
        commitMessage = ""
        pushAfterCommit = false
        mergeDirection = .intoCurrent
        mergeBranch = nil
        decision = nil
        discardConfirmation = nil
        conflict = nil
        failure = nil
        pendingSwitch = nil
        remoteBranches = []
        remoteBranchQuery = ""
        isLoadingRemoteBranches = false
        localNamePrompt = nil
    }

    // MARK: - 读

    /// 让电脑重算一次当前目录的状态。
    ///
    /// 回答**不走结果信封**：手机端的状态永远以 `mobile.gitStatus` 为准，两个来源写同一
    /// 件事迟早会分叉。所以这个动作要的只是「重算一次并推给我」—— 打开面板与下拉刷新
    /// 都走它，用户在电脑上 `cd` 到别处之后，下拉一下就能让面板跟上。
    func refresh(on desk: TerminalGitDesk) async {
        _ = await desk.send(
            .git("status", sessionId: sessionId),
            AppConfiguration.gitLocalTimeout
        )
    }

    /// 列分支。**只列本地分支**；远端分支走「迁出远端分支」那一页。
    func loadBranches(on desk: TerminalGitDesk) async {
        guard !isLoadingBranches else { return }
        isLoadingBranches = true
        defer { isLoadingBranches = false }
        let result = await desk.send(
            .git("branches", sessionId: sessionId),
            AppConfiguration.gitLocalTimeout
        )
        guard let result else {
            failure = TerminalGitFailure(title: "读取分支失败", message: "电脑一直没有回答。")
            return
        }
        guard result.isAccepted, let list = result.git?.branches else {
            failure = TerminalGitFailure(
                title: "读取分支失败",
                message: result.message ?? "电脑没有完成这个操作。"
            )
            return
        }
        branches = list
    }

    /// 列远端分支。**只读电脑缓存的 `refs/remotes`**，这一趟不联网。
    ///
    /// 成功且带 `message` 时用提示条说一句 —— 那是「只列出了前 512 条」这类
    /// 「成了但有话说」，吞掉它等于让用户以为列表就是全部。
    func loadRemoteBranches(on desk: TerminalGitDesk) async {
        guard !isLoadingRemoteBranches else { return }
        isLoadingRemoteBranches = true
        defer { isLoadingRemoteBranches = false }
        let result = await desk.send(
            .git("remoteBranches", sessionId: sessionId),
            AppConfiguration.gitLocalTimeout
        )
        guard let result else {
            failure = TerminalGitFailure(
                title: "读取远端分支失败",
                message: Self.unansweredRetryable
            )
            return
        }
        guard result.isAccepted, let list = result.git?.remoteBranches else {
            failure = TerminalGitFailure(
                title: "读取远端分支失败",
                message: result.message ?? "电脑没有完成这个操作。"
            )
            return
        }
        remoteBranches = list
        if let message = result.message {
            desk.notice(message, .info, "git.remoteBranches.truncated")
        }
    }

    /// 下拉刷新：**先获取、再重取**。
    ///
    /// 获取失败就**不重取**：列表留在原地，用户可以继续拿旧的挑 —— 比把它变成一个空列表有用。
    func refreshRemoteBranches(on desk: TerminalGitDesk) async {
        let fetched = await desk.send(
            .git("fetchRemotes", sessionId: sessionId),
            AppConfiguration.gitRemoteTimeout
        )
        guard let fetched else {
            failure = TerminalGitFailure(title: "获取远端分支失败", message: Self.unansweredRetryable)
            return
        }
        guard fetched.isAccepted else {
            failure = TerminalGitFailure(
                title: "获取远端分支失败",
                message: fetched.message ?? "电脑没有完成这个操作。"
            )
            return
        }
        await loadRemoteBranches(on: desk)
    }

    // MARK: - 写

    /// 在分支列表里点了某一条。
    ///
    /// 三条去向各做各的，而**「点自己所在的那条分支什么也不做」**这一条对切分支成立：
    /// 带 `-f` 的那条「丢弃改动并切换」在这种情况下会把用户的改动丢掉却什么也没换到 ——
    /// 手机上点错一下就是不可逆的。所以这里先行拦下，连一个 intent 都不发。
    func pick(_ branch: MobileGitBranch, purpose: TerminalGitBranchPurpose, on desk: TerminalGitDesk) async {
        switch purpose {
        case .checkout:
            guard !branch.current else {
                desk.notice("已经在这条分支上。", .info, "git.checkout.same")
                return
            }
            await checkout(branch.name, on: desk)
        case .startPoint:
            newBranchFrom = branch.name
            path.removeLast()
        case .merge:
            mergeBranch = branch.name
            path.removeLast()
        }
    }

    /// 切到另一条分支。
    ///
    /// 脏工作区不在这里拦，也不在这里替用户决定 —— 电脑会回一个 `needsDecision`，
    /// 那时才是把三选一摆出来的时刻。脏不脏是电脑的事实，怎么处理是用户的事。
    func checkout(_ branch: String, on desk: TerminalGitDesk) async {
        await perform(
            title: "切换分支失败",
            success: "已切换到 \(branch)",
            id: "git.checkout",
            pending: .checkout(branch),
            on: desk
        ) {
            .git("checkout", sessionId: sessionId, branch: branch)
        }
    }

    /// 新建一条分支，**建完直接切过去**。
    ///
    /// 分支名合不合法交给电脑判（它跑 `check-ref-format`）：手机上复刻一份规则，就一定会
    /// 与电脑分叉。这里只管「非空」。
    func createBranch(on desk: TerminalGitDesk) async {
        let name = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let from = newBranchFrom
        let answer = await perform(
            title: "新建分支失败",
            success: "已新建并切换到 \(name)",
            id: "git.createBranch",
            pending: .createBranch(name: name, from: from),
            on: desk
        ) {
            .git("createBranch", sessionId: sessionId, branch: name, fromBranch: from)
        }
        if case .accepted = answer { newBranchName = "" }
    }

    /// 迁出一条远端分支。`localBranch` 缺席＝建一条同名的跟踪分支。
    ///
    /// 电脑要另一个本地名时会回 `localBranchName`，由 `send` 把它翻成推一页（见那里）。
    /// **不走远端超时**：从头到尾一条网络命令都没有，慢不到推 / 同步那个量级去。
    func checkoutRemote(
        _ remote: String,
        branch: String,
        localBranch: String? = nil,
        on desk: TerminalGitDesk
    ) async {
        await perform(
            title: "迁出远端分支失败",
            success: "已迁出 \(remote)/\(branch)",
            id: "git.checkoutRemote",
            pending: .checkoutRemote(remote: remote, branch: branch, localBranch: localBranch),
            unanswered: Self.unansweredRetryable,
            on: desk
        ) {
            .git("checkoutRemote", sessionId: sessionId, branch: branch, remote: remote, localBranch: localBranch)
        }
    }

    /// 填另一个本地名那一页上按下「迁出」。
    ///
    /// 名字只做「非空」检查，合法性交给电脑（与新建分支同一口径）。
    func submitLocalName(on desk: TerminalGitDesk) async {
        guard let prompt = localNamePrompt else { return }
        let name = prompt.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        await checkoutRemote(prompt.remote, branch: prompt.branch, localBranch: name, on: desk)
    }

    /// 离开「填另一个本地名」那一页时把它的状态清掉。
    ///
    /// 由那一页的 `onDisappear` 调：返回走的是系统那颗返回键（页与状态都由它收），
    /// 所以这里不做任何导航、也不发任何 intent。
    func clearLocalNamePrompt() {
        localNamePrompt = nil
    }

    /// 提交。**全量**：电脑那边是 `add -A` + commit，手机上不挑文件也不看文件清单。
    ///
    /// 「提交并切换」在这里分成两步走：先发 `commit`，**成功了**再发那一次切换。这是
    /// 两个 intent 而不是一个复合动作 —— 合成一个的话，「提交失败」与「切换失败」共用
    /// 一个结果，手机就分不清该报哪一句、用户也不知道该重做什么。
    func commit(on desk: TerminalGitDesk) async {
        let message = commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        let after = pendingSwitch
        let answer = await perform(
            title: "提交失败",
            success: pushAfterCommit ? "已提交并推送" : "已提交",
            id: "git.commit",
            on: desk
        ) {
            .git(
                "commit",
                sessionId: sessionId,
                message: message,
                pushAfterCommit: pushAfterCommit ? true : nil
            )
        }
        // 提交没成，这一页留着让用户重试；那一次待做的切换也留着，重试成功后再做。
        guard case .accepted = answer else { return }
        commitMessage = ""
        guard let after else { return }
        await carryOut(after, on: desk)
    }

    /// 推送。没有上游就是**首次推送**：电脑会顺手建立远端跟踪。
    func push(on desk: TerminalGitDesk) async {
        await perform(
            title: "推送被拒绝",
            success: "已推送",
            id: "git.push",
            remote: true,
            // 推送失败最常见的两个原因里有一个是「远端有你不知道的提交」，而那个的
            // 下一步就是同步。给不出来的下一步，不给就是了，所以这里只挂这一个。
            next: .sync,
            on: desk
        ) {
            .git("push", sessionId: sessionId)
        }
    }

    /// 同步 = 拉取 + 推送。
    ///
    /// 走的是快进式，**永远不会产生冲突**：拉不动就整体失败并报「已分叉，请手动处理」。
    /// 会冲突的只有合并那一条路，所以这里没有、也不该有任何冲突处理。
    ///
    /// `changeCount` 是**同步前**就拦一道：脏工作区同步不了，这是电脑那边一模一样的守卫
    /// （`syncBlocker` 查的就是它）。在这里先问，是为了在一按下去就说清下一步，而不是等
    /// 一次往返回来再报一个用户没法处理的错。数字是电脑给的（`mobile.gitStatus`），不是
    /// 手机自己算的。
    func sync(changeCount: Int, on desk: TerminalGitDesk) async {
        guard changeCount == 0 else {
            failure = TerminalGitFailure(
                title: "同步不了",
                message: "当前目录里有未提交的改动，先提交再同步。",
                next: .commit
            )
            return
        }
        await perform(
            title: "同步失败",
            success: "已同步",
            id: "git.sync",
            remote: true,
            on: desk
        ) {
            .git("sync", sessionId: sessionId)
        }
    }

    /// 合并。两个方向都走这一条，方向在 `mergeDirection` 上。
    ///
    /// 冲突的收尾不在这里：电脑那边已经自动 `merge --abort` 回退了，手机拿到的是
    /// 一个结论（`git.conflict`），只负责说明与复制 —— **不提供「要不要重试」**。
    func merge(on desk: TerminalGitDesk) async {
        guard let branch = mergeBranch else { return }
        let direction = mergeDirection
        await perform(
            title: "合并失败",
            success: direction == .intoCurrent ? "已合并 \(branch)" : "已合并到 \(branch)",
            id: "git.merge",
            pending: .merge(branch: branch, direction: direction),
            remote: true,
            on: desk
        ) {
            .git("merge", sessionId: sessionId, branch: branch, direction: direction.rawValue)
        }
    }

    // MARK: - 脏工作区那三个走法

    /// 用户在三选一里选了哪一个。
    ///
    /// 待做的动作**由调用方传进来**，不从这里读 `decision`：选项被按下的同一刻，系统也把
    /// 那张操作表收了，而收表会把 `decision` 清成 `nil` —— 这一句是异步的，等它跑到时
    /// 读到的往往已经是那个 `nil`，于是「按了没反应」。参数化之后这个竞态就不存在了。
    func choose(
        _ choice: TerminalGitDirtyChoice,
        from pending: TerminalGitPendingSwitch,
        on desk: TerminalGitDesk
    ) async {
        switch choice {
        case .commit:
            // 提交页推出来，那一步先记着：提交成功之后由 `commit` 接着做。
            decision = nil
            pendingSwitch = pending
            path.append(.commit)
        case .discard:
            // 丢弃是不可逆的，所以它不在这里发生 —— 先把二次确认摆出来。
            decision = nil
            // **等操作表收完再摆**：两个弹窗在同一次更新里一个收一个开，iOS 会把后一个
            // 丢掉，表现是「点了『丢弃改动并切换』什么也没发生」—— 而在真机上，用户会
            // 以为改动已经丢了。这一步换来的是那一下一定会出现。
            try? await Task.sleep(for: .milliseconds(350))
            discardConfirmation = pending
        case .cancel:
            decision = nil
        }
    }

    /// 二次确认过了：发那次「丢弃改动并切换 / 迁出」。
    ///
    /// 同 `choose`：那个待确认的动作由调用方传进来，不在这一刻回头读 `discardConfirmation`
    /// —— 确认框一按下去就会把它清掉。
    func discardChanges(_ pending: TerminalGitPendingSwitch, on desk: TerminalGitDesk) async {
        discardConfirmation = nil
        switch pending {
        case .checkout(let branch):
            await perform(
                title: "切换分支失败",
                success: "已切换到 \(branch)",
                id: "git.checkout",
                on: desk
            ) {
                // `checkout -f` 的语义：只丢已跟踪文件的修改，**不删未跟踪的新文件**。
                .git("checkout", sessionId: sessionId, branch: branch, discardChanges: true)
            }
        case .checkoutRemote(let remote, let branch, let localBranch):
            await perform(
                title: "迁出远端分支失败",
                success: "已迁出 \(remote)/\(branch)",
                id: "git.checkoutRemote",
                unanswered: Self.unansweredRetryable,
                on: desk
            ) {
                // 同样是 `-f` 的语义（`checkout -f [-b local --track remote/branch]`）：
                // 只丢已跟踪文件的修改，**不删未跟踪的新文件**。
                .git(
                    "checkoutRemote",
                    sessionId: sessionId,
                    branch: branch,
                    discardChanges: true,
                    remote: remote,
                    localBranch: localBranch
                )
            }
        case .createBranch, .merge:
            // 这两条本来就没有「丢弃」这个选项（`canDiscardChanges` 为假），走不到这里。
            return
        }
    }

    func cancelDiscard() {
        discardConfirmation = nil
    }

    /// 把三选一收起来。
    func dismissDecision() {
        decision = nil
    }

    func dismissConflict() {
        conflict = nil
    }

    func dismissFailure() {
        failure = nil
    }

    /// 失败弹窗里那个「下一步」。
    ///
    /// 「去提交」只推页、不下结论：用户到了提交页还要自己写一句提交信息，那件事不能被
    /// 代做。所以它不带任何「等一下会自动切换」的暗示。
    func followUp(_ next: TerminalGitFailure.Next, changeCount: Int, on desk: TerminalGitDesk) async {
        failure = nil
        switch next {
        case .sync:
            await sync(changeCount: changeCount, on: desk)
        case .commit:
            path.append(.commit)
        }
    }

    // MARK: - 底下的两步

    /// 一次写动作的公共路径：发出去、按回答分四路、成功了清掉待做的那一步。
    ///
    /// `unanswered` 给这一组新动作换个说法：它们在**旧电脑端**上会被静默丢弃，而
    /// 「升级电脑端」正是用户能做的那一件事。既有动作不传，保持原来那句。
    @discardableResult
    private func perform(
        title: String,
        success: String,
        id: String,
        pending: TerminalGitPendingSwitch? = nil,
        remote: Bool = false,
        next: TerminalGitFailure.Next? = nil,
        unanswered: String = TerminalGitFlow.unansweredDefault,
        on desk: TerminalGitDesk,
        _ makeIntent: () -> MobileIntentRequest
    ) async -> TerminalGitAnswer {
        isBusy = true
        defer { isBusy = false }
        let answer = await send(makeIntent(), ifDirty: pending, remote: remote, on: desk)
        if case .accepted = answer { pendingSwitch = nil }
        finish(answer, title: title, success: success, id: id, next: next, unanswered: unanswered, on: desk)
        return answer
    }

    /// 四路回答，全是电脑规定的分法。
    ///
    /// `needsDecision` 与 `conflict` 都算「被拒」，但它们**不是错误**：一个是等用户选一个
    /// 走法，一个是已经收尾完了的结论。把它们当错误弹出来，用户会去找一个不存在的重试。
    private func send(
        _ intent: MobileIntentRequest,
        ifDirty pending: TerminalGitPendingSwitch?,
        remote: Bool,
        on desk: TerminalGitDesk
    ) async -> TerminalGitAnswer {
        let result = await desk.send(
            intent,
            remote ? AppConfiguration.gitRemoteTimeout : AppConfiguration.gitLocalTimeout
        )
        guard let result else { return .unanswered }
        if let conflict = result.git?.conflict {
            self.conflict = conflict
            return .conflicted
        }
        /*
         * 两个取值都是「电脑问了一件事」，界面已经摆出来，**都不是失败**：
         * `dirty` 摆三选一，`localBranchName` 推一页让用户填另一个本地名。
         * 写死 `== "dirty"` 的话，后者会被当成一句普通的拒绝 —— 用户看到一句错，没有出路。
         */
        if let decision = result.git?.needsDecision, let pending {
            switch decision {
            case "dirty":
                self.decision = pending
                return .decided
            case "localBranchName":
                // 这条回答只可能来自 checkoutRemote；不是它就走普通拒绝。
                guard case .checkoutRemote(let remote, let branch, _) = pending else { break }
                let sameTarget = localNamePrompt?.qualifiedName == "\(remote)/\(branch)"
                localNamePrompt = TerminalGitLocalNamePrompt(
                    remote: remote,
                    branch: branch,
                    // 电脑这次的原话优先；它没说话才沿用上一次那句（同一页接着问，理由没变）。
                    message: result.message ?? localNamePrompt?.message
                        ?? "本地已有同名分支，另起一个本地名。",
                    // 同一个目标的第二次问：用户刚打的字留着 —— 他正要改它。
                    // 换了目标就是全新的一页，字不该带过来。
                    name: sameTarget ? (localNamePrompt?.name ?? "") : ""
                )
                // **已经在那一页上就不再推一页。** 第二次问（用户填的名字也被占了）是同一页上
                // 的一次失败，再推一次会叠出两层一模一样的页，返回要点两下。
                if path.last != .remoteLocalName { path.append(.remoteLocalName) }
                return .decided
            default:
                break
            }
        }
        return result.isAccepted ? .accepted(result.message) : .rejected(result.message)
    }

    /// 成功说一句、被拒弹原文、没回答说没回答。
    ///
    /// 成功那一路顺手把导航退回面板根部：动作做完了，用户要看的下一件事是新的状态，
    /// 不是刚才那张表单。状态本身由电脑推回来（它动过仓库就会重算一次），不在这里拼。
    private func finish(
        _ answer: TerminalGitAnswer,
        title: String,
        success: String,
        id: String,
        next: TerminalGitFailure.Next?,
        unanswered: String,
        on desk: TerminalGitDesk
    ) {
        switch answer {
        case .accepted(let message):
            path = []
            localNamePrompt = nil
            // 电脑有话说时用它的话（例如「合并已完成，但没能切回 main」）—— 那是成功，
            // 只是另有一件用户要知道的事没做成。
            desk.notice(message ?? success, .success, id)
        case .rejected(let message):
            /*
             * 失败只写 `failure`：**页与 `localNamePrompt` 一个都不动**。
             * 那一页要留着、刚打的字也要留着 —— 关掉它等于让用户从头再点一遍，
             * 而手机上不能给分支改名。
             */
            failure = TerminalGitFailure(
                title: title,
                message: message ?? "电脑没有完成这个操作。",
                next: next
            )
        case .unanswered:
            failure = TerminalGitFailure(title: title, message: unanswered)
        case .decided, .conflicted:
            break
        }
    }

    /// 做那一步「等提交成功之后才做」的切换。
    private func carryOut(_ pending: TerminalGitPendingSwitch, on desk: TerminalGitDesk) async {
        switch pending {
        case .checkout(let branch):
            await checkout(branch, on: desk)
        case .createBranch(let name, let from):
            newBranchName = name
            newBranchFrom = from
            await createBranch(on: desk)
        case .merge(let branch, let direction):
            mergeBranch = branch
            mergeDirection = direction
            await merge(on: desk)
        case .checkoutRemote(let remote, let branch, let localBranch):
            await checkoutRemote(remote, branch: branch, localBranch: localBranch, on: desk)
        }
    }
}

/// 一次写动作的回答分成了哪几路。
enum TerminalGitAnswer: Equatable {
    /// 做成了，可能还带一句电脑要说的话。
    case accepted(String?)
    /// 电脑拒了，带它的原文（可能没有）。
    case rejected(String?)
    /// 脏工作区，已经摆出三选一。
    case decided
    /// 合并冲突，已经摆出冲突页。
    case conflicted
    /// 电脑一直没有回答。
    case unanswered
}

extension MobileIntentRequest {
    /// 一个 `git` intent。
    ///
    /// `action` 是枚举值而不是命令字符串 —— 用户输入的字符串从来没有到过这条路上，
    /// 分支名与提交信息也各走各的字段，电脑按名字分派。
    static func git(
        _ action: String,
        sessionId: String,
        branch: String? = nil,
        fromBranch: String? = nil,
        message: String? = nil,
        pushAfterCommit: Bool? = nil,
        direction: String? = nil,
        discardChanges: Bool? = nil,
        remote: String? = nil,
        localBranch: String? = nil
    ) -> MobileIntentRequest {
        MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "git",
            sessionId: sessionId,
            action: action,
            branch: branch,
            fromBranch: fromBranch,
            message: message,
            pushAfterCommit: pushAfterCommit,
            direction: direction,
            discardChanges: discardChanges,
            remote: remote,
            localBranch: localBranch
        )
    }
}
