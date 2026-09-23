import Foundation
import Observation

struct SynapseNotification: Decodable, Identifiable {
    let id: String
    let source: String
    let title: String
    let body: String
    let group: String?
    let url: String?
    let level: String
    let targetId: String?
    let deviceId: String?
    let readAt: String?
    let resolvedAt: String?
    let createdAt: String
}

struct NotificationPage: Decodable {
    let items: [SynapseNotification]
    let nextCursor: String?
}

@MainActor
@Observable
final class NotificationStore {
    private(set) var items: [SynapseNotification] = []
    private(set) var nextCursor: String?
    private(set) var loading = false
    private(set) var error: String?
    private(set) var filter = "all"

    private(set) var unreadCount = 0

    func load(using client: APIClient, filter: String = "all", append: Bool = false) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let page = try await client.listNotifications(filter: filter, cursor: append ? nextCursor : nil)
            self.filter = filter
            items = append ? items + page.items.filter { item in !items.contains { $0.id == item.id } } : page.items
            nextCursor = page.nextCursor
            unreadCount = try await client.notificationUnreadCount()
            error = nil
        } catch {
            self.error = "消息加载失败"
        }
    }

    func read(_ id: String, using client: APIClient) async {
        do {
            try await client.markNotificationRead(id)
            let item = try await client.notification(id)
            items.removeAll { $0.id == id }
            items.insert(item, at: 0)
            unreadCount = try await client.notificationUnreadCount()
        } catch { self.error = "标记已读失败" }
    }

    func ensure(_ id: String, using client: APIClient) async {
        guard !items.contains(where: { $0.id == id }) else { return }
        do {
            let item = try await client.notification(id)
            items.insert(item, at: 0)
        } catch { self.error = "消息已失效" }
    }

    func loadMore(using client: APIClient) async {
        guard nextCursor != nil else { return }
        await load(using: client, filter: filter, append: true)
    }

    func readAll(using client: APIClient) async {
        do {
            try await client.markAllNotificationsRead()
            await load(using: client, filter: filter)
        } catch { self.error = "标记已读失败" }
    }

    func delete(_ id: String, using client: APIClient) async {
        do {
            try await client.deleteNotification(id)
            items.removeAll { $0.id == id }
            unreadCount = try await client.notificationUnreadCount()
        } catch { self.error = "删除失败" }
    }

    func clear() {
        items = []
        nextCursor = nil
        unreadCount = 0
        error = nil
    }
}
