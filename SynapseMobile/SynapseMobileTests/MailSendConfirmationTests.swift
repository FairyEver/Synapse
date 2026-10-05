import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MailSendConfirmationTests {
    @Test(arguments: [400, 403, 409])
    func aDefiniteRejectionReturnsTheSameDraftToPreview(_ status: Int) throws {
        let draft = mailConfirmationDraft()
        var state = MailSendConfirmationState()
        state.prepare(mailConfirmationPreview("old"), content: draft)
        let oldRequest = try #require(state.pendingSend(for: draft))

        state.handleFailure(APIError(status: status, code: "rejected", message: "请重新确认"))

        #expect(state.pendingSend(for: draft) == nil)
        #expect(state.confirmation == nil)
        state.prepare(mailConfirmationPreview("new"), content: draft)
        let renewed = try #require(state.pendingSend(for: draft))
        #expect(renewed.content == oldRequest.content)
        #expect(renewed.previewId == "new")
        #expect(renewed.clientRequestId != oldRequest.clientRequestId)
    }

    @Test(arguments: [401, 500, 503])
    func anErrorOutsidePreviewValidationKeepsTheSameIdempotentSend(_ status: Int) throws {
        let draft = mailConfirmationDraft()
        var state = MailSendConfirmationState()
        state.prepare(mailConfirmationPreview("original"), content: draft)
        let original = try #require(state.pendingSend(for: draft))
        state.handleFailure(APIError(status: status, code: "failure", message: "失败"))
        let retry = try #require(state.pendingSend(for: draft))
        #expect(retry.clientRequestId == original.clientRequestId)
        #expect(retry.previewId == original.previewId)
        #expect(state.confirmation?.previewId == "original")
    }

    @Test func aNetworkFailureKeepsTheSameSendUntilTheDraftChanges() throws {
        var draft = mailConfirmationDraft()
        var state = MailSendConfirmationState()
        state.prepare(mailConfirmationPreview("original"), content: draft)
        let original = try #require(state.pendingSend(for: draft))
        state.handleFailure(URLError(.timedOut))
        #expect(state.pendingSend(for: draft)?.clientRequestId == original.clientRequestId)
        draft = MailContent(formatVersion: draft.formatVersion, toIds: draft.toIds, ccIds: draft.ccIds, toOrganizationIds: draft.toOrganizationIds, ccOrganizationIds: draft.ccOrganizationIds, subject: draft.subject, body: "编辑后的正文", attachmentIds: draft.attachmentIds, forwardAttachmentIds: draft.forwardAttachmentIds, relation: draft.relation)
        state.invalidateIfChanged(draft)
        #expect(state.pendingSend(for: draft) == nil)
        #expect(state.confirmation == nil)
    }
}

private func mailConfirmationDraft() -> MailContent {
    MailContent(formatVersion: 3, toIds: ["reader"], ccIds: [], toOrganizationIds: [], ccOrganizationIds: [], subject: "主题", body: "保留正文", attachmentIds: ["attachment"], forwardAttachmentIds: [], relation: nil)
}

private func mailConfirmationPreview(_ id: String) -> MailPreview {
    MailPreview(previewId: id, expiresAt: "2026-10-05T00:00:00Z", recipients: [], toRecipients: [], ccRecipients: [], toAddresses: nil, ccAddresses: nil, recipientCount: 1, subject: "主题", body: "保留正文", quote: nil, attachments: [])
}
