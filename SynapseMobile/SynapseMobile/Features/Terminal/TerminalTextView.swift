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
        view.applyLayout(displayMode: displayMode, desktopGrid: desktopGrid, fontSize: fontSize)
        return view
    }

    func updateUIView(_ view: TerminalCollectionView, context: Context) {
        view.applyLayout(displayMode: displayMode, desktopGrid: desktopGrid, fontSize: fontSize)
        view.apply(
            rows: store.rows,
            atHistoryFloor: store.reachedHistoryFloor,
            cursor: store.cursorPosition
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
    /// Pinch scaling on top of the fitted size, in the desktop-grid mode only.
    /// Fitted is 1, and it never goes below — shrinking past "the whole screen"
    /// would be a third mode nobody asked for.
    private var zoom: CGFloat = 1
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
    /// Set when the grid changes, so the view lands on the computer's current
    /// screen once. Not a standing behaviour: after that the reader owns the scroll
    /// position, and re-pinning on every frame is what made the picture twitch.
    private var pendingLandingScroll = false
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
    private var reportedColumns = 0
    private var reportedRows = 0
    private var lastLayoutHeight: CGFloat = 0
    /// The pane size the fit was last computed against, so `layoutSubviews` can tell
    /// a real resize from its own inset being applied.
    private var lastLaidOutPaneSize: CGSize = .zero
    private var appliedCursor: TerminalStore.CursorPosition?
    private var blinkTimer: Timer?
    /// Blink phase. The cursor is solid whenever blinking is off, so starting from
    /// `true` means Reduce Motion shows a steady block with no timer at all.
    private var cursorPhaseOn = true

    /// Both edges together. Derived from the cell metrics rather than given its own
    /// number: the row label's leading is the same measurement seen once, and two
    /// literals describing one edge is how they drift.
    private static var horizontalInset: CGFloat { TerminalCellMetrics.contentInset * 2 }

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
            // What the computer is showing now is the bottom of the buffer, so that
            // is where a reader arriving at this grid expects to be.
            pendingLandingScroll = true
        }

        let target = renderedFontSize(base: base)
        if target != fontSize {
            fontSize = target
            remeasureRows()
        } else {
            applyInsets()
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
        applyInsets()
        collectionView.collectionViewLayout.invalidateLayout()
    }

    /// The size cells are actually drawn at.
    ///
    /// The density's size in the phone-driven mode. In the desktop-grid mode the
    /// whole desktop screen has to fit, so it is that size scaled down — which is
    /// how the mode keeps its promise with no transform anywhere: the grid stays a
    /// grid, only the size changes.
    private func renderedFontSize(base: CGFloat) -> CGFloat {
        guard displayMode == .desktopDriven, let grid = desktopGrid, base > 0 else { return base }
        // Floored, not rounded. Rounding up leaves the grid a fraction of a point
        // wider than the pane, and a fraction of a point across eighty columns is
        // several points of sideways travel — enough that the whole screen looks
        // like it is meant to scroll when it is not.
        return max(1, (base * fitScale(for: grid, base: base) * zoom).rounded(.down))
    }

    /// How much the desktop's grid has to shrink to fit the pane.
    ///
    /// Measured at `base` rather than at the current size, so asking twice gives
    /// the same answer instead of compounding.
    private func fitScale(for grid: DesktopGrid, base: CGFloat) -> CGFloat {
        terminalGridFitScale(
            grid: grid,
            paneSize: bounds.size,
            contentInset: TerminalCellMetrics.contentInset,
            cellSize: CGSize(
                width: TerminalCellMetrics.advance(forFontSize: base),
                height: TerminalCellMetrics.rowHeight(forFontSize: base)
            )
        )
    }

    /// The pane's width with a cell of padding taken off each side.
    private var usableWidth: CGFloat {
        max(0, bounds.width - Self.horizontalInset)
    }

    /// Places the grid inside the pane.
    ///
    /// The desktop-grid mode aligns rather than fills. A grid wider than it is tall —
    /// which is what a desktop terminal is — is scaled to the width and sits at the
    /// top: the lines a reader looks for are the last ones, and empty space below
    /// them goes unnoticed where empty space above them would not. A grid taller
    /// than the pane is centred instead.
    private func applyInsets() {
        let pane = bounds
        guard displayMode == .desktopDriven, let grid = desktopGrid, pane.width > 0, pane.height > 0 else {
            collectionView.contentInset = .zero
            collectionView.alwaysBounceHorizontal = false
            return
        }

        let cellWidth = TerminalCellMetrics.advance(forFontSize: fontSize)
        let cellHeight = TerminalRowCell.rowHeight(for: fontSize)
        let gridWidth = CGFloat(grid.columns) * cellWidth
        let gridHeight = CGFloat(grid.rows) * cellHeight
        guard gridWidth > 0, gridHeight > 0 else {
            collectionView.contentInset = .zero
            collectionView.alwaysBounceHorizontal = false
            return
        }

        // Only once the reader has pinched past the fit is there more grid than
        // pane, and only then is there anything to scroll to.
        let usable = usableWidth
        collectionView.alwaysBounceHorizontal = gridWidth > usable

        let widthRatio = usable > 0 ? usable / gridWidth : 0
        let heightRatio = pane.height > 0 ? pane.height / gridHeight : 0
        let widthIsTheLimit = widthRatio <= heightRatio

        collectionView.contentInset = UIEdgeInsets(
            // Top-aligned when the width is what runs out; centred when it is the
            // height, which is the landscape case.
            top: widthIsTheLimit ? 0 : max(0, (pane.height - gridHeight) / 2),
            // A row is one cell of padding wider than its text on each side, so the
            // text sits one padding in from the row's own edge. A fitted row is
            // exactly as wide as the pane and this comes out at zero; it only lifts
            // the grid once it is wider than the pane, which is the pinched case.
            left: max(0, (pane.width - gridWidth) / 2 - TerminalCellMetrics.contentInset),
            bottom: 0,
            right: 0
        )
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // A resize changes how much of the desktop's grid fits, so the fitted size
        // and the alignment are recomputed before anything lays out with the old
        // ones.
        //
        // Only when the pane's own size actually changed. Setting a content inset is
        // itself a layout-affecting change, so doing this on every pass makes the
        // two call each other: a continuous redraw, which the reader sees as the
        // picture flickering while they are trying to read it.
        let paneSize = bounds.size
        if displayMode == .desktopDriven, desktopGrid != nil, paneSize != lastLaidOutPaneSize {
            lastLaidOutPaneSize = paneSize
            let target = renderedFontSize(base: baseFontSize)
            if target != fontSize {
                fontSize = target
                remeasureRows()
            } else {
                applyInsets()
            }
        }
        reportColumnsIfNeeded()
        // The keyboard appearing shrinks this view. Nothing new was appended, so
        // no snapshot runs — without this the newest output would slide below the
        // fold and the user would have to scroll to find it.
        if bounds.height != lastLayoutHeight {
            lastLayoutHeight = bounds.height
            // Except in the desktop-grid mode, where the grid is placed by the
            // alignment rules and pinning to the bottom would scroll the top of it
            // off — the opposite of showing the whole screen.
            if isPinnedToBottom, displayMode == .phoneDriven { scrollToBottom() }
        }
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

    func apply(rows: [DisplayRow], atHistoryFloor: Bool, cursor: TerminalStore.CursorPosition?) {
        let keys = identities(for: rows, cursor: cursor)
        let floorChanged = atHistoryFloor != self.atHistoryFloor
        let rowsChanged = keys != appliedKeys
        guard rowsChanged || floorChanged else { return }
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

        if insertedAbove > 0 {
            collectionView.contentOffset.y = offsetBefore
                + CGFloat(insertedAbove) * TerminalRowCell.rowHeight(for: fontSize)
        } else if pendingLandingScroll {
            pendingLandingScroll = false
            scrollToBottom()
        } else if wasAtBottom, displayMode == .phoneDriven {
            // Only where following the tail is the point. In the desktop-grid mode
            // the grid is placed by the alignment rules, and a screen shorter than
            // the pane counts as "at the bottom" the whole time — so this would
            // scroll on every frame that arrives, which is the jitter a reader sees
            // as the picture twitching while they are reading it.
            scrollToBottom()
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
        // The row's identity carries the phase, so this is an ordinary diff of the
        // rows already on screen — no reload, and no new rows to lay out.
        push(rows: appliedRows, keys: identities(for: appliedRows, cursor: cursor))
    }

    /// The column the cursor occupies on a given row, or nil when it is elsewhere
    /// or the blink is in its off phase.
    private func cursorColumn(forRowAt index: Int) -> Int? {
        guard cursorPhaseOn, appliedCursor?.rowIndex == index else { return nil }
        return appliedCursor?.column
    }

    func scrollToBottom() {
        guard !appliedKeys.isEmpty else { return }
        let last = IndexPath(item: appliedKeys.count - 1, section: 0)
        collectionView.scrollToItem(at: last, at: .bottom, animated: false)
        isPinnedToBottom = true
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
        // The alignment insets are computed from the pane's own geometry, so letting
        // UIKit also apply safe-area insets would shift the grid by an amount that
        // varies with the notch and the home indicator — exactly what the centring
        // arithmetic below cannot account for.
        collectionView.contentInsetAdjustmentBehavior = .never
        collectionView.register(TerminalRowCell.self, forCellWithReuseIdentifier: TerminalRowCell.reuseIdentifier)
        collectionView.register(
            TerminalHeaderView.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader,
            withReuseIdentifier: TerminalHeaderView.reuseIdentifier
        )
        // A stable handle for UI tests; also what VoiceOver announces the region as.
        collectionView.accessibilityIdentifier = "terminal.text"
        addSubview(collectionView)

        NSLayoutConstraint.activate([
            collectionView.leadingAnchor.constraint(equalTo: leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: trailingAnchor),
            collectionView.topAnchor.constraint(equalTo: topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: bottomAnchor),
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

    /// Magnifies the desktop's grid past the fit.
    ///
    /// Only where there is something to magnify: the phone-driven mode is already at
    /// the size the reader chose, and widening it further is a different promise than
    /// the one that mode makes. The zoom is a multiple of the fitted size, so it
    /// means the same thing after a rotation as before one.
    @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
        guard displayMode == .desktopDriven, desktopGrid != nil else { return }
        guard gesture.state == .changed else { return }

        let proposed = zoom * gesture.scale
        let clamped = min(TerminalDisplayConfig.maxZoom, max(TerminalDisplayConfig.minZoom, proposed))
        guard abs(clamped - zoom) > 0.001 else { return }
        zoom = clamped
        // Reset each step so the next callback reports an incremental change rather
        // than the whole gesture again.
        gesture.scale = 1

        let target = renderedFontSize(base: baseFontSize)
        guard target != fontSize else { return }
        fontSize = target
        remeasureRows()
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
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
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
            UISelectionFeedbackGenerator().selectionChanged()
        }
        selectionOverlay.moveLoupe(to: point, caretRect: caretRect(for: position))
        refreshSelection()
    }

    private func endSelection(at point: CGPoint) {
        collectionView.isScrollEnabled = true
        selectionOverlay.endLoupe()

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

    /// Puts the selected cells on the pasteboard.
    ///
    /// Straight from the rows the view is showing, which is what the reader sees and
    /// therefore what they meant — not from the store's lines, which are wrapped
    /// differently and would paste text that was never on screen.
    private func copySelection() {
        guard let selection else { return }
        let text = selection.lines(from: appliedRows.map(\.text)).joined(separator: "\n")
        UIPasteboard.general.string = text
        clearSelection()
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
        CGSize(width: itemWidth, height: TerminalRowCell.rowHeight(for: fontSize))
    }

    /// A row's width.
    ///
    /// A row fills the pane in the phone-driven mode. In the desktop-grid mode it is
    /// the grid's own width instead, because `contentInset.left` only centres content
    /// that is narrower than the pane — a full-width row would simply be shifted
    /// across, which is how a centred grid silently comes out right-aligned.
    private var itemWidth: CGFloat {
        guard displayMode == .desktopDriven, let grid = desktopGrid else {
            return collectionView.bounds.width
        }
        let gridWidth = CGFloat(grid.columns) * TerminalCellMetrics.advance(forFontSize: fontSize)
        guard gridWidth > 0 else { return collectionView.bounds.width }
        return gridWidth + Self.horizontalInset
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Follow new output only while the user is already at the bottom; if they
        // scrolled up to read something, leave them where they are.
        let distanceFromBottom = scrollView.contentSize.height - scrollView.contentOffset.y - scrollView.bounds.height
        isPinnedToBottom = distanceFromBottom < 40

        // Reaching the top asks for the next page. One request at a time, and
        // never past the point the desktop has already said is the end.
        //
        // Also in the desktop-grid mode, where scrolling up walks back through
        // earlier screens at the same grid — the scale is fixed by "one screen
        // fits", so history reads exactly like the screen it scrolled away from.
        if scrollView.contentOffset.y < 240, !requestsInFlight, !atHistoryFloor, !appliedKeys.isEmpty {
            onRequestHistory?()
        }
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
