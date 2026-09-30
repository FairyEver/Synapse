import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct NotificationStoreReadTests {
    private func item(_ id: String, readAt: String? = nil) -> SynapseNotification {
        SynapseNotification(
            id: id, source: "external", title: id, body: "正文", group: nil,
            url: nil, level: "active", targetId: nil, deviceId: nil,
            readAt: readAt, resolvedAt: nil, createdAt: "2026-09-23T09:25:00.000Z"
        )
    }

    @Test func readingOlderItemKeepsChronologicalOrder() {
        let items = [item("new"), item("old")]
        let updated = NotificationStore.itemsAfterReading(
            item("old", readAt: "2026-09-23T09:31:00.000Z"),
            in: items, filter: "all"
        )
        #expect(updated.map(\.id) == ["new", "old"])
        #expect(updated[1].readAt != nil)
    }

    @Test func readingUnreadItemRemovesOnlyThatItem() {
        let updated = NotificationStore.itemsAfterReading(
            item("middle", readAt: "2026-09-23T09:31:00.000Z"),
            in: [item("new"), item("middle"), item("old")], filter: "unread"
        )
        #expect(updated.map(\.id) == ["new", "old"])
    }

    @Test func readingUnloadedItemDoesNotInsertItAtTheTop() {
        let updated = NotificationStore.itemsAfterReading(
            item("older", readAt: "2026-09-23T09:31:00.000Z"),
            in: [item("new")], filter: "all"
        )
        #expect(updated.map(\.id) == ["new"])
    }
}
