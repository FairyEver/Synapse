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
    /// 一次更新带多少个振幅槽位。
    ///
    /// **这不是「画几条柱子」。** 锁屏那张卡和灵动岛展开态都是整行宽的，一条条按固定
    /// 柱宽排下来，一行放得下一百四五十条。载荷按最大的那一种屏幕给够，视图再按自己
    /// 手里的宽度决定画几条（见 `RecordingLevelBars`）。给少了，波形就填不满那一行。
    static let levelCount = 160
    /// 振幅低于这个值的算安静，用来判断开始那几秒有没有听到声音。
    static let silenceThreshold = 0.02

    /// 波形的柱宽与间距。
    ///
    /// 与 `MeetingAudio.barWidth` / `barGap` 是同一组数（那一组又和电脑端同一组）——
    /// 锁屏和灵动岛上这条波形要和录音页那条是同一个东西，比例就不能各画各的。
    /// `MeetingAudio` 直接读这里，所以改只会在一处发生。
    ///
    /// `nonisolated`：这个工程默认每个类型都归主 actor 管，而 `MeetingAudio` 那边是
    /// 在 `static let` 的初始化式里读它 —— 那是非隔离上下文。三个都是不变量，本来就
    /// 不该跟着 actor 走。
    nonisolated static let barWidth: CGFloat = 1.5
    nonisolated static let barGap: CGFloat = 1.1

    /// 锁屏那张卡的内容外边距。
    ///
    /// 14 pt 是 Apple 给实时活动锁屏形态定的标准布局边距（HIG「Live Activities」
    /// 的 Specifications），不是随手取的 16。系统只画卡片本身和它的圆角，这圈留白
    /// 是内容自己让出来的。
    nonisolated static let contentMargin: CGFloat = 14
}
