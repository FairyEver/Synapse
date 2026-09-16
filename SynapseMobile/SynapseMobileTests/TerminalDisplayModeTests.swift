import CoreGraphics
import Testing

@testable import SynapseMobile

/// Which width the rows are wrapped at.
///
/// This used to be answered in two places — the view measured the pane, and the
/// store separately kept a display mode of its own — and when the two disagreed the
/// rows came out wrapped at one width inside boxes built for another. The reader saw
/// text clinging to the left of an over-wide row, an empty right margin, and a screen
/// taller than the computer's because every line had been wrapped early.
///
/// One function answers it now, and these are its cases.
struct TerminalDisplayModeTests {
    private let paneWidth: CGFloat = 393
    private let fontSize: CGFloat = 8

    /// The phone's own width, measured against the size the rows will be drawn at.
    @Test func thePhoneGridIsMeasuredFromThePane() {
        let columns = terminalWrapColumns(
            displayMode: .phoneDriven,
            desktopGrid: DesktopGrid(columns: 120, rows: 40),
            paneWidth: paneWidth,
            fontSize: fontSize
        )

        // The desktop's grid is present but must not be consulted: this mode asks
        // the phone how wide it is.
        #expect(columns != 120)
        #expect(columns == TerminalCellMetrics.columns(fitting: paneWidth, fontSize: fontSize))
    }

    /// The whole point of the desktop-grid mode: the computer's width wins, and the
    /// phone's is not consulted at all.
    @Test func theDesktopGridIsUsedVerbatim() {
        let columns = terminalWrapColumns(
            displayMode: .desktopDriven,
            desktopGrid: DesktopGrid(columns: 120, rows: 40),
            paneWidth: paneWidth,
            fontSize: fontSize
        )

        #expect(columns == 120)
    }

    /// Before the first summary arrives there is no desktop grid to honour, so the
    /// phone measures its own rather than refusing to lay anything out.
    @Test func aMissingDesktopGridFallsBackToThePhone() {
        let columns = terminalWrapColumns(
            displayMode: .desktopDriven,
            desktopGrid: nil,
            paneWidth: paneWidth,
            fontSize: fontSize
        )

        #expect(columns == TerminalCellMetrics.columns(fitting: paneWidth, fontSize: fontSize))
    }

    /// A pane measured before it has a width cannot yield a grid, and a grid that
    /// cannot hold a prompt is not a grid.
    @Test func aPaneWithNoWidthStillYieldsAUsableFloor() {
        #expect(terminalWrapColumns(
            displayMode: .phoneDriven,
            desktopGrid: nil,
            paneWidth: 0,
            fontSize: fontSize
        ) == TerminalCellMetrics.minimumColumns)

        // Same for a font that failed to measure, which would otherwise divide by
        // zero on the way to the column count.
        #expect(terminalWrapColumns(
            displayMode: .phoneDriven,
            desktopGrid: nil,
            paneWidth: paneWidth,
            fontSize: 0
        ) == TerminalCellMetrics.minimumColumns)
    }

    /// A grid the desktop has not drawn any columns in yet is not a grid either.
    @Test func aDegenerateDesktopGridFallsBackToThePhone() {
        let columns = terminalWrapColumns(
            displayMode: .desktopDriven,
            desktopGrid: DesktopGrid(columns: 0, rows: 0),
            paneWidth: paneWidth,
            fontSize: fontSize
        )

        #expect(columns == TerminalCellMetrics.columns(fitting: paneWidth, fontSize: fontSize))
    }
}
