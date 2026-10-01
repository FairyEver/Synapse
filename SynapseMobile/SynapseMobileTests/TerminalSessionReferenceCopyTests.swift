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
        workspaceId: String? = nil,
        text: String? = nil,
        message: String? = nil
    ) throws -> MobileIntentResult {
        var object: [String: Any] = ["intentId": "answer", "outcome": outcome, "sessionId": sessionId]
        object["referenceText"] = text
        object["workspaceId"] = workspaceId
        object["message"] = message
        return try JSONDecoder().decode(MobileIntentResult.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test func copiesTheCompleteDesktopTextVerbatimAndRequestsOnlyTheNamedSession() async throws {
        let result = try answer(text: reference)
        var request: MobileIntentRequest?
        var copied: String?
        var failures: [String] = []
        await TerminalSessionReferenceCopy.perform(
            target: .session("sess-2"),
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
            target: .session("sess-2"), send: { _ in result }, isCurrent: { true },
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
            target: .session("sess-2"),
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

    @Test(arguments: [false, true])
    func requestsTheTabAndCopiesItsDesktopResolvedSession(preferRecent: Bool) async throws {
        let result = try answer(workspaceId: "ws-1", text: reference)
        var request: MobileIntentRequest?
        var copied: String?
        var failures: [String] = []
        await TerminalSessionReferenceCopy.perform(
            target: .workspace(id: "ws-1", sessionId: preferRecent ? "sess-2" : nil),
            send: { request = $0; return result }, isCurrent: { true },
            copy: { copied = $0 }, fail: { failures.append($0) }
        )
        #expect(request?.kind == "workspaceReference")
        #expect(request?.workspaceId == "ws-1")
        #expect(request?.sessionId == (preferRecent ? "sess-2" : nil))
        #expect(copied == reference)
        #expect(failures.isEmpty)
    }

    @Test func rejectsAReplyFromAnotherTab() async throws {
        let result = try answer(workspaceId: "ws-other", text: reference)
        var copied = "原剪贴板"
        var failures: [String] = []
        await TerminalSessionReferenceCopy.perform(
            target: .workspace(id: "ws-1", sessionId: "sess-2"),
            send: { _ in result }, isCurrent: { true },
            copy: { copied = $0 }, fail: { failures.append($0) }
        )
        #expect(copied == "原剪贴板")
        #expect(failures.count == 1)
    }

    @Test func remembersEachTabsRecentPaneAndPrunesRemovedOrMovedPanes() throws {
        func workspace(_ id: String, _ sessionIds: [String]) throws -> MobileSummaryWorkspace {
            let object: [String: Any] = [
                "id": id, "groupId": "g1", "title": id,
                "panes": sessionIds.map { ["paneId": "pane-\($0)", "sessionId": $0] },
            ]
            return try JSONDecoder().decode(MobileSummaryWorkspace.self, from: JSONSerialization.data(withJSONObject: object))
        }
        let tabs = try [workspace("w1", ["s1", "s2"]), workspace("w2", ["s3", "s4"])]
        var selection = TerminalWorkspaceReferenceSelection()
        #expect(selection.sessionId(for: "w1") == nil)
        selection.select("s2", in: tabs)
        selection.select("s4", in: tabs)
        #expect(selection.sessionId(for: "w1") == "s2")
        #expect(selection.sessionId(for: "w2") == "s4")
        selection.prune(keeping: tabs)
        #expect(selection.sessionId(for: "w1") == "s2")
        selection.prune(keeping: try [workspace("w1", ["s1"]), workspace("w2", ["s2", "s4"])])
        #expect(selection.sessionId(for: "w1") == nil)
        #expect(selection.sessionId(for: "w2") == "s4")
        selection.prune(keeping: [])
        #expect(selection.sessionId(for: "w2") == nil)
    }
}
