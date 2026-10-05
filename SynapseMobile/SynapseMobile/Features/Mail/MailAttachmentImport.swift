import Foundation

@MainActor
protocol MailAttachmentImportAPI: MailAccountContext {
    func mailPrepareLocalAttachment(url: URL) async throws -> MailPreparedAttachment
}

extension SynapseAppModel: MailAttachmentImportAPI {}

@MainActor
enum MailAttachmentImport {
    static func prepare(
        _ urls: [URL],
        availableSlots: Int,
        using model: any MailAttachmentImportAPI,
        onAttachment: (MailAttachment) -> Void,
        onError: (String) -> Void
    ) async {
        let account = model.accountIdentityGeneration
        var remaining = availableSlots
        for url in urls {
            guard model.isCurrentAccount(account), !Task.isCancelled else { return }
            guard remaining > 0 else { onError("附件不能超过 10 个。"); return }
            do {
                let prepared = try await model.mailPrepareLocalAttachment(url: url)
                guard model.isCurrentAccount(account), !Task.isCancelled else { return }
                onAttachment(prepared.attachment)
                remaining -= 1
            } catch {
                guard model.isCurrentAccount(account), !Task.isCancelled else { return }
                onError(error.localizedDescription)
            }
        }
    }
}
