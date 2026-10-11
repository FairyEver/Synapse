import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct TodoNavigationTests {
    @Test func referenceIsSingleReadOnlyID() async throws {
        for invalid in ["synapse://todos/abc?completed=true", "synapse://todos/abc#x", "synapse://todos/a/b", "synapse://todos/a%2Fb", "synapse://todos/", "synapse://todos/abc/", "synapse://todos/%61bc"] {
            #expect(TodoReference.id(in: invalid) == nil)
        }
        #expect(TodoReference.id(in: "synapse://todos/abc") == "abc")
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        fixture.transport.enqueue(.json(200, TodoTestFixture.itemJSON(id: "abc")))
        let navigation = TodoNavigation(), store = TodoStore()
        navigation.open(id: "abc", accountGeneration: 1)
        await navigation.resolve(accountGeneration: 1, signedIn: true, store: store) { try await fixture.api.getTodo(id: $0) }
        #expect(fixture.transport.requests.map(\.method) == ["GET"])
        #expect(store.draft?.id == "abc")
    }

    @Test func coldLoginAndCompletedTargetBeyondTheFirstPage() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        fixture.transport.enqueue(.json(200, TodoTestFixture.itemJSON(id: "older", completed: true)))
        let navigation = TodoNavigation(), store = TodoStore()
        navigation.open(id: "older", accountGeneration: 0, waitingForLogin: true)
        await navigation.resolve(accountGeneration: 0, signedIn: false, store: store) { try await fixture.api.getTodo(id: $0) }
        #expect(fixture.transport.requests.isEmpty && navigation.pendingID == "older")
        store.reset(accountGeneration: 1)
        navigation.accountDidChange(1, signedIn: true)
        await navigation.resolve(accountGeneration: 1, signedIn: true, store: store) { try await fixture.api.getTodo(id: $0) }
        #expect(store.filter == .all && store.draft?.id == "older")
        #expect(store.items.isEmpty && fixture.transport.requests.count == 1)
        #expect(navigation.pendingID == nil)
    }

    @Test(arguments: [false, true]) func newNavigationOrAccountCancelsLateTarget(changeAccount: Bool) async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        fixture.transport.enqueue(.held)
        let navigation = TodoNavigation(), store = TodoStore()
        navigation.open(id: "older", accountGeneration: 1)
        let resolving = Task {
            await navigation.resolve(accountGeneration: 1, signedIn: true, store: store) { try await fixture.api.getTodo(id: $0) }
        }
        #expect(await fixture.waitForRequests(1))
        if changeAccount { store.reset(accountGeneration: 3); navigation.accountDidChange(3, signedIn: true) }
        else { navigation.cancel() }
        fixture.transport.finish(0, body: TodoTestFixture.itemJSON(id: "older"))
        await resolving.value
        #expect(store.draft == nil && navigation.pendingID == nil && navigation.errorMessage == nil)
    }

    @Test func missingTargetStaysReadOnlyAndCanRetry() async throws {
        let fixture = TodoTestFixture(); defer { fixture.clear() }
        fixture.transport.enqueue(.json(404, #"{"code":"TODO_NOT_FOUND","message":"missing"}"#),
            .json(200, TodoTestFixture.itemJSON(id: "older")))
        let navigation = TodoNavigation(), store = TodoStore()
        navigation.open(id: "older", accountGeneration: 1)
        await navigation.resolve(accountGeneration: 1, signedIn: true, store: store) { try await fixture.api.getTodo(id: $0) }
        #expect(navigation.errorMessage == "事项已删除或无法访问" && store.draft == nil)
        await navigation.resolve(accountGeneration: 1, signedIn: true, store: store) { try await fixture.api.getTodo(id: $0) }
        #expect(fixture.transport.requests.map(\.method) == ["GET", "GET"])
        #expect(store.draft?.id == "older")
    }

    @Test func cancelWhileWaitingForLoginDoesNotOpenLater() async throws {
        let navigation = TodoNavigation(), store = TodoStore()
        navigation.open(id: "older", accountGeneration: 0, waitingForLogin: true)
        navigation.cancel()
        navigation.accountDidChange(1, signedIn: true)
        var reads = 0
        await navigation.resolve(accountGeneration: 1, signedIn: true, store: store) { id in
            reads += 1; return try TodoTestFixture.item(id: id)
        }
        #expect(reads == 0 && store.draft == nil)
    }
}
