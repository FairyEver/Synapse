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
    let fontSize: CGFloat
    /// Bumped by the store on every applied frame; drives the snapshot.
    let revision: Int

    let onRequestHistory: () -> Void
    let onTap: () -> Void

    func makeUIView(context: Context) -> TerminalCollectionView {
        let view = TerminalCollectionView()
        view.onWidthChanged = { [weak store] columns in
            store?.update(columns: columns)
        }
        view.onRequestHistory = onRequestHistory
        view.onTap = onTap
        view.applyFont(size: fontSize)
        return view
    }

    func updateUIView(_ view: TerminalCollectionView, context: Context) {
        view.applyFont(size: fontSize)
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
    private var atHistoryFloor = false
    private var requestsInFlight = false
    /// Reports how many monospace columns fit, so the wrap matches the phone.
    var onWidthChanged: ((Int) -> Void)?
    /// Asks for another page when the user reaches the top.
    var onRequestHistory: (() -> Void)?
    /// Tapping the terminal is how the keyboard is put away.
    var onTap: (() -> Void)?
    private var reportedColumns = 0
    private var lastLayoutHeight: CGFloat = 0
    private var appliedCursor: TerminalStore.CursorPosition?
    private var blinkTimer: Timer?
    /// Blink phase. The cursor is solid whenever blinking is off, so starting from
    /// `true` means Reduce Motion shows a steady block with no timer at all.
    private var cursorPhaseOn = true

    private static let horizontalInset: CGFloat = 20

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        buildCollectionView()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    func applyFont(size: CGFloat) {
        guard size != fontSize else { return }
        fontSize = size
        collectionView.collectionViewLayout.invalidateLayout()
        // Row height depends on the font, so every visible cell must re-measure.
        // Every row is re-keyed from scratch below, so the cursor is drawn solid
        // rather than left at whatever phase the blink was in.
        appliedKeys = []
        appliedRows = []
        rowsByKey.removeAll()
        cursorPhaseOn = true
        reportColumnsIfNeeded()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        reportColumnsIfNeeded()
        // The keyboard appearing shrinks this view. Nothing new was appended, so
        // no snapshot runs — without this the newest output would slide below the
        // fold and the user would have to scroll to find it.
        if bounds.height != lastLayoutHeight {
            lastLayoutHeight = bounds.height
            if isPinnedToBottom { scrollToBottom() }
        }
    }

    /// The desktop wraps at its own width; only the phone knows how wide the
    /// phone is, so the column count is measured here and pushed to the store.
    private func reportColumnsIfNeeded() {
        let available = bounds.width - Self.horizontalInset
        guard available > 0, fontSize > 0 else { return }
        let advance = ("0" as NSString).size(withAttributes: [
            .font: TerminalRowCell.font(ofSize: fontSize),
        ]).width
        guard advance > 0 else { return }
        let columns = max(20, Int(available / advance))
        guard columns != reportedColumns else { return }
        reportedColumns = columns
        onWidthChanged?(columns)
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
        } else if wasAtBottom {
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
        Self.identities(for: rows, cursor: cursor, cursorVisible: cursorPhaseOn)
    }

    /// Static and parameterised on the blink phase so both halves of the property
    /// below can be asserted without a collection view.
    static func identities(
        for rows: [DisplayRow],
        cursor: TerminalStore.CursorPosition?,
        cursorVisible: Bool
    ) -> [String] {
        rows.enumerated().map { index, row in
            guard cursorVisible, let cursor, cursor.rowIndex == index else { return row.id }
            return "\(row.id)#cursor:\(cursor.column)"
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
                    cursorColumn: self?.cursorColumn(forRowAt: indexPath.item)
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

        collectionView.dataSource = dataSource
        collectionView.delegate = self
    }

    @objc private func handleTap() {
        onTap?()
    }

    func collectionView(_ collectionView: UICollectionView, prefetchItemsAt indexPaths: [IndexPath]) {
        // Cells are trivial to build; nothing to precompute, but implementing the
        // protocol keeps UIKit from disabling prefetch scheduling entirely.
    }
}

extension TerminalCollectionView: UICollectionViewDelegateFlowLayout {
    func collectionView(
        _ collectionView: UICollectionView,
        layout collectionViewLayout: UICollectionViewLayout,
        sizeForItemAt indexPath: IndexPath
    ) -> CGSize {
        CGSize(width: collectionView.bounds.width, height: TerminalRowCell.rowHeight(for: fontSize))
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Follow new output only while the user is already at the bottom; if they
        // scrolled up to read something, leave them where they are.
        let distanceFromBottom = scrollView.contentSize.height - scrollView.contentOffset.y - scrollView.bounds.height
        isPinnedToBottom = distanceFromBottom < 40

        // Reaching the top asks for the next page. One request at a time, and
        // never past the point the desktop has already said is the end.
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

            label.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 10),
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
        ceil(font(ofSize: size).lineHeight) + 1
    }

    func configure(row: DisplayRow, fontSize: CGFloat, cursorColumn: Int?) {
        label.font = Self.font(ofSize: fontSize)
        label.attributedText = Self.attributed(
            row: row,
            fontSize: fontSize,
            cursorColumn: cursorColumn
        )
        continuationBar.isHidden = !row.isContinuation
    }

    /// Internal rather than private so the cursor block can be asserted without
    /// going through a collection view.
    static func attributed(
        row: DisplayRow,
        fontSize: CGFloat,
        cursorColumn: Int?
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
        applyCursor(at: cursorColumn, to: attributed, font: font)
        return attributed
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
        guard column < (attributed.string as NSString).length else {
            // Past the end of the text there is no character to invert, so the
            // block is a filled space instead.
            attributed.append(NSAttributedString(string: " ", attributes: [
                .font: font,
                .backgroundColor: UIColor(TerminalPalette.defaultForeground),
            ]))
            return
        }
        let range = NSRange(location: column, length: 1)
        let foreground = attributed.attribute(.foregroundColor, at: column, effectiveRange: nil) as? UIColor
            ?? UIColor(TerminalPalette.defaultForeground)
        let background = attributed.attribute(.backgroundColor, at: column, effectiveRange: nil) as? UIColor
            ?? UIColor(TerminalPalette.defaultBackground)
        attributed.addAttribute(.foregroundColor, value: background, range: range)
        attributed.addAttribute(.backgroundColor, value: foreground, range: range)
    }
}
