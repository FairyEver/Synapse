import Foundation

nonisolated enum DiagnosticLevel: String, Sendable, Comparable {
    case debug
    case info
    case warn
    case error

    private var order: Int {
        switch self {
        case .debug: 0
        case .info: 1
        case .warn: 2
        case .error: 3
        }
    }

    static func < (lhs: Self, rhs: Self) -> Bool { lhs.order < rhs.order }
}

/// 记录里可以出现的字段名。
///
/// 与 `DiagnosticValue` 是同一件事的两半：值那半保证"装不进终端正文"，这半保证
/// "字段名是有限集合里的一个"。两半合起来，日志的形状在编译期就定死了。
nonisolated enum DiagnosticField: String, Sendable {
    // MARK: 环境
    case appVersion, buildNumber, osVersion, deviceModel, deviceName
    case locale, timeZone, isSimulator, diskFreeBucket, systemUptimeMs
    case residentMB, availableMB, thermalState, lowPowerMode
    case orientation, boundsWidth, boundsHeight, safeAreaTop, safeAreaBottom

    // MARK: 生命周期
    case scenePhase, coldStart, previousSessionLastEvent, previousSessionLastTimestamp
    case exceptionName, lastEvent, stack

    // MARK: 认证与推送
    case authState, outcome, pushEnvironment

    // MARK: 网络
    case attempt, delayMs, reason, status, durationMs
    case session, kind, from, to, rowCount, gridColumns, gridRows, bytes, truncated, title
    case historyBefore, historyLimit, historyRows
    case desktopCount, sessionCount, gridOwner
    /// REST 方法与路由家族。**不记原始 path**：`/mobile/devices/<id>`、
    /// `/meetings/<id>/audio-url` 都带真实标识符。
    case method, route
    /// intent 的种类（闭合枚举）与它自己的别名（`r1`/`r2`），后者用来把请求和回执配对。
    case intent, request

    // MARK: 终端版面
    case displayMode, density, atHistoryFloor, cellHeight, contentInsetTop
    case contentHeight, contentWidth, firstRowIndex, lastRowIndex

    // MARK: 滚动
    case offsetY, contentSizeHeight, distanceFromBottom, isPinnedToBottom
    case isDragging, isDecelerating, zoom, isScrollEnabled, requestsInFlight
    case trigger, offsetBefore, offsetAfter, distanceFromBottomBefore, wasPinned
    case zoomFrom, zoomTo, cvPanEnabled, canvasPanEnabled
    /// 两次读取缓冲区之间，视口**上方**多了或少了几行。正数=上方插入，负数=头部裁剪。
    case rowShift

    // MARK: 选字与手势
    case selectionPhase, anchorRow, anchorColumn, headRow, headColumn, longPressState
    case gestureWinner, gestureLoser, gesturePhase, gestureKind, gestureState
    case translationY, velocityY, didMoveScrollOffset

    // MARK: 输入与界面
    case inputLength, isMultiline, hasAttachments, submitKind
    case screenName, action, entry

    // MARK: 被取下来的内容
    //
    // 只有两个字段能装未脱敏的用户内容，而且它们只在开关打开后才会出现。
    // 分成两个而不是一个：屏幕上的东西与发出去的东西在排查时是两个方向，
    // 混在一个字段里读的时候还得靠事件名去猜。
    /// 屏幕上当时可见的行。
    case screenText
    /// 发给电脑的内容：键入的命令、按下的键、递过去的文件路径。
    case inputText

    // MARK: 日志子系统自己
    case droppedCount, droppedBytes, overwritten, totalCount, repeatCount, spanMs
}

/// 一个字段名与它的值。
///
/// 用数组而不是字典：字段顺序即渲染顺序，读日志的人看到的是记录时的样子，
/// 而且省掉每次记录的一遍哈希。
nonisolated struct DiagnosticEntry: Equatable, Sendable {
    let field: DiagnosticField
    let value: DiagnosticValue

    init(_ field: DiagnosticField, _ value: DiagnosticValue) {
        self.field = field
        self.value = value
    }
}

/// 事件目录。
///
/// 名字是 `域.动作` 的形状，因为读日志时的第一句话总是"哪个域出了事"。
/// 加一个新事件要在这里加一个 case —— 这是刻意留的一道手续：日志的事件集合
/// 应当是被想过一遍的，而不是随手写个字符串就进去。
nonisolated enum DiagnosticEvent: String, Sendable, CaseIterable {
    // MARK: 环境
    case environmentSnapshot = "env.snapshot"
    case environmentMemory = "env.memory"
    case environmentThermal = "env.thermal"
    case environmentLowPower = "env.lowPower"
    case environmentOrientation = "env.orientation"

    // MARK: 生命周期
    case launch = "app.launch"
    case sessionOpen = "app.sessionOpen"
    case sessionClose = "app.sessionClose"
    /// 启动时对上一次会话未收尾的**推断** —— 它是应用层的一条结论，不是崩溃本身，
    /// 所以留在 app 路，只是内容指向 crash 路。
    case crashSuspected = "app.crashSuspected"

    // MARK: 崩溃
    /// 未捕获异常。单独一路（`crash`），因为它是唯一需要在**磁盘洪峰之外**留下痕迹的东西：
    /// term / net 两路被输出打满时轮转的是它们自己，crash 路不受影响。
    case uncaughtException = "crash.exception"

    // MARK: 认证与推送
    case authState = "auth.state"
    case pushRegister = "push.register"

    // MARK: 网络
    case connect = "net.connect"
    case connected = "net.connected"
    case disconnect = "net.disconnect"
    case reconnectScheduled = "net.reconnectScheduled"
    case frame = "net.frame"
    /// 出站 WS 信封（hello / ping / intent）。只记类型与字节数，不记内容。
    case send = "net.send"
    /// 一次 REST 请求 ↔ 响应。记路由家族、方法、状态码、耗时与**响应**字节数 ——
    /// 请求体一个字节都不进（`/auth/login` 的体里是密码）。
    case rest = "net.rest"
    /// 一个 intent 发出。与下面的回执配对，时延靠同文件相邻记录的时间戳算。
    case intent = "net.intent"
    case intentResult = "net.intent.result"
    case historyRequest = "net.history.request"
    case historyResponse = "net.history.response"
    case historyTimeout = "net.history.timeout"
    case networkError = "net.error"

    // MARK: 终端
    case terminalEnter = "term.enter"
    case terminalRows = "term.rows"
    case terminalScrollTick = "term.scrollTick"
    case terminalPinChanged = "term.pinChanged"
    case terminalFollowGrab = "term.followGrab"
    case terminalZoomChanged = "term.zoomChanged"
    case terminalSelection = "term.selection"
    case terminalGestureArbitration = "term.gesture.arbitration"
    case terminalGestureOutcome = "term.gesture.outcome"
    case terminalInput = "term.input"
    case terminalSnapshotRejected = "term.snapshot.rejected"
    case terminalLifecycle = "term.lifecycle"
    case terminalError = "term.error"
    /// 一帧终端内容被取下来（终端里的行文本）。**默认不记**，只在用户打开
    /// 「记录终端屏幕内容」之后才记，唯一构造入口是 `DiagnosticLog.captureScreen`。
    case frameContent = "term.frameContent"

    // MARK: 界面
    case screen = "ui.screen"
    case action = "ui.action"

    // MARK: 日志子系统自己
    case logDropped = "log.dropped"
    case logRotated = "log.rotated"

    /// 按最细的粒度分档，用来在降噪时不误伤重要的那条。
    var defaultLevel: DiagnosticLevel {
        switch self {
        case .terminalScrollTick, .terminalRows, .environmentMemory:
            .debug
        case .disconnect, .historyTimeout, .terminalPinChanged, .terminalFollowGrab,
             .terminalSnapshotRejected, .logDropped, .crashSuspected, .environmentThermal,
             .environmentLowPower, .reconnectScheduled:
            .warn
        case .uncaughtException, .networkError, .terminalError:
            .error
        default:
            .info
        }
    }
}

/// 落盘时按什么分文件。
///
/// 分域是这件东西存在的理由：一份混在一起的日志里，终端输出每秒几十条会把网络与生命周期
/// 那几条挤到看不见的地方（轮转按时间走，不按重要程度走）。分路之后「哪个域出了事」
/// 在磁盘上就是真的。
nonisolated enum DiagnosticLane: String, CaseIterable, Sendable {
    case app
    case term
    case net
    case env
    case crash
    case log

    /// 这个域在磁盘上的子目录名。就是 `rawValue` —— 不另起一套命名，
    /// 免得读日志的人要在两套词之间对照。
    var directoryName: String { rawValue }
}

extension DiagnosticEvent {
    /// 事件名里 `.` 之前的那一段。
    var lanePrefix: String { String(rawValue.prefix(while: { $0 != "." })) }

    /// 域**从事件名的前缀派生**，而不是给每个 case 手写一个属性。
    ///
    /// 手写的那种允许不一致：两个 `net.*` 被分到两路，没有任何机制会报错。派生没有这个
    /// 失败模式 —— 前缀表是闭合的，写了个没见过的前缀就是 `default` 那格，而
    /// `DiagnosticVocabularyTests` 会把每一个 `allCases` 的前缀都过一遍，于是
    /// 「随手写了个 `netx.foo`」是红灯，而不是磁盘上悄悄多出一路文件。
    var lane: DiagnosticLane {
        switch lanePrefix {
        case "app", "ui": .app
        case "term": .term
        case "net", "auth", "push": .net
        case "env": .env
        case "crash": .crash
        case "log": .log
        // 不可达：前缀表由上面的测试穷尽。写成 .app 而不是 fatalError —— 一个日志事件
        // 的类型错误不该让 App 崩在热路径上，落错一个域是可接受的降级。
        default: .app
        }
    }

    /// 已知前缀。测试拿它证明上面那个 switch 的 `default` 不可达。
    static let knownLanePrefixes: Set<String> = [
        "app", "ui", "term", "net", "auth", "push", "env", "crash", "log",
    ]
}

/// 一条记录。
nonisolated struct DiagnosticRecord: Equatable, Sendable {
    let seq: Int
    let time: Date
    let level: DiagnosticLevel
    let event: DiagnosticEvent
    let fields: [DiagnosticEntry]

    init(
        seq: Int,
        time: Date,
        level: DiagnosticLevel,
        event: DiagnosticEvent,
        fields: [DiagnosticEntry] = []
    ) {
        self.seq = seq
        self.time = time
        self.level = level
        self.event = event
        self.fields = fields
    }

    /// 相邻记录能否折叠成一条带次数的记录。
    ///
    /// **易变字段不参与判定**，否则一条也合不掉：滚动采样之间 offset 一定在变，
    /// 而"同一件事连续发生了 40 次"正是需要被看出来的那个事实。
    func canMerge(with other: DiagnosticRecord) -> Bool {
        guard event == other.event, level == other.level else { return false }
        return stabilityKey == other.stabilityKey
    }

    /// 去掉易变字段之后剩下的部分，作为"同一件事"的判据。
    var stabilityKey: String {
        let stable = fields
            .filter { !Self.volatileFields.contains($0.field) }
            .map { "\($0.field.rawValue)=\($0.value)" }
            .joined(separator: ",")
        return "\(event.rawValue)|\(stable)"
    }

    /// **合并自己写进去的字段也在里面**。少了 `repeatCount` 与 `spanMs`，一条记录
    /// 合并一次之后键就变了，下一轮合不动 —— 看上去像"合并时灵时不灵"。
    ///
    /// `.durationMs` 不在这里：它是真正的耗时（一次请求、一次识别），
    /// 两条只差耗时的记录不是"同一件事"，不该被折叠掉。
    private static let volatileFields: Set<DiagnosticField> = [
        .offsetY, .contentSizeHeight, .distanceFromBottom, .offsetBefore, .offsetAfter,
        .distanceFromBottomBefore, .systemUptimeMs, .residentMB, .availableMB,
        .translationY, .velocityY, .inputLength, .contentHeight,
        .repeatCount, .spanMs,
    ]
}
