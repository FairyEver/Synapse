import Foundation

@MainActor
protocol MailRecipientRestorationAPI {
    func mailRecipients(query: String, cursor: String?) async throws -> MailRecipientPage
}

extension SynapseAppModel: MailRecipientRestorationAPI {}

@MainActor
enum MailRecipientRestoration {
    struct Result {
        var to: [MailPerson] = []
        var cc: [MailPerson] = []
        var unresolvedTo: [String] = []
        var unresolvedCc: [String] = []
        var error: String?
    }

    /// Resolve the initial recipients as one result, before the picker can change
    /// them. Cancellation ends the sequence instead of making subsequent requests
    /// through a client that may already belong to the next signed-in account.
    static func restore(toIds: [String], ccIds: [String], using api: any MailRecipientRestorationAPI) async -> Result? {
        var result = Result()
        var seen = Set<String>()
        for id in toIds + ccIds where seen.insert(id).inserted {
            guard !Task.isCancelled else { return nil }
            let person: MailPerson?
            do {
                let page = try await api.mailRecipients(query: id, cursor: nil)
                guard !Task.isCancelled else { return nil }
                person = page.items.first { $0.userId == id }?.person
            } catch {
                guard !Task.isCancelled, !(error is CancellationError) else { return nil }
                person = nil
                result.error = error.localizedDescription
            }
            if toIds.contains(id) {
                if let person { result.to.append(person) }
                else { result.unresolvedTo.append(id) }
            } else {
                if let person { result.cc.append(person) }
                else { result.unresolvedCc.append(id) }
            }
        }
        return result
    }
}
