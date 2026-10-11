import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct TodoDraftTests {
    @Test func draftSurvivesListChangesUntilExplicitCancel() throws {
        let store = TodoStore(); store.reset(accountGeneration: 1)
        store.openEditor(try TodoTestFixture.item())
        store.draft?.title = "编辑中的标题"
        let requestID = try #require(store.draft?.clientRequestId)
        store.selectFilter(.all)
        #expect(store.draft?.title == "编辑中的标题" && store.draft?.clientRequestId == requestID)
        store.closeEditor()
        #expect(store.draft == nil && store.items.isEmpty)
    }

    @Test func reminderDefaultsAndCustomDateWithoutDue() throws {
        var draft = TodoDraft(); draft.title = "寄出资料"
        #expect(draft.reminder == .none && draft.dueAt == nil)
        draft.reminder = .custom
        draft.customRemindAt = Date(timeIntervalSince1970: 60_000)
        #expect(draft.validationMessage(now: Date(timeIntervalSince1970: 0)) == nil)
        #expect(draft.createInput().dueAt == nil && draft.createInput().remindAt == "1970-01-01T16:40:00Z")
        draft.reminder = .beforeDue
        #expect(draft.validationMessage(now: Date(timeIntervalSince1970: 0)) == "请选择截止时间")
    }

    @Test func onlyFieldChangesRotateRequestUUIDAndKeepVersion() throws {
        var draft = TodoDraft(item: try TodoTestFixture.item())
        let first = draft.clientRequestId
        let unchangedTitle = draft.title
        draft.title = unchangedTitle
        #expect(draft.clientRequestId == first)
        draft.note = "  保留空白  "
        #expect(draft.clientRequestId != first && draft.expectedVersion == 1)
        #expect(draft.createInput().note == "  保留空白  ")
        let changed = draft.clientRequestId
        _ = draft.updateInput(); _ = draft.updateInput()
        #expect(draft.clientRequestId == changed)
    }
}
