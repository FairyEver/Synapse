import Foundation
import Testing
@testable import SynapseMobile

/// 会议列表和逐字稿里那些「看起来只是格式化」的东西。
///
/// 它们全是用户判断信息的依据：时长是不是 0 分、说话人有没有名字、录音还在不在。
/// 算错了不会崩，只会让人读错，所以值得钉住。
struct MeetingTextTests {
    private func meeting(
        startedAt: String = "2026-09-19T14:00:00.000Z",
        durationMs: Int = 48 * 60 * 1000,
        speakerCount: Int = 4,
        status: String = "done",
        recordingStatus: String = "ready"
    ) throws -> MeetingSummary {
        let json = """
        {
          "id": "m-1",
          "title": "Q3 路线图评审",
          "startedAt": "\(startedAt)",
          "durationMs": \(durationMs),
          "speakerCount": \(speakerCount),
          "status": "\(status)",
          "recording": {
            "status": "\(recordingStatus)",
            "mimeType": "audio/mp4",
            "size": 1024,
            "durationMs": \(durationMs),
            "deletedAt": null
          },
          "minutesStatus": "none",
          "createdAt": "2026-09-19T14:00:00.000Z"
        }
        """
        return try JSONDecoder().decode(MeetingSummary.self, from: Data(json.utf8))
    }

    @Test func durationUsesSecondsBelowOneMinute() throws {
        // 40 秒的测试录音显示成「0 分」会让人以为什么都没录上。
        #expect(MeetingText.duration(40_000) == "40 秒")
        #expect(MeetingText.duration(0) == "0 秒")
    }

    @Test func durationUsesMinutesAndHours() {
        #expect(MeetingText.duration(48 * 60 * 1000) == "48 分")
        #expect(MeetingText.duration(72 * 60 * 1000) == "1 小时 12 分")
    }

    @Test func statusLabelsMatchTheDesktopWording() {
        #expect(MeetingText.statusLabel("transcribing") == "转写中")
        #expect(MeetingText.statusLabel("done") == "已完成")
        #expect(MeetingText.statusLabel("failed") == "转写失败")
        #expect(MeetingText.statusLabel("something-new") == "转写中")
    }

    @Test func speakerUsesRealNameWhenFilledIn() {
        let speakers = [
            MeetingSpeaker(speakerId: 0, name: "李杨"),
            MeetingSpeaker(speakerId: 1, name: nil),
            MeetingSpeaker(speakerId: 2, name: "   "),
        ]
        #expect(MeetingText.speakerLabel(speakers, 0) == "李杨")
        // 没填的用编号；编号从 1 开始数，因为它对应的是人话里的「发言人 1」。
        #expect(MeetingText.speakerLabel(speakers, 1) == "发言人 2")
        #expect(MeetingText.speakerLabel(speakers, 2) == "发言人 3")
        // 服务端还没建映射记录时也不能崩。
        #expect(MeetingText.speakerLabel([], 0) == "发言人 1")
    }

    @Test func clockIsZeroPaddedMinutesAndSeconds() {
        #expect(MeetingText.clock(0) == "00:00")
        #expect(MeetingText.clock(62_000) == "01:02")
        #expect(MeetingText.clock(-5) == "00:00")
    }

    @Test func secondaryLineOmitsEmptyParts() throws {
        let line = MeetingText.secondary(try meeting())
        #expect(line.contains("48 分"))
        #expect(line.contains("4 位发言人"))
        // 录音还在时不该特意说一句「录音还在」。
        #expect(!line.contains("录音已删除"))
    }

    @Test func secondaryLineSaysSoWhenTheRecordingIsGone() throws {
        let line = MeetingText.secondary(try meeting(recordingStatus: "deleted"))
        #expect(line.contains("录音已删除"))
    }

    @Test func secondaryLineSkipsDurationAndSpeakersWhenZero() throws {
        let line = MeetingText.secondary(try meeting(durationMs: 0, speakerCount: 0))
        #expect(!line.contains("分"))
        #expect(!line.contains("发言人"))
    }

    @Test func decodingAcceptsTheServersFieldNames() throws {
        // 字段名和服务端 DTO 一一对应；改名时这条会红，而不是等到界面上一片空白。
        let decoded = try meeting()
        #expect(decoded.id == "m-1")
        #expect(decoded.recording.status == "ready")
        #expect(!decoded.recording.isDeleted)
    }

    @Test func deletedRecordingIsRecognised() throws {
        #expect(try meeting(recordingStatus: "deleted").recording.isDeleted)
        #expect(!(try meeting(recordingStatus: "ready").recording.isDeleted))
    }
}
