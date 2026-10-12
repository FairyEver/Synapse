// A command-line check of the production Foundation/Observation Todo state.
// The API stand-in supplies deterministic failures; native URLSession tests live in SynapseMobileTests.
import Foundation

struct APIError: Error { let status: Int; let code: String?; let message: String }

@MainActor final class APIClient {
    var requests: [Data] = []
    var online = false
    var listFails = false
    var listedItems: [TodoItemDto]?
    var notificationReadFails = false
    var onNotificationRead: (() -> Void)?
    var notificationSteps: [String] = []
    var notificationItem = SynapseNotification(id: "reminder", source: "todo-reminder", title: "待办提醒", body: "事项",
        group: nil, url: nil, level: "active", targetId: "old-target", deviceId: nil,
        readAt: nil, resolvedAt: nil, createdAt: "2026-10-11T00:00:00Z")
    var item = TodoItemDto(id: "other", title: "另一事项", note: nil, dueAt: nil, reminder: .none,
        offsetMinutes: nil, remindAt: nil, reminderGeneration: 0, reminderStatus: .none, completedAt: nil,
        version: 1, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z")
    func listTodos(_ input: TodoListInput) async throws -> TodoPageDto {
        if listFails { throw APIError(status: 0, code: "network", message: "offline") }
        return TodoPageDto(items: listedItems ?? [item], nextOffset: nil)
    }
    func getTodo(id: String) async throws -> TodoItemDto { item }
    func createTodo(_ input: TodoCreateInput) async throws -> TodoItemDto {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        requests.append(try encoder.encode(input))
        if !online { throw APIError(status: 0, code: "network", message: "offline") }
        return item
    }
    func updateTodo(id: String, input: TodoUpdateInput) async throws -> TodoItemDto {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        requests.append(try encoder.encode(input))
        if !online { throw APIError(status: 0, code: "network", message: "lost receipt") }
        return item
    }
    func setTodoCompleted(id: String, input: TodoCompletionInput) async throws -> TodoItemDto { item }
    func deleteTodo(id: String, input: TodoDeleteInput) async throws -> TodoDeleteResult { TodoDeleteResult(id: id, version: 2, deleted: true) }
    func listNotifications(filter: String, cursor: String?) async throws -> NotificationPage { NotificationPage(items: [notificationItem], nextCursor: nil) }
    func notification(_ id: String) async throws -> SynapseNotification { notificationSteps.append("get"); return notificationItem }
    func notificationUnreadCount() async throws -> Int { 0 }
    func markNotificationRead(_ id: String) async throws {
        notificationSteps.append("read")
        if notificationReadFails { throw APIError(status: 404, code: "not_found", message: "deleted") }
        onNotificationRead?()
    }
    func markAllNotificationsRead() async throws {}
    func deleteNotification(_ id: String) async throws {}
    func deleteAllNotifications() async throws {}
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

        let replayAPI = APIClient(), replayStore = TodoStore()
        replayStore.openEditor(replayAPI.item); replayStore.draft?.title = "已经保存的标题"
        do { _ = try await replayStore.save(replayStore.draft!, using: replayAPI) } catch {}
        replayAPI.listedItems = []
        await replayStore.reload(using: replayAPI)
        replayAPI.online = true; replayAPI.listFails = true
        _ = try await replayStore.save(replayStore.draft!, using: replayAPI)
        check(replayAPI.requests.count == 2 && replayAPI.requests[0] == replayAPI.requests[1], "mutation replay preserves the original payload and UUID")
        check(replayStore.items.isEmpty && replayStore.errorMessage != nil, "an old edit receipt cannot revive an item removed by a newer server read")
        _ = try await replayStore.setCompleted(replayAPI.item, completed: false, using: replayAPI)
        check(replayStore.items.isEmpty, "an old completion receipt cannot revive a removed item")

        let notificationAPI = APIClient(), notificationStore = NotificationStore()
        await notificationStore.load(using: notificationAPI)
        notificationAPI.notificationItem = SynapseNotification(id: "reminder", source: "todo-reminder", title: "待办提醒", body: "事项",
            group: nil, url: nil, level: "active", targetId: "current-target", deviceId: nil,
            readAt: "2026-10-12T00:00:00Z", resolvedAt: nil, createdAt: "2026-10-11T00:00:00Z")
        let opened = await notificationStore.read("reminder", using: notificationAPI)
        check(opened?.targetId == "current-target" && notificationAPI.notificationSteps == ["read", "get"], "notification navigation uses the current server target after marking read")
        notificationAPI.notificationReadFails = true
        let failed = await notificationStore.read("reminder", using: notificationAPI)
        check(failed == nil && !notificationStore.items.isEmpty, "cached rows cannot authorize navigation after a failed read")
        notificationAPI.notificationReadFails = false
        notificationAPI.onNotificationRead = { notificationStore.clear() }
        let stale = await notificationStore.read("reminder", using: notificationAPI)
        check(stale == nil && notificationStore.items.isEmpty, "account reset cancels a notification target")
        if !failures.isEmpty { for message in failures { print("FAIL: " + message) }; exit(1) }
        print("Todo core checks passed: ephemeral/no-queue policy, stable retry, receipt isolation, draft and notification target ownership.")
    }
}
