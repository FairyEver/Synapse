import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MailAttachmentImportTests {
    @Test(arguments: [false, true]) func reloginStopsLaterUploadsAndRejectsOldResults(failure: Bool) async {
        let api = MailImportReviewAPI()
        var accepted: [MailAttachment] = []
        var errors: [String] = []
        api.prepare = { url in
            await Task.yield()
            api.accountIdentityGeneration += 1
            if failure { throw URLError(.userAuthenticationRequired) }
            return mailPreparedReviewAttachment(url)
        }
        await MailAttachmentImport.prepare(
            [mailImportURL("first"), mailImportURL("second")], availableSlots: 10, using: api,
            onAttachment: { accepted.append($0) }, onError: { errors.append($0) }
        )
        #expect(api.requests == ["first"])
        #expect(accepted.isEmpty)
        #expect(errors.isEmpty)
    }

    @Test func ordinaryUploadFailureIsReportedAndDoesNotPreventTheNextFile() async {
        let api = MailImportReviewAPI()
        var accepted: [MailAttachment] = []
        var errors: [String] = []
        api.prepare = { url in
            if url.lastPathComponent == "first" { throw URLError(.notConnectedToInternet) }
            return mailPreparedReviewAttachment(url)
        }
        await MailAttachmentImport.prepare(
            [mailImportURL("first"), mailImportURL("second")], availableSlots: 1, using: api,
            onAttachment: { accepted.append($0) }, onError: { errors.append($0) }
        )
        #expect(api.requests == ["first", "second"])
        #expect(accepted.map(\.fileName) == ["second"])
        #expect(errors.count == 1)
    }

    @Test func theAttachmentLimitPreventsAnExtraUpload() async {
        let api = MailImportReviewAPI()
        var accepted: [MailAttachment] = []
        var errors: [String] = []
        await MailAttachmentImport.prepare(
            [mailImportURL("first"), mailImportURL("second")], availableSlots: 1, using: api,
            onAttachment: { accepted.append($0) }, onError: { errors.append($0) }
        )
        #expect(api.requests == ["first"])
        #expect(accepted.count == 1)
        #expect(errors == ["附件不能超过 10 个。"])
    }
}

private func mailImportURL(_ name: String) -> URL { URL(fileURLWithPath: "/tmp/\(name)") }
private func mailPreparedReviewAttachment(_ url: URL) -> MailPreparedAttachment {
    MailPreparedAttachment(attachmentId: url.lastPathComponent, attachmentToken: "test", fileName: url.lastPathComponent, mimeType: nil, size: 1, state: "ready")
}

@MainActor
private final class MailImportReviewAPI: MailAttachmentImportAPI {
    var accountIdentityGeneration = 0
    var requests: [String] = []
    var prepare: ((URL) async throws -> MailPreparedAttachment)?
    func isCurrentAccount(_ generation: Int) -> Bool { generation == accountIdentityGeneration }
    func mailPrepareLocalAttachment(url: URL) async throws -> MailPreparedAttachment {
        requests.append(url.lastPathComponent)
        return try await prepare?(url) ?? mailPreparedReviewAttachment(url)
    }
}
