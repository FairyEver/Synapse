import SwiftUI

/// 合并分支。
///
/// 两个方向都给，而且**把方向二的链路写在脸上**：它必然要离开当前分支（git 没有
/// 「留在原分支、把成果合进别的分支」这条原语），结束后再切回来。用户在这里看到的
/// 那一行，就是电脑接下来真的会做的那几步。
///
/// 冲突不在这里处理：电脑会自动取消合并并回退，手机只拿到一个结论。
struct TerminalGitMerge: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk
    let currentBranch: String?

    var body: some View {
        List {
            Section("方向") {
                ForEach(TerminalGitMergeDirection.allCases) { direction in
                    directionRow(direction)
                }
            }

            Section("分支") {
                TerminalGitActionRow(
                    title: flow.mergeDirection == .intoCurrent ? "来源分支" : "目标分支",
                    detail: flow.mergeBranch ?? "未选择",
                    identifier: "git-merge-branch"
                ) {
                    flow.path.append(.branches(.merge))
                }
            }

            Section {
                Text(plan)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("git-merge-plan")
            } header: {
                Text("将要执行")
            } footer: {
                Text(conflictNote)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("合并分支")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("合并") {
                    Haptics.commit()
                    Task { await flow.merge(on: desk) }
                }
                // 没有选分支就没什么可合的。让这一颗灰着，比让它发出去再报一次错好。
                .disabled(flow.mergeBranch == nil)
                .accessibilityIdentifier("git-merge-run")
            }
        }
    }

    /// 一行方向：标题、链路、勾。勾在右边，与分支列表里那一枚同一个位置。
    private func directionRow(_ direction: TerminalGitMergeDirection) -> some View {
        Button {
            Haptics.select()
            flow.mergeDirection = direction
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(direction.label)
                    Text(direction.detail(currentBranch: currentLabel))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if flow.mergeDirection == direction {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("git-merge-direction-\(direction.rawValue)")
    }

    private var currentLabel: String { currentBranch ?? "当前分支" }

    /// 实际会发生的事，一句话。没选分支时说的就是当下该做的事。
    private var plan: String {
        guard let branch = flow.mergeBranch else { return "先选一条分支。" }
        switch flow.mergeDirection {
        case .intoCurrent:
            return "在 \(currentLabel) 上合并 \(branch)"
        case .outOfCurrent:
            return "切到 \(branch) → 合并 \(currentLabel) → 切回 \(currentLabel)"
        }
    }

    private var conflictNote: String {
        switch flow.mergeDirection {
        case .intoCurrent:
            return "一旦发生冲突，会自动取消这次合并并退回到合并前，然后给你一段可复制的冲突信息。手机上不解决冲突。"
        case .outOfCurrent:
            return "git 没有「留在原分支、把成果合进别的分支」这条原语，所以这一步必然要离开当前分支，结束后会切回来。一旦发生冲突，会取消合并并切回原分支。"
        }
    }
}
