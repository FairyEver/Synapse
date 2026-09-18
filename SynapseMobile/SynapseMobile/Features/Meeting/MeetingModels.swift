import Foundation

/// 服务端返回的一场会议。
///
/// 字段与服务端 `MeetingSummaryDto` 一一对应：手机端只读，不做本地派生状态。
struct MeetingSummary: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let startedAt: String
    let durationMs: Int
    let speakerCount: Int
    let status: String
    let recording: MeetingRecordingState
    let minutesStatus: String
    let createdAt: String
}

struct MeetingRecordingState: Decodable, Hashable {
    let status: String
    let mimeType: String
    let size: Int
    let durationMs: Int
    let deletedAt: String?

    /// 录音被删掉之后，播放区要明确说出来，而不是给一个点不动的按钮。
    var isDeleted: Bool { status == "deleted" }
}

struct MeetingSpeaker: Decodable, Hashable {
    let speakerId: Int
    let name: String?
}

struct MeetingTranscriptWord: Decodable, Hashable {
    let text: String
    let startMs: Int
    let endMs: Int
}

struct MeetingTranscriptSegment: Decodable, Hashable, Identifiable {
    let id: String
    let speakerId: Int
    let startMs: Int
    let endMs: Int
    let text: String
    let words: [MeetingTranscriptWord]
}

struct MeetingTodo: Decodable, Hashable, Identifiable {
    let id: String
    let text: String
    let owner: String?
    let due: String?
    let done: Bool
}

struct MeetingMinutes: Decodable, Hashable {
    let topics: [String]
    let conclusions: [String]
    let todos: [MeetingTodo]
    let editedAt: String?
}

/// 详情比列表多出逐字稿与纪要，其余字段与列表一致。
struct MeetingDetail: Decodable, Hashable {
    let id: String
    let title: String
    let startedAt: String
    let durationMs: Int
    let speakerCount: Int
    let status: String
    let recording: MeetingRecordingState
    let minutesStatus: String
    let createdAt: String
    let failureReason: String?
    let speakers: [MeetingSpeaker]
    let segments: [MeetingTranscriptSegment]
    let minutes: MeetingMinutes?
    let minutesFailureReason: String?
}

enum MeetingText {
    /// 列表里的徽标，与服务端同一套说法。
    static func statusLabel(_ status: String) -> String {
        switch status {
        case "done": return "已完成"
        case "failed": return "转写失败"
        default: return "转写中"
        }
    }

    /// 时长：不到一分钟显示秒，否则显示分。
    static func duration(_ milliseconds: Int) -> String {
        let seconds = max(0, milliseconds) / 1000
        if seconds < 60 { return "\(seconds) 秒" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes) 分" }
        return "\(minutes / 60) 小时 \(minutes % 60) 分"
    }

    /// 说话人在逐字稿里的显示名：填过真名就用真名，否则用编号。
    static func speakerLabel(_ speakers: [MeetingSpeaker], _ speakerId: Int) -> String {
        if let named = speakers.first(where: { $0.speakerId == speakerId })?.name,
           !named.trimmingCharacters(in: .whitespaces).isEmpty {
            return named
        }
        return "发言人 \(speakerId + 1)"
    }

    /// 逐字稿里的时间戳，`mm:ss`。
    static func clock(_ milliseconds: Int) -> String {
        let seconds = max(0, milliseconds) / 1000
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    /// 列表的次要信息：时间 · 时长 · 发言人数 · 录音是否还在。
    static func secondary(_ meeting: MeetingSummary) -> String {
        var parts = [relativeTime(meeting.startedAt)]
        if meeting.durationMs > 0 { parts.append(duration(meeting.durationMs)) }
        if meeting.speakerCount > 0 { parts.append("\(meeting.speakerCount) 位发言人") }
        if meeting.recording.isDeleted { parts.append("录音已删除") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// 服务端给的是 ISO8601，这里翻成「今天 14:00」这种一眼能读的形式。
    static func relativeTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter.withFractionalSeconds.date(from: iso)
            ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            formatter.dateFormat = "今天 HH:mm"
        } else if calendar.isDateInYesterday(date) {
            formatter.dateFormat = "昨天 HH:mm"
        } else {
            formatter.dateFormat = "M 月 d 日 HH:mm"
        }
        return formatter.string(from: date)
    }
}

private extension ISO8601DateFormatter {
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
