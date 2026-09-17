import SwiftUI

/// The keys a phone has no other way to send, laid out where a keyboard has them.
///
/// The accessory bar shows the computer's own buttons; this is the other half of what
/// that bar replaced. Ten fixed keys used to sit beside it, and removing them took away
/// every key that is not a printable character — the arrows, Esc, Tab, Backspace — along
/// with the two that a terminal cannot be driven without. They live here instead, behind
/// one tap, and the layout is the point: a finger finds `esc` in the corner because it
/// knows where the corner is, not because it read a label.
///
/// Read-only, deliberately. These are keys, not commands: there is nothing to add,
/// rename or delete, and no menu on a long press.

// MARK: - Layout model

/// One cell in a category's grid.
///
/// The grid is hand-built rather than derived from `MOBILE_KEYS`, because where a key
/// sits is the whole design: `↑` above `↓` with `←` and `→` beside it is the arrow
/// cluster, and `^W` sits on the W key. A list iterated in order would be a keyboard
/// laid out alphabetically.
private enum KeyboardPanelCell {
    /// A key that can be pressed. `title` is the compact form a phone keyboard uses —
    /// `^A`, not `Ctrl+A`.
    case key(MobileKey, title: String, width: CGFloat?, modifierLegend: Bool)
    /// Empty space that takes whatever is left, which is what pins a key to a side.
    case gap
    /// A hole the size of a key, so a row lines up with the one above it.
    case hole(CGFloat)
    /// A letter drawn only for reference — where a control key would be if this were a
    /// real keyboard. Not tappable, and not a key.
    case reference(String)
}

private struct KeyboardPanelCategory: Identifiable {
    let id: String
    let name: String
    let rows: [[KeyboardPanelCell]]
    /// Pushes the whole grid to one side, for the clusters that live on the right of
    /// a real keyboard.
    let alignedTrailing: Bool
    /// Equal-width cells, which is what a QWERTY row is.
    let stretchesRows: Bool
    /// Per-row leading inset, the stagger that makes the letter rows read as a keyboard.
    let indents: [CGFloat]

    init(
        id: String,
        name: String,
        rows: [[KeyboardPanelCell]],
        alignedTrailing: Bool = false,
        stretchesRows: Bool = false,
        indents: [CGFloat] = []
    ) {
        self.id = id
        self.name = name
        self.rows = rows
        self.alignedTrailing = alignedTrailing
        self.stretchesRows = stretchesRows
        self.indents = indents
    }
}

private let keyboardPanelCategories: [KeyboardPanelCategory] = [
    // The four corners of the board: Esc top-left, ⌫ top-right, Tab left, Return right
    // and wider than the rest because that is the key your hand goes to blind.
    KeyboardPanelCategory(
        id: "common",
        name: "常用",
        rows: [
            [
                .key(.escape, title: "esc", width: 78, modifierLegend: false),
                .gap,
                .key(.backspace, title: "⌫", width: 78, modifierLegend: false),
            ],
            [
                .key(.tab, title: "tab", width: 96, modifierLegend: false),
                .gap,
                .key(.enter, title: "回车", width: 112, modifierLegend: false),
            ],
        ]
    ),
    // The inverted T of the arrow cluster, on the right of a real keyboard.
    KeyboardPanelCategory(
        id: "arrows",
        name: "方向",
        rows: [
            [.hole(56), .key(.arrowUp, title: "↑", width: 56, modifierLegend: false), .hole(56)],
            [.key(.arrowLeft, title: "←", width: 56, modifierLegend: false),
             .key(.arrowDown, title: "↓", width: 56, modifierLegend: false),
             .key(.arrowRight, title: "→", width: 56, modifierLegend: false)],
        ],
        alignedTrailing: true
    ),
    // The six-key cluster above the arrows. Insert's slot is left as a hole rather than
    // filled with something that is not there.
    KeyboardPanelCategory(
        id: "function",
        name: "功能",
        rows: [
            [.hole(64), .key(.home, title: "home", width: 64, modifierLegend: false),
             .key(.pageUp, title: "pgup", width: 64, modifierLegend: false)],
            [.key(.delete, title: "del", width: 64, modifierLegend: false),
             .key(.end, title: "end", width: 64, modifierLegend: false),
             .key(.pageDown, title: "pgdn", width: 64, modifierLegend: false)],
        ],
        alignedTrailing: true
    ),
    // The QWERTY ghost: every control combination sits on the letter that produces it,
    // so they can be found by muscle memory instead of read off a list. The rest of the
    // board is drawn dimmed as a reference and cannot be pressed.
    KeyboardPanelCategory(
        id: "control",
        name: "控制",
        rows: [
            [.reference("q"), .key(.controlW, title: "W", width: nil, modifierLegend: true),
             .key(.controlE, title: "E", width: nil, modifierLegend: true),
             .key(.controlR, title: "R", width: nil, modifierLegend: true),
             .reference("t"), .reference("y"),
             .key(.controlU, title: "U", width: nil, modifierLegend: true),
             .reference("i"), .reference("o"), .reference("p")],
            [.key(.controlA, title: "A", width: nil, modifierLegend: true),
             .reference("s"),
             .key(.controlD, title: "D", width: nil, modifierLegend: true),
             .reference("f"), .reference("g"), .reference("h"), .reference("j"),
             .key(.controlK, title: "K", width: nil, modifierLegend: true),
             .key(.controlL, title: "L", width: nil, modifierLegend: true)],
            [.key(.controlZ, title: "Z", width: nil, modifierLegend: true),
             .reference("x"),
             .key(.controlC, title: "C", width: nil, modifierLegend: true),
             .reference("v"), .reference("b"), .reference("n"), .reference("m")],
        ],
        stretchesRows: true,
        indents: [0, 14, 28]
    ),
]

// MARK: - Shared key capsule

/// The capsule a key is drawn in, wherever a key is drawn.
///
/// Shared between this panel and the accessory bar above it, which is what keeps the two
/// reading as the same row of keys rather than two rows that happen to be next to each
/// other. It is the geometry the accessory bar always used — the only thing the toolbar
/// changed is where the labels come from.
struct TerminalKeyPill: ViewModifier {
    var minWidth: CGFloat = 48

    func body(content: Content) -> some View {
        content
            .font(.system(.subheadline, design: .monospaced, weight: .medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(minWidth: minWidth, minHeight: 36)
            .background(
                Color(uiColor: .secondarySystemBackground),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            // The pill is the control; this is the room around it. Applied after the
            // background so the pill keeps its own size and only the tappable box grows.
            .frame(minHeight: Metrics.minimumTapTarget)
            .contentShape(Rectangle())
    }
}

extension View {
    func terminalKeyPill(minWidth: CGFloat = 48) -> some View {
        modifier(TerminalKeyPill(minWidth: minWidth))
    }
}

// MARK: - Panel

/// The panel itself: a category picker over the grid for whichever category is chosen.
struct TerminalKeyboardPanel: View {
    /// Nil while the terminal is not running, which greys out every key.
    let isEnabled: Bool
    let onKey: (MobileKey) -> Void

    @State private var selectedCategoryId = keyboardPanelCategories[0].id

    private var category: KeyboardPanelCategory {
        keyboardPanelCategories.first { $0.id == selectedCategoryId } ?? keyboardPanelCategories[0]
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("按键分类", selection: $selectedCategoryId) {
                ForEach(keyboardPanelCategories) { category in
                    Text(category.name).tag(category.id)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 14)
            .padding(.bottom, 12)

            // A fixed height for every category, so switching between a two-row grid and
            // a three-row one does not move the panel under the finger that is using it.
            VStack(spacing: 4) {
                ForEach(Array(category.rows.enumerated()), id: \.offset) { index, row in
                    rowView(row, indent: category.indents.indices.contains(index) ? category.indents[index] : 0)
                }
            }
            .frame(maxWidth: .infinity, minHeight: KeyboardPanelMetrics.gridHeight, alignment: .top)
            .padding(.horizontal, 14)
        }
        .padding(.top, 8)
        .padding(.bottom, 14)
    }

    private func rowView(_ row: [KeyboardPanelCell], indent: CGFloat) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                cellView(cell)
            }
        }
        .padding(.leading, indent)
        .frame(maxWidth: .infinity, alignment: category.alignedTrailing ? .trailing : .leading)
    }

    @ViewBuilder
    private func cellView(_ cell: KeyboardPanelCell) -> some View {
        switch cell {
        case .gap:
            Spacer(minLength: 0)
        case .hole(let width):
            // Invisible rather than absent: it holds the column so the row above lines up.
            Color.clear.frame(width: width, height: 1)
        case .reference(let letter):
            Text(letter)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(maxWidth: category.stretchesRows ? .infinity : nil, minHeight: 42)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        case .key(let key, let title, let width, let legend):
            keyView(key, title: title, width: width, legend: legend)
        }
    }

    private func keyView(_ key: MobileKey, title: String, width: CGFloat?, legend: Bool) -> some View {
        Button {
            Haptics.select()
            onKey(key)
        } label: {
            // The `^` sits in the corner, the way a shifted legend does on a real cap:
            // the letter is the key, the caret is what is being held down with it.
            ZStack(alignment: .topLeading) {
                if legend {
                    Text("^")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
                Text(title)
                    .frame(maxWidth: .infinity)
            }
            .terminalKeyPill(minWidth: width ?? 0)
            .frame(width: width)
            .frame(maxWidth: category.stretchesRows ? .infinity : nil, minHeight: 42)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.4)
        .accessibilityIdentifier("panelkey-\(key.rawValue)")
    }
}

enum KeyboardPanelMetrics {
    /// The grid's height, held constant across categories. Deep enough for the three-row
    /// QWERTY ghost and no deeper, so the terminal above stays visible while the panel is
    /// open — the arrows are pressed by someone watching the screen, not the keys.
    static let gridHeight: CGFloat = 152
    /// Where the panel rests. It can be pulled up from here; this is what it opens at.
    static let restingHeight: CGFloat = 280
}
