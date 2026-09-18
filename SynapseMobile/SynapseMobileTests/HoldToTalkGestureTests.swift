import CoreGraphics
import Testing

@testable import SynapseMobile

/// 按住期间手指落到了哪一块。
///
/// 判定被抽成纯值就是为了能在这里逐条钉：真机上「刚好差 1pt」「已经选中了再抖一下」
/// 都不是能用手试出来的东西，而它们恰恰是这套手势里最容易漏掉的两种。
struct HoldToTalkGestureTests {
    /// 两块并排铺满一行：等宽、间距 16、高 88。
    private let cancelZone = CGRect(x: 0, y: 0, width: 180, height: 88)
    private let lockZone = CGRect(x: 196, y: 0, width: 180, height: 88)

    private func zone(at point: CGPoint, armed: HoldToTalkGesture.Outcome = .speaking)
        -> HoldToTalkGesture.Outcome {
        HoldToTalkGesture.outcome(at: point, cancelZone: cancelZone, lockZone: lockZone, armed: armed)
    }

    /// 两块**上边和上边之外**才是「还没滑到」，松手就是发送。
    ///
    /// 两块之间的那条 16pt 缝不算：两侧各外扩 12pt 之后它就盖满了 —— 手指在缝的位置
    /// 上，离两块各自都不到一个指宽，判定成「哪块都不是」反而难用。
    @Test func awayFromBothBlocksIsStillJustSpeaking() {
        #expect(zone(at: CGPoint(x: 100, y: 120)) == .speaking)   // 两块下方
        #expect(zone(at: CGPoint(x: 100, y: -20)) == .speaking)   // 两块上方
        #expect(zone(at: CGPoint(x: -20, y: 44)) == .speaking)    // 整行左侧之外
        #expect(zone(at: CGPoint(x: 396, y: 44)) == .speaking)    // 整行右侧之外
    }

    @Test func landingOnTheCancelBlockCancels() {
        #expect(zone(at: CGPoint(x: 20, y: 20)) == .cancelling)
        #expect(zone(at: CGPoint(x: 179, y: 87)) == .cancelling)
    }

    @Test func landingOnThePinBlockLocks() {
        #expect(zone(at: CGPoint(x: 200, y: 20)) == .locking)
        #expect(zone(at: CGPoint(x: 375, y: 87)) == .locking)
    }

    /// 外扩 12pt：落在方块外面一点仍然算命中。手指和眼睛看到的那块差几个点是常态。
    @Test func justOutsideStillCounts() {
        #expect(zone(at: CGPoint(x: -12, y: 44)) == .cancelling)
        #expect(zone(at: CGPoint(x: 387, y: 44)) == .locking)
        #expect(zone(at: CGPoint(x: 100, y: 99)) == .cancelling)  // 下方 12 以内
    }

    /// 差 1pt 就不算：外扩是外扩，不是「差不多」。
    @Test func onePointPastTheSlopIsNotAHit() {
        #expect(zone(at: CGPoint(x: -13, y: 44)) == .speaking)
        #expect(zone(at: CGPoint(x: 389, y: 44)) == .speaking)
        #expect(zone(at: CGPoint(x: 100, y: 100)) == .speaking)  // 正好贴在边界上就不算
    }

    /// 已经选中某一块之后外扩到 22：手指在动，要粘得住。
    @Test func anArmedZoneHoldsOnHarder() {
        #expect(zone(at: CGPoint(x: -20, y: 44), armed: .cancelling) == .cancelling)
        #expect(zone(at: CGPoint(x: 396, y: 44), armed: .locking) == .locking)
        // 但仍有个尽头：再远就不算。
        #expect(zone(at: CGPoint(x: -23, y: 44), armed: .cancelling) == .speaking)
        #expect(zone(at: CGPoint(x: 399, y: 44), armed: .locking) == .speaking)
    }

    /// **滑出去再滑回来要能撤销。** 判定当场重算，不记「刚才走过哪个区」——
    /// 一记就会变成滑出去就再也回不来，用户只能松手取消。
    @Test func slidingBackInsideUndoesTheZone() {
        #expect(zone(at: CGPoint(x: 20, y: 20)) == .cancelling)
        #expect(zone(at: CGPoint(x: 100, y: 200)) == .speaking)
        #expect(zone(at: CGPoint(x: 300, y: 20), armed: .cancelling) == .locking)
        #expect(zone(at: CGPoint(x: 100, y: 200), armed: .locking) == .speaking)
    }

    /// 还没量到尺寸的方块是零矩形，而零矩形被 `insetBy` 一撑就变成原点附近一块能被
    /// 命中的区域 —— 手指从屏幕左上角滑过就会被当成选中了「取消」。
    @Test func azoneThatHasNotBeenMeasuredIsNeverHit() {
        let unmeasured = HoldToTalkGesture.outcome(
            at: CGPoint(x: 4, y: 4),
            cancelZone: .zero,
            lockZone: .zero
        )
        #expect(unmeasured == .speaking)
    }

    /// 两档外扩的量本身也是规格的一部分（原型里就是这两个数），改它要连着原型一起改。
    @Test func theSlopIsTheOneTheDesignNamed() {
        #expect(HoldToTalkGesture.touchSlop == 12)
        #expect(HoldToTalkGesture.armedTouchSlop == 22)
    }
}
