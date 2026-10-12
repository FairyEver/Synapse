// A command-line check of the production Foundation/Observation Todo state.
// The API stand-in supplies deterministic failures; native URLSession tests live in SynapseMobileTests.
import Foundation

struct APIError: Error { let status: Int; let code: String?; let message: String }

@MainActor final class APIClient {
    var requests: [Data] = []
    var online = false
    var item = TodoItemDto(id: "other", title: "另一事项", note: nil, dueAt: nil, reminder: .none,
        offsetMinutes: nil, remindAt: nil, reminderGeneration: 0, reminderStatus: .none, completedAt: nil,
        version: 1, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z")
    func listTodos(_ input: TodoListInput) async throws -> TodoPageDto { TodoPageDto(items: [item], nextOffset: nil) }
    func getTodo(id: String) async throws -> TodoItemDto { item }
    func createTodo(_ input: TodoCreateInput) async throws -> TodoItemDto {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        requests.append(try encoder.encode(input))
        if !online { throw APIError(status: 0, code: "network", message: "offline") }
        return item
    }
    func updateTodo(id: String, input: TodoUpdateInput) async throws -> TodoItemDto { item }
    func setTodoCompleted(id: String, input: TodoCompletionInput) async throws -> TodoItemDto { item }
    func deleteTodo(id: String, input: TodoDeleteInput) async throws -> TodoDeleteResult { TodoDeleteResult(id: id, version: 2, deleted: true) }
}

@main struct TodoCoreCheck {
    @MainActor static func main() async throws {
        var failures: [String] = []
        func check(_ value: Bool, _ label: String) { if !value { failures.append(label) } }
        let config = TodoNetworkPolicy.configuration(requestTimeout: 20, resourceTimeout: 30)
        check(config.urlCache == nil, "Todo transport must have no response cache")
        check(!config.waitsForConnectivity, "Todo transport must fail offline without queuing")
        check(config.requestCachePolicy == .reloadIgnoringLocalCacheData, "Todo transport must bypass cached reads")

        let api = APIClient(), store = TodoStore()
        store.openEditor(); store.draft?.title = "不能丢失的草稿"
        store.draft?.reminder = .custom
        let before = TodoTime.minute(Date()).addingTimeInterval(60)
        store.draft?.customRemindAt = before
        let outgoing = store.draft!
        do { _ = try await store.save(outgoing, using: api); failures.append("offline save must fail") } catch {}
        check(!store.isSaving && store.draft?.clientRequestId == outgoing.clientRequestId, "failed save preserves draft/UUID and unlocks")
        check(store.draft?.validationMessage(now: before.addingTimeInterval(1)) == nil, "same attempted payload can retry after the reminder instant")
        check(store.draft?.validationMessage(now: Date().addingTimeInterval(86_401)) != nil, "retry exemption expires with the 24-hour receipt")
        var changed = store.draft!; changed.title = "新的意图"
        check(changed.validationMessage(now: before.addingTimeInterval(1)) != nil, "changed payload still requires a future reminder")
        api.online = true
        await Task.yield()
        check(api.requests.count == 1, "restored connectivity alone must not submit")
        _ = try await store.save(store.draft!, using: api, now: before.addingTimeInterval(1))
        check(api.requests.count == 2 && api.requests[0] == api.requests[1] && store.draft == nil,
              "explicit retry after reminder time resubmits exactly the original request")
        store.openEditor(); store.draft?.title = "不能丢失的草稿"

        let navigation = TodoNavigation()
        navigation.open(id: api.item.id, accountGeneration: 0)
        var loads = 0
        await navigation.resolve(accountGeneration: 0, signedIn: true, store: store) { _ in loads += 1; return api.item }
        check(loads == 0 && navigation.pendingID == api.item.id && store.draft?.title == "不能丢失的草稿", "incoming target waits behind an existing draft")
        store.closeEditor()
        await navigation.resolve(accountGeneration: 0, signedIn: true, store: store) { _ in loads += 1; return api.item }
        check(loads == 1 && navigation.pendingID == nil && store.draft?.id == api.item.id, "discarded draft releases the queued target")
        store.closeEditor()
        navigation.open(id: api.item.id, accountGeneration: 0)
        await navigation.resolve(accountGeneration: 0, signedIn: true, store: store) { _ in
            store.openEditor(); store.draft?.title = "在加载时新写的草稿"; return api.item
        }
        check(navigation.pendingID == api.item.id && store.draft?.title == "在加载时新写的草稿", "late target does not replace a newly opened draft")
        if !failures.isEmpty { for message in failures { print("FAIL: " + message) }; exit(1) }
        print("Todo core checks passed: ephemeral/no-queue policy, failed retry intent, draft target ownership.")
    }
}
