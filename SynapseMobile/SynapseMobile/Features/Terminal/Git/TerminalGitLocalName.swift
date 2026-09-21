import SwiftUI

/// 同名本地分支不能直接用时，要另一个本地名。
///
/// **推成一页而不是弹一张表**：失败弹窗挂在面板上，表盖在面板之上时弹窗会被它挡住 ——
/// 用户看到的是「点了没反应」。推成一页，弹窗就浮在这一页之上。
///
/// 返回走系统那颗（左上角的返回键）：这一组子页都只有一颗确认键，多摆一颗「返回」会顶掉
/// 系统的返回键，同时也顶掉从屏幕左边滑回来的那个手势。离开这一页时把输入清掉 ——
/// 页没了，它那一半填了一半的状态也该没了。
struct TerminalGitLocalName: View {
    @Bindable var flow: TerminalGitFlow
    let desk: TerminalGitDesk

    private var prompt: TerminalGitLocalNamePrompt? { flow.localNamePrompt }

    private var nameBinding: Binding<String> {
        Binding(
            get: { flow.localNamePrompt?.name ?? "" },
            set: { flow.localNamePrompt?.name = $0 }
        )
    }

    private var trimmedName: String {
        (prompt?.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        List {
            // 「这一页为什么在问」——**电脑的原话**，不改写、不翻译。
            Section {
                Text(prompt?.message ?? "")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("git-remote-local-name-reason")
            }

            Section("另一个本地名") {
                TextField("feature/xxx", text: nameBinding)
                    // 分支名是路径形状的东西：首字母自动大写与自动纠错都会把它改坏。
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("git-remote-local-name")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("迁出远端分支")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("迁出") {
                    Haptics.commit()
                    // 名字那一格留在 flow 上：失败时这一页不关，字也要留着。
                    Task { await flow.submitLocalName(on: desk) }
                }
                // 只拦住「空」这一条，合法性交给电脑的 `check-ref-format`
                // —— 与新建分支同一口径，不在手机上复刻一套规则。
                .disabled(trimmedName.isEmpty || flow.isBusy)
                .accessibilityIdentifier("git-remote-local-name-confirm")
            }
        }
        .onDisappear { flow.clearLocalNamePrompt() }
    }
}
