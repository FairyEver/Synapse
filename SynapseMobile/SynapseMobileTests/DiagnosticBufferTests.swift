import Foundation
import Testing

@testable import SynapseMobile

/// 进文件之前那道闸的四件事：环形上限、采样、限流、相邻合并。
///
/// 这一层全是与时间有关的算术，所以时钟是注进去的 —— 靠真等一秒来测既慢又不稳，
/// 而"每秒最多 200 条"这种断言恰恰是必须年年稳过的那一类。
struct DiagnosticBufferTests {
    private final class Clock: @unchecked Sendable {
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        func advance(_ seconds: TimeInterval) { now += seconds }
    }

    private func buffer(
        clock: Clock,
        _ configure: (inout DiagnosticBuffer.Limits) -> Void = { _ in }
    ) -> DiagnosticBuffer {
        var limits = DiagnosticBuffer.Limits()
        configure(&limits)
        return DiagnosticBuffer(limits: limits, now: { clock.now })
    }

    // MARK: - 环形上限

    /// 满了丢**最旧**的。崩溃现场在最新那几条里，不在最旧的。
    @Test func aFullBufferDropsTheOldest() {
        let clock = Clock()
        let buffer = buffer(clock: clock) {
            $0.pendingCapacity = 5
            $0.flushThreshold = 1_000
        }
        for index in 0..<8 {
            buffer.append(event: .action, level: .info, fields: [.init(.repeatCount, .int(index))])
        }
        let drained = buffer.drain()
        #expect(drained.count == 5)
        #expect(buffer.counters.overwritten == 3)
    }

    @Test func sequenceNumbersOnlyGoUp() {
        let clock = Clock()
        let buffer = buffer(clock: clock) { $0.pendingCapacity = 100 }
        for _ in 0..<3 {
            clock.advance(0.5)
            buffer.append(event: .action, level: .info, fields: [])
        }
        let sequences = buffer.drain().map(\.seq)
        #expect(sequences == sequences.sorted())
        #expect(Set(sequences).count == sequences.count)
    }

    // MARK: - 采样

    /// `scrollViewDidScroll` 在 ProMotion 上能到 120 Hz，原样记就是每秒 120 条只说明
    /// "手指在动"的行。采到 10 Hz 就够看出"手指在动而 offset 不动"。
    @Test func highFrequencyEventsAreSampled() {
        let clock = Clock()
        let buffer = buffer(clock: clock) { $0.pendingCapacity = 10_000 }
        for step in 0..<120 {
            clock.advance(1.0 / 120.0)
            buffer.append(event: .terminalScrollTick, level: .debug, fields: [])
        }
        let count = buffer.drain().filter { $0.event == .terminalScrollTick }.count
        #expect(count <= 11, "一秒里放了 \(count) 条，采样没起作用")
        #expect(count >= 9, "采得太狠了，一秒只剩 \(count) 条，看不出过程")
    }

    /// 表里没有的事件不采样 —— 来一条记一条。
    @Test func eventsWithoutASampleRateAreNeverSampled() {
        let clock = Clock()
        let buffer = buffer(clock: clock) { $0.pendingCapacity = 10_000 }
        for step in 0..<20 {
            clock.advance(1.0 / 120.0)
            buffer.append(event: .terminalSelection, level: .info, fields: [.init(.selectionPhase, .flag(.began))])
        }
        #expect(buffer.drain().count == 20)
    }

    // MARK: - 限流

    /// 超限时丢弃并**只发一条** `log.dropped`。一条丢一条的话，日志会被
    /// "我被丢了很多条"刷满，而那本身又是一场风暴。
    @Test func aStormIsRateLimitedAndReportedOnce() {
        let clock = Clock()
        let buffer = buffer(clock: clock) {
            $0.pendingCapacity = 10_000
            $0.maxRecordsPerSecond = 10
        }
        for index in 0..<50 {
            buffer.append(event: .action, level: .info, fields: [.init(.repeatCount, .int(index))])
        }
        let drained = buffer.drain()
        #expect(drained.count == 11)
        #expect(drained.filter { $0.event == .logDropped }.count == 1)
        #expect(buffer.counters.dropped == 40)
    }

    /// 错误绕过令牌桶：错误风暴本身就是需要被看见的那件事，把它丢掉等于把证据丢掉。
    @Test func errorsBypassTheTokenBucket() {
        let clock = Clock()
        let buffer = buffer(clock: clock) {
            $0.pendingCapacity = 10_000
            $0.maxRecordsPerSecond = 2
        }
        for _ in 0..<10 {
            buffer.append(event: .networkError, level: .error, fields: [])
        }
        #expect(buffer.drain().filter { $0.event == .networkError }.count == 10)
    }

    /// 窗口一过就恢复。否则一次风暴会让这份日志从此再也记不下东西 —— 而那时候
    /// 正是最需要它的时候。
    @Test func theWindowRollsOver() {
        let clock = Clock()
        let buffer = buffer(clock: clock) {
            $0.pendingCapacity = 10_000
            $0.maxRecordsPerSecond = 5
        }
        for _ in 0..<20 { buffer.append(event: .action, level: .info, fields: []) }
        _ = buffer.drain()
        clock.advance(1.5)
        for _ in 0..<5 { buffer.append(event: .action, level: .info, fields: []) }
        #expect(buffer.drain().count == 5)
    }

    // MARK: - 合并

    @Test func adjacentRepeatsCollapseIntoOneWithACount() {
        let records = (0..<4).map { index in
            record(.terminalRows, [.init(.rowCount, .int(200)), .init(.offsetY, .scalar(Double(index)))], at: Double(index))
        }
        let merged = DiagnosticMerge.coalesce(records)
        #expect(merged.count == 1)
        #expect(merged.first?.fields.contains(.init(.repeatCount, .int(4))) == true)
    }

    /// 不相邻的重复**不合并**：中间隔着别的事，就说明它们不是同一段过程。
    @Test func separatedRepeatsStaySeparate() {
        let records = [
            record(.terminalRows, [.init(.rowCount, .int(200))], at: 0),
            record(.terminalEnter, [.init(.rowCount, .int(200))], at: 1),
            record(.terminalRows, [.init(.rowCount, .int(200))], at: 2),
        ]
        #expect(DiagnosticMerge.coalesce(records).count == 3)
    }

    /// 非易变字段一变，就不算同一件事。
    @Test func aChangedStableFieldBreaksTheRun() {
        let records = [
            record(.terminalRows, [.init(.atHistoryFloor, .bool(false))], at: 0),
            record(.terminalRows, [.init(.atHistoryFloor, .bool(false))], at: 1),
            record(.terminalRows, [.init(.atHistoryFloor, .bool(true))], at: 2),
        ]
        #expect(DiagnosticMerge.coalesce(records).count == 2)
    }

    private func record(
        _ event: DiagnosticEvent,
        _ fields: [DiagnosticEntry],
        at seconds: TimeInterval
    ) -> DiagnosticRecord {
        DiagnosticRecord(
            seq: Int(seconds) + 1,
            time: Date(timeIntervalSince1970: seconds),
            level: event.defaultLevel,
            event: event,
            fields: fields
        )
    }
}
