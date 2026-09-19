import Foundation
import Testing

@testable import SynapseMobile

/// 线上时间戳的读法。
///
/// 这组用例存在的理由是一次真实的错：桌面端用 `new Date().toISOString()` 发时间
/// （带毫秒），手机端用默认的 `ISO8601DateFormatter()` 读 —— 读不出来，返回 nil，
/// 而 nil 的表现不是报错，是**那一格空着**。会话行右侧「运行多久」就这么一直空着，
/// 没人以为是坏的。
struct WireTimestampTests {

    /// 桌面端真正发出来的那个形状。
    ///
    /// 断言的是差 123 毫秒，不是「非 nil」：只查非 nil 的话，一个只认到秒的解析器
    /// 也能过，而那正是要防的那个退步。
    @Test func readsTheShapeTheDesktopActuallySends() throws {
        let withMs = try #require(ISO8601DateFormatter.parseWireTimestamp("2026-09-19T05:17:00.123Z"))
        let withoutMs = try #require(ISO8601DateFormatter.parseWireTimestamp("2026-09-19T05:17:00Z"))

        #expect(abs(withMs.timeIntervalSince(withoutMs) - 0.123) < 0.0005)
    }

    /// 不带毫秒的也得认。
    ///
    /// 不是每个时间戳都经过 JS 的 `toISOString()` —— 手写的 fixture、旧版本留下的
    /// 数据都不带毫秒，而那两种恰恰是最容易被漏掉的输入。
    @Test func readsTheShapeWithoutMilliseconds() {
        #expect(ISO8601DateFormatter.parseWireTimestamp("2026-09-19T05:17:00Z") != nil)
        #expect(ISO8601DateFormatter.parseWireTimestamp("2026-01-01T00:00:00.000Z") != nil)
    }

    @Test func refusesWhatIsNotATimestamp() {
        #expect(ISO8601DateFormatter.parseWireTimestamp("") == nil)
        #expect(ISO8601DateFormatter.parseWireTimestamp("昨天") == nil)
    }

    /// 坏掉的那一环本身。
    ///
    /// 上面几条只证明解析函数是对的；这条证明**摘要里的那一格**用的是它。改回默认
    /// formatter 的话，这里立刻红 —— 而那正是当初没人发现的原因：没有用例碰过它。
    @Test func theSessionRowCanReadWhenItStarted() throws {
        let session = MobileSummarySession(
            id: "s1",
            groupId: "g1",
            title: "终端",
            status: "running",
            attention: MobileSummaryAttention(state: "not_waiting", kind: "unknown"),
            cwd: "/tmp",
            cols: 80,
            rows: 24,
            startedAt: "2026-09-19T05:17:00.123Z",
            lastLine: "",
            lastOutputSeq: 0,
            gridOwnerId: nil,
        )

        let started = try #require(session.startedAtDate, "会话行的「运行多久」会一直是空的")
        #expect(abs(started.timeIntervalSince1970 - 1_789_795_020.123) < 0.0005)
    }
}
