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
}
