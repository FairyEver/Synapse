import Foundation
import Observation

@MainActor
protocol MailOrganizationMemberAPI {
    func mailOrganizationMembers(id: String, cursor: String?) async throws -> MailOrganizationMemberPage
}

extension SynapseAppModel: MailOrganizationMemberAPI {}

@MainActor
@Observable
final class MailOrganizationMemberStore {
    private(set) var organizationId: String?
    private(set) var members: [MailPerson] = []
    private(set) var nextCursor: String?
    private(set) var loading = false
    private(set) var error: String?
    private var generation = 0

    func load(id: String, cursor: String? = nil, using api: any MailOrganizationMemberAPI) async {
        if let cursor {
            guard organizationId == id, nextCursor == cursor, !loading else { return }
        } else {
            guard organizationId != id || !loading else { return }
            organizationId = id
            members = []
            nextCursor = nil
        }
        generation += 1
        let requestGeneration = generation
        loading = true
        error = nil
        defer { if requestGeneration == generation { loading = false } }
        do {
            let page = try await api.mailOrganizationMembers(id: id, cursor: cursor)
            guard requestGeneration == generation, organizationId == id else { return }
            var known = Set(members.map(\.userId))
            members += page.items.filter { known.insert($0.userId).inserted }
            nextCursor = page.nextCursor
        } catch {
            if requestGeneration == generation, organizationId == id { self.error = error.localizedDescription }
        }
    }
}
