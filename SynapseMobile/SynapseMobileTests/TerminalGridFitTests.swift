import CoreGraphics
import Testing

@testable import SynapseMobile

/// The arithmetic that decides how much of the desktop's grid fits, and how small.
///
/// It is the whole of what the desktop-grid mode promises, and it has already been
/// wrong once — the margins were left out of the fit, so the grid came out a hair
/// wider than the pane and the whole screen acquired sideways travel it was never
/// meant to have. These pin down the parts that were wrong and the parts a later
/// "improvement" would be tempted to take away.
struct TerminalGridFitTests {
    private let cell = CGSize(width: 8.4, height: 20)
    private let inset: CGFloat = 10
    private let phone = CGSize(width: 393, height: 800)

    /// The grid fits inside the margins, not merely inside the pane.
    ///
    /// The width is deliberately one that has to shrink — a narrower grid would be
    /// left at its own size, and the test would pass without ever exercising the
    /// margins.
    @Test func fitsInsideTheMarginsNotJustThePane() {
        let grid = DesktopGrid(columns: 80, rows: 24)
        let scale = terminalGridFitScale(
            grid: grid,
            paneSize: phone,
            contentInset: inset,
            cellSize: cell
        )

        #expect(scale < 1)
        let drawn = CGFloat(grid.columns) * cell.width * scale
        #expect(drawn <= phone.width - inset * 2 + 0.0001)
        // Width is what binds here, so it should come out exactly as wide as the
        // space it was given rather than merely no wider.
        #expect(abs(drawn - (phone.width - inset * 2)) < 0.0001)
    }

    /// A grid with more columns than the phone can hold shrinks rather than
    /// overflowing. There is deliberately no readable-size floor: the mode promises
    /// the whole screen, and the reader accepted small text for it.
    @Test func aWideGridShrinksRatherThanOverflowing() {
        let grid = DesktopGrid(columns: 200, rows: 50)
        let scale = terminalGridFitScale(
            grid: grid,
            paneSize: phone,
            contentInset: inset,
            cellSize: cell
        )

        #expect(scale < 0.3)
        #expect(CGFloat(grid.columns) * cell.width * scale <= phone.width - inset * 2 + 0.0001)
    }

    /// Height decides when it is the tighter of the two, which is the landscape case.
    @Test func heightCanBeTheBindingLimit() {
        let grid = DesktopGrid(columns: 20, rows: 200)
        let scale = terminalGridFitScale(
            grid: grid,
            paneSize: CGSize(width: 800, height: 400),
            contentInset: inset,
            cellSize: cell
        )

        #expect(abs(scale - 400 / (200 * cell.height)) < 0.0001)
    }

    /// Never enlarges. A grid smaller than the pane stays its own size, because
    /// magnifying past the desktop's own rendering is a different claim than fitting.
    @Test func neverEnlarges() {
        let scale = terminalGridFitScale(
            grid: DesktopGrid(columns: 10, rows: 3),
            paneSize: phone,
            contentInset: inset,
            cellSize: cell
        )

        #expect(scale == 1)
    }

    /// A pane measured before it has a size must not produce a zero scale, or the
    /// text would vanish and never come back.
    @Test func aPaneWithNoSizeFallsBackToUnscaled() {
        #expect(terminalGridFitScale(
            grid: DesktopGrid(columns: 80, rows: 24),
            paneSize: .zero,
            contentInset: inset,
            cellSize: cell
        ) == 1)

        // A pane narrower than its own margins is the same situation.
        #expect(terminalGridFitScale(
            grid: DesktopGrid(columns: 80, rows: 24),
            paneSize: CGSize(width: 12, height: 800),
            contentInset: inset,
            cellSize: cell
        ) == 1)
    }

    /// A cell with no size — a font that failed to measure — is not a division by
    /// zero waiting to happen.
    @Test func anUnmeasurableCellFallsBackToUnscaled() {
        #expect(terminalGridFitScale(
            grid: DesktopGrid(columns: 80, rows: 24),
            paneSize: phone,
            contentInset: inset,
            cellSize: .zero
        ) == 1)
    }
}
