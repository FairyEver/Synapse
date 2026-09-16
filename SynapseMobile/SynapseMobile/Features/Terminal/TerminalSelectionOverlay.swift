import UIKit

/// The moving parts of a text selection: the two handles, and the system loupe.
///
/// Kept out of the collection view because these are views with geometry of their
/// own, and because the loupe is a session that has to be begun and ended exactly
/// once per gesture — a lifetime neither the data source nor the layout has any
/// business holding. The collection view owns one of these and tells it where the
/// selection's two ends currently are.
@MainActor
final class TerminalSelectionOverlay {
    /// One end of the selection: a bar up to the cell it marks, and a knob at the
    /// free end so it reads as something to grab.
    ///
    /// Drawn rather than composed from a symbol, because the bar has to be exactly
    /// one line tall at whatever density the reader chose, and a symbol would be
    /// scaled to some other height.
    private final class Handle: UIView {
        private static let knobSize: CGFloat = 14
        private static let barWidth: CGFloat = 2

        private let bar = UIView()
        private let knob = UIView()
        /// The knob sits at the end away from the text, so the two handles read as
        /// brackets around the selection rather than as two of the same thing.
        private let knobAtTop: Bool

        init(knobAtTop: Bool) {
            self.knobAtTop = knobAtTop
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            for part in [bar, knob] {
                part.backgroundColor = .tintColor
                addSubview(part)
            }
            knob.layer.cornerRadius = Self.knobSize / 2
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func layoutSubviews() {
            super.layoutSubviews()
            bar.frame = CGRect(
                x: (bounds.width - Self.barWidth) / 2,
                y: 0,
                width: Self.barWidth,
                height: bounds.height
            )
            knob.frame = CGRect(
                x: (bounds.width - Self.knobSize) / 2,
                y: knobAtTop ? -Self.knobSize / 2 : bounds.height - Self.knobSize / 2,
                width: Self.knobSize,
                height: Self.knobSize
            )
        }
    }

    private let startHandle = Handle(knobAtTop: true)
    private let endHandle = Handle(knobAtTop: false)
    private var loupe: UITextLoupeSession?

    /// Adds the handles to the view they are positioned within.
    func attach(to view: UIView) {
        view.addSubview(startHandle)
        view.addSubview(endHandle)
        hide()
    }

    /// Places the two handles, in the coordinate space they were attached to.
    func layout(start: CGRect, end: CGRect) {
        startHandle.frame = start
        endHandle.frame = end
        startHandle.isHidden = false
        endHandle.isHidden = false
    }

    func hide() {
        startHandle.isHidden = true
        endHandle.isHidden = true
    }

    // MARK: - Loupe

    /// The system's own magnifier, which is what the reader already knows from
    /// selecting text anywhere else in iOS — so this is the one piece of the
    /// gesture that should not be invented here.
    ///
    /// `caretRect` is what the loupe centres on when it is tracking the caret rather
    /// than the finger; passing it means the magnification follows the cell the
    /// selection has reached, including when the finger has run past the end of a
    /// row and the cell is no longer under it.
    func beginLoupe(at point: CGPoint, caretRect: CGRect, in view: UIView) {
        loupe?.invalidate()
        loupe = UITextLoupeSession.begin(
            at: point,
            fromSelectionWidgetView: nil,
            in: view
        )
        loupe?.move(to: point, withCaretRect: caretRect, trackingCaret: true)
    }

    func moveLoupe(to point: CGPoint, caretRect: CGRect) {
        loupe?.move(to: point, withCaretRect: caretRect, trackingCaret: true)
    }

    func endLoupe() {
        loupe?.invalidate()
        loupe = nil
    }
}
