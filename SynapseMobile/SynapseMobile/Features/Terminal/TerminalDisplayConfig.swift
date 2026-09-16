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

    /// One line's height, rounded up so rows tile without seams between them.
    static func rowHeight(forFontSize size: CGFloat) -> CGFloat {
        let key = NSNumber(value: Double(size))
        if let cached = rowHeightCache.object(forKey: key) { return CGFloat(cached.doubleValue) }
        let height = ceil(TerminalFont.regular(ofSize: size).lineHeight) + 1
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

    /// Below this the fit is refused and the pane scrolls sideways instead. A grid
    /// scaled past legibility is not "the whole screen", it is an unreadable one.
    static let minimumReadableFontSize: CGFloat = 8

    /// Vertical emptiness past which the grid is described as wide rather than
    /// tall, and landscape is worth suggesting.
    static let wideGridEmptyRatio: CGFloat = 0.4
}
