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

    /// A wide character is two cells and one character. The ends are cells, so the
    /// slice has to be taken on the characters those cells land on — otherwise
    /// everything after the first Chinese character comes back shifted.
    @Test func extractionLandsOnTheCharactersTheCellsCover() {
        let rows = ["说明 https://example.org/a"]
        // 说明 takes four cells and the space one, so the URL runs over cells 5...25.
        let selection = selection(from: position(0, 5), to: position(0, 25))

        #expect(selection.lines(from: rows) == ["https://example.org/a"])
    }

    /// A long press takes the token under the finger — the path, the URL, the flag,
    /// whatever sits between whitespace. This is the one place the terminal's grid does
    /// have a word to snap to, and taking it is what gives the press something to show.
    @Test func aLongPressTakesTheTokenUnderIt() {
        let row = "说明 https://example.org/a 之后"

        #expect(TerminalSelection.token(at: position(0, 10), in: row).lines(from: [row])
            == ["https://example.org/a"])
        // The space sits on cell 4, between 说明's four cells and the URL's.
        // Whitespace is not a token. The whole row is the only other answer that does
        // not leave the reader holding one character.
        #expect(TerminalSelection.token(at: position(0, 4), in: row).lines(from: [row])
            == ["说明 https://example.org/a 之后"])
    }

    /// Dragging moves whichever end is on the far side of the token, so pulling back
    /// across it extends the other way instead of deleting what the press took.
    @Test func draggingKeepsTheTokenItStartedFrom() {
        let row = "aa bbbb cc"
        let token = TerminalSelection.token(at: position(0, 4), in: row)
        #expect(token.lines(from: [row]) == ["bbbb"])

        #expect(TerminalSelection.dragging(token, to: position(0, 9)).lines(from: [row])
            == ["bbbb cc"])
        #expect(TerminalSelection.dragging(token, to: position(0, 0)).lines(from: [row])
            == ["aa bbbb"])
        // Inside the token nothing moves: it was taken whole and stays whole.
        #expect(TerminalSelection.dragging(token, to: position(0, 5)).lines(from: [row])
            == ["bbbb"])
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
