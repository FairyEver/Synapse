import Foundation

/// App 图标角标要不要跟随未读数。默认开。
///
/// 它只影响 **App 图标**上那个数字。底栏主页那一格的系统角标、主页铃铛上自绘的琥珀角标
/// 都不受它管 —— 它们是应用内的，不需要经过系统通知中心的许可，也就不该受一个叫
/// 「图标角标」的开关牵连。
///
/// 不用 `@AppStorage` 当唯一入口：读它的地方（`RootView`）不是在画一个绑定，而是在决定
/// 要不要写角标，中间隔着一层 `UNUserNotificationCenter`。设置页那一行仍然用 `@AppStorage`
/// 画开关，两边读写的是同一个键。
enum NotificationBadgePreference {
    static let key = "mobile.notificationBadge.enabled"

    /// 一枚角标最多写到这个数：99 条以内照实写，再多就是「多到看不完」，位数不增加信息。
    ///
    /// 全应用的角标上限只有这一处。界面里能写字的角标（主页铃铛、底栏主页那一格）由
    /// `NotificationText.badgeCount` 写成「99+」；App 图标那枚只收数字、写不出「+」，
    /// 封在这个数上 —— 它的接口 `setBadgeCount` 只接受整数。
    static let badgeLimit = 99

    /// 没存过就是开。
    ///
    /// `UserDefaults.bool(forKey:)` 对缺失的 key 返回 `false`，直接用它会让升级上来的
    /// 既有用户静默失去角标 —— 而角标是「有会话在等你」的第三条常驻通路，不能悄悄少一条。
    static var isEnabled: Bool {
        get {
            let defaults = UserDefaults.standard
            guard defaults.object(forKey: key) != nil else { return true }
            return defaults.bool(forKey: key)
        }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// 该写进 App 图标角标的数字。纯函数，好判。
    ///
    /// 封在 `badgeLimit` 上：图标角标只收数字，写不出「+」，所以 100 条以上都写成 99。
    /// 不封的话这枚角标会一直长，和界面上那两枚写着「99+」的对不上。
    static func badgeCount(unreadCount: Int, enabled: Bool) -> Int {
        guard enabled else { return 0 }
        return min(max(0, unreadCount), badgeLimit)
    }

    /// 读偏好取该写的数字。
    static func badgeCount(unreadCount: Int) -> Int {
        badgeCount(unreadCount: unreadCount, enabled: isEnabled)
    }
}
