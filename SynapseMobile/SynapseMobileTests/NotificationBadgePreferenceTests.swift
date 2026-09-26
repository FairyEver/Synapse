import Foundation
import Testing
@testable import SynapseMobile

/// App 图标角标要不要跟随未读数。
///
/// 这个开关只影响**系统角标**：底栏那一格的角标、主页铃铛上自绘的琥珀角标都照常工作。
/// 关掉它是一件「我不想让手机在锁屏上提醒我」的事，不是「我不想看见未读」。
///
/// 这一套**串行跑**：读写的是同一份 `UserDefaults.standard`，两条同时改同一个键时，
/// 「没存过就是开」那条会读到另一条刚写进去的 false。
@Suite(.serialized)
struct NotificationBadgePreferenceTests {

    @Test func anEnabledPreferencePassesTheCountThrough() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 3, enabled: true) == 3)
    }

    /// 关掉就是 0，不是「保持上一次的数字」。写 0 才会把锁屏上那个数字抹掉。
    @Test func aDisabledPreferenceWritesZero() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 3, enabled: false) == 0)
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 0, enabled: false) == 0)
    }

    /// 负数不该传下去：`setBadgeCount` 要的是非负。
    @Test func aNegativeCountIsClamped() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: -1, enabled: true) == 0)
    }

    /// 封顶：图标角标只收数字、写不出「+」，所以 100 条以上都写成 99 —— 它得和界面上
    /// 那两枚写着「99+」的角标（主页铃铛、底栏主页那一格）对得上。
    @Test func aLargeCountStopsAtTheLimit() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 99, enabled: true) == 99)
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 100, enabled: true) == 99)
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 1234, enabled: true) == 99)
    }

    /// 关掉总闸仍然是 0，不是「封顶后的 99」：关掉是要把已经画上去的数字擦掉。
    @Test func aDisabledPreferenceWritesZeroEvenWhenCapped() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 1234, enabled: false) == 0)
    }

    /// 界面里能写字的角标和这里读同一个上限，两处不会各封各的。
    @Test func theLimitIsTheOneTheTextSideReads() {
        #expect(NotificationText.badgeCount(NotificationBadgePreference.badgeLimit) == "99")
        #expect(NotificationText.badgeCount(NotificationBadgePreference.badgeLimit + 1) == "99+")
    }

    /// **没存过就是开。** `UserDefaults.bool(forKey:)` 对缺失的 key 返回 `false`，
    /// 直接用它会让所有既有用户升级后静默失去角标。
    @Test func anAbsentPreferenceMeansEnabled() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: NotificationBadgePreference.key)
        defaults.removeObject(forKey: NotificationBadgePreference.key)
        defer {
            if let saved { defaults.set(saved, forKey: NotificationBadgePreference.key) }
            else { defaults.removeObject(forKey: NotificationBadgePreference.key) }
        }

        #expect(NotificationBadgePreference.isEnabled)
    }

    /// 存进去读回来是同一条。
    @Test func aStoredPreferenceReadsBack() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: NotificationBadgePreference.key)
        defer {
            if let saved { defaults.set(saved, forKey: NotificationBadgePreference.key) }
            else { defaults.removeObject(forKey: NotificationBadgePreference.key) }
        }

        NotificationBadgePreference.isEnabled = false
        #expect(NotificationBadgePreference.isEnabled == false)
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 5) == 0)

        NotificationBadgePreference.isEnabled = true
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 5) == 5)
    }
}
