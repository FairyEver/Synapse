import Foundation
import Observation

@MainActor
protocol MailRecipientPickerAPI {
    func mailRecipients(query: String, cursor: String?) async throws -> MailRecipientPage
    func mailOrganizations(query: String) async throws -> MailOrganizationPage
}

extension SynapseAppModel: MailRecipientPickerAPI {}

@Observable @MainActor
final class MailRecipientPickerStore {
    private(set) var people: [MailRecipientCandidate] = []
    private(set) var organizations: [MailOrganization] = []
    private(set) var nextCursor: String?
    private(set) var loading = false
    private(set) var loadingMore = false
    private(set) var error: String?
    private var query = ""
    private var generation = 0

    func load(query rawQuery: String, using api: any MailRecipientPickerAPI) async {
        generation += 1
        let requestGeneration = generation
        query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let requestedQuery = query
        people = []
        organizations = []
        nextCursor = nil
        error = nil
        loading = true
        loadingMore = false
        defer { if requestGeneration == generation { loading = false } }
        do {
            if !requestedQuery.isEmpty { try await Task.sleep(for: .milliseconds(250)) }
            guard !Task.isCancelled, requestGeneration == generation else { return }
            async let peoplePage = api.mailRecipients(query: requestedQuery, cursor: nil)
            async let organizationPage = api.mailOrganizations(query: requestedQuery)
            let (page, groups) = try await (peoplePage, organizationPage)
            guard !Task.isCancelled, requestGeneration == generation else { return }
            people = page.items
            organizations = groups.items
            nextCursor = page.nextCursor
        } catch {
            if !Task.isCancelled, requestGeneration == generation { self.error = error.localizedDescription }
        }
    }

    func loadMore(using api: any MailRecipientPickerAPI) async {
        guard let cursor = nextCursor, !loading, !loadingMore else { return }
        let requestGeneration = generation
        let requestedQuery = query
        loadingMore = true
        error = nil
        defer { if requestGeneration == generation { loadingMore = false } }
        do {
            let page = try await api.mailRecipients(query: requestedQuery, cursor: cursor)
            guard !Task.isCancelled, requestGeneration == generation, nextCursor == cursor else { return }
            var known = Set(people.map(\.id))
            people += page.items.filter { known.insert($0.id).inserted }
            nextCursor = page.nextCursor
        } catch {
            if !Task.isCancelled, requestGeneration == generation { self.error = error.localizedDescription }
        }
    }
}
