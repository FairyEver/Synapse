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

    /// Only the ones the computer has not started on.
    ///
    /// This sentence is a claim about what the computer has *not* done, so a file it
    /// has begun fetching must not be counted here — that file says so itself, on
    /// its own chip, with a bar. Counting it would leave the strip asserting "still
    /// waiting" next to evidence to the contrary.
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
                    chip(label: "已上传 \(waitingCount) 个 · 等待电脑接收")
                        .accessibilityIdentifier("relay-waiting")
                }

                ForEach(attachments) { attachment in
                    attachmentChip(attachment)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .top) { Divider().opacity(0.3) }
        .accessibilityIdentifier("relay-strip")
    }

    /// A file's chip, opening onto the operations that file allows.
    ///
    /// The operations are inside the chip rather than beside it because there can be
    /// nine chips at once, and a row of glyphs and buttons per file made the strip
    /// read as a control panel: a tick, a cross and a "撤销插入" all competing to be
    /// the thing the eye lands on. What a user wants from a file they just sent is
    /// its name and whether it arrived.
    ///
    /// A transfer with nothing available — every one still moving — is drawn as a
    /// plain chip rather than as a menu that would open onto an empty list.
    @ViewBuilder
    private func attachmentChip(_ attachment: TerminalAttachment) -> some View {
        if attachment.availableActions.isEmpty {
            chipChrome(attachment)
                // One element, named by its file and described by its state. The
                // progress bar inside would otherwise be its own stop in the
                // accessibility tree, and a reader would arrive at an unlabelled
                // indicator between two chips.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(attachment.name)
                .accessibilityValue(attachment.stateDescription)
                .accessibilityIdentifier("relay-chip-\(attachment.state.identifier)")
        } else {
            Menu {
                // Opening the chip is the only place the reason can be read. The chip
                // has room for a filename and a mark, and the sentence that decides
                // whether retrying is worth it is longer than that.
                if case .failed(let reason) = attachment.state, !reason.isEmpty {
                    Text(reason)
                }
                ForEach(attachment.availableActions, id: \.self) { action in
                    Button(action.label, role: action.isDestructive ? .destructive : nil) {
                        perform(action, on: attachment)
                    }
                }
            } label: {
                chipChrome(attachment)
                    // The chip is the control; this is the room around it, the same
                    // split the terminal's key pills use. Only this one gets it: the
                    // waiting-count chip and the plain chips are sentences, and a
                    // taller sentence would just make the strip fatter.
                    //
                    // The shape is declared again out here because the one inside
                    // chipChrome is measured against the pill: a frame is only layout,
                    // and the transparent band it adds would not answer a tap.
                    .frame(minHeight: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            // On the menu rather than on its label: the label is what the menu
            // draws, and hiding its children from the accessibility tree would take
            // the menu's own button down with them.
            .accessibilityLabel(attachment.name)
            .accessibilityValue(attachment.stateDescription)
            .accessibilityIdentifier("relay-chip-\(attachment.state.identifier)")
        }
    }

    private func chipChrome(_ attachment: TerminalAttachment) -> some View {
        HStack(spacing: 6) {
            Text(attachment.name)
                .font(.footnote)
                .lineLimit(1)
                .truncationMode(.middle)

            statusIndicator(for: attachment)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
    }

    private func perform(_ action: TerminalAttachment.Action, on attachment: TerminalAttachment) {
        switch action {
        case .undoInsert:
            // The backspaces land in the terminal, which is a pane this strip sits
            // under — often scrolled somewhere else by now.
            Haptics.select()
            onUndo([attachment.id])
        case .retry:
            // No feedback of its own: a retry ends in the attachment's state, and
            // `Haptics` already speaks for that from the model.
            onRetry(attachment.id)
        case .dismiss:
            // The only action here that cannot be taken back: it takes the copy on the
            // computer's drive with it.
            Haptics.warning()
            onDismiss(attachment.id)
        }
    }

    /// Only what is still moving, and what went wrong.
    ///
    /// A file waiting on the computer and a file already on it both say everything
    /// they have to say with their names — the strip's own sentence covers the first,
    /// and the path appearing in the terminal covers the second. A tick next to a
    /// filename is a badge for a success the user did not need told.
    @ViewBuilder
    private func statusIndicator(for attachment: TerminalAttachment) -> some View {
        switch attachment.state {
        case .queued:
            ProgressView().controlSize(.mini)
        case .uploading(let fraction), .receiving(let fraction):
            progress(fraction)
        case .waitingForComputer, .delivered:
            EmptyView()
        case .failed:
            // No retry arrow: retrying is in the menu now, so an arrow here would
            // promise a tap on the chip that no longer does anything.
            Image(systemName: "exclamationmark")
                .font(.caption2)
                .foregroundStyle(Theme.failure)
        }
    }

    @ViewBuilder
    private func progress(_ fraction: Double?) -> some View {
        if let fraction {
            ProgressView(value: fraction)
                .progressViewStyle(.linear)
                .frame(width: 34)
        } else {
            // No length was declared, so there is no honest fraction to draw.
            ProgressView().controlSize(.mini)
        }
    }

    private func chip(label: String) -> some View {
        Text(label)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color(uiColor: .secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
