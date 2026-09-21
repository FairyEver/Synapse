import SwiftUI

/// 脏工作区挡在一次切换前面时，用户能选的那几个走法。
enum TerminalGitDirtyChoice: String, Identifiable, CaseIterable {
    case commit
    case discard
    case cancel

    var id: String { rawValue }

    /// 这一次动作上有哪几个走法。
    ///
    /// 「丢弃改动并切换」只有切分支能表达（协议里只有 `checkout` 带 `discardChanges`，
    /// 而 git 也没有「把改动丢掉、但留在原地新建一条分支」这条原语），所以新建与合并
    /// 少一个选项 —— 少一个选项，不是少一次确认。
    ///
    /// **没有「暂存并切换」**，这一条是定死的：手机上暂存了却没法恢复，等于把人卡在半路。
    static func allowed(for pending: TerminalGitPendingSwitch) -> [TerminalGitDirtyChoice] {
        pending.canDiscardChanges ? [.commit, .discard, .cancel] : [.commit, .cancel]
    }

    /// 按钮上的字跟着那一次动作换：同一件事在切分支、新建、合并上说法不同。
    func title(for pending: TerminalGitPendingSwitch) -> String {
        switch self {
        case .commit:
            switch pending {
            case .checkout: return "提交并切换"
            case .createBranch: return "提交并新建"
            case .merge: return "提交并合并"
            }
        case .discard: return "丢弃改动并切换"
        case .cancel: return "取消"
        }
    }
}

/// 脏工作区那两层：先三选一，选了「丢弃」再二次确认。
///
/// 挂在面板上，不自己占一页导航：设计文档说的是「先弹出一个操作表」，系统里那个东西
/// 就是 `confirmationDialog`。二次确认是一条 `alert` —— 丢弃不可逆，轻不了。
///
/// 两处的文案都要说清同一件事：**丢弃不删未跟踪的新文件**。判定「脏」时未跟踪文件也算
/// （沿用桌面端口径），丢弃时不动它们，所以可能出现「它说有 3 个文件未提交，我选了丢弃，
/// 那 3 个文件还在」—— 这是有意为之：宁可多问一次，不可多删一个。
struct TerminalGitDirtySheet: ViewModifier {
    let flow: TerminalGitFlow
    let desk: TerminalGitDesk
    /// 电脑说的改动数。用来把「有 3 个文件未提交」说成具体数，而不是手机自己数的。
    let changeCount: Int
    let currentBranch: String?

    private var isPresentingDecision: Binding<Bool> {
        Binding(
            get: { flow.decision != nil },
            set: { presented in if !presented { flow.dismissDecision() } }
        )
    }

    private var isPresentingDiscard: Binding<Bool> {
        Binding(
            get: { flow.discardConfirmation != nil },
            set: { presented in if !presented { flow.cancelDiscard() } }
        )
    }

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                decisionTitle,
                isPresented: isPresentingDecision,
                titleVisibility: .visible,
                presenting: flow.decision
            ) { pending in
                ForEach(TerminalGitDirtyChoice.allowed(for: pending)) { choice in
                    Button(choice.title(for: pending), role: choice == .discard ? .destructive : nil) {
                        // 把这一条动作**带进闭包**，而不是让 flow 再去读一遍自己的状态：
                        // 按下的同一刻这张表就开始收，收表会把 `flow.decision` 清掉。
                        Task { await flow.choose(choice, from: pending, on: desk) }
                    }
                    // 按名字找这几颗键会撞车：「取消」在搜索框那儿还有一颗（`searchable`
                    // 自带的那一颗），而这一行里三个按钮的两个说法在别处也各出现过。
                    .accessibilityIdentifier("git-dirty-\(choice.rawValue)")
                }
                Button("取消", role: .cancel) { flow.dismissDecision() }
                    .accessibilityIdentifier("git-dirty-cancel")
            } message: { pending in
                Text(decisionMessage(for: pending))
            }
            // 同一条规矩：要丢的动作由 `presenting:` 带进闭包，不在确认那一刻回头读。
            .alert(
                "丢弃改动？",
                isPresented: isPresentingDiscard,
                presenting: flow.discardConfirmation
            ) { pending in
                Button("取消", role: .cancel) { flow.cancelDiscard() }
                    .accessibilityIdentifier("git-discard-cancel")
                Button("丢弃并切换", role: .destructive) {
                    Task { await flow.discardChanges(pending, on: desk) }
                }
                .accessibilityIdentifier("git-discard-confirm")
            } message: { pending in
                Text(Self.discardMessage(for: pending, changeCount: changeCount))
            }
    }

    private var decisionTitle: String {
        Self.decisionTitle(changeCount: changeCount)
    }

    private func decisionMessage(for pending: TerminalGitPendingSwitch) -> String {
        Self.decisionMessage(for: pending)
    }

}

// 两处的文案抽成静态函数，只为一件事：它们是**这一整条路上最要紧的两句话**，
// 而要紧的话要被单测钉住，不能只跟着视图一起被眼睛看一眼。见 `TerminalGitFlowTests`。
extension TerminalGitDirtySheet {

    /// 改动数来自电脑（`mobile.gitStatus`），不是手机自己数的。
    static func decisionTitle(changeCount: Int) -> String {
        changeCount > 0 ? "有 \(changeCount) 个文件未提交" : "有未提交的改动"
    }

    static func decisionMessage(for pending: TerminalGitPendingSwitch) -> String {
        switch pending {
        case .checkout(let branch):
            return "要切换到 \(branch)，先处理这些改动。"
        case .createBranch(let name, _):
            return "要新建并切换到 \(name)，先处理这些改动。"
        case .merge:
            return "合并前要先处理这些改动。"
        }
    }

    /// 二次确认的正文。
    ///
    /// 后半句是这一整条路上最要紧的一句：它说的不是「我们会小心」，是**未跟踪的新文件
    /// 一个都不会少**。用户在这里丢的是已跟踪文件的修改，不是他放在同一个目录里的草稿 ——
    /// 而他看不出手机在这一点上会怎么选，所以必须写出来。
    static func discardMessage(for pending: TerminalGitPendingSwitch?, changeCount: Int) -> String {
        let what = changeCount > 0 ? "这 \(changeCount) 个文件的修改" : "当前目录里未提交的修改"
        guard case .checkout(let branch)? = pending else {
            return "会丢掉\(what)，无法撤销。未跟踪的新文件不会被删除。"
        }
        return "切换到 \(branch) 会丢掉\(what)，无法撤销。未跟踪的新文件不会被删除。"
    }
}
