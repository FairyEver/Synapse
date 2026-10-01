import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalSessionReferenceCopyTests {
    private let reference = """
    workspace_id=ws-1
    workspace_title=项目: Synapse
    session_id=sess-2
    session_title=构建 日志
    session_ref=tsr_abcdefghijklmnopqrstuv.abc
    """

    private func answer(
        outcome: String = "accepted",
        sessionId: String = "sess-2",
        text: String? = nil,
        message: String? = nil
    ) throws -> MobileIntentResult {
        var object: [String: Any] = ["intentId": "answer", "outcome": outcome, "sessionId": sessionId]
        object["referenceText"] = text
        object["message"] = message
        return try JSONDecoder().decode(MobileIntentResult.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test func copiesTheCompleteDesktopTextVerbatimAndRequestsOnlyTheNamedSession() async throws {
        let result = try answer(text: reference)
        var request: MobileIntentRequest?
        var copied: String?
        var failures: [String] = []
        await TerminalSessionReferenceCopy.perform(
            sessionId: "sess-2",
            send: { request = $0; return result },
            isCurrent: { true },
            copy: { copied = $0 },
            fail: { failures.append($0) }
        )
        #expect(request?.kind == "sessionReference")
        #expect(request?.sessionId == "sess-2")
        #expect(request?.text == nil)
        #expect(copied == reference)
        #expect(failures.isEmpty)
    }

    @Test(arguments: ["missing", "empty", "wrongSession", "rejected", "timeout"])
    func unsuccessfulRequestsLeaveTheClipboardAlone(failure: String) async throws {
        let result: MobileIntentResult?
        switch failure {
        case "missing": result = try answer()
        case "empty": result = try answer(text: "")
        case "wrongSession": result = try answer(sessionId: "sess-1", text: reference)
        case "rejected": result = try answer(outcome: "rejected", message: "这个终端在电脑上已经不在了。")
        default: result = nil
        }
        var copied = "原剪贴板"
        var failures: [String] = []
        await TerminalSessionReferenceCopy.perform(
            sessionId: "sess-2", send: { _ in result }, isCurrent: { true },
            copy: { copied = $0 }, fail: { failures.append($0) }
        )
        #expect(copied == "原剪贴板")
        #expect(failures.count == 1)
        if failure == "rejected" {
            #expect(failures.first == "这个终端在电脑上已经不在了。")
        }
    }

    @Test func switchingComputerOrAccountWhileWaitingDiscardsTheLateReply() async throws {
        let result = try answer(text: reference)
        var current = true
        var copied = "原剪贴板"
        var failures: [String] = []
        await TerminalSessionReferenceCopy.perform(
            sessionId: "sess-2",
            send: { _ in current = false; return result },
            isCurrent: { current },
            copy: { copied = $0 }, fail: { failures.append($0) }
        )
        #expect(copied == "原剪贴板")
        #expect(failures.isEmpty)
    }

    @Test func oldDesktopRepliesStillDecodeWithoutReferenceText() throws {
        let result = try answer()
        #expect(result.isAccepted)
        #expect(result.referenceText == nil)
    }
}
