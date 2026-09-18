import SwiftUI

/// The two things the panel can show, in the order the segment control draws them.
enum ShortcutPanelSegment: String, CaseIterable, Identifiable {
    case commands
    case phrases

    var id: String { rawValue }

    var label: String {
        switch self {
        case .commands: return "快捷命令"
        case .phrases: return "快捷输入"
        }
    }
}

/// Every command the computer offers, and every sentence it keeps — the whole list at
/// once, rather than the strip that has to be scrolled to be read.
///
/// The bar under the terminal and this panel are two views of one list, deliberately:
/// the bar is for when you know which command you want and want it near your thumb,
/// and the panel is for when you do not remember what you added on the computer. They
/// share the commands rather than the drawing — the bar is a single scrolling line, and
/// this is a sheet that shows everything at once.
///
/// The second segment exists only if the computer said it does. A computer that has
/// sent `mobile.quickPhrases` — with sentences or with none — decides that completely;
/// a computer that has never sent it has not answered, and the panel stays the single
/// section it has always been. That is `TerminalQuickPhrasesState`'s rule, and it is why
/// `phrases` is optional rather than defaulting to empty.
struct TerminalShortcutPanel: View {
    let buttons: [MobileToolbarButton]
    /// `nil` when the computer being viewed has never described its sentences. An empty
    /// array is a computer that has, and has none.
    let phrases: [MobileQuickPhrase]?
    let isRunning: Bool
    /// Runs a command on the computer. The panel is closed by the caller.
    let onRun: (MobileToolbarButton) -> Void
    /// Puts a sentence into the input field, without sending it.
    ///
    /// The difference from `onRun` is the whole reason the two segments are not one
    /// list. A command is an act; a sentence is text, and text belongs somewhere the
    /// reader can carry on editing it — so it lands in the composer, the panel closes,
    /// and whether it is sent, and when, stays the reader's decision.
    let onInsert: (MobileQuickPhrase) -> Void

    /// Which segment was last looked at, remembered across launches.
    ///
    /// Remembered rather than reset, and *not* corrected when the remembered segment is
    /// empty: swapping the user's own last choice for a different one silently is worse
    /// than letting them see an empty state, because the empty state says why it is
    /// empty and a jump says nothing at all.
    @AppStorage("terminal.shortcutPanel.segment") private var segmentRaw = ShortcutPanelSegment.commands.rawValue

    /// The sentence whose full text is being read, if any.
    @State private var previewing: MobileQuickPhrase?

    private var segment: Binding<ShortcutPanelSegment> {
        Binding(
            get: { ShortcutPanelSegment(rawValue: segmentRaw) ?? .commands },
            set: { segmentRaw = $0.rawValue }
        )
    }

    /// What to draw, given what the computer answered.
    ///
    /// With no second segment there is only one thing to draw whatever the remembered
    /// value says — so a stale "phrases" from a previous computer cannot leave the
    /// panel blank, and the picker is not drawn to switch away from anyway.
    private var shown: ShortcutPanelSegment {
        phrases == nil ? .commands : segment.wrappedValue
    }

    var body: some View {
        VStack(spacing: 0) {
            if phrases != nil {
                Picker("", selection: segment) {
                    ForEach(ShortcutPanelSegment.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                .accessibilityIdentifier("shortcut-panel-segment")
            }

            switch shown {
            case .commands: commands
            case .phrases: phraseList
            }
        }
        // Room for the sheet's drag indicator, which the system draws *over* this content
        // rather than above it — so without this the first thing in the panel is drawn
        // under the grabber. The prototype's own number: ten above the grabber, five for
        // it, eight below.
        .padding(.top, 24)
        // The sheet's own base is the grouped grey, and it is set here rather than inside
        // either section so that switching segments cannot change it. It is also what the
        // command pills stand on: their resting fill is the plain background, and on a
        // plain sheet they would have no edge at all.
        .background(Color(uiColor: .systemGroupedBackground))
        // Fixed detents rather than a height that follows the content: switching segments
        // must not move the sheet, and a sheet sized to its content would jump every time
        // a shorter segment was chosen.
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // A second sheet over this one rather than a replacement for it, so closing the
        // preview comes back to the panel still open and still on the same segment — the
        // reader was looking at one sentence, not leaving the list.
        .sheet(item: $previewing) { phrase in
            PhrasePreviewSheet(phrase: phrase)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - 快捷命令

    /// The commands, one per row — the shape the sentences take one segment over.
    ///
    /// They were a two-column grid at first, on the argument that command labels are
    /// short and a grid shows more of them at once. That argument does not survive a real
    /// list: 「提交开发测试部署」 is an entirely ordinary name and it wraps inside its
    /// cell, which makes that row twice the height of the one beside it and stops the
    /// grid reading as a grid at all. One command per row, one line each, is what the
    /// panel is shaped like now.
    ///
    /// A section per group, which is how a grouped list says "these are not the same
    /// kind of thing" — the job the full-width rule used to do, done the way the system
    /// does it. The rows are tinted rather than plain, unlike the sentences: these run
    /// something, and every iOS list says so the same way.
    private var commands: some View {
        List {
            ForEach(Array(commandGroups.enumerated()), id: \.offset) { _, group in
                Section {
                    ForEach(group) { button in
                        Button(button.label) {
                            Haptics.select()
                            onRun(button)
                        }
                        // One line always, ellipsised at the tail, for the reason the
                        // sentences are: a label allowed to wrap would make one row
                        // taller than its neighbours.
                        .lineLimit(1)
                        .truncationMode(.tail)
                        // Greyed by the system rather than by an opacity of ours, so a
                        // stopped terminal looks like every other disabled row.
                        .disabled(!isRunning)
                        .accessibilityIdentifier("shortcut-\(button.id)")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    /// The buttons, split where the computer says the list changes kind.
    ///
    /// Consecutive runs rather than a grouping by value: the computer's order is what
    /// the user sees, and two runs of the same kind either side of another one are two
    /// groups, not one merged one.
    private var commandGroups: [[MobileToolbarButton]] {
        var groups: [[MobileToolbarButton]] = []
        for button in buttons {
            if groups.last?.last?.group == button.group {
                groups[groups.count - 1].append(button)
            } else {
                groups.append([button])
            }
        }
        return groups
    }

    // MARK: - 快捷输入

    private var phraseList: some View {
        List {
            if let phrases, !phrases.isEmpty {
                ForEach(phrases) { phrase in
                    row(phrase)
                }
            } else {
                Text("电脑上还没有快捷输入")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("shortcut-phrases-empty")
            }
        }
        // The look of the list is the system's own — row height, corner radius, the
        // separator's inset — rather than a set of numbers written out to imitate it.
        .listStyle(.insetGrouped)
    }

    /// One sentence, and the key that shows the part of it a single line cannot.
    ///
    /// The row is not a `Button`, and the preview key is one. A button inside a button
    /// is not something SwiftUI defines, and the two do different things anyway: tapping
    /// the row puts the sentence in the composer, while the key only shows it. The key
    /// takes its own taps because it is the closer control, so the row's gesture never
    /// sees them.
    private func row(_ phrase: MobileQuickPhrase) -> some View {
        HStack(spacing: 8) {
            Text(phrase.content)
                // One line always, ellipsised at the tail: a sentence allowed to wrap
                // would turn the card into a wall and lose the whole point of the list,
                // which is reading a dozen of them at a glance. What does not fit is
                // what the eye beside it is for.
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                // On the sentence rather than on the row: the row is an `HStack` with a
                // button in it, and `HStack` is not something the accessibility tree has
                // a name for. This is also the element a tap has to land on, which is
                // what makes it the row's address rather than only its label.
                .accessibilityIdentifier("phrase-row-\(phrase.id)")

            Button {
                Haptics.select()
                previewing = phrase
            } label: {
                Image(systemName: "eye")
                    .font(.system(size: 19))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("看全文")
            .accessibilityIdentifier("phrase-preview-\(phrase.id)")
        }
        // The whole row is the target, text and empty space alike — not just the
        // sentence, which is one line of many and often shorter than the row.
        .contentShape(Rectangle())
        .onTapGesture {
            Haptics.select()
            onInsert(phrase)
        }
    }
}

/// One sentence, in full, read-only.
///
/// The answer to the ellipsis in the list: the part a single line could not hold is
/// usually the part that decides whether this is the sentence you wanted.
///
/// No "use this" button, deliberately. The row behind already does that, and a second
/// way in — from a sheet that is meant to be a glance — would make reading a sentence
/// an act with consequences.
private struct PhrasePreviewSheet: View {
    let phrase: MobileQuickPhrase

    var body: some View {
        ScrollView {
            Text(phrase.content)
                .font(.body)
                // Ordinary selectable text, so the system supplies long-press selection
                // and copy. That is the whole interaction: the only thing to do with a
                // sentence here is read it, and the only thing to do with a part of it
                // is take it.
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                // Room for the sheet's drag indicator, which is drawn over this content
                // rather than above it — the same clearance the panel itself takes, and
                // for the same reason. Without it the sentence starts underneath the
                // grabber.
                .padding(.top, 24)
                .padding(.bottom, 16)
                .accessibilityIdentifier("phrase-preview-text")
        }
    }
}
