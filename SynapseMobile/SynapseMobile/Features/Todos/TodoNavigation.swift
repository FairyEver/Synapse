import Foundation
import Observation

nonisolated enum TodoReference {
    static func isValidID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.count <= 200 && id.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45
        }
    }
    static func id(in reference: String) -> String? {
        let prefix = "synapse://todos/"
        guard reference.hasPrefix(prefix) else { return nil }
        let id = String(reference.dropFirst(prefix.count))
        return isValidID(id) ? id : nil
    }
}

@MainActor
@Observable
final class TodoNavigation {
    private struct Target {
        let id: String
        let request: UUID
        var account: Int
        var waitingForLogin: Bool
    }
    private var target: Target?
    private(set) var isResolving = false
    private(set) var errorMessage: String?
    var pendingID: String? { target?.id }
    var isWaitingForLogin: Bool { target?.waitingForLogin == true }

    func open(id: String, accountGeneration: Int, waitingForLogin: Bool = false) {
        cancel()
        guard TodoReference.isValidID(id) else { errorMessage = "事项已删除或无法访问"; return }
        target = Target(id: id, request: UUID(), account: accountGeneration, waitingForLogin: waitingForLogin)
    }
    func cancel() { target = nil; isResolving = false; errorMessage = nil }
    func accountDidChange(_ generation: Int, signedIn: Bool) {
        guard var target else { return }
        if target.waitingForLogin && signedIn {
            target.account = generation; target.waitingForLogin = false
            self.target = target
        } else if target.account != generation { cancel() }
    }
    func resolve(accountGeneration: Int, signedIn: Bool, store: TodoStore,
                 load: (String) async throws -> TodoItemDto) async {
        guard signedIn, !isResolving, !store.isSaving, store.draft == nil, var target else { return }
        if target.waitingForLogin { target.account = accountGeneration; target.waitingForLogin = false; self.target = target }
        guard target.account == accountGeneration else { cancel(); return }
        isResolving = true; errorMessage = nil
        defer { if self.target?.request == target.request { isResolving = false } }
        do {
            let item = try await load(target.id)
            guard self.target?.request == target.request, self.target?.account == accountGeneration, !Task.isCancelled else { return }
            guard !store.isSaving, store.draft == nil else { return }
            guard item.id == target.id else { throw APIError(status: 0, code: "decode", message: "事项无法读取") }
            if item.isCompleted { store.selectFilter(.all) }
            store.openEditor(item)
            self.target = nil; isResolving = false
        } catch {
            guard self.target?.request == target.request, self.target?.account == accountGeneration, !Task.isCancelled else { return }
            guard store.draft == nil else { return }
            errorMessage = TodoText.errorMessage(error)
        }
    }
}
