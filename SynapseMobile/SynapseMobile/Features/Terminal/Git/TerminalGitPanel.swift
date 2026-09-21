import SwiftUI

/// 手机上的 Git 面板。
///
/// 它只做两件事：**看状态**，和**选一个动作**。动作自己不在这里就地展开 —— 提交要写字、
/// 合并要选分支，都是各有导航栏和确认键的独立一页（设计文档决策五）。
///
/// 形状照兄弟面板 `TerminalShortcutPanel` 抄：`.sheet` 自带 `NavigationStack`、
/// `.listStyle(.insetGrouped)`、`ContentUnavailableView` 做空态、`Haptics` 做反馈。
/// 不自创一套长得不一样的面板。
struct TerminalGitPanel: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Bindable var flow: TerminalGitFlow

    private var desk: TerminalGitDesk { model.gitDesk }

    /// 电脑说的当前状态。`nil` 是「不是仓库」或「还没收到回答」，两者在这里都画成空态。
    private var status: MobileGitStatus? {
        guard case .repository(let status)? = model.gitStatus(for: flow.sessionId) else { return nil }
        return status
    }

    var body: some View {
        // 这四层弹窗拆成四个修饰器各写一处，不是为了让谁好看：挤在一个表达式里，
        // 类型检查会超时（这一页的类型足够多，前面那几页也踩过同一件事）。
        panel
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .modifier(TerminalGitDirtySheet(
                flow: flow,
                desk: desk,
                changeCount: status?.changeCount ?? 0
            ))
            .modifier(TerminalGitFailureAlert(
                flow: flow,
                desk: desk,
                changeCount: status?.changeCount ?? 0
            ))
            .sheet(item: $flow.conflict) { conflict in
                TerminalGitConflictSheet(conflict: conflict) { flow.dismissConflict() }
                    // 冲突页是盖在面板上的第二层弹窗，面板自己的提示条在它下面 ——
                    // 而「已复制」正是这一页唯一的结果，看不见就等于没发生。
                    .noticeOverlay(model)
            }
    }

    private var panel: some View {
        NavigationStack(path: $flow.path) {
            content
                .navigationTitle("Git")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: TerminalGitFlow.Route.self) { destination($0) }
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { dismiss() }
                            .accessibilityIdentifier("git-panel-done")
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let status {
            list(status)
        } else {
            // 进得来就说明刚才还是仓库。走到这一支只可能是电脑后来改了主意（用户在终端里
            // `cd` 走了），所以它说的是当下的事实，不是一句道歉。
            ContentUnavailableView {
                Label(unavailableTitle, systemImage: "arrow.triangle.branch")
            } description: {
                Text("在终端里 cd 到一个 Git 仓库，这个面板就有东西可以看了。")
                    .accessibilityIdentifier("git-panel-unavailable")
            }
        }
    }

    private var unavailableTitle: String {
        if case .notARepository? = model.gitStatus(for: flow.sessionId) { return "这个目录不是 Git 仓库" }
        return "还没有拿到这个目录的状态"
    }

    private func list(_ status: MobileGitStatus) -> some View {
        List {
            Section("仓库目录") {
                LabeledContent("目录") {
                    Text(status.cwd)
                        .font(.footnote.monospaced())
                        // 中间截断：路径最有用的两段在两头 —— 开头是它在哪个盘/用户下，
                        // 结尾是仓库名。这一行是这个功能的信任基础：用户必须能看到电脑
                        // 在哪个目录上干活，尤其是他刚在终端里 cd 过之后。
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .accessibilityIdentifier("git-panel-cwd")
            }

            Section("当前状态") {
                // 这一行既是状态也是入口。设置类应用里「带值 + 尖括号」的行就是这个含义。
                TerminalGitActionRow(
                    title: "分支",
                    detail: TerminalGitPresentation.branchLabel(status),
                    identifier: "git-panel-branch"
                ) {
                    flow.path.append(.branches(.checkout))
                }
                LabeledContent("远端", value: TerminalGitPresentation.remoteLabel(status))
                LabeledContent("同步", value: TerminalGitPresentation.syncLabel(status))
                LabeledContent("改动", value: TerminalGitPresentation.changeLabel(status))
            }

            Section("操作") {
                TerminalGitActionRow(
                    title: "提交",
                    detail: TerminalGitPresentation.canCommit(status)
                        ? nil
                        : TerminalGitPresentation.commitUnavailableLabel(status),
                    enabled: TerminalGitPresentation.canCommit(status) && !flow.isBusy,
                    identifier: "git-panel-commit"
                ) {
                    flow.path.append(.commit)
                }

                TerminalGitActionRow(
                    title: TerminalGitPresentation.pushTitle(status),
                    detail: TerminalGitPresentation.canPush(status)
                        ? nil
                        : TerminalGitPresentation.pushUnavailableLabel(status),
                    enabled: TerminalGitPresentation.canPush(status) && !flow.isBusy,
                    identifier: "git-panel-push"
                ) {
                    Task { await flow.push(on: desk) }
                }

                // 同步总是可点：它没有「没什么可同步」这种状态需要禁用，而它失败时的
                // 下一步（去提交）比一颗灰掉的按钮有用。只有一个例外：手上还有一个动作
                // 在跑（见下面那行转圈），第二下会被按住 —— 一次推送按两下就是推两次。
                TerminalGitActionRow(
                    title: "同步",
                    enabled: !flow.isBusy,
                    identifier: "git-panel-sync"
                ) {
                    Task { await flow.sync(changeCount: status.changeCount, on: desk) }
                }

                TerminalGitActionRow(
                    title: "合并分支",
                    enabled: !flow.isBusy,
                    identifier: "git-panel-merge"
                ) {
                    flow.path.append(.merge)
                }

                // 排在这一段的最后：它是这一组里唯一一个「从远端拿东西回来」的动作，
                // 前面四个都是对本地已有的东西动手。
                TerminalGitActionRow(
                    title: "迁出远端分支",
                    enabled: !flow.isBusy,
                    identifier: "git-panel-remote-branches"
                ) {
                    flow.path.append(.remoteBranches)
                }

                if flow.isBusy {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .accessibilityIdentifier("git-panel-busy")
                }
            }
        }
        .listStyle(.insetGrouped)
        // 下拉重取状态：用户在电脑上 cd 到别处之后，下拉一下就能让面板跟上。
        .refreshable { await flow.refresh(on: desk) }
        // 打开面板也问一次：第二行跟着摘要的心跳走，而这一页要的是**此刻**的目录与状态。
        .task { await flow.refresh(on: desk) }
    }

    /// 失败弹窗。
    ///
    /// 标题是**动作名**（「推送被拒绝」「同步不了」），正文是**电脑返回的原文** ——
    /// 不改写、不翻译，也不替它编一个原因。电脑没说出原因时，`message` 那边已经是一句
    /// 「电脑没有完成这个操作」，那是手机能说的最诚实的一句。
    ///
    /// 能给下一步的都给一个：推送失败给「同步」，同步遇脏给「去提交」。一颗「好」什么都
    /// 不解决的时候，用户还得自己想起来去哪儿。
    private struct TerminalGitFailureAlert: ViewModifier {
        let flow: TerminalGitFlow
        let desk: TerminalGitDesk
        let changeCount: Int

        func body(content: Content) -> some View {
            content
                .alert(
                    flow.failure?.title ?? "",
                    isPresented: Binding(
                        get: { flow.failure != nil },
                        set: { presented in if !presented { flow.dismissFailure() } }
                    )
                ) {
                    if let next = flow.failure?.next {
                        Button(next == .sync ? "同步" : "去提交") {
                            Task { await flow.followUp(next, changeCount: changeCount, on: desk) }
                        }
                    }
                    Button("好", role: .cancel) { flow.dismissFailure() }
                } message: {
                    Text(flow.failure?.message ?? "")
                }
        }
    }

    @ViewBuilder
    private func destination(_ route: TerminalGitFlow.Route) -> some View {
        switch route {
        case .branches(let purpose):
            TerminalGitBranchList(flow: flow, purpose: purpose, desk: desk)
        case .newBranch:
            TerminalGitNewBranch(flow: flow, desk: desk, currentBranch: status?.branch)
        case .commit:
            TerminalGitCommit(flow: flow, desk: desk, changeCount: status?.changeCount ?? 0)
        case .merge:
            TerminalGitMerge(flow: flow, desk: desk, currentBranch: status?.branch)
        case .remoteBranches:
            TerminalGitRemoteBranchList(flow: flow, desk: desk)
        case .remoteLocalName:
            TerminalGitLocalName(flow: flow, desk: desk)
        }
    }
}
