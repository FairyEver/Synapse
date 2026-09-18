import CoreGraphics
import Testing

@testable import SynapseMobile

/// 按住期间手指滑到了哪一区。
///
/// 判定被抽成纯值就是为了能在这里逐条钉：真机上「刚好差 1pt」和「滑出去再滑回来」
/// 都不是能用手试出来的东西，而它们恰恰是这套手势里最容易漏掉的两种。
struct HoldToTalkGestureTests {
    /// 没动，或者只是拇指压下去时的一点抖。
    @Test func stayingPutIsStillJustSpeaking() {
        #expect(HoldToTalkGesture.outcome(translationX: 0) == .speaking)
        #expect(HoldToTalkGesture.outcome(translationX: -10) == .speaking)
        #expect(HoldToTalkGesture.outcome(translationX: 10) == .speaking)
    }

    /// 差 1pt 就不能算数：阈值是阈值，不是「差不多」。
    @Test func justShortOfTheThresholdIsStillSpeaking() {
        #expect(HoldToTalkGesture.outcome(translationX: -69) == .speaking)
        #expect(HoldToTalkGesture.outcome(translationX: 69) == .speaking)
    }

    /// 到阈值那一下就要落定，两侧各认各的。
    @Test func reachingTheThresholdOnEitherSidePicksThatZone() {
        #expect(HoldToTalkGesture.outcome(translationX: -70) == .cancelling)
        #expect(HoldToTalkGesture.outcome(translationX: 70) == .locking)
    }

    @Test func goingWellPastTheThresholdKeepsTheSameZone() {
        #expect(HoldToTalkGesture.outcome(translationX: -200) == .cancelling)
        #expect(HoldToTalkGesture.outcome(translationX: 200) == .locking)
    }

    /// **滑出去再滑回来要能撤销。** 判定当场重算，不记「刚才走过哪个区」——
    /// 一记就会变成滑出去就再也回不来，用户只能松手取消。
    @Test func slidingBackInsideUndoesTheZone() {
        #expect(HoldToTalkGesture.outcome(translationX: -90) == .cancelling)
        #expect(HoldToTalkGesture.outcome(translationX: -5) == .speaking)
        #expect(HoldToTalkGesture.outcome(translationX: 90) == .locking)
        #expect(HoldToTalkGesture.outcome(translationX: 5) == .speaking)
    }

    /// 两侧对称：同一个距离，往左只可能落进取消，往右只可能落进锁定。方向判断一旦
    /// 掺进第二个阈值，这条就会红。
    @Test func theTwoSidesAreSymmetric() {
        for distance in stride(from: CGFloat(0), through: 300, by: 5) {
            #expect(HoldToTalkGesture.outcome(translationX: -distance) != .locking)
            #expect(HoldToTalkGesture.outcome(translationX: distance) != .cancelling)
        }
    }

    /// 阈值只有一处定义，值本身也是规格的一部分（设计文档 §4.5）。改它就要改那份
    /// 文档，所以这里是一条断言，而不是一句注释。
    @Test func theThresholdIsTheOneTheDesignNamed() {
        #expect(HoldToTalkGesture.slideThreshold == 70)
    }
}
