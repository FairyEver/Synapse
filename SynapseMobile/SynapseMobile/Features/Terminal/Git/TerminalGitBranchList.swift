import SwiftUI

/// 分支列表这一次是替谁选的。
///
/// 三种去向共用一个列表：切过去、当新建分支的起点、当合并的另一条分支。分开写三份的下场
/// 是搜索框只加在其中一处 —— 而「只要涉及到选分支的地方，一定要有搜索框」是硬要求。
enum TerminalGitBranchPurpose: Hashable {
    case checkout
    case startPoint
    case merge
}

/// 本地分支列表，带搜索。
///
/// **只列本地分支**：远端分支走「迁出远端分支」那一页（面板「操作」段的最后一行）。
/// 注意「同步会把远端的新分支带回来」这句话是不成立的 —— 同步跑的是 `fetch --prune`
/// 加 `merge --ff-only @{u}`，`@{u}` 只是当前分支的上游，`refs/heads` 一条都不会多。
struct TerminalGitBranchList: View {
    @Environment(SynapseAppModel.self) private var model
    @Bindable var flow: TerminalGitFlow
    let purpose: TerminalGitBranchPurpose
    let desk: TerminalGitDesk

    var body: some View {
        List {
            if flow.isLoadingBranches, flow.branches.isEmpty {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            } else if matches.isEmpty {
                emptyState
            } else {
                Section(sectionHeader) {
                    ForEach(matches) { branch in
                        row(branch)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        // `displayMode: .always`：这一页是**推进来**的，而默认的 `.automatic` 在推进来的
        // 页上不给搜索框（`.searchable` 只长在导航栈的根上）—— 试过 `.inline`/`.large`、
        // 试过把半屏弹窗拉到全屏，搜索框都不出现。常显这个 placement 是系统给的那一个
        // 说法，也正是产品负责人点名要的那条：「选分支的地方一定要有搜索框」。
        .searchable(
            text: $flow.branchQuery,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "搜索分支"
        )
        .navigationTitle(purpose == .merge ? "选择分支" : "分支")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // 新建分支的入口只属于「切分支」那一次：从起点选择页或合并选择页里再开一条
            // 新分支，是把两件事叠在一起，用户从这里回不到刚才那张表单。
            if purpose == .checkout {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Haptics.select()
                        flow.path.append(.newBranch)
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("新建分支")
                    .accessibilityIdentifier("git-branch-new")
                }
            }
        }
        .task { await flow.loadBranches(on: desk) }
    }

    private var sectionHeader: String {
        "本地分支 · \(matches.count)"
    }

    private var query: String {
        flow.branchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 本地分支里名字命中的那些。空查询就是全部。
    private var matches: [MobileGitBranch] {
        TerminalGitPresentation.matchingBranches(flow.branches, query: flow.branchQuery)
    }

    /// 搜不到与「一条都没有」是两件事，说法也不一样：前者是换个词再试，后者是这一页
    /// 现在没东西可给。标识符挂在说明那一行 —— 它才是用例查的 `staticTexts`，
    /// 挂在容器上元素类型会变成 other。
    @ViewBuilder
    private var emptyState: some View {
        if query.isEmpty {
            ContentUnavailableView {
                Label("还没有本地分支", systemImage: "arrow.triangle.branch")
            } description: {
                Text("这个仓库里还没有任何本地分支。")
                    .accessibilityIdentifier("git-branches-empty")
            }
            .listRowBackground(Color.clear)
        } else {
            ContentUnavailableView {
                Label("没有匹配的分支", systemImage: "magnifyingglass")
            } description: {
                Text("没有名字包含「\(query)」的分支。")
                    .accessibilityIdentifier("git-branches-empty")
            }
            .listRowBackground(Color.clear)
        }
    }

    private func row(_ branch: MobileGitBranch) -> some View {
        Button {
            Haptics.select()
            Task { await flow.pick(branch, purpose: purpose, on: desk) }
        } label: {
            HStack(spacing: 12) {
                Text(branch.name)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                if isTicked(branch) {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("git-branch-\(branch.name)")
    }

    /// 钩子打在**这一次会选中的那一条**上：切分支是当前分支，起点与合并是已经选好的那条。
    private func isTicked(_ branch: MobileGitBranch) -> Bool {
        switch purpose {
        case .checkout:
            return branch.current
        case .startPoint:
            return branch.name == (flow.newBranchFrom ?? currentBranch)
        case .merge:
            return branch.name == flow.mergeBranch
        }
    }

    private var currentBranch: String? {
        guard case .repository(let status)? = model.gitStatus(for: flow.sessionId) else { return nil }
        return status.branch
    }
}
