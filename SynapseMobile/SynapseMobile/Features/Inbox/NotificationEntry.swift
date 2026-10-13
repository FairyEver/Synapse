import Foundation

/// 通知底栏首次进入时的默认筛选。
enum NotificationEntry {
    /// Shared by direct opens and detail reads; a newer navigation invalidates both.
    @MainActor static func readVerified(
        read: () async -> SynapseNotification?,
        isCurrent: () -> Bool
    ) async -> SynapseNotification? {
        guard isCurrent(), !Task.isCancelled else { return nil }
        let item = await read()
        guard isCurrent(), !Task.isCancelled else { return nil }
        return item
    }

    static func defaultFilter(unreadCount: Int) -> String {
        unreadCount > 0 ? "unread" : "all"
    }
}
