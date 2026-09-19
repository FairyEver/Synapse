import Foundation
import Testing

@testable import SynapseMobile

/// 什么算「刚刚拍的」。
///
/// 这条判定决定气泡出不出现，而它的两端都不是随手定的：窗口太短，用户从相册切回来
/// 的那几秒就错过了；太长，一张上周的图会以「刚拍的」的名义挂在输入栏上。所以这里
/// 逐个钉住边界，包括那一种不靠时间就能看出来的错法 —— 拍摄时间落在未来。
struct TerminalRecentPhotoFreshnessTests {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func age(_ seconds: TimeInterval) -> Date {
        now.addingTimeInterval(-seconds)
    }

    @Test func aPictureTakenJustNowIsOffered() {
        #expect(recentPhotoIsFresh(createdAt: now, now: now))
        #expect(recentPhotoIsFresh(createdAt: age(1), now: now))
        #expect(recentPhotoIsFresh(createdAt: age(60), now: now))
    }

    @Test func theWindowIsClosedAtItsFarEnd() {
        // 正好压线算数：5:00 之前的一律出现，5:00 整也是。
        #expect(recentPhotoIsFresh(createdAt: age(recentPhotoFreshness), now: now))
        // 差一秒就不算了。`<` 与 `<=` 的差别只在这里显形。
        #expect(!recentPhotoIsFresh(createdAt: age(recentPhotoFreshness + 1), now: now))
        #expect(!recentPhotoIsFresh(createdAt: age(600), now: now))
        #expect(!recentPhotoIsFresh(createdAt: age(86_400), now: now))
    }

    @Test func theWindowIsFiveMinutes() {
        // 它是一条产品决定，不是随手取的一个数：写在这里，改它的人会看见自己改了什么。
        #expect(recentPhotoFreshness == 300)
    }

    @Test func itStaysOnScreenForFiveSeconds() {
        // 同上一条：气泡自己走掉是它「不用人工关闭」的全部实现，而五秒是产品负责人
        // 定的那个数。改大改小都该是一次有意识的改动，不是顺手调一下。
        #expect(recentPhotoDisplayDuration == 5)
    }

    @Test func aClockFromTheFutureIsNotFreshness() {
        // 相册的时间比这台设备快（从备份恢复、跨设备同步、时区移动）时，一个未来的
        // 拍摄时间会算出一个负的年龄 —— 按大小看它"最年轻"，按意思它是"说不清"。
        #expect(!recentPhotoIsFresh(createdAt: now.addingTimeInterval(1), now: now))
        #expect(!recentPhotoIsFresh(createdAt: now.addingTimeInterval(recentPhotoFreshness), now: now))
        #expect(!recentPhotoIsFresh(createdAt: now.addingTimeInterval(365 * 86_400), now: now))
    }

    @Test func aCallerCanNarrowTheWindow() {
        // 窗口是个参数而不是常量：这条判定要能在一次运行里被问不同的尺度。
        #expect(recentPhotoIsFresh(createdAt: age(30), now: now, within: 60))
        #expect(!recentPhotoIsFresh(createdAt: age(90), now: now, within: 60))
    }
}
