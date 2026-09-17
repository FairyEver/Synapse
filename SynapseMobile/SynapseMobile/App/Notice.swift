import Foundation

/// How a notice should read, not how loudly it should shout.
///
/// Narrowed from the desktop's six tones (`desktop/src/app-shell/notifications.tsx`):
/// `warning` and `destructive` both mean "this did not happen, and you may want to try
/// again", and `default` and `loading` both mean "for your information". Three is what a
/// bar on a phone can draw differently without inventing a fourth meaning.
enum NoticeTone: String, CaseIterable, Sendable {
    case success
    case info
    case failure

    /// The desktop's own numbers, so the same event does not linger longer here than it
    /// does on the computer — `desktop/src/app-shell/notification-durations.ts` holds
    /// `DEFAULT_NOTIFICATION_DURATION_MS = 1000` and `ERROR_NOTIFICATION_DURATION_MS = 5000`.
    ///
    /// `info` takes the middle, which is the one number this app chooses rather than
    /// inherits: it is neither a confirmation that needs no reading nor a failure that
    /// has to be read.
    ///
    /// Deliberately pure. The VoiceOver stretch and the drag-pause floor both live in
    /// `SynapseAppModel`, so that what a tone means stays testable without a UI.
    var duration: Duration {
        switch self {
        case .success: .seconds(1)
        case .info: .seconds(3)
        case .failure: .seconds(5)
        }
    }
}

/// One message, from the moment it is posted to the moment it leaves.
///
/// A struct rather than an `@Observable` class on purpose: an edit to an element has to
/// travel through `NoticeQueue.notices` for observation to fire, and a reference type
/// would let `text` change with nothing that reads the queue noticing.
struct Notice: Identifiable, Equatable {
    /// Names the *message*, not the event. Posting an id that is already on screen
    /// replaces it rather than stacking a second copy.
    let id: String
    var text: String
    var tone: NoticeTone
    /// Bumped every time this id is posted again. The clock keys off this instead of off
    /// the view's identity, which is exactly the bug the old banner had: its `.task` ran
    /// once per view, so a message replacing another inherited the first one's countdown
    /// and could vanish half a second after it appeared.
    var revision: Int
}

/// The messages waiting to be seen.
///
/// Pure: it owns no clock and knows nothing about views. `SynapseAppModel` holds the
/// timers and reconciles them against `armed` after every change here, which is what
/// keeps the interesting part — what replaces what, and what falls off — unit-testable.
struct NoticeQueue: Equatable {
    /// Two is as many as fit above a terminal's input bar without covering the canvas
    /// they are reporting on. The single slot this replaces dropped the second of two
    /// simultaneous messages on the floor.
    static let maxVisible = 2
    /// A ceiling, because `sendFiles` posts one notice per refused file: a twenty-file
    /// drop must not queue twenty messages that each then take a turn on screen.
    static let maxPending = 5

    private(set) var notices: [Notice] = []

    /// The ones on screen, oldest first. Anything past this is waiting and spends no
    /// time on a clock — it gets its whole duration once it is actually shown.
    var armed: [Notice] { Array(notices.prefix(Self.maxVisible)) }

    /// Posts a message.
    ///
    /// - Returns: ids that fell off the end to make room, so their clocks can be stopped.
    @discardableResult
    mutating func post(_ text: String, tone: NoticeTone, id: String) -> [String] {
        if let index = notices.firstIndex(where: { $0.id == id }) {
            // Replaced where it stands rather than moved to the back: a message being
            // read must not jump position under the reader.
            notices[index].text = text
            notices[index].tone = tone
            // Bumped for a plain re-post as well as for new words. Posting the same
            // sentence again means it is news to whoever is looking, so the clock starts
            // over instead of running out the tail of the previous one.
            notices[index].revision += 1
            return []
        }

        notices.append(Notice(id: id, text: text, tone: tone, revision: 0))
        guard notices.count > Self.maxPending else { return [] }
        let overflow = notices.count - Self.maxPending
        let dropped = notices.prefix(overflow).map(\.id)
        notices.removeFirst(overflow)
        return dropped
    }

    mutating func remove(_ id: String) {
        notices.removeAll { $0.id == id }
    }

    mutating func removeAll() {
        notices.removeAll()
    }
}
