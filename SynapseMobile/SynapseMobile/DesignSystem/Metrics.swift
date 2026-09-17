import CoreGraphics

/// The numbers the layout is held to, as opposed to the numbers it happens to have.
enum Metrics {
    /// Apple's minimum tappable area, in points.
    ///
    /// A floor rather than a preference. A control is drawn at the size it reads at
    /// and handed this much room to be hit in — drawn-and-tappable being the same
    /// rectangle is what left several bars shorter than a finger.
    ///
    /// It deliberately does not scale with Dynamic Type. Icons and targets stay put
    /// while text grows: a target that grew with the text would take its room from
    /// the terminal canvas, which is the one thing on this screen that cannot be
    /// given back.
    static let minimumTapTarget: CGFloat = 44
}
