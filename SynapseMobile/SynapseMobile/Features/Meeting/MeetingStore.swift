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
    private var accountGeneration = 0
    private var loadGeneration = 0
    private var feedbackGeneration = 0
    private var errorFeedbackGeneration: Int?

    private func beginFeedback() -> Int {
        feedbackGeneration += 1
        return feedbackGeneration
    }

    private func clearFeedback(_ feedback: Int) {
        // 父操作的列表刷新失败后，详情成功不能抹掉同一趟的新错误。
        guard feedback == feedbackGeneration, errorFeedbackGeneration != feedback else { return }
        errorMessage = nil
        errorFeedbackGeneration = nil
    }

    private func failFeedback(_ message: String, feedback: Int) {
        guard feedback == feedbackGeneration else { return }
        errorMessage = message
        errorFeedbackGeneration = feedback
    }

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
    private var detailErrors: [String: String] = [:]
    private var detailLoadGenerations: [String: Int] = [:]
    /// 详情请求的异步接线口，用于复现读取失败与迟到响应；生产默认走集中 API 客户端。
    @ObservationIgnored
    var detailFetcher: ((String) async throws -> MeetingDetail)?
    @ObservationIgnored
    var renameRequest: ((String, String) async throws -> Void)?

    func detail(for meetingId: String) -> MeetingDetail? { details[meetingId] }
    func detailError(for meetingId: String) -> String? { detailErrors[meetingId] }

    /// 分段控件和正文共用同一个选择，避免失败时控件显示文字、正文仍显示语音。
    func effectiveViewMode(status: String) -> ViewMode {
        status == "failed" && !hasChosenView ? .text : viewMode
    }

    /// 有没有还没跑完的转写。列表据此决定要不要继续轮询。
    var hasTranscribing: Bool { meetings.contains { $0.status == "transcribing" } }

    func load(using client: APIClient) async {
        await load(using: client, feedback: beginFeedback())
    }

    private func load(using client: APIClient, feedback: Int) async {
        loadGeneration += 1
        let requestGeneration = loadGeneration
        let account = accountGeneration
        isLoading = true
        defer { if requestGeneration == loadGeneration, account == accountGeneration { isLoading = false } }
        do {
            let listed = try await client.listMeetings()
            guard requestGeneration == loadGeneration, account == accountGeneration else { return }
            meetings = listed
            clearFeedback(feedback)
            // 别的设备上删掉的那几条，本机不该还留着一份能播的副本——「删除」要跨端一致。
            // 判据在缓存里：只在**返回条数少于上限**时才判，条数正好等于上限说明还有更早的
            // 没返回，那时候不能把没露面的那些当删掉的。
            let cache = MeetingAudioCache.shared
            cache.pruneAgainstList(meetings.map(\.id), limit: MeetingAudioCache.listLimit)
        } catch let error as APIError {
            guard !Task.isCancelled else { return }
            if requestGeneration == loadGeneration, account == accountGeneration { failFeedback(error.message, feedback: feedback) }
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if requestGeneration == loadGeneration, account == accountGeneration { failFeedback("读取录音失败。", feedback: feedback) }
        }
    }

    /// 转写还在进行时，列表要自己变过来，而不是等用户下拉。
    func refreshWhileTranscribing(using client: APIClient) async {
        guard meetings.contains(where: { $0.status == "transcribing" }) else { return }
        await load(using: client)
    }

    @discardableResult
    func loadDetail(_ meetingId: String, using client: APIClient) async -> MeetingDetail? {
        await loadDetail(meetingId, using: client, feedback: beginFeedback())
    }

    private func loadDetail(_ meetingId: String, using client: APIClient, feedback: Int) async -> MeetingDetail? {
        let account = accountGeneration
        let request = (detailLoadGenerations[meetingId] ?? 0) + 1
        detailLoadGenerations[meetingId] = request
        do {
            let detail: MeetingDetail
            if let detailFetcher {
                detail = try await detailFetcher(meetingId)
            } else {
                detail = try await client.meetingDetail(meetingId)
            }
            guard account == accountGeneration, request == detailLoadGenerations[meetingId] else { return nil }
            details[meetingId] = detail
            detailErrors[meetingId] = nil
            clearFeedback(feedback)
            return detail
        } catch let error as APIError {
            guard account == accountGeneration, request == detailLoadGenerations[meetingId], !Task.isCancelled else { return nil }
            failFeedback(error.message, feedback: feedback)
            detailErrors[meetingId] = error.message
            return details[meetingId]
        } catch {
            guard account == accountGeneration, request == detailLoadGenerations[meetingId] else { return nil }
            guard !Task.isCancelled, !(error is CancellationError) else { return details[meetingId] }
            failFeedback("读取录音详情失败。", feedback: feedback)
            detailErrors[meetingId] = "读取录音详情失败。"
            return details[meetingId]
        }
    }

    /// 改名。列表和详情一起变，不用等下一次轮询。
    @discardableResult
    func rename(_ meetingId: String, to title: String, using client: APIClient) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let account = accountGeneration
        let feedback = beginFeedback()
        do {
            if let renameRequest {
                try await renameRequest(meetingId, trimmed)
            } else {
                try await client.renameMeeting(meetingId, to: trimmed)
            }
            guard account == accountGeneration else { return false }
            await load(using: client, feedback: feedback)
            guard account == accountGeneration else { return false }
            _ = await loadDetail(meetingId, using: client, feedback: feedback)
            return account == accountGeneration
        } catch let error as APIError {
            if account == accountGeneration { failFeedback(error.message, feedback: feedback) }
            return false
        } catch {
            if account == accountGeneration { failFeedback("改名失败。", feedback: feedback) }
            return false
        }
    }

    /// 删掉整条。音频和文字一起删，行消失，不可恢复。
    ///
    /// 返回删掉了没有——调用方据此说一声「已删除」。删除是个不可逆的动作，做完了却什么
    /// 都不说，用户会不确定它到底删没删。
    @discardableResult
    func delete(_ meetingId: String, using client: APIClient, onDeleted: (() -> Void)? = nil, onFailure: ((String) -> Void)? = nil) async -> Bool {
        let account = accountGeneration
        let feedback = beginFeedback()
        do {
            try await client.deleteMeeting(meetingId)
            guard account == accountGeneration else { return false }
            // 本地先抹掉再拉一遍：等下一次请求回来才消失的话，删掉的那一行会在原地多
            // 待半秒，看着像没删掉。
            meetings.removeAll { $0.id == meetingId }
            detailLoadGenerations[meetingId, default: 0] += 1
            details[meetingId] = nil
            detailErrors[meetingId] = nil
            // 本机那份音频也跟着消失：「删除」必须真的删干净，不能这台设备删了、那台还能听。
            MeetingAudioCache.shared.remove(meetingId: meetingId)
            // 播放器同样作废在飞下载，再刷新列表；旧下载不能重新写回已删除的缓存。
            onDeleted?()
            await load(using: client, feedback: feedback)
            return account == accountGeneration
        } catch let error as APIError {
            if account == accountGeneration, feedback == feedbackGeneration {
                failFeedback(error.message, feedback: feedback)
                onFailure?(error.message)
            }
            return false
        } catch {
            if account == accountGeneration, feedback == feedbackGeneration {
                failFeedback("删除失败。", feedback: feedback)
                onFailure?("删除失败。")
            }
            return false
        }
    }

    /// 复制全文要的那一段文字。详情还没拉过就先拉一次。
    ///
    /// 没有文字时返回 nil——按钮据此置灰，而不是消失（旁边的「⋯」跟着跳位更难看）。
    func transcript(_ meetingId: String, using client: APIClient) async -> String? {
        let detail: MeetingDetail?
        if let cached = details[meetingId], cached.status == "done" {
            detail = cached
        } else {
            detail = await loadDetail(meetingId, using: client)
        }
        guard let detail else { return nil }
        let text = MeetingText.paragraphs(detail.segments).joined(separator: "\n\n")
        return text.isEmpty ? nil : text
    }

    /// 转写失败之后的「重试」。**不需要重新上传音频**：音频已经在服务端了。
    @discardableResult
    func retryTranscription(_ meetingId: String, using client: APIClient) async -> Bool {
        let account = accountGeneration
        let feedback = beginFeedback()
        do {
            try await client.retryMeetingTranscription(meetingId)
            guard account == accountGeneration else { return false }
            _ = await loadDetail(meetingId, using: client, feedback: feedback)
            guard account == accountGeneration else { return false }
            await load(using: client, feedback: feedback)
            return account == accountGeneration
        } catch let error as APIError {
            if account == accountGeneration { failFeedback(error.message, feedback: feedback) }
        } catch {
            if account == accountGeneration { failFeedback("重试失败。", feedback: feedback) }
        }
        return false
    }

    /// 退出登录时清干净：下一个账号不该看到上一个账号的录音。
    func clear() {
        accountGeneration += 1
        loadGeneration += 1
        feedbackGeneration += 1
        meetings = []
        details = [:]
        detailErrors = [:]
        detailLoadGenerations = [:]
        errorMessage = nil
        errorFeedbackGeneration = nil
        isLoading = false
    }
}
