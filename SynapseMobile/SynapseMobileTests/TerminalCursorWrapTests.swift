import Foundation
import Testing

@testable import SynapseMobile

/// The desktop reports the cursor in *its* grid; the phone draws it on the wrap the
/// phone computed. Rotating is the everyday thing that changes that wrap, so a
/// cursor that is only correct until the width changes is not correct.
///
/// These pin the store half of that: the same gateway position has to land on a
/// different display row once the wrap narrows.
@MainActor
struct TerminalCursorWrapTests {
    private func line(_ text: String) throws -> TerminalLine {
        try JSONDecoder().decode(TerminalLine.self, from: Data("[\"\(text)\",[]]".utf8))
    }

    private func frame(
        lines: [TerminalLine],
        cursor: TerminalCursor,
        kind: String = "reset",
        from: Int = 0
    ) -> MobileTerminalFrame {
        MobileTerminalFrame(
            sessionId: "session",
            kind: kind,
            from: from,
            lines: lines,
            total: lines.count,
            cursor: cursor,
            alt: false,
            truncated: false,
            seq: 1,
            sizeRevision: 1
        )
    }

    @Test func movesTheCursorWithTheWrapWhenTheWidthChanges() throws {
        let store = TerminalStore()
        store.update(columns: 40)
        store.apply(frame(
            lines: [try line(String(repeating: "x", count: 80))],
            cursor: TerminalCursor(row: 0, col: 30, visible: true)
        ))

        #expect(store.cursorPosition == TerminalStore.CursorPosition(rowIndex: 0, column: 30))

        // Rotating narrows the wrap: column 30 is now on the second display row.
        store.update(columns: 20)

        #expect(store.cursorPosition == TerminalStore.CursorPosition(rowIndex: 1, column: 10))
    }

    /// A cell column is not a character offset once a wide character appears.
    ///
    /// The desktop counts cells because cells are what its grid counts; the wrap
    /// slices by characters. Every Han character is two cells and one character, so
    /// the two numbers drift apart one cell at a time across a line.
    @Test func translatesCellColumnsThroughWideCharacters() {
        // "中文abc" is two cells per Han character and one per Latin.
        #expect(TerminalStore.characterIndex(forCell: 0, in: "中文abc") == 0)
        #expect(TerminalStore.characterIndex(forCell: 2, in: "中文abc") == 1)
        #expect(TerminalStore.characterIndex(forCell: 4, in: "中文abc") == 2)
        #expect(TerminalStore.characterIndex(forCell: 5, in: "中文abc") == 3)
        // Past the end clamps to the whole line rather than running off it.
        #expect(TerminalStore.characterIndex(forCell: 99, in: "中文abc") == 5)
    }

    /// The cursor lands on the character it is under, not at the column's index.
    @Test func putsTheCursorOnTheCharacterAfterWideText() throws {
        let store = TerminalStore()
        store.update(columns: 40)
        store.apply(frame(
            lines: [try line("中文abc")],
            cursor: TerminalCursor(row: 0, col: 5, visible: true)
        ))

        // Cell 5 is the "b": two cells into 中, two into 文, one into a.
        #expect(store.cursorPosition == TerminalStore.CursorPosition(rowIndex: 0, column: 3))
    }

    /// Widening has to move it back, or rotating one way would only ever be right.
    @Test func movesTheCursorBackWhenTheWrapWidens() throws {
        let store = TerminalStore()
        store.update(columns: 20)
        store.apply(frame(
            lines: [try line(String(repeating: "x", count: 80))],
            cursor: TerminalCursor(row: 0, col: 30, visible: true)
        ))
        #expect(store.cursorPosition == TerminalStore.CursorPosition(rowIndex: 1, column: 10))

        store.update(columns: 40)

        #expect(store.cursorPosition == TerminalStore.CursorPosition(rowIndex: 0, column: 30))
    }

    /// The view re-applies on `renderRevision`, so a wrap change has to move it —
    /// even though no frame arrived to announce the rotation. Without that, the
    /// rows the view holds stay laid out for the previous width, cursor included.
    @Test func aWrapChangeAsksTheViewToRedraw() throws {
        let store = TerminalStore()
        store.update(columns: 40)
        store.apply(frame(
            lines: [try line("hello")],
            cursor: TerminalCursor(row: 0, col: 0, visible: false)
        ))

        let afterFrame = store.renderRevision
        store.update(columns: 20)

        #expect(store.renderRevision != afterFrame, "a rotation has to trigger a redraw")
    }

    /// A frame still drives the redraw too — this replaced the sequence number as
    /// the view's driver, so it has to keep moving on output.
    @Test func aFrameAsksTheViewToRedraw() throws {
        let store = TerminalStore()
        let before = store.renderRevision

        store.apply(frame(
            lines: [try line("hello")],
            cursor: TerminalCursor(row: 0, col: 0, visible: false)
        ))

        #expect(store.renderRevision != before)
    }

    /// A hidden cursor stays hidden across a width change.
    @Test func keepsAHiddenCursorHidden() throws {
        let store = TerminalStore()
        store.update(columns: 40)
        store.apply(frame(
            lines: [try line("hello")],
            cursor: TerminalCursor(row: 0, col: 0, visible: false)
        ))

        store.update(columns: 20)

        #expect(store.cursorPosition == nil)
    }
}
