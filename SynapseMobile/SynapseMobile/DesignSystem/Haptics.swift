import UIKit

/// The app's touch feedback, in one place so the same kind of action always feels
/// the same.
///
/// It exists because the alternative — a generator built at each call site — is how
/// two buttons that do the same thing end up feeling different. The terminal's own
/// canvas already fires its own feedback for selection; these are for the bars.
///
/// Every call is fire-and-forget: a phone without a haptic engine, or a user who
/// has turned haptics off in Settings, simply gets nothing, and nothing here reads
/// that back. There is no branch to write.
enum Haptics {
    /// A control that commits something — send, confirm. Light, because it happens
    /// on every message and a heavier tap wears out.
    static func commit() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    /// A control that marks a step rather than completing one — a quick key, a chip.
    static func select() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    /// The microphone opening or closing. Medium, and distinct from `commit`,
    /// because whether the phone is recording is not something the screen can say
    /// while the phone is being held to the ear.
    static func record() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}
