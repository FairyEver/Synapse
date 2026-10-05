import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct NotificationStoreMutationTests {
    @Test(arguments: [false, true], NotificationFeedbackSequence.allCases)
    func aPendingNewReadOwnsFeedbackBeforeItsResult(deleting: Bool, sequence: NotificationFeedbackSequence) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let oldGate = NotificationMutationReviewGate()
        let newGate = NotificationMutationReviewGate()
        await store.load(using: api)
        if sequence.failsInRefresh {
            api.page = { _ in await oldGate.hold(); throw URLError(.timedOut) }
        } else {
            api.bulkMutation = { await oldGate.hold(); throw URLError(.timedOut) }
        }
        let old = Task {
            if deleting { await store.deleteAll(using: api) }
            else { await store.readAll(using: api) }
        }
        await oldGate.waitUntilHeld()
        api.mutation = { _ in
            await newGate.hold()
            if sequence.newReadFails { throw URLError(.notConnectedToInternet) }
        }
        let current = Task { await store.read("mail", using: api) }
        await newGate.waitUntilHeld()
        await oldGate.release()
        await old.value
        #expect(store.error == nil, "The older failure must not publish while the current read is pending")
        await newGate.release()
        await current.value
        #expect((store.error != nil) == sequence.newReadFails)
        if sequence.newReadFails {
            #expect(store.error == "标记已读失败")
            #expect(store.items.first?.readAt == nil)
        } else {
            #expect(store.items.first?.readAt != nil)
            #expect(store.unreadCount == 0)
        }
    }

    @Test(arguments: [false, true], [false, true])
    func anOldBulkRefreshCannotReplaceANewerMutationFailure(deleting: Bool, refreshFails: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        await store.load(using: api)
        api.bulkMutation = { await gate.hold() }
        let old = Task {
            if deleting { await store.deleteAll(using: api) }
            else { await store.readAll(using: api) }
        }
        await gate.waitUntilHeld()
        api.mutation = { _ in throw URLError(.notConnectedToInternet) }
        await store.read("other", using: api)
        let currentError = store.error
        #expect(currentError == "标记已读失败")
        api.page = { _ in
            if refreshFails { throw URLError(.timedOut) }
            return NotificationPage(items: deleting ? [] : [mutationNotification("mail", read: true)], nextCursor: nil)
        }
        await gate.release()
        await old.value
        #expect(store.error == currentError)
        #expect(api.cursors.count == 2, "The old mutation must still refresh its committed rows")
        if !refreshFails {
            #expect(store.unreadCount == 0)
            if deleting { #expect(store.items.isEmpty) }
            else { #expect(store.items.first?.readAt != nil) }
        }
    }

    @Test(arguments: [false, true])
    func anOldBulkFailureCannotReplaceANewerSuccessfulMutation(deleting: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        await store.load(using: api)
        api.bulkMutation = { await gate.hold(); throw URLError(.notConnectedToInternet) }
        let old = Task {
            if deleting { await store.deleteAll(using: api) }
            else { await store.readAll(using: api) }
        }
        await gate.waitUntilHeld()
        await store.read("mail", using: api)
        await gate.release()
        await old.value
        #expect(store.error == nil)
        #expect(store.items.first?.readAt != nil)
    }

    @Test func anOldEnsureFailureCannotReplaceTheCurrentMutationFailure() async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        api.detail = { _, _ in await gate.hold(); throw URLError(.timedOut) }
        let old = Task { await store.ensure("missing", using: api) }
        await gate.waitUntilHeld()
        api.mutation = { _ in throw URLError(.notConnectedToInternet) }
        await store.read("other", using: api)
        #expect(store.error == "标记已读失败")
        await gate.release()
        #expect(!(await old.value))
        #expect(store.error == "标记已读失败")
        #expect(store.items.isEmpty)
    }

    @Test(arguments: [false, true])
    func retryingAReadOrDeleteClearsItsOldFailureAfterFullSuccess(deleting: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        var succeeds = false
        api.mutation = { _ in if !succeeds { throw URLError(.notConnectedToInternet) } }
        api.count = { _ in succeeds ? 0 : 1 }
        await store.load(using: api)

        if deleting { await store.delete("mail", using: api) }
        else { await store.read("mail", using: api) }
        #expect(store.error != nil)
        #expect(store.items.first?.readAt == nil)
        #expect(store.unreadCount == 1)

        succeeds = true
        if deleting { await store.delete("mail", using: api) }
        else { await store.read("mail", using: api) }
        #expect(store.error == nil)
        #expect(store.unreadCount == 0)
        if deleting { #expect(store.items.isEmpty) }
        else { #expect(store.items.first?.readAt != nil) }
    }

    @Test(arguments: ["read", "delete", "load"])
    func anOldSuccessCannotClearANewerMutationFailure(operation: String) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        await store.load(using: api)
        if operation == "load" {
            api.page = { _ in await gate.hold(); return NotificationPage(items: [mutationNotification("mail")], nextCursor: nil) }
        } else {
            api.count = { _ in await gate.hold(); return 0 }
        }
        let old = Task {
            switch operation {
            case "read": await store.read("mail", using: api)
            case "delete": await store.delete("mail", using: api)
            default: await store.load(using: api)
            }
        }
        await gate.waitUntilHeld()
        api.mutation = { _ in throw URLError(.notConnectedToInternet) }
        await store.read("other", using: api)
        #expect(store.error == "标记已读失败")
        await gate.release()
        await old.value
        #expect(store.error == "标记已读失败")
    }

    @Test(arguments: [false, true])
    func anOldMutationFailureCannotReplaceASuccessfulRetry(deleting: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        await store.load(using: api)
        api.mutation = { _ in await gate.hold(); throw URLError(.notConnectedToInternet) }
        let old = Task {
            if deleting { await store.delete("mail", using: api) }
            else { await store.read("mail", using: api) }
        }
        await gate.waitUntilHeld()
        api.mutation = nil
        await store.read("mail", using: api)
        #expect(store.error == nil)
        await gate.release()
        await old.value
        #expect(store.error == nil)
        #expect(store.items.first?.readAt != nil)
    }

    @Test(arguments: [false, true], [false, true])
    func stalePagesCannotRestoreReadOrDeletedNotifications(pagination: Bool, deleting: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        await store.load(using: api, filter: "unread")
        api.page = { call in
            if call == 2 {
                await gate.hold()
                return NotificationPage(items: [mutationNotification("mail")], nextCursor: nil)
            }
            return NotificationPage(items: [], nextCursor: nil)
        }
        let request = Task {
            if pagination { await store.loadMore(using: api) }
            else { await store.load(using: api, filter: "unread") }
        }
        await gate.waitUntilHeld()
        if deleting { await store.delete("mail", using: api) }
        else { await store.read("mail", using: api) }
        await gate.release()
        await request.value
        #expect(store.items.isEmpty)
        #expect(api.cursors == [nil, pagination ? "older" : nil, pagination ? "older" : nil])
        #expect(!store.loading)
    }

    @Test func clearingAnAccountRejectsItsHeldPageAndCounts() async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        api.page = { _ in await gate.hold(); return NotificationPage(items: [mutationNotification("old")], nextCursor: nil) }
        let request = Task { await store.load(using: api) }
        await gate.waitUntilHeld()
        store.clear()
        await gate.release()
        await request.value
        #expect(store.items.isEmpty)
        #expect(store.unreadCount == 0)
        #expect(!store.loading)
    }

    @Test(arguments: [false, true])
    func aLateUnreadCountCannotUndoASuccessfulReadOrDelete(deleting: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        api.count = { call in
            if call == 1 { return 1 }
            if call == 2 { await gate.hold(); return 1 }
            return 0
        }
        await store.load(using: api)
        #expect(store.unreadCount == 1)
        let old = Task { await store.load(using: api) }
        await gate.waitUntilHeld()
        if deleting { await store.delete("mail", using: api) }
        else { await store.read("mail", using: api) }
        #expect(store.unreadCount == 0)
        await gate.release()
        await old.value
        #expect(store.unreadCount == 0)
        #expect(api.countCalls == 4)
    }

    @Test(arguments: [false, true])
    func aLateEnsureCannotRestoreADeletedNotification(deleteAll: Bool) async {
        let api = NotificationMutationReviewAPI()
        let store = NotificationStore()
        let gate = NotificationMutationReviewGate()
        api.page = { _ in NotificationPage(items: [], nextCursor: nil) }
        api.detail = { id, call in
            if call == 1 {
                await gate.hold()
                return mutationNotification(id)
            }
            throw APIError(status: 404, code: "not_found", message: "通知已删除")
        }
        let request = Task { await store.ensure("deleted", using: api) }
        await gate.waitUntilHeld()
        if deleteAll { await store.deleteAll(using: api) }
        else { await store.delete("deleted", using: api) }
        #expect(store.items.isEmpty)
        await gate.release()
        let found = await request.value
        #expect(!found, "失效通知不能继续导航到旧目标")
        #expect(store.items.isEmpty)
        #expect(api.detailCalls == ["deleted", "deleted"])
    }
}

enum NotificationFeedbackSequence: CaseIterable, Equatable {
    case parentFailureThenSuccess, parentFailureThenFailure
    case refreshFailureThenSuccess, refreshFailureThenFailure

    var failsInRefresh: Bool {
        self == .refreshFailureThenSuccess || self == .refreshFailureThenFailure
    }
    var newReadFails: Bool {
        self == .parentFailureThenFailure || self == .refreshFailureThenFailure
    }
}

private func mutationNotification(_ id: String, read: Bool = false) -> SynapseNotification {
    SynapseNotification(id: id, source: "external", title: id, body: "正文", group: nil, url: nil,
        level: "active", targetId: nil, deviceId: nil, readAt: read ? "2026-10-04T00:00:00Z" : nil,
        resolvedAt: nil, createdAt: "2026-10-04T00:00:00Z")
}

@MainActor
private final class NotificationMutationReviewAPI: NotificationStoreAPI {
    var cursors: [String?] = []
    var page: ((Int) async throws -> NotificationPage)?
    var countCalls = 0
    var count: ((Int) async -> Int)?
    var detailCalls: [String] = []
    var detail: ((String, Int) async throws -> SynapseNotification)?
    var mutation: ((String) async throws -> Void)?
    var bulkMutation: (() async throws -> Void)?
    @MainActor func listNotifications(filter: String, cursor: String?) async throws -> NotificationPage {
        cursors.append(cursor)
        return try await page?(cursors.count) ?? NotificationPage(items: [mutationNotification("mail")], nextCursor: "older")
    }
    @MainActor func notification(_ id: String) async throws -> SynapseNotification {
        detailCalls.append(id)
        return try await detail?(id, detailCalls.count) ?? mutationNotification(id, read: true)
    }
    @MainActor func notificationUnreadCount() async throws -> Int {
        countCalls += 1
        return await count?(countCalls) ?? 0
    }
    @MainActor func markNotificationRead(_ id: String) async throws { try await mutation?(id) }
    @MainActor func markAllNotificationsRead() async throws { try await bulkMutation?() }
    @MainActor func deleteNotification(_ id: String) async throws { try await mutation?(id) }
    @MainActor func deleteAllNotifications() async throws { try await bulkMutation?() }
}

private actor NotificationMutationReviewGate {
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
