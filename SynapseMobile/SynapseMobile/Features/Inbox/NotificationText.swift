import Foundation

/// 消息行上那些「看起来只是格式化」的东西。
///
/// 它们全是读的人判断先后的依据：一条十分钟前的消息和一条三周前的消息，标题可能一字
/// 不差，而列表上唯一把它们分开的就是这一小段时间。算错了不会崩，只会让人读错。
enum NotificationText {
    /// 消息行右上角那一小段时间。
    ///
    /// 只写到现在这一档为止：今天写时刻，昨天写「昨天」，一周内写星期几，再往前写
    /// 日期。以前这里是 `formatted(date: .abbreviated, time: .shortened)`，于是每
    /// 一条——包括六分钟前那一条——都把年月日和时间一起写全，一行里最长的一段字反而
    /// 说的是最不要紧的事。
    ///
    /// 分档按日历天算，不按经过了多久算：23:50 收到的消息在 00:10 看，中间只隔了
    /// 二十分钟，但它属于「昨天」，不属于「今天」。
    ///
    /// 落在未来的时间当成今天。手机时钟慢一点、服务端写早一点，都会让时间跑到未来，
    /// 而它不该掉进「星期几」那一档去写一个还没到的日子。
    static func timestamp(
        _ raw: String,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> String {
        guard let date = ISO8601DateFormatter.parseWireTimestamp(raw) else { return "" }
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: date),
            to: calendar.startOfDay(for: now)
        ).day ?? 0
        if days <= 0 { return clock.string(from: date) }
        if days == 1 { return "昨天" }
        if days < 7 { return weekday.string(from: date) }
        return day.string(from: date)
    }

    /// 固定中文，理由和 `MeetingText.relativeTime` 是同一条：这个 App 的界面只有中文
    /// 一套文案，时间若跟着设备语言走，就会出现「周二」旁边写着 `5:25 PM` 的混搭。
    ///
    /// 单例而不是每次新建：这一格在列表里一行一次，滚一次屏就是几十次。
    private static let clock = zhFormatter("HH:mm")
    private static let weekday = zhFormatter("EEE")
    private static let day = zhFormatter("M月d日")

    private static func zhFormatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = format
        return formatter
    }
}
