import Foundation
import Testing

@testable import SynapseMobile

/// 「复制正文」取的是不是用户看到的那一段。
///
/// 与桌面同一条标准：详情页上摊开成什么样，复制到的就是什么样。云盘互动那条通知在页面上
/// 是三段，复制成摘要就会和用户读到的话对不上。
@MainActor
struct NotificationDetailTextTests {
    private func notification(
        source: String = "system-notifier",
        body: String = "正文",
        driveDiscussion: DriveDiscussionNotificationMetadata? = nil
    ) -> SynapseNotification {
        SynapseNotification(
            id: "n1", source: source, title: "标题", body: body, group: nil, url: nil,
            level: "active", targetId: nil, deviceId: nil, readAt: nil, resolvedAt: nil,
            createdAt: "2026-10-15T08:00:00.000Z", driveDiscussion: driveDiscussion
        )
    }

    @Test func copiesThePlainBody() {
        #expect(NotificationDetailText.value(for: notification()) == "正文")
    }

    @Test func joinsTheDiscussionSnapshotInTheOrderThePageShowsIt() {
        let item = notification(
            source: "drive-discussion",
            driveDiscussion: DriveDiscussionNotificationMetadata(
                kind: "annotation",
                action: "replied",
                snapshot: .init(detailTitle: "文档标题", content: "本次回复", original: .init(kind: "text", text: "原文"), replyTo: .init(authorName: "某人", content: "被回复的内容"))
            )
        )
        #expect(NotificationDetailText.value(for: item) == "评论原文\n原文\n\n回复对象 · 某人\n被回复的内容\n\n回复\n本次回复")
    }

    @Test func fallsBackToTheBodyWhenTheSnapshotIsMissing() {
        let item = notification(source: "drive-discussion", driveDiscussion: DriveDiscussionNotificationMetadata(kind: "annotation", action: "created"))
        #expect(NotificationDetailText.value(for: item) == "正文")
    }
}
