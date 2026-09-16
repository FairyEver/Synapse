import UIKit

/// The terminal grid's font.
///
/// Shell prompts draw their branch, folder and language markers from the Unicode
/// private use area. The desktop renders those because a Nerd Font is installed on
/// the Mac; iOS has no such font, so without one every marker would come out as a
/// replacement box. The app therefore bundles Maple Mono NF CN — the same family
/// the desktop falls back to for those glyphs — so the two render alike.
///
/// Lookups are allowed to fail. A font that cannot be loaded degrades to the
/// system monospace face, and the terminal still renders; it only loses the
/// private-use glyphs.
enum TerminalFont {
    /// PostScript names, which is what `UIFont(name:size:)` resolves against.
    private static let regularName = "MapleMono-NF-CN-Regular"
    private static let boldName = "MapleMono-NF-CN-Bold"

    /// Whether the bundled family resolved at all. False means private-use
    /// characters will draw as replacement boxes, which is worth knowing when
    /// diagnosing a rendering report.
    static let isBundledFamilyAvailable: Bool = UIFont(name: regularName, size: 12) != nil

    static func regular(ofSize size: CGFloat) -> UIFont {
        UIFont(name: regularName, size: size)
            ?? UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
    }

    /// The bundled bold face, or nil when it is unavailable — callers fall back
    /// to whatever the regular face can synthesise.
    static func bold(ofSize size: CGFloat) -> UIFont? {
        UIFont(name: boldName, size: size)
    }
}
