import CoreGraphics
import Foundation
import UIKit

/// Who decides the grid the phone renders.
///
/// The two modes trade the same pair of things off against each other — how much
/// fits on screen, and whether the layout matches the computer's — so the choice
/// belongs to the reader rather than to either device.
enum TerminalDisplayMode: String, CaseIterable, Codable, Sendable {
    /// The phone's own grid is the terminal's grid: it tells the desktop what to
    /// adopt, so nothing has to be wrapped or scaled here. Long lines stay inside
    /// the screen, at the cost of a full-screen program reflowing to a narrow grid.
    case phoneDriven
    /// The desktop's grid is the terminal's grid: the phone renders it whole and
    /// scales it down. The layout matches the computer exactly, at the cost of
    /// text small enough to need pinching.
    case desktopDriven

    var label: String {
        switch self {
        case .phoneDriven: "优先移动端"
        case .desktopDriven: "优先还原"
        }
    }

    /// What the reader gives up by choosing it, shown alongside the label because
    /// neither mode is simply better than the other.
    var detail: String {
        switch self {
        case .phoneDriven: "电脑按本机格数渲染，长行不折行；全屏程序会按窄画布重排。"
        case .desktopDriven: "完整显示电脑整屏，布局与电脑一致；字可能很小，可双指放大。"
        }
    }
}

/// How tightly the grid is packed.
///
/// Each tier names a *cell width*, not a column count. Columns are what the screen
/// and the width together produce, so storing them would hard-code one device's
/// answer onto every other device; storing the cell instead keeps the reading
/// density the same across phones and orientations while the grid recomputes.
enum TerminalDensity: String, CaseIterable, Codable, Sendable {
    case compact
    case normal
    case spacious

    /// Width of one ASCII cell, in points. This is the axis a reader notices: it
    /// decides how much fits across the screen at once.
    var cellWidth: CGFloat {
        switch self {
        case .compact: 7.2
        case .normal: 8.4
        case .spacious: 10.2
        }
    }

    /// Derived from the cell width rather than written down again — two numbers
    /// describing one thing drift apart the first time either is tuned.
    var fontSize: CGFloat {
        TerminalFont.size(forCellWidth: cellWidth)
    }

    /// Derived from the face, not named. A cell shorter than the font's own line box
    /// clips glyphs, so the tier chooses the width and the face decides how tall a
    /// line has to be.
    var cellHeight: CGFloat {
        TerminalCellMetrics.rowHeight(forFontSize: fontSize)
    }

    var label: String {
        switch self {
        case .compact: "紧凑"
        case .normal: "正常"
        case .spacious: "稀疏"
        }
    }

    var detail: String {
        switch self {
        case .compact: "同屏内容最多"
        case .normal: "默认"
        case .spacious: "字大，久看不累"
        }
    }
}

/// The desktop's grid, as the phone last heard it.
///
/// Absent until the first summary arrives, which is why adopting it is conditional
/// rather than assumed: a terminal whose size the phone has not been told yet has
/// no desktop grid to render.
struct DesktopGrid: Equatable {
    let columns: Int
    let rows: Int
}

/// The grid's indivisible measurements.
///
/// One home for values that used to be separate constants in the view layer. The
/// edge inset is the clearest case: the number of columns and the row label's own
/// leading are the same measurement seen twice, and when they were two literals
/// nothing made a change to one imply a change to the other.
enum TerminalCellMetrics {
    /// Space between the pane's edge and the first column, and after the last.
    static let contentInset: CGFloat = 10

    /// Floor for the column count, so a pane measured mid-layout — before it has a
    /// width — cannot report a grid too narrow to hold a prompt.
    static let minimumColumns = 20

    /// Width of one ASCII cell at this size.
    ///
    /// Cached because the column report and every row's size both ask on each
    /// layout pass, and an uncached answer walks the font's metrics each time.
    static func advance(forFontSize size: CGFloat) -> CGFloat {
        let key = NSNumber(value: Double(size))
        if let cached = advanceCache.object(forKey: key) { return CGFloat(cached.doubleValue) }
        let measured = ("0" as NSString).size(withAttributes: [
            .font: TerminalFont.regular(ofSize: size),
        ]).width
        advanceCache.setObject(NSNumber(value: Double(measured)), forKey: key)
        return measured
    }

    /// One line's height.
    ///
    /// The line box, rounded up — and no more. There used to be an extra point on
    /// top, which left a hairline gap between every pair of rows: invisible in text,
    /// and plainly visible in a program that draws with full-block characters, where
    /// several rows are meant to join into one shape. A logo came out striped.
    static func rowHeight(forFontSize size: CGFloat) -> CGFloat {
        let key = NSNumber(value: Double(size))
        if let cached = rowHeightCache.object(forKey: key) { return CGFloat(cached.doubleValue) }
        let height = ceil(TerminalFont.regular(ofSize: size).lineHeight)
        rowHeightCache.setObject(NSNumber(value: Double(height)), forKey: key)
        return height
    }

    /// How many columns fit in a pane this wide.
    static func columns(fitting width: CGFloat, fontSize: CGFloat) -> Int {
        let advance = advance(forFontSize: fontSize)
        guard advance > 0 else { return 0 }
        let available = width - contentInset * 2
        return max(0, Int(available / advance))
    }

    /// How many rows fit in a pane this tall. Reported to the desktop alongside the
    /// column count, so both have to come from the same arithmetic.
    static func rows(fitting height: CGFloat, cellHeight: CGFloat) -> Int {
        guard cellHeight > 0 else { return 0 }
        return max(0, Int(height / cellHeight))
    }

    private static let advanceCache = NSCache<NSNumber, NSNumber>()
    private static let rowHeightCache = NSCache<NSNumber, NSNumber>()
}

/// Layout constants for the terminal pane, gathered so the display modes can be
/// tuned without hunting through the view.
enum TerminalDisplayConfig {
    /// How long a press has to hold still before it means "select", matching
    /// `UILongPressGestureRecognizer`'s own default. Below this a press is a
    /// scroll or a pan and must not steal the gesture.
    static let selectionHoldSeconds: TimeInterval = 0.5

    /// How far a press may drift and still count as held. Taken from
    /// `UIPanGestureRecognizer`'s slop: past this the reader is moving something.
    static let selectionDriftTolerance: CGFloat = 10

    /// Zoom limits for the desktop-grid mode, as multiples of the fit scale.
    static let minZoom: CGFloat = 1
    static let maxZoom: CGFloat = 6
    static let zoomStep: CGFloat = 1.35

    /// Vertical emptiness past which the grid is described as wide rather than
    /// tall, and landscape is worth suggesting.
    static let wideGridEmptyRatio: CGFloat = 0.4
}

/// The scale that makes one screen of the desktop's grid fit inside a pane.
///
/// Pure, and tested on its own, because it is the whole of what the desktop-grid
/// mode promises. Every part of it has been wrong at least once: the margins were
/// left out, which made the grid permanently a hair too wide for the pane and gave
/// the whole screen a few points of sideways travel it was never meant to have.
///
/// - Parameters:
///   - grid: the desktop's grid, in cells.
///   - paneSize: the space the grid has to fit inside.
///   - contentInset: padding on each side of a row. The grid fits *inside* this,
///     not merely equal to it.
///   - cellSize: one cell at the size the grid would be drawn at unscaled.
/// - Returns: at most 1, because enlarging past the desktop's own size is a
///   different claim than fitting it; and exactly 1 rather than 0 for a pane with
///   no size yet, so a measurement taken mid-layout cannot make the text vanish.
func terminalGridFitScale(
    grid: DesktopGrid,
    paneSize: CGSize,
    contentInset: CGFloat,
    cellSize: CGSize
) -> CGFloat {
    guard cellSize.width > 0, cellSize.height > 0 else { return 1 }
    let gridWidth = CGFloat(grid.columns) * cellSize.width
    let gridHeight = CGFloat(grid.rows) * cellSize.height
    guard gridWidth > 0, gridHeight > 0 else { return 1 }

    let usableWidth = paneSize.width - contentInset * 2
    let usableHeight = paneSize.height
    guard usableWidth > 0, usableHeight > 0 else { return 1 }

    // No lower bound. The mode's promise is the whole screen, and the reader
    // accepts small text as the price of it — that is the trade they picked this
    // mode for. A floor here would quietly turn "the whole screen, tiny" into
    // "part of the screen, legible", which is the other mode's behaviour.
    return min(1, min(usableWidth / gridWidth, usableHeight / gridHeight))
}

/// The width rows should be wrapped at.
///
/// One function, because there used to be two things deciding this — the view's own
/// measurement and a display mode carried separately by the store — and when they
/// disagreed the rows were wrapped at one width while the cells were sized for
/// another. That is not a subtle failure: text hugs the left of a box built for a
/// wider grid, the right margin is empty, and the whole screen is taller than it
/// should be because every line was wrapped early.
///
/// - Parameters:
///   - displayMode: which device's grid the terminal is being shown at.
///   - desktopGrid: the computer's grid, absent until the phone has been told it.
///   - paneWidth: the space the rows have to fit in, used only when the phone's own
///     width is what decides.
///   - fontSize: the size the rows will be drawn at, which is what turns the pane's
///     width into a column count.
func terminalWrapColumns(
    displayMode: TerminalDisplayMode,
    desktopGrid: DesktopGrid?,
    paneWidth: CGFloat,
    fontSize: CGFloat
) -> Int {
    // The computer's grid, whenever that is what is being shown. Re-wrapping at the
    // phone's width here is the one thing this mode exists to avoid.
    if displayMode == .desktopDriven, let desktopGrid, desktopGrid.columns > 0 {
        return desktopGrid.columns
    }
    guard fontSize > 0 else { return TerminalCellMetrics.minimumColumns }
    return max(
        TerminalCellMetrics.minimumColumns,
        TerminalCellMetrics.columns(fitting: paneWidth, fontSize: fontSize)
    )
}
