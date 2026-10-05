import Foundation
import Observation

@MainActor
protocol MailAttachmentAPI {
    func mailDownloadAttachment(messageId: String, attachment: MailAttachment) async throws -> URL
}

extension SynapseAppModel: MailAttachmentAPI {}

@MainActor
@Observable
final class MailAttachmentStore {
    private(set) var downloaded: [String: URL] = [:]
    private(set) var loading: Set<String> = []
    private(set) var previewURL: URL?
    private(set) var error: String?
    private var messageId: String?
    private var generation = 0
    private var latestOpen = UUID()

    func reset(for messageId: String) {
        guard self.messageId != messageId else { return }
        self.messageId = messageId
        generation += 1
        downloaded = [:]
        loading = []
        previewURL = nil
        error = nil
    }

    func open(_ attachment: MailAttachment, messageId: String, using api: any MailAttachmentAPI) async {
        reset(for: messageId)
        guard !loading.contains(attachment.id) else { return }
        error = nil
        let openRequest = UUID()
        latestOpen = openRequest
        if let url = downloaded[attachment.id] {
            previewURL = url
            return
        }
        let request = generation
        loading.insert(attachment.id)
        defer { if request == generation { loading.remove(attachment.id) } }
        do {
            let url = try await api.mailDownloadAttachment(messageId: messageId, attachment: attachment)
            guard request == generation else { return }
            downloaded[attachment.id] = url
            if latestOpen == openRequest { previewURL = url }
        } catch {
            guard request == generation, latestOpen == openRequest else { return }
            self.error = error.localizedDescription
        }
    }

    func dismissPreview() { previewURL = nil }
}
