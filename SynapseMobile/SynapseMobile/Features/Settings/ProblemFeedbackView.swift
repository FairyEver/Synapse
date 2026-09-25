import SwiftUI

/// 写一条问题反馈，提交到服务端。
///
/// 一个输入框加一个提交按钮，没有别的。反馈的去向、怎么被处理、谁来读，都不是这一页
/// 该说的话 —— 读者此刻要做的事只有一件：把遇到的问题写下来。
///
/// **提交前 trim。** 服务端要求 `content === content.trim()`（`@synapse/shared` 的
/// `validateProblemFeedbackInput`），而多行输入框里手一滑就带出一个尾随换行。不 trim
/// 就会把人拒在一个他从屏幕上完全看不出来的错误上。
struct ProblemFeedbackView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var submitting = false

    /// 空白不算内容：只有空格的输入框不该让提交按钮亮起来。
    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        Form {
            Section {
                TextField("说说遇到了什么", text: $text, axis: .vertical)
                    .lineLimit(6...14)
                    .accessibilityIdentifier("feedback-text")
            }
        }
        .noticeOverlay(model)
        .navigationTitle("问题反馈")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("提交") { submit() }
                    .disabled(trimmed.isEmpty || submitting)
                    .accessibilityIdentifier("feedback-submit")
            }
        }
    }

    private func submit() {
        submitting = true
        Task {
            let content = trimmed
            let outcome = await model.submitProblemFeedback(content)
            submitting = false
            // 成功走 `success`，其余走 `failure`：`unknown` 也是失败 —— 内容可能已经
            // 送出去了，但这件事对读者来说没成，他不该看到一条绿色的东西。
            model.notice(outcome.message, tone: outcome == .submitted ? .success : .failure)
            if outcome == .submitted { dismiss() }
        }
    }
}
