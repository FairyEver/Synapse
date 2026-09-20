import ActivityKit
import CoreGraphics
import Foundation

/// 一次录音的实时活动。
///
/// 这份文件**同时编进 App 和扩展**：`Activity.request` 由 App 发起，锁屏和灵动岛由
/// 扩展渲染，两边必须是同一个类型。
///
/// **静态那半现在是空的**，不是漏了。这里原本放着录音名和录音开始时刻，2026-09-20 两样
/// 都删了：开始时刻是给锁屏那条点阵定位时间轴的，点阵先没；录音名紧接着也没了——用户
/// 要求锁屏卡片和灵动岛都只留「时间 + 停止键」，名字在系统这一层没有显示位置（App 内
/// 照常有）。留着不读的字段只会让下一个人以为它在哪儿用得着。真要用回来，加回一个
/// `var title: String` 就够。
struct RecordingActivityAttributes: ActivityAttributes {
    /// 会变的那部分。
    struct ContentState: Codable, Hashable {
        /// 已经录了多久。暂停期间不涨，所以它比钟表时间准——系统中断那几分钟不计入。
        var elapsedSeconds: Int
        /// 有值代表正被系统中断占着麦克风，界面要照原样说明原因。
        var pausedReason: String?
    }
}

/// 实时活动的展示常量，两边共用。
///
/// 2026-09-20 清过一遍：点阵（`dotWidth` / `dotGap` / `playheadFraction` / 播放头与占位点
/// 的高度）随波形一起删了。锁屏和灵动岛现在只剩计时、红点和一枚停止键，两边没有需要对齐
/// 比例的东西了，留下的只有下面这条边距。
enum RecordingActivityLimits {
    /// 振幅低于这个值的算安静，用来判断开始那几秒有没有听到声音。
    static let silenceThreshold = 0.02

    /// 锁屏那张卡的内容外边距。
    ///
    /// 14 pt 是 Apple 给实时活动锁屏形态定的标准布局边距（HIG「Live Activities」
    /// 的 Specifications），不是随手取的 16。系统只画卡片本身和它的圆角，这圈留白
    /// 是内容自己让出来的。
    nonisolated static let contentMargin: CGFloat = 14
}
