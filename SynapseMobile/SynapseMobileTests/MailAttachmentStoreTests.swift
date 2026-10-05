import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MailAttachmentStoreTests {
    @Test func repeatedTapsDownloadOnceAndReopenTheCachedPreview() async {
        let api = AttachmentReviewAPI()
        let gate = AttachmentReviewGate()
        let store = MailAttachmentStore()
        api.download = { _ in await gate.hold(); return attachmentURL("a") }
        let first = Task { await store.open(attachment("a"), messageId: "mail", using: api) }
        await gate.waitUntilHeld()
        await store.open(attachment("a"), messageId: "mail", using: api)
        #expect(api.calls == 1)
        #expect(store.loading == ["a"])
        await gate.release()
        await first.value
        #expect(store.previewURL == attachmentURL("a"))
        store.dismissPreview()
        await store.open(attachment("a"), messageId: "mail", using: api)
        #expect(api.calls == 1)
        #expect(store.previewURL == attachmentURL("a"))
        #expect(store.loading.isEmpty)
    }

    @Test func switchingMessagesRejectsAnEarlierDownload() async {
        let api = AttachmentReviewAPI()
        let gate = AttachmentReviewGate()
        let store = MailAttachmentStore()
        api.download = { _ in await gate.hold(); return attachmentURL("old") }
        let old = Task { await store.open(attachment("old"), messageId: "old-mail", using: api) }
        await gate.waitUntilHeld()
        store.reset(for: "new-mail")
        await gate.release()
        await old.value
        #expect(store.downloaded.isEmpty)
        #expect(store.previewURL == nil)
        #expect(store.error == nil)
    }

    @Test func theLastTappedAttachmentKeepsItsPreviewWhenAnOlderDownloadFinishes() async {
        let api = AttachmentReviewAPI()
        let gate = AttachmentReviewGate()
        let store = MailAttachmentStore()
        api.download = { id in
            if id == "old" { await gate.hold() }
            return attachmentURL(id)
        }
        let old = Task { await store.open(attachment("old"), messageId: "mail", using: api) }
        await gate.waitUntilHeld()
        await store.open(attachment("new"), messageId: "mail", using: api)
        await gate.release()
        await old.value
        #expect(store.previewURL == attachmentURL("new"))
        #expect(store.downloaded.count == 2)
    }

    @Test func anEarlierFailureDoesNotOverwriteTheLastSuccessfullyOpenedAttachment() async {
        let api = AttachmentReviewAPI()
        let gate = AttachmentReviewGate()
        let store = MailAttachmentStore()
        api.download = { id in
            if id == "old" {
                await gate.hold()
                throw URLError(.notConnectedToInternet)
            }
            return attachmentURL(id)
        }
        let old = Task { await store.open(attachment("old"), messageId: "mail", using: api) }
        await gate.waitUntilHeld()
        await store.open(attachment("new"), messageId: "mail", using: api)
        await gate.release()
        await old.value
        #expect(store.previewURL == attachmentURL("new"))
        #expect(store.error == nil)
        #expect(store.loading.isEmpty)
    }

    @Test func failureCanBeRetriedAndAChangingMessageClearsItsError() async {
        let api = AttachmentReviewAPI()
        let store = MailAttachmentStore()
        api.download = { _ in throw URLError(.notConnectedToInternet) }
        await store.open(attachment("a"), messageId: "mail", using: api)
        #expect(store.error != nil)
        #expect(store.loading.isEmpty)
        api.download = { id in attachmentURL(id) }
        await store.open(attachment("a"), messageId: "mail", using: api)
        #expect(store.error == nil)
        #expect(store.previewURL == attachmentURL("a"))
        store.reset(for: "new-mail")
        #expect(store.previewURL == nil)
        #expect(store.downloaded.isEmpty)
    }
}

private func attachment(_ id: String) -> MailAttachment {
    MailAttachment(attachmentId: id, fileName: "\(id).txt", mimeType: "text/plain", size: 1)
}

private func attachmentURL(_ id: String) -> URL { URL(fileURLWithPath: "/tmp/\(id).txt") }

@MainActor
private final class AttachmentReviewAPI: MailAttachmentAPI {
    var calls = 0
    var download: ((String) async throws -> URL)?
    func mailDownloadAttachment(messageId: String, attachment: MailAttachment) async throws -> URL {
        calls += 1
        return try await download?(attachment.id) ?? attachmentURL(attachment.id)
    }
}

private actor AttachmentReviewGate {
    private var held = false
    private var released = false
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
    func hold() async {
        held = true
        heldWaiters.forEach { $0.resume() }
        heldWaiters.removeAll()
        guard !released else { return }
        await withCheckedContinuation { releaseWaiters.append($0) }
    }
    func waitUntilHeld() async {
        guard !held else { return }
        await withCheckedContinuation { heldWaiters.append($0) }
    }
    func release() {
        released = true
        releaseWaiters.forEach { $0.resume() }
        releaseWaiters.removeAll()
    }
}
