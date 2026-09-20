import Foundation
import Testing

@testable import SynapseMobile

/// 接口日志那一组埋点的**容量**。
///
/// 接口日志与终端那两条跑在同一条通道上（同一个缓冲区、同一个令牌桶）。它们最容易的
/// 坏法不是记错字段，而是**把桶占满**：终端滚动每秒几十条，加上帧、加上打字，一旦越界，
/// 被丢掉的恰好是洪峰里那条你最想要的。
///
/// 所以这里按"最坏一秒"合成一遍，断言一条都不丢。
struct DiagnosticInterfaceLoggingTests {
    private final class Clock: @unchecked Sendable {
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        func advance(_ seconds: TimeInterval) { now += seconds }
    }

    /// 一秒钟里能同时发生的事，**按调用点真实的（未经采样的）频率**灌一遍。
    ///
    /// 各速率取自它们真实来源的上限：`scrollViewDidScroll` 在 120 Hz 屏上最高 120 次/秒、
    /// `apply()` 同样一次一记；帧在终端持续输出时按 60 ms 一次 flush 算约 20/s；出站信封
    /// 跟着按键；intent 与回执成对；后台在刷列表与摘要。
    ///
    /// 一共 355 次调用，而桶只有 200 条/秒 —— **采样表是这一秒能不能装下的全部原因**。
    /// 下面那条 `withoutSamplingTheSameSecondOverflows` 把这个前提反过来验了一次，
    /// 所以这一条不是"怎么都能过"。
    private func feedBusiestSecond(into buffer: DiagnosticBuffer, clock: Clock) {
        let step = 1.0 / 120
        for tick in 0..<120 {
            clock.advance(step)
            // 每次滚动回调都会记的两条。
            buffer.append(event: .terminalScrollTick, level: .debug)
            buffer.append(event: .terminalRows, level: .debug)
            // 终端在持续输出：帧 20/s、屏幕内容 5/s、出站信封 10/s。
            if tick % 6 == 0 { buffer.append(event: .frame, level: .info) }
            if tick % 24 == 0 { buffer.append(event: .frameContent, level: .info) }
            if tick % 12 == 0 { buffer.append(event: .send, level: .info) }
            // 连续打字：每个按键一个 intent，电脑各回一条。
            if tick % 4 == 0 {
                buffer.append(event: .intent, level: .info)
                buffer.append(event: .intentResult, level: .info)
            }
            // 后台在刷列表与摘要。
            if tick % 6 == 0 { buffer.append(event: .rest, level: .debug) }
        }
    }

    /// 最坏一秒装得下。
    ///
    /// **加了新的高频事件就往 `feedBusiestSecond` 里加一行。** 这条本身不会自动发现
    /// 新事件（它只认识自己喂过的那些），它守的是预算算术：这一秒离 200 条/秒还有多远，
    /// 以及采样表一旦失效会发生什么。
    @Test func theBusiestSecondFitsTheTokenBucket() {
        let clock = Clock()
        let buffer = DiagnosticBuffer(now: { clock.now })
        feedBusiestSecond(into: buffer, clock: clock)

        let counters = buffer.counters
        #expect(
            counters.dropped == 0,
            "最坏一秒里有 \(counters.dropped) 条被令牌桶丢了"
        )
        // 前提检查：这一秒确实灌进去了不少东西，而不是因为什么都没记才"没丢"。
        #expect(counters.totalWritten > 60, "这一秒只写进 \(counters.totalWritten) 条，没真的压到")
        // 记下来的远少于调用次数 —— 这正说明采样在起作用。
        #expect(counters.totalWritten < 150, "写进 \(counters.totalWritten) 条，采样几乎没生效")
    }

    /// 反过来：同一秒，把采样表拿掉就装不下。
    ///
    /// 没有这一条，上面那条可能是"这一秒本来就远没到上限"的巧合 —— 那样它测不出任何东西。
    /// 两条合起来才说明：**采样表是这一秒能装下的承重件**，不是一层可有可无的降噪。
    @Test func withoutSamplingTheSameSecondOverflows() {
        let clock = Clock()
        var limits = DiagnosticBuffer.Limits()
        limits.samplesPerSecond = [:]
        let buffer = DiagnosticBuffer(limits: limits, now: { clock.now })
        feedBusiestSecond(into: buffer, clock: clock)

        #expect(
            buffer.counters.dropped > 0,
            "没有采样也不丢？那说明这一秒根本没压到上限，上一条用例什么也没证明"
        )
    }

    /// 三个高频的接口事件必须各自有采样率。
    ///
    /// 上一条能过，前提是它们都在表里；这一条把"在表里"本身钉住 —— 把某一行删掉时，
    /// 上一条只会变得更容易过。
    @Test func theHighFrequencyNetworkEventsHaveARate() {
        let table = DiagnosticBuffer.Limits().samplesPerSecond
        for event in [DiagnosticEvent.frame, .frameContent, .send] {
            let rate = table[event]
            #expect(rate != nil, "\(event.rawValue) 没有配采样率")
            #expect((rate ?? 0) > 0)
            #expect((rate ?? 0) < 120, "\(event.rawValue) 的采样率比它自己的上限还高，等于没采")
        }
    }

    /// 错误绕过令牌桶这条纪律不能被接口日志改掉。
    ///
    /// 它是这套机制里唯一"宁可写爆也要留下"的一类：错误风暴本身就是要被看见的那件事。
    @Test func errorsStillBypassTheBucket() {
        let clock = Clock()
        var limits = DiagnosticBuffer.Limits()
        // 把桶拧到极小，好让普通记录一定被丢。
        limits.maxRecordsPerSecond = 1
        let buffer = DiagnosticBuffer(limits: limits, now: { clock.now })

        for _ in 0..<50 {
            clock.advance(0.01)
            buffer.append(event: .rest, level: .debug)
        }
        let afterNoise = buffer.counters.dropped
        #expect(afterNoise > 0, "桶没生效，这条用例证不了什么")

        for _ in 0..<50 {
            clock.advance(0.01)
            buffer.append(event: .rest, level: .error)
        }
        #expect(
            buffer.counters.dropped == afterNoise,
            "error 级的记录被令牌桶丢了 —— 错误风暴里最该留下的那一类没了"
        )
    }
}
