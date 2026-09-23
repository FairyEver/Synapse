import Foundation
import Testing
@testable import SynapseMobile

/// 消息行右上角那一小段时间。
///
/// 它和标题一样是读的人拿来分辨「哪一条是哪一条」的东西：五条标题一模一样的消息排
/// 在一起，唯一把它们分开的就是这一格。所以分档的边界值得钉住。
struct NotificationTextTests {
    /// 时区钉死，否则「今天」这一档会跟着跑测试的机器走。
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar
    }

    private func at(_ iso: String) throws -> Date {
        try #require(ISO8601DateFormatter.parseWireTimestamp(iso))
    }

    /// 北京时间 2026-09-23 17:31，星期三。
    private func now() throws -> Date {
        try at("2026-09-23T09:31:00.000Z")
    }

    private func label(_ iso: String, now: Date) -> String {
        NotificationText.timestamp(iso, now: now, calendar: calendar)
    }

    @Test func todayKeepsOnlyTheClock() throws {
        // 六分钟前那一条不该把年月日一起写出来——它和现在只差六分钟。
        let now = try now()
        #expect(label("2026-09-23T09:25:00.000Z", now: now) == "17:25")
    }

    @Test func yesterdayStopsAtTheDay() throws {
        let now = try now()
        // 昨天几点不重要，重要的是它不是今天。
        #expect(label("2026-09-22T09:25:00.000Z", now: now) == "昨天")  // 北京时间 09-22 17:25
        #expect(label("2026-09-22T15:50:00.000Z", now: now) == "昨天")  // 北京时间 09-22 23:50
    }

    @Test func aLateNightMessageIsYesterdayNotToday() throws {
        // 00:10 看 23:50 收到的那条：中间只隔了二十分钟，但它属于昨天。
        let now = try at("2026-09-23T16:10:00.000Z")  // 北京时间 09-24 00:10
        #expect(label("2026-09-23T15:50:00.000Z", now: now) == "昨天")
    }

    @Test func lastSevenDaysUseTheWeekday() throws {
        let now = try now()
        #expect(label("2026-09-20T09:25:00.000Z", now: now) == "周日")  // 三天前
        #expect(label("2026-09-17T09:25:00.000Z", now: now) == "周四")  // 六天前
    }

    @Test func aWeekAndOlderUsesTheDate() throws {
        let now = try now()
        // 整七天是这一档的头一天：再往前就没有「星期几」能把它和上一周的同一天分开了。
        #expect(label("2026-09-16T09:25:00.000Z", now: now) == "9月16日")
        #expect(label("2026-09-01T09:25:00.000Z", now: now) == "9月1日")
    }

    @Test func aFutureTimestampReadsAsToday() throws {
        // 手机时钟慢一点、服务端写早一点，时间就会跑到未来。它不该掉进「星期几」
        // 那一档去写一个还没到的日子。
        let now = try now()
        #expect(label("2026-09-24T09:25:00.000Z", now: now) == "17:25")
    }

    @Test func anUnreadableTimestampDrawsNothing() {
        // 空字符串而不是原文：把一整串 ISO8601 显示出来的话，它比空着更糟——
        // 用户会以为那就是时间。
        let now = Date()
        #expect(NotificationText.timestamp("", now: now, calendar: calendar) == "")
        #expect(NotificationText.timestamp("昨天", now: now, calendar: calendar) == "")
    }
}
