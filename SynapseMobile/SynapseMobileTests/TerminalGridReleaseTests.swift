import Foundation
import Testing

@testable import SynapseMobile

/// What the phone does with the desktop's answer to handing a grid back.
///
/// The reader picks a display mode and the phone then has to actually be in it.
/// Asking the desktop to take the grid back can fail — a terminal the desktop has
/// never drawn has no shape of its own to restore — and when it does, leaving the
/// picker where the reader put it means the label promises the computer's layout
/// while the rows on screen are still wrapped at the phone's width. That is the
/// reader being told something untrue about their own screen, so a refusal rolls
/// the mode back.
///
/// The other endings are the point of the rest of these: only a refusal is a fact
/// about the grid. A release the phone never sent is the reader's own choice still
/// waiting to take effect, and one that was sent without an answer leaves nobody
/// knowing who is sizing the terminal — guessing there would be worse than waiting.
@MainActor
struct TerminalGridReleaseTests {
    /// A store of its own, because the app persists display modes per session and a
    /// test that leaked into the app's defaults would leave a real terminal on a
    /// mode nobody chose.
    private func settings() -> TerminalDisplaySettings {
        let suite = UserDefaults(suiteName: "TerminalGridReleaseTests.\(UUID().uuidString)")
        return TerminalDisplaySettings(defaults: suite ?? .standard)
    }

    private func answer(
        _ outcome: String,
        code: String? = nil,
        sessionId: String = "s1"
    ) -> MobileIntentResult {
        MobileIntentResult(
            intentId: UUID().uuidString,
            outcome: outcome,
            code: code,
            message: nil,
            sessionId: sessionId,
            createdSessionId: nil,
            landedPath: nil
        )
    }

    /// The refusal the desktop actually sends for a terminal it has never drawn.
    private func refusal(sessionId: String = "s1") -> MobileIntentResult {
        answer("rejected", code: "desktop_grid_unknown", sessionId: sessionId)
    }

    /// The reader asked for the computer's layout and did not get it, so the mode
    /// they see has to go back to the one the terminal is really in.
    @Test func aRefusalPutsTheModeBackToThePhone() {
        let display = settings()
        display.setMode(.desktopDriven, for: "s1")

        applyGridRelease(
            gridReleaseOutcome(for: refusal()),
            for: "s1",
            to: display
        )

        #expect(display.mode(for: "s1") == .phoneDriven)
    }

    /// The desktop took the grid and re-fit, so the mode the reader picked is now
    /// true and nothing here has anything to do.
    @Test func anAcceptedReleaseLeavesTheModeAlone() {
        let display = settings()
        display.setMode(.desktopDriven, for: "s1")

        applyGridRelease(
            gridReleaseOutcome(for: answer("accepted")),
            for: "s1",
            to: display
        )

        #expect(display.mode(for: "s1") == .desktopDriven)
    }

    /// No answer leaves the state unknown. Rolling back on a guess would fight the
    /// reader over a grid that may well have changed hands already.
    @Test func aReleaseNobodyAnsweredLeavesTheModeAlone() {
        let display = settings()
        display.setMode(.desktopDriven, for: "s1")

        applyGridRelease(
            gridReleaseOutcome(for: nil),
            for: "s1",
            to: display
        )

        #expect(display.mode(for: "s1") == .desktopDriven)
    }

    /// Nothing was sent, so nothing was refused. Offline, switching modes is a wish
    /// for when the computer comes back — undoing it here is the phone arguing with
    /// the reader about a choice it never got to make.
    @Test func aReleaseThatNeverLeftThePhoneLeavesTheModeAlone() {
        let display = settings()
        display.setMode(.desktopDriven, for: "s1")

        applyGridRelease(.notSent, for: "s1", to: display)

        #expect(display.mode(for: "s1") == .desktopDriven)
    }

    /// One terminal's refusal says nothing about any other terminal the reader has
    /// open, and the modes are kept per session for exactly that reason.
    @Test func onlyTheTerminalThatWasReleasedMoves() {
        let display = settings()
        display.setMode(.desktopDriven, for: "s1")
        display.setMode(.desktopDriven, for: "s2")

        applyGridRelease(
            gridReleaseOutcome(for: refusal(sessionId: "s1")),
            for: "s1",
            to: display
        )

        #expect(display.mode(for: "s1") == .phoneDriven)
        #expect(display.mode(for: "s2") == .desktopDriven)
    }

    /// Only a refusal reads as one. `no_op` is the third outcome the protocol can
    /// send, and it is not a refusal — reading it as one would roll the mode back
    /// after the desktop had already agreed.
    @Test func onlyARejectionReadsAsARefusal() {
        #expect(gridReleaseOutcome(for: refusal()) == .refused)
        #expect(gridReleaseOutcome(for: answer("accepted")) == .handedBack)
        #expect(gridReleaseOutcome(for: answer("no_op")) == .handedBack)
        #expect(gridReleaseOutcome(for: nil) == .unanswered)
    }

    // MARK: - Ownership moving in a summary

    /// The desktop's pane offers its own release, and this is how the phone learns
    /// it was used: ownership that was this phone's and is now nobody's.
    @Test func aGridTheDesktopTookBackReadsAsLost() {
        #expect(gridClaimState(previousOwnerId: "phone-1", ownerId: nil, phoneClientInstanceId: "phone-1") == .lost)
    }

    /// Another phone asked for the size. Two phones cannot both be deciding one
    /// terminal's grid, so this one has to stop saying it is.
    @Test func aGridAnotherPhoneTookReadsAsLost() {
        #expect(gridClaimState(previousOwnerId: "phone-1", ownerId: "phone-2", phoneClientInstanceId: "phone-1") == .lost)
    }

    /// The claim this phone just made has not reached the desktop yet, and until it
    /// does the summary describes a terminal nobody is sizing. Reading that as a
    /// loss would undo the reader's choice inside the debounce that carries it.
    @Test func aClaimNotYetAdoptedIsNotALoss() {
        #expect(gridClaimState(previousOwnerId: nil, ownerId: nil, phoneClientInstanceId: "phone-1") == .keep)
        #expect(gridClaimState(previousOwnerId: "phone-2", ownerId: nil, phoneClientInstanceId: "phone-1") == .keep)
    }

    /// The ordinary case for a terminal at the computer's own size, and for one this
    /// phone is already sizing: nothing here moves either.
    @Test func aGridThisPhoneHoldsIsKept() {
        #expect(gridClaimState(previousOwnerId: nil, ownerId: "phone-1", phoneClientInstanceId: "phone-1") == .keep)
        #expect(gridClaimState(previousOwnerId: "phone-1", ownerId: "phone-1", phoneClientInstanceId: "phone-1") == .keep)
    }
}
