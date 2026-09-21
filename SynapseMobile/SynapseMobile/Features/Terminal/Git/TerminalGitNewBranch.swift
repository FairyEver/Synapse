import SwiftUI

/// 新建一条分支。
///
/// **分支名合不合法交给电脑判**（它跑 `check-ref-format`）：`check-ref-format` 的规则
/// 不适合在手机上复刻一份，复刻了就一定会与电脑分叉。这里只管「非空」这一条，所以
/// 「创建」在名字为空时不可点，其余情况都放行。
struct TerminalGitNewBranch: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk
    let currentBranch: String?

    var body: some View {
        List {
            Section("分支名") {
                TextField("feature/xxx", text: $flow.newBranchName)
                    // 分支名是路径形状的东西：首字母自动大写与自动纠错都会把它改坏。
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("git-new-branch-name")
            }

            Section {
                TerminalGitActionRow(
                    title: "从哪条分支开始",
                    detail: startPointLabel,
                    identifier: "git-new-branch-from"
                ) {
                    flow.path.append(.branches(.startPoint))
                }
            } footer: {
                Text("从这条分支开始，新建之后直接切过去。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("新建分支")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("创建") {
                    Haptics.commit()
                    Task { await flow.createBranch(on: desk) }
                }
                .disabled(trimmedName.isEmpty)
                .accessibilityIdentifier("git-new-branch-create")
            }
        }
    }

    private var trimmedName: String {
        flow.newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 起点缺席＝从当前 HEAD 起，所以显示的要是**当前那条分支的名字**，
    /// 而不是一个「默认」之类什么都没有的词。
    private var startPointLabel: String {
        flow.newBranchFrom ?? currentBranch ?? "当前分支"
    }
}
