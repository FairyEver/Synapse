import Testing
import UIKit

@testable import SynapseMobile

/// The cursor is drawn into the row's own text rather than as an overlay, so the
/// block is exactly one cell wide and the grid never shifts under it. These tests
/// pin that down; blinking and Reduce Motion are timing behaviour and are not
/// covered here.
struct TerminalCursorRenderingTests {
    private func row(_ text: String) -> DisplayRow {
        DisplayRow(id: "row", text: text, runs: [], lineIndex: 0, isContinuation: false)
    }

    @Test func fillsTheCellUnderTheCursor() {
        let plain = TerminalRowCell.attributed(row: row("abc"), fontSize: 14, cursorColumn: nil)
        let withCursor = TerminalRowCell.attributed(row: row("abc"), fontSize: 14, cursorColumn: 1)

        let plainForeground = plain.attribute(.foregroundColor, at: 1, effectiveRange: nil) as? UIColor
        let cursorForeground = withCursor.attribute(.foregroundColor, at: 1, effectiveRange: nil) as? UIColor

        #expect(withCursor.attribute(.backgroundColor, at: 1, effectiveRange: nil) != nil)
        // The character swaps with the block, which is what makes it readable.
        #expect(cursorForeground != plainForeground)
    }

    @Test func fillsOnlyTheCursorCell() {
        let withCursor = TerminalRowCell.attributed(row: row("abc"), fontSize: 14, cursorColumn: 1)

        #expect(withCursor.attribute(.backgroundColor, at: 0, effectiveRange: nil) == nil)
        #expect(withCursor.attribute(.backgroundColor, at: 2, effectiveRange: nil) == nil)
    }

    @Test func leavesTheRowUnfilledWithoutACursor() {
        let plain = TerminalRowCell.attributed(row: row("abc"), fontSize: 14, cursorColumn: nil)

        #expect(plain.attribute(.backgroundColor, at: 1, effectiveRange: nil) == nil)
    }

    /// Past the end of the text there is no character to invert, so the block is a
    /// filled space appended to the row.
    @Test func drawsABlockPastTheEndOfTheText() {
        let attributed = TerminalRowCell.attributed(row: row("ab"), fontSize: 14, cursorColumn: 2)

        #expect(attributed.string == "ab ")
        #expect(attributed.attribute(.backgroundColor, at: 2, effectiveRange: nil) != nil)
    }

    /// An empty row still shows the cursor, which is where it sits on a fresh prompt.
    @Test func drawsOnAnEmptyRow() {
        let attributed = TerminalRowCell.attributed(row: row(""), fontSize: 14, cursorColumn: 0)

        #expect(attributed.string == " ")
        #expect(attributed.attribute(.backgroundColor, at: 0, effectiveRange: nil) != nil)
    }
}
