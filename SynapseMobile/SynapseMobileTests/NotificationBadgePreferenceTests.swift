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
