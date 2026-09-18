import Foundation

/// 开关。默认**开**：朋友复现一次不容易，"忘了先打开开关"是最没必要的一种浪费。
///
/// 用可注入的 `defaults` 而不是直接读 `.standard`，与 `TerminalDisplaySettings`
/// 同一套写法 —— 设置类的东西不这样写就没法在单测里验。
nonisolated struct DiagnosticLogSettings {
    static let key = "SynapseDiagnosticLogEnabled"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var isEnabled: Bool {
        get { defaults.object(forKey: Self.key) as? Bool ?? true }
        nonmutating set { defaults.set(newValue, forKey: Self.key) }
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
        var started = false
    }

    private static let state = State()

    /// 只调一次，在 App 启动早期。
    @MainActor
    static func start() {
        guard !state.started else { return }
        state.started = true
        state.enabled = state.settings.isEnabled

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

    static var isAvailable: Bool { state.sink != nil }

    static func snapshot() -> DiagnosticFileSink.Snapshot {
        state.sink?.snapshot() ?? DiagnosticFileSink.Snapshot(status: .disabled)
    }

    @MainActor
    static func export() -> URL? {
        guard let sink = state.sink else { return nil }
        return sink.export(header: DiagnosticEnvironment.exportHeader(counters: sink.snapshot()))
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
