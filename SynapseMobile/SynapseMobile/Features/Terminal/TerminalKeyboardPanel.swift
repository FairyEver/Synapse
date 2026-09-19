import SwiftUI

/// A whole computer keyboard, two pages of it, sitting where the system keyboard sits.
///
/// This panel is not a set of shortcuts. It is a keyboard, drawn the way the board it
/// stands in for is drawn: the digits over the letters, Space and Enter under the thumb,
/// `esc` in the corner your finger already knows, and the function keys where a keyboard
/// puts them. The layout is the interface — a key is found by where it is, not by reading
/// it — so nothing here is a list of buttons that happens to be sorted.
///
/// Two tabs, and only two: **电脑键盘** is the board below, and **手机键盘** is the system
/// keyboard the phone already has. The second one is not a mode — iOS will not let our own
/// view sit on top of the system keyboard — so choosing it lowers this panel and raises
/// that one, which is what a keyboard switch does everywhere else on the system.
///
/// Four modifiers, and one of them does nothing. `⌘` is drawn because a computer keyboard
/// has it there, but macOS's own terminal consumes it (⌘C copies, ⌘V pastes, ⌘K clears)
/// and no byte of it reaches the PTY. It is dimmed like the other keys that have no byte
/// — `PrtScr`, `ScrLK`, `Pause` — so the panel is a keyboard rather than a claim about
/// what a terminal can do. 设计文档 §3.4.
///
/// A modifier is latched by tapping it and the next key completes the chord, which is the
/// only vocabulary a touch screen has for "hold Ctrl and press C": a `Button` reports a
/// tap on the way up and has no state to read while a finger is still down.
///
/// Read-only, deliberately. These are keys, not commands: there is nothing to add, rename
/// or delete, and no menu on a long press.

// MARK: - Tabs

/// The two halves of the switch: our board, or the phone's own keyboard.
private enum KeyboardPanelTab: String, CaseIterable, Identifiable {
    case computer
    case phone

    var id: String { rawValue }

    var title: String {
        switch self {
        case .computer: return "电脑键盘"
        case .phone: return "手机键盘"
        }
    }
}

// MARK: - Modifiers

/// The modifiers the panel can hold down, plus the one a computer keyboard has and a
/// terminal cannot be told about.
private enum KeyboardPanelModifier: String, CaseIterable, Identifiable {
    case control = "Ctrl"
    case shift = "Shift"
    case alt = "Alt"
    /// Drawn, never latched. See the file comment.
    case command = "⌘"

    var id: String { rawValue }

    /// A key that is on the board because the board is a picture of a computer keyboard,
    /// not because pressing it would do anything. Every one of these is dimmed and
    /// answers with the refusal haptic; none of them is silently inert.
    var isDead: Bool { self == .command }
}

// MARK: - What a letter sends while Ctrl is latched

/// The chord each letter makes with Ctrl.
///
/// Written out rather than derived from the alphabet, because the letters are not
/// interchangeable: `Ctrl+C` is the one this panel exists for and `Ctrl+D` ends the
/// session. `I` and `M` are absent on purpose — see `resolve`.
private let keyboardPanelControlChords: [Character: MobileKey] = [
    "a": .controlA, "b": .controlB, "c": .controlC, "d": .controlD, "e": .controlE,
    "f": .controlF, "g": .controlG, "h": .controlH, "j": .controlJ, "k": .controlK,
    "l": .controlL, "n": .controlN, "o": .controlO, "p": .controlP, "q": .controlQ,
    "r": .controlR, "s": .controlS, "t": .controlT, "u": .controlU, "v": .controlV,
    "w": .controlW, "x": .controlX, "y": .controlY, "z": .controlZ,
]

// MARK: - Layout model

/// One key on the board.
///
/// The board is written out as data rather than derived from `MOBILE_KEYS`, because where
/// a key sits is the whole design: `↑` above `↓` with `←` and `→` beside it is the arrow
/// cluster, and `PrtScr` belongs beside `Pause` whether or not it can be sent.
private struct KeyboardPanelKey: Identifiable {
    enum Kind {
        /// Prints a character. `plain` is what it sends at rest, `shifted` under Shift —
        /// the two legends a real keycap carries, and the same pair the system keyboard
        /// shows on its number row.
        case text(plain: String, shifted: String)
        /// A key whose byte lives in the computer's `KEY_BYTES`.
        case key(MobileKey)
        /// Caps Lock: a client-side latch that capitalises letters and nothing else.
        /// A terminal has no caps state and no byte for the key, but the effect a person
        /// wants — capital letters — is plain text, so this needs no protocol at all.
        case caps
        /// A key a computer keyboard has and a terminal has no byte for.
        case dead
        /// A hole the size of a key, so a row lines up with the one above it.
        case hole
    }

    /// Also the accessibility identifier's tail, so it has to be stable: the UI tests
    /// address keys by it.
    let id: String
    let kind: Kind
    /// Drawn instead of the legends when it is set — `Space`, `Esc`, `PgUp`. Written the
    /// way a phone keyboard writes it rather than the way the protocol does.
    var title: String = ""
    /// How much of the row this key takes. 1 is a letter key, 1.5 is `Space` or `Enter`,
    /// which are wide keys on a real board.
    var weight: CGFloat = 1
}

private func panelText(
    _ id: String,
    _ plain: String,
    _ shifted: String? = nil,
    title: String = "",
    weight: CGFloat = 1
) -> KeyboardPanelKey {
    KeyboardPanelKey(
        id: id,
        kind: .text(plain: plain, shifted: shifted ?? plain),
        title: title,
        weight: weight
    )
}

private func panelKey(_ key: MobileKey, _ title: String, weight: CGFloat = 1) -> KeyboardPanelKey {
    KeyboardPanelKey(id: "key-\(key.rawValue)", kind: .key(key), title: title, weight: weight)
}

private func panelCaps() -> KeyboardPanelKey {
    KeyboardPanelKey(id: "caps", kind: .caps, title: "Caps")
}

private func panelDead(_ name: String) -> KeyboardPanelKey {
    KeyboardPanelKey(id: "dead-\(name)", kind: .dead, title: name)
}

private let keyboardPanelHole = KeyboardPanelKey(id: "hole", kind: .hole)

/// The three letter rows of a QWERTY board.
///
/// Drawn upper case, the way the board is: a real keycap has `Q` on it and prints `q`,
/// and a phone keyboard does the same. Which one goes down the wire is `resolve`'s job —
/// the cap does not repaint, so there is only ever one legend to read.
private func panelLetterRow(_ letters: String) -> [KeyboardPanelKey] {
    letters.map { letter in
        panelText(
            "letter-\(letter)",
            String(letter),
            String(letter).uppercased(),
            title: String(letter).uppercased()
        )
    }
}

/// Page one of 电脑键盘: the digits over the letters, Space and Enter under the thumb.
private let keyboardPanelComputerRows: [[KeyboardPanelKey]] = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map { digit in
        panelText(
            "digit-\(digit)",
            digit,
            ["!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
             "^": "6", "&": "7", "*": "8", "(": "9", ")": "0"]
                .first { $0.value == digit }?.key
        )
    },
    panelLetterRow("qwertyuiop"),
    panelLetterRow("asdfghjkl") + [panelKey(.backspace, "⌫")],
    panelLetterRow("zxcvbnm") + [
        panelText("space", " ", " ", title: "Space", weight: 1.5),
        panelKey(.enter, "Enter", weight: 1.5),
    ],
]

/// Page two: the symbol row, and under it the twelve function keys beside the block a
/// computer keyboard puts to their right.
///
/// `PrtScr`, `ScrLK` and `Pause` are on the board and cannot be sent. They are kept
/// because this page is a picture of the block they belong to, and a keyboard with a
/// hole where three keys should be is harder to read than one that dims them.
private let keyboardPanelFunctionRows: [[KeyboardPanelKey]] = [
    [
        panelText("symbol-equals", "="),
        panelText("symbol-plusminus", "±"),
        panelText("symbol-bracket-left", "[", "{"),
        panelText("symbol-bracket-right", "]", "}"),
        panelText("symbol-backslash", "\\", "|"),
        panelText("symbol-semicolon", ";", ":"),
        panelText("symbol-quote", "'", "\""),
        panelText("symbol-comma", ",", "<"),
        panelText("symbol-period", ".", ">"),
        panelText("symbol-slash", "/", "?"),
    ],
    [
        panelKey(.escape, "Esc"), panelKey(.tab, "Tab"),
        panelText("symbol-grave", "`", "~"),
        panelDead("PrtScr"), panelDead("ScrLK"), panelDead("Pause"),
    ],
    [
        panelKey(.f1, "F1"), panelKey(.f2, "F2"), panelKey(.f3, "F3"),
        panelKey(.insert, "Ins"), panelKey(.home, "Home"), panelKey(.pageUp, "PgUp"),
    ],
    [
        panelKey(.f4, "F4"), panelKey(.f5, "F5"), panelKey(.f6, "F6"),
        panelKey(.delete, "Del"), panelKey(.end, "End"), panelKey(.pageDown, "PgDn"),
    ],
    [
        panelKey(.f7, "F7"), panelKey(.f8, "F8"), panelKey(.f9, "F9"),
        panelCaps(), panelKey(.arrowUp, "↑"), keyboardPanelHole,
    ],
    [
        panelKey(.f10, "F10"), panelKey(.f11, "F11"), panelKey(.f12, "F12"),
        panelKey(.arrowLeft, "←"), panelKey(.arrowDown, "↓"), panelKey(.arrowRight, "→"),
    ],
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
    /// Drawn as a bare glyph, with no pill behind it.
    ///
    /// For the toolbar's two fixed keys, which are not commands. The commands sit in pills
    /// because they are one list of interchangeable actions; the two keys that never
    /// scroll are not part of that list, and taking the fill away is what says so — a bare
    /// glyph beside a row of capsules. The tap target and the pill's widths stay, so the
    /// glyph is still as easy to hit as any command.
    ///
    /// With no fill to change, `pressed` shows as the glyph going from secondary to full
    /// strength — the quietest state change that still reads as "this one is down".
    var bare: Bool = false
    /// The room between the label and the pill's edge. Ten keys have to share one row
    /// on the full keyboard, so its keys are about a third the width of these and
    /// cannot afford the padding a two-key row can.
    var horizontalPadding: CGFloat = 12
    /// The pill's height when it is drawn to a size rather than to its label.
    ///
    /// The board's keys are rectangles whose size comes from the screen width, so their
    /// pill has to be told how tall it is instead of measuring itself — a `Text` has no
    /// opinion about being a key.
    var size: CGFloat? = nil
    /// How tall the tappable box is. Nil means `Metrics.minimumTapTarget`.
    ///
    /// The board gives every key one row's worth of height instead (`rowPitch`), so the
    /// box reaches into the six point seam on either side of the key and a finger that
    /// lands in the seam still hits something. The board's rows carry **no spacing of
    /// their own** for the same reason — see `TerminalKeyboardPanel.boardPage`.
    var tapHeight: CGFloat? = nil

    /// The pill's own fill, in the order of how loud the state is.
    ///
    /// These are the three system fills iOS is made of, and the reason to name them
    /// rather than pick colours: `secondarySystemBackground` is the resting pill and
    /// `systemFill` is what iOS draws under a press, so the held state needs no
    /// definition of its own to look like one.
    private var fill: Color {
        if bare { return .clear }
        if prominent { return Color.primary }
        if pressed { return Color(uiColor: .systemFill) }
        return Color(uiColor: .secondarySystemBackground)
    }

    /// What the label is drawn in.
    ///
    /// `prominent` inverts it against its own fill; a bare key has no fill, so its two
    /// states are told apart by weight of colour instead.
    private var labelColor: Color {
        if prominent { return Color(uiColor: .systemBackground) }
        if bare { return pressed ? Color.primary : Color.secondary }
        return Color.primary
    }

    func body(content: Content) -> some View {
        content
            .font(.system(.subheadline, design: .monospaced, weight: .medium))
            .foregroundStyle(labelColor)
            .padding(.horizontal, horizontalPadding)
            // A sized pill takes its height from `size` instead: the label is centred in
            // it, and padding it as well would make the two disagree.
            .padding(.vertical, size == nil ? 9 : 0)
            .frame(minWidth: minWidth, minHeight: size ?? 36)
            .frame(height: size)
            .background(
                fill,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            // The pill is the control; this is the room around it. Applied after the
            // background so the pill keeps its own size and only the tappable box grows.
            .frame(minHeight: tapHeight ?? Metrics.minimumTapTarget)
            .contentShape(Rectangle())
    }
}

extension View {
    func terminalKeyPill(
        minWidth: CGFloat = 48,
        prominent: Bool = false,
        pressed: Bool = false,
        bare: Bool = false,
        horizontalPadding: CGFloat = 12,
        size: CGFloat? = nil,
        tapHeight: CGFloat? = nil
    ) -> some View {
        modifier(TerminalKeyPill(
            minWidth: minWidth,
            prominent: prominent,
            pressed: pressed,
            bare: bare,
            horizontalPadding: horizontalPadding,
            size: size,
            tapHeight: tapHeight
        ))
    }
}

// MARK: - Panel

/// The panel itself: the two-tab switch, the modifier row, and whichever board page is
/// showing.
struct TerminalKeyboardPanel: View {
    /// Nil while the terminal is not running, which greys out every key.
    let isEnabled: Bool
    /// How much room the screen can give the panel. The panel takes what the page it is
    /// showing needs, up to this — portrait hands it the whole screen, landscape hands it
    /// something shorter and the board scrolls inside
    /// (see `KeyboardPanelMetrics.height(rows:fitting:)`).
    let maxHeight: CGFloat
    let onActions: ([MobileKeyAction]) -> Void
    /// 手机键盘: the caller lowers this panel and raises the system keyboard. The panel
    /// cannot do it itself — it does not own either keyboard, and iOS will not draw our
    /// view above the system one.
    let onRequestSystemKeyboard: () -> Void

    @State private var tab: KeyboardPanelTab = .computer
    @State private var page: Int = 0
    /// Whether the modifier row is live. Off, the row goes away and the board is a plain
    /// character keyboard — which is what "组合键模式" means literally.
    @State private var combinationMode = true

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
    /// Caps Lock. Client-side only: it capitalises letters and changes nothing else.
    @State private var capsLocked = false

    private var effectiveModifier: KeyboardPanelModifier? {
        combinationMode ? (lockedModifier ?? latchedModifier) : nil
    }

    private var rows: [[KeyboardPanelKey]] {
        page == 0 ? keyboardPanelComputerRows : keyboardPanelFunctionRows
    }

    /// How tall the panel is *right now*: what this page needs, capped by the room the
    /// screen has.
    ///
    /// Per page rather than one number for both, which is the 2026-09-19 decision — the
    /// page showing decides how much of the terminal it takes. 电脑键盘's two pages are
    /// four rows and six, so a single height has to be the taller page's, and the shorter
    /// one then sits on two rows' worth of empty panel. In a short screen both pages cap
    /// at the same share of the room and a page change moves nothing.
    private var panelHeight: CGFloat {
        KeyboardPanelMetrics.height(rows: rows.count, fitting: maxHeight)
    }

    var body: some View {
        // 面板在横屏里放不下整块键盘（可用高度只有竖屏的一半，而键盘本身没变矮），
        // 所以内容进一个滚动容器：**装得下的时候它不滚，装不下的时候它滚**。
        // `.basedOnSize` 是这里的关键 —— 竖屏内容正好等于面板高度，没有它就会多出
        // 一段橡皮筋，而面板从来没有滚过。
        ScrollView(.vertical) {
            content
                .frame(minHeight: panelHeight, alignment: .top)
        }
        .scrollBounceBehavior(.basedOnSize)
        // It sits in the layout at the height it is given rather than sizing itself the
        // way a sheet did. It is a keyboard now: what is above it is the terminal being
        // watched, and what is below it is the bottom of the screen.
        .frame(height: panelHeight)
        // Its own surface, the same one the two bars above it wear — the panel, the
        // toolbar and the input bar are the light half of this screen together, and
        // the dark canvas is what they are all sitting on.
        .background(Color(uiColor: .systemBackground))
    }

    private var content: some View {
        VStack(spacing: 0) {
            Picker("键盘", selection: $tab) {
                ForEach(KeyboardPanelTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
            .onChange(of: tab) { _, newValue in
                // 手机键盘 isn't a page of this panel — it is this panel leaving. The
                // picker reports the tap before the caller lowers us, so there is
                // nothing to undo when the panel comes back: it is built from scratch.
                guard newValue == .phone else { return }
                clearModifier()
                onRequestSystemKeyboard()
            }

            modifierRow
                .padding(.horizontal, 14)
                .padding(.bottom, 8)

            board
                .padding(.horizontal, 14)

            // The shorter page keeps its keys at the top and leaves the rest of the panel
            // empty — the visible cost of one height for both pages, and what a page
            // change costs to move nothing above the panel.
            Spacer(minLength: 0)

            pageDots
                .padding(.top, 8)
        }
        .padding(.top, 8)
        .padding(.bottom, 14)
        .onChange(of: page) { _, _ in
            // Changing page is changing what the keys mean, so a latched modifier is
            // dropped rather than carried into a board it does not belong to.
            clearModifier()
        }
    }

    // MARK: - Modifier row

    /// The switch, its label, and the four modifiers it governs.
    ///
    /// The four share whatever room the label leaves, which puts Control under the left
    /// thumb and ⌘ under the right, the way the board they stand in for does.
    private var modifierRow: some View {
        HStack(spacing: 8) {
            HStack(spacing: 7) {
                Toggle("组合键模式", isOn: $combinationMode)
                    .labelsHidden()
                    // 应用根的 tint 是 `Theme.ink`，深色下是白色，和开关的圆点撞成一块
                    // 没有圆点的白方块。见 `Theme.switchOn`。
                    .tint(Theme.switchOn)
                    .onChange(of: combinationMode) { _, isOn in
                        // Turning the row off while a modifier is held would leave the
                        // state on with nothing on screen showing it.
                        if !isOn { clearModifier() }
                    }
                Text("组合键模式")
                    .font(.system(size: 12.5))
                    .lineLimit(1)
            }
            .fixedSize(horizontal: true, vertical: false)

            if combinationMode {
                HStack(spacing: 6) {
                    ForEach(KeyboardPanelModifier.allCases) { modifier in
                        modifierKey(modifier)
                    }
                }
            }
        }
        .frame(height: KeyboardPanelMetrics.modifierRowHeight)
    }

    private func modifierKey(_ modifier: KeyboardPanelModifier) -> some View {
        let isLatched = effectiveModifier == modifier
        let isLocked = lockedModifier == modifier
        return Button {
            guard !modifier.isDead else {
                Haptics.warning()
                return
            }
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
                        .padding(.top, 4)
                }
            }
            .font(.system(size: 14, weight: .medium))
            .terminalKeyPill(
                minWidth: 0,
                prominent: isLatched,
                horizontalPadding: 6,
                size: KeyboardPanelMetrics.modifierRowHeight,
                tapHeight: KeyboardPanelMetrics.modifierRowHeight
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? (modifier.isDead ? 0.35 : 1) : 0.4)
        .accessibilityIdentifier("panelkey-modifier-\(modifier.rawValue)")
    }

    // MARK: - Board

    /// The two pages, side by side and swipeable.
    ///
    /// A `TabView` rather than a hand-rolled offset: the swipe, the rubber band at the
    /// ends and the way a page settles are all things iOS already defines, and the dots
    /// below are drawn here only because the system's own are a different size and sit
    /// inside the pages rather than under them.
    ///
    /// Each page is built from **its own** rows, named here rather than read off `rows`:
    /// a `TabView` builds both of its children on every pass, so a page that asked `rows`
    /// what it was would always be told "the one you have selected" — both halves would
    /// draw the same board, and the swipe would have nothing to slide in.
    ///
    /// The frame is the selected page's height (`panelHeight`), which means the page
    /// being dragged in is clipped to it for the length of the drag and gets its last
    /// two rows back when the swipe settles. The alternative — sizing to the taller page
    /// — puts the empty space back on the shorter one, which is what 「随页走」 undid.
    private var board: some View {
        GeometryReader { proxy in
            TabView(selection: $page) {
                boardPage(keyboardPanelComputerRows, width: proxy.size.width).tag(0)
                boardPage(keyboardPanelFunctionRows, width: proxy.size.width).tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .frame(height: KeyboardPanelMetrics.boardHeight(rows: rows.count))
    }

    private func boardPage(_ pageRows: [[KeyboardPanelKey]], width: CGFloat) -> some View {
        // **没有行距。** 两颗相邻的键之间那道缝，是上面那颗键的点击盒比自己高出来的
        // 那 6pt（`rowPitch`），不是这里再加一次间距。两个都算的话，纵向的缝就是 12pt
        // 而横向还是 6pt —— 板子读起来就不是一个网格，而是几排按钮（2026-09-19 真机
        // 截图，量的就是 12 对 6）。
        VStack(spacing: 0) {
            ForEach(Array(pageRows.enumerated()), id: \.offset) { _, row in
                rowView(row, width: width)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// A row of keys, each drawn as wide as its share of the row.
    ///
    /// Shares rather than a fixed width, because the two pages have different column
    /// counts: ten digits have to fit the same edge to edge distance as six function
    /// keys, and the function keys come out half again as wide without either page
    /// knowing about the other.
    private func rowView(_ row: [KeyboardPanelKey], width: CGFloat) -> some View {
        let gap = KeyboardPanelMetrics.rowGap
        let total = row.reduce(CGFloat.zero) { $0 + $1.weight }
        let unit = max(0, (width - gap * CGFloat(row.count - 1)) / max(total, 1))
        return HStack(spacing: gap) {
            ForEach(row) { key in
                keyView(key, width: unit * key.weight)
            }
        }
    }

    @ViewBuilder
    private func keyView(_ key: KeyboardPanelKey, width: CGFloat) -> some View {
        switch key.kind {
        case .hole:
            // Invisible rather than absent: it holds the column so the row above lines up.
            Color.clear.frame(width: width, height: KeyboardPanelMetrics.keyHeight)
        case .text(let plain, let shifted):
            characterKey(key, plain: plain, shifted: shifted, width: width)
        case .key(let mobileKey):
            let actions = resolveKey(mobileKey)
            sizedKey(key, width: width, dimmed: actions == nil) {
                guard let actions else { return }
                onActions(actions)
                releaseModifier()
            }
        case .caps:
            sizedKey(key, width: width, prominent: capsLocked) { capsLocked.toggle() }
        case .dead:
            sizedKey(key, width: width, dimmed: true) { Haptics.warning() }
        }
    }

    /// 一颗走 `MobileKey` 的键，或者一颗按客户端状态动作的键（Caps、以及没有字节的那几颗）。
    private func sizedKey(
        _ key: KeyboardPanelKey,
        width: CGFloat,
        prominent: Bool = false,
        dimmed: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            // A key the terminal has no byte for is the one press on this board that does
            // nothing at all, so it gets the refusal instead of the tick.
            if !dimmed { Haptics.select() }
            action()
        } label: {
            Text(key.title)
                .font(.system(size: 12.5))
                .frame(maxWidth: .infinity)
                .terminalKeyPill(
                    minWidth: 0,
                    prominent: prominent,
                    horizontalPadding: 2,
                    size: KeyboardPanelMetrics.keyHeight,
                    tapHeight: KeyboardPanelMetrics.rowPitch
                )
                .frame(width: width)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        // A key that cannot be sent is dimmed rather than silently inert, so the board
        // always shows what it can actually do.
        .opacity(!isEnabled ? 0.4 : (dimmed ? 0.35 : 1))
        .accessibilityIdentifier("panelkey-\(key.id)")
    }

    /// A key that prints a character, with the two legends a real keycap carries.
    ///
    /// Both legends are drawn all the time, upper first — the same way the board this
    /// stands in for is printed, and the same way a phone keyboard prints its number row.
    /// Which one goes down the wire is decided at press time, not shown by repainting.
    private func characterKey(
        _ key: KeyboardPanelKey,
        plain: String,
        shifted: String,
        width: CGFloat
    ) -> some View {
        // Caps capitalises letters and nothing else: on a real board it does not reach
        // the number row, and a `(` where `9` was expected would be a nasty surprise.
        let upper = isShifted || (capsLocked && isLetter(plain))
        return Button {
            Haptics.select()
            press(key, plain: plain, shifted: shifted)
        } label: {
            legend(key, plain: plain, shifted: shifted, upper: upper)
                .frame(maxWidth: .infinity)
                .terminalKeyPill(
                    minWidth: 0,
                    horizontalPadding: 2,
                    size: KeyboardPanelMetrics.keyHeight,
                    tapHeight: KeyboardPanelMetrics.rowPitch
                )
                .frame(width: width)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        // With Ctrl down, only a letter that has a chord can be sent. The rest dim, so
        // the board answers "what can Ctrl do here" before anything is pressed.
        .opacity(!isEnabled ? 0.4 : (isReachable(plain) ? 1 : 0.35))
        .accessibilityIdentifier("panelkey-\(key.id)")
    }

    @ViewBuilder
    private func legend(
        _ key: KeyboardPanelKey,
        plain: String,
        shifted: String,
        upper: Bool
    ) -> some View {
        if !key.title.isEmpty {
            Text(key.title).font(.system(size: 12.5))
        } else if plain == shifted {
            Text(plain).font(.system(size: 14))
        } else {
            // Shifted legend first, the way it is printed on the cap. Whichever one is
            // going to be sent is the one drawn at full strength, so the key never sends
            // a character it is not showing.
            HStack(spacing: 3) {
                Text(shifted).foregroundStyle(upper ? Color.primary : Color.secondary)
                Text(plain).foregroundStyle(upper ? Color.secondary : Color.primary)
            }
            .font(.system(size: 13))
        }
    }

    // MARK: - Page dots

    /// Which of the two board pages is showing. Drawn rather than using the system's
    /// because they have to sit under the board, not inside it.
    private var pageDots: some View {
        HStack(spacing: 7) {
            ForEach(0..<2, id: \.self) { index in
                Button {
                    page = index
                } label: {
                    // The dot is drawn at 7pt; the box around it is what a finger aims
                    // at, so it reaches the 44pt floor with the row's own padding.
                    Circle()
                        .fill(index == page ? Theme.ink : Color(uiColor: .tertiaryLabel))
                        .frame(width: 7, height: 7)
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("第 \(index + 1) 页")
                .accessibilityIdentifier("panelkey-page-\(index)")
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 14)
    }

    // MARK: - What a press sends

    private var isShifted: Bool { effectiveModifier == .shift }

    private func isLetter(_ character: String) -> Bool {
        character.count == 1 && character.first.map { $0.isLetter } == true
    }

    /// Whether the key can be sent at all right now. Only Ctrl narrows the board — with
    /// it down, a symbol has no chord and there is no byte for `Ctrl + ;`.
    private func isReachable(_ plain: String) -> Bool {
        guard effectiveModifier == .control else { return true }
        guard let character = plain.first, plain.count == 1 else { return false }
        // `I` and `M` are reachable chords even though they are not in the table.
        if character == "i" || character == "m" { return true }
        return keyboardPanelControlChords[character] != nil
    }

    /// What a key that carries a `MobileKey` sends under the latched modifier.
    ///
    /// The modifier row is on screen for both pages now, so these keys have to answer it
    /// rather than ignore it — and the answer for most of them is "nothing", because the
    /// terminal has no byte for `Ctrl + Enter` and sending the bare `Enter` instead would
    /// submit the prompt the user was in the middle of writing. Refusing is the safe half
    /// of that choice and it is the visible half: the key dims.
    ///
    /// `⇧tab` is the one shifted named key with a byte of its own, and it is the one that
    /// matters — Claude Code cycles its permission mode on it. It gets no key of its own
    /// on this board (a computer keyboard has no such key), so it is spelled the way the
    /// board spells it: Shift, then Tab. 设计文档 §3.6.
    private func resolveKey(_ key: MobileKey) -> [MobileKeyAction]? {
        switch effectiveModifier {
        case nil:
            return [.key(key)]
        case .shift:
            return key == .tab ? [.key(.shiftTab)] : nil
        case .alt:
            // Alt is an Escape prefix, exactly as it is for a character — which is how
            // `Alt + ←` reaches readline's "back one word".
            return [.key(.escape), .key(key)]
        case .control, .command:
            return nil
        }
    }

    private func press(_ key: KeyboardPanelKey, plain: String, shifted: String) {
        if let actions = resolve(plain: plain, shifted: shifted) {
            onActions(actions)
        }
        releaseModifier()
    }

    private func resolve(plain: String, shifted: String) -> [MobileKeyAction]? {
        guard let character = plain.first, plain.count == 1 else { return [.text(plain)] }

        switch effectiveModifier {
        case nil:
            // No modifier means type it. That is what makes this panel usable for
            // answering a TUI's `y`/`n`, or a permission prompt's `1`/`2`/`3`, without
            // lowering the panel to reach the system keyboard.
            return [.text(capsLocked && character.isLetter ? shifted : plain)]

        case .shift:
            return [.text(shifted)]

        case .alt:
            // Alt is an Escape prefix in a terminal, and a chord is two actions in one
            // intent. Two intents would let the terminal act on the bare Escape first.
            return [.key(.escape), .text(plain)]

        case .control:
            // `Ctrl+I` is `\x09` and `Ctrl+M` is `\x0d` — the bytes Tab and Return
            // already own. Naming them again would give the computer's byte table two
            // keys per sequence, and the toolbar projection reads that table backwards
            // and would quietly pick one. The chord is still available; it is just sent
            // as the key that owns the byte.
            if character == "i" { return [.key(.tab)] }
            if character == "m" { return [.key(.enter)] }
            guard let chord = keyboardPanelControlChords[character] else { return nil }
            return [.key(chord)]

        case .command:
            // Only reachable if it were latched, and it never is.
            return nil
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
    /// One row of keys.
    static let keyHeight: CGFloat = 36

    /// Between keys and between rows, the same both ways — that is what makes the board
    /// read as a grid rather than as rows of buttons.
    static let rowGap: CGFloat = 6

    /// How far apart two rows are, and how tall one key's tappable box is.
    ///
    /// One number for both, and the board stacks rows with **no spacing of its own**
    /// (`TerminalKeyboardPanel.boardPage`): the box is taller than the key by exactly one
    /// gap, so the seam between two rows belongs to the box of the one above and a finger
    /// that lands in it still hits a key. Counting the gap a second time as `VStack`
    /// spacing is how the vertical seam came out at 12 points while the horizontal one
    /// stayed 6 — a screenshot of the real thing, 2026-09-19.
    static let rowPitch: CGFloat = keyHeight + rowGap

    /// The two-tab switch above the board.
    static let pickerHeight: CGFloat = 32

    /// Tall enough for a modifier key to read as one of the four across the row, and for
    /// its label to sit in the middle of it.
    static let modifierRowHeight: CGFloat = 42

    /// How tall the board is when the page showing has this many rows.
    ///
    /// 电脑键盘's pages have four rows and six: the digits over the letters and Space and
    /// Enter under the thumb on one, the symbol row and then the function keys beside the
    /// navigation block on the other.
    static func boardHeight(rows: Int) -> CGFloat {
        rowPitch * CGFloat(rows)
    }

    /// How tall the panel is when the page showing has this many rows.
    ///
    ///     padding 8 + picker 32 + 12 + modifier 42 + 8
    ///       + board + dots 8 + 14 + padding 14
    ///
    /// So 306 on the four-row page and 390 on the six-row one.
    ///
    /// **One height per page.** The taller page's height used to be the only one — a page
    /// change that moved nothing under the reader's finger, bought with two rows' worth
    /// of empty panel under the shorter page. The 2026-09-19 look at a real screenshot
    /// priced that空 at 84 points of nothing under the Space bar, on the page people
    /// actually type on, and 产品负责人 took the other side of it: the panel follows the
    /// page. What moves is the terminal's bottom edge, on this phone only — the grid is
    /// not reported to the computer while the panel is up (`TerminalScreen`).
    static func height(rows: Int) -> CGFloat {
        8 + (pickerHeight + 12) + (modifierRowHeight + 8) + boardHeight(rows: rows)
            + (8 + 14) + 14
    }

    /// What the panel actually takes, given how much room the screen has.
    ///
    /// The heights above are **portrait** heights: 390 is a bit under half of a phone held
    /// upright, and the same 390 is more than a phone held sideways has to give, where the
    /// screen is only about 372 points tall with the safe areas taken out. Left alone
    /// there, the panel plus the two bars above it come to about 490 — the toolbar is
    /// pushed off the top of the screen and the terminal gets nothing.
    ///
    /// So in a short screen the panel takes a share of what there is and the board
    /// scrolls inside it (`TerminalKeyboardPanel`). The share is a bit over half because a
    /// keyboard the reader cannot reach the bottom of is closer to useless than one that
    /// leaves the terminal four lines. Both pages cap at that same share, so a page change
    /// on a short screen still moves nothing.
    ///
    /// `available <= 0` is "not measured yet", which happens on the first layout pass
    /// only: it takes the full height rather than a fraction of nothing, so the panel
    /// is never drawn collapsed for a frame.
    static func height(rows: Int, fitting available: CGFloat) -> CGFloat {
        let needed = height(rows: rows)
        guard available > 0 else { return needed }
        return min(needed, available * 0.55)
    }
}
