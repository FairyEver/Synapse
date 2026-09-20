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
    case crashSuspected = "app.crashSuspected"
    case uncaughtException = "app.uncaughtException"

    // MARK: 认证与推送
    case authState = "auth.state"
    case pushRegister = "push.register"

    // MARK: 网络
    case connect = "net.connect"
    case disconnect = "net.disconnect"
    case reconnectScheduled = "net.reconnectScheduled"
    case frame = "net.frame"
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
