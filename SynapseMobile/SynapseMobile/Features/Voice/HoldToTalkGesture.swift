import CoreGraphics

/// 按住期间手指压到了面板的哪一半，决定松手时走哪条路。
///
/// 纯值：输入是手指的落点和**录音面板量出来的那块矩形**，输出是一个枚举。它不认识视图
/// 长什么样，也不认识 `VoiceInputController` —— 所以「刚好差 1pt」和「压上去再滑下来」
/// 这种最容易漏的一条能被单测逐条钉住，而不是靠手在真机上试。
///
/// 判定就是眼睛看到的那块面板：手指压上去之后上面盖着一层**左右一分为二**的蒙层，
/// 左半「取消」、右半「固定」，压在哪一半松手就是哪一个结果；没压上去就是发送。
/// 判定当场重算，不记「刚才压过哪一半」—— 一记就会变成滑出去再也回不来。
enum HoldToTalkGesture {
    /// 还没压到面板上时，面板往外扩多少算压上去了。
    ///
    /// 手指的落点和眼睛看到的那块从来不精确重合，差几个点是常态；把这点误差算成
    /// 「没压上去」，用户就得比看着的再多滑一截。
    static let touchSlop: CGFloat = 12
    /// 已经压上去之后的外扩。
    ///
    /// 比静止时大一档：手指在动，更需要粘住当前这一半。滑到蒙层边缘手一抖就掉回
    /// 「松手发送」，用户会觉得「明明压在上面了」。
    static let armedTouchSlop: CGFloat = 22

    enum Outcome: Equatable {
        /// 还在录，松手就转文字。
        case speaking
        /// 松手丢弃这一段，留在语音态。
        case cancelling
        /// 松手不结束，进锁定态继续录。
        case locking
    }

    /// 手指在**面板所在的那个坐标系里**的位置，决定它落在哪一半。
    ///
    /// `armed` 是上一帧的结论，只用来挑外扩的量。没压到面板上就是 `.speaking`。
    static func outcome(
        at point: CGPoint,
        panel: CGRect,
        armed: Outcome = .speaking
    ) -> Outcome {
        let pad = armed == .speaking ? touchSlop : armedTouchSlop
        guard expanded(panel, by: pad).contains(point) else { return .speaking }
        // 中线就是蒙层上画出来的那条分界，**中间不留缝**：压在上面只有两种结果，
        // 「松手发送」属于没压上去的那一边。正落在中线上时归右半 —— 这条界线总得有
        // 个归属，含糊成第三种结果就又多一种说不清的状态。
        return point.x < panel.midX ? .cancelling : .locking
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
