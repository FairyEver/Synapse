import Foundation
import Observation

struct DriveDiscussionNotificationMetadata: Decodable {
    let kind: String
    let action: String
    let snapshot: DriveDiscussionNotificationSnapshot?

    init(kind: String, action: String, snapshot: DriveDiscussionNotificationSnapshot? = nil) {
        self.kind = kind; self.action = action; self.snapshot = snapshot
    }

    private enum CodingKeys: String, CodingKey { case kind, action, snapshot }
    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        kind = try values.decode(String.self, forKey: .kind)
        action = try values.decode(String.self, forKey: .action)
        snapshot = try? values.decode(DriveDiscussionNotificationSnapshot.self, forKey: .snapshot)
    }
}

struct DriveDiscussionNotificationSnapshot: Decodable {
    struct Original: Decodable { let kind: String; let text: String }
    struct ReplyTo: Decodable { let authorName: String; let content: String }
    let detailTitle: String
    let content: String
    let original: Original?
    let replyTo: ReplyTo?

    init(detailTitle: String, content: String, original: Original? = nil, replyTo: ReplyTo? = nil) {
        self.detailTitle = detailTitle; self.content = content
        self.original = original; self.replyTo = replyTo
    }

    private enum CodingKeys: String, CodingKey { case detailTitle, content, original, replyTo }
    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        detailTitle = try values.decode(String.self, forKey: .detailTitle)
        content = try values.decode(String.self, forKey: .content)
        guard !detailTitle.isEmpty, detailTitle.unicodeScalars.count <= 2048, content.unicodeScalars.count <= 500 else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid discussion snapshot"))
        }
        let quote = try? values.decode(Original.self, forKey: .original)
        original = quote.flatMap { ["text", "image"].contains($0.kind) && !$0.text.isEmpty && $0.text.unicodeScalars.count <= 200 ? $0 : nil }
        let reply = try? values.decode(ReplyTo.self, forKey: .replyTo)
        replyTo = reply.flatMap { $0.authorName.unicodeScalars.count <= 200 && $0.content.unicodeScalars.count <= 200 ? $0 : nil }
    }
}

struct SynapseNotification: Decodable, Identifiable {
    let id: String
    let source: String
    let title: String
    let body: String
    let group: String?
    let url: String?
    let copyOnTap: Bool?
    let level: String
    let targetId: String?
    let deviceId: String?
    let readAt: String?
    let resolvedAt: String?
    let createdAt: String
    let driveDiscussion: DriveDiscussionNotificationMetadata?

    init(id: String, source: String, title: String, body: String, group: String?, url: String?, copyOnTap: Bool? = nil,
         level: String, targetId: String?, deviceId: String?, readAt: String?, resolvedAt: String?, createdAt: String,
         driveDiscussion: DriveDiscussionNotificationMetadata? = nil) {
        self.id = id; self.source = source; self.title = title; self.body = body
        self.group = group; self.url = url; self.copyOnTap = copyOnTap; self.level = level
        self.targetId = targetId; self.deviceId = deviceId; self.readAt = readAt
        self.resolvedAt = resolvedAt; self.createdAt = createdAt; self.driveDiscussion = driveDiscussion
    }
}

struct NotificationPage: Decodable {
    let items: [SynapseNotification]
    let nextCursor: String?
}

nonisolated protocol NotificationStoreAPI {
    func listNotifications(filter: String, cursor: String?) async throws -> NotificationPage
    func notification(_ id: String) async throws -> SynapseNotification
    func notificationUnreadCount() async throws -> Int
    func markNotificationRead(_ id: String) async throws
    func markAllNotificationsRead() async throws
    func deleteNotification(_ id: String) async throws
    func deleteAllNotifications() async throws
}

extension APIClient: NotificationStoreAPI {}

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
    private var mutationRevision = 0
    private var feedbackGeneration = 0

    private func beginFeedback() -> Int {
        feedbackGeneration += 1
        return feedbackGeneration
    }

    func load(using client: any NotificationStoreAPI, filter: String = "all", append: Bool = false) async {
        if append {
            guard !loading, filter == self.filter, nextCursor != nil else { return }
        }
        await load(using: client, filter: filter, append: append, feedback: beginFeedback())
    }

    private func load(using client: any NotificationStoreAPI, filter: String, append: Bool = false, feedback: Int) async {
        guard !Task.isCancelled else { return }
        loadGeneration += 1
        let requestGeneration = loadGeneration
        let account = accountGeneration
        // Background refreshes must use the requested filter even before its page arrives.
        if self.filter != filter {
            self.filter = filter
            items = []
            nextCursor = nil
        }
        loading = true
        defer { if requestGeneration == loadGeneration, account == accountGeneration { loading = false } }
        do {
            let cursor = append ? nextCursor : nil
            var page: NotificationPage
            while true {
                guard !Task.isCancelled else { return }
                let revision = mutationRevision
                page = try await client.listNotifications(filter: filter, cursor: cursor)
                guard requestGeneration == loadGeneration, account == accountGeneration, !Task.isCancelled else { return }
                // A successful read/delete changes the server before this snapshot
                // returns. Retry its same cursor instead of restoring stale rows.
                if revision == mutationRevision { break }
            }
            if append {
                var known = Set(items.map(\.id))
                items += page.items.filter { known.insert($0.id).inserted }
            } else {
                items = page.items
            }
            nextCursor = page.nextCursor
            guard let count = try await currentUnreadCount(using: client, account: account, requestGeneration: requestGeneration) else { return }
            guard requestGeneration == loadGeneration, account == accountGeneration else { return }
            unreadCount = count
            if feedback == feedbackGeneration { error = nil }
        } catch {
            guard !Task.isCancelled else { return }
            if requestGeneration == loadGeneration, account == accountGeneration, feedback == feedbackGeneration { self.error = "通知加载失败" }
        }
    }

    @discardableResult
    func read(_ id: String, using client: any NotificationStoreAPI) async -> SynapseNotification? {
        guard !Task.isCancelled else { return nil }
        let feedback = beginFeedback()
        let account = accountGeneration
        do {
            try await client.markNotificationRead(id)
            guard account == accountGeneration, !Task.isCancelled else { return nil }
            mutationRevision += 1
            let item = try await client.notification(id)
            guard account == accountGeneration, !Task.isCancelled else { return nil }
            items = Self.itemsAfterReading(item, in: items, filter: filter)
            guard let count = try await currentUnreadCount(using: client, account: account) else { return nil }
            guard account == accountGeneration, !Task.isCancelled else { return nil }
            unreadCount = count
            if feedback == feedbackGeneration { error = nil }
            return item
        } catch { if account == accountGeneration, feedback == feedbackGeneration { self.error = "标记已读失败" } }
        return nil
    }

    @discardableResult
    func ensure(_ id: String, using client: any NotificationStoreAPI) async -> Bool {
        guard !items.contains(where: { $0.id == id }) else { return true }
        let account = accountGeneration
        let feedback = beginFeedback()
        while !Task.isCancelled {
            let revision = mutationRevision
            do {
                let item = try await client.notification(id)
                guard account == accountGeneration, !Task.isCancelled else { return false }
                guard revision == mutationRevision else { continue }
                if !items.contains(where: { $0.id == id }) { items.insert(item, at: 0) }
                return true
            } catch {
                guard account == accountGeneration, !Task.isCancelled else { return false }
                guard revision == mutationRevision else { continue }
                if feedback == feedbackGeneration { self.error = "通知已失效" }
                return false
            }
        }
        return false
    }

    func loadMore(using client: any NotificationStoreAPI) async {
        guard nextCursor != nil else { return }
        await load(using: client, filter: filter, append: true)
    }

    func readAll(using client: any NotificationStoreAPI) async {
        let account = accountGeneration
        let feedback = beginFeedback()
        do {
            try await client.markAllNotificationsRead()
            guard account == accountGeneration else { return }
            mutationRevision += 1
            await load(using: client, filter: filter, feedback: feedback)
        } catch { if account == accountGeneration, feedback == feedbackGeneration { self.error = "标记已读失败" } }
    }

    func delete(_ id: String, using client: any NotificationStoreAPI) async {
        let feedback = beginFeedback()
        let account = accountGeneration
        do {
            try await client.deleteNotification(id)
            guard account == accountGeneration else { return }
            mutationRevision += 1
            items.removeAll { $0.id == id }
            guard let count = try await currentUnreadCount(using: client, account: account) else { return }
            guard account == accountGeneration else { return }
            unreadCount = count
            if feedback == feedbackGeneration { error = nil }
        } catch { if account == accountGeneration, feedback == feedbackGeneration { self.error = "删除失败" } }
    }

    func deleteAll(using client: any NotificationStoreAPI) async {
        let account = accountGeneration
        let feedback = beginFeedback()
        do {
            try await client.deleteAllNotifications()
            guard account == accountGeneration else { return }
            mutationRevision += 1
            await load(using: client, filter: filter, feedback: feedback)
        } catch { if account == accountGeneration, feedback == feedbackGeneration { self.error = "清空失败" } }
    }

    func clear() {
        accountGeneration += 1
        loadGeneration += 1
        feedbackGeneration += 1
        items = []
        nextCursor = nil
        unreadCount = 0
        error = nil
        loading = false
    }

    private func currentUnreadCount(using client: any NotificationStoreAPI, account: Int, requestGeneration: Int? = nil) async throws -> Int? {
        while !Task.isCancelled {
            let revision = mutationRevision
            let count = try await client.notificationUnreadCount()
            guard account == accountGeneration else { return nil }
            if let requestGeneration, requestGeneration != loadGeneration { return nil }
            if revision == mutationRevision { return count }
        }
        return nil
    }

    static func itemsAfterReading(
        _ item: SynapseNotification,
        in currentItems: [SynapseNotification],
        filter: String
    ) -> [SynapseNotification] {
        var updated = currentItems
        guard let index = updated.firstIndex(where: { $0.id == item.id }) else { return updated }
        if filter == "unread" {
            updated.remove(at: index)
        } else {
            updated[index] = item
        }
        return updated
    }
}
