import Foundation

/// 消息行上那些「看起来只是格式化」的东西。
///
/// 它们全是读的人判断先后的依据：一条十分钟前的消息和一条三周前的消息，标题可能一字
/// 不差，而列表上唯一把它们分开的就是这一小段时间。算错了不会崩，只会让人读错。
///
/// 角标上那个数字也是同一类东西：写多长直接决定它盖不盖住铃铛、会不会被顶栏裁掉。
enum NotificationText {
    struct DayGroup: Identifiable {
        let id: Date?
        let title: String
        var items: [SynapseNotification]
    }

    static func dayGroups(
        _ items: [SynapseNotification],
        now: Date = .now,
        calendar: Calendar = .current
    ) -> [DayGroup] {
        var groups: [DayGroup] = []
        let today = calendar.startOfDay(for: now)
        // A deep link can ensure an older item at the front of the store. Keep each
        // day together so SwiftUI receives one section ID per day, including unknown.
        let ordered = items.enumerated().map { index, item in
            (index: index, item: item, date: ISO8601DateFormatter.parseWireTimestamp(item.createdAt))
        }.sorted {
            let left = $0.date ?? .distantPast
            let right = $1.date ?? .distantPast
            return left == right ? $0.index < $1.index : left > right
        }
        for entry in ordered {
            let item = entry.item
            let day = entry.date
                .map { min(calendar.startOfDay(for: $0), today) }
            if let last = groups.last, last.id == day {
                groups[groups.count - 1].items.append(item)
            } else {
                groups.append(DayGroup(
                    id: day,
                    title: day.map { dayTitle($0, now: now, calendar: calendar) } ?? "时间未知",
                    items: [item]
                ))
            }
        }
        return groups
    }

    static func timeOfDay(_ raw: String, calendar: Calendar = .current) -> String {
        guard let date = ISO8601DateFormatter.parseWireTimestamp(raw) else { return "" }
        let components = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else { return "" }
        return String(format: "%02d:%02d", hour, minute)
    }

    static func fullTimestamp(_ raw: String, calendar: Calendar = .current) -> String {
        guard let date = ISO8601DateFormatter.parseWireTimestamp(raw) else { return "" }
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year, let month = components.month,
              let day = components.day else { return "" }
        return "\(year)年\(month)月\(day)日 \(timeOfDay(raw, calendar: calendar))"
    }

    static func status(_ item: SynapseNotification) -> String? {
        guard item.source == "terminal-attention" || item.source == "terminal-complete" else { return nil }
        if item.targetId == nil { return "会话已结束" }
        if item.source == "terminal-attention", item.resolvedAt != nil { return "已不再待处理" }
        return nil
    }

    static func displayTitle(_ item: SynapseNotification) -> String {
        guard item.source == "terminal-attention", status(item) != nil,
              item.title.hasSuffix(" 需要你确认") else { return item.title }
        return String(item.title.dropLast(" 需要你确认".count))
    }

    static func detailMeta(_ item: SynapseNotification, calendar: Calendar = .current) -> String {
        [fullTimestamp(item.createdAt, calendar: calendar), status(item)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private static func dayTitle(_ day: Date, now: Date, calendar: Calendar) -> String {
        let today = calendar.startOfDay(for: now)
        if day >= today { return "今天" }
        if calendar.isDate(day, inSameDayAs: calendar.date(byAdding: .day, value: -1, to: today) ?? today) {
            return "昨天"
        }
        let components = calendar.dateComponents([.year, .month, .day], from: day)
        guard let year = components.year, let month = components.month, let dayNumber = components.day else {
            return "时间未知"
        }
        let dateLabel = "\(month)月\(dayNumber)日"
        return calendar.isDate(day, equalTo: today, toGranularity: .year)
            ? dateLabel : "\(year)年\(dateLabel)"
    }

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

    /// 角标上那个数字：99 条以内照实写，100 条起「99+」。
    ///
    /// 角标只有那么一点地方，位数越多它越往左长，先压到铃铛身上，再长就会被 iOS 26 的
    /// 工具栏内容框切掉一角；而多出来的位数并不增加信息 —— 「99+」和「1234」说的是同一
    /// 件事：多到看不完。上限本身在 `NotificationBadgePreference.badgeLimit`，App 图标
    /// 那枚角标也读同一处。
    static func badgeCount(_ unreadCount: Int) -> String {
        let count = max(0, unreadCount)
        return count <= NotificationBadgePreference.badgeLimit
            ? "\(count)"
            : "\(NotificationBadgePreference.badgeLimit)+"
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
