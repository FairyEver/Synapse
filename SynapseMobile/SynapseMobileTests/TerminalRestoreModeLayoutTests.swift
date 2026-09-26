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

    /// 上方插进来一整页滚动历史，贴底的读者当场上到新的最底 —— 不跳、也不滑。
    ///
    /// 这是「输出时上下狂滚」那一幕的成因：`apply` 里 `wasAtBottom` 那一支排在补偿
    /// 之前，于是上方插入的行**一条也没被补偿**。视口离底部凭空远了一整块，而跟随滑的
    /// 正是「离底部还差多远」—— 屏幕上先整段跳回一页更早的内容，再花近一秒滑回来；
    /// 输出持续期间这块一批接一批地插，就一直上下滚。
    ///
    /// 必须挂着窗口：没有窗口时 `followNewestLine()` 会退化成一步落位，跳和滑长得一样，
    /// 这条就分不出两种实现了。断言也不等滑行 —— 等完之后两种实现都落在底上，
    /// 只有「apply 一返回就在底上」才说明那块距离是被补偿掉的、不是被滑掉的。
    @Test func aPageOfHistoryAboveTheReaderIsCompensatedNotGlided() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(200..<400), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let window = inWindow(view)
        defer { view.removeFromSuperview(); window.isHidden = true }

        // 200 行插在视口上方，下面一行新的也没有。
        view.apply(rows: lines(0..<400), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(
            abs(list.contentOffset.y - view.bottomOffsetY) < 0.5,
            "上方插入一整页之后视口没跟到底 —— 它会先跳回去，再当着读者的面滑回来"
        )
        #expect(!view.isFollowingPerFrame, "这段距离是被补偿掉的，没有距离要滑")
        #expect(visibleFrame(ofRow: 399, in: list)?.maxY == list.bounds.height)
    }

    /// 头部裁剪的时候**不能**补偿，否则贴底的读者反而被推离底部。
    ///
    /// 上面那条的另一半，也是补偿条件为什么必须写成 `rowShift > 0` 的证明。裁剪方向
    /// 贴底读者的底部本来就没动，补偿会把他往上推 `-rowShift` 行；而指数平滑越近越慢，
    /// 补出来的这段距离可能永远够不到 `followSettleDistance`，`settledSince` 就始终为
    /// nil，逐帧驱动器在持续输出期间再也不停 —— 屏幕按刷新率一直醒着。
    ///
    /// 不加窗口：这一条要的就是「apply 一返回就在底上」，滑行到位不算数。
    @Test func aTrimmedHeadDoesNotPushTheFollowerOffTheBottom() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(0..<500), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        // 稳态的一帧：头掉 3 行，尾进 3 行，行数不变，底部也没动。
        view.apply(rows: lines(3..<503), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(
            abs(list.contentOffset.y - view.bottomOffsetY) < 0.5,
            "裁剪方向被补偿了 —— 贴底读者被推离底部，随后还要滑回来"
        )
        #expect(!view.isFollowingPerFrame, "底部没动，不该有滑行起来")
    }

    /// 把视图真的挂进一个窗口。
    ///
    /// 平滑跟随要一个屏幕刷新源，没有窗口就没有它 —— 视图会有意退回一步落位，于是
    /// 「滑过去」与「跳过去」在没有窗口的测试里长得一样。这一条就是为那两者分开而立的。
    ///
    /// **同时把 `animatesFollow` 摁成 true。** 它默认跟着系统的「减弱动态效果」走，
    /// 而那是一个**跟着目标机走的环境量**：同一份代码在开了它的模拟器上会让
    /// `followNewestLine()` 整条走一步落位的回落路径 —— 滑行根本不发生，「跳过去」
    /// 与「滑过去」的断言于是全都名存实亡（跑出来是绿的，而它断言的行为一次都没执行）。
    /// 这个属性从加上那天起就是为这件事留的口子：这一层要验的是滑行本身，
    /// 不是那台机器有没有开减弱动态效果。
    private func inWindow(_ view: TerminalCollectionView) -> UIWindow {
        view.animatesFollow = true
        let window = UIWindow(frame: pane)
        window.addSubview(view)
        view.frame = pane
        window.isHidden = false
        view.setNeedsLayout()
        view.layoutIfNeeded()
        return window
    }

    /// 滑行要去的那个偏移，与一步落位落在同一处。
    ///
    /// 两件事必须落在同一点：滑行到位之后如果和 `scrollToItem(at: .bottom)` 差上一截，
    /// 那截差就会在停下的一瞬间补上 —— 看起来正是这次要消掉的那一跳。
    @Test func theGlideTargetIsWhereTheInstantLandingGoes() {
        for count in [5, 200] {
            let (view, list) = terminal(columns: 80, rows: 24)
            view.apply(rows: lines(count), atHistoryFloor: false, cursor: nil)
            list.layoutIfNeeded()

            #expect(abs(view.bottomOffsetY - list.contentOffset.y) < 0.5)
        }
    }

    /// 读者往上挪一点，跟随就得让位。
    ///
    /// 这是朋友那台手机上「终端不能滚动」的第一号成因：读者把画面带上去两行，跟随
    /// 没解除，下一批输出一到就把视口一步拽回最底 —— 手指刚推上去、半秒后被弹回来。
    ///
    /// 两行在两种密度下分别是 20 点（优先还原，cellHeight 10）与 32 点（手机优先，
    /// cellHeight 16），两个都要能解除。用 40 点当判据时这两条都是红的。
    @Test func aShortReaderScrollUnpinsTheFollow() {
        for distance in [CGFloat(20), 32] {
            let pinned = TerminalCollectionView.pinAfterScroll(
                isPinned: true,
                distanceFromBottom: distance,
                isReaderScrolling: true,
                paneChanged: false,
                insetChanged: false,
                isDrivingFollow: false
            )
            #expect(pinned == false, "离底 \(distance) 点是读者自己挪的，跟随必须解除")
        }
    }

    /// 内容自己长高不能被当成读者翻页。
    ///
    /// 这条挡的是「把余量统一调小」那个改法：新一行到了、offset 没动，离底的距离凭空
    /// 多出一行，那同样是二十来点。判成读者往上翻，跟随就在第一批输出到达时把自己关掉，
    /// 从此再也不跟 —— 屏幕上表现为新输出全部落在可视区外面。
    @Test func contentGrowingDoesNotUnpinTheFollow() {
        let pinned = TerminalCollectionView.pinAfterScroll(
            isPinned: true,
            distanceFromBottom: 20,
            isReaderScrolling: false,
            paneChanged: false,
            insetChanged: false,
            isDrivingFollow: false
        )
        #expect(pinned, "内容长高一行不是读者在翻页")

        let driving = TerminalCollectionView.pinAfterScroll(
            isPinned: true,
            distanceFromBottom: 300,
            isReaderScrolling: false,
            paneChanged: false,
            insetChanged: false,
            isDrivingFollow: true
        )
        #expect(driving, "我们自己的滑行途中离底很远，那不是读者松手了")
    }

    /// 画布变矮仍然只能把跟随粘得更牢，解不开它。
    ///
    /// 键盘升起时 UIKit 会把 offset 钳回新的合法区间，那一下和读者往上翻长得一模一样。
    /// 认错就等于跟随被永久关掉：键盘或面板开着的时候新输出全落在屏幕外面。
    @Test func aLayoutChangeCannotUnpinTheFollow() {
        for changed in [(pane: true, inset: false), (pane: false, inset: true)] {
            let pinned = TerminalCollectionView.pinAfterScroll(
                isPinned: true,
                distanceFromBottom: 200,
                isReaderScrolling: false,
                paneChanged: changed.pane,
                insetChanged: changed.inset,
                isDrivingFollow: false
            )
            #expect(pinned, "布局引起的那一格不是读者的手")

            let alreadyOff = TerminalCollectionView.pinAfterScroll(
                isPinned: false,
                distanceFromBottom: 200,
                isReaderScrolling: false,
                paneChanged: changed.pane,
                insetChanged: changed.inset,
                isDrivingFollow: false
            )
            #expect(alreadyOff == false, "布局回调也不该把读者已经解开的跟随重新扣上")
        }
    }

    /// 回到最底就重新跟上，点状态栏回顶部仍然解除。
    ///
    /// 紧的那一档不能紧到「再也回不来」：读者拖回底部、或者往下甩到最底，跟随要恢复。
    /// 而状态栏回顶部不是读者的手，它走的是另一条路径 —— 那条路上离底几百点，照旧解除。
    @Test func theFollowResumesAtTheBottomAndStillYieldsAtTheTop() {
        let back = TerminalCollectionView.pinAfterScroll(
            isPinned: false,
            distanceFromBottom: 0,
            isReaderScrolling: true,
            paneChanged: false,
            insetChanged: false,
            isDrivingFollow: false
        )
        #expect(back, "读者把画面拖回最底，跟随要接上")

        let top = TerminalCollectionView.pinAfterScroll(
            isPinned: true,
            distanceFromBottom: 600,
            isReaderScrolling: false,
            paneChanged: false,
            insetChanged: false,
            isDrivingFollow: false
        )
        #expect(top == false, "点状态栏回到顶部之后，新输出不该把读者拽回去")
    }

    /// 插值不冲过目标。
    ///
    /// 冲过去就是一次回弹，屏幕上比原来那记硬跳还糟。单调收敛是这条的性质本身，
    /// 顺带也钉住了「到位之后不会再来回修正」。
    @Test func theFollowStepNeverOvershoots() {
        var y: CGFloat = 0
        for _ in 0..<240 {
            let next = TerminalCollectionView.followStep(from: y, to: 400, seconds: 1.0 / 60)
            #expect(next >= y)
            #expect(next <= 400)
            y = next
        }
        #expect(abs(y - 400) < 1)
    }

    /// 同样的墙钟时间里走掉同样的距离：60 Hz 与 120 Hz 必须一样。
    ///
    /// 少了这一条，一个「每帧走固定比例」的实现也能让上面那条全绿 —— 而它在 120 Hz
    /// 手机上会把滑行缩短一半，同一个动作在两台设备上快慢不同。
    @Test func theFollowStepIsFrameRateIndependent() {
        var slow: CGFloat = 0
        for _ in 0..<30 { slow = TerminalCollectionView.followStep(from: slow, to: 400, seconds: 1.0 / 60) }
        var fast: CGFloat = 0
        for _ in 0..<60 { fast = TerminalCollectionView.followStep(from: fast, to: 400, seconds: 1.0 / 120) }

        #expect(abs(slow - fast) < 1)
    }

    /// 跟随时新输出到达，视口不一步跳过去。
    ///
    /// 这就是读者报的那一幕：输出一批一批地到，每一批都把视口硬拽到底，屏幕上每 125
    /// 毫秒跳一下。刚收到一帧的那一刻视口还在半路 —— 这一条断言的就是「还在半路」。
    @Test func newOutputGlidesInsteadOfJumping() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(0..<200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let window = inWindow(view)
        defer { view.removeFromSuperview(); window.isHidden = true }

        view.apply(rows: lines(0..<260), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()

        #expect(
            list.contentOffset.y < view.bottomOffsetY - 1,
            "新输出到的那一下视口就已经在底上了 —— 那是跳过去的"
        )
    }

    /// 滑行会自己走到位，不会停在半路。
    ///
    /// 上面那条只说「没有跳」，一个干脆不动、或者动一半就停的实现也能满足它。
    @Test func theGlideSettlesOnTheNewestLine() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(0..<200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let window = inWindow(view)
        defer { view.removeFromSuperview(); window.isHidden = true }

        view.apply(rows: lines(0..<260), atHistoryFloor: false, cursor: nil)
        // 等到它到位，或者判定它没到 —— 循环的判据要比断言严，否则会在「还差一点」
        // 的那一刻退出，然后拿这个「还差一点」当失败，而它其实还在收敛。（这一条
        // 第一版就是这么写的：循环用 > 1 退出、断言用 < 1，于是稳定地红。）
        let deadline = Date().addingTimeInterval(1.0)
        while Date() < deadline, abs(list.contentOffset.y - view.bottomOffsetY) > 0.5 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }

        // 半个点是上限，因为 `contentOffset` 只落在像素网格上（3x 屏是 1/3 点一格），而
        // 越接近目标步子越小 —— 小到不足一格时四舍五入会把这一步退回去，视口就停在离
        // 目标两格（2/3 点）的地方，永远到不了。
        #expect(abs(list.contentOffset.y - view.bottomOffsetY) < 0.5, "没有落到最底")
        #expect(abs((visibleFrame(ofRow: 259, in: list)?.maxY ?? 0) - list.bounds.height) < 1)
    }

    /// 安静下来之后，逐帧驱动器要自己停掉。
    ///
    /// 上面那条只说「落到底了」。一个永远停不下来的驱动器同样能让它绿 —— 而那是屏幕按
    /// 刷新率一直醒着，终端闲置一整天也一样。
    @Test func theFollowDriverStopsOnceItHasSettled() {
        let (view, list) = terminal(columns: 80, rows: 24)
        view.apply(rows: lines(0..<200), atHistoryFloor: false, cursor: nil)
        list.layoutIfNeeded()
        let window = inWindow(view)
        defer { view.removeFromSuperview(); window.isHidden = true }

        view.apply(rows: lines(0..<260), atHistoryFloor: false, cursor: nil)
        #expect(view.isFollowingPerFrame, "新输出到达时跟随没有起来")

        let deadline = Date().addingTimeInterval(1.5)
        while Date() < deadline, view.isFollowingPerFrame {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }

        #expect(!view.isFollowingPerFrame, "静下来之后驱动器还在按刷新率转")
    }

    /// 放大的画布不许画到画布区外面去。
    ///
    /// 放大是往整块画布上叠一个围绕中心的 `scale`，所以只要倍率过了 1，画布在四条边上就
    /// **一定**各自多出一截：那对偏移上限算的是"多出来多少"，它管的是别露出缝。视图不裁剪
    /// 的话这一截照画不误，于是顶栏（排在画布前面）与底部输入栏（排在后面）里只有上面看得
    /// 见 —— 读者看到的是一行终端字压在顶栏和状态栏上，底部却一切正常。
    ///
    /// 钉的是让溢出露不出来的那一句。放大之后的帧断言够不着：`zoom` 与画布那层视图都是私有
    /// 的，`UIPinchGestureRecognizer` 的 scale 也不接受外部驱动。
    @Test func theMagnifiedCanvasCannotDrawOutsideThePane() {
        let (view, _) = terminal(columns: 80, rows: 24)

        #expect(view.clipsToBounds, "画布溢出会盖到顶栏与状态栏上")
    }
}
