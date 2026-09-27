import Foundation
import Observation

@Observable @MainActor
final class MailStore {
    enum Box: String, CaseIterable, Identifiable {
        case inbox, sent, drafts
        var id: String { rawValue }
        var title: String {
            switch self { case .inbox: "收件箱"; case .sent: "已发送"; case .drafts: "草稿箱" }
        }
    }

    var box: Box = .inbox
    var messages: [MailSummary] = []
    var drafts: [MailDraft] = []
    var detail: MailMessage?
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
            if requestedBox == .drafts {
                let page = try await model.mailDrafts()
                guard generation == loadGeneration, box == requestedBox else { return }
                drafts = query.isEmpty ? page.items : page.items.filter { $0.subject.localizedCaseInsensitiveContains(query) || $0.body.localizedCaseInsensitiveContains(query) }
                messages = []
                nextCursor = nil
                loadedQuery = query
            } else {
                let page = try await model.mailMessages(box: requestedBox.rawValue, query: query)
                guard generation == loadGeneration, box == requestedBox else { return }
                messages = page.items
                drafts = []
                nextCursor = page.nextCursor
                loadedQuery = query
            }
        } catch { if generation == loadGeneration { self.error = error.localizedDescription } }
    }

    func loadMore(using model: SynapseAppModel, query: String = "") async {
        guard box != .drafts, query == loadedQuery, let nextCursor, !loading else { return }
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
            if box == .inbox && message.readAt == nil {
                try await model.mailSetRead(id: id, read: true)
                applyReadState(id: id, readAt: ISO8601DateFormatter().string(from: Date()))
            }
            return true
        } catch {
            guard generation == openGeneration else { return true }
            detail = nil
            self.error = error.localizedDescription
            return (error as? APIError)?.status != 404
        }
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
            return MailSummary(messageId: item.messageId, sender: item.sender, recipients: item.recipients, subject: item.subject, snippet: item.snippet, sentAt: item.sentAt, readAt: readAt, attachmentCount: item.attachmentCount)
        }
        if let message = detail, message.messageId == id {
            detail = MailMessage(messageId: message.messageId, viewerId: message.viewerId, sender: message.sender, recipients: message.recipients, subject: message.subject, body: message.body, sentAt: message.sentAt, readAt: readAt, replyToId: message.replyToId, attachments: message.attachments)
        }
    }

    func delete(id: String, using model: SynapseAppModel) async {
        do { try await model.mailDelete(id: id); detail = nil; await load(using: model) }
        catch { self.error = error.localizedDescription }
    }
}
