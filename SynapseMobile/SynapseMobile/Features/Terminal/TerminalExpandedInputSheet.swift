import SwiftUI

/// A larger view of the terminal's existing draft. Dismissing it keeps the same text
/// in the compact field; only a confirmed send clears it.
struct TerminalExpandedInputSheet: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding var draft: String
    @Binding var selection: TextSelection?
    let sessionId: String

    @FocusState private var editorFocused: Bool
    @State private var sending = false
    @State private var sendError: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextEditor(text: $draft, selection: $selection)
                    .font(.system(.body, design: .monospaced))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($editorFocused)
                    .disabled(sending)
                    .accessibilityIdentifier("terminal-expanded-input")
                    .accessibilityLabel("输入命令")

                if let sendError {
                    Text(sendError)
                        .foregroundStyle(Color(uiColor: .systemRed))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("terminal-expanded-error")
                }
            }
            .padding(16)
            .navigationTitle("输入命令")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭") { dismiss() }
                        .disabled(sending)
                        .accessibilityIdentifier("terminal-expanded-close")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await sendDraft() }
                    } label: {
                        if sending { ProgressView() } else { Text("发送") }
                    }
                    .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("terminal-expanded-send")
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(sending)
        .onAppear { editorFocused = true }
        .onChange(of: draft) { sendError = nil }
    }

    private func sendDraft() async {
        guard !sending, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        sending = true
        let text = draft
        let outcome = await model.sendCommandConfirming(sessionId, text: text)
        sending = false
        switch outcome {
        case .sent:
            Haptics.commit()
            model.commitDeliveredAttachments(for: sessionId)
            draft = ""
            dismiss()
        case .notSent(let message), .uncertain(let message):
            sendError = message
        }
    }
}
