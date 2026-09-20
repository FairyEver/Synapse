import Foundation

/// 进文件之前的那道闸。
///
/// 四件事都在这里，而且都在**取锁之后、写盘之前**：采样、令牌桶、环形上限、相邻合并。
/// 放在别处都不对 —— 放在写盘之后等于盘已经写爆了，放在调用点则每个调用点都要自己
/// 记得限流，那是必然会漏的写法。
///
/// 时钟可注入，因为这一层全是与时间有关的算术，而这类算术靠真等一秒来测既慢又不稳。
nonisolated final class DiagnosticBuffer: @unchecked Sendable {
    struct Limits: Sendable {
        /// 待落盘的硬上限。到顶就丢最旧的 —— 崩溃现场在最新那几条里，不在最旧的。
        var pendingCapacity = 1_000
        /// 积压到这个数就催一次落盘，不必等到定时器。
        var flushThreshold = 100
        /// 每秒最多写多少条。防的是"某处循环里打了个日志"这种失控。
        var maxRecordsPerSecond = 200
        var maxBytesPerSecond = 64 * 1024
        /// 高频事件的采样率。表里没有的事件不采样，来一条记一条。
        ///
        /// **每一个高频新事件都必须在这里有一格。** 忘了配不会报错，只会让它在洪峰里
        /// 和终端那两条抢同一桶令牌 —— 而那正是「日志里最关键的那条恰好没记上」的来源。
        /// `DiagnosticInterfaceLoggingTests` 里有一条「合成最坏一秒」按这个前提断言。
        ///
        /// 稳态最坏一秒的量级：`scrollTick` 10 + `rows` 20 + `frame` 4 + `frameContent` 1
        /// + `send` 2 + 连续按键的 intent 与其回执各 ~5 + REST 突发 ~5 ≈ 57 条，
        /// 对 200 条/秒有 3.5 倍余量 —— 不需要第二套配给机制。
        var samplesPerSecond: [DiagnosticEvent: Int] = [
            .terminalScrollTick: 10,
            .terminalRows: 20,
            .frame: 4,
            .frameContent: 1,
            .terminalInput: 1,
            .send: 2,
        ]
    }

    private let limits: Limits
    private let now: @Sendable () -> Date
    private let lock = NSLock()

    private var pending: [DiagnosticRecord] = []
    private var nextSeq = 1
    private var lastSampleAt: [DiagnosticEvent: Date] = [:]

    private var windowStart: Date
    private var recordsInWindow = 0
    private var bytesInWindow = 0
    private var suppressedInWindow = 0

    private var overwrittenTotal = 0
    private var droppedTotal = 0
    private var droppedBytesTotal = 0

    init(limits: Limits = Limits(), now: @escaping @Sendable () -> Date = { Date() }) {
        self.limits = limits
        self.now = now
        self.windowStart = now()
    }

    /// 收下一条记录。返回 true 表示积压够了，该催一次落盘。
    ///
    /// 这个返回值而不是在这里直接落盘：写盘会阻塞，而写盘时持着锁就等于把每个
    /// 打日志的线程都按在磁盘上 —— 那正是"日志拖慢 App"的成因。
    @discardableResult
    func append(
        event: DiagnosticEvent,
        level: DiagnosticLevel,
        fields: [DiagnosticEntry] = []
    ) -> Bool {
        let time = now()

        lock.lock()
        defer { lock.unlock() }

        rollWindowIfNeeded(at: time)

        guard admitsBySampling(event, at: time) else { return false }

        let record = DiagnosticRecord(
            seq: nextSeq,
            time: time,
            level: level,
            event: event,
            fields: fields
        )

        // 错误绕过令牌桶：错误风暴本身就是需要被看见的那件事，把它丢掉等于把证据丢掉。
        if level < .error, isRateLimited(by: record) {
            suppressedInWindow += 1
            droppedTotal += 1
            droppedBytesTotal += record.estimatedBytes
            return false
        }

        nextSeq += 1

        pending.append(record)
        recordsInWindow += 1
        bytesInWindow += record.estimatedBytes

        if pending.count > limits.pendingCapacity {
            // 丢最旧。覆盖计数要留着，导出时写在头部 —— 一份"看起来完整"的日志
            // 比一份明说自己缺了多少的日志危险得多。
            let excess = pending.count - limits.pendingCapacity
            pending.removeFirst(excess)
            overwrittenTotal += excess
        }

        return pending.count >= limits.flushThreshold
    }

    /// 取走待落盘的记录，顺带补上本窗口被限流压掉的条数。
    func drain() -> [DiagnosticRecord] {
        lock.lock()
        defer { lock.unlock() }

        var out = pending
        pending.removeAll(keepingCapacity: true)
        if suppressedInWindow > 0 {
            out.append(
                DiagnosticRecord(
                    seq: nextSeq,
                    time: now(),
                    level: .warn,
                    event: .logDropped,
                    fields: [
                        DiagnosticEntry(.droppedCount, .int(suppressedInWindow)),
                        DiagnosticEntry(.droppedBytes, .int(bytesInWindow)),
                    ]
                )
            )
            nextSeq += 1
            suppressedInWindow = 0
        }
        return out
    }

    /// 崩溃路径专用：不取锁，取不到就返回空。
    ///
    /// 崩溃线程可能正持有这把锁，`lock()` 会死等 —— 那就是"日志把 App 卡死在崩溃上报里"。
    /// 宁可少写一段，也不能卡。
    func tryDrainForCrash() -> [DiagnosticRecord] {
        guard lock.try() else { return [] }
        let out = pending
        pending.removeAll(keepingCapacity: true)
        lock.unlock()
        return out
    }

    struct Counters: Sendable {
        var overwritten = 0
        var dropped = 0
        var droppedBytes = 0
        var pendingCount = 0
        var totalWritten = 0
    }

    var counters: Counters {
        lock.lock()
        defer { lock.unlock() }
        return Counters(
            overwritten: overwrittenTotal,
            dropped: droppedTotal,
            droppedBytes: droppedBytesTotal,
            pendingCount: pending.count,
            totalWritten: nextSeq - 1
        )
    }

    // MARK: - 判定

    /// 采样：同一事件在 1/rate 秒内只放行一条。
    ///
    /// `scrollViewDidScroll` 在 ProMotion 上可以到 120 Hz，原样记就是每秒 120 条
    /// 只说明"手指在动"的记录。
    private func admitsBySampling(_ event: DiagnosticEvent, at time: Date) -> Bool {
        guard let rate = limits.samplesPerSecond[event], rate > 0 else { return true }
        let interval = 1.0 / Double(rate)
        if let last = lastSampleAt[event], time.timeIntervalSince(last) < interval { return false }
        lastSampleAt[event] = time
        return true
    }

    private func isRateLimited(by record: DiagnosticRecord) -> Bool {
        recordsInWindow >= limits.maxRecordsPerSecond
            || bytesInWindow + record.estimatedBytes > limits.maxBytesPerSecond
    }

    private func rollWindowIfNeeded(at time: Date) {
        guard time.timeIntervalSince(windowStart) >= 1.0 else { return }
        windowStart = time
        recordsInWindow = 0
        bytesInWindow = 0
    }
}

nonisolated extension DiagnosticRecord {
    /// 用于令牌桶的估算值。不精确也无妨 —— 它决定的是"该不该继续写"，
    /// 而错一点点在这个量级上没有后果。
    var estimatedBytes: Int {
        fields.reduce(80) { total, entry in
            total + entry.field.rawValue.utf8.count + entry.value.estimatedBytes + 8
        }
    }
}

nonisolated extension DiagnosticValue {
    var estimatedBytes: Int {
        switch self {
        case .int, .durationMs: 8
        case .scalar: 10
        case .bool: 5
        case .flag: 18
        case .alias: 4
        case .redacted: 12
        case .message(let message): message.text.utf8.count
        case .stack(let stack): stack.text.utf8.count
        case .name(let name): name.text.utf8.count
        case .title(let title): title.text.utf8.count
        case .route(let route): route.rawValue.utf8.count
        case .intent(let intent): intent.rawValue.utf8.count
        case .captured(let captured): captured.text.utf8.count
        }
    }
}

/// 把相邻且"同一件事"的记录折叠成一条带次数的记录。
///
/// 纯函数，放在这里而不是落盘那一层：折叠的判据是记录之间的关系，与文件无关，
/// 于是它能在没有磁盘、没有队列的单测里被逐条钉住。
nonisolated enum DiagnosticMerge {
    static func coalesce(_ records: [DiagnosticRecord]) -> [DiagnosticRecord] {
        var out: [DiagnosticRecord] = []
        out.reserveCapacity(records.count)

        for record in records {
            if let previous = out.last, previous.canMerge(with: record) {
                out.removeLast()
                out.append(merged(previous, last: record, count: repeatCount(of: previous) + 1))
            } else {
                out.append(record)
            }
        }
        return out
    }

    private static func repeatCount(of record: DiagnosticRecord) -> Int {
        record.fields.first { $0.field == .repeatCount }.flatMap { entry -> Int? in
            if case .int(let value) = entry.value { return value }
            return nil
        } ?? 1
    }

    private static func merged(
        _ first: DiagnosticRecord,
        last: DiagnosticRecord,
        count: Int
    ) -> DiagnosticRecord {
        var fields = first.fields.filter { $0.field != .repeatCount && $0.field != .spanMs }
        fields.append(DiagnosticEntry(.repeatCount, .int(count)))
        let span = Int(last.time.timeIntervalSince(first.time) * 1000)
        if span > 0 {
            fields.append(DiagnosticEntry(.spanMs, .durationMs(span)))
        }
        return DiagnosticRecord(
            seq: first.seq,
            time: first.time,
            level: first.level,
            event: first.event,
            fields: fields
        )
    }
}
