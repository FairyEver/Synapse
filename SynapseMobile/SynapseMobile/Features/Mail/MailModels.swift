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
}

struct MailMessagePage: Decodable { let items: [MailSummary]; let nextCursor: String? }

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
