import Testing

@testable import SynapseMobile

/// The cursor travels to the collection view as part of a row's *identity*, not as
/// a reload performed afterwards.
///
/// That distinction is what the shipped crash was made of: the cursor used to be
/// drawn by calling `reloadItems` on rows whose identity had not changed, and that
/// call asserts whenever the collection view and its data source disagree about
/// which items exist — which is exactly the state during the update pass that put
/// the screen up. Every terminal opening aborted.
///
/// These tests pin the property that makes the design work: a cursor that moves
/// changes an identity the diff can see, and everything else stays put so no other
/// row is rebuilt. A future change that goes back to reloading rows to move a
/// cursor breaks the first assertion here.
struct TerminalRowIdentityTests {
    private func rows(_ texts: [String]) -> [DisplayRow] {
        texts.enumerated().map { index, text in
            DisplayRow(
                id: "row\(index)",
                text: text,
                runs: [],
                lineIndex: index,
                isContinuation: false
            )
        }
    }

    private func cursor(row: Int, column: Int) -> TerminalStore.CursorPosition {
        TerminalStore.CursorPosition(rowIndex: row, column: column)
    }

    @Test func movingTheCursorChangesExactlyTheRowsItLeftAndArrivedAt() {
        let rows = rows(["one", "two", "three"])
        let before = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 0, column: 2),
            cursorVisible: true
        )
        let after = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 1, column: 0),
            cursorVisible: true
        )

        let changed = zip(before, after).enumerated().filter { $0.element.0 != $0.element.1 }
        #expect(changed.map(\.offset) == [0, 1], "a cursor move must not disturb the rows it left alone")
        // Bystanders keep the plain row id, so the diff has nothing to do to them.
        #expect(after[2] == rows[2].id)
    }

    @Test func theCursorRowIsKeyedOffTheColumnItSitsAt() {
        let rows = rows(["abc"])
        let left = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 0, column: 0),
            cursorVisible: true
        )
        let right = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 0, column: 1),
            cursorVisible: true
        )

        #expect(left[0] != right[0], "typing in place would never redraw the cursor")
    }

    /// The blink is a diff too: the off phase drops the cursor from the key, which
    /// is how the block is erased without a reload.
    @Test func theBlinkIsAnIdentityChangeInBothDirections() {
        let rows = rows(["abc"])
        let on = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 0, column: 1),
            cursorVisible: true
        )
        let off = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 0, column: 1),
            cursorVisible: false
        )

        #expect(on[0] != off[0])
        #expect(off[0] == rows[0].id)
    }

    /// Unchanged input must produce unchanged keys, or every frame would rebuild
    /// rows that did not move.
    @Test func identicalInputProducesIdenticalIdentities() {
        let rows = rows(["one", "two"])
        let once = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 1, column: 3),
            cursorVisible: true
        )
        let twice = TerminalCollectionView.identities(
            for: rows,
            cursor: cursor(row: 1, column: 3),
            cursorVisible: true
        )

        #expect(once == twice)
    }

    /// Hiding the cursor has to remove the key's cursor component from every row,
    /// not just the one it is on.
    @Test func aHiddenCursorKeysEveryRowPlainly() {
        let rows = rows(["one", "two", "three"])

        let keys = TerminalCollectionView.identities(
            for: rows,
            cursor: nil,
            cursorVisible: true
        )

        #expect(keys == rows.map(\.id))
    }
}
