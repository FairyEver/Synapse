import SwiftUI
import UIKit

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

    /// How much of `ink` a filled button keeps when it cannot be pressed.
    ///
    /// The label stays `paper` in both states — fading it too would leave grey text on a
    /// grey rectangle — so the fill is the only thing carrying the cue, and it has to
    /// stay dark enough for `paper` to read on top of it. At 0.4 the fill measured 2.85:1
    /// against `paper` in light appearance, under the 3:1 floor even for large text; this
    /// measures 4.8:1 there and 6.3:1 in dark.
    static let disabledInkOpacity: Double = 0.55

    /// The one colour that means a person is needed.
    ///
    /// Adaptive, because a single fixed value cannot be legible in both appearances:
    /// the amber that reads on white is too dark to read on black, and the one that
    /// reads on black is invisible on white. Both ends are held to WCAG AA's 4.5:1
    /// for body text — the single value this replaced measured 3.4:1 on white, which
    /// is what iOS's own `systemRed` and `systemOrange` do too, and it is used here
    /// at 11–12 pt, where that is not good enough.
    static let attention = dynamic(
        light: (red: 0.60, green: 0.36, blue: 0.00),
        dark: (red: 0.95, green: 0.65, blue: 0.25)
    )

    /// A wash of `attention` for a badge that carries text on top of it.
    ///
    /// Opaque and adaptive rather than `attention.opacity(0.12)`: a 12% wash over
    /// white is nearly white, and the amber on top of it measured 2.5:1 — the text
    /// was drawn on a background that was effectively its own colour.
    static let attentionFill = dynamic(
        light: (red: 0.99, green: 0.96, blue: 0.90),
        dark: (red: 0.28, green: 0.21, blue: 0.10)
    )

    static let running = Color(red: 0.11, green: 0.54, blue: 0.31)

    /// Same reasoning as `attention`: 5.3:1 on white, but only 3.2:1 on a dark list
    /// cell, so dark appearance gets a red of its own.
    static let failure = dynamic(
        light: (red: 0.78, green: 0.21, blue: 0.18),
        dark: (red: 1.00, green: 0.45, blue: 0.40)
    )

    static let terminalBackground = Color(red: 0.063, green: 0.063, blue: 0.071)

    /// 浮在终端画布之上那张图的边。
    ///
    /// 固定值，理由和 `terminalBackground` 是同一条：它压在画布上，而画布在两种外观
    /// 下都是那块近黑，所以这圈边不能跟着外观走。`separator` 正是这么栽的 —— 深色下
    /// 它是 29% 的白，压在画布边缘上实测看不清，用户的原话是「在黑色背景下就看不出来
    /// 边框了」。这里要的是在近黑上真正立得住的一圈：对画布约 6.9:1。
    static let canvasRing = Color(white: 0.55)

    /// One colour, two appearances.
    ///
    /// `UIColor`'s own dynamic provider rather than SwiftUI's `Color(light:dark:)`,
    /// which is not available before iOS 18's `Color.Resolved` — and the deployment
    /// target is 18.0, but this also keeps the resolution in the same place the rest
    /// of the system colours are resolved, so mixing this with `Color(.systemBackground)`
    /// cannot end up in two different appearance contexts.
    private static func dynamic(
        light: (red: Double, green: Double, blue: Double),
        dark: (red: Double, green: Double, blue: Double)
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: value.red, green: value.green, blue: value.blue, alpha: 1)
        })
    }


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
