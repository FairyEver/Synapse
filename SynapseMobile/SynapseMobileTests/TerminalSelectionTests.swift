import Testing

@testable import SynapseMobile

/// Selection is a rectangle of cells. The arithmetic that matters is which cells a
/// drag covers and what text comes back out of it.
///
/// The cases below deliberately drag in all four directions. Storing the two ends in
/// gesture order rather than sorting them is exactly the shape that gets one
/// direction right and the other three wrong, so each direction is checked against
/// the same expected region.
struct TerminalSelectionTests {
    private func position(_ row: Int, _ column: Int) -> TerminalSelection.Position {
        TerminalSelection.Position(row: row, column: column)
    }

    private func selection(
        from start: TerminalSelection.Position,
        to end: TerminalSelection.Position
    ) -> TerminalSelection {
        TerminalSelection(anchor: start, head: end)
    }

    /// A press that never moved is not a selection, and nothing should be offered
    /// for it.
    @Test func aPressThatNeverMovedSelectsNothing() {
        #expect(TerminalSelection(at: position(2, 5)).isEmpty)
        #expect(!selection(from: position(2, 5), to: position(2, 6)).isEmpty)
    }

    @Test func aSingleRowCoversTheCellsBetweenItsEnds() {
        let selection = selection(from: position(1, 3), to: position(1, 7))

        #expect(selection.columns(onRow: 1) == 3...7)
        #expect(selection.lineCount == 1)
    }

    /// Dragging up or left has to cover the same cells as dragging down or right.
    @Test func aDragInAnyDirectionCoversTheSameCells() {
        for (startColumn, endColumn) in [(0, 2), (2, 0), (0, 5), (5, 0)] {
            let forward = selection(from: position(1, startColumn), to: position(1, endColumn))
            let backward = selection(from: position(1, endColumn), to: position(1, startColumn))

            #expect(forward.columns(onRow: 1) == backward.columns(onRow: 1))
            #expect(forward.start == backward.start)
            #expect(forward.end == backward.end)
        }
    }

    /// Across rows the two ends are partial and everything between them is whole.
    @Test func middleRowsAreTakenWhole() {
        let selection = selection(from: position(1, 4), to: position(4, 2))

        #expect(selection.columns(onRow: 0) == nil)
        #expect(selection.columns(onRow: 1) == 4...Int.max)
        #expect(selection.columns(onRow: 2) == 0...Int.max)
        #expect(selection.columns(onRow: 3) == 0...Int.max)
        #expect(selection.columns(onRow: 4) == 0...2)
        #expect(selection.columns(onRow: 5) == nil)
        #expect(selection.lineCount == 4)
    }

    @Test func containsOnlyTheSelectedCells() {
        let selection = selection(from: position(1, 4), to: position(3, 2))

        #expect(selection.contains(row: 1, column: 4))
        #expect(!selection.contains(row: 1, column: 3))
        #expect(selection.contains(row: 2, column: 900))
        #expect(selection.contains(row: 3, column: 2))
        #expect(!selection.contains(row: 3, column: 3))
        #expect(!selection.contains(row: 0, column: 0))
    }

    /// The two ends are partial and the rows between them come back whole.
    @Test func extractionTakesEachRowAtItsOwnColumns() {
        let rows = ["0123456789", "0123456789", "0123456789", "0123456789"]
        let selection = selection(from: position(1, 7), to: position(3, 1))

        #expect(selection.lines(from: rows) == ["789", "0123456789", "01"])
    }

    /// A row shorter than the column range contributes what it holds and no more,
    /// rather than reading past its end.
    @Test func extractionClampsToWhatARowActuallyHolds() {
        let rows = ["abc", "ab"]

        // The range runs to column 8 of a row that holds two characters, so the
        // whole of that row is in.
        let toTheEnd = selection(from: position(0, 1), to: position(1, 8))
        #expect(toTheEnd.lines(from: rows) == ["bc", "ab"])

        // Starting past the end of a short row contributes nothing, rather than
        // reading off it.
        let pastTheEnd = selection(from: position(1, 5), to: position(1, 8))
        #expect(pastTheEnd.lines(from: rows) == [""])
    }

    /// Extending keeps the end the gesture started from, which is what makes a
    /// drag that reverses direction shrink the selection instead of moving it.
    @Test func extendingKeepsTheStartingEnd() {
        var selection = TerminalSelection(at: position(1, 4))
        selection.extend(to: position(1, 9))
        #expect(selection.columns(onRow: 1) == 4...9)

        selection.extend(to: position(1, 2))
        #expect(selection.columns(onRow: 1) == 2...4)
    }
}
