import Foundation
import Testing
import UIKit

@testable import SynapseMobile

/// 手机半边：手机点的那几下，变成了哪几个 intent、按什么顺序发出去。
///
/// 这里验的几乎全是**时序与分支**，不是措辞：先提交、成功了再切换；冲突不再问一次；
/// 丢弃要过一道确认且带 `discardChanges`；同步前脏就一步都不发。这些都不是画面上看得
/// 出来的东西 —— 一个顺序错了的实现，屏幕上和正确的那个长得一模一样。
@MainActor
struct TerminalGitFlowTests {

    // MARK: - 假电脑

    /// 一个记账的假电脑。`answers` 按顺序回，用完了就是「没回答」。
    private final class FakeDesk {
        private(set) var sent: [MobileIntentRequest] = []
        private(set) var said: [Said] = []
        var answers: [MobileIntentResult] = []

        struct Said: Equatable {
            let text: String
            let tone: NoticeTone
            let id: String
        }

        var desk: TerminalGitDesk {
            TerminalGitDesk(
                send: { [self] intent, _ in
                    sent.append(intent)
                    return answers.isEmpty ? nil : answers.removeFirst()
                },
                notice: { [self] text, tone, id in
                    said.append(Said(text: text, tone: tone, id: id))
                }
            )
        }

        /// 发出去的第几个动作。
        var actions: [String] { sent.compactMap(\.action) }

        func accept(message: String? = nil) -> MobileIntentResult {
            result(outcome: "accepted", message: message)
        }

        func reject(code: String? = nil, message: String? = nil, git: MobileIntentGitResult? = nil) -> MobileIntentResult {
            result(outcome: "rejected", code: code, message: message, git: git)
        }

        private func result(
            outcome: String,
            code: String? = nil,
            message: String? = nil,
            git: MobileIntentGitResult? = nil
        ) -> MobileIntentResult {
            MobileIntentResult(
                intentId: "answer",
                outcome: outcome,
                code: code,
                message: message,
                sessionId: "sess-1",
                createdSessionId: nil,
                landedPath: nil,
                git: git
            )
        }
    }

    private func dirty() -> MobileIntentGitResult {
        MobileIntentGitResult(branches: nil, remoteBranches: nil, conflict: nil, needsDecision: "dirty")
    }

    /// 电脑回「同名本地分支不能直接用，另起一个本地名」——那句话走 `MobileIntentResult.message`。
    private func wantsAnotherLocalName() -> MobileIntentGitResult {
        MobileIntentGitResult(branches: nil, remoteBranches: nil, conflict: nil, needsDecision: "localBranchName")
    }

    private func conflict(files: [String] = ["a.txt", "b.txt"]) -> MobileIntentGitResult {
        MobileIntentGitResult(
            branches: nil,
            remoteBranches: nil,
            conflict: MobileGitConflict(
                source: "feature/login",
                target: "main",
                files: files,
                summaryText: "【Synapse · Git 合并冲突】\n操作：把分支 feature/login 合并到 main\n"
            ),
            needsDecision: nil
        )
    }

    private func makeFlow() -> (TerminalGitFlow, FakeDesk) {
        (TerminalGitFlow(sessionId: "sess-1"), FakeDesk())
    }

    // MARK: - 切分支

    @Test func checkoutSendsOneCheckoutIntent() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.accept()]

        await flow.checkout("feature/login", on: fake.desk)

        #expect(fake.actions == ["checkout"])
        #expect(fake.sent.first?.branch == "feature/login")
        #expect(fake.sent.first?.kind == "git")
        // 干净的树上不带丢弃：带上了就等于让电脑替用户抹掉改动。
        #expect(fake.sent.first?.discardChanges == nil)
        #expect(fake.said.map(\.text) == ["已切换到 feature/login"])
        // 做成了就退回面板根部：下一件要看的事是新的状态，不是刚才那张列表。
        #expect(flow.path.isEmpty)
    }

    @Test func aDirtyTreeBecomesAChoiceRatherThanAnError() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(code: "dirty_working_tree", message: "当前目录里有未提交的改动。", git: dirty())]

        await flow.checkout("feature/login", on: fake.desk)

        // 三个走法摆出来了，而且**不是一个错误弹窗**：脏不是失败，是等用户拿主意。
        #expect(flow.decision == .checkout("feature/login"))
        #expect(flow.failure == nil)
        #expect(fake.sent.count == 1)
    }

    @Test func commitThenSwitchSendsTheCheckoutOnlyAfterTheCommitLanded() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(git: dirty()), fake.accept()]
        await flow.checkout("feature/login", on: fake.desk)
        await flow.choose(.commit, from: .checkout("feature/login"), on: fake.desk)
        #expect(flow.path == [.commit])

        flow.commitMessage = "改点什么"
        await flow.commit(on: fake.desk)

        // 两个 intent，**不是一个复合动作**：先提交，成功了再切。
        #expect(fake.actions == ["checkout", "commit", "checkout"])
        #expect(fake.sent.last?.branch == "feature/login")
        #expect(flow.path.isEmpty)
    }

    @Test func aFailedCommitDoesNotSwitchAndKeepsTheChoice() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(git: dirty()), fake.reject(message: "nothing to commit")]
        await flow.checkout("feature/login", on: fake.desk)
        await flow.choose(.commit, from: .checkout("feature/login"), on: fake.desk)
        flow.commitMessage = "改点什么"
        await flow.commit(on: fake.desk)

        // 提交没成，那次切换就不能发生 —— 这是「两个 intent」的全部理由：
        // 合成一个的话，用户分不清该重做哪一步。
        #expect(fake.actions == ["checkout", "commit"])
        #expect(flow.failure?.message == "nothing to commit")
        // 提交信息留着让他改，不替他清掉。
        #expect(flow.commitMessage == "改点什么")

        // 重试一次成功，那次切换仍然会补上。
        fake.answers = [fake.accept()]
        await flow.commit(on: fake.desk)
        #expect(fake.actions == ["checkout", "commit", "commit", "checkout"])
    }

    // MARK: - 丢弃

    @Test func discardAsksOnceMoreBeforeItIsSent() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(git: dirty())]
        await flow.checkout("feature/login", on: fake.desk)

        await flow.choose(.discard, from: .checkout("feature/login"), on: fake.desk)

        // 只是把二次确认摆出来，一个字节都没发出去。
        #expect(fake.sent.count == 1)
        #expect(flow.discardConfirmation == .checkout("feature/login"))

        fake.answers = [fake.accept()]
        await flow.discardChanges(.checkout("feature/login"), on: fake.desk)

        #expect(fake.sent.last?.action == "checkout")
        #expect(fake.sent.last?.discardChanges == true)
        #expect(flow.discardConfirmation == nil)
    }

    @Test func discardingNeverCleansUntrackedFiles() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(git: dirty()), fake.accept()]
        await flow.checkout("feature/login", on: fake.desk)
        await flow.choose(.discard, from: .checkout("feature/login"), on: fake.desk)
        await flow.discardChanges(.checkout("feature/login"), on: fake.desk)

        // 手机发出去的每一个字段里都不许出现 `clean`：丢弃只丢已跟踪文件的修改，
        // 未跟踪的新文件里可能有用户根本没想提交的草稿，删掉不可逆。
        let encoded = fake.sent.map { String(describing: $0) }.joined(separator: " ")
        #expect(!encoded.lowercased().contains("clean"))
        #expect(fake.actions.allSatisfy { $0 == "checkout" })
    }

    @Test func theSecondConfirmationSaysUntrackedFilesSurvive() {
        let message = TerminalGitDirtySheet.discardMessage(
            for: .checkout("feature/login"),
            changeCount: 3
        )

        // 这一句是整条路上最要紧的一句：用户看不出手机会怎么选，所以必须写出来。
        #expect(message.contains("未跟踪的新文件不会被删除"))
        #expect(message.contains("feature/login"))
        #expect(message.contains("3"))
    }

    @Test func theDirtyChoicesAreExactlyThreeAndHaveNoStash() {
        let choices = TerminalGitDirtyChoice.allowed(for: .checkout("feature/login"))

        #expect(choices.count == 3)
        #expect(choices == [.commit, .discard, .cancel])
        // 「暂存并切换」是初稿里被砍掉的那一项，这里显式钉住，防止有人按初稿加回来：
        // 手机上暂存了却没法恢复，等于把人卡在半路。
        let titles = choices.map { $0.title(for: .checkout("feature/login")) }
        #expect(!titles.contains { $0.contains("暂存") })
        #expect(titles == ["提交并切换", "丢弃改动并切换", "取消"])
    }

    @Test func createAndMergeHaveNoDiscardForTheProtocolsSake() {
        // 协议里只有 `checkout` 带 `discardChanges`，而 git 也没有「把改动丢掉、但留在
        // 原地新建一条分支」这条原语 —— 少一个选项，不是少一次确认。
        #expect(TerminalGitDirtyChoice.allowed(for: .createBranch(name: "x", from: nil)) == [.commit, .cancel])
        #expect(TerminalGitDirtyChoice.allowed(for: .merge(branch: "main", direction: .intoCurrent)) == [.commit, .cancel])
        #expect(TerminalGitDirtyChoice.commit.title(for: .createBranch(name: "x", from: nil)) == "提交并新建")
        #expect(TerminalGitDirtyChoice.commit.title(for: .merge(branch: "main", direction: .intoCurrent)) == "提交并合并")
    }

    @Test func theChoiceMessageNamesWhatTheUserIsAboutToDo() {
        #expect(TerminalGitDirtySheet.decisionTitle(changeCount: 3) == "有 3 个文件未提交")
        #expect(TerminalGitDirtySheet.decisionMessage(for: .checkout("dev")) == "要切换到 dev，先处理这些改动。")
        #expect(TerminalGitDirtySheet.decisionMessage(for: .merge(branch: "dev", direction: .intoCurrent)) == "合并前要先处理这些改动。")
    }

    // MARK: - 合并冲突

    @Test func aConflictIsAConclusionNotAQuestion() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(code: "merge_conflict", message: "检测到冲突，已自动取消合并并回退。", git: conflict())]
        flow.mergeBranch = "feature/login"

        await flow.merge(on: fake.desk)

        #expect(flow.conflict?.source == "feature/login")
        #expect(flow.conflict?.target == "main")
        #expect(flow.conflict?.files.count == 2)
        // 那次合并已经自动回退了，所以这里没有岔路可走：不弹错误、也不问「要不要重试」。
        #expect(flow.failure == nil)
        #expect(fake.actions == ["merge"])
    }

    @Test func theConflictCopyIsWhatLandsOnThePasteboard() async {
        let conflict = MobileGitConflict(
            source: "feature/login",
            target: "main",
            files: ["a.txt"],
            summaryText: "【Synapse · Git 合并冲突】\n操作：把分支 feature/login 合并到 main\n请帮我解决这些冲突。\n"
        )

        let said = TerminalGitConflictCopy.put(conflict)

        // 这一页在手机上唯一的出口就是这段文本，所以它必须原样进剪贴板 ——
        // 手机不解析它，也不重排它。
        #expect(UIPasteboard.general.string == conflict.summaryText)
        #expect(said == "冲突信息已复制到剪贴板。")
    }

    // MARK: - 推送与同步

    @Test func aRejectedPushOffersTheNextStep() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(message: "! [rejected] main -> main (non-fast-forward)")]

        await flow.push(on: fake.desk)

        #expect(flow.failure?.title == "推送被拒绝")
        // 正文是电脑返回的原文，一个字不改。
        #expect(flow.failure?.message == "! [rejected] main -> main (non-fast-forward)")
        #expect(flow.failure?.next == .sync)

        // 那个「同步」按钮真的会去同步。
        fake.answers = [fake.accept()]
        await flow.followUp(.sync, changeCount: 0, on: fake.desk)
        #expect(fake.actions == ["push", "sync"])
    }

    @Test func syncUsesTheComputersOwnWordsForADivergence() async {
        let (flow, fake) = makeFlow()
        let divergence = "本地分支与上游分支已分叉，请使用外部 Git 工具处理后重试。"
        fake.answers = [fake.reject(message: divergence)]

        await flow.sync(changeCount: 0, on: fake.desk)

        #expect(fake.actions == ["sync"])
        #expect(flow.failure?.title == "同步失败")
        #expect(flow.failure?.message == divergence)
    }

    @Test func syncWithUncommittedChangesNeverLeavesThePhone() async {
        let (flow, fake) = makeFlow()

        await flow.sync(changeCount: 3, on: fake.desk)

        // 电脑那边有一模一样的守卫，但先在这里问：一按下去就说清下一步，
        // 而不是等一次往返回来再报一个用户没法处理的错。
        #expect(fake.sent.isEmpty)
        #expect(flow.failure?.title == "同步不了")
        #expect(flow.failure?.next == .commit)

        // 「去提交」只推页，不做别的：提交信息得用户自己写。
        await flow.followUp(.commit, changeCount: 3, on: fake.desk)
        #expect(flow.path == [.commit])
        #expect(fake.sent.isEmpty)
    }

    @Test func syncNeverTurnsIntoAConflictSheet() async {
        let (flow, fake) = makeFlow()
        // 同步走的是快进式，拉不动就整体失败。就算电脑回了冲突形状（它不会），
        // 这一条也钉住手机不会为它摆出冲突页。
        fake.answers = [fake.reject(message: "已分叉")]

        await flow.sync(changeCount: 0, on: fake.desk)

        #expect(flow.conflict == nil)
    }

    @Test func theSyncDirtyCopySaysWhatToDoNext() async {
        let (flow, fake) = makeFlow()
        await flow.sync(changeCount: 1, on: fake.desk)
        #expect(flow.failure?.message == "当前目录里有未提交的改动，先提交再同步。")
    }

    // MARK: - 分支列表

    @Test func theBranchListCarriesWhatTheComputerSent() async {
        let (flow, fake) = makeFlow()
        fake.answers = [MobileIntentResult(
            intentId: "answer",
            outcome: "accepted",
            code: nil,
            message: nil,
            sessionId: "sess-1",
            createdSessionId: nil,
            landedPath: nil,
            git: MobileIntentGitResult(
                branches: [
                    MobileGitBranch(name: "main", current: true),
                    MobileGitBranch(name: "dev", current: false),
                ],
                remoteBranches: nil,
                conflict: nil,
                needsDecision: nil
            )
        )]

        await flow.loadBranches(on: fake.desk)

        #expect(fake.actions == ["branches"])
        #expect(flow.branches.map(\.name) == ["main", "dev"])
        #expect(flow.branches.first?.current == true)
    }

    @Test func pickingTheBranchYouAreAlreadyOnDoesNothingAtAll() async {
        let (flow, fake) = makeFlow()

        await flow.pick(MobileGitBranch(name: "main", current: true), purpose: .checkout, on: fake.desk)

        // **一个 intent 都不发**：带 `-f` 的「丢弃改动并切换」落在当前分支上，会把
        // 改动丢掉却什么也没换到。
        #expect(fake.sent.isEmpty)
        #expect(fake.said.map(\.text) == ["已经在这条分支上。"])
    }

    @Test func pickingAStartPointOrAMergeBranchJustGoesBack() async {
        let (flow, fake) = makeFlow()
        flow.path = [.newBranch]

        await flow.pick(MobileGitBranch(name: "dev", current: false), purpose: .startPoint, on: fake.desk)

        #expect(flow.newBranchFrom == "dev")
        #expect(flow.path.isEmpty)
        #expect(fake.sent.isEmpty)

        flow.path = [.merge]
        await flow.pick(MobileGitBranch(name: "release", current: false), purpose: .merge, on: fake.desk)
        #expect(flow.mergeBranch == "release")
        #expect(flow.path.isEmpty)
        #expect(fake.sent.isEmpty)
    }

    // MARK: - 失败与没回答

    @Test func aComputerThatNeverAnswersSaysSoInsteadOfInventingAReason() async {
        let (flow, fake) = makeFlow()

        await flow.checkout("dev", on: fake.desk)

        #expect(flow.failure?.title == "切换分支失败")
        #expect(flow.failure?.message == "电脑一直没有回答。")
    }

    @Test func aReadFailureShowsTheComputersWords() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(code: "not_a_repository", message: "这个目录不是 Git 仓库。")]

        await flow.loadBranches(on: fake.desk)

        #expect(flow.failure?.title == "读取分支失败")
        #expect(flow.failure?.message == "这个目录不是 Git 仓库。")
    }

    @Test func aWriteOutsideARepositoryShowsTheRefusalVerbatim() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(code: "not_a_repository", message: "这个目录不是 Git 仓库。")]

        await flow.checkout("dev", on: fake.desk)

        #expect(flow.failure?.message == "这个目录不是 Git 仓库。")
    }

    @Test func aMergeThatSucceededWithoutReturningSaysItInTheComputersWords() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.accept(message: "合并已完成，但没能切回 main：checkout failed")]
        flow.mergeBranch = "dev"

        await flow.merge(on: fake.desk)

        // 合并进了历史，所以它是成功 —— 只是另有一件用户要知道的事没做成。
        // 它绝不能借失败的形状说：那会让用户去做一遍已经做过的事。
        #expect(flow.failure == nil)
        #expect(fake.said.first?.text == "合并已完成，但没能切回 main：checkout failed")
        #expect(fake.said.first?.tone == .success)
    }

    // MARK: - 打开与收尾

    @Test func prepareLeavesNothingFromTheLastTime() async {
        let flow = TerminalGitFlow(sessionId: "sess-1")
        flow.path = [.merge]
        flow.commitMessage = "半句话"
        flow.pushAfterCommit = true
        flow.mergeBranch = "dev"
        flow.branchQuery = "fea"
        flow.decision = .checkout("dev")
        flow.conflict = MobileGitConflict(source: "a", target: "b", files: [], summaryText: "x")
        flow.failure = TerminalGitFailure(title: "t", message: "m")

        flow.prepare()

        #expect(flow.path.isEmpty)
        #expect(flow.commitMessage.isEmpty)
        #expect(!flow.pushAfterCommit)
        #expect(flow.mergeBranch == nil)
        #expect(flow.branchQuery.isEmpty)
        #expect(flow.decision == nil)
        #expect(flow.conflict == nil)
        #expect(flow.failure == nil)
    }

    @Test func theMergePlanSaysTheWholeChainOutLoud() async {
        let flow = TerminalGitFlow(sessionId: "sess-1")

        // 方向二必然要离开当前分支（git 没有「留在原分支、把成果合进别的分支」这条
        // 原语），所以它要在页面上说出来，不能让用户以为终端没动过。
        #expect(
            TerminalGitMergeDirection.outOfCurrent.detail(currentBranch: "main")
                == "先切过去、合并、再切回 main"
        )
        #expect(
            TerminalGitMergeDirection.intoCurrent.detail(currentBranch: "main")
                == "合进 main，合完停在这里"
        )
        #expect(flow.mergeDirection == .intoCurrent)
    }

    // MARK: - 远端分支

    private func remoteBranchesAnswer() -> MobileIntentGitResult {
        MobileIntentGitResult(
            branches: nil,
            remoteBranches: [
                MobileGitRemoteBranch(remote: "origin", name: "main"),
                MobileGitRemoteBranch(remote: "origin", name: "dev"),
            ],
            conflict: nil,
            needsDecision: nil
        )
    }

    @Test func theRemoteBranchListCarriesWhatTheComputerSent() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.accept()]
        fake.answers[0] = MobileIntentResult(
            intentId: "answer",
            outcome: "accepted",
            code: nil,
            message: nil,
            sessionId: "sess-1",
            createdSessionId: nil,
            landedPath: nil,
            git: remoteBranchesAnswer()
        )

        await flow.loadRemoteBranches(on: fake.desk)

        // 打开列表只读缓存：发出去的就这一个动作，一条网络命令都没有。
        #expect(fake.actions == ["remoteBranches"])
        #expect(flow.remoteBranches.map(\.qualifiedName) == ["origin/main", "origin/dev"])
        #expect(flow.failure == nil)
    }

    @Test func aTruncatedListSaysSo() async {
        let (flow, fake) = makeFlow()
        fake.answers = [MobileIntentResult(
            intentId: "answer",
            outcome: "accepted",
            code: nil,
            message: "远端分支过多，只列出了前 512 条。",
            sessionId: "sess-1",
            createdSessionId: nil,
            landedPath: nil,
            git: remoteBranchesAnswer()
        )]

        await flow.loadRemoteBranches(on: fake.desk)

        // 「成了但有话说」要显示出来：吞掉它等于让用户以为列表就是全部。
        #expect(fake.said.map(\.text) == ["远端分支过多，只列出了前 512 条。"])
        #expect(flow.remoteBranches.count == 2)
    }

    @Test func refreshingFetchesFirstAndThenReadsTheListAgain() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.accept(), MobileIntentResult(
            intentId: "answer",
            outcome: "accepted",
            code: nil,
            message: nil,
            sessionId: "sess-1",
            createdSessionId: nil,
            landedPath: nil,
            git: remoteBranchesAnswer()
        )]

        await flow.refreshRemoteBranches(on: fake.desk)

        #expect(fake.actions == ["fetchRemotes", "remoteBranches"])
        #expect(flow.remoteBranches.count == 2)
    }

    @Test func aFailedFetchLeavesTheListAlone() async {
        let (flow, fake) = makeFlow()
        flow.remoteBranches = [MobileGitRemoteBranch(remote: "origin", name: "dev")]
        fake.answers = [fake.reject(message: "没法连接远端。")]

        await flow.refreshRemoteBranches(on: fake.desk)

        // 不重取：宁可让用户拿旧的挑，也不要把它变成一个空列表。
        #expect(fake.actions == ["fetchRemotes"])
        #expect(flow.remoteBranches.map(\.name) == ["dev"])
        #expect(flow.failure?.title == "获取远端分支失败")
        #expect(flow.failure?.message == "没法连接远端。")
    }

    @Test func checkoutRemoteAsksForTheBranchWithItsRemote() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.accept(message: "已迁出 origin/dev 到 dev。")]

        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)

        #expect(fake.actions == ["checkoutRemote"])
        #expect(fake.sent.first?.remote == "origin")
        #expect(fake.sent.first?.branch == "dev")
        // 第一次不带本地名：同名就建同名的，电脑说了算。
        #expect(fake.sent.first?.localBranch == nil)
        #expect(fake.said.map(\.text) == ["已迁出 origin/dev 到 dev。"])
        #expect(flow.path.isEmpty)
    }

    @Test func aTakenLocalNameBecomesAPageRatherThanAnError() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(
            code: "local_branch_conflict",
            message: "本地已有 dev，它跟踪的是 origin/other。",
            git: wantsAnotherLocalName()
        )]

        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)

        // 不是失败，是一个问题：推一页出来，正文用电脑的原话。
        #expect(flow.path == [.remoteLocalName])
        #expect(flow.localNamePrompt?.message == "本地已有 dev，它跟踪的是 origin/other。")
        #expect(flow.localNamePrompt?.name == "")
        #expect(flow.failure == nil)
        #expect(flow.decision == nil)
    }

    @Test func theTypedNameIsSentBackAsTheLocalBranch() async {
        let (flow, fake) = makeFlow()
        fake.answers = [
            fake.reject(code: "local_branch_conflict", message: "本地已有 dev。", git: wantsAnotherLocalName()),
            fake.accept(message: "已迁出 origin/dev 到 dev-copy。"),
        ]
        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)

        flow.localNamePrompt?.name = "dev-copy"
        await flow.submitLocalName(on: fake.desk)

        #expect(fake.actions == ["checkoutRemote", "checkoutRemote"])
        #expect(fake.sent.last?.localBranch == "dev-copy")
        // 做成了就退回面板根部，那一页与它的状态一起清掉。
        #expect(flow.path.isEmpty)
        #expect(flow.localNamePrompt == nil)
    }

    @Test func aRefusalLeavesThePageAndTheTypedNameInPlace() async {
        let (flow, fake) = makeFlow()
        fake.answers = [
            fake.reject(code: "local_branch_conflict", message: "本地已有 dev。", git: wantsAnotherLocalName()),
            fake.reject(message: "分支名称不合法：a b"),
        ]
        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)

        flow.localNamePrompt?.name = "a b"
        await flow.submitLocalName(on: fake.desk)

        // 页留着、字留着：关掉它等于让用户从头再点一遍，而手机上不能给分支改名。
        #expect(flow.path == [.remoteLocalName])
        #expect(flow.localNamePrompt?.name == "a b")
        #expect(flow.failure?.title == "迁出远端分支失败")
        #expect(flow.failure?.message == "分支名称不合法：a b")
    }

    @Test func askingAgainDoesNotStackASecondIdenticalPage() async {
        let (flow, fake) = makeFlow()
        fake.answers = [
            fake.reject(code: "local_branch_conflict", message: "本地已有 dev。", git: wantsAnotherLocalName()),
            fake.reject(code: "local_branch_conflict", message: "本地已有 mine，换一个名字。", git: wantsAnotherLocalName()),
        ]
        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)
        flow.localNamePrompt?.name = "mine"

        await flow.submitLocalName(on: fake.desk)

        // 同一个目标接着问：还是那一页，不叠第二层（叠了返回要点两下）。
        #expect(flow.path == [.remoteLocalName])
        #expect(flow.localNamePrompt?.name == "mine")
        #expect(flow.localNamePrompt?.message == "本地已有 mine，换一个名字。")
    }

    @Test func aDirtyTreeTurnsIntoTheChoiceWithDiscardOffered() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(code: "dirty_working_tree", message: "当前目录里有未提交的改动。", git: dirty())]

        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)

        #expect(flow.decision == .checkoutRemote(remote: "origin", branch: "dev", localBranch: nil))
        // 迁出**有**「丢弃」这一条：git 有 `checkout -f -b --track` 这条原语，而同一个分支
        // 从「分支」行进来就已经有三个选项，从这里进来少一个说不通。
        #expect(TerminalGitDirtyChoice.allowed(
            for: .checkoutRemote(remote: "origin", branch: "dev", localBranch: nil)
        ) == [.commit, .discard, .cancel])
        #expect(flow.failure == nil)
        #expect(flow.path.isEmpty)
    }

    @Test func discardingThenCheckingOutCarriesTheFlag() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.accept()]
        let pending = TerminalGitPendingSwitch.checkoutRemote(remote: "origin", branch: "dev", localBranch: nil)

        await flow.discardChanges(pending, on: fake.desk)

        #expect(fake.actions == ["checkoutRemote"])
        #expect(fake.sent.first?.discardChanges == true)
        #expect(fake.sent.first?.remote == "origin")
    }

    @Test func commitThenCheckoutHappensInThatOrder() async {
        let (flow, fake) = makeFlow()
        fake.answers = [fake.reject(code: "dirty_working_tree", git: dirty()), fake.accept(), fake.accept()]
        let pending = TerminalGitPendingSwitch.checkoutRemote(remote: "origin", branch: "dev", localBranch: nil)
        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)
        await flow.choose(.commit, from: pending, on: fake.desk)
        #expect(flow.path == [.commit])

        flow.commitMessage = "先存一下"
        await flow.commit(on: fake.desk)

        // 提交成功了才发迁出，而且是两个 intent 不是一个复合动作。
        #expect(fake.actions == ["checkoutRemote", "commit", "checkoutRemote"])
    }

    @Test func anUnansweredNewActionSaysSomethingActionable() async {
        let (flow, fake) = makeFlow()
        // 没有回答：`answers` 是空的。
        await flow.checkoutRemote("origin", branch: "dev", on: fake.desk)

        // 新动作在**旧电脑端**上会被整帧丢弃，手机只会等到超时 —— 这句话要能照做。
        #expect(flow.failure?.message == "电脑端没有回答。如果电脑上的 Synapse 不是最新版，先升级它再试。")
    }

    @Test func anUnansweredOldActionKeepsItsOwnSentence() async {
        let (flow, fake) = makeFlow()
        await flow.checkout("dev", on: fake.desk)

        // 既有动作不换说法：它们的电脑端一定认识这个 action。
        #expect(flow.failure?.message == "电脑一直没有回答。")
    }

    // MARK: - 线上的形状

    @Test func aGitIntentOmitsWhatItDoesNotHave() throws {
        let bare = MobileIntentRequest.git("status", sessionId: "sess-1")
        let json = try encoded(bare)

        #expect(json["kind"] as? String == "git")
        #expect(json["action"] as? String == "status")
        #expect(json["sessionId"] as? String == "sess-1")
        // 缺席而不是 null：`Optional` 的合成编码只写有值的字段。
        for key in [
            "branch", "fromBranch", "message", "pushAfterCommit", "direction", "discardChanges",
            "remote", "localBranch",
        ] {
            #expect(json[key] == nil, "\(key) should be omitted")
        }
    }

    @Test func checkingOutARemoteBranchCarriesBothNames() throws {
        let intent = MobileIntentRequest.git(
            "checkoutRemote",
            sessionId: "sess-1",
            branch: "dev",
            remote: "origin"
        )
        let json = try encoded(intent)

        #expect(json["action"] as? String == "checkoutRemote")
        #expect(json["remote"] as? String == "origin")
        #expect(json["branch"] as? String == "dev")
        #expect(json["localBranch"] == nil)
    }

    @Test func theRemoteBranchAnswerDecodes() throws {
        let data = Data("""
        {
          "intentId": "i-1",
          "outcome": "accepted",
          "git": { "remoteBranches": [{ "remote": "origin", "name": "dev" }] }
        }
        """.utf8)

        let result = try JSONDecoder().decode(MobileIntentResult.self, from: data)

        #expect(result.git?.remoteBranches?.first?.remote == "origin")
        #expect(result.git?.remoteBranches?.first?.name == "dev")
        // 拼给人看的那一份在手机这侧拼：远端名本身可以含 `/`，拆回来是个会写错的一步。
        #expect(result.git?.remoteBranches?.first?.qualifiedName == "origin/dev")
    }

    @Test func theAskForAnotherLocalNameDecodes() throws {
        let data = Data("""
        {
          "intentId": "i-1",
          "outcome": "rejected",
          "code": "local_branch_conflict",
          "message": "本地已有 dev，它跟踪的是 origin/other。",
          "git": { "needsDecision": "localBranchName" }
        }
        """.utf8)

        let result = try JSONDecoder().decode(MobileIntentResult.self, from: data)

        #expect(result.git?.needsDecision == "localBranchName")
        #expect(result.message == "本地已有 dev，它跟踪的是 origin/other。")
    }

    @Test func aDiscardingCheckoutCarriesTheFlag() throws {
        let intent = MobileIntentRequest.git(
            "checkout",
            sessionId: "sess-1",
            branch: "dev",
            discardChanges: true
        )
        let json = try encoded(intent)

        #expect(json["branch"] as? String == "dev")
        #expect(json["discardChanges"] as? Bool == true)
    }

    @Test func theComputersAnswerDecodesIntoTheTwoPiecesOfData() throws {
        // 与 `shared/src/mobile-live.ts` 的 `MobileIntentGitResult` 逐字对齐。
        let data = Data("""
        {
          "intentId": "i-1",
          "outcome": "rejected",
          "code": "merge_conflict",
          "message": "检测到冲突，已自动取消合并并回退。",
          "git": {
            "conflict": {
              "source": "feature/login",
              "target": "main",
              "files": ["a.txt", "b.txt"],
              "summaryText": "【Synapse · Git 合并冲突】"
            }
          }
        }
        """.utf8)

        let result = try JSONDecoder().decode(MobileIntentResult.self, from: data)

        #expect(result.git?.conflict?.source == "feature/login")
        #expect(result.git?.conflict?.files == ["a.txt", "b.txt"])
        #expect(result.git?.conflict?.summaryText == "【Synapse · Git 合并冲突】")
        #expect(result.git?.branches == nil)
        #expect(result.git?.needsDecision == nil)
    }

    @Test func aBranchesAnswerDecodes() throws {
        let data = Data("""
        {
          "intentId": "i-1",
          "outcome": "accepted",
          "git": { "branches": [{ "name": "main", "current": true }] }
        }
        """.utf8)

        let result = try JSONDecoder().decode(MobileIntentResult.self, from: data)

        #expect(result.git?.branches?.first?.name == "main")
        #expect(result.git?.branches?.first?.current == true)
    }

    private func encoded(_ intent: MobileIntentRequest) throws -> [String: Any] {
        let data = try JSONEncoder().encode(intent)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
