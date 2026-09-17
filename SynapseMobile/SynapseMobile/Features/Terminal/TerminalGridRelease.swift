import Foundation

/// What became of a request to hand a terminal's grid back to the desktop.
///
/// Four endings, kept apart even though three of them lead to the same place. They
/// are three different reasons for the same restraint, and the reader's choice means
/// something different in each — a release that never left the phone is a standing
/// intention that a reconnect will carry out, while one that was sent and not
/// answered is a state nobody knows. Collapsing them into "not refused" would lose
/// the distinction the first one depends on.
enum GridReleaseOutcome: Equatable {
    /// Nothing left the phone: there was no claim to give back, or no computer to
    /// give it to. The reader's choice stays queued rather than being overturned —
    /// offline, switching to the desktop's layout is a wish for when it returns.
    case notSent
    /// The desktop refused. It has never drawn this terminal, so it has no shape of
    /// its own to restore, and the claim was handed back without the size moving.
    case refused
    /// The desktop took the grid back and put the terminal at its own shape.
    case handedBack
    /// Sent, and no answer arrived. Left alone: who is sizing the terminal now is
    /// not known, and guessing would be worse than waiting.
    case unanswered
}

/// Puts the session back under the phone's own sizing, or leaves the mode alone.
///
/// Only a refusal rolls back. The reader asked for the desktop's layout and the
/// desktop said it has none to give, so leaving the picker on that mode would
/// describe a state the phone is not in: the rows on screen are still wrapped at
/// the phone's width, and the label would be telling the reader otherwise.
///
/// The rollback re-claims the size, because that is what the mode now says. That is
/// a second round trip, and it settles: the grid the phone reports is the one it was
/// already rendering, so the desktop adopts it without the dimensions moving, and
/// the view is left with nothing further to react to.
@MainActor
func applyGridRelease(
    _ outcome: GridReleaseOutcome,
    for sessionId: String,
    to display: TerminalDisplaySettings
) {
    guard outcome == .refused else { return }
    display.setMode(.phoneDriven, for: sessionId)
}

/// Whether the phone may go on treating a terminal's grid as its own.
///
/// A summary is the only place the desktop's decision appears: taking the grid back
/// is a local act on the computer, and it reaches the phone as ownership moving off
/// this device. Both endings mean the same thing here — another phone holds it, or
/// nobody does — so the phone stops rendering a mode it can no longer honour.
enum GridClaimState: Equatable {
    /// Nothing to decide: the phone holds the grid, or never asked for it.
    case keep
    /// The phone asked to size this terminal and the grid is no longer its to size.
    case lost
}

/// Reads ownership out of a summary, against the phone's own identity.
///
/// The unowned case is the one that needs a previous value, and it is why this
/// takes two. A claim this phone has just made but the desktop has not adopted yet
/// *also* reads as unowned — the debounce, the round trip and the summary's own
/// interval all land inside that window — and rolling back then would undo the
/// reader's choice before it had a chance to take effect. Ownership that was this
/// phone's a moment ago and is nobody's now has no such explanation: the desktop
/// took it back.
func gridClaimState(
    previousOwnerId: String?,
    ownerId: String?,
    phoneClientInstanceId: String
) -> GridClaimState {
    if ownerId == phoneClientInstanceId { return .keep }
    // Another device holds it, so this one cannot, whoever thought otherwise.
    if ownerId != nil { return .lost }
    return previousOwnerId == phoneClientInstanceId ? .lost : .keep
}

/// Reads the desktop's answer, or its absence.
///
/// The reply carries no dimensions, so there is nothing to reconcile here — only
/// whether the grid was handed back.
func gridReleaseOutcome(for result: MobileIntentResult?) -> GridReleaseOutcome {
    guard let result else { return .unanswered }
    return result.outcome == "rejected" ? .refused : .handedBack
}
