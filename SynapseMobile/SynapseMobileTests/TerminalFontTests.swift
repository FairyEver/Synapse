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

    /// Common Han characters, not just the private-use markers.
    ///
    /// They are easy to lose without noticing: with no bundled Han the terminal
    /// still draws Chinese, because the platform font supplies it. The failure is
    /// silent and metric-shaped, which is what the next test pins down.
    @Test(arguments: [0x4E2D, 0x6587, 0x7EC8, 0x7AEF] as [UInt16])  // 中文终端
    func coversCommonHan(_ scalar: UInt16) {
        let font = TerminalFont.regular(ofSize: 14) as CTFont
        var characters: [UniChar] = [scalar]
        var glyphs: [CGGlyph] = [0]

        let found = CTFontGetGlyphsForCharacters(font, &characters, &glyphs, 1)

        #expect(found, "no glyph for U+\(String(scalar, radix: 16, uppercase: true))")
        #expect(glyphs[0] != 0, "U+\(String(scalar, radix: 16, uppercase: true)) mapped to the missing-glyph slot")
    }

    /// The grid allots a Han character exactly two cells, so its advance must be
    /// twice an ASCII cell's — no more, no less.
    ///
    /// The platform fallback advances ideographs by 1.0 em where two cells need
    /// 1.2 em, so relying on it drifts every Han character a fifth of a cell left
    /// of its column. One character is invisible; a line of them accumulates until
    /// the box-drawing frames TUIs draw no longer meet. That is why Han is bundled
    /// rather than left to the platform font, and this is the test that says so.
    @Test func hanAdvancesByExactlyTwoCells() {
        let size: CGFloat = 100
        let font = TerminalFont.regular(ofSize: size) as CTFont
        let cell = advance(of: 0x0030, in: font)  // "0"
        let han = advance(of: 0x4E2D, in: font)  // "中"

        #expect(abs(cell / size - TerminalFont.asciiAdvanceRatio) < 0.001)
        #expect(abs(han - cell * 2) < 0.001, "汉字步进 \(han) 应为两格 \(cell * 2)")
    }

    private func advance(of scalar: UInt16, in font: CTFont) -> CGFloat {
        var characters: [UniChar] = [scalar]
        var glyphs: [CGGlyph] = [0]
        guard CTFontGetGlyphsForCharacters(font, &characters, &glyphs, 1) else { return 0 }

        var advances: [CGSize] = [.zero]
        CTFontGetAdvancesForGlyphs(font, .horizontal, &glyphs, &advances, 1)
        return advances[0].width
    }
}
