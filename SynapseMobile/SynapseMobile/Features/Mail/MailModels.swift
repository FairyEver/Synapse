import Foundation

struct MailPerson: Decodable, Identifiable, Hashable {
    let userId: String
    let nickname: String?
    let handle: String?
    var id: String { userId }
    var name: String { nickname ?? handle ?? userId }
}

struct MailRecipientCandidate: Decodable, Identifiable {
    let userId: String
    let nickname: String?
    let handle: String?
    let matchKind: String
    let similarity: Double
    let sharedTeamIds: [String]
    var id: String { userId }
    var name: String { nickname ?? handle ?? userId }
    var person: MailPerson { MailPerson(userId: userId, nickname: nickname, handle: handle) }
}

struct MailRecipientPage: Decodable { let items: [MailRecipientCandidate]; let nextCursor: String? }

struct MailAttachment: Decodable, Identifiable {
    let attachmentId: String
    let fileName: String
    let mimeType: String?
    let size: Int
    var id: String { attachmentId }
}

struct MailRelation: Codable, Equatable {
    let kind: String
    let messageId: String
}

struct MailQuote: Decodable {
    let sender: MailPerson
    let toRecipients: [MailPerson]
    let ccRecipients: [MailPerson]
    let subject: String
    let body: String
    let sentAt: String
}

struct MailPreparedAttachment: Decodable {
    let attachmentId: String
    let attachmentToken: String
    let fileName: String
    let mimeType: String?
    let size: Int
    let state: String
    var attachment: MailAttachment { MailAttachment(attachmentId: attachmentId, fileName: fileName, mimeType: mimeType, size: size) }
}

struct MailSummary: Decodable, Identifiable {
    let messageId: String
    let sender: MailPerson
    let recipients: [MailPerson]
    let toRecipients: [MailPerson]
    let ccRecipients: [MailPerson]
    let relationKind: String?
    let subject: String
    let snippet: String
    let sentAt: String
    let readAt: String?
    let attachmentCount: Int
    var id: String { messageId }
}

private enum MailReadKey: String, CodingKey {
    case messageId, viewerId, sender, recipients, toRecipients, ccRecipients, relationKind
    case subject, snippet, body, sentAt, readAt, attachmentCount, replyToId, conversationId
    case relation, quote, attachments, team
}

extension MailSummary {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: MailReadKey.self)
        messageId = try values.decode(String.self, forKey: .messageId)
        sender = try values.decode(MailPerson.self, forKey: .sender)
        recipients = try values.decode([MailPerson].self, forKey: .recipients)
        let legacy = !values.contains(.toRecipients) && !values.contains(.ccRecipients) && !values.contains(.relationKind)
        toRecipients = legacy ? recipients : try values.decode([MailPerson].self, forKey: .toRecipients)
        ccRecipients = legacy ? [] : try values.decode([MailPerson].self, forKey: .ccRecipients)
        if !legacy && !values.contains(.relationKind) {
            throw DecodingError.keyNotFound(MailReadKey.relationKind, .init(codingPath: decoder.codingPath, debugDescription: "Missing relation kind"))
        }
        relationKind = try values.decodeIfPresent(String.self, forKey: .relationKind)
        subject = try values.decode(String.self, forKey: .subject)
        snippet = try values.decode(String.self, forKey: .snippet)
        sentAt = try values.decode(String.self, forKey: .sentAt)
        readAt = try values.decodeIfPresent(String.self, forKey: .readAt)
        attachmentCount = try values.decode(Int.self, forKey: .attachmentCount)
    }
}

struct MailMessage: Decodable {
    let messageId: String
    let viewerId: String
    let sender: MailPerson
    let recipients: [MailPerson]
    let toRecipients: [MailPerson]
    let ccRecipients: [MailPerson]
    let relationKind: String?
    let subject: String
    let body: String
    let sentAt: String
    let readAt: String?
    let replyToId: String?
    let conversationId: String
    let relation: MailRelation?
    let quote: MailQuote?
    let attachments: [MailAttachment]
    var legacyFormat = false
}

extension MailMessage {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: MailReadKey.self)
        let legacy = !values.contains(.toRecipients) && !values.contains(.ccRecipients) && !values.contains(.relationKind)
            && !values.contains(.conversationId) && !values.contains(.relation) && !values.contains(.quote)
        if !legacy, let missing = [MailReadKey.toRecipients, .ccRecipients, .relationKind, .conversationId, .relation, .quote].first(where: { !values.contains($0) }) {
            throw DecodingError.keyNotFound(missing, .init(codingPath: decoder.codingPath, debugDescription: "Missing mail field"))
        }
        let summary = try MailSummary(from: decoder)
        messageId = summary.messageId
        viewerId = try values.decode(String.self, forKey: .viewerId)
        sender = summary.sender
        recipients = summary.recipients
        toRecipients = summary.toRecipients
        ccRecipients = summary.ccRecipients
        relationKind = summary.relationKind
        subject = summary.subject
        body = try values.decode(String.self, forKey: .body)
        sentAt = summary.sentAt
        readAt = summary.readAt
        replyToId = try values.decodeIfPresent(String.self, forKey: .replyToId)
        conversationId = legacy ? messageId : try values.decode(String.self, forKey: .conversationId)
        relation = try values.decodeIfPresent(MailRelation.self, forKey: .relation)
        quote = try values.decodeIfPresent(MailQuote.self, forKey: .quote)
        attachments = try values.decode([MailAttachment].self, forKey: .attachments)
        legacyFormat = legacy
    }
}

struct MailMessagePage: Decodable { let items: [MailSummary]; let nextCursor: String? }
struct MailCounts: Decodable { let inboxTotal: Int; let sentTotal: Int; let unread: Int }
struct MailBulkReadResult: Decodable { let updated: Int }
struct MailBulkDeleteResult: Decodable { let deleted: Int; let skippedIds: [String]? }

struct MailContent: Encodable, Equatable {
    let formatVersion: Int
    let toIds: [String]
    let ccIds: [String]
    let subject: String
    let body: String
    let attachmentIds: [String]
    let forwardAttachmentIds: [String]
    let relation: MailRelation?
}

struct MailPreview: Decodable {
    let previewId: String
    let expiresAt: String
    let recipients: [MailPerson]
    let toRecipients: [MailPerson]
    let ccRecipients: [MailPerson]
    let subject: String
    let body: String
    let quote: MailQuote?
    let attachments: [MailAttachment]
}

struct MailReceipt: Decodable { let messageId: String; let recipientIds: [String]; let sentAt: String }
