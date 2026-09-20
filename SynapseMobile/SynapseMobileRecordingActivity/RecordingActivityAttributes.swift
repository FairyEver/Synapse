import ActivityKit
import CoreGraphics
import Foundation

/// 一次录音的实时活动。
///
/// 这份文件**同时编进 App 和扩展**：`Activity.request` 由 App 发起，锁屏和灵动岛由
/// 扩展渲染，两边必须是同一个类型。
struct RecordingActivityAttributes: ActivityAttributes {
    /// 会变的那部分。
    struct ContentState: Codable, Hashable {
        /// 已经录了多久。暂停期间不涨，所以它比钟表时间准——系统中断那几分钟不计入。
        var elapsedSeconds: Int
        /// 最近一段时间的振幅，0–1，最新的在最后。展开态那条滚动波形画的就是它。
        var levels: [Double]
        /// 有值代表正被系统中断占着麦克风，界面要照原样说明原因。
        var pausedReason: String?
    }

    /// 录音开始时刻，用来给锁屏那条波形定位时间轴。
    var startedAt: Date
    /// 列表里那条录音的名字，默认「新录音」。
    var title: String
}

/// 实时活动的展示常量，两边共用，免得 App 画的波形和锁屏画的不是同一套比例。
enum RecordingActivityLimits {
    /// 一次更新带多少个振幅采样。
    ///
    /// 点阵一行放得下三四十颗，这里面只有播放头左边那一段会被画出来。取够一行用的量
    /// 就够——给多了只是让每一颗代表的时段变短，看不出更多东西。
    static let levelCount = 48
    /// 振幅低于这个值的算安静，用来判断开始那几秒有没有听到声音。
    static let silenceThreshold = 0.02

    /// 点阵：圆点宽度与间距。
    ///
    /// 照语音备忘录那条抄的：几颗分开的小圆点，不是一条密排的细柱。**不与
    /// `MeetingAudio.barWidth` / `barGap` 共用**——App 内那条仍是细柱，两边是有意
    /// 长得不一样的画法。
    nonisolated static let dotWidth: CGFloat = 3.6
    nonisolated static let dotGap: CGFloat = 2.2

    /// 播放头（那条红色竖线）落在整条点阵的哪个位置。
    ///
    /// 0.59 是量着语音备忘录那张灵动岛截图取的：它右边留出的空档是整条的四成上下。
    /// 播放头左边的圆点是**已经录到的**（真实振幅），右边是**还没到的**（暗色小点，
    /// 让这条点阵无论录了多久都保持同一个形状）。
    nonisolated static let playheadFraction: CGFloat = 0.59

    /// 播放头那根竖线的宽度，以及暗色小点的高度。
    nonisolated static let playheadWidth: CGFloat = 1.8
    nonisolated static let placeholderDotHeight: CGFloat = 3.4

    /// 有声音的圆点最矮也有这么高——安静的时候它是一颗点，不是一条线。
    nonisolated static let minimumDotHeight: CGFloat = 4.6

    /// 锁屏那张卡的内容外边距。
    ///
    /// 14 pt 是 Apple 给实时活动锁屏形态定的标准布局边距（HIG「Live Activities」
    /// 的 Specifications），不是随手取的 16。系统只画卡片本身和它的圆角，这圈留白
    /// 是内容自己让出来的。
    nonisolated static let contentMargin: CGFloat = 14
}
