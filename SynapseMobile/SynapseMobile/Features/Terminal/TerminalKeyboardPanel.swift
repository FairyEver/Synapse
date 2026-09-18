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
/// The last category is a real keyboard rather than a picture of one. A modifier is
/// latched by tapping it and the next letter completes the chord, which is the only
/// vocabulary a touch screen has for "hold Ctrl and press C" — a `Button` reports a tap
/// on the way up and has no state to read while a finger is still down.
///
/// Read-only, deliberately. These are keys, not commands: there is nothing to add,
/// rename or delete, and no menu on a long press.

// MARK: - Modifiers

/// The three modifiers the panel can hold down.
///
/// There is no Command, and that is a fact about macOS rather than a preference: the
/// terminal app consumes ⌘ itself — ⌘C copies, ⌘V pastes, ⌘K clears — and no byte of it
/// ever reaches the PTY. A Command key here would either do nothing or do something that
/// belongs to a different feature. This panel sends a key; it does not run a command.
private enum KeyboardPanelModifier: String, CaseIterable, Identifiable {
    case control = "Ctrl"
    case shift = "Shift"
    case alt = "Alt"

    var id: String { rawValue }
}

/// What pressing one key of the full keyboard page sends.
///
/// `unavailable` exists so that no key on this panel can be a key that does nothing:
/// the readout turns yellow and says why, which is the difference between a chord the
/// terminal has no byte for and a panel that is broken.
private enum KeyboardPanelPress {
    case send([MobileKeyAction], detail: String)
    case unavailable(String)
}

/// What each control chord means, keyed by the letter that produces it.
///
/// Written out rather than derived from the alphabet, because the detail is the point:
/// the readout carries both the byte and the meaning, which is how somebody using this
/// panel twice learns what `^C` is. `I` and `M` are absent on purpose — see `press`.
private let keyboardPanelControlChords: [Character: (key: MobileKey, detail: String)] = [
    "a": (.controlA, "0x01 · 行首"),
    "b": (.controlB, "0x02 · tmux 前缀"),
    "c": (.controlC, "0x03 · 中断当前进程"),
    "d": (.controlD, "0x04 · EOF · 退出"),
    "e": (.controlE, "0x05 · 行尾"),
    "f": (.controlF, "0x06 · 前进一个词 / 翻页"),
    "g": (.controlG, "0x07 · 取消"),
    "h": (.controlH, "0x08 · 退格（≠ ⌫）"),
    "j": (.controlJ, "0x0a · 换行"),
    "k": (.controlK, "0x0b · 删到行尾"),
    "l": (.controlL, "0x0c · 清屏"),
    "n": (.controlN, "0x0e · 下一条历史"),
    "o": (.controlO, "0x0f · 忽略"),
    "p": (.controlP, "0x10 · 上一条历史"),
    "q": (.controlQ, "0x11 · 恢复输出"),
    "r": (.controlR, "0x12 · 反向搜索历史"),
    "s": (.controlS, "0x13 · 暂停输出"),
    "t": (.controlT, "0x14 · 交换字符"),
    "u": (.controlU, "0x15 · 删到行首"),
    "v": (.controlV, "0x16 · 字面量插入"),
    "w": (.controlW, "0x17 · 删一个词"),
    "x": (.controlX, "0x18 · readline 前缀"),
    "y": (.controlY, "0x19 · 粘贴"),
    "z": (.controlZ, "0x1a · 挂起"),
]

/// The symbol each digit's key shows and sends while Shift is latched, as on the
/// system keyboard. Same mapping, so nothing has to be learned twice.
private let keyboardPanelShiftedDigits: [Character: Character] = [
    "1": "!", "2": "@", "3": "#", "4": "$", "5": "%",
    "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
]

// MARK: - Layout model

/// One cell in a category's grid.
///
/// The grid is hand-built rather than derived from `MOBILE_KEYS`, because where a key
/// sits is the whole design: `↑` above `↓` with `←` and `→` beside it is the arrow
/// cluster, and `esc` belongs in the corner your thumb already knows.
private enum KeyboardPanelCell {
    /// A key that can be pressed. `title` is the compact form a phone keyboard uses —
    /// `esc`, not `Escape`.
    case key(MobileKey, title: String, width: CGFloat?)
    /// Empty space that takes whatever is left, which is what pins a key to a side.
    case gap
    /// A hole the size of a key, so a row lines up with the one above it.
    case hole(CGFloat)
}

private struct KeyboardPanelCategory: Identifiable {
    let id: String
    let name: String
    let rows: [[KeyboardPanelCell]]
    /// Pushes the whole grid to one side, for the clusters that live on the right of
    /// a real keyboard.
    let alignedTrailing: Bool

    init(
        id: String,
        name: String,
        rows: [[KeyboardPanelCell]],
        alignedTrailing: Bool = false
    ) {
        self.id = id
        self.name = name
        self.rows = rows
        self.alignedTrailing = alignedTrailing
    }

    /// A grid of fixed keys, drawn by hand rather than from `rows`.
    var isFullKeyboard: Bool { id == Self.fullKeyboardId }

    static let fullKeyboardId = "full"
}

private let keyboardPanelCategories: [KeyboardPanelCategory] = [
    // The four corners of the board: Esc top-left, ⌫ top-right, Tab left, Return right
    // and wider than the rest because that is the key your hand goes to blind.
    //
    // `⇧tab` sits between them because it has no other home: Shift is on the full
    // keyboard page and Tab is on this one, and switching pages drops a latched
    // modifier, so the two could never be combined. It is worth the middle slot —
    // driving Claude Code from a phone means cycling its permission mode constantly.
    KeyboardPanelCategory(
        id: "common",
        name: "常用",
        rows: [
            // Two gaps rather than none: they take the leftover width between the three
            // keys, so `esc` stays in the corner, `⌫` stays in the corner, and `⇧tab`
            // lands in the middle rather than beside the first one.
            [
                .key(.escape, title: "esc", width: 78),
                .gap,
                .key(.shiftTab, title: "⇧tab", width: 92),
                .gap,
                .key(.backspace, title: "⌫", width: 78),
            ],
            [
                .key(.tab, title: "tab", width: 96),
                .gap,
                .key(.enter, title: "回车", width: 112),
            ],
        ]
    ),
    // The inverted T of the arrow cluster, on the right of a real keyboard.
    KeyboardPanelCategory(
        id: "arrows",
        name: "方向",
        rows: [
            [.hole(56), .key(.arrowUp, title: "↑", width: 56), .hole(56)],
            [.key(.arrowLeft, title: "←", width: 56),
             .key(.arrowDown, title: "↓", width: 56),
             .key(.arrowRight, title: "→", width: 56)],
        ],
        alignedTrailing: true
    ),
    // The six-key cluster above the arrows. Insert's slot is left as a hole rather than
    // filled with something that is not there.
    KeyboardPanelCategory(
        id: "function",
        name: "功能",
        rows: [
            [.hole(64), .key(.home, title: "home", width: 64),
             .key(.pageUp, title: "pgup", width: 64)],
            [.key(.delete, title: "del", width: 64),
             .key(.end, title: "end", width: 64),
             .key(.pageDown, title: "pgdn", width: 64)],
        ],
        alignedTrailing: true
    ),
    // The real keyboard. Its name says what it is rather than what it contains: the
    // page it replaced was called 控制, which sounds like a control key and was in fact
    // a whole board — one that drew twenty-six letters and could only press ten of them.
    KeyboardPanelCategory(id: KeyboardPanelCategory.fullKeyboardId, name: "全键盘", rows: [])
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
    /// Drawn inverted, the way iOS draws a held shift. This is not decoration: for a
    /// latched modifier it is the entire feedback the interaction has.
    var prominent: Bool = false
    /// Drawn in the fill iOS uses for a control that is being pressed, for a key that
    /// is held rather than latched — the toolbar's panel key, which stays down for as
    /// long as the panel it opened is up.
    ///
    /// A shade below `prominent` on purpose: opening a panel is a state, not the
    /// committing action `prominent` is reserved for, and inverting a key that is
    /// merely open would make the toolbar's loudest control the one that does least.
    var pressed: Bool = false
    /// Drawn for a pill standing on a grouped background rather than on a bar.
    ///
    /// The resting fill is the secondary background, which is the same colour as a
    /// grouped sheet — so a command drawn on the panel's grey would have no edge at
    /// all. On that one surface the pill takes the plain background instead, which is
    /// the same relationship the bar has with a sheet, the other way round.
    var onGroupedBackground: Bool = false
    /// The room between the label and the pill's edge. Ten keys have to share one row
    /// on the full keyboard, so its keys are about a third the width of these and
    /// cannot afford the padding a two-key row can.
    var horizontalPadding: CGFloat = 12

    /// The pill's own fill, in the order of how loud the state is.
    ///
    /// These are the three system fills iOS is made of, and the reason to name them
    /// rather than pick colours: `secondarySystemBackground` is the resting pill and
    /// `systemFill` is what iOS draws under a press, so the held state needs no
    /// definition of its own to look like one.
    private var fill: Color {
        if prominent { return Color.primary }
        if pressed { return Color(uiColor: .systemFill) }
        if onGroupedBackground { return Color(uiColor: .systemBackground) }
        return Color(uiColor: .secondarySystemBackground)
    }

    func body(content: Content) -> some View {
        content
            .font(.system(.subheadline, design: .monospaced, weight: .medium))
            .foregroundStyle(prominent ? Color(uiColor: .systemBackground) : Color.primary)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, 9)
            .frame(minWidth: minWidth, minHeight: 36)
            .background(
                fill,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            // The pill is the control; this is the room around it. Applied after the
            // background so the pill keeps its own size and only the tappable box grows.
            .frame(minHeight: Metrics.minimumTapTarget)
            .contentShape(Rectangle())
    }
}

extension View {
    func terminalKeyPill(
        minWidth: CGFloat = 48,
        prominent: Bool = false,
        pressed: Bool = false,
        onGroupedBackground: Bool = false,
        horizontalPadding: CGFloat = 12
    ) -> some View {
        modifier(TerminalKeyPill(
            minWidth: minWidth,
            prominent: prominent,
            pressed: pressed,
            onGroupedBackground: onGroupedBackground,
            horizontalPadding: horizontalPadding
        ))
    }
}

// MARK: - Panel

/// The panel itself: a category picker over the grid for whichever category is chosen.
struct TerminalKeyboardPanel: View {
    /// Nil while the terminal is not running, which greys out every key.
    let isEnabled: Bool
    let onActions: ([MobileKeyAction]) -> Void

    @State private var selectedCategoryId = keyboardPanelCategories[0].id

    /// The modifier that will combine with the next key, if any.
    ///
    /// One at a time, always. Every chord this panel can send needs exactly one
    /// modifier, so a second one replaces the first instead of stacking — stacking
    /// would leave no key on the board that could be pressed at all, and a user would
    /// read that as the panel being broken.
    @State private var latchedModifier: KeyboardPanelModifier?
    /// Set when the same modifier is tapped twice in quick succession, for pressing a
    /// chord several times. Stays until tapped again.
    @State private var lockedModifier: KeyboardPanelModifier?
    @State private var lastModifierTap: (modifier: KeyboardPanelModifier, at: Date)?
    /// What the readout's right-hand side shows: the last thing this page sent.
    @State private var lastPress: KeyboardPanelPress?

    private var category: KeyboardPanelCategory {
        keyboardPanelCategories.first { $0.id == selectedCategoryId } ?? keyboardPanelCategories[0]
    }

    private var effectiveModifier: KeyboardPanelModifier? { lockedModifier ?? latchedModifier }

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

            if category.isFullKeyboard {
                readout
                    .padding(.bottom, 8)
                fullKeyboard
                hint
            } else {
                staticGrid
                // The three shorter pages keep their keys at the top and leave the rest
                // of the panel empty — the visible cost of one height for all four, and
                // the reason a page change no longer moves what is above the panel.
                Spacer(minLength: 0)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 14)
        // It sits in the layout at the height it is given rather than sizing itself the
        // way a sheet did. It is a keyboard now: what is above it is the terminal being
        // watched, and what is below it is the bottom of the screen.
        .frame(height: KeyboardPanelMetrics.height)
        // Its own surface, the same one the two bars above it wear — the panel, the
        // toolbar and the input bar are the light half of this screen together, and
        // the dark canvas is what they are all sitting on.
        .background(Color(uiColor: .systemBackground))
        .onChange(of: selectedCategoryId) { _, _ in
            // Changing page is changing what the keys mean, so a latched modifier is
            // dropped rather than carried into a board it does not belong to.
            clearModifier()
            // And so is the readout: it says what this page would send next, so a
            // result left over from another page's key would be answering a question
            // nobody asked. It reads as a prediction, not as a log.
            lastPress = nil
        }
    }

    // MARK: - Static pages

    private var staticGrid: some View {
        VStack(spacing: 4) {
            ForEach(Array(category.rows.enumerated()), id: \.offset) { _, row in
                rowView(row)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .padding(.horizontal, 14)
    }

    private func rowView(_ row: [KeyboardPanelCell]) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                cellView(cell)
            }
        }
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
        case .key(let key, let title, let width):
            keyView(key, title: title, width: width)
        }
    }

    private func keyView(_ key: MobileKey, title: String, width: CGFloat?) -> some View {
        Button {
            Haptics.select()
            // A named key is a key: there is no modifier on this page to combine it
            // with, and Shift+Tab — the one chord worth having here — has its own key
            // above precisely because it cannot be composed across pages.
            onActions([.key(key)])
            lastPress = .send([.key(key)], detail: title)
        } label: {
            Text(title)
                .frame(maxWidth: .infinity)
                .terminalKeyPill(minWidth: width ?? 0)
                .frame(width: width)
                .frame(minHeight: 42)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.4)
        .accessibilityIdentifier("panelkey-\(key.rawValue)")
    }

    // MARK: - Full keyboard

    private let keyboardSpacing: CGFloat = 4

    private var fullKeyboard: some View {
        GeometryReader { proxy in
            // Ten columns fill whatever width the page has, so the board scales from an
            // iPhone to an iPad without a second layout. Fixed widths are what let the
            // short rows be centred rather than stretched, which is the stagger that
            // makes the letter block read as a keyboard.
            let keyWidth = max(24, (proxy.size.width - keyboardSpacing * 9) / 10)
            VStack(spacing: keyboardSpacing) {
                modifierRow
                digitRow(keyWidth: keyWidth)
                ForEach(Array(letterRows.enumerated()), id: \.offset) { _, row in
                    letterRow(row, keyWidth: keyWidth)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(.horizontal, 14)
    }

    /// The three rows of a QWERTY board, lower case — what Shift turns into upper case.
    private let letterRows: [[Character]] = [
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
        ["z", "x", "c", "v", "b", "n", "m"],
    ]

    private let digitKeys: [Character] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]

    /// Fixed-width, so the two that belong to the left hand stay together and `Alt`
    /// stays where the right hand reaches for it, as on a real board.
    private var modifierRow: some View {
        HStack(spacing: keyboardSpacing) {
            ForEach([KeyboardPanelModifier.control, .shift]) { modifier in
                modifierKey(modifier)
            }
            Spacer(minLength: 0)
            modifierKey(.alt)
        }
    }

    private func modifierKey(_ modifier: KeyboardPanelModifier) -> some View {
        let isLatched = effectiveModifier == modifier
        let isLocked = lockedModifier == modifier
        return Button {
            Haptics.select()
            tapModifier(modifier)
        } label: {
            ZStack(alignment: .topTrailing) {
                Text(modifier.rawValue)
                    .frame(maxWidth: .infinity)
                // The dot marks a modifier that stays down after the key it combines
                // with, which is what makes repeated Ctrl+C possible.
                if isLocked {
                    Circle()
                        .fill(Color(uiColor: .systemBackground))
                        .frame(width: 4, height: 4)
                        .padding(.top, 3)
                }
            }
            .font(.system(size: 12.5, weight: .medium))
            .terminalKeyPill(minWidth: 62, prominent: isLatched, horizontalPadding: 8)
            .frame(width: 62)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.4)
        .accessibilityIdentifier("panelkey-modifier-\(modifier.rawValue)")
    }

    private func digitRow(keyWidth: CGFloat) -> some View {
        HStack(spacing: keyboardSpacing) {
            ForEach(digitKeys, id: \.self) { digit in
                characterKey(digit, isDigit: true, keyWidth: keyWidth)
            }
        }
    }

    private func letterRow(_ row: [Character], keyWidth: CGFloat) -> some View {
        HStack(spacing: keyboardSpacing) {
            ForEach(row, id: \.self) { letter in
                characterKey(letter, isDigit: false, keyWidth: keyWidth)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func characterKey(_ character: Character, isDigit: Bool, keyWidth: CGFloat) -> some View {
        let modifier = effectiveModifier
        let supported = isSupported(character, isDigit: isDigit, modifier: modifier)
        return Button {
            Haptics.select()
            press(character, isDigit: isDigit)
        } label: {
            Text(label(character, isDigit: isDigit, modifier: modifier))
                .font(.system(size: 15))
                .frame(maxWidth: .infinity)
                .terminalKeyPill(minWidth: 0, horizontalPadding: 4)
                // Height comes from the pill, which floors it at `minimumTapTarget`:
                // a key that reads at 42pt still has to be hit by a finger.
                .frame(width: keyWidth)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        // A key this chord cannot reach is dimmed rather than silently inert, so the
        // board always shows what the latched modifier can actually do.
        .opacity(!isEnabled ? 0.4 : (supported ? 1 : 0.3))
        .accessibilityIdentifier(
            "panelkey-\(isDigit ? "digit" : "letter")-\(String(character))"
        )
    }

    private var readout: some View {
        let pending: String
        if let modifier = effectiveModifier {
            pending = "\(modifier.rawValue) + _"
        } else {
            pending = "未锁修饰键 · 按字母就是直接输入"
        }

        let result: String
        var failed = false
        switch lastPress {
        case .send(_, let detail):
            result = detail
        case .unavailable(let reason):
            result = reason
            failed = true
        case nil:
            result = "按一个字母试试"
        }

        return HStack(spacing: 6) {
            Text(pending)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(failed ? Color.orange : Color.primary)
                .lineLimit(1)
                .layoutPriority(1)
            Text("→")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.tertiary)
            // The byte comes first so that a narrow phone truncates the explanation
            // rather than the value — the value is the part that has to be checkable.
            Text(result)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(failed ? Color.orange : Color.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 9)
        .frame(height: 26)
        .background(
            Color(uiColor: .secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .padding(.horizontal, 14)
        .accessibilityIdentifier("panelkey-readout")
    }

    private var hint: some View {
        let text: String
        if let locked = lockedModifier {
            text = "\(locked.rawValue) 已锁定 · 再点一次解开"
        } else if effectiveModifier != nil {
            text = "已锁住 · 按一个字母完成组合，发完自动弹回 · 双击可锁定连按"
        } else {
            text = "点一下修饰键锁住 → 再按字母 · 一次只锁一个"
        }
        return Text(text)
            .font(.system(size: 10.5))
            .foregroundStyle(.secondary)
            .frame(height: 15)
            .padding(.top, 9)
            .padding(.horizontal, 14)
    }

    // MARK: - What a press sends

    private func label(
        _ character: Character,
        isDigit: Bool,
        modifier: KeyboardPanelModifier?
    ) -> String {
        // Shift is shown the way the system keyboard shows it — capital letters and the
        // symbols above the digits — so the board never has to be explained.
        guard modifier == .shift else { return String(character) }
        return String(isDigit ? (keyboardPanelShiftedDigits[character] ?? character)
                              : Character(String(character).uppercased()))
    }

    private func isSupported(
        _ character: Character,
        isDigit: Bool,
        modifier: KeyboardPanelModifier?
    ) -> Bool {
        switch modifier {
        case nil, .shift, .alt:
            return true
        case .control:
            // `I` and `M` are reachable chords even though they are not in the table.
            if !isDigit && (character == "i" || character == "m") { return true }
            return keyboardPanelControlChords[character] != nil
        }
    }

    private func press(_ character: Character, isDigit: Bool) {
        let outcome = resolve(character, isDigit: isDigit)
        lastPress = outcome
        if case .send(let actions, _) = outcome {
            onActions(actions)
        }
        releaseModifier()
    }

    private func resolve(_ character: Character, isDigit: Bool) -> KeyboardPanelPress {
        switch effectiveModifier {
        case nil:
            // No modifier means type it. That is what makes this panel usable for
            // answering a TUI's `y`/`n`, or a permission prompt's `1`/`2`/`3`, without
            // lowering the panel to reach the system keyboard.
            return .send([.text(String(character))], detail: "文本 \(character)")

        case .shift:
            let shifted = label(character, isDigit: isDigit, modifier: .shift)
            return .send([.text(shifted)], detail: "文本 \(shifted)")

        case .alt:
            // Alt is an Escape prefix in a terminal, and a chord is two actions in one
            // intent. Two intents would let the terminal act on the bare Escape first.
            return .send([.key(.escape), .text(String(character))], detail: "ESC + \(character)")

        case .control:
            // `Ctrl+I` is `\x09` and `Ctrl+M` is `\x0d` — the bytes Tab and Return
            // already own. Naming them again would give the computer's byte table two
            // keys per sequence, and the toolbar projection reads that table backwards
            // and would quietly pick one. The chord is still available; it is just sent
            // as the key that owns the byte.
            if !isDigit && character == "i" {
                return .send([.key(.tab)], detail: "0x09 · 与 Tab 同一个字节")
            }
            if !isDigit && character == "m" {
                return .send([.key(.enter)], detail: "0x0d · 与回车同一个字节")
            }
            guard let chord = keyboardPanelControlChords[character] else {
                return .unavailable("Ctrl + \(character) 没有对应的字节")
            }
            return .send([.key(chord.key)], detail: chord.detail)
        }
    }

    // MARK: - Latch

    /// Tapping a modifier latches it; tapping it twice in quick succession locks it,
    /// which is how a chord gets pressed several times in a row. iOS spells the same
    /// two states on its own shift key, so neither has to be taught.
    private func tapModifier(_ modifier: KeyboardPanelModifier) {
        let now = Date()
        let isDoubleTap = lastModifierTap?.modifier == modifier
            && now.timeIntervalSince(lastModifierTap?.at ?? .distantPast) < 0.35
        lastModifierTap = (modifier, now)

        if lockedModifier == modifier {
            clearModifier()
            return
        }
        if latchedModifier == modifier && isDoubleTap {
            lockedModifier = modifier
            return
        }
        // Replacing rather than stacking: a second modifier takes the first one's place.
        latchedModifier = latchedModifier == modifier ? nil : modifier
        lockedModifier = nil
    }

    /// A latched modifier lets go once a key has used it; a locked one does not.
    private func releaseModifier() {
        guard lockedModifier == nil else { return }
        latchedModifier = nil
    }

    private func clearModifier() {
        latchedModifier = nil
        lockedModifier = nil
        lastModifierTap = nil
    }
}

enum KeyboardPanelMetrics {
    /// How much of the screen the panel occupies, the same on every page.
    ///
    /// Sized for the tallest page — the full keyboard's four rows of modifiers, digits
    /// and letters, with its readout above them and its hint below — and no taller, so
    /// that the terminal stays visible above the keys being pressed to drive it.
    ///
    /// One height rather than one per page. The three shorter pages leave the rest of
    /// the panel empty, and that waste is the price of a page change that moves nothing
    /// under the reader's finger: a panel that grew and shrank pushed the toolbar, the
    /// input bar and the terminal up and down again with every category.
    static let height: CGFloat = 370
}
