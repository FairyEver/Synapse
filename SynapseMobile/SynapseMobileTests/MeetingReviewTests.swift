import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct MeetingReviewTests {
    private let client = APIClient(
        tokens: TokenStore(service: "com.liy.SynapseMobile.tests.meeting-review"),
        onCredentialsChanged: {}
    )

    private func detail(_ id: String = "review-recording", status: String = "done", segments: [MeetingTranscriptSegment] = []) -> MeetingDetail {
        MeetingDetail(
            id: id, title: "测试录音", startedAt: "2026-10-04T00:00:00Z",
            durationMs: 1_000, speakerCount: 0, status: status,
            recording: MeetingRecordingState(status: "ready", mimeType: "audio/mp4", size: 1, durationMs: 1_000, deletedAt: nil),
            minutesStatus: "none", createdAt: "2026-10-04T00:00:00Z", failureReason: nil,
            speakers: [], segments: segments, minutes: nil, minutesFailureReason: nil, transcription: nil
        )
    }

    @Test func failedTranscriptionUsesTheTextPaneUnlessTheUserChoseAudio() {
        let store = MeetingStore()
        #expect(store.effectiveViewMode(status: "failed") == .text)
        #expect(store.effectiveViewMode(status: "done") == .audio)
        store.select(viewMode: .audio)
        #expect(store.effectiveViewMode(status: "failed") == .audio)
    }

    @Test func detailFailureHasAnErrorAndRetryClearsIt() async {
        let store = MeetingStore()
        store.detailFetcher = { _ in throw APIError(status: 503, code: nil, message: "服务暂时不可用") }
        #expect(await store.loadDetail("review-recording", using: client) == nil)
        #expect(store.detailError(for: "review-recording") == "服务暂时不可用")
        #expect(store.errorMessage == "服务暂时不可用")

        let loaded = detail()
        store.detailFetcher = { _ in loaded }
        #expect(await store.loadDetail(loaded.id, using: client) == loaded)
        #expect(store.detailError(for: loaded.id) == nil)
        #expect(store.errorMessage == nil)
    }

    @Test func cancelledListLoadDoesNotInventAnError() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MeetingCancelledLoadReviewURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        let loading = Task { await store.load(using: client) }
        loading.cancel()
        await loading.value
        #expect(store.errorMessage == nil)
        #expect(!store.isLoading)
        #expect(store.meetings.isEmpty)
    }

    @Test func cancelledListLoadPreservesAnExistingFailure() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MeetingCancelledLoadReviewURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        store.detailFetcher = { _ in throw APIError(status: 503, code: nil, message: "既有详情读取失败") }
        _ = await store.loadDetail("review-recording", using: client)
        let loading = Task { await store.load(using: client) }
        loading.cancel()
        await loading.value
        #expect(store.errorMessage == "既有详情读取失败")
        #expect(!store.isLoading)
    }

    @Test func anOlderDetailSuccessCannotClearANewerDifferentDetailsFailure() async {
        let store = MeetingStore()
        var olderResponse: CheckedContinuation<MeetingDetail, Error>?
        store.detailFetcher = { _ in try await withCheckedThrowingContinuation { olderResponse = $0 } }
        let older = Task { await store.loadDetail("older-recording", using: client) }
        while olderResponse == nil { await Task.yield() }
        store.detailFetcher = { _ in throw APIError(status: 503, code: nil, message: "新详情读取失败") }
        _ = await store.loadDetail("newer-recording", using: client)
        olderResponse?.resume(returning: detail("older-recording"))
        _ = await older.value
        #expect(store.detail(for: "older-recording") != nil)
        #expect(store.detailError(for: "newer-recording") == "新详情读取失败")
        #expect(store.errorMessage == "新详情读取失败")
    }

    @Test func anOlderDifferentDetailsFailureCannotReplaceANewerSuccess() async {
        let store = MeetingStore()
        var olderResponse: CheckedContinuation<MeetingDetail, Error>?
        store.detailFetcher = { _ in try await withCheckedThrowingContinuation { olderResponse = $0 } }
        let older = Task { await store.loadDetail("older-recording", using: client) }
        while olderResponse == nil { await Task.yield() }
        let newerDetail = detail("newer-recording")
        store.detailFetcher = { _ in newerDetail }
        _ = await store.loadDetail(newerDetail.id, using: client)
        olderResponse?.resume(throwing: APIError(status: 503, code: nil, message: "旧详情读取失败"))
        _ = await older.value
        #expect(store.detail(for: newerDetail.id) == newerDetail)
        #expect(store.detailError(for: "older-recording") == "旧详情读取失败")
        #expect(store.errorMessage == nil)
    }

    @Test func anOlderRenameReloadInheritsItsOriginalFeedbackOrder() async {
        let session = deletionSession()
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        var renameResponse: CheckedContinuation<Void, Error>?
        store.renameRequest = { _, _ in try await withCheckedThrowingContinuation { renameResponse = $0 } }
        let renamedDetail = detail("rename-recording")
        store.detailFetcher = { id in
            if id == renamedDetail.id { return renamedDetail }
            throw APIError(status: 503, code: nil, message: "后来的详情失败")
        }
        let renaming = Task { await store.rename(renamedDetail.id, to: "新名称", using: client) }
        while renameResponse == nil { await Task.yield() }
        _ = await store.loadDetail("newer-recording", using: client)
        renameResponse?.resume()
        #expect(await renaming.value)
        #expect(store.detail(for: renamedDetail.id) == renamedDetail)
        #expect(store.errorMessage == "后来的详情失败")
    }

    @Test func renameDetailSuccessDoesNotHideItsOwnListReloadFailure() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MeetingReloadFailureReviewURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        let loaded = detail()
        store.renameRequest = { _, _ in }
        store.detailFetcher = { _ in loaded }
        #expect(await store.rename(loaded.id, to: "新名称", using: client))
        #expect(store.detail(for: loaded.id) == loaded)
        #expect(store.detailError(for: loaded.id) == nil)
        #expect(store.errorMessage != nil)
    }

    @Test func retryListSuccessDoesNotHideItsOwnDetailReloadFailure() async {
        let session = deletionSession()
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        store.detailFetcher = { _ in throw APIError(status: 503, code: nil, message: "重试后的详情失败") }
        #expect(await store.retryTranscription("review-recording", using: client))
        #expect(store.detailError(for: "review-recording") == "重试后的详情失败")
        #expect(store.errorMessage == "重试后的详情失败")
    }

    @Test func lateDetailFailureCannotRepopulateAnExitedAccount() async {
        let store = MeetingStore()
        var response: CheckedContinuation<MeetingDetail, Error>?
        store.detailFetcher = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let loading = Task { await store.loadDetail("review-recording", using: client) }
        while response == nil { await Task.yield() }
        store.clear()
        response?.resume(throwing: APIError(status: 503, code: nil, message: "旧账号错误"))
        _ = await loading.value
        #expect(store.detailError(for: "review-recording") == nil)
        #expect(store.errorMessage == nil)
    }

    @Test func copyingRefreshesAnOlderTranscribingDetail() async {
        let store = MeetingStore()
        let pending = detail(status: "transcribing")
        store.detailFetcher = { _ in pending }
        _ = await store.loadDetail(pending.id, using: client)
        let finished = detail(segments: [MeetingTranscriptSegment(id: "segment", speakerId: 0, startMs: 0, endMs: 1_000, text: "已完成的文字", words: [])])
        store.detailFetcher = { _ in finished }
        #expect(await store.transcript(pending.id, using: client) == "已完成的文字")
    }

    @Test func anOlderDetailResponseCannotOverwriteTheNewerTranscriptionState() async {
        let store = MeetingStore()
        var responses: [CheckedContinuation<MeetingDetail, Error>] = []
        store.detailFetcher = { _ in try await withCheckedThrowingContinuation { responses.append($0) } }
        let first = Task { await store.loadDetail("review-recording", using: client) }
        while responses.count < 1 { await Task.yield() }
        let second = Task { await store.loadDetail("review-recording", using: client) }
        while responses.count < 2 { await Task.yield() }
        let finished = detail()
        responses[1].resume(returning: finished)
        _ = await second.value
        responses[0].resume(returning: detail(status: "transcribing"))
        _ = await first.value
        #expect(store.detail(for: finished.id)?.status == "done")
    }

    @Test func failedRenameReturnsFailureAndKeepsTheOriginalDetail() async {
        let store = MeetingStore()
        let original = detail()
        store.detailFetcher = { _ in original }
        _ = await store.loadDetail(original.id, using: client)
        store.renameRequest = { _, _ in throw APIError(status: 503, code: nil, message: "暂时无法保存") }
        #expect(await store.rename(original.id, to: "新名称", using: client) == false)
        #expect(store.detail(for: original.id)?.title == original.title)
        #expect(store.errorMessage == "暂时无法保存")
    }

    @Test func confirmedDeletionInvalidatesAPendingDetailAndStopsPlayback() async {
        let session = deletionSession()
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        var response: CheckedContinuation<MeetingDetail, Error>?
        store.detailFetcher = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        let loading = Task { await store.loadDetail("review-recording", using: client) }
        while response == nil { await Task.yield() }
        var stopped = 0
        #expect(await store.delete("review-recording", using: client, onDeleted: { stopped += 1 }))
        response?.resume(returning: detail())
        #expect(await loading.value == nil)
        #expect(store.detail(for: "review-recording") == nil)
        #expect(store.detailError(for: "review-recording") == nil)
        #expect(stopped == 1)
    }

    @Test func rejectedDeletionReportsFailureAndKeepsTheDetailAndPlayback() async {
        let session = deletionSession()
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        let loaded = detail("review-delete-failed")
        store.detailFetcher = { _ in loaded }
        _ = await store.loadDetail(loaded.id, using: client)
        var stopped = 0
        var failures: [String] = []
        #expect(await store.delete(loaded.id, using: client, onDeleted: { stopped += 1 }, onFailure: { failures.append($0) }) == false)
        #expect(store.detail(for: loaded.id) == loaded)
        #expect(stopped == 0)
        #expect(failures.count == 1)
        #expect(failures.first == store.errorMessage)
        #expect(failures.first?.isEmpty == false)
    }

    private func deletionSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MeetingDeleteReviewURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    @Test func failedTranscriptionRetryReturnsFailureForTheVisiblePane() async {
        let session = deletionSession()
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        let failed = detail("review-retry-failed", status: "failed")
        store.detailFetcher = { _ in failed }
        _ = await store.loadDetail(failed.id, using: client)
        #expect(await store.retryTranscription(failed.id, using: client) == false)
        #expect(store.errorMessage != nil)
        #expect(store.detail(for: failed.id)?.status == "failed")
    }

    @Test func successfulTranscriptionRetryPublishesTheNewStatus() async {
        let session = deletionSession()
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        let store = MeetingStore()
        let pending = detail(status: "transcribing")
        store.detailFetcher = { _ in pending }
        #expect(await store.retryTranscription(pending.id, using: client))
        #expect(store.detail(for: pending.id)?.status == "transcribing")
    }

    @Test func cancellingWhilePermissionIsPendingNeverCreatesARecording() async {
        let recording = MeetingRecordingSession()
        var permission: CheckedContinuation<Bool, Never>?
        var starts = 0
        recording.microphoneAuthorizer = { await withCheckedContinuation { permission = $0 } }
        recording.recordingStarter = { _ in
            starts += 1
            throw APIError(status: 503, code: nil, message: "未使用")
        }
        let starting = Task { await recording.start(using: client) }
        while permission == nil { await Task.yield() }
        recording.cancel()
        permission?.resume(returning: true)
        await starting.value
        #expect(starts == 0)
        #expect(!recording.isStarting)
        #expect(!recording.isRecording)
    }

    @Test func cancellingWhileTheServerIsCreatingARecordingRevokesTheLateResult() async {
        let recording = MeetingRecordingSession()
        var response: CheckedContinuation<APIClient.StartedRecording, Error>?
        var cancelled: [String] = []
        recording.microphoneAuthorizer = { true }
        recording.recordingStarter = { _ in try await withCheckedThrowingContinuation { response = $0 } }
        recording.recordingCanceller = { id, _ in cancelled.append(id) }
        let starting = Task { await recording.start(using: client) }
        while response == nil { await Task.yield() }
        recording.cancel()
        response?.resume(returning: APIClient.StartedRecording(meetingId: "late-meeting", recordingId: "late-recording", uploadId: "unused", title: "迟到录音"))
        await starting.value
        #expect(cancelled == ["late-recording"])
        #expect(recording.meetingId == nil)
        #expect(recording.phase == .idle)
        #expect(!recording.isStarting)
    }

    @Test func anOldPermissionResponseDoesNotClearTheNextStartsLoadingState() async {
        let recording = MeetingRecordingSession()
        var permissions: [CheckedContinuation<Bool, Never>] = []
        recording.microphoneAuthorizer = { await withCheckedContinuation { permissions.append($0) } }
        let first = Task { await recording.start(using: client) }
        while permissions.count < 1 { await Task.yield() }
        recording.cancel()
        let second = Task { await recording.start(using: client) }
        while permissions.count < 2 { await Task.yield() }
        permissions[0].resume(returning: true)
        await first.value
        #expect(recording.isStarting)
        permissions[1].resume(returning: false)
        await second.value
        #expect(!recording.isStarting)
        #expect(recording.hint == .microphoneDenied)
    }
}

nonisolated private final class MeetingCancelledLoadReviewURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
    }

    override func stopLoading() {}
}

nonisolated private final class MeetingReloadFailureReviewURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"message":"列表刷新失败"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

nonisolated private final class MeetingDeleteReviewURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let status = url.path.contains("review-delete-failed") || url.path.contains("review-retry-failed") ? 503 : 200
        let body = request.httpMethod == "GET" ? #"{"items":[]}"# : "{}"
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
