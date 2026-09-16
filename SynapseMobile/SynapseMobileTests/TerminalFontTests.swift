import CoreText
import Testing
import UIKit

@testable import SynapseMobile

/// The terminal draws shell prompts with the bundled family, because iOS ships no
/// font covering the private use area those prompts draw their markers from.
///
/// These tests run inside the app process, so they see the app's own bundle and
/// `Info.plist`, which is what `UIAppFonts` registration depends on. A failure here
/// means the terminal still renders, but every one of those markers is a box.
///
/// They prove registration and glyph coverage. They do **not** prove the glyphs are
/// rasterised — only a real device can show that.
struct TerminalFontTests {
    @Test func registersTheBundledFace() {
        #expect(UIFont(name: "MapleMono-NF-CN-Regular", size: 12) != nil)
        #expect(UIFont(name: "MapleMono-NF-CN-Bold", size: 12) != nil)
    }

    /// The grid font resolves to the bundled family rather than the fallback; if the
    /// two were equal the bundle would be pointless.
    @Test func gridFontIsNotTheSystemFallback() {
        let grid = TerminalFont.regular(ofSize: 14)
        let system = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        #expect(grid.fontName != system.fontName)
    }

    /// The three shapes a prompt actually needs: the Powerline separator, the branch
    /// marker, and a Nerd Font icon from the language set.
    @Test(arguments: [0xE0B0, 0xE0A0, 0xE702] as [UInt16])
    func coversPrivateUseGlyphs(_ scalar: UInt16) {
        let font = TerminalFont.regular(ofSize: 14) as CTFont
        var characters: [UniChar] = [scalar]
        var glyphs: [CGGlyph] = [0]

        let found = CTFontGetGlyphsForCharacters(font, &characters, &glyphs, 1)

        #expect(found, "no glyph for U+\(String(scalar, radix: 16, uppercase: true))")
        #expect(glyphs[0] != 0, "U+\(String(scalar, radix: 16, uppercase: true)) mapped to the missing-glyph slot")
    }
}
