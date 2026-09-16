import SwiftUI

/// Colours carried over from the desktop's design system.
///
/// One accent, and it means exactly one thing: a person is needed. Everything
/// else is neutral, so the single amber badge on a session row is the only thing
/// competing for attention.
enum Theme {
    /// The colour of every control that is not asking for a person: tab bar
    /// selection, toolbar buttons, prominent buttons, the send arrow.
    ///
    /// It has to follow the system appearance. The desktop's ink is a fixed
    /// near-black, which is correct on paper but invisible here — this app runs
    /// on a black terminal surface, where a fixed near-black paints controls the
    /// same colour as the background behind them.
    static let ink = Color.primary

    /// The colour that reads on top of `ink` — the label of a filled button.
    static let paper = Color(uiColor: .systemBackground)

    static let attention = Color(red: 0.78, green: 0.47, blue: 0.0)
    static let running = Color(red: 0.11, green: 0.54, blue: 0.31)
    static let failure = Color(red: 0.78, green: 0.21, blue: 0.18)
    static let terminalBackground = Color(red: 0.063, green: 0.063, blue: 0.071)

    static func statusColor(isWaiting: Bool, isRunning: Bool) -> Color {
        if isWaiting { return attention }
        return isRunning ? running : Color.secondary
    }
}

/// The 256-colour xterm palette.
///
/// Generated rather than tabulated: the first 16 are chosen to match the
/// desktop's terminal theme, and the rest follow the standard xterm layout, so a
/// program asking for colour 208 on the Mac gets the same orange here.
enum TerminalPalette {
    static let base: [UInt32] = [
        0x1A1A1C, 0xE5534B, 0x3FB950, 0xD29922,
        0x58A6FF, 0xBC8CFF, 0x39C5CF, 0xD0D0D4,
        0x6E7681, 0xFF7B72, 0x56D364, 0xE3B341,
        0x79C0FF, 0xD2A8FF, 0x56D4DD, 0xFFFFFF,
    ]

    static let defaultForeground = Color(red: 0.902, green: 0.902, blue: 0.914)
    static let defaultBackground = Theme.terminalBackground

    /// `-1` for the terminal default, `0..255` for a palette index, and
    /// `0x1000000 | rgb` for a truecolor value.
    static func color(for code: Int, isForeground: Bool) -> Color {
        if code == StyleRun.defaultColor {
            return isForeground ? defaultForeground : defaultBackground
        }
        if code >= StyleRun.truecolorBase {
            let rgb = code - StyleRun.truecolorBase
            return Color(
                red: Double((rgb >> 16) & 0xFF) / 255,
                green: Double((rgb >> 8) & 0xFF) / 255,
                blue: Double(rgb & 0xFF) / 255
            )
        }
        return color(index: code & 0xFF)
    }

    static func color(index: Int) -> Color {
        if index < base.count { return color(hex: base[index]) }
        if index < 232 {
            let cube = index - 16
            let steps: [Double] = [0, 95, 135, 175, 215, 255]
            return Color(
                red: steps[(cube / 36) % 6] / 255,
                green: steps[(cube / 6) % 6] / 255,
                blue: steps[cube % 6] / 255
            )
        }
        let level = Double(8 + (index - 232) * 10) / 255
        return Color(red: level, green: level, blue: level)
    }

    private static func color(hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Flat by default, matching the desktop: structure comes from a one-pixel ring,
/// not from stacked shadows.
struct SurfaceCard: ViewModifier {
    var radius: CGFloat = 12

    func body(content: Content) -> some View {
        content
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

extension View {
    func surfaceCard(radius: CGFloat = 12) -> some View {
        modifier(SurfaceCard(radius: radius))
    }
}
