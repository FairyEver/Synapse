import Foundation
import Testing
@testable import SynapseMobile

/// 一条通知点下去该去哪。
///
/// 站内信、终端和录音有确切去处；外部接口发来的普通消息没有 —— 它该留在原地
/// 让人读，而不是把人送到一个不存在的地方去。
struct NotificationDestinationTests {
    @Test func discussionSnapshotKeepsFullTitleAndLiteralContext() throws {
        let raw = #"{"id":"n1","source":"drive-discussion","title":"短标题","body":"摘要","level":"active","createdAt":"2026-10-13T00:00:00Z","driveDiscussion":{"kind":"annotation","action":"replied","snapshot":{"detailTitle":"完整文档标题","content":"回复内容","original":{"kind":"text","text":"原文"},"replyTo":{"authorName":"李四","content":"原评论"}}}}"#
        let item = try JSONDecoder().decode(SynapseNotification.self, from: Data(raw.utf8))
        #expect(NotificationText.detailTitle(item) == "完整文档标题")
        #expect(NotificationText.displayTitle(item) == "短标题")
        #expect(item.driveDiscussion?.snapshot?.original?.text == "原文")
        #expect(item.driveDiscussion?.snapshot?.replyTo?.authorName == "李四")
        #expect(NotificationText.discussionContentLabel(item) == "回复")
        #expect(NotificationDestination.requiresFreshRead(item))
    }

    @Test func malformedSnapshotDoesNotDiscardTheNotificationOrItsAction() throws {
        let raw = #"{"id":"n1","source":"drive-discussion","title":"标题","body":"旧摘要","level":"active","createdAt":"2026-10-13T00:00:00Z","driveDiscussion":{"kind":"message","action":"created","snapshot":{"detailTitle":123,"content":null}}}"#
        let item = try JSONDecoder().decode(SynapseNotification.self, from: Data(raw.utf8))
        #expect(item.driveDiscussion?.snapshot == nil)
        #expect(NotificationText.detailTitle(item) == "标题")
        #expect(NotificationText.discussionContentLabel(item) == "文末留言")
        #expect(NotificationDestination.actionLabel(for: item) == "查看留言")
    }

    @Test func discussionListAndPushUseTheSameNotificationIDEntry() {
        let item = notification(source: "drive-discussion", targetId: "cached", deviceId: nil, url: "https://outside.example/forged")
        #expect(NotificationDestination.requiresFreshRead(item))
        #expect(NotificationDestination.resolve(item, origin: URL(string: "https://synapse.test")!) == .externalURL(URL(string: "https://synapse.test/notifications/n1/open")!))
        #expect(NotificationDestination.actionLabel(for: item) == "查看文档")
    }

    @Test func optionalMetadataKeepsOldAndUnknownPayloadsReadable() throws {
        let raw = #"{"id":"n1","source":"drive-discussion","title":"标题","body":"摘要","level":"active","createdAt":"2026-10-12T00:00:00Z"}"#
        let old = try JSONDecoder().decode(SynapseNotification.self, from: Data(raw.utf8))
        #expect(old.driveDiscussion == nil)
        for field in ["null", #"{"kind":"unknown","action":"created"}"#, #"{"kind":"message","action":"unknown"}"#] {
            let value = String(raw.dropLast()) + ",\"driveDiscussion\":\(field)}"
            let item = try JSONDecoder().decode(SynapseNotification.self, from: Data(value.utf8))
            #expect(NotificationDestination.actionLabel(for: item) == "查看文档")
        }
    }

    @Test(arguments: [("annotation", "created", "查看评论"), ("message", "created", "查看留言"), ("annotation", "replied", "查看回复"), ("message", "replied", "查看回复")])
    func discussionActionsDescribeTheExactTarget(values: (String, String, String)) throws {
        let raw = "{\"id\":\"n1\",\"source\":\"drive-discussion\",\"title\":\"标题\",\"body\":\"摘要\",\"level\":\"active\",\"createdAt\":\"2026-10-12T00:00:00Z\",\"driveDiscussion\":{\"kind\":\"\(values.0)\",\"action\":\"\(values.1)\"}}"
        let item = try JSONDecoder().decode(SynapseNotification.self, from: Data(raw.utf8))
        #expect(NotificationDestination.actionLabel(for: item) == values.2)
        #expect(NotificationText.groupLabel(for: item) == "云盘")
    }

    /// 终端待处理和终端完成都指回那台电脑上的那个会话。`deviceId` 为空串是既有约定：
    /// 老桌面端发的通知不带电脑 id，而路由那边认空串为「没指名电脑」。
    @Test func aTerminalNotificationGoesToItsSession() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-attention", targetId: "s1", deviceId: "d1", url: nil)
        )
        #expect(outcome == .route(.terminal(sessionId: "s1", desktopClientInstanceId: "d1", entry: .inboxRecord)))
    }

    @Test func aCompletedTerminalNotificationGoesToTheSamePlace() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-complete", targetId: "s2", deviceId: "d1", url: nil)
        )
        #expect(outcome == .route(.terminal(sessionId: "s2", desktopClientInstanceId: "d1", entry: .inboxRecord)))
    }

    /// 一条没记着是哪台电脑的终端通知。空串而不是崩溃 —— 路由那边把空串读成
    /// 「没指名电脑」，会退回当前看着的那一台。
    @Test func aTerminalNotificationWithoutADeviceIsStillRouted() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-attention", targetId: "s1", deviceId: nil, url: nil)
        )
        #expect(outcome == .route(.terminal(sessionId: "s1", desktopClientInstanceId: "", entry: .inboxRecord)))
    }

    /// 转写在服务端，不依赖任何一台电脑。
    @Test func aTranscriptionNotificationGoesToTheRecording() {
        let outcome = NotificationDestination.resolve(
            notification(source: "meeting-transcription", targetId: "m1", deviceId: nil, url: nil)
        )
        #expect(outcome == .route(.meeting(meetingId: "m1")))
    }

    @Test func aMailNotificationGoesToTheMessage() {
        let outcome = NotificationDestination.resolve(
            notification(source: "mail-internal", targetId: "mail-1", deviceId: nil, url: "synapse://mail/mail-1")
        )
        #expect(outcome == .route(.mail(messageId: "mail-1")))
    }

    /// 源对了但没有 target：无从去起，就是没有去处。
    @Test func aTerminalNotificationWithoutATargetGoesNowhere() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-attention", targetId: nil, deviceId: "d1", url: nil)
        )
        #expect(outcome == .none)
    }

    /// 外部接口发来的消息带一条 HTTPS 链接。它交给 `openURL`，**不进路由** ——
    /// 它不是应用里的一个位置。
    @Test func anHTTPSUrlIsOpenedNotRouted() {
        let outcome = NotificationDestination.resolve(
            notification(source: "external", targetId: nil, deviceId: nil, url: "https://synapse.d2.pub/x")
        )
        #expect(outcome == .externalURL(URL(string: "https://synapse.d2.pub/x")!))
    }

    /// 非 HTTPS 的链接不打开。这是既有行为（`NotificationDetailView` 就只认 https），
    /// 不是本次新增的限制。
    @Test func aNonHTTPSUrlGoesNowhere() {
        let outcome = NotificationDestination.resolve(
            notification(source: "external", targetId: nil, deviceId: nil, url: "http://example.com/x")
        )
        #expect(outcome == .none)
    }

    @Test func aPlainNotificationGoesNowhere() {
        let outcome = NotificationDestination.resolve(
            notification(source: "external", targetId: nil, deviceId: nil, url: nil)
        )
        #expect(outcome == .none)
    }

    @Test func rowActionNamesDescribeTheDestination() {
        #expect(NotificationDestination.actionLabel(for: notification(source: "terminal-attention", targetId: "s1", deviceId: "d1", url: nil)) == "打开终端")
        #expect(NotificationDestination.actionLabel(for: notification(source: "meeting-transcription", targetId: "m1", deviceId: nil, url: nil)) == "查看转写")
        #expect(NotificationDestination.actionLabel(for: notification(source: "mail-internal", targetId: "mail-1", deviceId: nil, url: nil)) == "查看站内信")
        #expect(NotificationDestination.actionLabel(for: notification(source: "external", targetId: nil, deviceId: nil, url: nil)) == "查看通知")
    }

    @Test func todoUsesTrustedSourceAndTargetWithoutAComputer() {
        let item = notification(source: "todo-reminder", targetId: "todo_1", deviceId: nil, url: "synapse://todos/other?completed=true")
        #expect(NotificationDestination.resolve(item) == .route(.todo(id: "todo_1")))
        #expect(NotificationDestination.actionLabel(for: item) == "查看待办")
        #expect(NotificationDestination.resolve(notification(source: "external", targetId: "todo_1", deviceId: nil, url: "synapse://todos/todo_1")) == .none)
        #expect(NotificationDestination.resolve(notification(source: "todo-reminder", targetId: "a/b", deviceId: nil, url: nil)) == .none)
    }

    // MARK: - Fixtures

    private func notification(
        source: String,
        targetId: String?,
        deviceId: String?,
        url: String?
    ) -> SynapseNotification {
        SynapseNotification(
            id: "n1",
            source: source,
            title: "标题",
            body: "正文",
            group: nil,
            url: url,
            level: "active",
            targetId: targetId,
            deviceId: deviceId,
            readAt: nil,
            resolvedAt: nil,
            createdAt: "2026-09-25T00:00:00.000Z"
        )
    }
}
