import AVFoundation
import Foundation
import Testing
@testable import SynapseMobile

@Suite(.serialized)
@MainActor
struct MeetingPlaybackReviewTests {
    @Test func cachedAudioShowsMetadataDurationBeforePlaybackBegins() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("meeting-playback-review-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = MeetingAudioCache(directory: directory)
        let data = Data([0, 1, 2, 3])
        try data.write(to: cache.audioURL(meetingId: "review"))
        cache.store(meetingId: "review", size: data.count, peaks: "")
        let playback = MeetingPlayback(cache: cache)
        defer { playback.clear() }
        let client = APIClient(tokens: TokenStore(service: "com.liy.SynapseMobile.tests.playback-review"), onCredentialsChanged: {})
        await playback.load(meetingId: "review", serverSize: data.count, durationMs: 19_000, using: client)
        #expect(playback.durationSeconds == 19)
        #expect(playback.currentSeconds == 0)
        #expect(!playback.isPlaying)
        #expect(!playback.isLoading)
    }

    @Test func playbackRestoresOutputAfterVoiceInputLeftTheRecordCategory() async throws {
        let session = AVAudioSession.sharedInstance()
        let previous = (session.category, session.mode, session.categoryOptions)
        defer {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(previous.0, mode: previous.1, options: previous.2)
        }
        try session.setCategory(.record, mode: .default)
        try await withCachedAudio { playback in
            playback.togglePlay(whileRecording: false)
            #expect(session.category == .playback)
            #expect(playback.isPlaying)
            playback.togglePlay(whileRecording: false)
            #expect(!playback.isPlaying)
        }
    }

    @Test func playbackPreservesTheCategoryAndRouteOfAnExistingMeetingRecording() async throws {
        let session = AVAudioSession.sharedInstance()
        let previous = (session.category, session.mode, session.categoryOptions)
        defer {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(previous.0, mode: previous.1, options: previous.2)
        }
        let route: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetooth]
        try session.setCategory(.playAndRecord, mode: .default, options: route)
        try await withCachedAudio { playback in
            playback.togglePlay(whileRecording: true)
            #expect(session.category == .playAndRecord)
            #expect(session.categoryOptions == route)
            #expect(playback.isPlaying)
            playback.togglePlay(whileRecording: true)
            #expect(session.category == .playAndRecord)
            #expect(session.categoryOptions == route)
            #expect(!playback.isPlaying)
        }
    }

    private func withCachedAudio(_ check: (MeetingPlayback) throws -> Void) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("meeting-playback-policy-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = MeetingAudioCache(directory: directory)
        let data = Data([0, 1, 2, 3])
        try data.write(to: cache.audioURL(meetingId: "review"))
        cache.store(meetingId: "review", size: data.count, peaks: "")
        let playback = MeetingPlayback(cache: cache)
        defer { playback.clear() }
        let client = APIClient(tokens: TokenStore(service: UUID().uuidString), onCredentialsChanged: {})
        await playback.load(meetingId: "review", serverSize: data.count, using: client)
        try check(playback)
    }
}
