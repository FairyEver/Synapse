import Foundation
import Testing
import UserNotifications

@testable import SynapseMobile

/// 点按复制这条路上唯一需要判断的东西：这一次点按要不要复制，复制什么。
///
/// 提出来测，是因为 delegate 那个方法跑在还没有 scene 的时刻，既难构造也难断言，
/// 而「字符串 `"false"` 算不算真」「动作按钮算不算点按」恰恰是最容易写错的两格。
@MainActor
struct NotificationTapCopyTests {
    @Test func copiesTheBodyOnAPlainTap() {
        let body = NotificationTapCopy.body(
            from: ["copyOnTap": true],
            contentBody: "四是四，十是十",
            actionIdentifier: UNNotificationDefaultActionIdentifier
        )
        #expect(body == "四是四，十是十")
    }

    @Test func ignoresAnythingButABooleanTrue() {
        for value in ["true", "1", "false", 1, 0] as [Any] {
            let body = NotificationTapCopy.body(
                from: ["copyOnTap": value],
                contentBody: "正文",
                actionIdentifier: UNNotificationDefaultActionIdentifier
            )
            #expect(body == nil, "copyOnTap = \(value) 不该被当成真")
        }
    }

    @Test func ignoresEverythingWhenTheFlagIsAbsentOrFalse() {
        #expect(NotificationTapCopy.body(from: [:], contentBody: "正文", actionIdentifier: UNNotificationDefaultActionIdentifier) == nil)
        #expect(NotificationTapCopy.body(from: ["copyOnTap": false], contentBody: "正文", actionIdentifier: UNNotificationDefaultActionIdentifier) == nil)
    }

    @Test func ignoresAnActionButton() {
        // 「允许一次」「拒绝」这类动作按钮不是「点开看看」，不该往剪贴板里塞东西。
        let body = NotificationTapCopy.body(
            from: ["copyOnTap": true],
            contentBody: "正文",
            actionIdentifier: "TERMINAL_APPROVE"
        )
        #expect(body == nil)
    }

    @Test func theCopiedNoticeIsConsumedExactlyOnce() {
        let router = NotificationRouter.shared
        router.discard()
        router.noteCopiedBody()
        #expect(router.consumeCopiedBody())
        #expect(!router.consumeCopiedBody())
    }
}
