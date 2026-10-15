import Foundation
import UserNotifications

/// 一条通知被点按时要不要复制正文，以及复制什么。
///
/// 只有两件事能让它成立：这是一次**普通点按**（不是锁屏上那个动作按钮），并且服务端在
/// payload 根上带了 `copyOnTap: true`。开关只认布尔真值 —— `as? Bool` 对字符串一律返回
/// nil，正好挡住 `"false"` 被当成真的那类错误。
enum NotificationTapCopy {
    static func body(
        from userInfo: [AnyHashable: Any],
        contentBody: String,
        actionIdentifier: String
    ) -> String? {
        guard actionIdentifier == UNNotificationDefaultActionIdentifier else { return nil }
        guard userInfo["copyOnTap"] as? Bool == true else { return nil }
        return contentBody
    }
}
