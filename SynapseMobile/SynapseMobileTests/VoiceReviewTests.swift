import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct VoiceReviewTests {
    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    @Test func cancelledPermissionDenialCannotReplaceTheNextRecording() async throws {
        let voice = VoiceInputController()
        var oldPermission: CheckedContinuation<Bool, Never>?
        var newSignature: CheckedContinuation<AsrSignOutcome, Never>?
        voice.microphoneAuthorizer = { await withCheckedContinuation { oldPermission = $0 } }
        voice.start { .notConfigured }
        await settle()
        let pendingPermission = try #require(oldPermission)
        voice.cancel()
        voice.microphoneAuthorizer = { true }
        voice.start { await withCheckedContinuation { newSignature = $0 } }
        await settle()
        let pendingSignature = try #require(newSignature)

        pendingPermission.resume(returning: false)
        await settle()
        #expect(voice.phase == .listening)
        #expect(voice.notice == nil)
        voice.cancel()
        pendingSignature.resume(returning: .unreachable)
        await settle()
    }

    private func checkCancelledSignature(_ outcome: AsrSignOutcome) async throws {
        let voice = VoiceInputController()
        voice.microphoneAuthorizer = { true }
        var oldSignature: CheckedContinuation<AsrSignOutcome, Never>?
        var newSignature: CheckedContinuation<AsrSignOutcome, Never>?
        voice.start { await withCheckedContinuation { oldSignature = $0 } }
        await settle()
        let pendingOld = try #require(oldSignature)
        voice.cancel()
        voice.start { await withCheckedContinuation { newSignature = $0 } }
        await settle()
        let pendingNew = try #require(newSignature)
        pendingOld.resume(returning: outcome)
        await settle()
        #expect(voice.phase == .listening)
        #expect(voice.transcript.isEmpty)
        voice.cancel()
        pendingNew.resume(returning: .unreachable)
        await settle()
    }

    @Test func cancelledUnreachableSignatureCannotFailTheNextRecording() async throws {
        try await checkCancelledSignature(.unreachable)
    }

    @Test func cancelledUnconfiguredSignatureCannotFailTheNextRecording() async throws {
        try await checkCancelledSignature(.notConfigured)
    }

    @Test func cancelledCaptureFailureCannotFailTheNextRecording() async throws {
        enum CaptureFailure: Error { case cancelled }
        let voice = VoiceInputController()
        voice.microphoneAuthorizer = { true }
        var pendingCapture: CheckedContinuation<Void, Error>?
        var newSignature: CheckedContinuation<AsrSignOutcome, Never>?
        voice.captureStarter = { _ in try await withCheckedThrowingContinuation { pendingCapture = $0 } }
        voice.start {
            .signed(AsrSignature(url: URL(string: "wss://example.invalid/asr")!, voiceId: "review", expiresAt: nil))
        }
        await settle()
        let pendingOld = try #require(pendingCapture)
        voice.cancel()
        voice.start { await withCheckedContinuation { newSignature = $0 } }
        await settle()
        let pendingNew = try #require(newSignature)
        pendingOld.resume(throwing: CaptureFailure.cancelled)
        await settle()
        #expect(voice.phase == .listening)
        voice.cancel()
        pendingNew.resume(returning: .unreachable)
        await settle()
    }

    @Test func closedAsrConnectionCannotPublishLateText() {
        var opened = 0
        var changed = 0
        var finished = 0
        let session = AsrSession(url: URL(string: "wss://example.invalid/asr")!, events: .init(
            onOpen: { opened += 1 }, onTranscript: { _ in changed += 1 },
            onFailure: { _ in }, onFinished: { finished += 1 }
        ))
        session.close()
        session.handle(.string(#"{"code":0,"result":{"slice_type":2,"index":0,"voice_text_str":"迟到文字"},"final":1}"#))
        #expect(session.transcript.isEmpty)
        #expect(opened == 0)
        #expect(changed == 0)
        #expect(finished == 0)
    }

    @Test func asrFinalizationOnlyFinishesOnceAndIgnoresLaterFrames() {
        var finished = 0
        let session = AsrSession(url: URL(string: "wss://example.invalid/asr")!, events: .init(
            onOpen: {}, onTranscript: { _ in }, onFailure: { _ in }, onFinished: { finished += 1 }
        ))
        session.handle(.string(#"{"code":0,"result":{"slice_type":2,"index":0,"voice_text_str":"完成文字"},"final":1}"#))
        session.handle(.string(#"{"code":0,"result":{"slice_type":2,"index":1,"voice_text_str":"不应追加"},"final":1}"#))
        #expect(session.transcript.finalText == "完成文字")
        #expect(finished == 1)
    }

    @Test func socketFailureStopsCaptureAndKeepsTheRecognizedText() async throws {
        let voice = VoiceInputController()
        voice.microphoneAuthorizer = { true }
        voice.captureStarter = { _ in }
        var stopped = 0
        voice.captureStopper = { _ in stopped += 1 }
        var connection: AsrSession?
        voice.sessionConnector = { connection = $0 }
        voice.start {
            .signed(AsrSignature(url: URL(string: "wss://example.invalid/asr")!, voiceId: "review", expiresAt: nil))
        }
        await settle()
        let session = try #require(connection)
        session.handle(.string(#"{"code":0,"result":{"slice_type":2,"index":0,"voice_text_str":"保留文字"}}"#))
        session.handle(.string(#"{"code":4014,"message":"test rejection"}"#))
        #expect(stopped == 1)
        #expect(voice.phase == .failed(.network))
        #expect(voice.transcript.finalText == "保留文字")
        #expect(await voice.confirm() == "保留文字")
        #expect(stopped == 1)
        #expect(voice.phase == .idle)
    }
}
