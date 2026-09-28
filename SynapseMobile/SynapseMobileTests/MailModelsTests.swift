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
}
