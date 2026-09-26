import Foundation

/// 消息行上那些「看起来只是格式化」的东西。
///
/// 它们全是读的人判断先后的依据：一条十分钟前的消息和一条三周前的消息，标题可能一字
/// 不差，而列表上唯一把它们分开的就是这一小段时间。算错了不会崩，只会让人读错。
///
/// 角标上那个数字也是同一类东西：写多长直接决定它盖不盖住铃铛、会不会被顶栏裁掉。
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

    /// 详情页那一行「分组 · 时间」。
    ///
    /// 分组名只有外部接口发来的消息才有。它在列表里跟标题并排，落到详情页就得自己
    /// 找位置；把它和时间放同一行的理由是它们回答的是同一类问题——这条属于谁、什么
    /// 时候来的——而正文回答的是另一个：说了什么。
    ///
    /// 两边都可能缺席，而一个悬空的分隔符（「测试 ·」或「 · 17:25」）比少一半信息
    /// 更像坏掉，所以拼接按谁在场来定。
    static func meta(
        group: String?,
        createdAt: String,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> String {
        let group = group ?? ""
        let time = timestamp(createdAt, now: now, calendar: calendar)
        if group.isEmpty { return time }
        if time.isEmpty { return group }
        return "\(group) · \(time)"
    }

    /// 铃铛角标上那个数字。
    ///
    /// 三位封顶：100 条起一律写「99+」。角标只有铃铛右上角那一小块地方，位数越多它越
    /// 往左长，先压到铃铛身上，再长就会被 iOS 26 的工具栏内容框切掉一角；而多出来的位数
    /// 并不增加信息 —— 「99+」和「1234」说的是同一件事：多到看不完。
    static func badgeCount(_ unreadCount: Int) -> String {
        let count = max(0, unreadCount)
        return count < 100 ? "\(count)" : "99+"
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
