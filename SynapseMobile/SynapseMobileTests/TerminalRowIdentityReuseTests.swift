import CoreGraphics
import Testing
import UIKit

@testable import SynapseMobile

/// 快路（`reusedKeys`）的等价性、它的准入条件，以及它有没有真的接上。
///
/// 每一帧都要为**全部**行（上限 6000）各拼一个标识符字符串，而常态是只有尾部几行变了。
/// 快路把没变的那一段直接当前缀复用，只把尾部交给 `identity(...)` 重算。它成立的依据
/// 不是「看起来没问题」，而是一串必须同时成立的前提：
///
/// - 前缀行的 `id` 逐行相同（`id` 本身携带文本，所以这等价于行内容相同）；
/// - 下标对齐（头部裁剪会让所有下标前移，那时前缀必须是 0）；
/// - 光标位置与**当初算 keys 时**一致；
/// - 选区与**当初算 keys 时**一致（不是「现在有没有选区」—— 清空选区时 `appliedKeys`
///   里会留下过期的 `#sel:`，跟「现在没有」不是一个意思）；
/// - 字号与当初一致；
/// - 光标那一行必须落在**重算的那一段**里。闪烁相位只作用在光标那一行，所以相位不进
///   epoch，这一条是唯一兜住它的地方。
///
/// 任何一条不成立，快路都必须返回 nil 让调用方退回整份重建。所以这里钉的是两件事：
/// **成立时与整份重建逐字相等**，以及**不成立时必须让路**。后者比前者重要 —— 快路算错
/// 的后果是终端画面错行，而让路最多只是慢。
@MainActor
struct TerminalRowIdentityReuseTests {
    private let pane = CGRect(x: 0, y: 0, width: 393, height: 600)
    private let baseFontSize: CGFloat = TerminalDensity.normal.fontSize

    private func rows(_ range: Range<Int>) -> [DisplayRow] {
        range.map { index in
            DisplayRow(
                id: "line\(index)",
                text: "line \(index)",
                runs: [],
                lineIndex: index,
                isContinuation: false
            )
        }
    }

    private func cursor(_ row: Int, _ column: Int) -> TerminalStore.CursorPosition {
        TerminalStore.CursorPosition(rowIndex: row, column: column)
    }

    private func selection(
        fromRow: Int,
        fromColumn: Int,
        toRow: Int,
        toColumn: Int
    ) -> TerminalSelection {
        TerminalSelection(
            anchor: TerminalSelection.Position(row: fromRow, column: fromColumn),
            head: TerminalSelection.Position(row: toRow, column: toColumn)
        )
    }

    private func fullRebuild(
        _ rows: [DisplayRow],
        cursor: TerminalStore.CursorPosition?,
        cursorVisible: Bool,
        selection: TerminalSelection? = nil,
        fontSize: CGFloat? = nil
    ) -> [String] {
        TerminalCollectionView.identities(
            for: rows,
            cursor: cursor,
            cursorVisible: cursorVisible,
            selection: selection,
            fontSize: fontSize ?? baseFontSize
        )
    }

    /// 跑一次快路，同时算出「同一个入参下整份重建会得到什么」作为对照。
    ///
    /// `epoch*` 是**当初算 `appliedKeys` 时**的那组输入，`cursor` / `selection` /
    /// `fontSize` 是**现在**这组。两者不同正是「前提被破坏」的构造方式。
    private func compare(
        rows: [DisplayRow],
        applied: [DisplayRow],
        epochCursor: TerminalStore.CursorPosition?,
        cursor: TerminalStore.CursorPosition?,
        cursorVisible: Bool = true,
        epochSelection: TerminalSelection? = nil,
        selection: TerminalSelection? = nil,
        epochFontSize: CGFloat? = nil,
        fontSize: CGFloat? = nil,
        epochBuilt: Bool = true
    ) -> (reused: [String]?, full: [String]) {
        let epochSize = epochFontSize ?? baseFontSize
        let size = fontSize ?? baseFontSize
        let appliedKeys = fullRebuild(
            applied,
            cursor: epochCursor,
            cursorVisible: cursorVisible,
            selection: epochSelection,
            fontSize: epochSize
        )
        let reused = TerminalCollectionView.reusedKeys(
            for: rows,
            cursor: cursor,
            cursorVisible: cursorVisible,
            selection: selection,
            fontSize: size,
            appliedRows: applied,
            appliedKeys: appliedKeys,
            epoch: epochBuilt
                ? TerminalCollectionView.KeyEpoch(
                    cursor: epochCursor,
                    selection: epochSelection,
                    fontSize: epochSize
                )
                : nil
        )
        let full = fullRebuild(
            rows,
            cursor: cursor,
            cursorVisible: cursorVisible,
            selection: selection,
            fontSize: size
        )
        return (reused, full)
    }

    // MARK: - 成立时：与整份重建逐字相等

    /// 尾部改写（行数不变，后面几行换掉）是这条快路真正针对的形状。
    @Test func aRewrittenTailReusesThePrefixAndMatchesAFullRebuild() {
        let applied = rows(0..<210)
        // 末尾三行被重画，前缀 207 行原样。光标停在被重画的那一段里。
        let repainted = rows(0..<207) + [
            DisplayRow(id: "repaint-a", text: "A", runs: [], lineIndex: 207, isContinuation: false),
            DisplayRow(id: "repaint-b", text: "B", runs: [], lineIndex: 208, isContinuation: false),
            DisplayRow(id: "repaint-c", text: "C", runs: [], lineIndex: 209, isContinuation: false),
        ]
        let cursor = self.cursor(208, 4)

        // 两种闪烁相位都要对：相位只写进光标那一行的标识符，而那一行必须在重算段里。
        for phase in [true, false] {
            let (reused, full) = compare(
                rows: repainted,
                applied: applied,
                epochCursor: cursor,
                cursor: cursor,
                cursorVisible: phase
            )
            #expect(reused != nil, "尾部改写必须走快路，否则这条用例什么都没验到")
            #expect(reused == full, "快路算出来的必须与整份重建逐字相等")
        }
    }

    /// 光标不可见时（TUI / 备用屏的常态）`cursorPosition` 是 nil，准入只剩「前缀非空」。
    @Test func aGrownTailWithNoCursorReusesThePrefix() {
        let applied = rows(0..<200)
        let grown = rows(0..<210)

        let (reused, full) = compare(
            rows: grown,
            applied: applied,
            epochCursor: nil,
            cursor: nil
        )

        #expect(reused != nil, "光标不可见时尾部增长必须走快路")
        #expect(reused == full)
    }

    /// 选区是前提的一部分：**当初**有选区、现在也有**同一个**选区时可以复用前缀。
    @Test func aUnchangedSelectionStillAllowsReuse() {
        let applied = rows(0..<210)
        let repainted = rows(0..<207) + [
            DisplayRow(id: "repaint-a", text: "A", runs: [], lineIndex: 207, isContinuation: false),
            DisplayRow(id: "repaint-b", text: "B", runs: [], lineIndex: 208, isContinuation: false),
            DisplayRow(id: "repaint-c", text: "C", runs: [], lineIndex: 209, isContinuation: false),
        ]
        let cursor = self.cursor(208, 4)
        let marked = selection(fromRow: 205, fromColumn: 0, toRow: 206, toColumn: 5)

        let (reused, full) = compare(
            rows: repainted,
            applied: applied,
            epochCursor: cursor,
            cursor: cursor,
            epochSelection: marked,
            selection: marked
        )

        #expect(reused != nil)
        #expect(reused == full)
    }

    // MARK: - 不成立时：必须让路

    /// 每一条都是「破坏了前提的一个因子」，快路都必须返回 nil 退回整份重建。
    @Test func everyBrokenPremiseMakesTheFastPathDecline() {
        let applied = rows(0..<210)
        let grown = rows(0..<220)
        let cursor = self.cursor(209, 4)
        let marked = selection(fromRow: 200, fromColumn: 0, toRow: 201, toColumn: 5)

        // 头部整体位移：每一行的下标都变了，前缀必须是 0。
        let shifted = compare(rows: rows(3..<213), applied: applied, epochCursor: nil, cursor: nil)
        #expect(shifted.reused == nil, "头部位移后下标全变，复用前缀会让整屏错行")

        // 光标移动了：它所在那一行的标识符要跟着换。
        let moved = compare(rows: grown, applied: applied, epochCursor: cursor, cursor: self.cursor(210, 0))
        #expect(moved.reused == nil, "光标移出前缀算作前提被破坏")

        // 光标没动，但落在被复用的前缀里 —— 相位作用在它身上，而相位不进 epoch。
        let insidePrefix = compare(rows: grown, applied: applied, epochCursor: self.cursor(5, 1), cursor: self.cursor(5, 1))
        #expect(insidePrefix.reused == nil, "光标行落在复用段里就没有任何东西替它兜住闪烁相位")

        // 字号变了：标识符里织着字号。
        let resized = compare(
            rows: grown,
            applied: applied,
            epochCursor: cursor,
            cursor: cursor,
            epochFontSize: baseFontSize,
            fontSize: baseFontSize + 2
        )
        #expect(resized.reused == nil, "字号变了，前缀的标识符就不再成立")

        // 选区被清空：`appliedKeys` 里还留着过期的 `#sel:`，不能用。
        let cleared = compare(
            rows: grown,
            applied: applied,
            epochCursor: cursor,
            cursor: cursor,
            epochSelection: marked,
            selection: nil
        )
        #expect(cleared.reused == nil, "清空选区后旧 keys 里的 #sel: 已经过期")

        // 反向：当初没有选区、现在有了。
        let appeared = compare(
            rows: grown,
            applied: applied,
            epochCursor: cursor,
            cursor: cursor,
            epochSelection: nil,
            selection: marked
        )
        #expect(appeared.reused == nil, "新出现的选区还没进过任何一份 keys")

        // 第一次绘制：还没有 epoch。
        let firstPaint = compare(
            rows: grown,
            applied: applied,
            epochCursor: cursor,
            cursor: cursor,
            epochBuilt: false
        )
        #expect(firstPaint.reused == nil, "没有 epoch 就没有依据")
    }

    // MARK: - 接线：优化有没有真的接上

    /// 上面那些都是直接调静态接缝，所以就算 `push` 把 epoch 那行弄丢了、快路永远进不去，
    /// 它们**照样全绿**。这一条走真实视图，钉住「确实接上了」。
    @Test func theViewActuallyTakesTheFastPath() {
        let view = TerminalCollectionView(frame: pane)
        view.applyLayout(
            displayMode: .phoneDriven,
            desktopGrid: nil,
            fontSize: baseFontSize
        )
        view.setNeedsLayout()
        view.layoutIfNeeded()

        view.apply(rows: rows(0..<210), atHistoryFloor: false, cursor: nil)
        view.apply(
            rows: rows(0..<207) + [
                DisplayRow(id: "repaint-a", text: "A", runs: [], lineIndex: 207, isContinuation: false),
                DisplayRow(id: "repaint-b", text: "B", runs: [], lineIndex: 208, isContinuation: false),
                DisplayRow(id: "repaint-c", text: "C", runs: [], lineIndex: 209, isContinuation: false),
            ],
            atHistoryFloor: false,
            cursor: nil
        )
        #expect(view.reusedKeyPrefixLength == 207, "尾部改写那一帧必须复用前 207 行")

        // 头部位移那一帧没有前缀可复用，必须退回整份重建。
        view.apply(rows: rows(3..<213), atHistoryFloor: false, cursor: nil)
        #expect(view.reusedKeyPrefixLength == nil, "头部位移那一帧不该复用任何前缀")
    }
}
