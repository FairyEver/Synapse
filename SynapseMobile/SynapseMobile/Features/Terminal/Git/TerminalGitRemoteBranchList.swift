import SwiftUI

/// 远端分支列表，带搜索。
///
/// **只读电脑缓存的 `refs/remotes`**：打开这一页不联网，要最新的就下拉 ——
/// 下拉是先 `fetch --all --prune`、再重取这张列表。
///
/// **不打勾**：远端列表里没有「当前分支」这个概念，那是本地概念。当前分支跟踪的那条
/// 远端分支点一下本来就会正确切过去，不需要额外标出来。
struct TerminalGitRemoteBranchList: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk

    var body: some View {
        List {
            if flow.isLoadingRemoteBranches, flow.remoteBranches.isEmpty {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            } else if groups.isEmpty {
                emptyState
            } else {
                ForEach(groups) { group in
                    Section("\(group.remote) · \(group.branches.count)") {
                        ForEach(group.branches) { branch in
                            row(branch)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        // `displayMode: .always`：这一页是**推进来**的，默认的 `.automatic` 在推进来的页上
        // 不给搜索框 —— 与本地分支列表同一条做法与同一个理由。用户硬要求：只要涉及到
        // 选分支的地方，一定要有搜索框。
        .searchable(
            text: $flow.remoteBranchQuery,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "搜索分支"
        )
        .navigationTitle("远端分支")
        .navigationBarTitleDisplayMode(.inline)
        // 下拉 = 先获取、再重取（电脑那边是两条动作，手机这边是两次往返）。
        .refreshable { await flow.refreshRemoteBranches(on: desk) }
        .task { await flow.loadRemoteBranches(on: desk) }
    }

    /// 顺序与分组都吃电脑给的：手机上只切段，不重排。
    private var groups: [TerminalGitRemoteBranchGroup] {
        TerminalGitPresentation.remoteBranchGroups(matches)
    }

    private var query: String {
        flow.remoteBranchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var matches: [MobileGitRemoteBranch] {
        TerminalGitPresentation.matchingRemoteBranches(flow.remoteBranches, query: flow.remoteBranchQuery)
    }

    /// 搜不到与「一条远端分支都没有」是两件事，说法也不一样。
    @ViewBuilder
    private var emptyState: some View {
        if query.isEmpty {
            ContentUnavailableView {
                Label("还没有远端分支", systemImage: "arrow.triangle.branch")
            } description: {
                Text("这个仓库还没有任何远端分支。下拉一次试试。")
                    .accessibilityIdentifier("git-remote-branches-empty")
            }
            .listRowBackground(Color.clear)
        } else {
            ContentUnavailableView {
                Label("没有匹配的分支", systemImage: "magnifyingglass")
            } description: {
                Text("没有名字包含「\(query)」的远端分支。")
                    .accessibilityIdentifier("git-remote-branches-empty")
            }
            .listRowBackground(Color.clear)
        }
    }

    /// 行文字是**限定名**（`origin/dev`）：与 git 自己的说法一致，用户能直接对照终端里的输出。
    private func row(_ branch: MobileGitRemoteBranch) -> some View {
        Button {
            Haptics.select()
            Task { await flow.checkoutRemote(branch.remote, branch: branch.name, on: desk) }
        } label: {
            Text(branch.qualifiedName)
                .lineLimit(1)
                .truncationMode(.middle)
                .contentShape(Rectangle())
        }
        .accessibilityIdentifier("git-remote-branch-\(branch.qualifiedName)")
    }
}
