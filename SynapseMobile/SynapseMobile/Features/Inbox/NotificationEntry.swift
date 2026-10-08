import Foundation

/// 通知底栏首次进入时的默认筛选。
enum NotificationEntry {
    static func defaultFilter(unreadCount: Int) -> String {
        unreadCount > 0 ? "unread" : "all"
    }
}
