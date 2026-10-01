import Foundation

enum TerminalReferenceCopyTarget: Equatable {
    case session(String)
    case workspace(id: String, sessionId: String?)

    var sessionId: String? {
        switch self {
        case .session(let id): id
        case .workspace(_, let id): id
        }
    }

    func request() -> MobileIntentRequest {
        switch self {
        case .session(let id):
            MobileIntentRequest(intentId: UUID().uuidString, kind: "sessionReference", sessionId: id)
        case .workspace(let id, let sessionId):
            MobileIntentRequest(intentId: UUID().uuidString, kind: "workspaceReference", sessionId: sessionId, workspaceId: id)
        }
    }

    func matches(_ result: MobileIntentResult) -> Bool {
        switch self {
        case .session(let id): result.sessionId == id
        case .workspace(let id, let sessionId):
            result.workspaceId == id && result.sessionId != nil
                && (sessionId == nil || result.sessionId == sessionId)
        }
    }
}

/// View-local selection, like the desktop's active pane map; never persisted or sent as metadata.
struct TerminalWorkspaceReferenceSelection {
    private var selectedSessions: [String: String] = [:]

    mutating func select(_ sessionId: String, in workspaces: [MobileSummaryWorkspace]) {
        guard let workspace = workspaces.first(where: { $0.panes.contains(where: { $0.sessionId == sessionId }) }) else { return }
        selectedSessions[workspace.id] = sessionId
    }

    func sessionId(for workspaceId: String) -> String? { selectedSessions[workspaceId] }

    mutating func prune(keeping workspaces: [MobileSummaryWorkspace]) {
        selectedSessions = selectedSessions.filter { id, sessionId in
            workspaces.contains { $0.id == id && $0.panes.contains(where: { $0.sessionId == sessionId }) }
        }
    }
}

/// Requests the reference from the desktop and copies its answer without rebuilding it.
enum TerminalSessionReferenceCopy {
    @MainActor
    static func perform(
        target: TerminalReferenceCopyTarget,
        send: (MobileIntentRequest) async -> MobileIntentResult?,
        isCurrent: () -> Bool,
        copy: (String) -> Void,
        fail: (String) -> Void
    ) async {
        let result = await send(target.request())
        // Switching computers, signing out or ending the session invalidates a pending copy.
        guard isCurrent(), !Task.isCancelled else { return }
        guard let result else {
            fail("电脑没有返回会话引用，请重试。")
            return
        }
        guard result.isAccepted else {
            fail(result.message ?? "读取这个终端的会话引用没有完成。")
            return
        }
        guard target.matches(result),
              let text = result.referenceText, !text.isEmpty else {
            fail("电脑没有返回这个终端的会话引用，请升级电脑端后重试。")
            return
        }
        copy(text)
    }
}
