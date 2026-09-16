import Foundation
import Observation

/// One wrapped screen row.
struct DisplayRow: Identifiable, Hashable, Sendable {
    let id: String
    let text: String
    /// Offsets are relative to this row, not to the logical line.
    let runs: [StyleRun]
    let lineIndex: Int
    /// True for the second and later screen rows of one logical line, so the
    /// wrap is legible as a continuation instead of looking like two lines.
    let isContinuation: Bool
}

/// The phone's view of one terminal.
///
/// The wire protocol is a *suffix replacement*: a frame says "from line N onward
/// the content is this, and anything after it is void". Frames are therefore
/// idempotent and self-healing, but the client owns something the desktop cannot
/// know — how wide the phone is, and therefore how lines wrap.
///
/// Wrapping is the expensive part, so it is cached per logical line. The two
/// common shapes of traffic each have a cheap path: an append extends what is
/// already wrapped, and an in-place rewrite (a progress bar) discards from the
/// changed line down. Anything else falls back to a full rebuild, which is
/// bounded by `maxLines`.
@MainActor
@Observable
final class TerminalStore {
    /// Rows the collection view renders. Stable ids let the diffable data source
    /// tell an append from a rewrite without comparing text.
    private(set) var rows: [DisplayRow] = []

    /// Where the terminal's cursor sits on the rows this store renders.
    ///
    /// The desktop reports a line index and a column in *its* grid. The phone wraps
    /// the same characters at its own width, so that column has to be split back
    /// into the display row that carries it and an offset within that row.
    struct CursorPosition: Equatable {
        /// Index into `rows`.
        let rowIndex: Int
        /// Character offset within that row.
        let column: Int
    }

    private(set) var cursorPosition: CursorPosition?
    /// The last cursor the desktop sent, kept so the position can be recomputed
    /// when the wrap width changes underneath it.
    private var lastCursor: TerminalCursor = .hidden
    private(set) var isAlternateScreen = false
    private(set) var didTruncate = false
    private(set) var columns: Int = 80
    private(set) var lastSeq = 0

    /// Drives the view re-applying what it holds.
    ///
    /// Deliberately more than the frame sequence. Rotating changes the wrap width
    /// and re-wraps every row, but no new output arrives to announce it — and the
    /// view is holding rows laid out for the previous width, cursor included, so
    /// without this it keeps the old wrap until some later frame happens to land.
    /// That is why a rotated terminal looked wrong only sometimes.
    private(set) var renderRevision = 0
    /// The oldest line index this store holds; the cursor a history request sends.
    private(set) var oldestIndex = 0
    /// True once the desktop has said there is nothing older.
    private(set) var reachedHistoryFloor = false
    private(set) var isLoadingHistory = false

    /// Must stay above the desktop's emulator retention, or the phone would trim
    /// history the desktop is still willing to send and the oldest pages would
    /// become unreachable. Roughly 1.5 MB of rows at the cap.
    private let maxLines = 6_000

    private var lines: [Int: TerminalLine] = [:]
    private var rowOffsetByLine: [Int: Int] = [:]
    /// Lowest line index still considered valid.
    private var firstLineIndex = 0
    /// Line index of `rows[0]`.
    private var rowsFirstLine = 0
    /// Highest line that has been wrapped into `rows`.
    private var lastWrappedLine = -1

    var isEmpty: Bool { rows.isEmpty }

    var plainText: String {
        rows.map(\.text).joined(separator: "\n")
    }

    func reset() {
        lines.removeAll()
        rows.removeAll()
        rowOffsetByLine.removeAll()
        firstLineIndex = 0
        rowsFirstLine = 0
        lastWrappedLine = -1
        lastCursor = .hidden
        cursorPosition = nil
        isAlternateScreen = false
        didTruncate = false
        oldestIndex = 0
        reachedHistoryFloor = false
        isLoadingHistory = false
    }

    func update(columns newColumns: Int) {
        guard newColumns != columns, newColumns > 0 else { return }
        columns = newColumns
        rebuildAllRows()
        renderRevision += 1
    }

    func apply(_ frame: MobileTerminalFrame) {
        if frame.isHistory {
            applyHistory(frame)
            renderRevision += 1
            return
        }
        isAlternateScreen = frame.alt
        lastSeq = frame.seq

        if frame.isReset {
            lines.removeAll()
            rowOffsetByLine.removeAll()
            rows.removeAll()
            lastWrappedLine = frame.from - 1
            firstLineIndex = frame.from
            rowsFirstLine = frame.from
            oldestIndex = frame.from
            reachedHistoryFloor = false
            isLoadingHistory = false
        } else if frame.truncated, frame.from > firstLineIndex {
            // The desktop evicted history the phone still had. Keeping the older
            // rows would show a prefix that can never be corrected.
            didTruncate = true
            firstLineIndex = frame.from
        }

        for offset in 0..<frame.lines.count {
            lines[frame.from + offset] = frame.lines[offset]
        }
        // Suffix semantics: anything past the frame's own content is gone.
        let voidFrom = frame.from + frame.lines.count
        for key in lines.keys where key >= voidFrom {
            lines.removeValue(forKey: key)
        }

        rewrap(from: frame.from)
        trimToLimit()
        lastCursor = frame.cursor
        refreshCursorPosition()
        renderRevision += 1
    }

    /// Maps the desktop's cursor onto the wrapped rows. Hidden, or pointing at a
    /// line this store no longer holds, means nothing to draw.
    private func refreshCursorPosition() {
        guard lastCursor.visible,
              let base = rowOffsetByLine[lastCursor.row],
              lastCursor.col >= 0
        else {
            cursorPosition = nil
            return
        }
        let width = max(1, columns)
        let rowIndex = base + lastCursor.col / width
        guard rowIndex < rows.count else {
            cursorPosition = nil
            return
        }
        cursorPosition = CursorPosition(rowIndex: rowIndex, column: lastCursor.col % width)
    }

    /// Inserts a page of scrollback below what is already held.
    ///
    /// Deliberately not a suffix replacement: the client must keep every newer
    /// line it has while gaining older ones above them.
    private func applyHistory(_ frame: MobileTerminalFrame) {
        isLoadingHistory = false
        guard !frame.lines.isEmpty else {
            // An empty page is the desktop saying it has nothing older — the line
            // is gone from its ring buffer too, not merely unsent.
            reachedHistoryFloor = true
            return
        }
        for offset in 0..<frame.lines.count {
            lines[frame.from + offset] = frame.lines[offset]
        }
        if frame.from < firstLineIndex { firstLineIndex = frame.from }
        oldestIndex = firstLineIndex
        rebuildAllRows()
        reachedHistoryFloor = frame.from == 0
    }

    func beginHistoryLoad() {
        isLoadingHistory = true
    }

    func endHistoryLoad() {
        isLoadingHistory = false
    }

    // MARK: - Wrapping

    private func rewrap(from lineIndex: Int) {
        if lineIndex == lastWrappedLine + 1, rowsFirstLine <= lastWrappedLine {
            appendWrapped(from: lineIndex)
            return
        }
        if lineIndex >= rowsFirstLine, let offset = rowOffsetByLine[lineIndex] {
            rows.removeSubrange(offset..<rows.count)
            for key in rowOffsetByLine.keys where key >= lineIndex {
                rowOffsetByLine.removeValue(forKey: key)
            }
            lastWrappedLine = lineIndex - 1
            appendWrapped(from: lineIndex)
            return
        }
        rebuildAllRows()
    }

    /// Wraps every line from `lineIndex` upward, keeping rows already produced.
    private func appendWrapped(from lineIndex: Int) {
        var index = lineIndex
        while let line = lines[index] {
            rowOffsetByLine[index] = rows.count
            rows.append(contentsOf: Self.wrap(line, lineIndex: index, columns: columns))
            lastWrappedLine = index
            index += 1
        }
    }

    private func rebuildAllRows() {
        rows.removeAll()
        rowOffsetByLine.removeAll()
        rowsFirstLine = firstLineIndex
        lastWrappedLine = firstLineIndex - 1
        appendWrapped(from: firstLineIndex)
        // Row indices just changed, so the cursor's row does too.
        refreshCursorPosition()
    }

    private func trimToLimit() {
        guard let highest = lines.keys.max(), highest - firstLineIndex > maxLines else { return }
        let newFirst = highest - maxLines
        for key in lines.keys where key < newFirst {
            lines.removeValue(forKey: key)
        }
        // Cheapest correct response to dropping the head: re-wrap the tail.
        firstLineIndex = max(firstLineIndex, newFirst)
        didTruncate = true
        rebuildAllRows()
    }

    /// Splits one logical line into screen rows, keeping styling attached to the
    /// characters it belongs to.
    static func wrap(_ line: TerminalLine, lineIndex: Int, columns: Int) -> [DisplayRow] {
        let width = max(1, columns)
        let characters = Array(line.text)
        if characters.isEmpty {
            return [DisplayRow(id: "\(lineIndex)#0", text: "", runs: [], lineIndex: lineIndex, isContinuation: false)]
        }

        var result: [DisplayRow] = []
        var offset = 0
        var rowOffset = 0
        while offset < characters.count {
            let end = min(offset + width, characters.count)
            let slice = String(characters[offset..<end])
            let runs = sliceRuns(line.runs, from: offset, to: end)
            // The id carries the content so a rewritten row is a replace rather
            // than a no-op the data source would skip.
            let signature = runs
                .map { "\($0.start):\($0.length):\($0.foreground):\($0.background):\($0.flags)" }
                .joined(separator: ",")
            result.append(DisplayRow(
                id: "\(lineIndex)#\(rowOffset)#\(slice.hashValue)#\(signature.hashValue)",
                text: slice,
                runs: runs,
                lineIndex: lineIndex,
                isContinuation: rowOffset > 0
            ))
            offset = end
            rowOffset += 1
        }
        return result
    }

    /// Rebases runs onto a display row's coordinate space.
    private static func sliceRuns(_ runs: [StyleRun], from start: Int, to end: Int) -> [StyleRun] {
        guard !runs.isEmpty else { return [] }
        var sliced: [StyleRun] = []
        for run in runs {
            let runEnd = run.start + run.length
            guard runEnd > start, run.start < end else { continue }
            let clippedStart = max(run.start, start)
            let clippedEnd = min(runEnd, end)
            sliced.append(StyleRun(
                start: clippedStart - start,
                length: clippedEnd - clippedStart,
                foreground: run.foreground,
                background: run.background,
                flags: run.flags
            ))
        }
        return sliced
    }
}
