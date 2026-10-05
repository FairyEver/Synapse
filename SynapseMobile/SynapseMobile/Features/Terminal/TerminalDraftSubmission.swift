import Foundation
import Observation

/// A command acknowledgement can only consume the draft and attachments submitted with it.
@MainActor @Observable
final class TerminalDraftSubmission {
    enum Completion {
        case sent(clearDraft: Bool, attachmentIds: [String])
        case failed(String)
    }

    private(set) var sending = false

    func submit(
        ticket: TerminalDraftInsertion.Ticket,
        context: TerminalActionContext?,
        attachmentIds: [String],
        currentContext: () -> TerminalActionContext?,
        currentTicket: () -> TerminalDraftInsertion.Ticket,
        send: (String) async -> SynapseAppModel.CommandSendOutcome
    ) async -> Completion? {
        guard !sending, !ticket.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              currentContext() == context else { return nil }
        sending = true
        defer { sending = false }
        let outcome = await send(ticket.text)
        guard !Task.isCancelled, currentContext() == context else { return nil }
        switch outcome {
        case .sent:
            guard context != nil else { return nil }
            return .sent(clearDraft: currentTicket() == ticket, attachmentIds: attachmentIds)
        case .notSent(let message), .uncertain(let message):
            return .failed(message)
        }
    }
}
