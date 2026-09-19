import SwiftUI
import UIKit

/// Renders terminal rows.
///
/// A collection view rather than a `Text` or a `UITextView`: terminal output is
/// append-heavy and unbounded, and only a collection view gives cheap appends,
/// recycled cells, and a scroll position that stays smooth as the buffer grows.
/// Every row is exactly one screen line tall, because wrapping happens in
/// `TerminalStore` before the data ever reaches the view.
struct TerminalTextView: UIViewRepresentable {
    let store: TerminalStore
    /// The size the reader's density asks for. In the desktop-grid mode the view
    /// scales it down to fit, so this is a starting point rather than the answer.
    let fontSize: CGFloat
    /// Which device's grid to lay the rows out for. The store owns the wrap; this
    /// is the same choice, passed down so the cell layout can follow it.
    let displayMode: TerminalDisplayMode
    /// The desktop's grid, absent until the first summary arrives.
    let desktopGrid: DesktopGrid?
    /// Bumped by the store on every applied frame; drives the snapshot.
    let revision: Int

    let onRequestHistory: () -> Void
    let onTap: () -> Void
    /// 手指开始在画布上拖了 —— 读历史也是"操作"。
    ///
    /// 单独报一条，是因为它是这一页上唯一一种**不产生触摸结束事件也算数**的操作：
    /// 拖到一半停住读两行，屏幕上看不出任何动静，而三秒的闲置计时照样在走。
    let onUserScroll: () -> Void

    func makeUIView(context: Context) -> TerminalCollectionView {
        let view = TerminalCollectionView()
        view.onWidthChanged = { [weak store] columns in
            store?.update(columns: columns)
        }
        view.onRowsChanged = { [weak store] rows in
            store?.reportVisibleRows(rows)
        }
        view.onRequestHistory = onRequestHistory
        view.onTap = onTap
        view.onUserScroll = onUserScroll
        view.applyLayout(displayMode: displayMode, desktopGrid: desktopGrid, fontSize: fontSize)
        return view
    }

    func updateUIView(_ view: TerminalCollectionView, context: Context) {
        view.applyLayout(displayMode: displayMode, desktopGrid: desktopGrid, fontSize: fontSize)
        view.apply(
            rows: store.rows,
            atHistoryFloor: store.reachedHistoryFloor,
            cursor: store.cursorPosition,
            resetRevision: store.resetRevision,
            renderRevision: store.renderRevision
        )
        view.setRequestsInFlight(store.isLoadingHistory)
    }
}

final class TerminalCollectionView: UIView, UICollectionViewDataSourcePrefetching {
    private var collectionView: UICollectionView!
    /// Identified by a `String` key rather than by `DisplayRow` itself. The project
    /// defaults to `MainActor` isolation, which makes a custom type's `Hashable`
    /// conformance unusable where the data source needs a `Sendable` identifier;
    /// a `String` sidesteps that and is a natural key anyway.
    private var dataSource: UICollectionViewDiffableDataSource<Int, String>!
    private var rowsByKey: [String: DisplayRow] = [:]
    private var fontSize: CGFloat = 12
    /// What the density asks for, kept so the fit can be recomputed when the pane
    /// resizes — a rotation changes how much of the desktop's grid fits.
    private var baseFontSize: CGFloat = 12
    /// Which grid the rows are laid out for. The store owns the wrap; this mirrors
    /// it so the cell layout and the scroll behaviour can follow.
    private var displayMode: TerminalDisplayMode = .phoneDriven
    private var desktopGrid: DesktopGrid?
    /// How much the canvas is magnified, in the desktop-grid mode only. Fitted is 1
    /// and it never goes below — shrinking past "the whole screen" would be a third
    /// mode nobody asked for.
    ///
    /// A scale on the container, not a size for the text. Re-laying every row out at
    /// a new font size as the finger moves makes the screen pop and reflow under the
    /// gesture; scaling one view makes the whole thing grow together, the way a photo
    /// does, and costs nothing per frame.
    private var zoom: CGFloat = 1
    /// Where the magnified canvas has been dragged to, in the pane's own coordinates.
    private var canvasOffset: CGPoint = .zero
    /// The view the zoom transform is applied to. Sits between this view and the
    /// collection view so the magnification is one transform over everything the
    /// terminal draws.
    private let canvas = UIView()
    /// Kept so it can be switched on only while the canvas is magnified — a pan that
    /// is always live would take drags away from the terminal's own scrolling.
    private var canvasPan: UIPanGestureRecognizer?
    /// The identities last handed to the data source. A row that holds the cursor
    /// has the cursor woven into its identity, so a cursor that moves — or blinks —
    /// is a change the diff can see for itself. That is what keeps this view off
    /// `reloadItems`, which asserts whenever the view and the data source disagree
    /// about which items exist.
    private var appliedKeys: [String] = []
    /// What those identities stand for, kept so the cursor can be re-keyed on a
    /// blink without waiting for new rows to arrive.
    private var appliedRows: [DisplayRow] = []
    private var isPinnedToBottom = true
    /// 一次拖动开始时的偏移。结束时与它比，才知道这次拖动**到底有没有让内容移动**
    /// —— 这正是"拖不动"要问的那个问题。
    private var dragStartOffsetY: CGFloat?
    /// 上一次记进日志的缩放值。`applyCanvasTransform` 跑得很勤，只有在**变化时**
    /// 记一条才有意义 —— 每次布局都记的话，日志里就只剩"没变化"。
    private var lastLoggedZoom: CGFloat = 1
    /// Set when the grid changes, so the view lands on the computer's current
    /// screen at once rather than waiting for the next frame to carry it there.
    ///
    /// A one-shot on top of the ordinary following, not instead of it: following
    /// applies whenever the reader is at the bottom, and a reader who has just been
    /// switched to another grid has not been anywhere yet.
    private var pendingLandingScroll = false
    /// The store revision this view last applied. `nil` until the first apply, so
    /// the view's own first paint is not mistaken for a buffer replacement.
    private var appliedResetRevision: Int?
    /// 上一次真正做过活时的那组「便宜令牌」。
    ///
    /// store 任何一次变更都会推进 `renderRevision`，所以这四样都没变就说明缓冲区、
    /// 光标、渲染尺寸一个都没动过 —— 而 `identities(...)` 要为每一行拼一个字符串
    /// （上限 6000，每行还要过一次选区）。`nil` 表示还没做过第一次。
    private var appliedRenderRevision: Int?
    private var appliedFontSize: CGFloat?
    /// 上一次真正作废过布局时的那组输入。
    ///
    /// `updateUIView` 每次都会调 `applyLayout`，而它在常态下（布局输入一个都没变）也会
    /// 走一遍 `invalidateLayout()` —— flow layout 一作废就要为**每一个** item 重求
    /// attributes，6000 行就是 6000 次 delegate 回调 + 6000 个 attributes，每帧一次。
    private struct LayoutInputs: Equatable {
        let mode: TerminalDisplayMode
        let grid: DesktopGrid?
        let base: CGFloat
        let size: CGSize
    }
    private var lastLayoutInputs: LayoutInputs?
    private var atHistoryFloor = false
    private var requestsInFlight = false
    /// Reports how many monospace columns fit, so the wrap matches the phone.
    var onWidthChanged: ((Int) -> Void)?
    /// Reports how many rows the pane shows. Only the phone can measure this, and it
    /// is what the desktop is asked to adopt in the phone-driven mode. Purely
    /// outbound: unlike the column count it changes nothing about how rows are laid
    /// out here.
    var onRowsChanged: ((Int) -> Void)?
    /// Asks for another page when the user reaches the top.
    var onRequestHistory: (() -> Void)?
    /// Tapping the terminal is how the keyboard is put away.
    var onTap: (() -> Void)?
    /// 手指压上来开始拖了。拖动期间没有别的信号能说明"人还在看"。
    var onUserScroll: (() -> Void)?
    private var reportedColumns = 0
    private var reportedRows = 0
    private var lastLayoutHeight: CGFloat = 0
    /// The pane size the fit was last computed against, so `layoutSubviews` can tell
    /// a real resize from the canvas being sized to the pane it already has.
    private var lastLaidOutPaneSize: CGSize = .zero
    private var appliedCursor: TerminalStore.CursorPosition?
    private var blinkTimer: Timer?
    /// Blink phase. The cursor is solid whenever blinking is off, so starting from
    /// `true` means Reduce Motion shows a steady block with no timer at all.
    private var cursorPhaseOn = true

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        buildCollectionView()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    /// Adopts the display mode, the desktop's grid and the density's font size as
    /// one layout.
    ///
    /// Together on purpose. They describe a single arrangement, and applying them
    /// separately would leave rows laid out for one grid measured with another's
    /// cell size.
    func applyLayout(
        displayMode mode: TerminalDisplayMode,
        desktopGrid grid: DesktopGrid?,
        fontSize base: CGFloat
    ) {
        let gridChanged = desktopGrid != grid || displayMode != mode
        displayMode = mode
        desktopGrid = grid
        baseFontSize = base
        // A pinned zoom was measured against a size that no longer applies; fitting
        // is the only predictable starting point.
        if gridChanged {
            zoom = 1
            canvasOffset = .zero
            // A selection is a run of rows and columns, and both just changed meaning:
            // the same numbers now name different characters. Left alone, the handles
            // stayed on screen pointing at nothing.
            clearSelection()
            // What the computer is showing now is the bottom of the buffer, so that
            // is where a reader arriving at this grid expects to be.
            pendingLandingScroll = true
        }

        let inputs = LayoutInputs(mode: mode, grid: grid, base: base, size: bounds.size)
        let target = renderedFontSize(base: base)
        if target != fontSize {
            fontSize = target
            lastLayoutInputs = inputs
            remeasureRows()
        } else if inputs != lastLayoutInputs {
            // 只有布局输入真的变了才作废。这一条在此之前是**无条件**执行的，而
            // `updateUIView` 每次都调 `applyLayout` —— 于是每一帧都要让 flow layout
            // 为每一个 item 重求一次 attributes（上限 6000 行）。
            lastLayoutInputs = inputs
            applyCanvasLayout()
            collectionView.collectionViewLayout.invalidateLayout()
        }
        reportColumnsIfNeeded()
    }


    /// Re-measures every row at the current size.
    ///
    /// Rebuilt rather than patched: the row cache is keyed by content, and a size
    /// change alters every key whether or not the text moved. The cursor is drawn
    /// solid afterwards rather than left at whatever phase the blink happened to be.
    private func remeasureRows() {
        appliedKeys = []
        appliedRows = []
        rowsByKey.removeAll()
        cursorPhaseOn = true
        applyCanvasLayout()
        collectionView.collectionViewLayout.invalidateLayout()
    }

    /// The size cells are actually drawn at.
    ///
    /// The reader's density in the phone-driven mode, where it is a real choice:
    /// there the pane's width is the wrap, so the density decides how much fits
    /// across it.
    ///
    /// In the desktop-grid mode there is nothing to choose. The columns are the
    /// computer's and the whole screen has to fit, which leaves the cell exactly one
    /// size — the largest the pane holds it at. That is why the density picker is
    /// not offered there: it would be a control wired to nothing.
    private func renderedFontSize(base: CGFloat) -> CGFloat {
        guard displayMode == .desktopDriven, let grid = desktopGrid else { return base }
        return fittedFontSize(for: grid)
    }

    /// The computer's grid, drawn as large as the pane holds it.
    ///
    /// Measured against the default reading size rather than the reader's. That is
    /// not a preference being applied on the quiet: it is a ruler. What comes out is
    /// a ratio between the grid and the pane, so the size it is measured at cancels
    /// — the one place it survives is the row box's own rounding to whole points,
    /// and there by a fraction of one.
    ///
    /// Asking twice gives the same answer as asking once, because the reference is a
    /// constant rather than the size currently drawn at.
    private func fittedFontSize(for grid: DesktopGrid) -> CGFloat {
        let reference = TerminalDensity.normal.fontSize
        let scale = terminalGridFitScale(
            grid: grid,
            paneSize: bounds.size,
            contentInset: TerminalCellMetrics.contentInset,
            cellSize: CGSize(
                width: TerminalCellMetrics.advance(forFontSize: reference),
                height: TerminalCellMetrics.rowHeight(forFontSize: reference)
            )
        )
        // Rounded to a tenth of a point, not to a whole one. A whole point is seven
        // per cent of a fourteen-point cell, and across a hundred-odd columns that
        // leaves the grid some fifty points narrower than the pane — which shows up
        // as a margin down both sides of a screen that is meant to be filled edge to
        // edge. Truncated rather than rounded so the grid can only ever come out
        // narrower, never wider than the space it was fitted into.
        return max(1, (reference * scale * 10).rounded(.down) / 10)
    }

    /// Magnifies the canvas, or puts it back.
    ///
    /// One transform over the whole container, so everything the terminal draws —
    /// rows, padding, the cursor — grows together and nothing reflows under the
    /// finger. While it is magnified the collection view stops scrolling, because
    /// a drag is then about where in the screen the reader is looking rather than
    /// where in the buffer.
    /// Sizes the canvas without touching its transform.
    ///
    /// `frame` is derived from `bounds`, `center` and `transform`, so assigning it on
    /// a view that is already transformed makes UIKit recompute the other three from
    /// it — and the zoom is silently undone. That is why a drag moved the offset by a
    /// hundred and seventy points and the picture did not move at all.
    private func sizeCanvas(to size: CGSize) {
        canvas.bounds = CGRect(origin: .zero, size: size)
        canvas.center = CGPoint(x: size.width / 2, y: size.height / 2)
    }

    private func applyCanvasTransform() {
        let magnified = zoom > 1.001
        let scrollWasEnabled = collectionView.isScrollEnabled
        collectionView.isScrollEnabled = !magnified
        canvasPan?.isEnabled = magnified

        // 第二条成因就在这里：放大之后滚动被主动关掉，拖动改成拖画布。记的是
        // **关掉的那一刻**连同它之前的状态 —— 只看放大后的截图看不出滚动还会不会动。
        if abs(zoom - lastLoggedZoom) > 0.001 {
            DiagnosticLog.record(.terminalZoomChanged, [
                .init(.zoomFrom, .scalar(Double(lastLoggedZoom))),
                .init(.zoomTo, .scalar(Double(zoom))),
                .init(.isScrollEnabled, .bool(collectionView.isScrollEnabled)),
                .init(.wasPinned, .bool(scrollWasEnabled)),
                .init(.cvPanEnabled, .bool(collectionView.panGestureRecognizer.isEnabled)),
                .init(.canvasPanEnabled, .bool(canvasPan?.isEnabled ?? false)),
                .init(.offsetY, .scalar(Double(collectionView.contentOffset.y))),
                .init(.displayMode, .flag(displayMode == .desktopDriven ? .desktopDriven : .phoneDriven)),
            ])
            lastLoggedZoom = zoom
        }
        guard displayMode == .desktopDriven else {
            canvas.transform = .identity
            collectionView.isScrollEnabled = true
            return
        }
        // Scaling is about the canvas's centre, so the content overhangs each edge by
        // this much and the drag has that far to travel before it would show a gap.
        let slackX = (bounds.width * (zoom - 1)) / 2
        let slackY = (bounds.height * (zoom - 1)) / 2
        canvasOffset.x = max(-slackX, min(slackX, canvasOffset.x))
        canvasOffset.y = max(-slackY, min(slackY, canvasOffset.y))
        canvas.transform = CGAffineTransform(translationX: canvasOffset.x, y: canvasOffset.y)
            .scaledBy(x: zoom, y: zoom)
    }

    /// Sizes the canvas and re-applies the zoom.
    ///
    /// It used to *place the grid* as well, as a picture inside a box exactly one
    /// desktop screen tall: centred on both axes, with the margins that implies.
    /// The box was a fiction. The rows this view is handed are the whole buffer, not
    /// one screen, so the "margin" was padding inserted at the one place a reader
    /// never sits — the head of the buffer — while the centring only ever applied to
    /// a session whose output had not yet filled the pane. Past that it padded a
    /// scroll range that made the picture scrollable before it was full, which is
    /// what "at the bottom" then meant, and why following the newest line had to be
    /// switched off here to stop the twitch that came of it.
    ///
    /// A terminal is not a photograph. Its text starts at the top left, its newest
    /// line sits on the bottom edge, and this pane is simply a window of the
    /// computer's width onto the buffer. There is nothing to place: no inset, on
    /// either axis. The row carries the one cell of padding its own text sits in.
    private func applyCanvasLayout() {
        sizeCanvas(to: bounds.size)
        applyCanvasTransform()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // A resize changes how much of the desktop's grid fits, so the fitted size
        // is recomputed before anything lays out with the old one.
        //
        // Only when the pane's own size actually changed. Re-measuring the rows is
        // itself a layout-affecting change, so doing this on every pass makes the
        // two call each other: a continuous redraw, which the reader sees as the
        // text flickering while they are trying to read it.
        sizeCanvas(to: bounds.size)
        let paneSize = bounds.size
        if displayMode == .desktopDriven, desktopGrid != nil, paneSize != lastLaidOutPaneSize {
            lastLaidOutPaneSize = paneSize
            let target = renderedFontSize(base: baseFontSize)
            if target != fontSize {
                fontSize = target
                remeasureRows()
            } else {
                applyCanvasLayout()
            }
        }
        reportColumnsIfNeeded()
        // Before the size change is acted on, because the inset is part of what the
        // newest line's position is made of — see `updateBottomInset`.
        updateBottomInset()
        // The keyboard appearing shrinks this view. Nothing new was appended, so
        // no snapshot runs — without this the newest output would slide below the
        // fold and the user would have to scroll to find it.
        //
        // The desktop-grid mode included. It was excluded while the grid was
        // centred inside a one-screen box: there, pinning scrolled the top of the
        // picture off, which is the opposite of showing one whole screen. With the
        // box gone, staying with the newest line means the same thing in both modes.
        //
        // This and `updateBottomInset` answer two different questions and both are
        // needed: this one is about a buffer taller than the pane, that one about a
        // buffer shorter than it. A pane can only be in one of the two states, so
        // one of them does nothing every time.
        if bounds.height != lastLayoutHeight {
            lastLayoutHeight = bounds.height
            if isPinnedToBottom { scrollToBottom(trigger: .layoutResize) }
        }
    }

    /// Puts the output against the bottom edge while it is shorter than the pane.
    ///
    /// A terminal fills its window from the top left, so a buffer holding less than a
    /// screenful leaves the unused space *below* its last line. That space is what a
    /// keyboard eats into when one comes up, which is why the newest line of a session
    /// that had only just started slid out of sight and had to be scrolled back to. An
    /// inset of exactly what is left over moves the content down to the bottom edge
    /// instead, where the newest line already is, and leaves nothing beneath it to be
    /// taken away.
    ///
    /// Zero the moment the rows fill the pane: there is nothing left over to push, and
    /// from there the ordinary scrolling behaviour above is what carries the reader.
    ///
    /// Written only when it changes. Assigning `contentInset` lays the collection view
    /// out again, so an unconditional write would have `layoutSubviews` and this taking
    /// turns for as long as the screen is up.
    private func updateBottomInset() {
        // A row change that has not been laid out yet leaves the `contentSize` of the
        // previous one behind, and the inset would be measured from that.
        collectionView.layoutIfNeeded()
        let inset = max(0, collectionView.bounds.height - collectionView.contentSize.height)
        guard abs(inset - collectionView.contentInset.top) > 0.5 else { return }
        collectionView.contentInset.top = inset
        // An inset moves the range the offset is measured in, not the offset itself, so
        // on its own it would leave the content at the head of the range. Only while the
        // reader is at the bottom: an inset only ever changes on content too short to
        // have a scroll position to be partway through in the first place.
        if isPinnedToBottom { scrollToBottom(trigger: .insetChanged) }
    }

    /// The desktop wraps at its own width; only the phone knows how wide the
    /// phone is, so the column count is measured here and pushed to the store.
    private func reportColumnsIfNeeded() {
        guard fontSize > 0 else { return }

        // Decided here, and only here. The store wraps at whatever it is told, so a
        // second opinion about it — one the store used to hold — is how the rows and
        // the boxes around them came apart.
        let columns = terminalWrapColumns(
            displayMode: displayMode,
            desktopGrid: desktopGrid,
            paneWidth: bounds.width,
            fontSize: fontSize
        )
        if columns != reportedColumns {
            reportedColumns = columns
            onWidthChanged?(columns)
        }

        let rows = TerminalCellMetrics.rows(
            fitting: bounds.height,
            cellHeight: TerminalRowCell.rowHeight(for: fontSize)
        )
        if rows != reportedRows {
            reportedRows = rows
            onRowsChanged?(rows)
        }
    }

    /// - Parameter resetRevision: the store's count of buffers that were replaced
    ///   outright rather than amended. Read before the early return below, so a
    ///   replacement is not consumed by a frame that happened to change nothing.
    func apply(
        rows: [DisplayRow],
        atHistoryFloor: Bool,
        cursor: TerminalStore.CursorPosition?,
        resetRevision: Int = 0,
        renderRevision: Int? = nil
    ) {
        // 什么都没动过就直接出去 —— 这一条必须排在 `identities(...)` **前面**：那个
        // 函数要为每一行拼一个字符串（上限 6000，每行还要过一次选区），而它原来排在
        // 最前面，只有 `keys != appliedKeys` 那个更便宜的判断在它后面。
        //
        // 而这个视图在**每一次祖先重渲染**时都会被走到：表示层那几个闭包每次 `body`
        // 都新建、不可比较，SwiftUI 没法把这一层当成没变。「什么都没变」因此是常态，
        // 不是例外。
        //
        // store 的任何一次变更都会推进 `renderRevision`，所以它加上光标、渲染尺寸、
        // 替换与地面标记足以判定「没变」。
        //
        // **传 `nil` 就永远不跳过。** 没有修订号可用的调用方（测试直接驱动这个视图时
        // 就是这样）不能因为一个它根本不掌握的号码而被挡在门外 —— 那会把「该做的事」
        // 跳掉，而不是省下它。
        let revisionSaysNothingChanged = renderRevision.map { $0 == appliedRenderRevision } ?? false
        guard !(revisionSaysNothingChanged
                && cursor == appliedCursor
                && atHistoryFloor == self.atHistoryFloor
                && resetRevision == appliedResetRevision
                && fontSize == appliedFontSize)
        else { return }

        // Nil until this view has applied something, so its very first paint is
        // never read as a replacement — it lands on the newest line by the same
        // rule every other first paint uses.
        let bufferReplaced = appliedResetRevision.map { $0 != resetRevision } ?? false
        appliedResetRevision = resetRevision
        appliedRenderRevision = renderRevision
        appliedFontSize = fontSize

        let keys = identities(for: rows, cursor: cursor)
        let floorChanged = atHistoryFloor != self.atHistoryFloor
        let rowsChanged = keys != appliedKeys
        guard rowsChanged || floorChanged else { return }

        // 第三条成因的判据：**手上到底有没有可滚的行**。
        // `contentSizeHeight <= boundsHeight` 就是"拖上去也没东西可滚"，而它和
        // "手势被吞了"在屏幕上完全一样。
        DiagnosticLog.record(.terminalRows, [
            .init(.rowCount, .int(rows.count)),
            .init(.atHistoryFloor, .bool(atHistoryFloor)),
            .init(.cellHeight, .scalar(Double(TerminalRowCell.rowHeight(for: fontSize)))),
            .init(.contentSizeHeight, .scalar(Double(collectionView.contentSize.height))),
            .init(.boundsHeight, .scalar(Double(collectionView.bounds.height))),
            .init(.contentInsetTop, .scalar(Double(collectionView.contentInset.top))),
        ])

        let cursorMoved = cursor != appliedCursor
        // A cursor that has just landed is drawn solid, whatever phase the blink
        // was in — so the phase is settled *before* the rows are keyed. Settling it
        // afterwards would leave a freshly typed cursor invisible until the next
        // tick, which reads as the cursor vanishing mid-keystroke.
        if cursorMoved { cursorPhaseOn = true }
        appliedCursor = cursor
        self.atHistoryFloor = atHistoryFloor
        let wasAtBottom = isPinnedToBottom
        let previousFirstId = appliedRows.first?.id

        // Loading a page inserts rows *above* the viewport. Without compensating,
        // the content jumps by the height of the inserted page every time.
        let insertedAbove: Int
        if let previousFirstId, let newIndex = rows.firstIndex(where: { $0.id == previousFirstId }) {
            insertedAbove = newIndex
        } else {
            insertedAbove = 0
        }
        let offsetBefore = collectionView.contentOffset.y

        push(rows: rows, keys: keys)
        // New rows change how much is left over, so the inset is measured again before
        // anything below decides where the viewport goes.
        updateBottomInset()

        if bufferReplaced {
            // The whole buffer is new, so there is no "before" to preserve: whatever
            // row this view was anchored on may be a different line that merely kept
            // its identity, and the offset it implies is meaningless. Landing on the
            // newest line is the only answer that is right — the reader asked for
            // this terminal, not for the piece of it this view happened to be holding.
            pendingLandingScroll = false
            scrollToBottom(trigger: .reset)
        } else if insertedAbove > 0 {
            collectionView.contentOffset.y = offsetBefore
                + CGFloat(insertedAbove) * TerminalRowCell.rowHeight(for: fontSize)
        } else if pendingLandingScroll {
            pendingLandingScroll = false
            scrollToBottom(trigger: .landingScroll)
        } else if wasAtBottom {
            // Both modes, because both are a terminal: a reader sitting on the
            // newest line is watching output arrive, and a pane that stops at the
            // line it was showing when they last touched it is not showing them
            // the computer's screen — it is showing them a screenshot of it.
            //
            // The desktop-grid mode used to be excluded here. The reason was real
            // at the time: content shorter than the one-screen box was still
            // "scrollable" by the box's own padding, so following the tail moved
            // the picture on every frame and the reader saw it twitch. That padding
            // is gone, so content that fits cannot be scrolled at all and this is a
            // no-op until there is genuinely more to follow.
            scrollToBottom(trigger: .contentGrew)
        }
        if floorChanged {
            collectionView.collectionViewLayout.invalidateLayout()
        }
        // The blink restarts with every move, so the block is solid exactly when
        // the cursor lands and only then begins to blink.
        if cursorMoved {
            startBlinkTimer()
        }
    }

    /// Hands `rows` to the data source under `keys`.
    ///
    /// The cursor is part of those identities rather than a reload performed after
    /// the fact, so every change — output, a cursor move, a blink — reaches the
    /// collection view through the one mechanism that keeps the two in step.
    private func push(rows: [DisplayRow], keys: [String]) {
        appliedKeys = keys
        appliedRows = rows
        rowsByKey = Dictionary(uniqueKeysWithValues: zip(keys, rows))

        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(keys, toSection: 0)
        // No animation: frames arrive far faster than an animation could finish,
        // and animating each one would make scrolling feel like it is lagging.
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    /// The identity each row is handed to the data source under.
    ///
    /// Normally the row's own id. The row the cursor sits on gets the cursor woven
    /// in, which makes moving it a change the diff reports instead of one this view
    /// has to force — the two rows involved are the only ones that need rebuilding.
    private func identities(for rows: [DisplayRow], cursor: TerminalStore.CursorPosition?) -> [String] {
        Self.identities(
            for: rows,
            cursor: cursor,
            cursorVisible: cursorPhaseOn,
            selection: selection,
            fontSize: fontSize
        )
    }

    /// Static and parameterised on the blink phase so both halves of the property
    /// below can be asserted without a collection view.
    static func identities(
        for rows: [DisplayRow],
        cursor: TerminalStore.CursorPosition?,
        cursorVisible: Bool,
        selection: TerminalSelection? = nil,
        fontSize: CGFloat? = nil
    ) -> [String] {
        rows.enumerated().map { index, row in
            identity(
                for: row,
                at: index,
                cursor: cursor,
                cursorVisible: cursorVisible,
                selection: selection,
                fontSize: fontSize
            )
        }
    }

    /// 一行的标识符。整套方案只在这一处，好让「只换一行」那条快路和整份重建算出来
    /// 的东西逐字一致。
    ///
    /// 方案本身没动：尺寸、光标相位、选区都织在这里，行的内容由 `row.id` 自带。
    static func identity(
        for row: DisplayRow,
        at index: Int,
        cursor: TerminalStore.CursorPosition?,
        cursorVisible: Bool,
        selection: TerminalSelection? = nil,
        fontSize: CGFloat? = nil
    ) -> String {
        var key = row.id
        // The size a row is drawn at is part of its identity, for the same
        // reason the cursor is. A row identifier carries the text, and the text
        // does not change when the size does — so without this the diff sees no
        // change, leaves the rows already on screen drawn at the old size, and
        // the reader gets a band of differently-sized text that only corrects
        // itself once those rows scroll away and come back.
        if let fontSize { key += "#size:\(fontSize)" }
        if cursorVisible, let cursor, cursor.rowIndex == index {
            key += "#cursor:\(cursor.column)"
        }
        // Woven in the same way the cursor is: a row that is partly selected
        // looks different, and the diff has to be able to see that without
        // comparing text.
        if let columns = selection?.columns(onRow: index) {
            key += "#sel:\(columns.lowerBound)-\(columns.upperBound)"
        }
        return key
    }

    func setRequestsInFlight(_ inFlight: Bool) {
        requestsInFlight = inFlight
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // A timer that outlives the screen would keep waking the app for nothing.
        guard window != nil else {
            stopBlinking()
            return
        }
        // Leaving and coming back starts the cursor solid again. Only a blink that
        // was caught mid-off has anything to redraw, so the ordinary appearance
        // pushes nothing at all.
        let wasHidden = !cursorPhaseOn
        cursorPhaseOn = true
        if wasHidden {
            push(rows: appliedRows, keys: identities(for: appliedRows, cursor: appliedCursor))
        }
        startBlinkTimer()
    }

    /// Blinks the cursor. With Reduce Motion on the block simply stays solid —
    /// visible, it just does not move — which is why this is the only place that
    /// decides whether a timer is needed at all.
    private func startBlinkTimer() {
        stopBlinking()
        guard appliedCursor != nil, !UIAccessibility.isReduceMotionEnabled else { return }
        blinkTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.advanceCursorPhase()
            }
        }
    }

    private func stopBlinking() {
        blinkTimer?.invalidate()
        blinkTimer = nil
    }

    private func advanceCursorPhase() {
        guard let cursor = appliedCursor, !appliedRows.isEmpty else {
            stopBlinking()
            return
        }
        cursorPhaseOn.toggle()
        // 光标那一行已经滚出屏幕时什么都不做。它看不见，而下面那一次改动在缓冲区长的
        // 终端上（上限 6000 行）每 0.5 秒都要重来一遍。
        guard isOnScreen(cursor.rowIndex) else { return }
        // The row's identity carries the phase, so this is an ordinary diff of the
        // rows already on screen — no reload, and no new rows to lay out.
        pushOneRow(at: cursor.rowIndex, row: appliedRows[cursor.rowIndex])
    }

    /// 这一行现在在可视区里吗。
    private func isOnScreen(_ index: Int) -> Bool {
        guard index >= 0, index < appliedKeys.count else { return false }
        return collectionView.indexPathsForVisibleItems.contains(IndexPath(item: index, section: 0))
    }

    /// 只换一行的标识符。
    ///
    /// 用于光标闪的那一下 —— 变的只有光标所在的那一行。`push` 那条路要重建整份
    /// `rowsByKey`（上限 6000 个长字符串做 key，每个都得哈希一遍），在闪这件事上纯属
    /// 白做。标识符本身仍由 `Self.identity` 算，所以快路和整份重建算出来的逐字一致。
    private func pushOneRow(at index: Int, row: DisplayRow) {
        guard index >= 0, index < appliedKeys.count, index < appliedRows.count else { return }
        let key = Self.identity(
            for: row,
            at: index,
            cursor: appliedCursor,
            cursorVisible: cursorPhaseOn,
            selection: selection,
            fontSize: fontSize
        )
        let previous = appliedKeys[index]
        guard previous != key else { return }
        appliedKeys[index] = key
        rowsByKey.removeValue(forKey: previous)
        rowsByKey[key] = row

        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(appliedKeys, toSection: 0)
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    /// The column the cursor occupies on a given row, or nil when it is elsewhere
    /// or the blink is in its off phase.
    private func cursorColumn(forRowAt index: Int) -> Int? {
        guard cursorPhaseOn, appliedCursor?.rowIndex == index else { return nil }
        return appliedCursor?.column
    }

    /// 把视口拉回最新一行。
    ///
    /// `trigger` 只在诊断里有意义：它是把"用户自己拖的"和"我们把他拽回去的"分开的
    /// 唯一依据。滚不动那类报告里，这两件事在屏幕上长得一模一样。
    func scrollToBottom(trigger: DiagnosticFlag = .unknownCause) {
        guard !appliedKeys.isEmpty else { return }
        let offsetBefore = collectionView.contentOffset.y
        let last = IndexPath(item: appliedKeys.count - 1, section: 0)
        collectionView.scrollToItem(at: last, at: .bottom, animated: false)
        isPinnedToBottom = true

        let offsetAfter = collectionView.contentOffset.y
        // 只记**真的挪动了视口**的那一次。每帧都跟着最新输出跑的时候它是个空操作，
        // 把空操作也记下来，日志会被"什么也没发生"灌满。
        guard abs(offsetAfter - offsetBefore) > 0.5 else { return }
        DiagnosticLog.record(.terminalFollowGrab, [
            .init(.trigger, .flag(trigger)),
            .init(.offsetBefore, .scalar(Double(offsetBefore))),
            .init(.offsetAfter, .scalar(Double(offsetAfter))),
            .init(.contentSizeHeight, .scalar(Double(collectionView.contentSize.height))),
            .init(.boundsHeight, .scalar(Double(collectionView.bounds.height))),
            .init(.isPinnedToBottom, .bool(isPinnedToBottom)),
        ])
    }

    private func buildCollectionView() {
        let layout = UICollectionViewFlowLayout()
        layout.minimumLineSpacing = 0
        layout.minimumInteritemSpacing = 0
        layout.sectionInset = .zero
        layout.scrollDirection = .vertical

        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        collectionView.alwaysBounceVertical = true
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.keyboardDismissMode = .interactive
        // The collection view fills the pane exactly, and the pane's own geometry is
        // what the fit, the canvas and the reported row count are measured against.
        // Letting UIKit apply safe-area insets as well would move the newest line up
        // off the bottom edge by an amount that varies with the device, and no part
        // of that arithmetic would know about it.
        collectionView.contentInsetAdjustmentBehavior = .never
        collectionView.register(TerminalRowCell.self, forCellWithReuseIdentifier: TerminalRowCell.reuseIdentifier)
        collectionView.register(
            TerminalHeaderView.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader,
            withReuseIdentifier: TerminalHeaderView.reuseIdentifier
        )
        // A stable handle for UI tests; also what VoiceOver announces the region as.
        collectionView.accessibilityIdentifier = "terminal.text"

        // Frame-based, because a transformed view is positioned by its frame and not
        // by constraints; the collection view inside it is laid out normally.
        canvas.backgroundColor = .clear
        canvas.translatesAutoresizingMaskIntoConstraints = true
        addSubview(canvas)
        canvas.addSubview(collectionView)

        NSLayoutConstraint.activate([
            collectionView.leadingAnchor.constraint(equalTo: canvas.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: canvas.trailingAnchor),
            collectionView.topAnchor.constraint(equalTo: canvas.topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: canvas.bottomAnchor),
        ])

        dataSource = UICollectionViewDiffableDataSource<Int, String>(
            collectionView: collectionView
        ) { [weak self] collectionView, indexPath, key in
            let cell = collectionView.dequeueReusableCell(
                withReuseIdentifier: TerminalRowCell.reuseIdentifier,
                for: indexPath
            ) as! TerminalRowCell
            if let row = self?.rowsByKey[key] {
                cell.configure(
                    row: row,
                    fontSize: self?.fontSize ?? 14,
                    cursorColumn: self?.cursorColumn(forRowAt: indexPath.item),
                    selection: self?.selection?.columns(onRow: indexPath.item)
                )
            }
            return cell
        }
        dataSource.supplementaryViewProvider = { [weak self] collectionView, kind, indexPath in
            guard kind == UICollectionView.elementKindSectionHeader else { return nil }
            let header = collectionView.dequeueReusableSupplementaryView(
                ofKind: kind,
                withReuseIdentifier: TerminalHeaderView.reuseIdentifier,
                for: indexPath
            ) as! TerminalHeaderView
            header.configure(atFloor: self?.atHistoryFloor ?? false)
            return header
        }
        // Tapping the terminal puts the keyboard away. `cancelsTouchesInView`
        // stays false so scrolling and cell interaction still work.
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        tap.cancelsTouchesInView = false
        collectionView.addGestureRecognizer(tap)

        // Pinching changes the font size rather than scaling the view. Text stays
        // crisp at any size, the collection view keeps its own scrolling and cell
        // recycling, and the fitting arithmetic stays the only thing deciding how
        // big a cell is. A transform would put a second, competing scale on top of
        // all three.
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch))
        // The collection view's own pan answers the same two fingers, and by default
        // it wins — which is why magnifying the grid did nothing at all. They are
        // different questions about the same gesture: one is how big the grid is,
        // the other is where in it the reader is looking.
        pinch.delegate = self
        collectionView.addGestureRecognizer(pinch)

        let canvasPan = UIPanGestureRecognizer(target: self, action: #selector(handleCanvasPan))
        canvasPan.isEnabled = false
        self.canvasPan = canvasPan
        collectionView.addGestureRecognizer(canvasPan)

        // Half a second of holding still is how iOS says "select". `allowableMovement`
        // is what keeps that from swallowing an ordinary flick: past it this gesture
        // fails and the collection view's own pan takes over, so a press that was
        // really a scroll never becomes a selection.
        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress))
        longPress.minimumPressDuration = TerminalDisplayConfig.selectionHoldSeconds
        longPress.allowableMovement = TerminalDisplayConfig.selectionDriftTolerance
        collectionView.addGestureRecognizer(longPress)

        // Attached to this view rather than to the collection view: the handles are
        // placed in this coordinate space and must not scroll away with the content.
        selectionOverlay.attach(to: self)

        collectionView.dataSource = dataSource
        collectionView.delegate = self
    }

    @objc private func handleTap() {
        // Tapping anywhere but the selection drops it, which is what dismisses the
        // edit menu too.
        clearSelection()
        onTap?()
    }

    /// Whether this pinch has already been told it has run out of room.
    ///
    /// Per gesture, not per frame: the clamp is true on every callback while a finger
    /// is held at the limit, and a buzz that repeats at 60Hz is not feedback.
    private var pinchAtLimit = false

    /// Magnifies the desktop's grid past the fit.
    ///
    /// Only where there is something to magnify: the phone-driven mode is already at
    /// the size the reader chose, and widening it further is a different promise than
    /// the one that mode makes. The zoom is a multiple of the fitted size, so it
    /// means the same thing after a rotation as before one.
    @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
        guard displayMode == .desktopDriven, desktopGrid != nil else { return }
        // Identified before anything is scaled, so one pinch is one gesture from its
        // first callback to its last.
        if gesture.state == .began || gesture.state == .ended || gesture.state == .cancelled {
            pinchAtLimit = false
            return
        }
        guard gesture.state == .changed else { return }

        let proposed = zoom * gesture.scale
        let clamped = min(TerminalDisplayConfig.maxZoom, max(TerminalDisplayConfig.minZoom, proposed))
        // Asked for a size the canvas does not have. Felt at the moment the gesture
        // first runs out of room; after that it simply stops following the fingers,
        // which the fingers already know.
        if abs(clamped - proposed) > 0.0001, !pinchAtLimit {
            pinchAtLimit = true
            Haptics.warning()
        }
        guard abs(clamped - zoom) > 0.001 else { return }

        // Magnified about the fingers, not about the middle of the pane.
        //
        // The transform scales around the canvas's centre, and a terminal puts its
        // content at the top — so scaling about the centre throws the very line the
        // reader is looking at off the screen the moment they pinch, which reads as
        // the zoom having lost their place. This keeps the point under the fingers
        // under the fingers, which is what a photo viewer does.
        let focal = gesture.location(in: self)
        let previous = zoom
        zoom = clamped
        let ratio = zoom / previous
        let fromCentre = CGPoint(x: focal.x - bounds.midX, y: focal.y - bounds.midY)
        canvasOffset.x = fromCentre.x - ratio * (fromCentre.x - canvasOffset.x)
        canvasOffset.y = fromCentre.y - ratio * (fromCentre.y - canvasOffset.y)
        // Reset each step so the next callback reports an incremental change rather
        // than the whole gesture again.
        gesture.scale = 1
        // Nothing is re-measured and no row is laid out again: the scale is a
        // transform on one view, which is what makes the magnification follow the
        // fingers instead of jumping to a new size and leaving the reader somewhere
        // else in the buffer.
        applyCanvasTransform()
    }

    /// Drags the magnified canvas.
    ///
    /// Enabled only while magnified. At the fit there is nothing to move, and the
    /// drag belongs to the terminal's own scrolling.
    @objc private func handleCanvasPan(_ gesture: UIPanGestureRecognizer) {
        guard displayMode == .desktopDriven, zoom > 1.001 else { return }
        guard gesture.state == .changed else { return }

        let delta = gesture.translation(in: self)
        gesture.setTranslation(.zero, in: self)
        canvasOffset.x += delta.x
        canvasOffset.y += delta.y
        applyCanvasTransform()
    }

    // MARK: - Selection

    /// The reader's current selection, or nil when there is none.
    ///
    /// It lives here rather than in the store because it is a fact about what is on
    /// screen — a row index means nothing to a buffer that keeps re-wrapping.
    private var selection: TerminalSelection?
    private let selectionOverlay = TerminalSelectionOverlay()
    /// The edit menu currently up, kept so it can be torn down when it closes.
    private var editMenu: UIEditMenuInteraction?

    /// Where a point lands on the grid, in the units the selection is built from:
    /// display rows, and characters within one.
    private func gridPosition(at point: CGPoint) -> TerminalSelection.Position? {
        guard let indexPath = collectionView.indexPathForItem(at: point),
              let cell = collectionView.cellForItem(at: indexPath)
        else { return nil }
        let advance = TerminalCellMetrics.advance(forFontSize: fontSize)
        guard advance > 0 else { return nil }
        let offset = point.x - cell.frame.minX - TerminalCellMetrics.contentInset
        // Clamped rather than rejected: a finger that has run past the end of a row
        // is still selecting that row's last character, not nothing.
        let column = max(0, Int(offset / advance))
        return TerminalSelection.Position(row: indexPath.item, column: column)
    }

    /// The cell a position points at, in this view's coordinates.
    ///
    /// This is what the loupe centres on, so it is what the reader sees magnified —
    /// the cell the selection has reached, which stops matching the finger as soon
    /// as the finger leaves the row.
    private func caretRect(for position: TerminalSelection.Position) -> CGRect {
        let advance = TerminalCellMetrics.advance(forFontSize: fontSize)
        let height = TerminalRowCell.rowHeight(for: fontSize)
        let indexPath = IndexPath(item: position.row, section: 0)
        guard let attributes = collectionView.collectionViewLayout
            .layoutAttributesForItem(at: indexPath) else {
            return .null
        }
        return CGRect(
            x: attributes.frame.minX + TerminalCellMetrics.contentInset
                + CGFloat(position.column) * advance - collectionView.contentOffset.x,
            y: attributes.frame.minY - collectionView.contentOffset.y,
            width: advance,
            height: height
        )
    }

    /// Puts the handles on the selection's two ends and redraws the tinted rows.
    private func refreshSelection() {
        // Nothing on screen to re-key yet. Rebuilding the snapshot from an empty list
        // is not "nothing changed" — it is an empty snapshot, and applying it wipes
        // the view. The next frame renders everything with the selection already in
        // its identity, so skipping here loses nothing.
        guard !appliedRows.isEmpty else { return }
        guard let selection else {
            selectionOverlay.hide()
            return
        }
        let height = TerminalRowCell.rowHeight(for: fontSize)
        let start = caretRect(for: selection.start)
        let end = caretRect(for: selection.end)
        selectionOverlay.layout(
            start: CGRect(x: start.minX, y: start.minY, width: height, height: height),
            end: CGRect(x: end.maxX, y: end.minY, width: height, height: height)
        )
        // Re-keyed rather than reloaded: the selection is part of a row's identity,
        // so the diff applies the tint the same way it applies the cursor.
        push(rows: appliedRows, keys: identities(for: appliedRows, cursor: appliedCursor))
    }

    private func clearSelection() {
        guard selection != nil else { return }
        selection = nil
        refreshSelection()
    }

    /// Starts a selection at a point, with the loupe already up.
    private func beginSelection(at point: CGPoint) {
        guard let position = gridPosition(at: point) else { return }
        selection = TerminalSelection(at: position)
        // Nothing is selected yet, so the reader is about to drag: scrolling must
        // not answer the same finger.
        collectionView.isScrollEnabled = false
        // 这一行是"滚不动"的第四个成因：长按半秒以上、漂移不超过十点，拖动就变成了
        // 扩选而不是滚动，而屏幕上只多了一小块选中色。
        DiagnosticLog.record(.terminalSelection, [
            .init(.selectionPhase, .flag(.began)),
            .init(.anchorRow, .int(position.row)),
            .init(.anchorColumn, .int(position.column)),
            .init(.isScrollEnabled, .bool(collectionView.isScrollEnabled)),
        ])
        Haptics.selectionBegin()
        selectionOverlay.beginLoupe(
            at: point,
            caretRect: caretRect(for: position),
            in: self
        )
        refreshSelection()
    }

    private func extendSelection(to point: CGPoint) {
        guard var current = selection, let position = gridPosition(at: point) else { return }
        let previous = current.end
        current.extend(to: position)
        selection = current

        // One tick per row or column crossed, which is the feedback that makes a
        // selection feel like it is following the finger rather than lagging it.
        if previous != current.end {
            Haptics.select()
        }
        selectionOverlay.moveLoupe(to: point, caretRect: caretRect(for: position))
        refreshSelection()
    }

    private func endSelection(at point: CGPoint) {
        collectionView.isScrollEnabled = true
        selectionOverlay.endLoupe()
        DiagnosticLog.record(.terminalSelection, [
            .init(.selectionPhase, .flag(.ended)),
            .init(.isScrollEnabled, .bool(collectionView.isScrollEnabled)),
            .init(.longPressState, .bool(selection.map { !$0.isEmpty } ?? false)),
        ])

        // A press that never moved is how the reader meant to scroll, or to put the
        // keyboard away. Offering to copy one character would be a misread.
        guard let selection, !selection.isEmpty else {
            clearSelection()
            return
        }
        presentSelectionMenu()
    }

    @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
        let point = gesture.location(in: self)
        switch gesture.state {
        case .began:
            beginSelection(at: point)
        case .changed:
            // A long press that has been recognised keeps the gesture: the reader
            // spent half a second saying what they meant, and reversing that on the
            // next movement would take the selection away mid-drag.
            extendSelection(to: point)
        case .ended, .cancelled, .failed:
            endSelection(at: point)
        default:
            break
        }
    }

    private func presentSelectionMenu() {
        let interaction = UIEditMenuInteraction(delegate: self)
        editMenu = interaction
        collectionView.addInteraction(interaction)
        let anchor = selection.map { caretRect(for: $0.end) } ?? .zero
        interaction.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: CGPoint(x: anchor.midX, y: anchor.minY)))
    }

    func collectionView(_ collectionView: UICollectionView, prefetchItemsAt indexPaths: [IndexPath]) {
        // Cells are trivial to build; nothing to precompute, but implementing the
        // protocol keeps UIKit from disabling prefetch scheduling entirely.
    }
}

extension TerminalCollectionView: UIGestureRecognizerDelegate {
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        // Only the pinch and the scroll, and only with each other. Letting the long
        // press run alongside the scroll would turn a press that was meant to keep
        // scrolling into a selection.
        let pair: (UIGestureRecognizer, UIGestureRecognizer) = (gestureRecognizer, other)
        let isPinchAndPan = (pair.0 is UIPinchGestureRecognizer && pair.1 === collectionView.panGestureRecognizer)
            || (pair.1 is UIPinchGestureRecognizer && pair.0 === collectionView.panGestureRecognizer)
        return isPinchAndPan
    }
}

extension TerminalCollectionView: UIEditMenuInteractionDelegate {
    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        menuFor configuration: UIEditMenuConfiguration,
        suggestedActions: [UIMenuElement]
    ) -> UIMenu? {
        guard let selection, !selection.isEmpty else { return nil }
        return UIMenu(children: [
            UIAction(title: "拷贝") { [weak self] _ in self?.copySelection() },
            UIAction(title: "分享") { [weak self] _ in self?.shareSelection() },
            UIAction(title: "全选") { [weak self] _ in self?.selectAllRows() },
        ])
    }

    func editMenuInteraction(
        _ interaction: UIEditMenuInteraction,
        willDismissMenuFor configuration: UIEditMenuConfiguration,
        animator: any UIEditMenuInteractionAnimating
    ) {
        collectionView.removeInteraction(interaction)
        editMenu = nil
    }

    /// The text the reader has selected, as they can see it.
    ///
    /// Straight from the rows the view is showing, which is what the reader sees and
    /// therefore what they meant — not from the store's lines, which are wrapped
    /// differently and would hand over text that was never on screen.
    private var selectedText: String {
        guard let selection else { return "" }
        return selection.lines(from: appliedRows.map(\.text)).joined(separator: "\n")
    }

    /// Puts the selected cells on the pasteboard.
    private func copySelection() {
        guard !selectedText.isEmpty else { return }
        UIPasteboard.general.string = selectedText
        // The text leaves for the clipboard and the selection disappears, so the one
        // thing that happened is the one thing this screen cannot show.
        Haptics.success()
        clearSelection()
    }

    /// Hands the selected cells to the system share sheet.
    ///
    /// Presented on the next runloop turn: the edit menu is still animating away when
    /// its action fires, and asking for a sheet while that happens is how it ends up
    /// never appearing. The selection is deliberately left in place — cancelling the
    /// sheet is common, and it should not cost the reader their selection.
    private func shareSelection() {
        guard let presenter = topmostViewController() else { return }
        let controller = UIActivityViewController(
            activityItems: [selectedText],
            applicationActivities: nil
        )
        // A popover needs somewhere to point; without an anchor iPad raises instead of
        // laying the sheet out.
        let anchor = selection.map { caretRect(for: $0.end) } ?? bounds
        controller.popoverPresentationController?.sourceView = self
        controller.popoverPresentationController?.sourceRect = anchor
        DispatchQueue.main.async {
            presenter.present(controller, animated: true)
        }
    }

    /// The nearest view controller, with whatever it is presenting on top.
    ///
    /// The sheet has to be presented by the frontmost controller, not by the screen
    /// sitting underneath an already-open one.
    private func topmostViewController() -> UIViewController? {
        var responder: UIResponder? = self
        while let current = responder, !(current is UIViewController) {
            responder = current.next
        }
        var top = (responder as? UIViewController) ?? window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    private func selectAllRows() {
        guard let lastIndex = appliedRows.indices.last else { return }
        let lastColumn = max(0, appliedRows[lastIndex].text.count - 1)
        selection = TerminalSelection(
            anchor: TerminalSelection.Position(row: 0, column: 0),
            head: TerminalSelection.Position(row: lastIndex, column: lastColumn)
        )
        refreshSelection()
    }
}

extension TerminalCollectionView: UICollectionViewDelegateFlowLayout {
    func collectionView(
        _ collectionView: UICollectionView,
        layout collectionViewLayout: UICollectionViewLayout,
        sizeForItemAt indexPath: IndexPath
    ) -> CGSize {
        // A row fills the pane in both modes, and its text starts one cell of
        // padding in from the left edge. In the desktop-grid mode the row used to be
        // the grid's own width, so that an inset could centre a grid narrower than
        // the pane — but the pane is not a frame to centre things in. A flow layout
        // centres a line its items do not fill, so a narrower row would land in the
        // middle of the pane however it was inset; its width is the only thing
        // holding the text at the edge the computer's text starts from.
        CGSize(width: collectionView.bounds.width, height: TerminalRowCell.rowHeight(for: fontSize))
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Follow new output only while the user is already at the bottom; if they
        // scrolled up to read something, leave them where they are.
        let distanceFromBottom = scrollView.contentSize.height - scrollView.contentOffset.y - scrollView.bounds.height
        let wasPinned = isPinnedToBottom
        isPinnedToBottom = distanceFromBottom < 40

        // 这条是滚动问题的底噪：它同时回答"手指在动而 offset 没动"（手势被吞）、
        // "offset 在动但离底一直不到 40 点"（跟随一直没解除）这两个问题。
        //
        // 每次回调都调它，采样交给缓冲区 —— 120 Hz 的判断属于那一层，写在调用点上
        // 就得在每个高频回调里各写一遍，而那正是漏的开始。
        DiagnosticLog.record(.terminalScrollTick, [
            .init(.offsetY, .scalar(Double(scrollView.contentOffset.y))),
            .init(.contentSizeHeight, .scalar(Double(scrollView.contentSize.height))),
            .init(.boundsHeight, .scalar(Double(scrollView.bounds.height))),
            .init(.distanceFromBottom, .scalar(Double(distanceFromBottom))),
            .init(.isPinnedToBottom, .bool(isPinnedToBottom)),
            .init(.isDragging, .bool(scrollView.isDragging)),
            .init(.isDecelerating, .bool(scrollView.isDecelerating)),
            .init(.isScrollEnabled, .bool(collectionView.isScrollEnabled)),
            .init(.zoom, .scalar(Double(zoom))),
            .init(.atHistoryFloor, .bool(atHistoryFloor)),
            .init(.requestsInFlight, .bool(requestsInFlight)),
        ])

        if wasPinned != isPinnedToBottom {
            DiagnosticLog.record(.terminalPinChanged, [
                .init(.wasPinned, .bool(wasPinned)),
                .init(.isPinnedToBottom, .bool(isPinnedToBottom)),
                .init(.distanceFromBottom, .scalar(Double(distanceFromBottom))),
                .init(.trigger, .flag(scrollView.isDragging ? .userDrag : .contentGrew)),
            ])
        }

        // Reaching the top asks for the next page. One request at a time, and
        // never past the point the desktop has already said is the end.
        //
        // Also in the desktop-grid mode, where scrolling up walks back through
        // earlier output at the same grid — one scale for the whole buffer, so
        // history reads exactly like the lines it scrolled away from.
        if scrollView.contentOffset.y < 240, !requestsInFlight, !atHistoryFloor, !appliedKeys.isEmpty {
            onRequestHistory?()
        }
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        dragStartOffsetY = scrollView.contentOffset.y
        // 报在**开始拖**这一下，而不是每次位移：调用方要的是"人在动"这个事实，
        // 而它在这段拖动的每一帧里都成立。逐帧报等于让上层按 120Hz 重算一遍状态。
        onUserScroll?()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        // 还会继续滑行的话，这次拖动还没结束 —— 结论要等它停下来。
        guard !decelerate else { return }
        logScrollOutcome(scrollView)
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        logScrollOutcome(scrollView)
    }

    /// 一次拖动结束时它到底做了什么。
    ///
    /// `didMoveScrollOffset` 是这份日志里最值钱的一个布尔：一次既没有缩放、也没有
    /// 进入选字的拖动，如果它是 false，那内容没动的原因就只剩"手势被别的东西抢走了"。
    private func logScrollOutcome(_ scrollView: UIScrollView) {
        guard let start = dragStartOffsetY else { return }
        dragStartOffsetY = nil
        let delta = scrollView.contentOffset.y - start
        DiagnosticLog.record(.terminalGestureOutcome, [
            .init(.gestureKind, .flag(.scroll)),
            .init(.gestureState, .flag(.ended)),
            .init(.translationY, .scalar(Double(delta))),
            .init(.didMoveScrollOffset, .bool(abs(delta) > 0.5)),
            .init(.offsetY, .scalar(Double(scrollView.contentOffset.y))),
            .init(.contentSizeHeight, .scalar(Double(scrollView.contentSize.height))),
            .init(.boundsHeight, .scalar(Double(scrollView.bounds.height))),
            .init(.isPinnedToBottom, .bool(isPinnedToBottom)),
            .init(.isScrollEnabled, .bool(collectionView.isScrollEnabled)),
        ])
    }

    func collectionView(
        _ collectionView: UICollectionView,
        layout collectionViewLayout: UICollectionViewLayout,
        referenceSizeForHeaderInSection section: Int
    ) -> CGSize {
        CGSize(width: collectionView.bounds.width, height: atHistoryFloor ? 30 : 0)
    }
}

/// Marks the top of the retained history.
///
/// Without it, scrolling to the top and getting nothing looks like a bug rather
/// than a boundary — the user cannot tell "no more" from "not loaded yet".
final class TerminalHeaderView: UICollectionReusableView {
    static let reuseIdentifier = "TerminalHeaderView"

    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: 11)
        label.textColor = .tertiaryLabel
        label.textAlignment = .center
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    func configure(atFloor: Bool) {
        label.text = atFloor ? "没有更多历史" : ""
    }
}

/// One terminal row. A label keeps selection-free rendering simple and fast; the
/// useful copy affordance is per-session, not per-row.
final class TerminalRowCell: UICollectionViewCell {
    static let reuseIdentifier = "TerminalRowCell"

    private let label = UILabel()
    private let continuationBar = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = .clear
        backgroundColor = .clear

        continuationBar.translatesAutoresizingMaskIntoConstraints = false
        continuationBar.backgroundColor = UIColor.tertiaryLabel.withAlphaComponent(0.35)
        continuationBar.layer.cornerRadius = 1
        continuationBar.isHidden = true
        contentView.addSubview(continuationBar)

        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 1
        label.lineBreakMode = .byClipping
        contentView.addSubview(label)
        NSLayoutConstraint.activate([
            continuationBar.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 3),
            continuationBar.widthAnchor.constraint(equalToConstant: 2),
            continuationBar.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 2),
            continuationBar.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -2),

            label.leadingAnchor.constraint(
                equalTo: contentView.leadingAnchor,
                constant: TerminalCellMetrics.contentInset
            ),
            label.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -10),
            label.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    static func font(ofSize size: CGFloat) -> UIFont {
        TerminalFont.regular(ofSize: size)
    }

    static func rowHeight(for size: CGFloat) -> CGFloat {
        TerminalCellMetrics.rowHeight(forFontSize: size)
    }

    func configure(
        row: DisplayRow,
        fontSize: CGFloat,
        cursorColumn: Int?,
        selection: ClosedRange<Int>? = nil
    ) {
        label.font = Self.font(ofSize: fontSize)
        label.attributedText = Self.attributed(
            row: row,
            fontSize: fontSize,
            cursorColumn: cursorColumn,
            selection: selection
        )
        continuationBar.isHidden = !row.isContinuation
    }

    /// Internal rather than private so the cursor block can be asserted without
    /// going through a collection view.
    static func attributed(
        row: DisplayRow,
        fontSize: CGFloat,
        cursorColumn: Int?,
        selection: ClosedRange<Int>? = nil
    ) -> NSAttributedString {
        let font = Self.font(ofSize: fontSize)
        let attributed = NSMutableAttributedString(string: row.text, attributes: [
            .font: font,
            .foregroundColor: UIColor(TerminalPalette.defaultForeground),
        ])
        let length = (row.text as NSString).length
        for run in row.runs {
            let start = min(max(0, run.start), length)
            let end = min(start + run.length, length)
            guard end > start else { continue }
            let range = NSRange(location: start, length: end - start)

            var foreground = TerminalPalette.color(for: run.foreground, isForeground: true)
            var background = TerminalPalette.color(for: run.background, isForeground: false)
            // Inverse swaps the pair, which is how a cursor block and selected
            // menu rows are drawn in the terminal.
            if run.isInverse { swap(&foreground, &background) }
            attributed.addAttribute(.foregroundColor, value: UIColor(foreground), range: range)

            if run.background != StyleRun.defaultColor || run.isInverse {
                attributed.addAttribute(.backgroundColor, value: UIColor(background), range: range)
            }
            if run.isBold || run.isItalic || run.isUnderline {
                var traits: UIFontDescriptor.SymbolicTraits = []
                if run.isBold { traits.insert(.traitBold) }
                if run.isItalic { traits.insert(.traitItalic) }
                // The bundled family ships its own bold face, which is what keeps
                // bold text distinguishable instead of relying on synthesis.
                var descriptor = (run.isBold ? TerminalFont.bold(ofSize: fontSize) : nil)?.fontDescriptor
                    ?? font.fontDescriptor
                if !traits.isEmpty, let withTraits = descriptor.withSymbolicTraits(traits) {
                    descriptor = withTraits
                }
                attributed.addAttribute(
                    .font,
                    value: UIFont(descriptor: descriptor, size: fontSize),
                    range: range
                )
            }
            if run.isUnderline {
                attributed.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
            }
        }
        applySelection(selection, to: attributed)
        applyCursor(at: cursorColumn, to: attributed, font: font)
        return attributed
    }

    /// Tints the selected cells, under whatever the cursor does.
    ///
    /// Applied after the runs so it covers their own backgrounds — a selection that
    /// stopped at the first coloured run would look broken exactly where a reader is
    /// most likely to be selecting. Applied before the cursor so the block still
    /// inverts on top of it, which is how the two stay legible together.
    private static func applySelection(
        _ selection: ClosedRange<Int>?,
        to attributed: NSMutableAttributedString
    ) {
        guard let selection else { return }
        let text = attributed.string
        let characters = text.count
        guard selection.lowerBound < characters else { return }

        // Converted to UTF-16 offsets for the same reason the cursor is: the range
        // counts characters and the string is indexed by UTF-16, so the two differ
        // after the first character outside the basic plane.
        let first = selection.lowerBound
        let last = min(selection.upperBound, characters - 1)
        let lower = text.index(text.startIndex, offsetBy: first)
        let upper = text.index(text.startIndex, offsetBy: last + 1)
        let start = text[..<lower].utf16.count
        let end = text[..<upper].utf16.count
        guard end > start else { return }

        attributed.addAttribute(
            .backgroundColor,
            value: UIColor.tintColor.withAlphaComponent(0.3),
            range: NSRange(location: start, length: end - start)
        )
    }

    /// Draws the terminal cursor as a block.
    ///
    /// The character under it keeps its own cell but swaps colours with the block —
    /// the same swap the emulator's `Inverse` style performs — so the block is the
    /// width of exactly one character and the grid does not shift.
    private static func applyCursor(
        at column: Int?,
        to attributed: NSMutableAttributedString,
        font: UIFont
    ) {
        guard let column, column >= 0 else { return }
        // `column` counts characters, which is what the rows are sliced by. The
        // attributed string is indexed by UTF-16, and the two part company at the
        // first character outside the basic plane — an emoji, usually.
        let offset = attributed.string.prefix(column).utf16.count
        guard offset < (attributed.string as NSString).length else {
            // Past the end of the text there is no character to invert, so the
            // block is a filled space instead.
            attributed.append(NSAttributedString(string: " ", attributes: [
                .font: font,
                .backgroundColor: UIColor(TerminalPalette.defaultForeground),
            ]))
            return
        }
        let range = NSRange(location: offset, length: 1)
        let foreground = attributed.attribute(.foregroundColor, at: offset, effectiveRange: nil) as? UIColor
            ?? UIColor(TerminalPalette.defaultForeground)
        let background = attributed.attribute(.backgroundColor, at: offset, effectiveRange: nil) as? UIColor
            ?? UIColor(TerminalPalette.defaultBackground)
        attributed.addAttribute(.foregroundColor, value: background, range: range)
        attributed.addAttribute(.backgroundColor, value: foreground, range: range)
    }
}
