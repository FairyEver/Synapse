import SwiftUI

/// 提交。
///
/// 三段：将要提交什么、写一句什么、提交之后要不要推送。
///
/// **只显示改动数量，不显示任何文件名**，也不能挑文件：手机端不接收文件清单，提交一律
/// 全量（`add -A` + commit）。这是省流量那一刀，也是「手机上不挑文件」那一刀。
struct TerminalGitCommit: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk
    /// 电脑说的改动数 —— 面板上的数值原样带过来，手机不自己数。
    let changeCount: Int

    var body: some View {
        List {
            Section("将要提交") {
                LabeledContent("全部改动", value: "\(changeCount) 个文件")
            }

            Section("提交信息") {
                // 多行：一句提交信息经常要写两行，而单行输入框在第二行开始就看不见自己在
                // 写什么了。`lineLimit(3...8)` 是「先给三行，最多长到八行」。
                TextField("写一句这次改了什么", text: $flow.commitMessage, axis: .vertical)
                    .lineLimit(3...8)
                    .accessibilityIdentifier("git-commit-message")
            }

            Section {
                Toggle("提交后立即推送", isOn: $flow.pushAfterCommit)
                    .accessibilityIdentifier("git-commit-push-toggle")
            } footer: {
                Text("默认关。推送是对外动作，不该在你没要求时发生。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("提交")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("提交") {
                    Haptics.commit()
                    Task { await flow.commit(on: desk) }
                }
                .disabled(trimmedMessage.isEmpty)
                .accessibilityIdentifier("git-commit-submit")
            }
        }
    }

    private var trimmedMessage: String {
        flow.commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
