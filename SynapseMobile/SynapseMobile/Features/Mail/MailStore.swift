import Foundation
import Observation

@MainActor
protocol MailAccountContext {
    var accountIdentityGeneration: Int { get }
    func isCurrentAccount(_ generation: Int) -> Bool
}

@MainActor
protocol MailStoreAPI: MailAccountContext {
    func mailMessages(box: String, query: String, cursor: String?, unreadOnly: Bool) async throws -> MailMessagePage
    func mailCounts() async throws -> MailCounts
    func mailMessage(id: String) async throws -> MailMessage
    func mailContext(id: String, cursor: String?) async throws -> MailMessagePage
    func mailSetRead(id: String, read: Bool) async throws
    func mailDelete(id: String, box: String?) async throws
    func mailReadAll() async throws -> MailBulkReadResult
    func mailDeleteBatch(ids: [String], box: String?) async throws -> MailBulkDeleteResult
    func mailDeleteAll(box: String) async throws -> MailBulkDeleteResult
}

extension SynapseAppModel: MailStoreAPI {}

@Observable @MainActor
final class MailStore {
    enum Box: String, CaseIterable, Identifiable {
        case inbox, sent
        var id: String { rawValue }
        var title: String {
            switch self { case .inbox: "收件箱"; case .sent: "已发送" }
        }
    }

    var box: Box = .inbox
    var messages: [MailSummary] = []
    var detail: MailMessage?
    var context: [MailSummary] = []
    var nextContextCursor: String?
    var contextError: String?
    private(set) var loadingContext = false
    var loading = false
    var error: String?
    var nextCursor: String?
    var counts: MailCounts?
    var unreadOnly = false
    private var loadGeneration = 0
    private var openGeneration = 0
    private var loadedQuery = ""
    private var readRevision = 0
    private var readOperationRevision = 0
    private var latestReadOperation: [String: Int] = [:]
    private var latestReadAllOperation = 0
    private var feedbackGeneration = 0

    private func beginFeedback() -> Int {
        feedbackGeneration += 1
        return feedbackGeneration
    }

    private func beginReadOperation() -> Int {
        readOperationRevision += 1
        return readOperationRevision
    }

    func load(using model: any MailStoreAPI, query: String = "") async {
        _ = await load(using: model, query: query, feedback: beginFeedback())
    }

    /// A mutation's refresh keeps the feedback ownership of its original request.
    /// Its rows and counts still refresh if a newer action owns the visible error.
    private func load(using model: any MailStoreAPI, query: String, feedback: Int) async -> Bool {
        loadGeneration += 1
        let generation = loadGeneration
        let requestedBox = box
        loading = true
        if feedback == feedbackGeneration { error = nil }
        defer { if generation == loadGeneration { loading = false } }
        do {
            guard let page = try await currentPage(using: model, box: requestedBox, query: query, cursor: nil, generation: generation) else { return false }
            messages = page.items
            nextCursor = page.nextCursor
            loadedQuery = query
            let latestCounts = try? await currentCounts(using: model, box: requestedBox, generation: generation)
            if generation == loadGeneration { counts = latestCounts }
        } catch {
            if generation == loadGeneration, feedback == feedbackGeneration {
                self.error = error.localizedDescription
            }
        }
        return generation == loadGeneration && feedback == feedbackGeneration
    }

    func loadMore(using model: any MailStoreAPI, query: String = "") async {
        guard query == loadedQuery, let nextCursor, !loading else { return }
        let requestedBox = box
        let generation = loadGeneration
        let feedback = beginFeedback()
        loading = true
        error = nil
        defer { if generation == loadGeneration { loading = false } }
        do {
            guard let page = try await currentPage(using: model, box: requestedBox, query: query, cursor: nextCursor, generation: generation) else { return }
            messages += page.items
            self.nextCursor = page.nextCursor
        } catch { if generation == loadGeneration, feedback == feedbackGeneration { self.error = error.localizedDescription } }
    }

    /// A read acknowledgement commits before the next server snapshot. If it arrived
    /// while this page was in flight, ask for the same page again rather than applying
    /// a snapshot that can resurrect a just-read message in the unread filter.
    private func currentPage(
        using model: any MailStoreAPI,
        box requestedBox: Box,
        query: String,
        cursor: String?,
        generation: Int
    ) async throws -> MailMessagePage? {
        while !Task.isCancelled {
            let revision = readRevision
            let page = try await model.mailMessages(box: requestedBox.rawValue, query: query, cursor: cursor, unreadOnly: requestedBox == .inbox && unreadOnly)
            guard generation == loadGeneration, box == requestedBox else { return nil }
            if revision == readRevision { return page }
        }
        return nil
    }

    private func currentCounts(using model: any MailStoreAPI, box requestedBox: Box, generation: Int) async throws -> MailCounts? {
        while !Task.isCancelled {
            let revision = readRevision
            let latest = try await model.mailCounts()
            guard generation == loadGeneration, box == requestedBox else { return nil }
            if revision == readRevision { return latest }
        }
        return nil
    }

    func open(id: String, using model: any MailStoreAPI) async -> Bool {
        openGeneration += 1
        let generation = openGeneration
        let feedback = beginFeedback()
        let readOperation = latestReadOperation[id] ?? 0
        let readAllOperation = latestReadAllOperation
        loadingContext = false
        error = nil
        do {
            let received = try await model.mailMessage(id: id)
            guard generation == openGeneration else { return true }
            let incoming = box == .inbox
            let latestOperation = latestReadOperation[id] ?? 0
            let readChanged = max(latestOperation, incoming ? latestReadAllOperation : 0)
                > max(readOperation, incoming ? readAllOperation : 0)
            let message: MailMessage
            if readChanged {
                // The GET's body remains useful, but a successful action while it
                // waited owns the read state and must not trigger another auto-read.
                let readAt: String?
                if incoming, latestReadAllOperation >= latestOperation {
                    readAt = ISO8601DateFormatter().string(from: Date())
                } else if let current = detail, current.messageId == id {
                    readAt = current.readAt
                } else if let current = messages.first(where: { $0.messageId == id }) {
                    readAt = current.readAt
                } else {
                    readAt = received.readAt
                }
                message = replacingReadState(received, readAt: readAt)
            } else {
                message = received
            }
            detail = message
            context = []
            nextContextCursor = nil
            contextError = nil
            if !readChanged, incoming, message.readAt == nil {
                let operation = beginReadOperation()
                do {
                    try await model.mailSetRead(id: id, read: true)
                    applyReadState(id: id, readAt: ISO8601DateFormatter().string(from: Date()), operation: operation)
                } catch { if generation == openGeneration, feedback == feedbackGeneration { self.error = error.localizedDescription } }
            }
            if !message.legacyFormat {
                do {
                    let page = try await model.mailContext(id: id, cursor: nil)
                    guard generation == openGeneration else { return true }
                    context = page.items
                    nextContextCursor = page.nextCursor
                } catch { if generation == openGeneration { contextError = error.localizedDescription } }
            }
            return true
        } catch {
            guard generation == openGeneration else { return true }
            detail = nil
            context = []
            nextContextCursor = nil
            contextError = nil
            if feedback == feedbackGeneration { self.error = error.localizedDescription }
            return (error as? APIError)?.status != 404
        }
    }

    func loadMoreContext(id: String, using model: any MailStoreAPI) async {
        guard detail?.messageId == id, let cursor = nextContextCursor, !loadingContext else { return }
        let generation = openGeneration
        loadingContext = true
        contextError = nil
        defer { if generation == openGeneration { loadingContext = false } }
        do {
            let page = try await model.mailContext(id: id, cursor: cursor)
            guard generation == openGeneration, detail?.messageId == id, nextContextCursor == cursor else { return }
            var known = Set(context.map(\.messageId))
            context = page.items.filter { known.insert($0.messageId).inserted } + context
            nextContextCursor = page.nextCursor
        } catch { if generation == openGeneration, detail?.messageId == id { contextError = error.localizedDescription } }
    }

    func setRead(id: String, read: Bool, using model: any MailStoreAPI) async {
        let feedback = beginFeedback()
        let detailGeneration = openGeneration
        let operation = beginReadOperation()
        do {
            try await model.mailSetRead(id: id, read: read)
            applyReadState(id: id, readAt: read ? ISO8601DateFormatter().string(from: Date()) : nil, operation: operation)
            if detailGeneration == openGeneration, feedback == feedbackGeneration { error = nil }
        }
        catch { if detailGeneration == openGeneration, feedback == feedbackGeneration { self.error = error.localizedDescription } }
    }

    private func applyReadState(id: String, readAt: String?, operation: Int) {
        readRevision += 1
        // A late acknowledgement cannot undo a newer successful read of this mail.
        // Other messages and failed newer attempts do not suppress its valid update.
        guard operation >= latestReadAllOperation,
              operation >= (latestReadOperation[id] ?? 0) else { return }
        latestReadOperation[id] = operation
        let previousUnread: Bool?
        if let message = detail, message.messageId == id, box == .inbox {
            previousUnread = message.readAt == nil
        } else if box == .inbox, let message = messages.first(where: { $0.messageId == id }) {
            previousUnread = message.readAt == nil
        } else {
            previousUnread = nil
        }
        if let previousUnread, previousUnread != (readAt == nil), let counts {
            self.counts = MailCounts(inboxTotal: counts.inboxTotal, sentTotal: counts.sentTotal, unread: max(0, counts.unread + (readAt == nil ? 1 : -1)))
        }
        messages = messages.map { item in
            guard item.messageId == id else { return item }
            return MailSummary(messageId: item.messageId, kind: item.kind, sender: item.sender, recipients: item.recipients, toRecipients: item.toRecipients, ccRecipients: item.ccRecipients, toAddresses: item.toAddresses, ccAddresses: item.ccAddresses, relationKind: item.relationKind, subject: item.subject, snippet: item.snippet, sentAt: item.sentAt, readAt: readAt, attachmentCount: item.attachmentCount)
        }
        if box == .inbox, unreadOnly, readAt != nil {
            messages.removeAll { $0.messageId == id }
        }
        if let message = detail, message.messageId == id {
            detail = replacingReadState(message, readAt: readAt)
        }
    }

    private func replacingReadState(_ message: MailMessage, readAt: String?) -> MailMessage {
        MailMessage(messageId: message.messageId, kind: message.kind, viewerId: message.viewerId, sender: message.sender, recipients: message.recipients, toRecipients: message.toRecipients, ccRecipients: message.ccRecipients, toAddresses: message.toAddresses, ccAddresses: message.ccAddresses, relationKind: message.relationKind, subject: message.subject, body: message.body, sentAt: message.sentAt, readAt: readAt, replyToId: message.replyToId, conversationId: message.conversationId, relation: message.relation, quote: message.quote, attachments: message.attachments, legacyFormat: message.legacyFormat)
    }

    func delete(id: String, using model: any MailStoreAPI) async -> Bool {
        let generation = openGeneration
        let feedback = beginFeedback()
        do {
            try await model.mailDelete(id: id, box: box.rawValue)
            clearDeletedDetail(ids: [id], generation: generation)
            _ = await load(using: model, query: loadedQuery, feedback: feedback)
            return true
        } catch {
            if generation == openGeneration, feedback == feedbackGeneration { self.error = error.localizedDescription }
            return false
        }
    }

    func readAll(using model: any MailStoreAPI) async {
        let account = model.accountIdentityGeneration
        let generation = openGeneration
        let revision = readRevision
        guard model.isCurrentAccount(account), !Task.isCancelled else { return }
        let feedback = beginFeedback()
        let operation = beginReadOperation()
        do {
            _ = try await model.mailReadAll()
            guard model.isCurrentAccount(account), !Task.isCancelled else { return }
            latestReadAllOperation = max(latestReadAllOperation, operation)
            if generation == openGeneration, revision == readRevision,
               let message = detail, box == .inbox {
                applyReadState(id: message.messageId, readAt: ISO8601DateFormatter().string(from: Date()), operation: operation)
            } else {
                readRevision += 1
            }
            _ = await load(using: model, query: loadedQuery, feedback: feedback)
        } catch { if model.isCurrentAccount(account), feedback == feedbackGeneration { self.error = error.localizedDescription } }
    }

    func deleteBatch(ids: [String], using model: any MailStoreAPI) async -> Bool {
        let generation = openGeneration
        let account = model.accountIdentityGeneration
        guard model.isCurrentAccount(account), !Task.isCancelled else { return false }
        let feedback = beginFeedback()
        do {
            var skipped = 0
            var deletedIds = Set(ids)
            for start in stride(from: 0, to: ids.count, by: 100) {
                guard model.isCurrentAccount(account), !Task.isCancelled else { return false }
                let result = try await model.mailDeleteBatch(ids: Array(ids[start..<min(start + 100, ids.count)]), box: box.rawValue)
                guard model.isCurrentAccount(account), !Task.isCancelled else { return false }
                skipped += result.skippedIds?.count ?? 0
                deletedIds.subtract(result.skippedIds ?? [])
            }
            clearDeletedDetail(ids: deletedIds, generation: generation)
            let canReportFeedback = await load(using: model, query: loadedQuery, feedback: feedback)
            guard model.isCurrentAccount(account), !Task.isCancelled else { return false }
            if skipped > 0, canReportFeedback, feedback == feedbackGeneration { error = "\(skipped) 封信件未处理" }
            return true
        } catch {
            guard model.isCurrentAccount(account), !Task.isCancelled else { return false }
            let canReportFeedback = await load(using: model, query: loadedQuery, feedback: feedback)
            guard model.isCurrentAccount(account), !Task.isCancelled else { return false }
            if canReportFeedback, feedback == feedbackGeneration { self.error = error.localizedDescription }
            return false
        }
    }

    func deleteAll(box targetBox: String, using model: any MailStoreAPI) async -> Bool {
        let generation = openGeneration
        let feedback = beginFeedback()
        do {
            let result = try await model.mailDeleteAll(box: targetBox)
            if box.rawValue == targetBox, let id = detail?.messageId, !(result.skippedIds ?? []).contains(id) {
                clearDeletedDetail(ids: [id], generation: generation)
            }
            _ = await load(using: model, query: loadedQuery, feedback: feedback)
            return true
        }
        catch {
            if feedback == feedbackGeneration { self.error = error.localizedDescription }
            return false
        }
    }

    private func clearDeletedDetail(ids: Set<String>, generation: Int) {
        guard generation == openGeneration, let id = detail?.messageId, ids.contains(id) else { return }
        openGeneration += 1
        detail = nil
        context = []
        nextContextCursor = nil
        contextError = nil
        loadingContext = false
    }
}
