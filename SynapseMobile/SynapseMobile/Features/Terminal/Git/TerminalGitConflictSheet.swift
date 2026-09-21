import SwiftUI

/// 冲突已经收尾之后的那一页。
///
/// **这一页只说明与复制。** 没有任何「继续合并」「标记已解决」「要不要重试」的入口 ——
/// 电脑那边已经自动 `merge --abort` 回退了，仓库回到了合并前，所以这里没有一条岔路，
/// 只有一件要做的事：把那段文字复制走，粘给别的 Agent。
///
/// 列出的是电脑给的 `files`，不是手机从 `summaryText` 里数出来的：手机不解析文件清单，
/// 那一整段文本的用途是进剪贴板。
struct TerminalGitConflictSheet: View {
    /// 这一页是盖在面板上的第二层弹窗，它发出去的提示得由它自己画 —— 面板的提示条在它
    /// 下面，而「已复制」正是这一页唯一的结果，看不见就等于没发生。
    @Environment(SynapseAppModel.self) private var model
    let conflict: MobileGitConflict
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("发生了什么") {
                    Text("把 \(conflict.source) 合并到 \(conflict.target) 时发生冲突。已经自动取消这次合并并退回到合并前，仓库回到了合并前的状态。")
                        .accessibilityIdentifier("git-conflict-summary")
                }

                Section("冲突文件 · \(conflict.files.count)") {
                    ForEach(conflict.files, id: \.self) { file in
                        Text(file)
                            .font(.footnote.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                Section {
                    Button {
                        Haptics.success()
                        // 复制**不关这一页**：文本已经进剪贴板了，而用户可能想再复制一次，
                        // 或者先把这一段读一遍再走。出口只有右上角那颗「好」。
                        model.notice(
                            TerminalGitConflictCopy.put(conflict),
                            tone: .success,
                            id: "git.conflict.copied"
                        )
                    } label: {
                        Text("复制冲突信息")
                            .frame(maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("git-conflict-copy")
                } footer: {
                    Text("复制之后粘给任意一个 Agent，它就能接手处理这些冲突。")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("合并已取消")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("好") { onClose() }
                        .accessibilityIdentifier("git-conflict-done")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// 把那段拼好的文本放进剪贴板。
///
/// 单独抽出来是为了它能被单测钉住：这一页在手机上只有这一个结果，而「复制了没有」
/// 是唯一能验的东西 —— 加上弹出面板的那一下，整条路就走完了。
enum TerminalGitConflictCopy {
    /// - Returns: 要说给用户的那句话。
    static func put(_ conflict: MobileGitConflict) -> String {
        UIPasteboard.general.string = conflict.summaryText
        return "冲突信息已复制到剪贴板。"
    }
}
