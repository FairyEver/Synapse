import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct TodoStoreTests {
    @Test func lostReceiptCanRetryTheSameIntentAfterItsReminderTime() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore(), before = Date(timeIntervalSince1970: 4_000_000_020)
        store.openEditor(); store.draft?.title = "报告"; store.draft?.reminder = .custom
        store.draft?.customRemindAt = before.addingTimeInterval(60)
        let original = try #require(store.draft)
        fixture.transport.enqueue(.failure(.networkConnectionLost))
        do { _ = try await store.save(original, using: fixture.api, now: before); Issue.record("lost response must fail") }
        catch { #expect(!store.isSaving && store.draft?.clientRequestId == original.clientRequestId) }
        let after = before.addingTimeInterval(61), retry = try #require(store.draft)
        #expect(retry.validationMessage(now: after) == nil)
        #expect(retry.validationMessage(now: before.addingTimeInterval(86_400)) != nil)
        var changed = retry; changed.note = "新的意图"
        #expect(changed.validationMessage(now: after) != nil)
        fixture.transport.enqueue(.json(201, TodoTestFixture.itemJSON()), .json(200, TodoTestFixture.pageJSON([])))
        _ = try await store.save(retry, using: fixture.api, now: after)
        #expect(fixture.transport.requests[0].body == fixture.transport.requests[1].body)
        #expect(store.draft == nil)
    }

    @Test func offlineSaveFailsAndRequiresAnExplicitRetry() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore(); store.openEditor(); store.draft?.title = "报告"
        let original = try #require(store.draft)
        fixture.transport.enqueue(.failure(.notConnectedToInternet))
        do { _ = try await store.save(original, using: fixture.api); Issue.record("offline save must fail") }
        catch { #expect(!store.isSaving && store.draft?.clientRequestId == original.clientRequestId) }
        fixture.transport.enqueue(.json(201, TodoTestFixture.itemJSON()), .json(200, TodoTestFixture.pageJSON([])))
        await Task.yield()
        #expect(fixture.transport.requests.count == 1)
        _ = try await store.save(try #require(store.draft), using: fixture.api)
        #expect(fixture.transport.requests[0].body == fixture.transport.requests[1].body)
    }
    @Test func sameAccountReloginRejectsLateResult() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore()
        store.reset(accountGeneration: 1)
        store.openEditor(try TodoTestFixture.item())
        fixture.transport.enqueue(.held)
        let reading = Task { await store.reload(using: fixture.api) }
        #expect(await fixture.waitForRequests(1))
        store.reset(accountGeneration: 3)
        fixture.transport.finish(0, body: TodoTestFixture.pageJSON([TodoTestFixture.itemJSON()]))
        await reading.value
        #expect(store.items.isEmpty && store.draft == nil && store.undoItem == nil)
        #expect(store.errorMessage == nil)
    }

    @Test func pageFilterVersionRaceAndFailureKeepsLoadedRows() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore(); store.reset(accountGeneration: 1)
        fixture.transport.enqueue(.json(200, TodoTestFixture.pageJSON([TodoTestFixture.itemJSON(version: 3)], nextOffset: 50)),
            .json(200, TodoTestFixture.pageJSON([TodoTestFixture.itemJSON(version: 2)])), .json(503, #"{"message":"offline"}"#))
        await store.reload(using: fixture.api)
        await store.loadMore(using: fixture.api)
        #expect(store.items.count == 1 && store.items[0].version == 3 && store.nextOffset == nil)
        await store.reload(using: fixture.api)
        #expect(store.items.first?.version == 3 && store.errorMessage != nil)
        fixture.transport.enqueue(.held, .json(200, TodoTestFixture.pageJSON([TodoTestFixture.itemJSON(id: "all", completed: true)])))
        let pending = Task { await store.reload(using: fixture.api) }
        #expect(await fixture.waitForRequests(4))
        store.selectFilter(.all)
        await store.reload(using: fixture.api)
        fixture.transport.finish(3, body: TodoTestFixture.pageJSON([TodoTestFixture.itemJSON(id: "old")]))
        await pending.value
        #expect(store.items.map(\.id) == ["all"])
    }

    @Test func resetAlsoDropsLateMutationAndKeepsNewEditor() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore(); store.reset(accountGeneration: 1)
        store.openEditor(try TodoTestFixture.item())
        let outgoing = try #require(store.draft)
        fixture.transport.enqueue(.held)
        let writing = Task { try await store.save(outgoing, using: fixture.api) }
        #expect(await fixture.waitForRequests(1))
        store.reset(accountGeneration: 3)
        store.openEditor()
        store.draft?.title = "新账号草稿"
        fixture.transport.finish(0, body: TodoTestFixture.itemJSON(version: 2))
        do { _ = try await writing.value; Issue.record("late mutation must be rejected") }
        catch { #expect((error as? APIError)?.code == "credential_changed") }
        #expect(store.items.isEmpty && store.draft?.title == "新账号草稿" && store.editorError == nil)
        #expect(!store.isSaving && store.writingIDs.isEmpty)
    }

    @Test func completionReceiptUndoDoesNotOverwriteOtherClient() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore(); store.reset(accountGeneration: 1)
        let item = try TodoTestFixture.item()
        fixture.transport.enqueue(.json(200, TodoTestFixture.itemJSON(version: 2, completed: true)),
            .json(200, TodoTestFixture.pageJSON([])), .json(409, #"{"code":"TODO_VERSION_CONFLICT","message":"changed"}"#),
            .json(200, TodoTestFixture.pageJSON([TodoTestFixture.itemJSON(version: 3, completed: true)])))
        _ = try await store.setCompleted(item, completed: true, using: fixture.api)
        #expect(store.undoItem?.version == 2)
        store.selectFilter(.all)
        do { try await store.undoCompletion(using: fixture.api); Issue.record("undo must conflict") }
        catch { #expect((error as? APIError)?.code == "TODO_VERSION_CONFLICT") }
        try #require(fixture.transport.requests.count >= 3)
        let data = try #require(fixture.transport.requests[2].body)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["expectedVersion"] as? Int == 2)
        #expect(store.items.first?.version == 3)
    }

    @Test func failedSaveKeepsDraftAndStableRetryAndPreventsDuplicateWrite() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        let store = TodoStore(); store.reset(accountGeneration: 1)
        store.openEditor(try TodoTestFixture.item())
        store.draft?.title = "用户的草稿"
        let draft = try #require(store.draft)
        fixture.transport.enqueue(.held)
        let writing = Task { try await store.save(draft, using: fixture.api) }
        #expect(await fixture.waitForRequests(1))
        do { _ = try await store.save(draft, using: fixture.api); Issue.record("duplicate save must be refused") }
        catch { #expect(fixture.transport.requests.count == 1) }
        fixture.transport.finish(0, status: 409, body: #"{"code":"TODO_VERSION_CONFLICT","message":"changed"}"#)
        do { _ = try await writing.value; Issue.record("save must conflict") } catch { #expect(store.draft?.title == "用户的草稿") }
        #expect(store.draft?.clientRequestId == draft.clientRequestId && store.draft?.expectedVersion == 1)
        fixture.transport.enqueue(.failure(.timedOut), .failure(.timedOut))
        for _ in 0..<2 { do { _ = try await store.save(draft, using: fixture.api) } catch { #expect(store.draft?.title == "用户的草稿") } }
        #expect(fixture.transport.requests[1].body == fixture.transport.requests[2].body)
    }
}
