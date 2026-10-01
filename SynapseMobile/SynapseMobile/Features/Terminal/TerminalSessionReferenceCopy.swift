import Foundation

/// Requests the reference from the desktop and copies its answer without rebuilding it.
enum TerminalSessionReferenceCopy {
    @MainActor
    static func perform(
        sessionId: String,
        send: (MobileIntentRequest) async -> MobileIntentResult?,
        isCurrent: () -> Bool,
        copy: (String) -> Void,
        fail: (String) -> Void
    ) async {
        let result = await send(MobileIntentRequest(
            intentId: UUID().uuidString,
            kind: "sessionReference",
            sessionId: sessionId
        ))
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
        guard result.sessionId == sessionId,
              let text = result.referenceText, !text.isEmpty else {
            fail("电脑没有返回这个终端的会话引用，请升级电脑端后重试。")
            return
        }
        copy(text)
    }
}
