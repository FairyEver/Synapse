import CoreGraphics

/// 按住期间手指滑到了哪一区，决定松手时走哪条路。
///
/// 纯值：输入是一次按住的横向位移，输出是一个枚举。它不认识视图长什么样，也不认
/// 识 `VoiceInputController` —— 所以「滑出去再滑回来」这种最容易漏的一条能被单测
/// 逐条钉住，而不是靠手在真机上试。
///
/// 方向只看位移的**符号**：往左是取消，往右是锁定，中间什么都不做。轴上只有一处
/// 阈值，所以回到阈值以内天然就是回到 `speaking`，不需要第二套「撤销」的逻辑。
enum HoldToTalkGesture {
    /// 判定用的唯一阈值。
    ///
    /// 70pt ≈ 1.6 × `Metrics.minimumTapTarget`（44）：要明显大于拇指按住时的一次
    /// 抖动，又不至于要求横跨半条输入栏。**视图里不许有第二份这个数字** —— 判定与
    /// 呈现都从这一个常量读。
    static let slideThreshold: CGFloat = 70

    enum Outcome: Equatable {
        /// 还在录，松手就转文字。
        case speaking
        /// 松手丢弃这一段，留在语音态（§4.6）。
        case cancelling
        /// 松手不结束，进锁定态继续录（§4.9）。
        case locking
    }

    static func outcome(translationX: CGFloat) -> Outcome {
        if translationX <= -slideThreshold { return .cancelling }
        if translationX >= slideThreshold { return .locking }
        return .speaking
    }
}
