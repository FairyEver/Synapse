import ActivityKit
import Foundation
import Observation
import os

/// 把正在录的那一条搬到系统里：锁屏实时活动、灵动岛、以及它们上面那枚停止键。
///
/// 它不参与录音本身，只做一件事：跟着录音的状态走。所以它是一台**同步器**而不是一组
/// 回调——录音开始它就起来，录音结束它就收掉。这样「谁先谁后」这类问题不存在：任何
/// 一刻都只有一个状态，而它只负责把系统里的那份对齐到这个状态上。
@MainActor
@Observable
final class MeetingLiveActivityController {
    /// 实时活动还在不在。控制中心那枚控件据此决定点了是「开始」还是「已经在录了」。
    private(set) var isLive = false

    private weak var session: MeetingRecordingSession?
    private var activity: Activity<RecordingActivityAttributes>?
    private var pump: Task<Void, Never>?

    /// 开始跟着这一条录音。
    func follow(_ session: MeetingRecordingSession) {
        self.session = session
        guard pump == nil else { return }
        pump = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if self.sync() { return }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    /// 对齐一次。返回 true 表示这条录音已经完了，同步器可以收工。
    private func sync() -> Bool {
        guard let session else { return true }
        switch session.phase {
        case .recording, .paused:
            let state = RecordingActivityAttributes.ContentState(
                elapsedSeconds: session.elapsedMs / 1000,
                pausedReason: session.phase == .paused ? "录音已暂停，麦克风被其他应用占用" : nil
            )
            if let activity {
                Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
            } else {
                request(title: session.title.isEmpty ? "新录音" : session.title, state: state)
            }
            return false
        case .idle, .saving:
            // 收尾也是「完了」：界面已经回列表，锁屏上不该还留着一条能按的活动。
            end()
            return true
        }
    }

    private func request(title: String, state: RecordingActivityAttributes.ContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // 用户关掉了实时活动。这不是错误，录音照常——只是系统里没有那一块。
            AppLog.recording.info("live activities are disabled for this device")
            return
        }
        do {
            activity = try Activity.request(
                attributes: RecordingActivityAttributes(title: title),
                content: ActivityContent(state: state, staleDate: nil)
            )
            isLive = true
        } catch {
            // 起不来就只是没有那一块，录音本身一步都不受影响。
            AppLog.recording.warning(
                "live activity request failed: \(error.localizedDescription, privacy: .public)"
            )
        }
    }

    private func end() {
        pump?.cancel()
        pump = nil
        session = nil
        isLive = false
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
