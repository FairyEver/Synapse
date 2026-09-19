import ActivityKit
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
    /// 展开态保留多少个振幅槽位。
    static let levelCount = 32
    /// 振幅低于这个值的算安静，用来判断开始那几秒有没有听到声音。
    static let silenceThreshold = 0.02
}
