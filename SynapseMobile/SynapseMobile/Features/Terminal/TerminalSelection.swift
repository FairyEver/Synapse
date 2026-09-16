import Foundation

/// A run of the grid the reader has selected.
///
/// A rectangle of cells rather than a run of prose. There are no words here to snap
/// to: a terminal line is a grid row, and what a reader wants to copy out of one is
/// as often half a path or a column of numbers as it is a sentence. The unit is
/// therefore the cell, and the two ends are wherever the gesture put them.
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
    func lines(from rows: [String]) -> [String] {
        (start.row...end.row).compactMap { row in
            guard let columns = columns(onRow: row), row < rows.count else { return nil }
            let text = Array(rows[row])
            guard columns.lowerBound < text.count else { return "" }
            let upper = min(columns.upperBound, text.count - 1)
            return String(text[columns.lowerBound...upper])
        }
    }

    /// Extends the selection to a new head, keeping the anchor where it was.
    mutating func extend(to position: Position) {
        head = position
    }
}
