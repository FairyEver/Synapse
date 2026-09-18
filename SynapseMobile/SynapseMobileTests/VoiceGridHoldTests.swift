import Testing

@testable import SynapseMobile

/// 锁定态那两次高度变化该不该告诉电脑（设计文档 §8 第 21 条）。
///
/// 这一条本来只能在真机上盯着电脑屏幕看有没有多出两次 resize —— 判定被抽成纯值，
/// 就是为了让它能在这里被逐条走完。
///
/// `#expect` 把一个 mutating 的调用写进去是不行的（宏把它展开在一段不可变的闭包里），
/// 所以每一步都先落成常量再断言。
struct VoiceGridHoldTests {
    /// 电脑那边拿着的那一格。
    private let wide = DesktopGrid(columns: 80, rows: 40)
    /// 输入栏长高到三行之后，手机上少掉的那几行。
    private let narrow = DesktopGrid(columns: 80, rows: 34)
    /// 转个方向。
    private let turned = DesktopGrid(columns: 120, rows: 30)

    @Test func nothingIsHeldBackWhileNothingIsLocked() {
        var hold = VoiceGridHold()
        let first = hold.shouldReport(wide)
        let second = hold.shouldReport(narrow)
        #expect(first)
        #expect(second)
    }

    /// 进锁定：栏高了、可视行数小了，而这一格不该出门。
    @Test func theWholeLockWindowStaysOffTheWire() {
        var hold = VoiceGridHold()
        hold.lock(holding: wide)
        let duringLock = hold.shouldReport(narrow)
        #expect(hold.isLocked)
        #expect(duringLock == false)
    }

    /// 退出锁定会重排回进锁定之前那一格。桌面本来就拿着它，再报一次就是为一次语音
    /// 输入白 resize 一次。
    @Test func comingBackOutIsNotNewsEither() {
        var hold = VoiceGridHold()
        hold.lock(holding: wide)
        _ = hold.shouldReport(narrow)
        hold.unlock()
        let onTheWayOut = hold.shouldReport(wide)
        #expect(onTheWayOut == false)
    }

    /// 记录只对退出之后紧跟着的那一次重排有效：留着它，之后一次真的变化就会被一起
    /// 吞掉，而那是桌面必须知道的。
    @Test func aRealChangeAfterUnlockingStillGoesOut() {
        var hold = VoiceGridHold()
        hold.lock(holding: wide)
        hold.unlock()
        let onTheWayOut = hold.shouldReport(wide)
        let turnedSince = hold.shouldReport(turned)
        #expect(onTheWayOut == false)
        #expect(turnedSince)
    }

    /// 锁定期间转了方向：退出时该报的是转完之后那一格，不是进锁定前那一格。
    @Test func rotatingWhileLockedIsStillReportedOnTheWayOut() {
        var hold = VoiceGridHold()
        hold.lock(holding: wide)
        _ = hold.shouldReport(narrow)
        hold.unlock()
        let onTheWayOut = hold.shouldReport(turned)
        #expect(onTheWayOut)
    }
}
