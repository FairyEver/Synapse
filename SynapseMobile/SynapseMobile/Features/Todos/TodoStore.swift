import Foundation
import Observation

@MainActor
@Observable
final class TodoStore {
    private(set) var items: [TodoItemDto] = []
    private(set) var filter: TodoFilter = .pending
    private(set) var nextOffset: Int?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var errorMessage: String?
    private(set) var editorError: String?
    private(set) var editorConflict = false
    private(set) var isSaving = false
    private(set) var writingIDs: Set<String> = []
    private(set) var undoItem: TodoItemDto?
    var draft: TodoDraft?

    @ObservationIgnored private var accountGeneration = 0
    @ObservationIgnored private var filterGeneration = 0
    @ObservationIgnored private var readSequence = 0
    @ObservationIgnored private var retryIDs: [String: UUID] = [:]

    func reset(accountGeneration: Int) {
        self.accountGeneration = accountGeneration
        filterGeneration += 1
        readSequence += 1
        items = []; filter = .pending; nextOffset = nil
        isLoading = false; isLoadingMore = false; isSaving = false
        errorMessage = nil; editorError = nil; editorConflict = false
        writingIDs.removeAll(); retryIDs.removeAll(); draft = nil; undoItem = nil
    }

    func selectFilter(_ filter: TodoFilter) {
        guard self.filter != filter else { return }
        self.filter = filter
        filterGeneration += 1; readSequence += 1
        items = []; nextOffset = nil; errorMessage = nil
        isLoading = false; isLoadingMore = false
    }

    func reload(using api: APIClient) async { await read(offset: 0, using: api) }
    func loadMore(using api: APIClient) async {
        guard !isLoading, !isLoadingMore, let nextOffset else { return }
        await read(offset: nextOffset, using: api)
    }
    private func read(offset: Int, using api: APIClient) async {
        let account = accountGeneration, view = filterGeneration, selected = filter
        readSequence += 1
        let request = readSequence
        isLoading = offset == 0; isLoadingMore = offset != 0
        defer {
            if current(account), view == filterGeneration, request == readSequence {
                isLoading = false; isLoadingMore = false
            }
        }
        do {
            let page = try await api.listTodos(TodoListInput(filter: selected, offset: offset))
            guard current(account), view == filterGeneration, request == readSequence, !Task.isCancelled else { return }
            items = Self.merged(items, incoming: page.items, filter: selected, replacing: offset == 0)
            nextOffset = page.nextOffset
            errorMessage = nil
        } catch {
            guard current(account), view == filterGeneration, request == readSequence, !Task.isCancelled else { return }
            errorMessage = TodoText.errorMessage(error, listing: true)
        }
    }

    func openEditor(_ item: TodoItemDto? = nil) {
        guard !isSaving else { return }
        draft = TodoDraft(item: item); editorError = nil; editorConflict = false
    }
    func closeEditor() {
        guard !isSaving else { return }
        draft = nil; editorError = nil; editorConflict = false
    }
    func reloadEditor(using api: APIClient) async {
        guard let draft, let id = draft.id, !isSaving else { return }
        let account = accountGeneration, presentation = draft.presentationID, requestID = draft.clientRequestId
        isSaving = true
        defer { if current(account) { isSaving = false } }
        do {
            let item = try await api.getTodo(id: id)
            guard current(account), self.draft?.presentationID == presentation, self.draft?.clientRequestId == requestID, !Task.isCancelled else { return }
            self.draft = TodoDraft(item: item); editorError = nil; editorConflict = false
        } catch { if current(account) { editorError = TodoText.errorMessage(error) } }
    }

    func save(_ draft: TodoDraft, using api: APIClient, now: Date = Date()) async throws -> TodoItemDto {
        let key = draft.id ?? "new", account = accountGeneration
        guard !isSaving, !writingIDs.contains(key) else { throw busyError() }
        if let message = draft.validationMessage(now: now) {
            editorError = message
            throw APIError(status: 400, code: "TODO_INVALID_DRAFT", message: message)
        }
        isSaving = true; writingIDs.insert(key); editorError = nil
        if self.draft?.presentationID == draft.presentationID && self.draft?.clientRequestId == draft.clientRequestId {
            self.draft?.recordSubmission(now: now)
        }
        defer { if current(account) { isSaving = false; writingIDs.remove(key) } }
        do {
            let item: TodoItemDto
            if let id = draft.id, let input = draft.updateInput() { item = try await api.updateTodo(id: id, input: input) }
            else { item = try await api.createTodo(draft.createInput()) }
            try requireCurrent(account)
            items = Self.merged(items, incoming: [item], filter: filter)
            self.draft = nil; editorConflict = false
            await reload(using: api)
            try requireCurrent(account)
            return item
        } catch {
            try requireCurrent(account)
            editorError = TodoText.errorMessage(error)
            editorConflict = (error as? APIError)?.code == "TODO_VERSION_CONFLICT"
            throw error
        }
    }

    func setCompleted(_ item: TodoItemDto, completed: Bool, using api: APIClient) async throws -> TodoItemDto {
        let account = accountGeneration
        guard !writingIDs.contains(item.id) else { throw busyError() }
        writingIDs.insert(item.id)
        let key = "completion:\(item.id):\(item.version):\(completed)"
        let requestID = requestID(for: key)
        defer { if current(account) { writingIDs.remove(item.id) } }
        do {
            let receipt = try await api.setTodoCompleted(id: item.id,
                input: TodoCompletionInput(completed: completed, expectedVersion: item.version, clientRequestId: requestID))
            try requireCurrent(account)
            retryIDs.removeValue(forKey: key)
            items = Self.merged(items, incoming: [receipt], filter: filter)
            undoItem = completed ? receipt : nil
            await reload(using: api)
            try requireCurrent(account)
            return receipt
        } catch {
            try requireCurrent(account)
            if (error as? APIError)?.code == "TODO_VERSION_CONFLICT" {
                undoItem = nil
                await reload(using: api)
                try requireCurrent(account)
            }
            errorMessage = TodoText.errorMessage(error)
            throw error
        }
    }
    func undoCompletion(using api: APIClient) async throws {
        guard let undoItem else { return }
        _ = try await setCompleted(undoItem, completed: false, using: api)
    }
    func remove(_ item: TodoItemDto, using api: APIClient) async throws {
        let account = accountGeneration
        guard !writingIDs.contains(item.id) else { throw busyError() }
        writingIDs.insert(item.id)
        let key = "delete:\(item.id):\(item.version)", requestID = requestID(for: "delete:\(item.id):\(item.version)")
        defer { if current(account) { writingIDs.remove(item.id) } }
        do {
            _ = try await api.deleteTodo(id: item.id, input: TodoDeleteInput(expectedVersion: item.version, clientRequestId: requestID))
            try requireCurrent(account)
            retryIDs.removeValue(forKey: key)
            items.removeAll { $0.id == item.id }
            if undoItem?.id == item.id { undoItem = nil }
            await reload(using: api)
            try requireCurrent(account)
        } catch {
            try requireCurrent(account)
            if (error as? APIError)?.code == "TODO_VERSION_CONFLICT" { await reload(using: api); try requireCurrent(account) }
            errorMessage = TodoText.errorMessage(error)
            throw error
        }
    }

    private func current(_ account: Int) -> Bool { account == accountGeneration }
    private func requireCurrent(_ account: Int) throws {
        guard current(account), !Task.isCancelled else { throw APIError(status: 0, code: "credential_changed", message: "账号已改变，请重试") }
    }
    private func busyError() -> APIError { APIError(status: 0, code: "TODO_BUSY", message: "正在保存，请稍候") }
    private func requestID(for key: String) -> UUID {
        if let id = retryIDs[key] { return id }
        let id = UUID(); retryIDs[key] = id; return id
    }
    static func merged(_ current: [TodoItemDto], incoming: [TodoItemDto], filter: TodoFilter, replacing: Bool = false) -> [TodoItemDto] {
        var highest = Dictionary(current.map { ($0.id, $0) }, uniquingKeysWith: { $0.version >= $1.version ? $0 : $1 })
        for item in incoming where item.version >= (highest[item.id]?.version ?? 0) { highest[item.id] = item }
        let allowed = replacing ? Set(incoming.map(\.id)) : Set(highest.keys)
        return highest.values.filter { allowed.contains($0.id) && (filter == .all || !$0.isCompleted) }.sorted { left, right in
            if left.isCompleted != right.isCompleted { return !left.isCompleted }
            if left.isCompleted {
                if left.completedAt != right.completedAt { return (left.completedAt ?? "") > (right.completedAt ?? "") }
                return left.id > right.id
            }
            if left.dueAt != right.dueAt {
                if left.dueAt == nil { return false }
                if right.dueAt == nil { return true }
                return (left.dueAt ?? "") < (right.dueAt ?? "")
            }
            if left.createdAt != right.createdAt { return left.createdAt < right.createdAt }
            return left.id < right.id
        }
    }
}
