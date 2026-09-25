import Foundation
import Testing
@testable import SynapseMobile

/// 一条通知点下去该去哪。
///
/// 四种来源里三种有确切去处，第四种（外部接口发来的普通消息）没有 —— 它该留在原地
/// 让人读，而不是把人送到一个不存在的地方去。
struct NotificationDestinationTests {

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
