import ActivityKit
import AppIntents
import Foundation

/// 几个入口共用同一份意图：实时活动上的停止、控制中心的控件、主屏长按图标的快捷操作、
/// 以及 Siri。
enum RecordingIntentAction {
    case start
    case finish
    case cancel
}

/// 点开锁屏和灵动岛上那张卡时走的那条链接。
///
/// 卡片本身不是按钮：它**点一下要开 App 的录音界面**，不是把这一条结束掉（结束是那枚
/// 停止键的事）。Apple 给的机制就是这条——按钮之外的区域贴一个 `widgetURL`，要开 App 走
/// 链接，要做事走 App Intent，两者不要互相冒充。
///
/// 用产品已有的 `synapse://` 命名空间，host 就是这条路由的名字，和 `synapse://threads/<id>`、
/// `synapse://update` 是同一套写法。这份文件**同时编进 App 和扩展**，所以这条链接两边
/// 必然是同一个字符串。
enum RecordingDeepLink {
    /// 贴在卡片上的那一条。扩展只负责把它挂上去，解析在 App 那一侧。
    nonisolated static let openRecording = "synapse://recording"

    /// 进来的 URL 是不是它。
    nonisolated static func isOpenRecording(_ url: URL) -> Bool {
        url.scheme == "synapse" && url.host() == "recording"
    }
}

/// 意图和录音机之间的那一个入口。
///
/// 意图必须同时编进 App 和扩展——锁屏上那个按钮是扩展画的——但扩展里没有录音机，
/// 所以这里不直接做事：App 启动时把自己的处理函数挂上来，意图负责调用它。
@MainActor
enum RecordingIntentRouter {
    static var handler: ((RecordingIntentAction) -> Void)?

    /// 比处理函数先到的动作。
    ///
    /// 锁屏上的按钮是在 App 的进程里执行的，而系统是**在后台把 App 拉起来**执行的：
    /// 那一刻 SwiftUI 的界面一个都还没建，处理函数也可能还没挂上。这时候丢掉这一条，
    /// 用户看到的就是一个按了没反应的按钮，而且不会有任何错误——所以要留着，等挂上
    /// 处理函数时补做。
    private static var pending: [RecordingIntentAction] = []

    /// App 把自己的处理函数挂上来。挂上的一刻，先把攒下的动作补做完。
    static func install(_ handler: @escaping (RecordingIntentAction) -> Void) {
        self.handler = handler
        let queued = pending
        pending = []
        for action in queued { handler(action) }
    }

    static func send(_ action: RecordingIntentAction) {
        guard let handler else {
            pending.append(action)
            return
        }
        handler(action)
    }
}

/// 结束所有还挂着的录音实时活动。
///
/// 按在一条**已经不存在**的录音上时用它：App 被系统杀掉过，实时活动却还留在锁屏上
/// （系统最长留 8 小时）。这时该做的不是「再结束一次」，而是把它收掉，不留一个按了
/// 没反应的按钮。判断放在 App 那一侧（`SynapseAppModel.handleRecordingIntent`），
/// 因为只有那里知道录音到底还在不在跑。
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
///
/// **必须是 `LiveActivityIntent`，不能是普通的 `AppIntent`。** 这一条决定了按钮按下去
/// 到底会不会发生事情：
///
/// - 普通的 `AppIntent` 默认在 **Widget 扩展的进程**里执行，而扩展里没有录音机 ——
///   `RecordingIntentRouter.handler` 在那边永远是 nil，按下去等于什么都没发生，而且
///   不会有任何报错。这正是它原来的表现。
/// - `LiveActivityIntent` 让系统改在 **App 的进程**里执行，必要时还会在后台把 App
///   拉起来（不打开界面）。Apple 对实时活动上的可交互元素就是这么要求的。
///
/// 前提在这里正好成立：录音正在跑，说明 App 活着 —— `UIBackgroundModes: audio`
/// 保着它不被挂起。
///
/// 也不要把 App 拉到前台：按下「完成」的人要的是这件事结束，不是换个地方看它。
/// Apple 的规范里，实时活动上的按钮只该做事，要开 App 得用 `Link`。
struct FinishRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "完成录音"

    @MainActor
    func perform() async throws -> some IntentResult {
        RecordingIntentRouter.send(.finish)
        return .result()
    }
}

/// 丢掉这一段。
///
/// **界面上暂时没有入口**：2026-09-20 锁屏和灵动岛各只留了一枚停止键，原来那柄取消的叉
/// 撤了（取消只能在 App 内做）。这个意图留着是因为它是公开的 App Intent——快捷指令和 Siri
/// 仍然能挑到它，`RecordingIntentRouter` 也照常认 `.cancel`。哪天要在别处再放一个「丢弃
/// 这一段」的按钮，直接接它就行，不用重写。
struct CancelRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "取消录音"

    @MainActor
    func perform() async throws -> some IntentResult {
        RecordingIntentRouter.send(.cancel)
        return .result()
    }
}
