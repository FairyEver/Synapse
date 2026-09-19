import Foundation

/// 服务端返回的一条录音。
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

/// 详情比列表多出转写文字，其余字段与列表一致。
///
/// `speakers` / `minutes` 两端的界面都不再渲染，字段仍然保留、仍然必须能解码：
/// 服务端照常返回，没升级到新版本的 App 打开详情页时就不会解码失败。
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

    /// 录音页那口钟。**不是** `duration`——那个说的是「这条录音有多长」（48 分），
    /// 这个说的是「正在录了多久」，要一秒一秒地读出来。
    static func clock(_ milliseconds: Int) -> String {
        let total = max(0, milliseconds) / 1000
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%02d:%02d", minutes, seconds)
    }

    /// 时长：不到一分钟显示秒，否则显示分。
    static func duration(_ milliseconds: Int) -> String {
        let seconds = max(0, milliseconds) / 1000
        if seconds < 60 { return "\(seconds) 秒" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes) 分" }
        return "\(minutes / 60) 小时 \(minutes % 60) 分"
    }

    /// 转写文字：腾讯云按句返回，并成约 110 字一段才读得像一篇文章。
    ///
    /// 与电脑端的文字视图用同一套规则和同一个字数（`transcript-paragraphs.ts`），两端
    /// 看起来才是同一份东西。
    static func paragraphs(_ segments: [MeetingTranscriptSegment]) -> [String] {
        var paragraphs: [String] = []
        var current = ""
        for segment in segments {
            current += segment.text
            if current.count >= 110 {
                paragraphs.append(current)
                current = ""
            }
        }
        if !current.isEmpty { paragraphs.append(current) }
        return paragraphs
    }

    /// 列表的次要信息：时间 · 时长 · 录音是否还在。
    static func secondary(_ meeting: MeetingSummary) -> String {
        var parts = [relativeTime(meeting.startedAt)]
        if meeting.durationMs > 0 { parts.append(duration(meeting.durationMs)) }
        if meeting.recording.isDeleted { parts.append("录音已删除") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// 详情头部那一条：时间 · 时长。没有发言人数——两端都不再渲染它。
    static func secondaryLine(_ detail: MeetingDetail) -> String {
        var parts = [relativeTime(detail.startedAt)]
        if detail.durationMs > 0 { parts.append(duration(detail.durationMs)) }
        return parts.joined(separator: " · ")
    }

    /// 服务端给的是 ISO8601，这里翻成「今天 14:00」这种一眼能读的形式。
    static func relativeTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter.parseWireTimestamp(iso) else { return "" }
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
