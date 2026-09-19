import CoreGraphics
import Testing
import UIKit

@testable import SynapseMobile

/// Where the desktop-grid mode puts what it draws, and how it moves.
///
/// The mode used to place the grid as a picture inside a box exactly one desktop
/// screen tall: centred on both axes, with the margins that implies. The box was a
/// fiction — the rows this view is handed are the whole buffer, not one screen — so
/// the "margin" landed at the head of the buffer, where a reader only goes once they
/// have scrolled past everything, and content that fitted the pane became scrollable
/// anyway, by exactly that padding. "At the bottom" then meant something a reader
/// could be at while looking at a picture that had not filled the screen, which is
/// why following the newest line had to be switched off here.
///
/// These pin the replacement: a terminal viewport of the computer's width. Text
/// starts at the top left, the newest line sits on the bottom edge once there is
/// more than a pane of it, and a reader sitting there watches output arrive.
@MainActor
struct TerminalRestoreModeLayoutTests {
    /// A phone pane: taller than it is wide, so the desktop's columns are almost
    /// always what the fit runs out of first — which is the case the old centring
    /// was wrong in.
    private let pane = CGRect(x: 0, y: 0, width: 393, height: 600)

    private func lines(_ count: Int) -> [DisplayRow] {
        lines(0..<count)
    }

    /// Rows carrying the terminal's own line indices, so one slice of a buffer can
    /// be told from another — which is the whole of what the landing rules turn on.
    private func lines(_ range: Range<Int>) -> [DisplayRow] {
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

    /// Descends to the collection view the rows are drawn in, through the canvas the
    /// zoom transform is applied to.
    private func collectionView(in view: UIView) -> UICollectionView? {
        if let found = view as? UICollectionView { return found }
        for sub in view.subviews {
            if let found = collectionView(in: sub) { return found }
        }
        return nil
    }

    private func terminal(
        columns: Int,
        rows: Int,
        base: CGFloat = TerminalDensity.normal.fontSize
    ) -> (view: TerminalCollectionView, list: UICollectionView) {
        let view = TerminalCollectionView(frame: pane)
        view.applyLayout(
            displayMode: .desktopDriven,
            desktopGrid: DesktopGrid(columns: columns, rows: rows),
            fontSize: base
        )
        view.setNeedsLayout()
        view.layoutIfNeeded()
        guard let list = collectionView(in: view) else {
            fatalError("the terminal has no collection view")
        }
        return (view, list)
    }

    /// The height one row is drawn at — the whole of what the reader's density used
    /// to decide in this mode.
    private func cellHeight(in list: UICollectionView) -> CGFloat {
        list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0))?.frame.height ?? 0
    }

    /// Where a row actually lands on the pane, insets and offset included.
    private func visibleFrame(ofRow index: Int, in list: UICollectionView) -> CGRect? {
        guard let attributes = list.layoutAttributesForItem(at: IndexPath(item: index, section: 0))
        else { return nil }
        return attributes.frame.offsetBy(dx: -list.contentOffset.x, dy: -list.contentOffset.y)
    }

    /// Less than a pane of output sits against the bottom edge, under the newest line.
    ///
    /// A terminal fills its window from the top, so a buffer shorter than the pane
    /// leaves the unused space below its last line. That is the space a keyboard takes
    /// when one comes up — which is why the newest line of a session that had only just
    /// started slid out of sight and had to be scrolled back to. The inset is exactly
    /// what is left over, so the content ends where the pane ends and nothing is left
    /// beneath it to be taken away.
    ///
    /// Grown a frame at a time, because that is when it was wrong in the other
    /// direction: the box the grid used to sit in gave content that fitted a scroll
    /// range, so every frame that arrived could move it, and the reader watched the
    /// picture twitch.
    ///
    /// The expectation is reversed rather than the test removed. What stood here said
    /// the opposite — content shorter than the pane sitting at the top — and that is
    /// precisely the behaviour this replaces.
    @Test func lessThanAPaneOfOutputSitsAtTheBottom() {
        let (view, list) = terminal(columns: 80, rows: 24)
        for count in [5, 10, 15] {
            view.apply(rows: lines(count), atHistoryFloor: false, cursor: nil)
            list.layoutIfNeeded()

            #expect(list.contentInset.top > 0)
            #expect(abs(list.contentOffset.y + list.contentInset.top) < 1)
            #expect(visibleFrame(ofRow: 0, in: list)?.minY == list.contentInset.top)
            #expect(
                abs((visibleFrame(ofRow: count - 1, in: list)?.maxY ?? 0) - list.bounds.height) < 1,
                "the last of it does not end where the pane ends"
            )
        }
    }

    /// A buffer longer than the pane is left exactly as it was.
    ///
    /// The other half of what makes the inset safe: on content with more than a
    /// screenful in it there is nothing left over to push, so the inset is zero and the
    /// ordinary scrolling carries the reader — which is the behaviour every session
    /// reaches within a minute of starting.
    @Test func aFullPaneIsLeftAlone() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(list.contentInset.top == 0)

        // At the head of the buffer, where a terminal's text starts.
        list.setContentOffset(.zero, animated: false)
        list.layoutIfNeeded()
        #expect(visibleFrame(ofRow: 0, in: list)?.minY == 0)
    }

    /// The inset arrives and goes away as the buffer crosses a pane.
    ///
    /// The two tests above are each about one state; this is the move between them. A
    /// session starts short and grows long, and an inset left behind after it does
    /// would pad a buffer that has no room to be padded — the failure the change would
    /// have if only the first state were handled.
    @Test func theInsetArrivesAndGoesAwayWithTheOutput() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(5), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        #expect(list.contentInset.top > 0)

        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        #expect(list.contentInset.top == 0)
        // Still following the newest line, as it was before the inset ever applied.
        #expect(abs(list.contentOffset.y + list.bounds.height - list.contentSize.height) < 1)

        view.apply(rows: lines(5), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        #expect(list.contentInset.top > 0)
        #expect(abs(list.contentOffset.y + list.contentInset.top) < 1)
    }

    /// The grid starts at the left edge however narrow it is.
    ///
    /// A desktop terminal narrower than the phone — thirty columns against the
    /// forty-odd that fit — used to be pushed to the middle of the pane, so the same
    /// session began at a different place on every device. A terminal's text starts
    /// at its left edge; the space a narrow grid leaves is on the right, where a
    /// reader reads it as the grid being narrower than the phone, which it is.
    @Test func theGridStartsAtTheLeftEdge() {
        let (view, list) = terminal(columns: 30, rows: 24)
        view.apply(rows: lines(5), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(list.contentOffset.x == 0)
        #expect(visibleFrame(ofRow: 0, in: list)?.minX == 0)
    }

    /// Opening on a long buffer lands on the newest line.
    @Test func opensOnTheNewestLine() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(abs(list.contentOffset.y + list.bounds.height - list.contentSize.height) < 1)
    }

    /// New output arrives at the bottom edge, where the reader is looking.
    ///
    /// This is the behaviour the mode was promised and did not have: the newest line
    /// fell below the fold and stayed there, so what the pane showed was the buffer
    /// as it stood when the reader last touched it — a screenshot, not a terminal.
    @Test func followsTheNewestLine() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        view.apply(rows: lines(210), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(abs(list.contentOffset.y + list.bounds.height - list.contentSize.height) < 1)
        #expect(visibleFrame(ofRow: 209, in: list)?.maxY == list.bounds.height)
    }

    /// The reader's density has no way into this mode.
    ///
    /// Not "the picker is hidden" — the number behind it does not reach the drawing.
    /// The narrow grid is this test's point: there the fit used to stop at whatever
    /// size the density named, so the density *was* the answer, and hiding its picker
    /// would have left a setting still working from off screen. The wide one is the
    /// case a reader actually lives in, where it was already a no-op — asserted too,
    /// so neither half of the claim rests on reasoning alone.
    @Test func theDensityDoesNotReachThisMode() {
        for (columns, gridRows) in [(30, 24), (95, 30)] {
            for other in [TerminalDensity.compact, .spacious] {
                let normal = terminal(columns: columns, rows: gridRows)
                let differing = terminal(columns: columns, rows: gridRows, base: other.fontSize)
                for (view, list) in [normal, differing] {
                    view.apply(rows: lines(50), atHistoryFloor: false, cursor: nil)
                    list.layoutIfNeeded()
                }

                #expect(cellHeight(in: normal.list) > 0)
                #expect(cellHeight(in: normal.list) == cellHeight(in: differing.list))
            }
        }
    }

    /// 把这块地方换成另一个大小，并按 UIKit 的样子重新布局一次。
    private func resize(_ view: TerminalCollectionView, _ list: UICollectionView, to size: CGSize) {
        view.frame = CGRect(origin: .zero, size: size)
        view.setNeedsLayout()
        view.layoutIfNeeded()
        list.layoutIfNeeded()
    }

    /// 键盘吃掉的那一块不算进拟合：升起来那一下画面不许换比例。
    ///
    /// 这就是读者报上来的那一幕。手机键盘升起来时，SwiftUI 交给这个视图的是一块上沿
    /// 不动、下沿被吃掉的画布；照它重算，同一屏东西就按小了一半的比例画出来 ——
    /// 一台五十三列三十八行的终端上，正好是一半：12pt 的字变成 5.7pt，10.5px 一格变成
    /// 21.6px 一格。那不是"少看几行"（矮了本来就该少看几行），是整幅画面被缩放了，
    /// 而读者什么都没选。
    @Test func aPaneEatenIntoByAKeyboardKeepsItsFit() {
        let (view, list) = terminal(columns: 53, rows: 38)
        view.apply(rows: lines(50), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let before = cellHeight(in: list)
        #expect(before > 0)

        resize(view, list, to: CGSize(width: pane.width, height: 300))

        #expect(cellHeight(in: list) == before)
    }

    /// 长回去的那一次也一样：键盘收起是一帧一帧长回去的，途中每个高度都不是读者选过的。
    ///
    /// 少了这一条，上面那条会被"收起键盘时先缩回去、再长回来"满足 —— 那是同一记跳，
    /// 只是换了个方向。
    @Test func aPaneGrowingBackFromAKeyboardKeepsItsFit() {
        let (view, list) = terminal(columns: 53, rows: 38)
        view.apply(rows: lines(50), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let full = cellHeight(in: list)

        // 收起来，再按收起的动画走上几帧。
        for height in [500.0, 420.0, 360.0, 300.0] {
            resize(view, list, to: CGSize(width: pane.width, height: height))
            #expect(cellHeight(in: list) == full)
        }
        // 长回去，途中每一帧也照旧。
        for height in [300.0, 380.0, 460.0, 540.0] {
            resize(view, list, to: CGSize(width: pane.width, height: height))
            #expect(cellHeight(in: list) == full)
        }
        // 落定，还是同一个 —— 收起与放下本身就不该动它。
        resize(view, list, to: CGSize(width: pane.width, height: pane.height))
        #expect(cellHeight(in: list) == full)
    }

    /// 地方变大是要跟的：上面两条说的是"变小不算数"，不是"拟合不动了"。
    ///
    /// 少了这一条，一个干脆不再理会自己尺寸的视图也能让上面两条全绿 —— 而那是另一个
    /// 更糟的毛病：读者收起三条栏换来的那几行，本该按比例分给格子。
    ///
    /// 故意用一块窄终端：宽的那一台在这个宽度下是宽这条边在卡着，高再给它多少都到不了
    /// 字上 —— 那不叫没跟，那是宽说了算。窄的这台才是高说了算的那一种。
    @Test func aTallerPaneIsFittedAgain() {
        let (view, list) = terminal(columns: 30, rows: 38)
        view.apply(rows: lines(50), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let before = cellHeight(in: list)

        resize(view, list, to: CGSize(width: pane.width, height: 900))

        #expect(cellHeight(in: list) > before)
    }

    /// 转屏是另一块地方，重新量。
    ///
    /// 宽不一样的时候，记着的那块高度与现在这块没有可比性：拿竖屏的高度去拟合横屏的
    /// 画布，读者会得到一屏他装不下的字。
    @Test func aRotationIsFittedAgain() {
        let (view, list) = terminal(columns: 53, rows: 38)
        view.apply(rows: lines(50), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let before = cellHeight(in: list)

        // 横屏：画布又宽又矮，电脑那么多列在这个高下装不进去。
        resize(view, list, to: CGSize(width: 800, height: 300))

        #expect(cellHeight(in: list) != before)
    }

    /// A buffer that was replaced lands on the newest line, whatever this view held.
    ///
    /// The phone keeps a session's rows across visits, so entering one paints what
    /// was already held and the attach snapshot then replaces all of it. A
    /// replacement was indistinguishable from a page of history: the row the view
    /// was anchored on is in the new rows too, only further down, so the anchor
    /// rule fired — the reader kept a place in a buffer that no longer existed and
    /// was left standing in the middle of it, with the newest lines below the fold
    /// for the rest of the visit. Landing on the newest line is the only answer
    /// that is right: they asked for this terminal, not for the piece of it this
    /// view happened to be holding.
    @Test func aReplacedBufferLandsOnTheNewestLine() {
        let (view, list) = terminal(columns: 80, rows: 24)
        // What the phone still holds from the last visit: the tail of the window.
        view.apply(rows: lines(300..<320), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        // The attach snapshot: the whole window, these rows included.
        view.apply(rows: lines(0..<500), atHistoryFloor: false, cursor: nil, resetRevision: 1)
        list.layoutIfNeeded()

        #expect(abs(list.contentOffset.y + list.bounds.height - list.contentSize.height) < 1)
        #expect(visibleFrame(ofRow: 499, in: list)?.maxY == list.bounds.height)
    }

    /// The same rows arriving as history keep the reader's place instead.
    ///
    /// The pair of the test above, sharing its rows and differing only in whether
    /// the buffer was replaced. Rows that reach back before what the reader holds
    /// are scrollback, and dragging them to the bottom is the one thing that must
    /// not happen — so the fix cannot be "always follow the tail on a rewrite".
    @Test func historyAboveTheReaderKeepsTheirPlace() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(300..<500), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        // Reading the head of what the phone holds.
        list.setContentOffset(.zero, animated: false)
        list.layoutIfNeeded()

        view.apply(rows: lines(0..<500), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(visibleFrame(ofRow: 300, in: list)?.minY == 0)
    }

    /// A reader who scrolled up to read something is not dragged back down.
    ///
    /// The other half of following the tail, and the reason it is conditional rather
    /// than unconditional: output arriving while someone is reading earlier lines is
    /// exactly when yanking the viewport is most destructive.
    @Test func aReaderWhoScrolledUpStaysWhereTheyAre() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        list.setContentOffset(CGPoint(x: 0, y: 0), animated: false)
        list.layoutIfNeeded()
        view.apply(rows: lines(210), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(list.contentOffset.y == 0)
    }

    /// 尺寸变了要重新量，但一行都不许弄丢。
    ///
    /// 行画在多大的字上是行标识符的一部分，所以字号一变，数据源手里的每个 key 都换了
    /// 名字，必须整批重发。原来那一版是清空 key 与查找表、等下一次 `apply` 把它们一起
    /// 重建 —— 而 `layoutSubviews` 这条路上没有下一次：数据源还攥着旧 key，查找表却是
    /// 空的，于是每一个被回收的 cell 都在 provider 里落空、原样交回去。它身上带着上一次
    /// 那行的字，屏幕上就是一批**来自缓冲区别处**的行；终端闲着的时候，不会再有任何一帧
    /// 来纠正它。
    ///
    /// 两边分开数：一个是数据源自己报的条目数，一个是这个视图能解析出行数的 key 数。
    @Test func aResizeKeepsEveryHeldKeyResolvable() {
        let (view, list) = terminal(columns: 30, rows: 38)
        view.apply(rows: lines(0..<200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        #expect(view.resolvableRows == 200)

        // 变大是重新拟合的那一种：窄终端由高说了算（见 `aTallerPaneIsFittedAgain`）。
        resize(view, list, to: CGSize(width: pane.width, height: 900))

        #expect(list.numberOfItems(inSection: 0) == 200)
        #expect(view.resolvableRows == list.numberOfItems(inSection: 0))
    }

    /// 重算之后，屏幕上每一行还必须是它自己那一行。
    @Test func aResizeLeavesEveryVisibleRowShowingItsOwnText() {
        let (view, list) = terminal(columns: 30, rows: 38)
        view.apply(rows: lines(0..<200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        // 先让这些 cell 都被用过一遍：回收出来的 cell 身上带着上一次那行的字，落空时
        // 交回去的正是它。
        list.setContentOffset(.zero, animated: false)
        list.layoutIfNeeded()
        list.setContentOffset(CGPoint(x: 0, y: list.contentSize.height), animated: false)
        list.layoutIfNeeded()

        resize(view, list, to: CGSize(width: pane.width, height: 900))
        list.layoutIfNeeded()

        var checked = 0
        for indexPath in list.indexPathsForVisibleItems {
            guard let cell = list.cellForItem(at: indexPath) as? TerminalRowCell else { continue }
            #expect(cell.renderedText == "line \(indexPath.item)")
            checked += 1
        }
        #expect(checked > 0, "没有一行可查就等于什么都没验")
    }

    /// 缓冲区到顶之后往回读的人，不该被一帧一帧地推走。
    ///
    /// 手机的缓冲上限一到，此后每进一行就要丢掉最老的一行，而丢掉的**全在视口上方**。
    /// 补偿如果只认「先前的第一行」，那个锚点正是刚被丢掉的这一行，落空之后就不补偿了，
    /// 于是每来一帧，读者眼皮底下的内容就往前滑一行 —— 输出的那几秒里一直在滑。
    @Test func aTrimmedHeadDoesNotSlideTheReader() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(0..<500), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        // 读到中间停下，谁也不跟了。
        list.setContentOffset(CGPoint(x: 0, y: 200), animated: false)
        list.layoutIfNeeded()
        let anchored = visibleFrame(ofRow: 200, in: list)?.minY
        #expect(anchored != nil)

        // 稳态的一帧：头掉 3 行，尾进 3 行，行数不变。
        view.apply(rows: lines(3..<503), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        // 同一行（现在排在 197）还在屏幕上的同一处。
        #expect(visibleFrame(ofRow: 197, in: list)?.minY == anchored)
    }

    /// 跟着最新行的读者照旧跟着：头部被裁掉不是把他留在离底三行的理由。
    ///
    /// 上面那条的另一半。补偿与「跟着最新行」在稳态下会给出不同的答案，所以这里钉住
    /// 谁说了算 —— 少了它，一个对着被裁掉的头部做补偿、却不再跟最新行的实现也能让上面
    /// 那条全绿，而那正是长会话里最该跟着最新行的时刻。
    @Test func aTrimmedHeadStillLeavesTheFollowerAtTheNewestLine() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(0..<500), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        view.apply(rows: lines(3..<503), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(abs(list.contentOffset.y + list.bounds.height - list.contentSize.height) < 1)
        #expect(visibleFrame(ofRow: 499, in: list)?.maxY == list.bounds.height)
    }
}
