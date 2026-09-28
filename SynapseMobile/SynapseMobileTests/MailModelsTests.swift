import Foundation
import Testing
@testable import SynapseMobile

struct MailModelsTests {
    @Test func preservesCrossPageSelectionAfterFailureAndKeepsClearScopeIndependentOfSearch() {
        var selection = MailBulkSelection()
        selection.begin()
        selection.toggle("first-page")
        selection.toggle("next-page")
        #expect(selection.ids == ["first-page", "next-page"])
        selection.finishDeletion(success: false)
        #expect(selection.isActive)
        #expect(selection.ids.count == 2)
        #expect(MailDeleteScope.selected(Array(selection.ids)).title.contains("2"))
        #expect(MailDeleteScope.all("inbox").explanation.contains("搜索结果和未加载的信件"))
        selection.finishDeletion(success: true)
        #expect(!selection.isActive)
        #expect(selection.ids.isEmpty)
    }

    @Test func decodesExactCountsAndPartialBulkDeleteResult() throws {
        let counts = try JSONDecoder().decode(MailCounts.self, from: Data(#"{"inboxTotal":7,"sentTotal":3,"unread":2}"#.utf8))
        let result = try JSONDecoder().decode(MailBulkDeleteResult.self, from: Data(#"{"deleted":1,"skippedIds":["hidden"]}"#.utf8))
        #expect(counts.inboxTotal == 7)
        #expect(counts.sentTotal == 3)
        #expect(counts.unread == 2)
        #expect(result.deleted == 1)
        #expect(result.skippedIds == ["hidden"])
    }
    @Test func decodesGroupedRecipientsAndDirectSourceQuote() throws {
        let json = """
        {
          "messageId":"reply-1", "viewerId":"reader",
          "sender":{"userId":"sender","nickname":"发件人","handle":null},
          "recipients":[{"userId":"reader","nickname":"收件人","handle":null},{"userId":"observer","nickname":"抄送人","handle":null}],
          "toRecipients":[{"userId":"reader","nickname":"收件人","handle":null}],
          "ccRecipients":[{"userId":"observer","nickname":"抄送人","handle":null}],
          "relationKind":"reply", "subject":"回复：原信", "snippet":"回复正文", "body":"回复正文",
          "sentAt":"2026-09-28T08:00:00.000Z", "readAt":null,
          "replyToId":"original", "conversationId":"conversation-1",
          "relation":{"kind":"reply","messageId":"original"},
          "quote":{"sender":{"userId":"observer","nickname":"原发件人","handle":null},"toRecipients":[{"userId":"sender","nickname":"发件人","handle":null}],"ccRecipients":[],"subject":"原信","body":"原文","sentAt":"2026-09-27T08:00:00.000Z"},
          "attachmentCount":0, "attachments":[]
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
        let content = MailContent(formatVersion: 3, toIds: ["new-reader"], ccIds: [], toOrganizationIds: [], ccOrganizationIds: [], subject: "转发：原信", body: "", attachmentIds: ["new-file"], forwardAttachmentIds: ["original-file"], relation: MailRelation(kind: "forward", messageId: "original"))
        let data = try JSONEncoder().encode(content)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["formatVersion"] as? Int == 3)
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
