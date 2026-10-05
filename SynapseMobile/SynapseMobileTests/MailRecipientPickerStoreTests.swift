import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MailRecipientPickerStoreTests {
    @Test func anOldPageCannotAppendAfterSearchingAnotherQueryAndReturning() async {
        let api = RecipientPickerReviewAPI()
        let store = MailRecipientPickerStore()
        let gate = RecipientPickerReviewGate()
        await store.load(query: "A", using: api)
        api.page = { query, cursor in
            if cursor != nil { await gate.hold() }
            return pickerPage(cursor == nil ? query : "stale")
        }
        let old = Task { await store.loadMore(using: api) }
        await gate.waitUntilHeld()
        await store.load(query: "B", using: api)
        await store.load(query: "A", using: api)
        await gate.release()
        await old.value
        #expect(store.people.map(\.id) == ["A"])
        #expect(store.nextCursor == "next")
        #expect(!store.loadingMore)
    }

    @Test func repeatedPaginationIsRequestedOnceAndOverlappingPeopleAreDeduplicated() async {
        let api = RecipientPickerReviewAPI()
        let store = MailRecipientPickerStore()
        let gate = RecipientPickerReviewGate()
        await store.load(query: "", using: api)
        api.page = { _, _ in
            await gate.hold()
            return MailRecipientPage(items: [pickerPerson(""), pickerPerson("new")], nextCursor: nil)
        }
        let page = Task { await store.loadMore(using: api) }
        await gate.waitUntilHeld()
        await store.loadMore(using: api)
        #expect(api.peopleCalls == 2)
        await gate.release()
        await page.value
        #expect(store.people.map(\.id) == ["", "new"])
        #expect(!store.loadingMore)
    }

    @Test func anOldSearchResponseCannotReplaceTheCurrentSearch() async {
        let api = RecipientPickerReviewAPI()
        let store = MailRecipientPickerStore()
        let gate = RecipientPickerReviewGate()
        api.page = { query, _ in
            if query == "old" { await gate.hold() }
            return pickerPage(query)
        }
        let old = Task { await store.load(query: "old", using: api) }
        await gate.waitUntilHeld()
        await store.load(query: "new", using: api)
        await gate.release()
        await old.value
        #expect(store.people.map(\.id) == ["new"])
        #expect(!store.loading)
    }
}

private func pickerPerson(_ id: String) -> MailRecipientCandidate {
    MailRecipientCandidate(userId: id, nickname: id, handle: nil, matchKind: "exact", similarity: 1, sharedTeamIds: [])
}
private func pickerPage(_ id: String) -> MailRecipientPage {
    MailRecipientPage(items: [pickerPerson(id)], nextCursor: "next")
}

@MainActor
private final class RecipientPickerReviewAPI: MailRecipientPickerAPI {
    var peopleCalls = 0
    var page: ((String, String?) async -> MailRecipientPage)?
    func mailRecipients(query: String, cursor: String?) async throws -> MailRecipientPage {
        peopleCalls += 1
        return await page?(query, cursor) ?? pickerPage(query)
    }
    func mailOrganizations(query: String) async throws -> MailOrganizationPage { MailOrganizationPage(items: []) }
}

private actor RecipientPickerReviewGate {
    private var held = false
    private var released = false
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
    func hold() async {
        held = true
        heldWaiters.forEach { $0.resume() }
        heldWaiters.removeAll()
        if !released { await withCheckedContinuation { releaseWaiters.append($0) } }
    }
    func waitUntilHeld() async {
        if !held { await withCheckedContinuation { heldWaiters.append($0) } }
    }
    func release() {
        released = true
        releaseWaiters.forEach { $0.resume() }
        releaseWaiters.removeAll()
    }
}
