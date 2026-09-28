import Foundation
import Observation

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
    var loading = false
    var error: String?
    var nextCursor: String?
    private var loadGeneration = 0
    private var openGeneration = 0
    private var loadedQuery = ""

    func load(using model: SynapseAppModel, query: String = "") async {
        loadGeneration += 1
        let generation = loadGeneration
        let requestedBox = box
        loading = true
        error = nil
        defer { if generation == loadGeneration { loading = false } }
        do {
            let page = try await model.mailMessages(box: requestedBox.rawValue, query: query)
            guard generation == loadGeneration, box == requestedBox else { return }
            messages = page.items
            nextCursor = page.nextCursor
            loadedQuery = query
        } catch { if generation == loadGeneration { self.error = error.localizedDescription } }
    }

    func loadMore(using model: SynapseAppModel, query: String = "") async {
        guard query == loadedQuery, let nextCursor, !loading else { return }
        let requestedBox = box
        let generation = loadGeneration
        loading = true
        defer { if generation == loadGeneration { loading = false } }
        do {
            let page = try await model.mailMessages(box: requestedBox.rawValue, query: query, cursor: nextCursor)
            guard generation == loadGeneration, box == requestedBox else { return }
            messages += page.items
            self.nextCursor = page.nextCursor
        } catch { if generation == loadGeneration { self.error = error.localizedDescription } }
    }

    func open(id: String, using model: SynapseAppModel) async -> Bool {
        openGeneration += 1
        let generation = openGeneration
        do {
            let message = try await model.mailMessage(id: id)
            guard generation == openGeneration else { return true }
            detail = message
            context = []
            nextContextCursor = nil
            contextError = nil
            if message.sender.userId != message.viewerId && message.readAt == nil {
                do {
                    try await model.mailSetRead(id: id, read: true)
                    applyReadState(id: id, readAt: ISO8601DateFormatter().string(from: Date()))
                } catch { if generation == openGeneration { self.error = error.localizedDescription } }
            }
            if !message.legacyFormat {
                do {
                    let page = try await model.mailContext(id: id)
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
            self.error = error.localizedDescription
            return (error as? APIError)?.status != 404
        }
    }

    func loadMoreContext(id: String, using model: SynapseAppModel) async {
        guard let cursor = nextContextCursor else { return }
        do {
            let page = try await model.mailContext(id: id, cursor: cursor)
            guard detail?.messageId == id else { return }
            context = page.items + context
            nextContextCursor = page.nextCursor
        } catch { if detail?.messageId == id { contextError = error.localizedDescription } }
    }

    func setRead(id: String, read: Bool, using model: SynapseAppModel) async {
        do {
            try await model.mailSetRead(id: id, read: read)
            applyReadState(id: id, readAt: read ? ISO8601DateFormatter().string(from: Date()) : nil)
        }
        catch { self.error = error.localizedDescription }
    }

    private func applyReadState(id: String, readAt: String?) {
        messages = messages.map { item in
            guard item.messageId == id else { return item }
            return MailSummary(messageId: item.messageId, sender: item.sender, recipients: item.recipients, toRecipients: item.toRecipients, ccRecipients: item.ccRecipients, relationKind: item.relationKind, subject: item.subject, snippet: item.snippet, sentAt: item.sentAt, readAt: readAt, attachmentCount: item.attachmentCount)
        }
        if let message = detail, message.messageId == id {
            detail = MailMessage(messageId: message.messageId, viewerId: message.viewerId, sender: message.sender, recipients: message.recipients, toRecipients: message.toRecipients, ccRecipients: message.ccRecipients, relationKind: message.relationKind, subject: message.subject, body: message.body, sentAt: message.sentAt, readAt: readAt, replyToId: message.replyToId, conversationId: message.conversationId, relation: message.relation, quote: message.quote, attachments: message.attachments, legacyFormat: message.legacyFormat)
        }
    }

    func delete(id: String, using model: SynapseAppModel) async {
        do { try await model.mailDelete(id: id); detail = nil; await load(using: model) }
        catch { self.error = error.localizedDescription }
    }
}
