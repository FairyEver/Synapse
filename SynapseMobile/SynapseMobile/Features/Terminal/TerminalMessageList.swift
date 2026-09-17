import SwiftUI
import UIKit

/// What the open terminal has to say about something the user just tried.
///
/// It sits directly above the file strip: close enough to the input bar to read as an
/// answer to what was just typed, and never over the output being read. Nothing is
/// drawn when there is nothing to say — a row that is always there would take a line
/// from the terminal forever, which is the rule the file strip already follows.
///
/// It stays until dismissed, unlike the notice bar at the bottom of the screen. These
/// are answers to an action taken moments ago, and an answer that leaves on a clock can
/// be gone before the user looks up from the keyboard.
struct TerminalMessageList: View {
    let messages: [TerminalMessage]
    let onDismiss: (String) -> Void

    var body: some View {
        if messages.isEmpty {
            EmptyView()
        } else {
            VStack(spacing: 0) {
                ForEach(messages) { message in
                    row(message)
                }
            }
            .background(Color(uiColor: .systemBackground))
            .overlay(alignment: .top) { Divider().opacity(0.3) }
            .accessibilityIdentifier("terminal-messages")
        }
    }

    private func row(_ message: TerminalMessage) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption2)
                .foregroundStyle(Theme.failure)

            Text(message.text)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Offered only where the way forward is outside the app. Naming a path in
            // Settings without offering to open it asks the user to navigate a maze
            // from memory.
            if message.opensSettings, let settings = URL(string: UIApplication.openSettingsURLString) {
                Button("去设置") {
                    UIApplication.shared.open(settings)
                }
                .font(.footnote.weight(.medium))
            }

            Button {
                onDismiss(message.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    // The glyph is small; the target it sits in is not.
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("关闭")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
