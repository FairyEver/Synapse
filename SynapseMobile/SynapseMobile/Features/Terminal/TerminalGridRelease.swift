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

/// Watches who owns each terminal's grid across summaries, and names the claims that
/// move off this phone.
///
/// A summary is the only place the desktop's decision appears: taking the grid back
/// is a local act on the computer, and it reaches the phone as ownership moving off
/// this device. Both endings mean the same thing here — another phone holds it, or
/// nobody does — so the phone stops rendering a mode it can no longer honour.
///
/// This is a ledger rather than a per-screen check because the claim outlives the
/// screen: leaving a terminal sends `detach`, which releases the write lease but not
/// the grid. The desktop's release can therefore land while the reader is on the
/// session list, where no terminal view is mounted to hear about it, and the claim
/// would go on being believed until the next reconnect re-asserted it.
///
/// It remembers rather than compares because the unowned case needs a before. A
/// claim this phone has just made and the desktop has not adopted yet *also* reads
/// as unowned — the debounce, the round trip and the summary's own interval all land
/// inside that window — and rolling back there would undo the reader's choice before
/// it had a chance to take effect.
struct GridClaimLedger {
    /// Sessions whose last summary named this phone as the grid's owner.
    private var claims: Set<String> = []

    /// Records one summary and returns the sessions whose claim this phone lost.
    ///
    /// A session the ledger has not seen before cannot have lost anything: the first
    /// summary about it says what is, not what changed.
    mutating func apply(
        sessions: [MobileSummarySession],
        phoneClientInstanceId: String
    ) -> [String] {
        var lost: [String] = []
        var live: Set<String> = []
        for session in sessions {
            live.insert(session.id)
            if session.gridOwnerId == phoneClientInstanceId {
                claims.insert(session.id)
            } else if claims.contains(session.id) {
                claims.remove(session.id)
                lost.append(session.id)
            }
        }
        // Terminals that have ended say nothing more, and a ledger that kept them
        // would grow with every terminal the reader ever opened.
        claims.formIntersection(live)
        return lost
    }
}

/// Reads the desktop's answer, or its absence.
///
/// The reply carries no dimensions, so there is nothing to reconcile here — only
/// whether the grid was handed back.
func gridReleaseOutcome(for result: MobileIntentResult?) -> GridReleaseOutcome {
    guard let result else { return .unanswered }
    return result.outcome == "rejected" ? .refused : .handedBack
}
