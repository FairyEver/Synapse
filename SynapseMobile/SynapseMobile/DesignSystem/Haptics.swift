import UIKit

/// The app's touch feedback, in one place so the same kind of action always feels
/// the same.
///
/// It exists because the alternative — a generator built at each call site — is how
/// two buttons that do the same thing end up feeling different.
///
/// Every call is fire-and-forget: a phone without a haptic engine, or a user who
/// has turned haptics off in Settings, simply gets nothing, and nothing here reads
/// that back. There is no branch to write.
///
/// ## What earns a buzz
///
/// Not "which generator suits this control" — whether the reader already knows the
/// answer. Feedback pays for itself when the screen cannot say what happened
/// *where the eyes and fingers are*: a finger over the transcript it just produced,
/// a phone held to the ear, a call arriving with the app in the background. It pays
/// again when the outcome is a verdict this app exists to deliver, and once more
/// when an action cannot be taken back.
///
/// It is noise when the screen already said it and the action is trivially
/// reversible. That is why nothing below is called for a keystroke, a scroll, a
/// frame of terminal output, or a progress tick — and why a burst of live typing
/// keeps its one `select()` per key rather than being dressed up further.
///
/// ## One outcome, one buzz
///
/// A result is felt once. Failure notices already fire `failure()` from the queue
/// itself (`SynapseAppModel.notice`), so the call site that raises one must not also
/// fire its own; that is the whole reason the notice path does the failing and the
/// call sites do the succeeding. Two buzzes half a second apart do not read as
/// emphasis, they read as a bug.
enum Haptics {
    // MARK: - Generators

    /// Kept rather than rebuilt, because the first tap of a new generator is the one
    /// that can miss.
    ///
    /// `UIImpactFeedbackGenerator` has to wake the Taptic Engine, and a generator made
    /// in the same breath as the event can have its event arrive before the engine is
    /// up. On a press that is already making the user wait — the one that starts a
    /// microphone — that is the difference between "your press registered" and
    /// "nothing happened". Firing and then preparing for *the next* one leaves the
    /// engine warm through a burst of interaction and lets it cool on its own
    /// afterwards, which is the trade the platform intends.
    private static let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private static let mediumImpact = UIImpactFeedbackGenerator(style: .medium)
    private static let selectionGenerator = UISelectionFeedbackGenerator()
    private static let notificationGenerator = UINotificationFeedbackGenerator()

    private static func impact(_ generator: UIImpactFeedbackGenerator) {
        generator.impactOccurred()
        // For the next event, not this one: free when nothing follows, and the whole
        // saving when something does.
        generator.prepare()
    }

    private static func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        notificationGenerator.notificationOccurred(type)
        notificationGenerator.prepare()
    }

    // MARK: - Steps and commits

    /// A control that commits something — send, confirm. Light, because it happens
    /// on every message and a heavier tap wears out.
    static func commit() {
        impact(lightImpact)
    }

    /// A control that marks a step rather than completing one — a quick key, a chip,
    /// a drag that crossed onto a new row of the canvas.
    static func select() {
        selectionGenerator.selectionChanged()
        selectionGenerator.prepare()
    }

    /// The microphone opening or closing. Medium, and distinct from `commit`,
    /// because whether the phone is recording is not something the screen can say
    /// while the phone is being held to the ear.
    static func record() {
        impact(mediumImpact)
    }

    /// A finger has come to rest on the terminal canvas and a selection is starting.
    ///
    /// The same weight as `record` on purpose: both mean "a mode with no button has
    /// begun", and the two never coincide — the canvas cannot be reached while the
    /// voice panel is up. Two names for one weight is cheaper than two feelings for
    /// two ideas.
    static func selectionBegin() {
        impact(mediumImpact)
    }

    // MARK: - Verdicts

    /// The app was asked to do something and it did not happen — a refused file, a
    /// command the computer rejected, a recording that never started.
    ///
    /// Heavier than the impacts above because it is the one verdict a reader can
    /// miss entirely: a failure that only changes a line of text looks, from a
    /// finger's distance, exactly like nothing having been pressed.
    static func failure() {
        notification(.error)
    }

    /// It worked, and the screen may not be where the reader is looking — a long
    /// upload landing on the computer, a conversation that took ten seconds to open.
    static func success() {
        notification(.success)
    }

    /// The app needs an answer, or the input was refused by a limit rather than by
    /// an error: an agent waiting on confirmation, a recording cut short by a phone
    /// call, a gesture that asked for more zoom than there is.
    ///
    /// Sits between the other two — not a failure, but not something to be missed
    /// either.
    static func warning() {
        notification(.warning)
    }
}
