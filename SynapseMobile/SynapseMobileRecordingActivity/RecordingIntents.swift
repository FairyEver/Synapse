import ActivityKit
import AppIntents
import Foundation

/// 四个入口共用同一份意图：实时活动上的取消 / 完成、控制中心的控件、主屏长按图标
/// 的快捷操作、以及 Siri。
enum RecordingIntentAction {
    case start
    case finish
    case cancel
}

/// 意图和录音机之间的那一个入口。
///
/// 意图必须同时编进 App 和扩展——锁屏上那个按钮是扩展画的——但扩展里没有录音机，
/// 所以这里不直接做事：App 启动时把自己的处理函数挂上来，意图负责调用它。
/// 按下去的时候录音正在跑，App 也就一定活着，这条路径不会落空。
@MainActor
enum RecordingIntentRouter {
    static var handler: ((RecordingIntentAction) -> Void)?

    static func send(_ action: RecordingIntentAction) {
        guard let handler else {
            // 没有处理函数就说明 App 里没有录音在跑。锁屏上若还留着一条活动，那是上
            // 一次没收拾干净的，收掉它，不留一个按了没反应的按钮。
            Task { await RecordingActivityHousekeeping.endOrphans() }
            return
        }
        handler(action)
    }
}

/// 结束所有还挂着的录音实时活动。
enum RecordingActivityHousekeeping {
    static func endOrphans() async {
        for activity in Activity<RecordingActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

/// 开始录音。控制中心、主屏快捷操作、Siri 都走它。
struct StartRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "开始录音"
    static var description = IntentDescription("开始一段新录音。")

    /// 录音页要出现在眼前：用户按下这个按钮之后得能看见正在录，也得能立刻取消。
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        RecordingIntentRouter.send(.start)
        return .result()
    }
}

/// 收尾并保存。锁屏和灵动岛上的「完成」走它。
struct FinishRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "完成录音"

    /// 不把 App 拉到前台：按下「完成」的人要的是这件事结束，不是换个地方看它。
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        RecordingIntentRouter.send(.finish)
        return .result()
    }
}

/// 丢掉这一段。锁屏和灵动岛上的「取消」走它。
struct CancelRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "取消录音"

    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        RecordingIntentRouter.send(.cancel)
        return .result()
    }
}
