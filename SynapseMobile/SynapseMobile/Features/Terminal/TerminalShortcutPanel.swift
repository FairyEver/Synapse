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
                .padding(.bottom, 6)
                .accessibilityIdentifier("shortcut-panel-segment")
            }

            switch shown {
            case .commands: commands
            case .phrases: phraseList
            }
        }
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
    }

    // MARK: - 快捷命令

    /// The commands, wrapped rather than scrolled sideways.
    ///
    /// A group per grid, with the rule between the grids: the line then spans the panel
    /// on its own, which is the one thing a grid cannot be asked to draw inside itself.
    /// It is also the same statement the bar's vertical line makes — cross it, and the
    /// commands change kind — which is what keeps the two views of one list readable as
    /// one list.
    private var commands: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(Array(commandGroups.enumerated()), id: \.offset) { index, group in
                    if index > 0 { Divider() }
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 88), spacing: 8)],
                        spacing: 8
                    ) {
                        ForEach(group) { button in
                            Button(button.label) {
                                Haptics.select()
                                onRun(button)
                            }
                            // White on the panel's grey, which is the bar's own pill the
                            // other way round: the resting fill is the secondary
                            // background, and that is exactly the colour of this sheet.
                            .terminalKeyPill(onGroupedBackground: true)
                            .buttonStyle(.plain)
                            .disabled(!isRunning)
                            .opacity(isRunning ? 1 : 0.4)
                            .accessibilityIdentifier("shortcut-\(button.id)")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
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

    /// One sentence, on one line.
    ///
    /// The row is not a `Button`. It will hold a control of its own — the key that shows
    /// the part of the sentence a single line cannot — and a button inside a button is
    /// not something SwiftUI defines. Tapping it is a gesture rather than a button so
    /// that the two can coexist.
    private func row(_ phrase: MobileQuickPhrase) -> some View {
        Text(phrase.content)
            // One line always, ellipsised at the tail: a sentence allowed to wrap would
            // turn the card into a wall and lose the whole point of the list, which is
            // reading a dozen of them at a glance.
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
            // The whole row is the target, text and empty space alike — not just the
            // sentence, which is one line of many and often shorter than the row.
            .contentShape(Rectangle())
            .onTapGesture {
                Haptics.select()
                onInsert(phrase)
            }
            .accessibilityIdentifier("phrase-row-\(phrase.id)")
    }
}
