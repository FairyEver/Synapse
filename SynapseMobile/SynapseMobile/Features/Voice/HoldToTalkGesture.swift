import CoreGraphics

/// 按住期间手指落到了哪一块，决定松手时走哪条路。
///
/// 纯值：输入是手指的落点和两块方块的矩形，输出是一个枚举。它不认识视图长什么样，
/// 也不认识 `VoiceInputController` —— 所以「刚好差 1pt」和「滑进去再滑回来」这种最
/// 容易漏的一条能被单测逐条钉住，而不是靠手在真机上试。
///
/// 判定按**两块方块的实际矩形**来，也就是眼睛看到的那两块：上滑停在「取消」上面松手
/// 就取消，停在「固定」上面松手就固定，两块都不沾就是发送。判定当场重算，不记「刚才
/// 走过哪个区」—— 一记就会变成滑出去再也回不来，用户只能松手取消。
enum HoldToTalkGesture {
    /// 静止时矩形往外扩多少。
    ///
    /// 手指的落点和眼睛看到的那块从来不精确重合，差几个点是常态；把这点误差算成
    /// 「没滑到」才是真的难用。原型用的就是这两个数。
    static let touchSlop: CGFloat = 12
    /// 已经选中某一块之后的外扩。
    ///
    /// 比静止时大一档：手指在动，更需要粘住当前这块。滑到方块边缘手一抖就掉回中间，
    /// 用户会觉得「明明停在上面了」。
    static let armedTouchSlop: CGFloat = 22

    enum Outcome: Equatable {
        /// 还在录，松手就转文字。
        case speaking
        /// 松手丢弃这一段，留在语音态。
        case cancelling
        /// 松手不结束，进锁定态继续录。
        case locking
    }

    /// 手指在**方块所在的那个坐标系里**的位置，决定它落在哪一块。
    ///
    /// 两块都不沾 → `.speaking`（中间区，松手发送）。
    static func outcome(
        at point: CGPoint,
        cancelZone: CGRect,
        lockZone: CGRect,
        armed: Outcome = .speaking
    ) -> Outcome {
        let pad = armed == .speaking ? touchSlop : armedTouchSlop
        if expanded(cancelZone, by: pad).contains(point) { return .cancelling }
        if expanded(lockZone, by: pad).contains(point) { return .locking }
        return .speaking
    }

    /// 空矩形**不外扩**。
    ///
    /// 还没量到尺寸时它就是零矩形，而 `insetBy` 会把零矩形撑成一块以原点为中心的
    /// 24×24 的方块 —— 屏幕左上角凭空多出一片能被命中的区域，手指从那儿滑过就被
    /// 当成选中了。
    private static func expanded(_ rect: CGRect, by pad: CGFloat) -> CGRect {
        rect.isEmpty ? rect : rect.insetBy(dx: -pad, dy: -pad)
    }
}
