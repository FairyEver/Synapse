import Foundation
import Testing
@testable import SynapseMobile

/// 录音列表和文字视图里那些「看起来只是格式化」的东西。
///
/// 它们全是用户判断信息的依据：时长是不是 0 分、录音还在不在、文字分成了几段。
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

    private func segment(_ text: String, at index: Int = 0) -> MeetingTranscriptSegment {
        MeetingTranscriptSegment(
            id: "s-\(index)",
            speakerId: 0,
            startMs: 0,
            endMs: 0,
            text: text,
            words: []
        )
    }

    @Test func paragraphsJoinSentencesInsteadOfOnePerLine() {
        // 腾讯云按句返回，一句一行读起来像流水账；并成自然段才像一篇文章。
        let sentence = "这是一句四十五个字左右的话，用来把一段撑到足够长以便观察分段的结果。"
        let paragraphs = MeetingText.paragraphs([segment(sentence), segment(sentence), segment(sentence)])
        #expect(paragraphs.count == 1)
        #expect(paragraphs.first == sentence + sentence + sentence)
    }

    @Test func paragraphsBreakOnceTheyAreLongEnough() {
        let sentence = "这是一句四十五个字左右的话，用来把一段撑到足够长以便观察分段的结果。"
        let paragraphs = MeetingText.paragraphs((0..<9).map { segment(sentence, at: $0) })
        #expect(paragraphs.count > 1)
        // 最后一段是尾巴，可以短；前面的每一段都必须够长。
        for paragraph in paragraphs.dropLast() {
            #expect(paragraph.count >= 110)
        }
    }

    @Test func shortRecordingStaysOneParagraph() {
        #expect(MeetingText.paragraphs([segment("测一下能不能录上。")]) == ["测一下能不能录上。"])
        #expect(MeetingText.paragraphs([]).isEmpty)
    }

    @Test func secondaryLineOmitsEmptyParts() throws {
        // 发言人，人话里的「4 位发言人」，已经不在这条线上了。
        let line = MeetingText.secondary(try meeting())
        #expect(line.contains("48 分"))
        #expect(!line.contains("发言人"))
        // 录音还在时不该特意说一句「录音还在」。
        #expect(!line.contains("录音已删除"))
    }

    @Test func secondaryLineSaysSoWhenTheRecordingIsGone() throws {
        let line = MeetingText.secondary(try meeting(recordingStatus: "deleted"))
        #expect(line.contains("录音已删除"))
    }

    @Test func secondaryLineSkipsDurationWhenZero() throws {
        let line = MeetingText.secondary(try meeting(durationMs: 0))
        #expect(!line.contains("分"))
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
