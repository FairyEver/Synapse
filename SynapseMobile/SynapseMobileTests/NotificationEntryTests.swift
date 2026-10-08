import Testing
@testable import SynapseMobile

struct NotificationEntryTests {
    @Test func unreadNotificationsOpenTheUnreadFilter() {
        #expect(NotificationEntry.defaultFilter(unreadCount: 3) == "unread")
    }

    @Test func noUnreadNotificationsOpenTheAllFilter() {
        #expect(NotificationEntry.defaultFilter(unreadCount: 0) == "all")
    }

    @Test func negativeCountsUseTheAllFilter() {
        #expect(NotificationEntry.defaultFilter(unreadCount: -1) == "all")
    }
}
