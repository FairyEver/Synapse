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
        (0..<count).map { index in
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

    private func terminal(columns: Int, rows: Int) -> (view: TerminalCollectionView, list: UICollectionView) {
        let view = TerminalCollectionView(frame: pane)
        view.applyLayout(
            displayMode: .desktopDriven,
            desktopGrid: DesktopGrid(columns: columns, rows: rows),
            fontSize: 14
        )
        view.setNeedsLayout()
        view.layoutIfNeeded()
        guard let list = collectionView(in: view) else {
            fatalError("the terminal has no collection view")
        }
        return (view, list)
    }

    /// Where a row actually lands on the pane, insets and offset included.
    private func visibleFrame(ofRow index: Int, in list: UICollectionView) -> CGRect? {
        guard let attributes = list.layoutAttributesForItem(at: IndexPath(item: index, section: 0))
        else { return nil }
        return attributes.frame.offsetBy(dx: -list.contentOffset.x, dy: -list.contentOffset.y)
    }

    /// Less than a pane of output sits at the top, the way the computer shows it.
    ///
    /// A fresh session's prompt is at the top of the computer's screen and the lines
    /// below it are empty. The phone showed it a third of the way down the pane
    /// instead, centred inside a box as tall as the computer's screen — which is the
    /// one arrangement nobody's terminal ever has.
    ///
    /// Grown a frame at a time, because that is when it was wrong in the other
    /// direction: the box gave content that fitted a scroll range, so every frame
    /// that arrived could move it, and the reader watched the picture twitch.
    @Test func lessThanAPaneOfOutputSitsAtTheTop() {
        let (view, list) = terminal(columns: 80, rows: 24)
        for count in [5, 10, 15] {
            view.apply(rows: lines(count), atHistoryFloor: false, cursor: nil)
            list.layoutIfNeeded()

            #expect(list.contentOffset.y == 0)
            #expect(visibleFrame(ofRow: 0, in: list)?.minY == 0)
        }
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
