import Foundation

/// 服务端返回的转写进度。
///
/// 字段与服务端的 `MeetingTranscriptionProgressDto` 一一对应。腾讯云只回「排队 / 识别中 /
/// 完成 / 失败」四个状态，没有百分比，所以服务端能给的也只有「已经等了多久」加一个按音频
/// 时长估出来的总时长。
struct MeetingTranscriptionProgress: Decodable, Hashable {
    /// `running` 是已经投给识别引擎了；`queued` 是还没投出去（只在投递失败退回队列时短暂
    /// 出现）。
    let stage: String
    let elapsedMs: Int
    let expectedMs: Int

    var isRunning: Bool { stage == "running" }
}

/// 进度条上那些「算错了不报错，只是看错」的纯逻辑：条画到哪儿、秒表此刻读到几。
///
/// 单独一个枚举是为了能单测：它不认识 SwiftUI，也不认识界面的刷新节奏。同一套数在电脑端
/// 也有一份（`desktop/src/modules/meeting/transcription-progress.ts`），两边画出来的东西
/// 才是同一条。
///
/// **这不是一个真实比例。** 它的作用是让人看出「在动、没死」，而不是报一个准数。
enum MeetingTranscriptionProgressMath {
    /// 与共享层的 `MEETING_TRANSCRIPTION_PROGRESS_CAP` 同一个数。
    ///
    /// 估算不是承诺，结果没回来之前不许画满——画满了还不出结果，比不画更让人以为坏了。
    static let cap = 0.95

    /// 条画到 0–1 之间的哪儿。估算为零或负数时不画，不去除零。
    static func fraction(elapsedMs: Int, expectedMs: Int) -> Double {
        guard expectedMs > 0 else { return 0 }
        let ratio = Double(max(0, elapsedMs)) / Double(expectedMs)
        return min(cap, ratio)
    }

    /// 此刻该报的已用时长。
    ///
    /// 服务端给的数只到「它生成这个响应的那一刻」，而两边是每 5 秒才刷一次。刷新间隔里由
    /// 客户端接着往下走，用的是**本机两次读取之间的差值**，不是本机挂钟减服务端时间戳：
    /// 手机时钟和服务器差几分钟也照样算得对。时钟往回跳时夹到零，条不会倒退。
    static func elapsedMs(reported: Int, receivedAt: Date, now: Date) -> Int {
        // `timeIntervalSince` 是**秒**，这里要的是毫秒。少乘这个 1000 不会报错，只会让秒表
        // 一秒才走 1 毫秒——看着和冻住一样，而那正是这条进度要解决的问题。
        let spread = max(0, now.timeIntervalSince(receivedAt)) * 1000
        return max(0, reported) + Int(spread.rounded())
    }
}
