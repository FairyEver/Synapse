import Foundation
import Testing

@testable import SynapseMobile

/// 一条收尾不掉的录音，什么时候才算「真的算了」。
///
/// 判据只有一个：**服务端说不认识它**（404）。那之后每次开机重试都注定失败，而那条记录在
/// 界面上根本不出现——没收尾的录音进不了列表，所以谁也不会发现它一直留在本机。反过来，
/// 网络断了、超时、5xx 都还得留着下次再试，那才是这条收尾路本来的意思。
///
/// **两个方向判错都要命**：判成「算了」会丢掉还能救的录音；判成「再试」就会永远重试一条
/// 已经救不回来的。所以这条区分单独成一个函数，由这里钉住。
@Suite(.serialized)
@MainActor
struct MeetingRecordingRecoveryTests {
    private func error(status: Int) -> APIError {
        APIError(status: status, code: nil, message: "x")
    }

    /// 服务端已经不认这条录音了 —— 唯一该放手的一种。
    @Test func aMissingRecordingIsGivenUpOn() {
        #expect(MeetingRecordingSession.recoveryOutcome(for: error(status: 404)) == .giveUp)
    }

    /// 网络失败（`status == 0` 是传输层，见 `APIError.isTransport`）。
    /// 本机的残片还在，等网络回来就收得完。
    @Test func aTransportFailureIsRetried() {
        #expect(MeetingRecordingSession.recoveryOutcome(for: error(status: 0)) == .retryLater)
    }

    /// 服务端自己的毛病不是这条录音的判决 —— 换一会儿再来。
    @Test func aServerFailureIsRetried() {
        for status in [500, 502, 503, 504, 429, 408] {
            #expect(
                MeetingRecordingSession.recoveryOutcome(for: error(status: status)) == .retryLater,
                "\(status) 不该被当成「这条录音没了」"
            )
        }
    }

    /// 认不出的错误（取消、解码失败……）也算「下次再试」：宁可多试一次，也不要丢掉一条
    /// 还能救的录音。
    @Test func anUnknownFailureIsRetried() {
        struct Unexpected: Error {}
        #expect(MeetingRecordingSession.recoveryOutcome(for: Unexpected()) == .retryLater)
    }

    @Test func aMissingRecordingDuringRecoveredUploadDiscardsItsResidue() async throws {
        try await withPendingRecording(status: "404", uploadedParts: 0) { record, audio, client in
            await MeetingRecordingSession().resolvePendingRecordings(using: client)
            let requests = MeetingRecoveryReviewURLProtocol.counts(recordingId: record.recordingId)
            let pendingURL = try MeetingRecordingFiles.pendingURL(recordingId: record.recordingId)
            #expect(requests.parts > 0)
            #expect(requests.completions == 0)
            #expect(!FileManager.default.fileExists(atPath: audio.path))
            #expect(!FileManager.default.fileExists(atPath: pendingURL.path))
        }
    }

    @Test func aMissingRecordingDuringRecoveredReconciliationDiscardsItsResidue() async throws {
        try await withPendingRecording(status: "404", uploadedParts: 1, byteCount: MeetingAudio.partBytes) { record, audio, client in
            await MeetingRecordingSession().resolvePendingRecordings(using: client)
            let requests = MeetingRecoveryReviewURLProtocol.counts(recordingId: record.recordingId)
            let pendingURL = try MeetingRecordingFiles.pendingURL(recordingId: record.recordingId)
            #expect(requests.parts == 1)
            #expect(requests.completions == 0)
            #expect(!FileManager.default.fileExists(atPath: audio.path))
            #expect(!FileManager.default.fileExists(atPath: pendingURL.path))
        }
    }

    @Test func aRecoveredUploadTransportOrServerFailurePreservesItsResidue() async throws {
        for status in ["network", "503"] {
            try await withPendingRecording(status: status, uploadedParts: 0) { record, audio, client in
                await MeetingRecordingSession().resolvePendingRecordings(using: client)
                let requests = MeetingRecoveryReviewURLProtocol.counts(recordingId: record.recordingId)
                let pendingURL = try MeetingRecordingFiles.pendingURL(recordingId: record.recordingId)
                #expect(requests.parts > 0)
                #expect(requests.completions == 0)
                #expect(FileManager.default.fileExists(atPath: audio.path))
                #expect(FileManager.default.fileExists(atPath: pendingURL.path))
            }
        }
    }

    @Test func aRecoveredLocalReadFailurePreservesItsResidue() async throws {
        try await withPendingRecording(status: "503", uploadedParts: 0, unreadableDirectory: true) { record, audio, client in
            await MeetingRecordingSession().resolvePendingRecordings(using: client)
            let requests = MeetingRecoveryReviewURLProtocol.counts(recordingId: record.recordingId)
            let pendingURL = try MeetingRecordingFiles.pendingURL(recordingId: record.recordingId)
            #expect(requests.parts == 0)
            #expect(requests.completions == 0)
            #expect(FileManager.default.fileExists(atPath: audio.path))
            #expect(FileManager.default.fileExists(atPath: pendingURL.path))
        }
    }

    /// 只在无既有待恢复记录的测试容器运行，清理仅针对本次 UUID。
    private func withPendingRecording(
        status: String,
        uploadedParts: Int,
        byteCount: Int = 4_096,
        unreadableDirectory: Bool = false,
        body: (PendingMeetingRecording, URL, APIClient) async throws -> Void
    ) async throws {
        let directory = try MeetingRecordingFiles.directory()
        let existing = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        try #require(!existing.contains { $0.hasSuffix(".pending.json") }, "测试前已有待恢复录音，保留原记录并停止本用例。")
        let recordingId = "review-recovery-\(status)-\(UUID().uuidString)"
        let record = PendingMeetingRecording(meetingId: UUID().uuidString, recordingId: recordingId,
            title: "恢复回归", startedAt: Date(), uploadedParts: uploadedParts)
        let audio = try MeetingRecordingFiles.audioURL(recordingId: recordingId)
        try #require(!FileManager.default.fileExists(atPath: audio.path))
        if unreadableDirectory {
            try FileManager.default.createDirectory(at: audio, withIntermediateDirectories: false)
        } else {
            try Data(repeating: 1, count: byteCount).write(to: audio)
        }
        PendingMeetingRecordingStore.save(record)
        defer {
            PendingMeetingRecordingStore.remove(recordingId: recordingId)
            try? FileManager.default.removeItem(at: audio)
            MeetingRecoveryReviewURLProtocol.forget(recordingId: recordingId)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MeetingRecoveryReviewURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), session: session, onCredentialsChanged: {})
        try await body(record, audio, client)
    }
}

nonisolated private final class MeetingRecoveryReviewURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var paths: [String] = []

    static func counts(recordingId: String) -> (parts: Int, completions: Int) {
        lock.lock(); defer { lock.unlock() }
        let matching = paths.filter { $0.contains("/\(recordingId)/") }
        return (matching.filter { $0.contains("/parts/") }.count,
                matching.filter { $0.hasSuffix("/complete") }.count)
    }

    static func forget(recordingId: String) {
        lock.lock(); defer { lock.unlock() }
        paths.removeAll { $0.contains("/\(recordingId)/") }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.lock(); Self.paths.append(url.path); Self.lock.unlock()
        if url.path.contains("/review-recovery-network-") {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        // 未知记录一律临时失败，绝不能让测试清理其它待恢复录音。
        let status = url.path.contains("/review-recovery-404-") ? 404 : 503
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"message":"恢复回归错误"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
