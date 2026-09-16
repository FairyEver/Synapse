import Foundation
import Testing

@testable import SynapseMobile

/// The two display modes differ in one thing the store is responsible for: whose
/// width the rows are wrapped at.
///
/// These pin the invariant the desktop-grid mode rests on. A line the desktop drew
/// is at most as wide as the desktop's grid, so wrapping it at that width leaves it
/// whole — and it has to stay whole no matter what the phone does with its own
/// layout, because "the layout matches the computer" is the entire promise. If a
/// rotation could re-wrap it, the mode would quietly stop being true.
@MainActor
struct TerminalDisplayModeTests {
    private func line(_ text: String) throws -> TerminalLine {
        try JSONDecoder().decode(TerminalLine.self, from: Data("[\"\(text)\",[]]".utf8))
    }

    private func frame(lines: [TerminalLine]) -> MobileTerminalFrame {
        MobileTerminalFrame(
            sessionId: "session",
            kind: "reset",
            from: 0,
            lines: lines,
            total: lines.count,
            cursor: TerminalCursor(row: 0, col: 0, visible: false),
            alt: false,
            truncated: false,
            seq: 1,
            sizeRevision: 1
        )
    }

    /// A full-width desktop line arrives as one row, not two.
    ///
    /// The width is deliberately not the store's own default, so the assertion
    /// below fails if the grid was never adopted rather than passing by coincidence.
    @Test func aDesktopLineSurvivesTheDesktopGridIntact() throws {
        let store = TerminalStore()
        store.adopt(displayMode: .desktopDriven, desktopGrid: DesktopGrid(columns: 60, rows: 24))
        store.apply(frame(lines: [try line(String(repeating: "x", count: 60))]))

        #expect(store.columns == 60)
        #expect(store.rows.count == 1)
    }

    /// The phone's own width must not re-wrap the grid.
    ///
    /// A rotation and a dismissed keyboard both reach the store as a new column
    /// count, so this is the everyday path by which the mode would undo itself.
    @Test func thePhoneWidthCannotRewrapTheDesktopGrid() throws {
        let store = TerminalStore()
        store.adopt(displayMode: .desktopDriven, desktopGrid: DesktopGrid(columns: 80, rows: 24))
        store.apply(frame(lines: [try line(String(repeating: "x", count: 80))]))

        store.update(columns: 40)

        #expect(store.columns == 80)
        #expect(store.rows.count == 1)
    }

    /// Leaving the mode has to leave its layout behind too, and wrap at the phone's
    /// width again.
    @Test func returningToThePhoneGridWrapsAtThePhoneWidth() throws {
        let store = TerminalStore()
        store.adopt(displayMode: .desktopDriven, desktopGrid: DesktopGrid(columns: 80, rows: 24))
        store.apply(frame(lines: [try line(String(repeating: "x", count: 80))]))
        #expect(store.rows.count == 1)

        store.adopt(displayMode: .phoneDriven, desktopGrid: nil)
        store.update(columns: 40)

        #expect(store.columns == 40)
        #expect(store.rows.count == 2)
    }

    /// Rows held from before the mode change were wrapped for another width, and
    /// every one of them is now wrong. Rebuilding is what makes the change atomic
    /// rather than something the next frame happens to fix.
    @Test func switchingModesRewrapsWhatIsAlreadyHeld() throws {
        let store = TerminalStore()
        store.update(columns: 40)
        store.apply(frame(lines: [try line(String(repeating: "x", count: 80))]))
        #expect(store.rows.count == 2)

        store.adopt(displayMode: .desktopDriven, desktopGrid: DesktopGrid(columns: 80, rows: 24))

        #expect(store.rows.count == 1)
    }

    /// A terminal whose size the phone has not been told yet cannot be shown as the
    /// desktop's grid, and claiming otherwise would wrap at a width nobody named.
    @Test func aMissingDesktopGridIsNotAdopted() throws {
        let store = TerminalStore()
        store.update(columns: 40)

        store.adopt(displayMode: .desktopDriven, desktopGrid: nil)

        #expect(store.displayMode == .phoneDriven)
        #expect(store.columns == 40)
    }
}
