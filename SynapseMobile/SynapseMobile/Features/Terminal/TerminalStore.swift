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
    private(set) var resources: [TerminalResource] = []
    private var resourceCollector = TerminalResourceCollector()

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

    /// Bumped whenever a frame replaces the whole buffer rather than amending it.
    ///
    /// The view cannot work this out from the rows it is handed. A replacement
    /// whose window still holds the line the reader was on looks exactly like a
    /// page of history arriving above them — same rows, same order, only the head
    /// has moved — and the two want opposite things: history keeps the reader's
    /// place, a replacement has destroyed the place they were keeping. Without
    /// this the reader is left sitting in the middle of the buffer, and the newest
    /// line stays below the fold for the rest of the visit.
    private(set) var resetRevision = 0
    /// The oldest line index this store holds; the cursor a history request sends.
    private(set) var oldestIndex = 0
    /// True once the desktop has said there is nothing older.
    private(set) var reachedHistoryFloor = false
    private(set) var isLoadingHistory = false

    /// Must stay above the desktop's emulator retention, or the phone would trim
    /// history the desktop is still willing to send and the oldest pages would
    /// become unreachable. Roughly 1.5 MB of rows at the cap.
    private let maxLines = 6_000

    /// 一次裁剪比 `maxLines` 多丢多少行。
    ///
    /// `trimToLimit` 每帧都跑，而它贵的那一半（`removeFirst` 搬数组，加重建约 `maxLines`
    /// 项的下标字典）就是为这个常量而存在的。**刚好裁到 `maxLines` 会让那句 guard 在下一
    /// 行就重新成立**：第一次裁剪之后 `firstLineIndex == highestLineIndex - maxLines` 恒定，
    /// 于是长跑会话（`tail -f`、构建日志、TUI 输出）永久停在「每帧搬一次数组 + 重建 6000 项
    /// 字典」上。裁到上限以下一批，就是一次裁剪换 `trimBatchRows + 1` 行：**上限一点没抬**
    /// （guard 没动，缓冲区到顶时的高度和以前一模一样），贵的路径从每行一次变成每一批一次。
    /// 代价只是回滚缓冲的深度在 `maxLines - trimBatchRows` 到 `maxLines` 之间浮动
    /// （这里是 5_488…6_001 行），而不是一直顶在最后一行上。
    ///
    /// 512 这个数的两头都有约束。往下：桌面模拟器只留 5_000 行（`emulator.ts` 的
    /// `scrollback`），而下限必须是「比桌面还深」的那一侧 —— 6_000 - 512 留 488 行余量，
    /// 桌面还愿意给的页一页都不会变得取不到。往上：一次挪掉的下限不能比一屏还小气，也不能
    /// 大到把读者正在看的东西整段抽走，512 行是十几屏手机终端，两头都够。
    private let trimBatchRows = 512

    private var lines: [Int: TerminalLine] = [:]
    /// 还持有着的最高行号，-1 表示一行都没有。
    ///
    /// 记着它、而不是每帧 `lines.keys.max()`：那个是 O(n) 的扫描，而 `apply` 每帧都
    /// 要跑一次裁剪判断。缓冲区到顶之后 n 就是 6000。
    private var highestLineIndex = -1
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
        resourceCollector = TerminalResourceCollector()
        resources = []
        lines.removeAll()
        rows.removeAll()
        rowOffsetByLine.removeAll()
        highestLineIndex = -1
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

    /// Rows the pane shows at the reader's density.
    ///
    /// Not a layout input the way the column count is — nothing here re-wraps
    /// because of it. It exists because the phone's rows are half of what the
    /// desktop is asked to adopt, and only the phone can measure them.
    private(set) var visibleRows = 0

    func reportVisibleRows(_ rows: Int) {
        visibleRows = rows
    }

    /// Wraps the rows at `newColumns`.
    ///
    /// The store holds no opinion about which width that should be. Whoever knows —
    /// the view, which can see both the pane and the reader's display mode — tells
    /// it. It used to keep a mode of its own, and when that disagreed with the
    /// view's the rows came out wrapped at one width inside boxes built for another:
    /// text clinging to the left of an over-wide row, and the whole screen taller
    /// than it should be because every line had been wrapped early.
    func update(columns newColumns: Int) {
        guard newColumns != columns, newColumns > 0 else { return }
        columns = newColumns
        rebuildAllRows()
        renderRevision += 1
    }

    func apply(_ frame: MobileTerminalFrame) {
        if frame.isHistory {
            applyHistory(frame)
            collectResources(in: frame)
            renderRevision += 1
            return
        }
        isAlternateScreen = frame.alt
        lastSeq = frame.seq

        if frame.isReset {
            lines.removeAll()
            rowOffsetByLine.removeAll()
            rows.removeAll()
            highestLineIndex = -1
            lastWrappedLine = frame.from - 1
            firstLineIndex = frame.from
            rowsFirstLine = frame.from
            oldestIndex = frame.from
            reachedHistoryFloor = false
            isLoadingHistory = false
            resetRevision += 1
        } else if frame.truncated, frame.from > firstLineIndex {
            // The desktop evicted history the phone still had. Keeping the older
            // rows would show a prefix that can never be corrected.
            didTruncate = true
            firstLineIndex = frame.from
        }

        for offset in 0..<frame.lines.count {
            lines[frame.from + offset] = frame.lines[offset]
        }
        if !frame.lines.isEmpty { highestLineIndex = max(highestLineIndex, frame.from + frame.lines.count - 1) }
        // Suffix semantics: anything at or past `total` is gone — `total`, not the end
        // of this frame. An update too large for one frame arrives as several, and none
        // of their ends is the update's end; `total` is the one field that is the same
        // on all of them. Voiding at the frame's own end makes the first chunk delete
        // every line the later chunks are about to deliver: the buffer collapses to
        // that chunk's size on the spot, the reader is thrown hundreds of lines back,
        // and the rest of the chunks drag them forward again. On the phone that reads
        // as the terminal scrolling up and down on its own.
        //
        // The larger of the two is defensive: a `total` below its own frame's end would
        // otherwise make this delete lines it was handed a moment ago, and falling back
        // to the frame's own end can only ever delete too little.
        let voidFrom = max(frame.from + frame.lines.count, frame.total)
        // 只走真正可能删到的那一段。以前是遍历**全部**键去找通常为 0 个匹配（上限
        // 6000），而 `lines.keys` 这个视图持着字典的缓冲区 —— 只要真删掉一个键，
        // `removeValue` 就会因为非唯一引用而把整份字典拷贝一遍。
        if highestLineIndex >= voidFrom {
            for key in voidFrom...highestLineIndex {
                lines.removeValue(forKey: key)
            }
            highestLineIndex = voidFrom - 1
        }

        collectResources(in: frame)
        rewrap(from: frame.from)
        trimToLimit()
        lastCursor = frame.cursor
        refreshCursorPosition()
        renderRevision += 1
    }

    func setResourceKind(_ kind: TerminalResource.Kind, for url: URL) {
        resourceCollector.setKind(kind, for: url)
        resources = resourceCollector.resources
    }

    private func collectResources(in frame: MobileTerminalFrame) {
        // The column count goes along because a row the TUI wrapped itself is only
        // recognisable by having been filled to it — see `TerminalResourceCollector`.
        if resourceCollector.accept(frame, lines: lines, columns: columns) {
            resources = resourceCollector.resources
        }
    }

    /// Cells one character occupies on the desktop's grid.
    ///
    /// A deliberately small table. It exists only to relate a cell column to a
    /// character offset, so it needs to be right about the characters where those
    /// two differ and about nothing else. Anything it does not know counts as one
    /// cell, which is also what the desktop gives an unknown character.
    static func cellWidth(of character: Character) -> Int {
        guard let scalar = character.unicodeScalars.first else { return 1 }
        // Everything past the basic plane is wide: the emoji, and the CJK blocks
        // that live up there.
        if scalar.value > 0xFFFF { return 2 }
        switch scalar.value {
        case 0x1100...0x115F,  // Hangul Jamo
            0x2E80...0x303E,   // CJK radicals and punctuation
            0x3041...0x33FF,   // Kana, CJK compatibility
            0x3400...0x4DBF,   // CJK extension A
            0x4E00...0x9FFF,   // CJK unified ideographs
            0xA000...0xA4CF,   // Yi
            0xAC00...0xD7A3,   // Hangul syllables
            0xF900...0xFAFF,   // CJK compatibility ideographs
            0xFE30...0xFE6F,   // CJK compatibility forms
            0xFF00...0xFF60,   // Fullwidth forms
            0xFFE0...0xFFE6:   // Fullwidth signs
            return 2
        default:
            return 1
        }
    }

    /// Character offset of a cell column within one line.
    ///
    /// Cells count a wide character twice and characters count it once, so the two
    /// part company at the first one in a line. The desktop reports its cursor in
    /// cells because cells are what its grid counts; the wrap here slices by
    /// characters, so the column has to be translated before it can be used for
    /// either half of that arithmetic.
    static func characterIndex(forCell cell: Int, in text: String) -> Int {
        guard cell > 0 else { return 0 }
        var cells = 0
        var characters = 0
        for character in text {
            if cells >= cell { break }
            cells += cellWidth(of: character)
            characters += 1
        }
        return characters
    }

    /// Maps the desktop's cursor onto the wrapped rows. Hidden, or pointing at a
    /// line this store no longer holds, means nothing to draw.
    private func refreshCursorPosition() {
        guard lastCursor.visible,
              let base = rowOffsetByLine[lastCursor.row],
              lastCursor.col >= 0,
              let line = lines[lastCursor.row]
        else {
            cursorPosition = nil
            return
        }

        // Translated from cells to characters first. Using the cell column directly
        // put the cursor one character too far right for every wide character before
        // it — invisible in Latin text, and wrong in every line of Chinese.
        let character = Self.characterIndex(forCell: lastCursor.col, in: line.text)
        let width = max(1, columns)
        let rowIndex = base + character / width
        guard rowIndex < rows.count else {
            cursorPosition = nil
            return
        }
        cursorPosition = CursorPosition(rowIndex: rowIndex, column: character % width)
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
        highestLineIndex = max(highestLineIndex, frame.from + frame.lines.count - 1)
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
            // 折过行的只有 `rowsFirstLine...lastWrappedLine` 这一段，按它收敛即可 ——
            // 遍历整个字典的键既慢，又会在迭代中删除（`keys` 视图持着缓冲区，一次
            // 删除就是一次整份拷贝）。
            if lastWrappedLine >= lineIndex {
                for key in lineIndex...lastWrappedLine {
                    rowOffsetByLine.removeValue(forKey: key)
                }
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
        guard highestLineIndex - firstLineIndex > maxLines else { return }
        // 裁到上限**以下**一批，而不是刚好裁到上限：理由见 `trimBatchRows`。裁到上限的
        // 话，下一行进来的那一刻这句 guard 就又成立了。
        let newFirst = highestLineIndex - maxLines + trimBatchRows
        for key in firstLineIndex..<newFirst {
            lines.removeValue(forKey: key)
        }
        firstLineIndex = max(firstLineIndex, newFirst)
        // The cursor may never sit below what is still held. A page is served as
        // `[oldestIndex - count, oldestIndex)`, so a cursor left behind by the trim
        // asks for lines below the buffer and lands them under it, leaving a gap
        // between the page and the oldest line still here. `appendWrapped` stops at
        // that gap, and the rows end there for good — the newest lines are held and
        // never drawn.
        oldestIndex = max(oldestIndex, firstLineIndex)
        didTruncate = true
        dropRowsBefore(newFirst)
    }

    /// 丢掉落在 `newFirst` 之前的行，把还留着的整体前移。
    ///
    /// 这里**不重折任何一行**，这是这一条的关键。裁剪丢的是头部，留下来的那些行的折法
    /// 和标识符一个都没变，变的只是它们从第几行开始 —— 而原来那句 `rebuildAllRows()`
    /// 会把最多 6000 行全部重新折一遍（每行一次 `Array(line.text)`、一次 id 字符串插值、
    /// 两次 `String.hashValue`）。
    ///
    /// 而且这一条是**按批**跑的，不是每帧：一次裁剪落在 `maxLines - trimBatchRows` 上，
    /// 要再进 `trimBatchRows + 1` 行那句 guard 才会重新成立。长跑会话一旦过了上限
    /// （`tail -f`、构建日志、TUI 输出），每一批才付一次这里的代价 —— 以前是每一帧。
    private func dropRowsBefore(_ newFirst: Int) {
        // 没有这一行的折行记录（缓冲区里有缺口）：退回整体重建，慢但一定对。
        guard let dropRows = rowOffsetByLine[newFirst] else {
            rebuildAllRows()
            return
        }
        guard dropRows > 0 else {
            rowsFirstLine = newFirst
            refreshCursorPosition()
            return
        }
        rows.removeFirst(dropRows)
        rowOffsetByLine = Dictionary(
            uniqueKeysWithValues: rowOffsetByLine.compactMap { key, value in
                key >= newFirst ? (key, value - dropRows) : nil
            }
        )
        rowsFirstLine = newFirst
        // 行号整体前移了，游标落在第几行也跟着变。
        refreshCursorPosition()
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
