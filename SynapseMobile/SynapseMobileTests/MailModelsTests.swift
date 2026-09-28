import Foundation
import Testing
@testable import SynapseMobile

struct MailModelsTests {
    @Test func decodesGroupedRecipientsAndDirectSourceQuote() throws {
        let json = """
        {
          "messageId":"reply-1", "viewerId":"reader",
          "sender":{"userId":"sender","nickname":"发件人","handle":null},
          "recipients":[{"userId":"reader","nickname":"收件人","handle":null},{"userId":"observer","nickname":"抄送人","handle":null}],
          "toRecipients":[{"userId":"reader","nickname":"收件人","handle":null}],
          "ccRecipients":[{"userId":"observer","nickname":"抄送人","handle":null}],
          "relationKind":"reply", "subject":"回复：原信", "body":"回复正文",
          "sentAt":"2026-09-28T08:00:00.000Z", "readAt":null,
          "replyToId":"original", "conversationId":"conversation-1",
          "relation":{"kind":"reply","messageId":"original"},
          "quote":{"sender":{"userId":"observer","nickname":"原发件人","handle":null},"toRecipients":[{"userId":"sender","nickname":"发件人","handle":null}],"ccRecipients":[],"subject":"原信","body":"原文","sentAt":"2026-09-27T08:00:00.000Z"},
          "attachments":[]
        }
        """
        let message = try JSONDecoder().decode(MailMessage.self, from: Data(json.utf8))
        #expect(message.toRecipients.map(\.userId) == ["reader"])
        #expect(message.ccRecipients.map(\.userId) == ["observer"])
        #expect(message.quote?.body == "原文")
        #expect(message.relation?.messageId == "original")
        #expect(!message.legacyFormat)
    }

    @Test func encodesVersionedForwardWithSelectedAttachments() throws {
        let content = MailContent(formatVersion: 2, toIds: ["new-reader"], ccIds: [], subject: "转发：原信", body: "", attachmentIds: ["new-file"], forwardAttachmentIds: ["original-file"], relation: MailRelation(kind: "forward", messageId: "original"))
        let data = try JSONEncoder().encode(content)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["formatVersion"] as? Int == 2)
        #expect(object["toIds"] as? [String] == ["new-reader"])
        #expect(object["forwardAttachmentIds"] as? [String] == ["original-file"])
        #expect((object["relation"] as? [String: String])?["kind"] == "forward")
    }

    @Test func readsOldServerMailWithoutInventingRelations() throws {
        let summary = """
        {"messageId":"old-1","sender":{"userId":"sender","nickname":null,"handle":"sender"},
         "recipients":[{"userId":"reader","nickname":null,"handle":"reader"}],
         "subject":"原信","snippet":"正文","sentAt":"2026-09-27T08:00:00.000Z","readAt":null,"attachmentCount":0}
        """
        let page = try JSONDecoder().decode(MailMessagePage.self, from: Data("{\"items\":[\(summary)],\"nextCursor\":null}".utf8))
        #expect(page.items[0].toRecipients.map(\.userId) == ["reader"])
        #expect(page.items[0].ccRecipients.isEmpty)
        #expect(page.items[0].relationKind == nil)

        let object = try #require(JSONSerialization.jsonObject(with: Data(summary.utf8)) as? [String: Any])
        var detail = object
        detail["viewerId"] = "reader"
        detail["body"] = "正文"
        detail["team"] = ["id": "team-1", "name": "团队"]
        detail["replyToId"] = "previous-mail"
        detail["attachments"] = []
        let data = try JSONSerialization.data(withJSONObject: detail)
        let message = try JSONDecoder().decode(MailMessage.self, from: data)
        #expect(message.legacyFormat)
        #expect(message.relation == nil)
        #expect(message.quote == nil)
        #expect(message.toRecipients.map(\.userId) == ["reader"])
    }

    @Test func rejectsPartiallyUpgradedSummary() throws {
        let json = """
        {"messageId":"mail-1","sender":{"userId":"sender","nickname":null,"handle":null},
         "recipients":[],"toRecipients":[],"subject":"原信","snippet":"正文",
         "sentAt":"2026-09-27T08:00:00.000Z","readAt":null,"attachmentCount":0}
        """
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(MailSummary.self, from: Data(json.utf8))
        }
    }
}
