import Foundation
import Testing
@testable import SynapseMobile

/// 转写进度条上那两个数：条画到哪儿、秒表此刻读到几。
///
/// 它们错了都不会当场报错，只是让人看错：条画满了却迟迟不出结果，会被当成卡死——那正是
/// 这次要修的那个「看不出在动还是死了」。所以这两条必须被钉住。
struct MeetingTranscriptionProgressTests {
    // MARK: - 条画到哪儿

    @Test func 按已用时长比估算出来的总时长() {
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 20_000, expectedMs: 80_000) == 0.25)
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 40_000, expectedMs: 80_000) == 0.5)
    }

    /// 估算不是承诺。超了还接着画的话，条会停在 100% 而结果迟迟不来。
    @Test func 超过估算时间也封顶在百分之九十五() {
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 80_000, expectedMs: 80_000) == 0.95)
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 30 * 60_000, expectedMs: 80_000) == 0.95)
    }

    @Test func 估算是零或负数时不画也不除零() {
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 10_000, expectedMs: 0) == 0)
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 10_000, expectedMs: -1) == 0)
    }

    @Test func 还没开始用时是零() {
        #expect(MeetingTranscriptionProgressMath.fraction(elapsedMs: 0, expectedMs: 80_000) == 0)
    }

    // MARK: - 秒表

    /// 服务端给的数只到「它生成响应的那一刻」，而两端是每 5 秒才刷一次。刷新间隔里客户端
    /// 接着往下走，否则条会每五秒跳一格、中间四秒纹丝不动。
    @Test func 在两次刷新之间接着服务端给的已用时长往下走() {
        let receivedAt = Date(timeIntervalSince1970: 1_000)
        let elapsed = MeetingTranscriptionProgressMath.elapsedMs(
            reported: 5_000,
            receivedAt: receivedAt,
            now: receivedAt.addingTimeInterval(3)
        )
        #expect(elapsed == 8_000)
    }

    /// 用的是本机两次读取之间的差值，不是「本机挂钟减服务端时间戳」——手机时钟和服务端差
    /// 几分钟也照样算得对。
    @Test func 本机时钟往回跳时不会倒退() {
        let receivedAt = Date(timeIntervalSince1970: 10_000)
        let elapsed = MeetingTranscriptionProgressMath.elapsedMs(
            reported: 5_000,
            receivedAt: receivedAt,
            now: receivedAt.addingTimeInterval(-1)
        )
        #expect(elapsed == 5_000)
    }

    // MARK: - 阶段文案

    @Test func 投出去了说识别中还没投出去说排队中() {
        #expect(MeetingText.transcriptionStage("running") == "识别中")
        #expect(MeetingText.transcriptionStage("queued") == "排队中")
    }
}
