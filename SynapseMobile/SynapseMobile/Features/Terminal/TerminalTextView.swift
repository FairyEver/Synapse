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
    /// Identified by row id rather than by `DisplayRow` itself. The project
    /// defaults to `MainActor` isolation, which makes a custom type's `Hashable`
    /// conformance unusable where the data source needs a `Sendable` identifier;
    /// a `String` sidesteps that and is a natural key anyway.
    private var dataSource: UICollectionViewDiffableDataSource<Int, String>!
    private var rowsById: [String: DisplayRow] = [:]
    private var fontSize: CGFloat = 12
    private var appliedIds: [String] = []
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
        appliedIds = []
        rowsById.removeAll()
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
        let ids = rows.map(\.id)
        let floorChanged = atHistoryFloor != self.atHistoryFloor
        let rowsChanged = ids != appliedIds
        let cursorChanged = cursor != appliedCursor
        // Moving the cursor changes no row's identity, so it has to take part in
        // the change check — otherwise the new position would never be drawn.
        guard rowsChanged || floorChanged || cursorChanged else { return }
        let previousCursor = appliedCursor
        appliedCursor = cursor
        self.atHistoryFloor = atHistoryFloor
        let wasAtBottom = isPinnedToBottom
        let previousFirstId = appliedIds.first

        // Loading a page inserts rows *above* the viewport. Without compensating,
        // the content jumps by the height of the inserted page every time.
        let insertedAbove: Int
        if let previousFirstId, let newIndex = ids.firstIndex(of: previousFirstId) {
            insertedAbove = newIndex
        } else {
            insertedAbove = 0
        }
        let offsetBefore = collectionView.contentOffset.y

        appliedIds = ids
        rowsById = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })

        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(ids, toSection: 0)
        // No animation: frames arrive far faster than an animation could finish,
        // and animating each one would make scrolling feel like it is lagging.
        dataSource.apply(snapshot, animatingDifferences: false)

        if insertedAbove > 0 {
            collectionView.contentOffset.y = offsetBefore
                + CGFloat(insertedAbove) * TerminalRowCell.rowHeight(for: fontSize)
        } else if wasAtBottom {
            scrollToBottom()
        }
        if floorChanged {
            collectionView.collectionViewLayout.invalidateLayout()
        }
        if cursorChanged {
            // The snapshot only reconfigures rows whose identity changed, and the
            // cursor moves without changing any. Reload the two rows it left and
            // arrived at so the block is erased from one and drawn on the other.
            reloadRows(at: [previousCursor?.rowIndex, cursor?.rowIndex])
            updateBlink()
        }
    }

    func setRequestsInFlight(_ inFlight: Bool) {
        requestsInFlight = inFlight
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // A timer that outlives the screen would keep waking the app for nothing.
        if window == nil { stopBlinking() } else { updateBlink() }
    }

    /// Blinks the cursor. With Reduce Motion on it stays solid instead — the block
    /// is still visible, it just does not move.
    private func updateBlink() {
        stopBlinking()
        cursorPhaseOn = true
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
        guard appliedCursor != nil else {
            stopBlinking()
            return
        }
        cursorPhaseOn.toggle()
        reloadRows(at: [appliedCursor?.rowIndex])
    }

    private func reloadRows(at indices: [Int?]) {
        let paths = Set(indices.compactMap { $0 })
            .filter { $0 >= 0 && $0 < appliedIds.count }
            .map { IndexPath(item: $0, section: 0) }
        guard !paths.isEmpty else { return }
        collectionView.reloadItems(at: paths)
    }

    /// The column the cursor occupies on a given row, or nil when it is elsewhere
    /// or the blink is in its off phase.
    private func cursorColumn(forRowAt index: Int) -> Int? {
        guard cursorPhaseOn, appliedCursor?.rowIndex == index else { return nil }
        return appliedCursor?.column
    }

    func scrollToBottom() {
        guard !appliedIds.isEmpty else { return }
        let last = IndexPath(item: appliedIds.count - 1, section: 0)
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
        ) { [weak self] collectionView, indexPath, rowId in
            let cell = collectionView.dequeueReusableCell(
                withReuseIdentifier: TerminalRowCell.reuseIdentifier,
                for: indexPath
            ) as! TerminalRowCell
            if let row = self?.rowsById[rowId] {
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
        if scrollView.contentOffset.y < 240, !requestsInFlight, !atHistoryFloor, !appliedIds.isEmpty {
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
