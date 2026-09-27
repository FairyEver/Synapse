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

struct MailRecipientPage: Decodable { let items: [MailRecipientCandidate] }

struct MailAttachment: Decodable, Identifiable {
    let attachmentId: String
    let fileName: String
    let mimeType: String?
    let size: Int
    let versionId: String?
    var id: String { attachmentId }
}

struct MailPreparedAttachment: Decodable {
    let attachmentId: String
    let attachmentToken: String
    let fileName: String
    let mimeType: String?
    let size: Int
    let versionId: String?
    let state: String
    var attachment: MailAttachment { MailAttachment(attachmentId: attachmentId, fileName: fileName, mimeType: mimeType, size: size, versionId: versionId) }
}

struct MailSummary: Decodable, Identifiable {
    let messageId: String
    let sender: MailPerson
    let recipients: [MailPerson]
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
    let subject: String
    let body: String
    let sentAt: String
    let readAt: String?
    let replyToId: String?
    let attachments: [MailAttachment]
}

struct MailMessagePage: Decodable { let items: [MailSummary]; let nextCursor: String? }

struct MailContent: Encodable, Equatable {
    let recipientIds: [String]
    let subject: String
    let body: String
    let attachmentIds: [String]
    let replyToId: String?
}

struct MailPreview: Decodable {
    let previewId: String
    let expiresAt: String
    let recipients: [MailPerson]
    let subject: String
    let body: String
    let attachments: [MailAttachment]
}

struct MailReceipt: Decodable { let messageId: String; let recipientIds: [String]; let sentAt: String }

struct MailDraft: Decodable, Identifiable {
    let draftId: String
    let recipientIds: [String]
    let subject: String
    let body: String
    let attachmentIds: [String]
    let attachments: [MailAttachment]?
    let replyToId: String?
    let version: Int
    let updatedAt: String
    var id: String { draftId }
}

struct MailDraftPage: Decodable { let items: [MailDraft] }
