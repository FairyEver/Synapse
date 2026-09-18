import Foundation
import Observation

/// 会议列表与详情的读取。
///
/// 手机端**直连服务端**，不经过电脑：转写发生在云端，结果也在服务端，和电脑在不在
/// 线没有关系。这是这个功能和手机端既有「电脑的远程视图」定位最大的不同。
///
/// 只读。本轮手机端不做录音、不做编辑。
@MainActor
@Observable
final class MeetingStore {
    private(set) var meetings: [MeetingSummary] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    /// 详情按 id 缓存，来回点列表不会每次都重新拉一遍。
    private var details: [String: MeetingDetail] = [:]

    func detail(for meetingId: String) -> MeetingDetail? { details[meetingId] }

    /// 有没有还没跑完的转写。列表据此决定要不要继续轮询。
    var hasTranscribing: Bool { meetings.contains { $0.status == "transcribing" } }

    func load(using client: APIClient) async {
        isLoading = true
        defer { isLoading = false }
        do {
            meetings = try await client.listMeetings()
            errorMessage = nil
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "读取会议记录失败。"
        }
    }

    /// 转写还在进行时，列表要自己变过来，而不是等用户下拉。
    func refreshWhileTranscribing(using client: APIClient) async {
        guard meetings.contains(where: { $0.status == "transcribing" }) else { return }
        await load(using: client)
    }

    @discardableResult
    func loadDetail(_ meetingId: String, using client: APIClient) async -> MeetingDetail? {
        do {
            let detail = try await client.meetingDetail(meetingId)
            details[meetingId] = detail
            return detail
        } catch let error as APIError {
            errorMessage = error.message
            return details[meetingId]
        } catch {
            errorMessage = "读取会议详情失败。"
            return details[meetingId]
        }
    }

    /// 退出登录时清干净：下一个账号不该看到上一个账号的会议。
    func clear() {
        meetings = []
        details = [:]
        errorMessage = nil
    }
}
