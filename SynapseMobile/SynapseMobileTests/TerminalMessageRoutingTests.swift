import Testing
@testable import SynapseMobile

@MainActor
struct TerminalMessageRoutingTests {
    @Test(arguments: [nil, "write.failure"] as [String?])
    func aLateFailureFromAClosedSessionCannotSwallowTheCurrentFailure(id: String?) throws {
        let model = SynapseAppModel()
        model.raiseTerminalMessage("先前的失败", sessionId: "closed-session", id: "previous")
        model.closeTerminal("closed-session")
        #expect(model.terminalMessages.isEmpty)

        // The pending ACK can finish after Back. Both callbacks use the same reason.
        model.raiseTerminalMessage("电脑是否收到不确定，请确认后再试。", sessionId: "closed-session", id: id)
        model.raiseTerminalMessage("电脑是否收到不确定，请确认后再试。", sessionId: "current-session", id: id)

        #expect(model.terminalMessages.count == 2)
        let current = try #require(model.terminalMessages.first { $0.sessionId == "current-session" })
        #expect(current.text == "电脑是否收到不确定，请确认后再试。")
        #expect(model.terminalMessages.contains { $0.sessionId == "closed-session" })
    }

    @Test func theSameSessionAndIdStillUpdateOneMessage() throws {
        let model = SynapseAppModel()
        model.raiseTerminalMessage("没有读取到文件。", sessionId: "session", id: "pick.failure")
        model.raiseTerminalMessage("请允许读取照片。", sessionId: "session", id: "pick.failure", opensSettings: true)
        #expect(model.terminalMessages.count == 1)
        let message = try #require(model.terminalMessages.first)
        #expect(message.id == "pick.failure")
        #expect(message.text == "请允许读取照片。")
        #expect(message.opensSettings)
    }

    @Test func connectivityMessagesKeepTheirExistingExpiryIdentity() throws {
        let model = SynapseAppModel()
        model.raiseTerminalMessage("网络已断开。", sessionId: "session", id: TerminalMessageId.voiceNetwork)
        #expect(try #require(model.terminalMessages.first).expiresWithConnectivity)
    }

    @Test func dismissingTheVisibleSessionPreservesAnotherSessionsMessage() {
        let model = SynapseAppModel()
        model.raiseTerminalMessage("旧会话的失败", sessionId: "closed-session", id: "write.failure")
        model.raiseTerminalMessage("当前会话的失败", sessionId: "current-session", id: "write.failure")
        model.dismissTerminalMessage("write.failure", sessionId: "current-session")
        #expect(model.terminalMessages.map(\.sessionId) == ["closed-session"])

        // Callers that deliberately omit a session retain the global dismissal API.
        model.raiseTerminalMessage("另一会话的失败", sessionId: "third-session", id: "write.failure")
        model.dismissTerminalMessage("write.failure")
        #expect(model.terminalMessages.isEmpty)
    }
}
