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

    func load(using model: SynapseAppModel, query: String = "") async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            if box == .drafts {
                drafts = try await model.mailDrafts().items
                messages = []
                nextCursor = nil
            } else {
                let page = try await model.mailMessages(box: box.rawValue, query: query)
                messages = page.items
                drafts = []
                nextCursor = page.nextCursor
            }
        } catch { self.error = error.localizedDescription }
    }

    func loadMore(using model: SynapseAppModel, query: String = "") async {
        guard box != .drafts, let nextCursor, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let page = try await model.mailMessages(box: box.rawValue, query: query, cursor: nextCursor)
            messages += page.items
            self.nextCursor = page.nextCursor
        } catch { self.error = error.localizedDescription }
    }

    func open(id: String, using model: SynapseAppModel) async {
        do {
            let message = try await model.mailMessage(id: id)
            detail = message
            if box == .inbox && message.readAt == nil {
                try await model.mailSetRead(id: id, read: true)
                messages = messages.map { item in
                    guard item.messageId == id else { return item }
                    return MailSummary(messageId: item.messageId, sender: item.sender, recipients: item.recipients, subject: item.subject, snippet: item.snippet, sentAt: item.sentAt, readAt: ISO8601DateFormatter().string(from: Date()), attachmentCount: item.attachmentCount)
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    func setRead(id: String, read: Bool, using model: SynapseAppModel) async {
        do { try await model.mailSetRead(id: id, read: read); await load(using: model) }
        catch { self.error = error.localizedDescription }
    }

    func delete(id: String, using model: SynapseAppModel) async {
        do { try await model.mailDelete(id: id); detail = nil; await load(using: model) }
        catch { self.error = error.localizedDescription }
    }
}
