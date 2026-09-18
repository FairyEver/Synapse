import CoreGraphics
import Testing

@testable import SynapseMobile

/// 按住期间手指压到了面板的哪一半。
///
/// 判定被抽成纯值就是为了能在这里逐条钉：真机上「刚好差 1pt」「正落在中线上」都不是
/// 能用手试出来的东西，而它们恰恰是这套手势里最容易漏掉的两种。
struct HoldToTalkGestureTests {
    /// 一块和真机上差不多大的面板：左右两半各 180 宽，高 152。
    private let panel = CGRect(x: 0, y: 0, width: 360, height: 152)
    /// 面板中线 —— 蒙层上画出来的那条分界，也是两半的分界。
    private let midX: CGFloat = 180

    private func outcome(at point: CGPoint, armed: HoldToTalkGesture.Outcome = .speaking)
        -> HoldToTalkGesture.Outcome {
        HoldToTalkGesture.outcome(at: point, panel: panel, armed: armed)
    }

    /// 面板**之外**才是「还没压上去」，松手就是发送。
    @Test func offThePanelIsStillJustSpeaking() {
        #expect(outcome(at: CGPoint(x: 180, y: 165)) == .speaking)  // 面板下方
        #expect(outcome(at: CGPoint(x: 180, y: -13)) == .speaking)  // 面板上方
        #expect(outcome(at: CGPoint(x: -13, y: 76)) == .speaking)   // 整块左侧之外
        #expect(outcome(at: CGPoint(x: 373, y: 76)) == .speaking)   // 整块右侧之外
    }

    /// 左右一分为二：中线左边是取消，中线右边是固定。
    @Test func theLeftHalfCancelsAndTheRightHalfLocks() {
        #expect(outcome(at: CGPoint(x: 0, y: 76)) == .cancelling)
        #expect(outcome(at: CGPoint(x: 179, y: 76)) == .cancelling)
        #expect(outcome(at: CGPoint(x: 181, y: 76)) == .locking)
        #expect(outcome(at: CGPoint(x: 360, y: 76)) == .locking)
    }

    /// **中线上不留缝。** 正落在两半的分界线上也是二选一，不会掉出一个「哪半都不是」
    /// 的第三种结果 —— 压在面板上还可能是「松手发送」的话，用户就没法预判松手的后果。
    @Test func theCentreLineBelongsToTheRightHalf() {
        #expect(outcome(at: CGPoint(x: midX, y: 76)) == .locking)
        // 已经压着左半、手指移到中线上，跟着换到右半 —— 分界就是分界。
        #expect(outcome(at: CGPoint(x: midX, y: 76), armed: .cancelling) == .locking)
    }

    /// 外扩 12pt：落在面板外面一点仍然算压上去了。手指和眼睛看到的那块差几个点是常态。
    ///
    /// 这几条**取在外扩以内 1pt 而不是正好压在外扩边上**：`CGRect.contains` 把上边和
    /// 右边算在外面（下边和左边算在里面），那是 CoreGraphics 的取向，不是这套手势的
    /// 规格 —— 把它写进断言，等于哪天换掉这个判断方式就要跟着改一堆测试。
    @Test func justOffThePanelStillCounts() {
        #expect(outcome(at: CGPoint(x: 100, y: 163)) == .cancelling)  // 下方 12 以内
        #expect(outcome(at: CGPoint(x: 100, y: -11)) == .cancelling)  // 上方 12 以内
        #expect(outcome(at: CGPoint(x: -11, y: 76)) == .cancelling)   // 左侧 12 以内
        #expect(outcome(at: CGPoint(x: 371, y: 76)) == .locking)      // 右侧 12 以内
    }

    /// 差 1pt 就不算：外扩是外扩，不是「差不多」。
    @Test func onePointPastTheSlopIsNotAHit() {
        #expect(outcome(at: CGPoint(x: 100, y: 165)) == .speaking)
        #expect(outcome(at: CGPoint(x: 100, y: -13)) == .speaking)
        #expect(outcome(at: CGPoint(x: -13, y: 76)) == .speaking)
        #expect(outcome(at: CGPoint(x: 373, y: 76)) == .speaking)
    }

    /// 已经压上去之后外扩到 22：手指在动，要粘得住。
    ///
    /// 它和上面那两条合起来才是这套判定的形状：**压上去要够到 12，掉出去要走满 22**
    /// —— 中间那一圈是留给「手抖了一下」的，不至于一闪一闪地换结果。
    @Test func anArmedHalfHoldsOnHarder() {
        #expect(outcome(at: CGPoint(x: 100, y: 173), armed: .cancelling) == .cancelling)
        #expect(outcome(at: CGPoint(x: 100, y: 175), armed: .cancelling) == .speaking)
        #expect(outcome(at: CGPoint(x: -22, y: 76), armed: .cancelling) == .cancelling)
        #expect(outcome(at: CGPoint(x: -23, y: 76), armed: .cancelling) == .speaking)
    }

    /// **滑下去要能撤销。** 判定当场重算，不记「刚才压过哪一半」—— 一记就会变成滑出去
    /// 就再也回不来，用户只能松手取消。
    @Test func slidingBackOffThePanelUndoesTheHalf() {
        #expect(outcome(at: CGPoint(x: 100, y: 76)) == .cancelling)
        #expect(outcome(at: CGPoint(x: 100, y: 300)) == .speaking)
        #expect(outcome(at: CGPoint(x: 300, y: 76), armed: .cancelling) == .locking)
        #expect(outcome(at: CGPoint(x: 300, y: 300), armed: .locking) == .speaking)
    }

    /// 还没量到尺寸的面板是零矩形，而零矩形被 `insetBy` 一撑就变成原点附近一块能被命中
    /// 的区域 —— 手指从屏幕左上角滑过就会被当成压上去了。
    @Test func aPanelThatHasNotBeenMeasuredIsNeverHit() {
        let unmeasured = HoldToTalkGesture.outcome(at: CGPoint(x: 4, y: 4), panel: .zero)
        #expect(unmeasured == .speaking)
    }

    /// 两档外扩的量本身也是规格的一部分，改它要连着一起改。
    @Test func theSlopIsTheOneTheDesignNamed() {
        #expect(HoldToTalkGesture.touchSlop == 12)
        #expect(HoldToTalkGesture.armedTouchSlop == 22)
    }
}
