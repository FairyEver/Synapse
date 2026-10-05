import Foundation
import Testing
@testable import SynapseMobile

@MainActor @Suite
struct TerminalDraftSubmissionTests {
    @Test func aFileDeliveredWhileTheEditorWaitsKeepsItsUndoChip() async {
        let submission = TerminalDraftSubmission()
        var draft = TerminalDraftInsertion()
        draft.update(text: "run original", selection: nil)
        let ticket = draft.ticket()
        let owner = context()
        var attachments = [TerminalAttachment(id: "original", name: "a.txt", sessionId: "session",
            desktopClientInstanceId: owner.desktopId, intentId: "a", driveItemId: nil, state: .delivered(path: "a.txt"))]
        let submittedIds = committedAttachmentIds(attachments, sessionId: "session")
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        let task = Task {
            await submission.submit(ticket: ticket, context: owner, attachmentIds: submittedIds,
                currentContext: { owner }, currentTicket: { draft.ticket() }, send: { _ in
                    await withCheckedContinuation { reply = $0 }
                })
        }
        while reply == nil { await Task.yield() }
        attachments.append(TerminalAttachment(id: "later", name: "b.txt", sessionId: "session",
            desktopClientInstanceId: owner.desktopId, intentId: "b", driveItemId: nil, state: .delivered(path: "b.txt")))
        reply?.resume(returning: .sent)
        guard case .sent(_, let capturedIds) = await task.value else { Issue.record("No acknowledgement"); return }
        let committed = committedAttachmentIds(attachments, sessionId: "session", attachmentIds: capturedIds)
        attachments.removeAll { committed.contains($0.id) }
        #expect(attachments.map(\.id) == ["later"])
        #expect(attachments.first?.availableActions.contains(.undoInsert) == true)
    }

    private func context(desktop: String = "desktop-a", account: Int = 1, viewing: Int = 1) -> TerminalActionContext {
        TerminalActionContext(desktopId: desktop, accountGeneration: account, viewingGeneration: viewing)
    }

    @Test(arguments: [false, true])
    func refusedOrUncertainCommandPreservesDraftAndAllowsExplicitRetry(uncertain: Bool) async {
        let submission = TerminalDraftSubmission()
        var draft = TerminalDraftInsertion()
        draft.update(text: "cat fixture.txt", selection: nil)
        let ticket = draft.ticket()
        let owner = context()
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        var sentTexts: [String] = []
        let task = Task {
            await submission.submit(ticket: ticket, context: owner, attachmentIds: ["file-a"],
                currentContext: { owner }, currentTicket: { draft.ticket() }, send: { text in
                    sentTexts.append(text)
                    return await withCheckedContinuation { reply = $0 }
                })
        }
        while reply == nil { await Task.yield() }
        #expect(submission.sending)
        reply?.resume(returning: uncertain ? .uncertain("未确认") : .notSent("离线"))
        guard case .failed(let message) = await task.value else { Issue.record("Failure was not reported"); return }
        #expect(message == (uncertain ? "未确认" : "离线"))
        #expect(draft.ticket() == ticket)
        #expect(sentTexts == [ticket.text])
        #expect(!submission.sending)
        guard case .sent = await submission.submit(ticket: ticket, context: owner, attachmentIds: ["file-a"],
            currentContext: { owner }, currentTicket: { draft.ticket() }, send: { _ in .sent }) else {
            Issue.record("Explicit retry did not complete"); return
        }
    }

    @Test(arguments: [false, true])
    func acknowledgedCommandOnlyConsumesOriginalDraftAndCapturedAttachments(editWhileWaiting: Bool) async {
        let submission = TerminalDraftSubmission()
        var draft = TerminalDraftInsertion()
        draft.update(text: "original", selection: nil)
        let ticket = draft.ticket()
        let owner = context()
        var attachmentIds = ["file-a"]
        let submittedIds = attachmentIds
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        let task = Task {
            await submission.submit(ticket: ticket, context: owner, attachmentIds: submittedIds,
                currentContext: { owner }, currentTicket: { draft.ticket() }, send: { _ in
                    await withCheckedContinuation { reply = $0 }
                })
        }
        while reply == nil { await Task.yield() }
        attachmentIds.append("file-b")
        if editWhileWaiting {
            draft.update(text: "later edit", selection: nil)
            draft.update(text: "original", selection: nil)
        }
        reply?.resume(returning: .sent)
        guard case .sent(let clearDraft, let committedIds) = await task.value else {
            Issue.record("Acknowledgement was not delivered"); return
        }
        #expect(clearDraft == !editWhileWaiting)
        #expect(committedIds == ["file-a"])
        #expect(attachmentIds == ["file-a", "file-b"])
        #expect(!submission.sending)
    }

    @Test(arguments: [0, 1, 2, 3])
    func changedAccountOrComputerCannotConsumeTheDraftOrPublishOldFailure(change: Int) async {
        let submission = TerminalDraftSubmission()
        var draft = TerminalDraftInsertion()
        draft.update(text: "keep", selection: nil)
        let ticket = draft.ticket()
        let owner = context()
        var current: TerminalActionContext? = owner
        var reply: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        let task = Task {
            await submission.submit(ticket: ticket, context: owner, attachmentIds: ["old-file"],
                currentContext: { current }, currentTicket: { draft.ticket() }, send: { _ in
                    await withCheckedContinuation { reply = $0 }
                })
        }
        while reply == nil { await Task.yield() }
        switch change {
        case 0: current = context(desktop: "desktop-b", viewing: 2)
        case 1: current = context(account: 2)
        case 2: current = nil
        default: current = context(viewing: 3)
        }
        reply?.resume(returning: change == 2 ? .notSent("旧账号的拒绝") : .sent)
        #expect(await task.value == nil)
        #expect(draft.ticket() == ticket)
        #expect(!submission.sending)
    }

    @Test func pendingCommandDoesNotSendAgain() async {
        let submission = TerminalDraftSubmission()
        var draft = TerminalDraftInsertion()
        draft.update(text: "once", selection: nil)
        let ticket = draft.ticket()
        let owner = context()
        var replies: CheckedContinuation<SynapseAppModel.CommandSendOutcome, Never>?
        var writes = 0
        let task = Task {
            await submission.submit(ticket: ticket, context: owner, attachmentIds: [],
                currentContext: { owner }, currentTicket: { draft.ticket() }, send: { _ in
                    writes += 1
                    return await withCheckedContinuation { replies = $0 }
                })
        }
        while replies == nil { await Task.yield() }
        #expect(await submission.submit(ticket: ticket, context: owner, attachmentIds: [],
            currentContext: { owner }, currentTicket: { draft.ticket() }, send: { _ in
                writes += 1
                return .sent
            }) == nil)
        #expect(writes == 1)
        replies?.resume(returning: .sent)
        _ = await task.value
    }
}
