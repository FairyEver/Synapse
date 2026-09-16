import SwiftUI

/// The row between the terminal and the keyboard bars that shows files on their
/// way to the computer.
///
/// It sits above the accessory bar rather than over the terminal so that a
/// transfer never covers output the user is reading, and it collapses to nothing
/// the moment there is nothing to say — a strip that is always there would take
/// a line from the terminal forever.
struct TerminalRelayStrip: View {
    let attachments: [TerminalAttachment]
    let onUndo: ([String]) -> Void
    let onDismiss: (String) -> Void
    let onRetry: (String) -> Void

    private var undoTargets: [String] {
        attachments.filter { $0.insertedPath != nil }.map(\.id)
    }

    private var waitingCount: Int {
        attachments.filter { $0.state == .waitingForComputer }.count
    }

    var body: some View {
        if attachments.isEmpty { EmptyView() } else { strip }
    }

    private var strip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if waitingCount > 0 {
                    // Said in words rather than as a spinner: nothing is happening
                    // while the computer is away, and a spinner would claim it is.
                    chip(label: "已上传 \(waitingCount) 个 · 等待电脑接收", tone: .waiting)
                        .accessibilityIdentifier("relay-waiting")
                }

                ForEach(attachments) { attachment in
                    attachmentChip(attachment)
                }

                if !undoTargets.isEmpty {
                    Button("撤销插入") { onUndo(undoTargets) }
                        .font(.footnote)
                        .foregroundStyle(Theme.ink)
                        .accessibilityIdentifier("relay-undo")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
        .accessibilityIdentifier("relay-strip")
    }

    @ViewBuilder
    private func attachmentChip(_ attachment: TerminalAttachment) -> some View {
        HStack(spacing: 6) {
            Text(attachment.name)
                .font(.footnote)
                .lineLimit(1)
                .truncationMode(.middle)

            statusGlyph(for: attachment)

            if attachment.canBeDismissed {
                Button {
                    onDismiss(attachment.id)
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("relay-dismiss-\(attachment.name)")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            if attachment.state.isFailed { onRetry(attachment.id) }
        }
    }

    @ViewBuilder
    private func statusGlyph(for attachment: TerminalAttachment) -> some View {
        switch attachment.state {
        case .queued:
            ProgressView().controlSize(.mini)
        case .uploading(let fraction):
            if let fraction {
                ProgressView(value: fraction)
                    .progressViewStyle(.linear)
                    .frame(width: 34)
            } else {
                // The server gave no length, so there is no honest fraction to draw.
                ProgressView().controlSize(.mini)
            }
        case .waitingForComputer:
            Image(systemName: "clock")
                .font(.caption2)
                .foregroundStyle(.secondary)
        case .delivered:
            Image(systemName: "checkmark")
                .font(.caption2)
                .foregroundStyle(Theme.running)
        case .failed:
            // Tapping the chip retries, so the glyph says so rather than only
            // reporting that something went wrong.
            Image(systemName: "arrow.clockwise")
                .font(.caption2)
                .foregroundStyle(Theme.failure)
        }
    }

    private enum Tone { case waiting }

    private func chip(label: String, tone: Tone) -> some View {
        Text(label)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color(uiColor: .secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
