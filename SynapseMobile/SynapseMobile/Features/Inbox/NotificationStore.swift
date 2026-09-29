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
    private var loadGeneration = 0
    private var accountGeneration = 0

    func load(using client: APIClient, filter: String = "all", append: Bool = false) async {
        if append {
            guard !loading, filter == self.filter, nextCursor != nil else { return }
        }
        loadGeneration += 1
        let requestGeneration = loadGeneration
        let account = accountGeneration
        loading = true
        defer { if requestGeneration == loadGeneration, account == accountGeneration { loading = false } }
        do {
            let page = try await client.listNotifications(filter: filter, cursor: append ? nextCursor : nil)
            guard requestGeneration == loadGeneration, account == accountGeneration else { return }
            self.filter = filter
            if append {
                var known = Set(items.map(\.id))
                items += page.items.filter { known.insert($0.id).inserted }
            } else {
                items = page.items
            }
            nextCursor = page.nextCursor
            error = nil
            let count = try await client.notificationUnreadCount()
            guard requestGeneration == loadGeneration, account == accountGeneration else { return }
            unreadCount = count
        } catch {
            if requestGeneration == loadGeneration, account == accountGeneration { self.error = "通知加载失败" }
        }
    }

    func read(_ id: String, using client: APIClient) async {
        let account = accountGeneration
        do {
            try await client.markNotificationRead(id)
            let item = try await client.notification(id)
            guard account == accountGeneration else { return }
            items.removeAll { $0.id == id }
            items.insert(item, at: 0)
            let count = try await client.notificationUnreadCount()
            guard account == accountGeneration else { return }
            unreadCount = count
        } catch { if account == accountGeneration { self.error = "标记已读失败" } }
    }

    func ensure(_ id: String, using client: APIClient) async {
        guard !items.contains(where: { $0.id == id }) else { return }
        let account = accountGeneration
        do {
            let item = try await client.notification(id)
            guard account == accountGeneration else { return }
            items.insert(item, at: 0)
        } catch { if account == accountGeneration { self.error = "通知已失效" } }
    }

    func loadMore(using client: APIClient) async {
        guard nextCursor != nil else { return }
        await load(using: client, filter: filter, append: true)
    }

    func readAll(using client: APIClient) async {
        let account = accountGeneration
        do {
            try await client.markAllNotificationsRead()
            guard account == accountGeneration else { return }
            await load(using: client, filter: filter)
        } catch { if account == accountGeneration { self.error = "标记已读失败" } }
    }

    func delete(_ id: String, using client: APIClient) async {
        let account = accountGeneration
        do {
            try await client.deleteNotification(id)
            guard account == accountGeneration else { return }
            items.removeAll { $0.id == id }
            let count = try await client.notificationUnreadCount()
            guard account == accountGeneration else { return }
            unreadCount = count
        } catch { if account == accountGeneration { self.error = "删除失败" } }
    }

    func deleteAll(using client: APIClient) async {
        let account = accountGeneration
        do {
            try await client.deleteAllNotifications()
            guard account == accountGeneration else { return }
            await load(using: client, filter: filter)
        } catch { if account == accountGeneration { self.error = "清空失败" } }
    }

    func clear() {
        accountGeneration += 1
        loadGeneration += 1
        items = []
        nextCursor = nil
        unreadCount = 0
        error = nil
        loading = false
    }
}
