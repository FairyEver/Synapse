import Foundation

/// 开关。默认**开**：朋友复现一次不容易，"忘了先打开开关"是最没必要的一种浪费。
///
/// 用可注入的 `defaults` 而不是直接读 `.standard`，与 `TerminalDisplaySettings`
/// 同一套写法 —— 设置类的东西不这样写就没法在单测里验。
nonisolated struct DiagnosticLogSettings {
    static let key = "SynapseDiagnosticLogEnabled"
    /// 第二个开关：**要不要把终端屏幕内容与发给电脑的内容也记下来**。
    ///
    /// 与上面那个分开，是因为它换出去的东西不一样：第一个开关换的是"有没有诊断数据"，
    /// 这一个换的是"日志里有没有你终端里当时可见的任何东西"。默认**开**（跟随第一个
    /// 开关默认开的立场，也是"日志里得有能自查的东西"这个本意），代价用另外三道来抵：
    /// 每秒至多一条、三重限长、以及导出时的二次确认。
    static let capturesContentKey = "SynapseDiagnosticLogCapturesContent"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isEnabled: Bool {
        get { defaults.object(forKey: Self.key) as? Bool ?? true }
        nonmutating set { defaults.set(newValue, forKey: Self.key) }
    }

    var capturesContent: Bool {
        get { defaults.object(forKey: Self.capturesContentKey) as? Bool ?? true }
        nonmutating set { defaults.set(newValue, forKey: Self.capturesContentKey) }
    }
}

/// 诊断日志的入口。整个 App 只跟这一个类型打交道。
///
/// 门面薄得几乎没有逻辑，这是有意的：往里加功能的地方，就是往后把主线程拖住的地方。
/// `record` 做的事情少到可以背下来 —— 判开关、塞进缓冲区、需要时催一次落盘，
/// 全部不碰磁盘。
nonisolated enum DiagnosticLog {
    private final class State: @unchecked Sendable {
        var sink: DiagnosticFileSink?
        var settings = DiagnosticLogSettings()
        var enabled = true
        /// 要不要记屏幕内容与发给电脑的内容。与 `enabled` 分开：关掉日志是"什么都别记"，
        /// 关掉这个是"记，但别记终端里那些字"。
        var capturesContent = true
        var started = false
        /// 内容采集的**调用点闸门**。见 `captureScreen` 里为什么不能只靠缓冲区那层。
        var captureGate = CaptureGate()
    }

    /// 同一件事一秒只放行一条。
    ///
    /// 与 `DiagnosticBuffer` 里那份采样是同一个规则，但**不是同一份实现**，这是刻意的：
    /// 那一份与它的窗口记账（每秒滚动、令牌桶共用同一把锁）缠在一起，为了共用而把它
    /// 拆出来，等于为了一个 8 行的规则去重构一个已经被逐条钉住的组件。
    ///
    /// 而这一份必须存在于调用点：缓冲区那层的采样拦在**字符串已经拼好之后**，
    /// 而屏幕内容那 12 行正是这里要省掉的东西。
    final class CaptureGate: @unchecked Sendable {
        private let lock = NSLock()
        private var lastAt: [DiagnosticEvent: Date] = [:]

        func admits(_ event: DiagnosticEvent, minInterval: TimeInterval = 1.0, at now: Date) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if let last = lastAt[event], now.timeIntervalSince(last) < minInterval { return false }
            lastAt[event] = now
            return true
        }
    }

    private static let state = State()

    /// 只调一次，在 App 启动早期。
    @MainActor
    static func start() {
        guard !state.started else { return }
        state.started = true
        state.enabled = state.settings.isEnabled
        state.capturesContent = state.settings.capturesContent

        guard let sink = DiagnosticFileSink() else {
            // 目录都建不出来（磁盘满、沙盒异常）。整个子系统就此关闭，App 其余部分
            // 一个字都不用知道 —— 这里不写任何日志，因为能写日志的地方正是它。
            state.sink = nil
            return
        }
        state.sink = sink
        sink.start()
        sink.setEnabled(state.enabled)
        DiagnosticCrashHandler.install(sink: sink)

        if let previous = sink.previousSessionTail() {
            record(
                .crashSuspected,
                [
                    .init(.previousSessionLastEvent, .message(RedactedMessage(alreadyRedacted: previous.event))),
                    .init(
                        .previousSessionLastTimestamp,
                        .message(RedactedMessage(alreadyRedacted: previous.timestamp))
                    ),
                ]
            )
        }

        record(.launch, [.init(.coldStart, .bool(true))])
        DiagnosticEnvironment.recordSnapshot()
    }

    /// 记一条。
    ///
    /// 这是热路径上的函数：一次布尔读、一次取锁、一次数组追加。**没有**字符串拼接、
    /// 没有文件、没有 `Task`。任何一样加进来，滚动就会开始掉帧。
    static func record(
        _ event: DiagnosticEvent,
        _ fields: [DiagnosticEntry] = [],
        level: DiagnosticLevel? = nil
    ) {
        guard state.enabled, let sink = state.sink else { return }
        let flushNow = sink.append(
            event: event,
            level: level ?? event.defaultLevel,
            fields: fields
        )
        if flushNow { sink.submit(flushNow: true) }
    }

    // MARK: - 内容采集

    /// 记一次屏幕内容。**整个 App 里唯一构造 `.captured` 的地方。**
    ///
    /// `DiagnosticValue` 里那个能装未脱敏文本的 case 是这道防线让出去之后的产物，
    /// 换回来的是这里：一个入口、一个开关、一个采样闸。`DiagnosticContentCaptureTests`
    /// 里有一条**源码级**的守卫 —— 它读仓库源文件，断言 `.captured(` 只出现在
    /// `DiagnosticValue.swift` 与本文件里 —— 那是替代"编译不过"的东西。
    ///
    /// `rows` 是闭包，不是数组：开关关着、或者距上一次不到一秒时，**那些行根本不会被
    /// 拼出来**。缓冲区那层的采样拦不住这件事（它拦在字符串拼好之后），而这里一次
    /// 就是 12 行 + 一次脱敏正则，每秒几十次不是可以忽略的量。
    static func captureScreen(
        kind: DiagnosticFlag,
        session: String,
        rows: () -> [String]
    ) {
        guard state.enabled, state.capturesContent else { return }
        guard state.captureGate.admits(.frameContent, at: Date()) else { return }
        record(.frameContent, [
            .init(.session, alias(.session, session)),
            .init(.kind, .flag(kind)),
            .init(.screenText, .captured(CapturedText(redacting: rows()))),
        ])
    }

    /// 记一次**发给电脑的**内容：键入的命令、按下的键、递过去的文件路径。
    ///
    /// 与屏幕上那份分开成两个事件、两个字段。它们回答的是相反方向的问题
    /// （"电脑给我看了什么" 与 "我让电脑做什么"），混在一起读的人还得靠事件名去猜。
    static func captureInput(
        kind: DiagnosticIntent,
        session: String?,
        text: () -> String?
    ) {
        guard state.enabled, state.capturesContent else { return }
        guard state.captureGate.admits(.terminalInput, at: Date()) else { return }
        guard let value = text(), !value.isEmpty else { return }
        record(.terminalInput, [
            .init(.intent, .intent(kind)),
            .init(.session, session.map { alias(.session, $0) } ?? .redacted(.session)),
            .init(.inputText, .captured(CapturedText(redacting: [value]))),
        ])
    }

    /// 只在明确需要时用：允许调用点自定义降噪级别。
    static func record(_ event: DiagnosticEvent, level: DiagnosticLevel, _ fields: [DiagnosticEntry]) {
        record(event, fields, level: level)
    }

    // MARK: - 设置与界面

    static var isEnabled: Bool {
        get { state.settings.isEnabled }
        set {
            state.settings.isEnabled = newValue
            state.enabled = newValue
            state.sink?.setEnabled(newValue)
        }
    }

    /// 要不要把终端屏幕内容与发给电脑的内容也记下来。
    ///
    /// 关掉它**不删已有的**，和主开关一样：用户按下的是"以后别记这些"，不是
    /// "把已经记下来的那些抹掉"。**导出包上会写明本次含不含**，所以关掉之后
    /// 再导出的包里就没有，两者的区别在包里看得见。
    static var capturesContent: Bool {
        get { state.settings.capturesContent }
        set {
            state.settings.capturesContent = newValue
            state.capturesContent = newValue
        }
    }

    static var isAvailable: Bool { state.sink != nil }

    static func snapshot() -> DiagnosticFileSink.Snapshot {
        state.sink?.snapshot() ?? DiagnosticFileSink.Snapshot(status: .disabled)
    }

    /// 导出一个压缩包。**是 async 的**：打包要压缩，而压缩是 CPU 活。
    ///
    /// 从前的实现在主线程上 `queue.sync` 拼文件，几 MiB 拼接会卡住那一下；
    /// 里面再叠一层 deflate 就不是"卡一下"了。现在整件事排在 sink 自己那条队列上。
    @MainActor
    static func export() async -> URL? {
        guard let sink = state.sink else { return nil }
        let snapshot = sink.snapshot()
        let includesTerminalContent = state.capturesContent
        return await sink.export(
            header: DiagnosticEnvironment.exportHeader(
                counters: snapshot,
                includesTerminalContent: includesTerminalContent
            ),
            manifest: DiagnosticEnvironment.exportManifest(
                includesTerminalContent: includesTerminalContent,
                snapshot: snapshot
            )
        )
    }

    /// 删掉全部日志。**不关开关** —— 用户按下的是"把已有的删掉"，不是"以后别记了"，
    /// 把两件事合成一个动作，他会失去刚表达过的那个意思。
    static func deleteAll() {
        state.sink?.deleteAll()
    }

    /// 退出登录时调：别名表是"这个人在这一份日志里"的坐标系，换人就不该接着数。
    static func resetAliases() {
        DiagnosticAliases.shared.reset()
    }

    /// 方便调用点：把真实 id 换成日志里那个别名。
    static func alias(_ kind: DiagnosticAlias.Kind, _ id: String) -> DiagnosticValue {
        .alias(DiagnosticAliases.shared.alias(for: kind, id: id))
    }

    /// 只给测试用：把内部状态换成可控的。
    static func useSinkForTesting(_ sink: DiagnosticFileSink?) {
        state.sink = sink
    }

    /// 只给测试用：清掉"已经启动过"的闩，让用例可以重跑 `start()`。
    static func resetForTesting() {
        state.started = false
        state.sink = nil
        state.enabled = true
    }
}
