import Foundation

/// A run of the grid the reader has selected.
///
/// A rectangle of cells rather than a run of prose, and the unit is the cell: a
/// terminal line is a grid row, and what a reader wants to copy out of one is as often
/// half a path or a column of numbers as it is a sentence.
///
/// The ends are wherever the gesture put them, with two exceptions that come from the
/// same place — a press has to offer something the moment it lands. A long press starts
/// on the token under the finger (`token(at:in:)`), and the drag that follows keeps that
/// token whole (`dragging(_:to:)`).
///
/// Kept free of UIKit so the arithmetic — which rows are touched, which columns on
/// each, what the text comes out as — can be tested without a view.
struct TerminalSelection: Equatable {
    /// One cell. `row` indexes the display rows the store renders, not the
    /// desktop's lines, so a wrapped row is a row here like any other.
    struct Position: Equatable, Comparable {
        let row: Int
        let column: Int

        static func < (lhs: Position, rhs: Position) -> Bool {
            lhs.row == rhs.row ? lhs.column < rhs.column : lhs.row < rhs.row
        }
    }

    /// Where the gesture began, and where it has reached. Kept in that order rather
    /// than sorted, so a drag that reverses direction does not have to be rebuilt
    /// from its endpoints.
    private(set) var anchor: Position
    private(set) var head: Position

    init(anchor: Position, head: Position) {
        self.anchor = anchor
        self.head = head
    }

    init(at position: Position) {
        self.init(anchor: position, head: position)
    }

    /// The earlier end, which is where the selection's first handle goes.
    var start: Position { min(anchor, head) }
    /// The later end, which is where the second handle goes.
    var end: Position { max(anchor, head) }

    /// A press that never moved. Nothing is selected, so nothing should be offered.
    var isEmpty: Bool { anchor == head }

    /// How many grid rows the selection touches.
    var lineCount: Int { end.row - start.row + 1 }

    /// Columns taken on `row`, or nil when the row is outside the selection.
    ///
    /// Inclusive at both ends, because the head cell is part of what the reader
    /// dragged across — a selection that stopped one short of the finger would feel
    /// like it was lagging.
    func columns(onRow row: Int) -> ClosedRange<Int>? {
        guard row >= start.row, row <= end.row else { return nil }
        let first = row == start.row ? start.column : 0
        let last = row == end.row ? end.column : Int.max
        guard first <= last else { return nil }
        return first...last
    }

    /// Whether one cell is inside the selection.
    func contains(row: Int, column: Int) -> Bool {
        guard let columns = columns(onRow: row) else { return false }
        return columns.contains(column)
    }

    /// The selected text, one string per row.
    ///
    /// Trailing columns are kept as they are: the desktop's rows are padded to its
    /// grid, and trimming them here would be a second, quieter opinion about what
    /// was selected. Callers that want trimmed output can trim it.
    ///
    /// The ends are cell columns and text is counted in characters, and the two part
    /// company at the first wide character — one character, two cells. Slicing by
    /// column would take the wrong characters from any row holding one.
    func lines(from rows: [String]) -> [String] {
        (start.row...end.row).compactMap { row in
            guard let columns = columns(onRow: row), row < rows.count else { return nil }
            let characters = Array(rows[row])
            let first = TerminalStore.characterIndex(forCell: columns.lowerBound, in: rows[row])
            guard first < characters.count else { return "" }
            // The far end is inclusive, so its character is the one before the cell
            // after it. A row-end selection has no cell after it to ask about.
            let past = columns.upperBound == Int.max
                ? characters.count
                : TerminalStore.characterIndex(forCell: columns.upperBound + 1, in: rows[row])
            let upper = min(max(past - 1, first), characters.count - 1)
            return String(characters[first...upper])
        }
    }

    /// Extends the selection to a new head, keeping the anchor where it was.
    mutating func extend(to position: Position) {
        head = position
    }

    /// The token under a cell — what a long press means.
    ///
    /// A terminal has no words to snap to, but it does have tokens, and they are the
    /// unit worth taking: a path, a URL, a flag, a hash. Whitespace has no token, so a
    /// press that lands on it takes the whole row; anything else would leave the reader
    /// holding a press that selected nothing.
    static func token(at position: Position, in text: String) -> TerminalSelection {
        let characters = Array(text)
        guard !characters.isEmpty else { return TerminalSelection(at: position) }
        let origin = min(TerminalStore.characterIndex(forCell: position.column, in: text), characters.count - 1)

        func isBlank(_ index: Int) -> Bool { characters[index] == " " || characters[index] == "\t" }
        guard !isBlank(origin) else {
            return TerminalSelection(
                anchor: Position(row: position.row, column: 0),
                head: Position(row: position.row, column: cellCount(characters) - 1)
            )
        }
        var first = origin
        while first > 0, !isBlank(first - 1) { first -= 1 }
        var last = origin
        while last + 1 < characters.count, !isBlank(last + 1) { last += 1 }
        return TerminalSelection(
            anchor: Position(row: position.row, column: cellOffset(of: first, in: characters)),
            head: Position(row: position.row, column: cellOffset(of: last, in: characters))
        )
    }

    /// The selection a drag reaches when a token was already taken.
    ///
    /// The token stays in the selection whole. The drag moves whichever end is on the
    /// far side of it, so pulling back over the token extends the selection the other
    /// way rather than deleting what the press took.
    static func dragging(_ token: TerminalSelection, to position: Position) -> TerminalSelection {
        let taken = token.start...token.end
        guard !taken.contains(position) else {
            return TerminalSelection(anchor: token.start, head: token.end)
        }
        return position < taken.lowerBound
            ? TerminalSelection(anchor: token.end, head: position)
            : TerminalSelection(anchor: token.start, head: position)
    }

    private static func cellOffset(of character: Int, in characters: [Character]) -> Int {
        characters[..<character].reduce(0) { $0 + TerminalStore.cellWidth(of: $1) }
    }

    /// How many cells a row of text covers — the columns a selection on it can name.
    /// A caller with only the text in hand needs this to say "the whole row", and a
    /// character count is not it: one CJK character is two cells.
    static func cellCount(_ characters: [Character]) -> Int {
        characters.reduce(0) { $0 + TerminalStore.cellWidth(of: $1) }
    }
}
