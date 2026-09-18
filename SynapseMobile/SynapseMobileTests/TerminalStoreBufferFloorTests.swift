import Foundation
import Testing

@testable import SynapseMobile

/// The store caps itself at `maxLines` and drops the head when a burst pushes past
/// it. Two pieces of bookkeeping have to move with that drop: the render floor, and
/// the history cursor the next page is requested from.
///
/// A page is asked for as `[oldestIndex - count, oldestIndex)`. Leave the cursor
/// where it was and the page lands *below* the oldest line still held; the gap
/// between the two stops the wrap, and the rows end there — with the newest lines
/// held in memory and never drawn. On the phone that reads as a terminal that will
/// not scroll any further down, however long you wait.
@MainActor
struct TerminalStoreBufferFloorTests {
    private func line(_ text: String) throws -> TerminalLine {
        try JSONDecoder().decode(TerminalLine.self, from: Data("[\"\(text)\",[]]".utf8))
    }

    private func frame(
        lines: [TerminalLine],
        kind: String = "reset",
        from: Int = 0
    ) -> MobileTerminalFrame {
        MobileTerminalFrame(
            sessionId: "session",
            kind: kind,
            from: from,
            lines: lines,
            total: from + lines.count,
            cursor: TerminalCursor(row: 0, col: 0, visible: false),
            alt: false,
            truncated: false,
            seq: 1,
            sizeRevision: 1
        )
    }

    @Test func movesTheHistoryCursorWithTheLineTheHeadWasTrimmedAt() throws {
        let store = TerminalStore()
        store.update(columns: 80)
        let filler = try line("x")

        // One line past the cap, so the trim fires and drops the oldest line.
        store.apply(frame(lines: Array(repeating: filler, count: 6_002)))

        // The cursor is where the next page is asked from, so it may never name a
        // line the store has already thrown away.
        #expect(store.oldestIndex == store.rows.first?.lineIndex)
        #expect(store.oldestIndex == 1)
    }

    @Test func keepsDrawingTheNewestLinesAfterAPageLandsBelowTheFloor() throws {
        let store = TerminalStore()
        store.update(columns: 80)
        let filler = try line("x")
        store.apply(frame(lines: Array(repeating: filler, count: 6_002)))

        // Scrolling up asks for the page just below what the store holds.
        let count = 3
        store.apply(frame(
            lines: Array(repeating: filler, count: count),
            kind: "history",
            from: store.oldestIndex - count
        ))

        // The page and the held lines have to meet: scrollback above, and the newest
        // line — the reason the reader is here — still at the bottom of the rows.
        #expect(store.rows.last?.lineIndex == 6_001)
    }
}
