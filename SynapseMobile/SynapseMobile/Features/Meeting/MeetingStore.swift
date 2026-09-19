import Foundation
import Observation

/// 录音列表与详情的读写。
///
/// 手机端**直连服务端**，不经过电脑：转写发生在服务端，结果也在那里，和电脑在不在线
/// 没有关系。这是这个功能和手机端既有「电脑的远程视图」定位最大的不同。
///
/// 读的是列表和详情；写的是改名、删除、重试转写。采集那一头在 `MeetingRecordingSession`，
/// 不在这里——它的生命周期比任何一屏都长。
@MainActor
@Observable
final class MeetingStore {
    private(set) var meetings: [MeetingSummary] = []
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    /// 详情里那两栏。
    enum ViewMode: String {
        case audio
        case text
    }

    /// 用户在语音 / 文字之间选的那一个。
    ///
    /// 存在 store 上而不是视图上，是因为它**粘**：切到别的录音仍保持当前视图。视图上
    /// 的 `@State` 随着详情页重建就没了，用户每点一条都要重新选一次。
    private(set) var viewMode: ViewMode = .audio
    /// 用户这一次进 App 有没有自己选过。转写失败要默认落在文字视图，但那不该覆盖用户
    /// 明确选过的偏好。
    private(set) var hasChosenView = false

    func select(viewMode: ViewMode) {
        self.viewMode = viewMode
        hasChosenView = true
    }

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
            // 别的设备上删掉的那几条，本机不该还留着一份能播的副本——「删除」要跨端一致。
            // 判据在缓存里：只在**返回条数少于上限**时才判，条数正好等于上限说明还有更早的
            // 没返回，那时候不能把没露面的那些当删掉的。
            let cache = MeetingAudioCache.shared
            cache.pruneAgainstList(meetings.map(\.id), limit: MeetingAudioCache.listLimit)
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "读取录音失败。"
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
            errorMessage = "读取录音详情失败。"
            return details[meetingId]
        }
    }

    /// 改名。列表和详情一起变，不用等下一次轮询。
    func rename(_ meetingId: String, to title: String, using client: APIClient) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            try await client.renameMeeting(meetingId, to: trimmed)
            await load(using: client)
            _ = await loadDetail(meetingId, using: client)
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "改名失败。"
        }
    }

    /// 删掉整条。音频和文字一起删，行消失，不可恢复。
    ///
    /// 返回删掉了没有——调用方据此说一声「已删除」。删除是个不可逆的动作，做完了却什么
    /// 都不说，用户会不确定它到底删没删。
    @discardableResult
    func delete(_ meetingId: String, using client: APIClient) async -> Bool {
        do {
            try await client.deleteMeeting(meetingId)
            // 本地先抹掉再拉一遍：等下一次请求回来才消失的话，删掉的那一行会在原地多
            // 待半秒，看着像没删掉。
            meetings.removeAll { $0.id == meetingId }
            details[meetingId] = nil
            // 本机那份音频也跟着消失：「删除」必须真的删干净，不能这台设备删了、那台还能听。
            MeetingAudioCache.shared.remove(meetingId: meetingId)
            await load(using: client)
            return true
        } catch let error as APIError {
            errorMessage = error.message
            return false
        } catch {
            errorMessage = "删除失败。"
            return false
        }
    }

    /// 复制全文要的那一段文字。详情还没拉过就先拉一次。
    ///
    /// 没有文字时返回 nil——按钮据此置灰，而不是消失（旁边的「⋯」跟着跳位更难看）。
    func transcript(_ meetingId: String, using client: APIClient) async -> String? {
        let detail: MeetingDetail?
        if let cached = details[meetingId] {
            detail = cached
        } else {
            detail = await loadDetail(meetingId, using: client)
        }
        guard let detail else { return nil }
        let text = MeetingText.paragraphs(detail.segments).joined(separator: "\n\n")
        return text.isEmpty ? nil : text
    }

    /// 转写失败之后的「重试」。**不需要重新上传音频**：音频已经在服务端了。
    func retryTranscription(_ meetingId: String, using client: APIClient) async {
        do {
            try await client.retryMeetingTranscription(meetingId)
            _ = await loadDetail(meetingId, using: client)
            await load(using: client)
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = "重试失败。"
        }
    }

    /// 退出登录时清干净：下一个账号不该看到上一个账号的录音。
    func clear() {
        meetings = []
        details = [:]
        errorMessage = nil
    }
}
