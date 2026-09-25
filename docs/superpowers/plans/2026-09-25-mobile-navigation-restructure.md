# 手机端导航改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机端底栏从「终端 / 录音 / 消息 / 我的」四格收敛为「主页 / 终端 / 我的」三格，录音与剪贴板历史进入主页的「功能」清单，通知降级为主页右上角铃铛加覆盖面板，「我的」从平铺四段改为七个分类的二级下钻。

**Architecture:** 三格底栏由 `RootView` 的 `Tab` 枚举直接表达；主页是一个新的 `NavigationStack`，录音复用现有的 `AdaptiveFeatureNavigation` + `MeetingListView` / `MeetingDetailView`，剪贴板历史是 `ClipboardList` 的一层壳。通知面板是 `InboxView` 改造后的 `.sheet` 形态，行的去向由新抽出的 `NotificationDestination` 解析。`NotificationDetailView` 取消。「我的」的七个分类由扩到七项的 `SettingsCategory` 驱动，iPhone 与 iPadOS 走同一条 `AdaptiveFeatureNavigation` 路径。

**Tech Stack:** Swift 6 + SwiftUI，Swift Testing（`import Testing` / `@Test` / `#expect`）写单元测试，XCTest 写 UI 测试，Xcode 26.6，`IPHONEOS_DEPLOYMENT_TARGET = 18.0`。

**Spec:** `docs/superpowers/specs/2026-09-25-mobile-navigation-restructure-design.md`（本计划的每一条都能在那里找到出处；有冲突以 spec 为准）

## Global Constraints

- **底栏永远是三格，不因任何理由增加第四个。** 新增能力一律进「主页 → 功能」（spec §3.1）。
- **新建的 Swift 文件不需要改 `project.pbxproj`。** 工程用的是 `PBXFileSystemSynchronizedRootGroup`（`SynapseMobile/SynapseMobile.xcodeproj/project.pbxproj:77-114`），放进 `SynapseMobile/SynapseMobile/` 或 `SynapseMobile/SynapseMobileTests/` 目录即被自动纳入。
- **版本号同时留在两处。** 「关于」页新增一行，`Features/Terminal/TerminalScreen.swift:1131-1137` 的终端顶栏第二行**一个字不动**。
- **未读角标只有一种颜色：系统红。** 底栏用系统 `.badge`，不改颜色、不桥接 `UITabBarItem`；主页铃铛上自绘的那一枚也用 `Color(uiColor: .systemRed)` 配白字——两处读的是同一个数字，颜色不一致会被读成两套计数。琥珀 `Theme.attention` 只留给「有人在等你回话」（会话行的「等待输入」徽章、主页的待处理卡）。
- **不改**：终端画布 / 键盘 / 语音输入 / 网格上报（`Features/Terminal/TerminalScreen.swift` 除 `moreMenu` 引用点外不动）、录音会话生命周期、主机名与权限模型、任何服务端协议、`docs/agents/capability-registry.md:26` 的 iOS 两条深链路由（本改版不新增路由）。
- **不做**：开源许可页、「即将支持」分组、「功能」清单的分组、`SynapseMobile/README.md` 之外的文档站文案。
- 生产代码禁止 `print` 当日志；错误必须带上下文抛出或落到 `model.notice`。
- UI 用现有 `Theme` 语义色、系统 `List` / `NavigationSplitView` / `sheet` / `toolbar`，不新增硬编码颜色，不写解释性文案（spec §6.3 末条）。
- 每个 Task 结束提交一次，**只提交本 Task 的文件**（用显式路径，不用 `git add -A` —— 这个仓库常有并发的另一路改动）。
- 单元测试命令（在仓库根执行）：

  ```bash
  xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    -only-testing:SynapseMobileTests/<TestClassName>
  ```

  编译检查用同一命令的 `build` 子命令：

  ```bash
  xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
  ```

---

### Task 1: 通知去向解析（`NotificationDestination`）

把「一条通知点下去该去哪」从 `NotificationDetailView` 里抽成纯函数。详情页在本改版中取消，而这段判断有了两个消费者——通知面板里的行，和 `.message(id)` 深链。

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift`
- Test: `SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift`

**Interfaces:**
- Consumes: `SynapseNotification`（`Features/Inbox/NotificationStore.swift:4-17`，成员顺序 `id, source, title, body, group, url, level, targetId, deviceId, readAt, resolvedAt, createdAt`）、`NotificationRouter.Destination`（`Core/Push/NotificationRouter.swift:17-28`）
- Produces: `NotificationDestination.resolve(_ item: SynapseNotification) -> NotificationDestination.Outcome`；`Outcome` 三个 case：`.route(NotificationRouter.Destination)` / `.externalURL(URL)` / `.none`

- [ ] **Step 1: 写失败的测试**

创建 `SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift`：

```swift
import Foundation
import Testing
@testable import SynapseMobile

/// 一条通知点下去该去哪。
///
/// 四种来源里三种有确切去处，第四种（外部接口发来的普通消息）没有 —— 它该留在原地
/// 让人读，而不是把人送到一个不存在的地方去。
final class NotificationDestinationTests {

    /// 终端待处理和终端完成都指回那台电脑上的那个会话。`deviceId` 为空串是既有约定：
    /// 老桌面端发的通知不带电脑 id，而路由那边认空串为「没指名电脑」。
    @Test func aTerminalNotificationGoesToItsSession() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-attention", targetId: "s1", deviceId: "d1", url: nil)
        )
        #expect(outcome == .route(.terminal(sessionId: "s1", desktopClientInstanceId: "d1")))
    }

    @Test func aCompletedTerminalNotificationGoesToTheSamePlace() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-complete", targetId: "s2", deviceId: "d1", url: nil)
        )
        #expect(outcome == .route(.terminal(sessionId: "s2", desktopClientInstanceId: "d1")))
    }

    /// 一条没记着是哪台电脑的终端通知。空串而不是崩溃 —— 路由那边把空串读成
    /// 「没指名电脑」，会退回当前看着的那一台。
    @Test func aTerminalNotificationWithoutADeviceIsStillRouted() {
        let outcome = NotificationDestination.resolve(
            notification(source: "terminal-attention", targetId: "s1", deviceId: nil, url: nil)
        )
        #expect(outcome == .route(.terminal(sessionId: "s1", desktopClientInstanceId: "")))
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
```

- [ ] **Step 2: 运行测试，确认它失败**

Run:
```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/NotificationDestinationTests
```
Expected: 编译失败，`cannot find 'NotificationDestination' in scope`。

- [ ] **Step 3: 写实现**

创建 `SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift`：

```swift
import Foundation

/// 一条通知点下去该去哪。
///
/// 这段判断原本住在 `NotificationDetailView` 里。详情页随导航改版取消（通知的价值在
/// 「带你去哪」，不在「读它的全文」），而判断本身有了不止一个消费者 —— 通知面板里的行，
/// 以及 `.message(id)` 深链 —— 所以它得独立出来，不能跟着那一页一起消失。
///
/// 三个去向里只有第一个是应用里的位置。外部链接不是，它交给系统浏览器；没有去处的那一类
/// 留在原地让人读，这正是取消详情页之后它们的归宿。
enum NotificationDestination {

    enum Outcome: Equatable {
        /// 走 `NotificationRouter` 的路由。
        case route(NotificationRouter.Destination)
        /// 一条外部链接，交给 `openURL`。
        case externalURL(URL)
        /// 没有可去的地方。
        case none
    }

    static func resolve(_ item: SynapseNotification) -> Outcome {
        // 终端的两类来源指名同一个会话。`deviceId` 为空串是既有写法：老桌面端发的通知
        // 不带电脑 id，而路由那边把空串读成「没指名电脑」，会退回当前看着的那一台。
        if item.source == "terminal-attention" || item.source == "terminal-complete",
           let target = item.targetId {
            return .route(.terminal(
                sessionId: target,
                desktopClientInstanceId: item.deviceId ?? ""
            ))
        }
        // 转写结果在服务端，不依赖任何一台电脑。
        if item.source == "meeting-transcription", let target = item.targetId {
            return .route(.meeting(meetingId: target))
        }
        // 只有 HTTPS 打开。这一条沿用的是详情页里那个判断，不是新加的限制。
        if let raw = item.url, let url = URL(string: raw), url.scheme == "https" {
            return .externalURL(url)
        }
        return .none
    }
}
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: 同 Step 2 的命令
Expected: `Executed 8 tests, with 0 failures`。

- [ ] **Step 5: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Inbox/NotificationDestination.swift \
        SynapseMobile/SynapseMobileTests/NotificationDestinationTests.swift
git commit -m "refactor: 把通知去向的判断从详情页抽成独立的解析函数"
```

---

### Task 2: 图标角标开关（`NotificationBadgePreference`）

**Files:**
- Create: `SynapseMobile/SynapseMobile/Core/Notifications/NotificationBadgePreference.swift`
- Test: `SynapseMobile/SynapseMobileTests/NotificationBadgePreferenceTests.swift`

**Interfaces:**
- Consumes: 无
- Produces:
  - `NotificationBadgePreference.key: String`
  - `NotificationBadgePreference.isEnabled: Bool`（读写 `UserDefaults.standard`）
  - `NotificationBadgePreference.badgeCount(unreadCount: Int, enabled: Bool) -> Int`（纯函数）
  - `NotificationBadgePreference.badgeCount(unreadCount: Int) -> Int`（读偏好的版本）

- [ ] **Step 1: 写失败的测试**

创建 `SynapseMobile/SynapseMobileTests/NotificationBadgePreferenceTests.swift`：

```swift
import Foundation
import Testing
@testable import SynapseMobile

/// App 图标角标要不要跟随未读数。
///
/// 这个开关只影响**系统角标**：底栏那一格的角标、主页铃铛上自绘的琥珀角标都照常工作。
/// 关掉它是一件「我不想让手机在锁屏上提醒我」的事，不是「我不想看见未读」。
final class NotificationBadgePreferenceTests {

    @Test func anEnabledPreferencePassesTheCountThrough() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 3, enabled: true) == 3)
    }

    /// 关掉就是 0，不是「保持上一次的数字」。写 0 才会把锁屏上那个数字抹掉。
    @Test func aDisabledPreferenceWritesZero() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 3, enabled: false) == 0)
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 0, enabled: false) == 0)
    }

    /// 负数不该传下去：`setBadgeCount` 要的是非负。
    @Test func aNegativeCountIsClamped() {
        #expect(NotificationBadgePreference.badgeCount(unreadCount: -1, enabled: true) == 0)
    }

    /// **没存过就是开。** `UserDefaults.bool(forKey:)` 对缺失的 key 返回 `false`，
    /// 直接用它会让所有既有用户升级后静默失去角标。
    @Test func anAbsentPreferenceMeansEnabled() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: NotificationBadgePreference.key)
        defaults.removeObject(forKey: NotificationBadgePreference.key)
        defer {
            if let saved { defaults.set(saved, forKey: NotificationBadgePreference.key) }
            else { defaults.removeObject(forKey: NotificationBadgePreference.key) }
        }

        #expect(NotificationBadgePreference.isEnabled)
    }

    /// 存进去读回来是同一条。
    @Test func aStoredPreferenceReadsBack() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: NotificationBadgePreference.key)
        defer {
            if let saved { defaults.set(saved, forKey: NotificationBadgePreference.key) }
            else { defaults.removeObject(forKey: NotificationBadgePreference.key) }
        }

        NotificationBadgePreference.isEnabled = false
        #expect(NotificationBadgePreference.isEnabled == false)
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 5) == 0)

        NotificationBadgePreference.isEnabled = true
        #expect(NotificationBadgePreference.badgeCount(unreadCount: 5) == 5)
    }
}
```

- [ ] **Step 2: 运行测试，确认它失败**

Run:
```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/NotificationBadgePreferenceTests
```
Expected: 编译失败，`cannot find 'NotificationBadgePreference' in scope`。

- [ ] **Step 3: 写实现**

创建 `SynapseMobile/SynapseMobile/Core/Notifications/NotificationBadgePreference.swift`：

```swift
import Foundation

/// App 图标角标要不要跟随未读数。默认开。
///
/// 它只影响 **App 图标**上那个数字。底栏主页那一格的系统角标、主页铃铛上自绘的琥珀角标
/// 都不受它管 —— 它们是应用内的，不需要经过系统通知中心的许可，也就不该受一个叫
/// 「图标角标」的开关牵连。
///
/// 不用 `@AppStorage`：读它的地方（`RootView`）不是在画一个绑定，而是在决定要不要写角标，
/// 中间隔着一层 `UNUserNotificationCenter`。
enum NotificationBadgePreference {
    static let key = "mobile.notificationBadge.enabled"

    /// 没存过就是开。
    ///
    /// `UserDefaults.bool(forKey:)` 对缺失的 key 返回 `false`，直接用它会让升级上来的
    /// 既有用户静默失去角标 —— 而角标是「有会话在等你」的第三条常驻通路，不能悄悄少一条。
    static var isEnabled: Bool {
        get {
            let defaults = UserDefaults.standard
            guard defaults.object(forKey: key) != nil else { return true }
            return defaults.bool(forKey: key)
        }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// 该写进 App 图标角标的数字。纯函数，好判。
    static func badgeCount(unreadCount: Int, enabled: Bool) -> Int {
        guard enabled else { return 0 }
        return max(0, unreadCount)
    }

    /// 读偏好取该写的数字。
    static func badgeCount(unreadCount: Int) -> Int {
        badgeCount(unreadCount: unreadCount, enabled: isEnabled)
    }
}
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: 同 Step 2 的命令
Expected: `Executed 5 tests, with 0 failures`。

- [ ] **Step 5: 提交**

```bash
git add SynapseMobile/SynapseMobile/Core/Notifications/NotificationBadgePreference.swift \
        SynapseMobile/SynapseMobileTests/NotificationBadgePreferenceTests.swift
git commit -m "feat: 加入控制 App 图标角标的持久化开关"
```

---

### Task 3: 问题反馈的提交通路（`APIError.payload` + `ProblemFeedbackOutcome`）

服务端 `POST /api/problem-feedback` 收 `{content}`、无鉴权、按 IP 限流，失败时返回五种 code。客户端只做「提交 → 按 code 说一句话」，**不做隐私预校验**——校验器是 `@synapse/shared` 里的 TypeScript 正则，逐条移植必然漂移。

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift:14-26`（`APIError` 加 `payload`）、`:801-810`（`decodeError` 填它）
- Create: `SynapseMobile/SynapseMobile/Core/Feedback/ProblemFeedbackOutcome.swift`
- Modify: `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift`（在 `send` 系列之后加一个公开方法）
- Test: `SynapseMobile/SynapseMobileTests/ProblemFeedbackOutcomeTests.swift`

**Interfaces:**
- Consumes: `APIError`（`status: Int`、`code: String?`、`message: String`、新增 `payload: Data?`）
- Produces:
  - `APIError.payload: Data?`（默认 `nil`，既有构造点不受影响）
  - `APIClient.submitProblemFeedback(content: String) async -> ProblemFeedbackOutcome`
  - `ProblemFeedbackOutcome` 六个 case 与 `var message: String`

- [ ] **Step 1: 写失败的测试**

创建 `SynapseMobile/SynapseMobileTests/ProblemFeedbackOutcomeTests.swift`：

```swift
import Foundation
import Testing
@testable import SynapseMobile

/// 提交一条问题反馈之后该对用户说什么。
///
/// 六句话里有五句是从桌面端 dispatcher（`desktop/app-capabilities/problem-feedback/
/// main/dispatcher.ts`）抄过来的 —— 同一个后端、同一种失败，两端说同一句话，人才不必
/// 分别学。第六句（`.unknown`）只在手机上出现：桌面端在进程里提交，断网是一种失败；
/// 手机在移动网络里提交，请求发出去而响应没回来是完全正常的一种处境。
final class ProblemFeedbackOutcomeTests {

    @Test func successSaysSoAndPromisesNothingMore() {
        #expect(ProblemFeedbackOutcome.submitted.message == "问题反馈已提交")
    }

    @Test func invalidInputMatchesTheDesktopWording() {
        #expect(ProblemFeedbackOutcome.rejected.message == "问题反馈内容不符合提交要求。")
    }

    @Test func rateLimitedMatchesTheDesktopWording() {
        #expect(ProblemFeedbackOutcome.rateLimited.message == "问题反馈提交过于频繁。")
    }

    @Test func aServerFailureMatchesTheDesktopWording() {
        #expect(ProblemFeedbackOutcome.notSubmitted.message == "问题反馈未提交。")
    }

    /// 内容已经送出去了而结果不知道 —— 这句话必须说「可能已经提交」，
    /// 否则用户会重发，而后端会把它当第二条。
    @Test func anUnknownOutcomeSaysItMayHaveArrived() {
        #expect(ProblemFeedbackOutcome.unknown.message == "问题反馈提交结果未知，内容可能已经提交。")
    }

    /// 命中的风险类别要说得出来，但**不复述命中的内容**：这一行字本身会出现在屏幕上，
    /// 而它旁边就是用户刚刚粘进来的东西。
    @Test func aPrivacyRiskNamesTheCategoryWithoutQuotingIt() {
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "authentication_secret").message
                == "问题反馈包含不允许提交的隐私风险：看起来是密钥或密码。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "local_path").message
                == "问题反馈包含不允许提交的隐私风险：看起来是本机文件路径。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "identity").message
                == "问题反馈包含不允许提交的隐私风险：看起来是邮箱、IP 或设备标识。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "user_content").message
                == "问题反馈包含不允许提交的隐私风险：看起来是对话或代码内容。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "unsafe_url").message
                == "问题反馈包含不允许提交的隐私风险：看起来是一个不安全的链接。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "correlation_identifier").message
                == "问题反馈包含不允许提交的隐私风险：看起来是精确时间或请求标识。"
        )
    }

    /// 服务端将来多一个类别时，回落成通用那句，不是空白。
    @Test func anUnknownPrivacyCategoryFallsBack() {
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: "something_new").message
                == "问题反馈包含不允许提交的隐私风险。"
        )
        #expect(
            ProblemFeedbackOutcome.privacyRisk(category: nil).message
                == "问题反馈包含不允许提交的隐私风险。"
        )
    }
}
```

- [ ] **Step 2: 运行测试，确认它失败**

Run:
```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/ProblemFeedbackOutcomeTests
```
Expected: 编译失败，`cannot find 'ProblemFeedbackOutcome' in scope`。

- [ ] **Step 3: 给 `APIError` 加 `payload`**

改 `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift:14-26`，在 `message` 之后加一个带默认值的字段：

```swift
struct APIError: Error, LocalizedError {
    let status: Int
    let code: String?
    let message: String
    /// 错误响应体的原文。
    ///
    /// 绝大多数调用方只看 `status` 与 `code`，但问题反馈的 `PRIVACY_RISK` 把命中的风险
    /// 类别放在 `data.category` 里，而那是决定要说哪一句话的唯一依据 —— 只留 code 的话，
    /// 六种风险会塌成同一句「包含隐私风险」。
    ///
    /// 有默认值，所以既有的三参构造点一个都不用改。
    var payload: Data? = nil

    var errorDescription: String? { message }

    var isUnauthorized: Bool { status == 401 || status == 403 }

    var isTransport: Bool { status == 0 }
}
```

改同一文件 `:801-810` 的 `decodeError`，把原始响应体带上：

```swift
    private static func decodeError(status: Int, data: Data) -> APIError {
        struct ErrorBody: Decodable {
            let message: String?
            let error: String?
            let code: String?
        }
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        let message = body?.message ?? body?.error ?? "请求失败（\(status)）。"
        return APIError(status: status, code: body?.code, message: message, payload: data)
    }
```

- [ ] **Step 4: 写 `ProblemFeedbackOutcome`**

创建 `SynapseMobile/SynapseMobile/Core/Feedback/ProblemFeedbackOutcome.swift`：

```swift
import Foundation

/// 一次问题反馈提交的结果，以及要对用户说的那句话。
///
/// 五句从桌面端 dispatcher 抄来（`desktop/app-capabilities/problem-feedback/main/
/// dispatcher.ts`）：同一个后端、同一种失败，两端说同一句话。
enum ProblemFeedbackOutcome: Equatable {
    case submitted
    /// 400：内容不符合提交要求（空、首尾空白、含控制字符、超 256 KiB……）。
    case rejected
    /// 422：命中了隐私校验。`category` 是服务端给的稳定类别名。
    case privacyRisk(category: String?)
    /// 429：按 IP 限流（桶容量 3 / 10 分钟）。
    case rateLimited
    /// 503：服务端没写成。
    case notSubmitted
    /// 连接断了、超时、或响应读不懂 —— 请求可能已经到了。
    case unknown
}

extension ProblemFeedbackOutcome {
    var message: String {
        switch self {
        case .submitted:
            "问题反馈已提交"
        case .rejected:
            "问题反馈内容不符合提交要求。"
        case .privacyRisk(let category):
            Self.privacyMessage(category: category)
        case .rateLimited:
            "问题反馈提交过于频繁。"
        case .notSubmitted:
            "问题反馈未提交。"
        case .unknown:
            "问题反馈提交结果未知，内容可能已经提交。"
        }
    }

    /// 说得出是哪一类风险，但**不复述命中的内容**。
    ///
    /// 这一行字会出现在屏幕上，而它旁边就是用户刚粘进来的那段东西 —— 把命中的原文
    /// 抄进提示里，等于把刚刚拒绝上传的内容又显示了一遍。
    private static func privacyMessage(category: String?) -> String {
        let base = "问题反馈包含不允许提交的隐私风险"
        let hint: String?
        switch category {
        case "authentication_secret": hint = "看起来是密钥或密码。"
        case "local_path": hint = "看起来是本机文件路径。"
        case "identity": hint = "看起来是邮箱、IP 或设备标识。"
        case "user_content": hint = "看起来是对话或代码内容。"
        case "unsafe_url": hint = "看起来是一个不安全的链接。"
        case "correlation_identifier": hint = "看起来是精确时间或请求标识。"
        default: hint = nil
        }
        guard let hint else { return base + "。" }
        return base + "：" + hint
    }
}
```

- [ ] **Step 5: 运行单元测试，确认它通过**

Run:
```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/ProblemFeedbackOutcomeTests
```
Expected: `Executed 7 tests, with 0 failures`。

- [ ] **Step 6: 给 `APIClient` 加提交方法**

在 `SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift` 的 `send` 系列方法之后（`:686` 附近）加：

```swift
    /// 提交一条问题反馈。
    ///
    /// `authenticated: false`：这个接口是公开的，服务端只看来源 IP，不看账号。带令牌不但
    /// 没用，还会让「未登录时能不能反馈」凭空多出一种情况。
    ///
    /// 不在这里做隐私预校验。服务端持有一份权威校验（`@synapse/shared` 的
    /// `validateProblemFeedbackInput`，约一百行正则），把它抄到 Swift 里就是第二份会漂移的
    /// 实现 —— 而结果是按服务端说的算，第二份只会在两边不一致时先把人挡下来。
    func submitProblemFeedback(content: String) async -> ProblemFeedbackOutcome {
        struct Body: Encodable { let content: String }
        struct Ack: Decodable { let success: Bool? }

        do {
            let _: Ack = try await send(
                path: "/problem-feedback",
                method: "POST",
                body: Body(content: content),
                authenticated: false
            )
            return .submitted
        } catch let error as APIError {
            // 传输层的失败（`status == 0`）：请求可能已经出去了。
            guard !error.isTransport else { return .unknown }
            switch error.status {
            case 400: return .rejected
            case 422: return .privacyRisk(category: Self.privacyCategory(from: error.payload))
            case 429: return .rateLimited
            case 503: return .notSubmitted
            default: return .unknown
            }
        } catch {
            return .unknown
        }
    }

    /// 从 422 的响应体里取出 `data.category`。
    private static func privacyCategory(from payload: Data?) -> String? {
        struct RiskBody: Decodable {
            struct Payload: Decodable { let category: String? }
            let data: Payload?
        }
        guard let payload else { return nil }
        return try? JSONDecoder().decode(RiskBody.self, from: payload).data?.category
    }
```

- [ ] **Step 7: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 8: 提交**

```bash
git add SynapseMobile/SynapseMobile/Core/Networking/APIClient.swift \
        SynapseMobile/SynapseMobile/Core/Feedback/ProblemFeedbackOutcome.swift \
        SynapseMobile/SynapseMobileTests/ProblemFeedbackOutcomeTests.swift
git commit -m "feat: 加入问题反馈的提交通路与失败文案"
```

---

### Task 4: 问题反馈页（`ProblemFeedbackView`）

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Settings/ProblemFeedbackView.swift`

**Interfaces:**
- Consumes: `APIClient.submitProblemFeedback(content:) async -> ProblemFeedbackOutcome`（Task 3）、`SynapseAppModel.notice(_:tone:)`（`App/SynapseAppModel.swift:149`）、`NoticeTone.success/.failure`（`App/Notice.swift:9-31`）
- Produces: `struct ProblemFeedbackView: View`（无 init 参数，从 `@Environment` 取 model）

- [ ] **Step 1: 写实现**

创建 `SynapseMobile/SynapseMobile/Features/Settings/ProblemFeedbackView.swift`：

```swift
import SwiftUI

/// 写一条问题反馈，提交到服务端。
///
/// 一个输入框加一个提交按钮，没有别的。反馈的去向、怎么被处理、谁来读，都不是这一页
/// 该说的话 —— 读者此刻要做的事只有一件：把遇到的问题写下来。
///
/// **提交前 trim。** 服务端要求 `content === content.trim()`（`@synapse/shared` 的
/// `validateProblemFeedbackInput`），而多行输入框里手一滑就带出一个尾随换行。不 trim
/// 就会把人拒在一个他从屏幕上完全看不出来的错误上。
struct ProblemFeedbackView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var submitting = false

    /// 空白不算内容：只有空格的输入框不该让提交按钮亮起来。
    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        Form {
            Section {
                TextField("说说遇到了什么", text: $text, axis: .vertical)
                    .lineLimit(6...14)
                    .accessibilityIdentifier("feedback-text")
            }
        }
        .noticeOverlay(model)
        .navigationTitle("问题反馈")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("提交") { submit() }
                    .disabled(trimmed.isEmpty || submitting)
                    .accessibilityIdentifier("feedback-submit")
            }
        }
    }

    private func submit() {
        submitting = true
        Task {
            let content = trimmed
            let outcome = await model.submitProblemFeedback(content)
            submitting = false
            // 成功走 `success`，其余走 `failure`：`unknown` 也是失败 —— 内容可能已经
            // 送出去了，但这件事对读者来说没成，他不该看到一条绿色的东西。
            model.notice(outcome.message, tone: outcome == .submitted ? .success : .failure)
            if outcome == .submitted { dismiss() }
        }
    }
}
```

- [ ] **Step 2: 给 `SynapseAppModel` 加转发**

在 `SynapseMobile/SynapseAppModel.swift` 的 `signOut`（`:467`）附近加：

```swift
    /// 提交一条问题反馈。
    ///
    /// 走 `apiClient` 而不是让视图自己拿到它：视图不该知道网络层长什么样，而且这一页
    /// 在退出登录的状态下也可能被打开（接口不需要登录），`apiClient` 的生命周期比登录态长。
    func submitProblemFeedback(_ content: String) async -> ProblemFeedbackOutcome {
        await apiClient.submitProblemFeedback(content: content)
    }
```

- [ ] **Step 3: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 4: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Settings/ProblemFeedbackView.swift \
        SynapseMobile/SynapseMobile/App/SynapseAppModel.swift
git commit -m "feat: 加入问题反馈页并把提交转发到服务端"
```

---

### Task 5: 权限状态行（`PermissionRow`）

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Settings/PermissionRow.swift`
- Test: `SynapseMobile/SynapseMobileTests/PermissionRowTests.swift`

**Interfaces:**
- Consumes: `MeetingPermission.microphone` / `MeetingPermission.requestMicrophone()`（`Features/Meeting/MeetingPermission.swift`）
- Produces:
  - `PermissionRow.State`（`.granted` / `.denied` / `.undetermined`）与 `var label: String`
  - `PermissionRow.Action`（`.request` / `.openSettings` / `.none`）与 `static func action(for state: PermissionRow.State) -> PermissionRow.Action`
  - `struct PermissionRow: View`，init 为 `PermissionRow(title: String, state: PermissionRow.State, onRequest: @escaping () async -> Void)`

- [ ] **Step 1: 写失败的测试**

创建 `SynapseMobile/SynapseMobileTests/PermissionRowTests.swift`：

```swift
import Testing
@testable import SynapseMobile

/// 一行权限状态在三种状态下分别该做什么。
///
/// 这条判据值得单测，因为它的错误形态是「按下去没反应」—— iOS 在应用问过一次之后
/// 不再弹框，一次被拒之后用户只能自己去系统设置里改。所以「被拒」这一档必须变成一扇
/// 通往系统设置的门，而不是一个沉默的按钮。
final class PermissionRowTests {

    @Test func grantedHasNothingToDo() {
        #expect(PermissionRow.action(for: .granted) == .none)
    }

    /// 没问过就问一次，系统会弹框。
    @Test func undeterminedAsksTheSystem() {
        #expect(PermissionRow.action(for: .undetermined) == .request)
    }

    /// 被拒之后系统不再弹框了，只能去系统设置里开。
    @Test func deniedOpensSystemSettings() {
        #expect(PermissionRow.action(for: .denied) == .openSettings)
    }

    /// 三种状态各有各的字，没有一种是空白。
    @Test func everyStateHasALabel() {
        #expect(PermissionRow.State.granted.label == "已允许")
        #expect(PermissionRow.State.denied.label == "已拒绝")
        #expect(PermissionRow.State.undetermined.label == "未请求")
    }
}
```

- [ ] **Step 2: 运行测试，确认它失败**

Run:
```bash
xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/PermissionRowTests
```
Expected: 编译失败，`cannot find 'PermissionRow' in scope`。

- [ ] **Step 3: 写实现**

创建 `SynapseMobile/SynapseMobile/Features/Settings/PermissionRow.swift`：

```swift
import SwiftUI
import UIKit

/// 一行权限状态：右侧是状态文字，点按按状态决定做什么。
///
/// 两个分类共用一行 ——「录音」的麦克风与「通知」的系统通知 —— 因为它们的形态是同一个。
/// iOS 不给应用「再问一次」的机会：问过一次之后系统不再弹框，用户只能自己去系统设置里改。
/// 所以被拒之后这一行必须变成一扇通往系统设置的门，而不是一个按下去没反应的按钮。
struct PermissionRow: View {
    enum State: Equatable {
        case granted
        case denied
        case undetermined

        var label: String {
            switch self {
            case .granted: "已允许"
            case .denied: "已拒绝"
            case .undetermined: "未请求"
            }
        }
    }

    enum Action: Equatable {
        case request
        case openSettings
        case none
    }

    /// 三种状态各自该做什么。纯函数，好判。
    static func action(for state: State) -> Action {
        switch state {
        case .granted: .none
        case .denied: .openSettings
        case .undetermined: .request
        }
    }

    let title: String
    let state: State
    /// 状态是「未请求」时按下去要做的事：触发系统弹框。
    let onRequest: () async -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            switch Self.action(for: state) {
            case .none:
                break
            case .request:
                Task { await onRequest() }
            case .openSettings:
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                openURL(url)
            }
        } label: {
            HStack {
                Text(title)
                Spacer(minLength: 8)
                Text(state.label)
                    .foregroundStyle(.secondary)
                // 只在真有下一步的时候画箭头：一个点不动的行带箭头是在骗人。
                if Self.action(for: state) != .none {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(Self.action(for: state) == .none)
        .accessibilityIdentifier("permission-\(title)")
    }
}
```

- [ ] **Step 4: 运行测试，确认它通过**

Run: 同 Step 2 的命令
Expected: `Executed 4 tests, with 0 failures`。

- [ ] **Step 5: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Settings/PermissionRow.swift \
        SynapseMobile/SynapseMobileTests/PermissionRowTests.swift
git commit -m "feat: 加入权限状态行，被拒时导向系统设置"
```

---

### Task 6: 「我的」七个分类与三个新二级页

`SettingsCategory` 从四项扩到七项，并让 iPhone 与 iPadOS 走同一条路径。这一 Task 只把分类列表的**行**保持为现有的 `Label` 形态（带值的行在 Task 7），交付物是「七个分类都能进到有内容的二级页」。

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Settings/AdaptiveSettingsView.swift:3-25`（枚举）、`:32-55`（两种宽度统一）
- Modify: `SynapseMobile/SynapseMobile/Features/Settings/SettingsView.swift:7-10`（`category` 改为非可选）、`:19,37,57,116,137`（去掉 `category == nil ||`）
- Create: `SynapseMobile/SynapseMobile/Features/Settings/AboutView.swift`
- Create: `SynapseMobile/SynapseMobile/Features/Settings/RecordingSettingsView.swift`
- Create: `SynapseMobile/SynapseMobile/Features/Settings/NotificationSettingsView.swift`

**Interfaces:**
- Consumes: `PermissionRow`（Task 5）、`ProblemFeedbackView`（Task 4）、`AppVersion.label`（`Core/AppVersion.swift`）、`MeetingPermission.microphone` / `.requestMicrophone()`、`NotificationBadgePreference`（Task 2）、`DiagnosticLogView`（既有，无参）
- Produces:
  - `SettingsCategory` 七个 case：`account, desktops, terminal, recording, notifications, diagnostics, about`
  - `SettingsView(category: SettingsCategory, onSelectDesktop: () -> Void)`
  - `AboutView`、`RecordingSettingsView`（init `onOpenNotifications: () -> Void` 的版本在 Task 7 才需要，本 Task 先无参）、`NotificationSettingsView(onOpenNotifications: () -> Void)`

- [ ] **Step 1: 扩枚举**

把 `AdaptiveSettingsView.swift:3-25` 的 `SettingsCategory` 换成：

```swift
/// 「我的」的七个分类。
///
/// 顺序即显示顺序，也即 iPadOS 侧边栏里的顺序。分三组看：账号与电脑说的是「你现在是谁、
/// 在哪台机器上」；终端、录音、通知是本机行为的三个面；诊断与关于是把它交出去的两个出口。
enum SettingsCategory: String, CaseIterable, Identifiable {
    case account, desktops, terminal, recording, notifications, diagnostics, about

    var id: Self { self }

    var title: String {
        switch self {
        case .account: "账号"
        case .desktops: "电脑"
        case .terminal: "终端"
        case .recording: "录音"
        case .notifications: "通知"
        case .diagnostics: "诊断"
        case .about: "关于"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .desktops: "desktopcomputer"
        case .terminal: "terminal"
        case .recording: "waveform"
        case .notifications: "bell"
        case .diagnostics: "waveform.path.ecg"
        case .about: "info.circle"
        }
    }
}
```

- [ ] **Step 2: 两种宽度统一**

把 `AdaptiveSettingsView` 的 `body`（`:32-55`）换成：

```swift
    var body: some View {
        // 两种宽度走同一条路。iPhone 上 `NavigationSplitView` 折叠成单列下钻，
        // 于是「我的」在两种设备上是同一件事：一层分类，点进去才是设置。
        //
        // 换掉的是原来那个 compact 特判 —— 它把账号、显示密度、电脑、诊断四段
        // **平铺在一屏**，每加一个设置就长一行。七个分类之后那样已经读不动了。
        AdaptiveFeatureNavigation(
            selection: $selection,
            emptyTitle: "选择设置",
            emptySymbol: "gearshape"
        ) {
            List(SettingsCategory.allCases, selection: $selection) { category in
                NavigationLink(value: category) {
                    Label(category.title, systemImage: category.symbol)
                }
            }
            .navigationTitle("我的")
        } detail: { category in
            NavigationStack {
                SettingsView(category: category, onSelectDesktop: onSelectDesktop)
            }
        }
    }
```

删掉 `@Environment(\.horizontalSizeClass) private var horizontalSizeClass`（`:28`），它不再被用到。

- [ ] **Step 3: `SettingsView` 的 `category` 改为非可选**

`SettingsView.swift`：

- `:7` `let category: SettingsCategory?` → `let category: SettingsCategory`
- `:10-13` 的 init 去掉默认值：

```swift
    init(category: SettingsCategory, onSelectDesktop: @escaping () -> Void) {
        self.category = category
        self.onSelectDesktop = onSelectDesktop
    }
```

- 把五处 `if category == nil || category == .x {` 改成 `if category == .x {`（`:19`、`:37`、`:57`、`:116`、`:137`）
- `:145` `.navigationTitle(category?.title ?? "我的")` → `.navigationTitle(category.title)`

- [ ] **Step 4: 写三个新二级页**

创建 `SynapseMobile/SynapseMobile/Features/Settings/AboutView.swift`：

```swift
import SwiftUI

/// 关于这一台手机上的 Synapse。
///
/// 版本号在这里，**但终端页顶栏第二行那份不搬走**：那个位置是「我正在用的这个终端」
/// 旁边，出问题时人就在那里，抬头就能念出来。两处是同一件事的两个入口，不是重复 ——
/// 一处是「我在哪一屏」，一处是「我要报个问题」。
struct AboutView: View {
    var body: some View {
        List {
            Section {
                LabeledContent("版本") {
                    Text(AppVersion.label)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                NavigationLink {
                    ProblemFeedbackView()
                } label: {
                    Text("问题反馈")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("关于")
        .navigationBarTitleDisplayMode(.inline)
    }
}
```

创建 `SynapseMobile/SynapseMobile/Features/Settings/RecordingSettingsView.swift`：

```swift
import AVFoundation
import SwiftUI
import UIKit

/// 「录音」这个分类下眼下只有一件事：麦克风权限。
///
/// 一项也值得单开一个分类 —— 它是给将来留的位置，而不是因为它现在够长。录音相关的
/// 设置会长，长在一个已经叫「录音」的地方，好过到时候重新组织整个「我的」。
struct RecordingSettingsView: View {
    @State private var microphone: PermissionRow.State = .undetermined

    var body: some View {
        List {
            Section {
                PermissionRow(title: "麦克风", state: microphone) {
                    await MeetingPermission.requestMicrophone()
                    microphone = Self.currentMicrophoneState()
                }
            } footer: {
                Text("录音与转写都在服务端处理，不依赖任何一台电脑。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("录音")
        .navigationBarTitleDisplayMode(.inline)
        // 用户可能在系统设置里改过。回到前台要重新读一次，否则这一行会一直停在
        // 上次进这一页时看到的样子。
        .onAppear { microphone = Self.currentMicrophoneState() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            microphone = Self.currentMicrophoneState()
        }
    }

    private static func currentMicrophoneState() -> PermissionRow.State {
        switch MeetingPermission.microphone {
        case .granted: .granted
        case .denied: .denied
        case .undetermined: .undetermined
        }
    }
}
```

创建 `SynapseMobile/SynapseMobile/Features/Settings/NotificationSettingsView.swift`：

```swift
import SwiftUI
import UIKit
import UserNotifications

/// 「通知」这个分类。系统通知权限、应用内的通知中心，以及 App 图标角标。
///
/// 关掉系统通知不影响任何功能：应用内的通知中心、待处理提示和图标角标都照常工作。
/// 这是这一页唯一需要说的一句 —— 否则关掉开关的人会以为自己从此收不到东西了。
struct NotificationSettingsView: View {
    @Environment(SynapseAppModel.self) private var model
    let onOpenNotifications: () -> Void

    @State private var system: PermissionRow.State = .undetermined
    @State private var badgeEnabled = NotificationBadgePreference.isEnabled

    var body: some View {
        List {
            Section {
                PermissionRow(title: "系统通知", state: system) {
                    // 权限只能由系统弹框授予，而这里没有别的事要做 —— 弹框由
                    // `UNUserNotificationCenter` 在第一次注册设备令牌时触发。
                    // 这一行的「未请求」落到这里就是去开一次。
                    _ = try? await UNUserNotificationCenter.current()
                        .requestAuthorization(options: [.alert, .badge, .sound])
                    system = await Self.currentSystemState()
                }
            } footer: {
                Text("关掉系统通知不影响任何功能：应用内的通知中心、待处理提示和图标角标都照常工作。")
            }

            Section {
                Button {
                    onOpenNotifications()
                } label: {
                    HStack {
                        Label("通知中心", systemImage: "bell")
                        Spacer(minLength: 8)
                        if model.notifications.unreadCount > 0 {
                            Text("\(model.notifications.unreadCount) 条未读")
                                .foregroundStyle(.secondary)
                        }
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings-notification-center")

                Toggle("图标角标", isOn: $badgeEnabled)
                    .tint(Theme.switchOn)
                    .accessibilityIdentifier("settings-badge-toggle")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Task { system = await Self.currentSystemState() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { system = await Self.currentSystemState() }
        }
        .onChange(of: badgeEnabled) { _, enabled in
            NotificationBadgePreference.isEnabled = enabled
        }
    }

    private static func currentSystemState() async -> PermissionRow.State {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }
}
```

- [ ] **Step 5: 在 `SettingsView` 里接上三个新分类**

在 `SettingsView.swift` 的 `List` 里，`诊断` 那一段之后加：

```swift
            if category == .recording {
                Section {
                    NavigationLink {
                        RecordingSettingsView()
                    } label: {
                        Text("麦克风权限")
                    }
                }
            }

            if category == .notifications {
                Section {
                    NavigationLink {
                        NotificationSettingsView(onOpenNotifications: { onOpenNotificationCenter() })
                    } label: {
                        Text("通知设置")
                    }
                }
            }

            if category == .about {
                Section {
                    NavigationLink {
                        AboutView()
                    } label: {
                        Text("版本与反馈")
                    }
                }
            }
```

并在 `SettingsView` 上加一个新的参数与转发（通知面板在 Task 12 才存在，本 Task 先用一个空实现占位，Task 13 换上真实现）：

```swift
    /// 打开通知面板。Task 12 之前是一个空实现：通知面板那时还不存在。
    let onOpenNotificationCenter: () -> Void
```

init 同步加参数：

```swift
    init(
        category: SettingsCategory,
        onSelectDesktop: @escaping () -> Void,
        onOpenNotificationCenter: @escaping () -> Void = {}
    ) {
        self.category = category
        self.onSelectDesktop = onSelectDesktop
        self.onOpenNotificationCenter = onOpenNotificationCenter
    }
```

- [ ] **Step 6: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。这一步会一并暴露 `RootView` 里 `AdaptiveSettingsView` 调用点是否仍然匹配 —— 它只用了 `selection:` 与尾随闭包，没有被本 Task 改动。

- [ ] **Step 7: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Settings/AdaptiveSettingsView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/SettingsView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/AboutView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/RecordingSettingsView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/NotificationSettingsView.swift
git commit -m "feat: 「我的」扩到七个分类，iPhone 与 iPad 统一为分类下钻"
```

---

### Task 7: 分类列表带上值与分组（`SettingsCategoriesView`）

`List(SettingsCategory.allCases, selection:) { NavigationLink { Label } }` 画不出外侧要显示的值。这一 Task 换成自定义行：图标 + 名称 + 右侧值 + 箭头，并按设计稿分三张卡片。

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Settings/SettingsCategoriesView.swift`
- Modify: `SynapseMobile/SynapseMobile/Features/Settings/AdaptiveSettingsView.swift`（把 Step 2 of Task 6 里那段 `List` 换成 `SettingsCategoriesView`）

**Interfaces:**
- Consumes: `SettingsCategory`（Task 6）、`SynapseAppModel.email`（`App/SynapseAppModel.swift:20`）、`.selectedDesktopClientInstanceId`（`:24`）、`.desktopName(_:)`（`:908`）、`.viewedDesktopIsOffline`（`:883`）、`.notifications.unreadCount`（`Features/Inbox/NotificationStore.swift:33`）
- Produces: `struct SettingsCategoriesView: View`，init 为 `SettingsCategoriesView(selection: Binding<SettingsCategory?>)`

- [ ] **Step 1: 写实现**

创建 `SynapseMobile/SynapseMobile/Features/Settings/SettingsCategoriesView.swift`：

```swift
import SwiftUI

/// 「我的」的外层：只有分类，值放二级页。
///
/// 例外只有两行 —— 账号与电脑。它们右边显示的不是一个可以调的设置，而是「你现在处在
/// 什么状态」：一眼可见比点进去再退出来有用。其余五个分类右边不画值。
///
/// 分三张卡片：账号与电脑说的是你是谁、在哪台机器上；终端、录音、通知是本机行为的三个面；
/// 诊断与关于是把它交出去的两个出口。iPadOS 的侧边栏是一列平铺，分组在那里不表达 ——
/// 这不是缺陷，系统的侧边栏本来就不分组。
struct SettingsCategoriesView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var selection: SettingsCategory?

    var body: some View {
        List(selection: $selection) {
            Section {
                row(.account, value: model.email)
                row(.desktops, value: desktopValue, dot: desktopDot)
            }
            Section {
                row(.terminal, value: nil)
                row(.recording, value: nil)
                row(.notifications, value: unreadValue)
            }
            Section {
                row(.diagnostics, value: nil)
                row(.about, value: AppVersion.label)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("我的")
    }

    private var desktopValue: String? {
        guard let id = model.selectedDesktopClientInstanceId else { return nil }
        return model.desktopName(id)
    }

    /// 当前那台电脑在线是绿的，不在线是次要色 —— 与终端页设备行、二级页里的电脑行
    /// 是同一条：全应用只有一处说「这台在不在」。
    private var desktopDot: Color? {
        guard model.selectedDesktopClientInstanceId != nil else { return nil }
        return model.viewedDesktopIsOffline ? Color.secondary : Theme.running
    }

    private var unreadValue: String? {
        let count = model.notifications.unreadCount
        return count > 0 ? "\(count) 条未读" : nil
    }

    private func row(_ category: SettingsCategory, value: String?, dot: Color? = nil) -> some View {
        NavigationLink(value: category) {
            HStack(spacing: 12) {
                Image(systemName: category.symbol)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                Text(category.title)
                Spacer(minLength: 8)
                if let dot {
                    Circle().fill(dot).frame(width: 7, height: 7)
                }
                if let value {
                    Text(value)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityIdentifier("settings-category-\(category.rawValue)")
    }
}
```

- [ ] **Step 2: 接进 `AdaptiveSettingsView`**

把 Task 6 里写的那段 `List(SettingsCategory.allCases, selection: $selection) { … }` 换成：

```swift
            SettingsCategoriesView(selection: $selection)
```

- [ ] **Step 3: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 4: 在模拟器上确认外形**

Run:
```bash
xcrun simctl boot 'iPhone 17 Pro' || true
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
装上去并截图确认：三张分组卡、七个分类、账号行右侧是邮箱、电脑行右侧是电脑名加圆点、通知行只有未读时才显示值、关于行右侧是版本号。

这一条不接受「看起来还行」—— 截图上要能读出**七个分类都在**、**账号与电脑两行有值**、**其余五行没有值**。

- [ ] **Step 5: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Settings/SettingsCategoriesView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/AdaptiveSettingsView.swift
git commit -m "feat: 「我的」外层改为带值的分类列表并分三组"
```

---

### Task 8: 会话创建 sheet 的装配抽出来共用

「新建会话」有两个入口（终端列表右上角的 ＋、主页功能里的那一行），它们必须打开同一个界面并接同样的三个回调。第三个回调之前还有一步 `display.setMode(.phoneDriven, for:)` —— 漏掉它的表现是「手机建的终端却按电脑的列宽显示」。

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Sessions/NewSessionPresentation.swift`
- Modify: `SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift:93-120`（sheet 换成修饰符）、`:230-233`（删 `openNewlyCreated`）

**Interfaces:**
- Consumes: `NewSessionSheet(onCreated:onCommandLaunched:onConversationStarted:)`（`Features/Sessions/NewSessionSheet.swift:42-52`）、`SynapseAppModel.createSession(groupId:)` / `launchCommand(groupId:commandId:)`、`TerminalDisplaySettings.setMode(_:for:)`
- Produces: `func View.newSessionSheet(isPresented: Binding<Bool>, onOpenCreated: @escaping (String) -> Void) -> some View`

- [ ] **Step 1: 写实现**

创建 `SynapseMobile/SynapseMobile/Features/Sessions/NewSessionPresentation.swift`：

```swift
import SwiftUI

/// 会话创建 sheet 的装配，两处共用。
///
/// 它在两个地方被打开：终端列表右上角的 ＋，和主页功能里的「新建会话」。两处必须打开
/// 同一个界面、接同样的三个回调，**包括那个容易漏的 `setMode(.phoneDriven)`** —— 手机
/// 让电脑建出来的终端，尺寸归手机；漏掉这一步的表现是「手机上建的终端按电脑的列宽显示」，
/// 而那是一条只有真拿两台设备对着看才发现得了的差别。
///
/// 做成修饰符而不是一个包一层 `Color.clear` 的容器视图：调用方本来就是「列表 + 一个 sheet」，
/// 修饰符长在这个列表上，没有多出来的一层。
private struct NewSessionSheetModifier: ViewModifier {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Binding var isPresented: Bool
    let onOpenCreated: (String) -> Void

    /// 打开一个手机刚刚让电脑建出来的终端。
    ///
    /// 与「用户挑了哪一行」是两件事：那个 id 是电脑亲口回给我们的，它一定存在，
    /// 不必过 `RootView` 那道「还开不开得开」的闸门（拿那道闸门去问，用户按下
    /// 「开始对话」得到的第一句话会是「这个会话已经结束了」—— 列表还没跟上的那一下）。
    private func openNewlyCreated(_ sessionId: String) {
        display.setMode(.phoneDriven, for: sessionId)
        onOpenCreated(sessionId)
    }

    func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented) {
            NewSessionSheet(
                onCreated: { groupId in
                    Task {
                        if let created = await model.createSession(groupId: groupId) {
                            openNewlyCreated(created)
                        }
                    }
                },
                onCommandLaunched: { groupId, commandId in
                    // 与普通终端落的是同一屏：在协议上它就是同一个东西 —— 一个终端，
                    // 附带一条启动命令。失败落 banner（见 `performReturningSession`）。
                    Task {
                        if let created = await model.launchCommand(groupId: groupId, commandId: commandId) {
                            openNewlyCreated(created)
                        }
                    }
                },
                onConversationStarted: { sessionId in
                    openNewlyCreated(sessionId)
                }
            )
        }
    }
}

extension View {
    /// 挂上会话创建 sheet。
    ///
    /// - Parameter onOpenCreated: 电脑刚把一个终端交给手机时调用，参数是会话 id。
    func newSessionSheet(
        isPresented: Binding<Bool>,
        onOpenCreated: @escaping (String) -> Void
    ) -> some View {
        modifier(NewSessionSheetModifier(isPresented: isPresented, onOpenCreated: onOpenCreated))
    }
}
```

- [ ] **Step 2: 让 `SessionListView` 用它**

在 `SessionListView.swift` 里删掉 `:93-120` 的整个 `.sheet(isPresented: $showingNewSession) { NewSessionSheet(…) }`，换成：

```swift
        .newSessionSheet(isPresented: $showingNewSession, onOpenCreated: onOpenCreated)
```

删掉 `:230-233` 的 `openNewlyCreated`，并删掉 `@Environment(TerminalDisplaySettings.self) private var display`（`:10`）**仅当**它在本文件里没有别的使用点 —— 先跑一次 `grep -n "display\." SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift` 确认；有残留使用就留着这个 environment。

- [ ] **Step 3: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 4: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Sessions/NewSessionPresentation.swift \
        SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift
git commit -m "refactor: 把会话创建 sheet 的装配抽成修饰符供两处共用"
```

---

### Task 9: 剪贴板历史页（`ClipboardHistoryView`）

`ClipboardList` 本身不自带 `NavigationStack`，这一页推在主页的栈里，所以 `title` 传 `nil`。同时给它加一个可选的 `desktopName`：列表头上要有当前电脑的名字，它是读者唯一能看出「现在读的是哪一台的」的地方。

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Terminal/ClipboardList.swift:14-23`（加 `desktopName`）、`:88-110`（`list` 包一层 `Section`）
- Modify: `SynapseMobile/SynapseMobile/Features/Terminal/TerminalShortcutPanel.swift:192`（传 `desktopName: nil`）
- Create: `SynapseMobile/SynapseMobile/Features/Home/ClipboardHistoryView.swift`

**Interfaces:**
- Consumes: `ClipboardList(entries:title:desktopName:onCopy:onClear:)`、`model.activeClipboardEntries` / `copyClipboardEntry(_:)` / `clearClipboardHistory(for:)`（`App/SynapseAppModel.swift:1482,1487,1497`）、`model.desktopName(_:)`
- Produces: `struct ClipboardHistoryView: View`（无 init 参数）

- [ ] **Step 1: 给 `ClipboardList` 加 `desktopName`**

在 `ClipboardList.swift` 的 `let title: String?`（`:19`）之后加：

```swift
    /// 列表头上那台电脑的名字。`nil` 不画头。
    ///
    /// 剪贴板是按电脑分桶的，而主页那一页不显示电脑选择器 —— 头里这个名字是读者唯一能
    /// 看出「现在读的是哪一台的」的地方。终端快捷面板那一份传 `nil`：面板本来就在某台
    /// 电脑的一个会话里，不必再问是哪一台。
    let desktopName: String?
```

把 `list`（`:88-110`）换成：

```swift
    private var list: some View {
        List {
            // 一行不落地包在 `Section` 里，是因为头只能挂在 Section 上。`desktopName`
            // 为 `nil` 时这个 header 是空视图，系统不画那一条 —— 面板那一份的渲染不变。
            Section {
                ForEach(entries) { entry in
                    row(entry)
                }
            } header: {
                if let desktopName {
                    Text(desktopName)
                }
            }
        }
        .listStyle(.insetGrouped)
        // 空态铺在列表**上面**，而不是当作 `List` 里的一行：`ContentUnavailableView`
        // 要的是整块内容区，塞进列表会先被压成一条窄行。
        //
        // 标识符挂在说明那行而不是整个组件上：`ContentUnavailableView` 是容器，
        // 标识符挂在它身上元素类型会变成 other，而用例查的是 `staticTexts[...]`。
        .overlay {
            if entries.isEmpty {
                ContentUnavailableView {
                    Label("还没有可粘贴的内容", systemImage: "doc.on.clipboard")
                } description: {
                    Text("电脑上复制的文本会出现在这里。")
                        .accessibilityIdentifier("clipboard-empty")
                }
            }
        }
    }
```

- [ ] **Step 2: 更新终端快捷面板那一处调用**

`TerminalShortcutPanel.swift:192` 的 `ClipboardList(` 调用，在 `title:` 之后补 `desktopName: nil,`。

- [ ] **Step 3: 写 `ClipboardHistoryView`**

创建 `SynapseMobile/SynapseMobile/Features/Home/ClipboardHistoryView.swift`：

```swift
import SwiftUI

/// 主页功能里的「剪贴板历史」。
///
/// 就是 `ClipboardList` 的一层壳。它自己不自带 `NavigationStack`，而这一页推在主页的栈里
/// —— 栈已经有了，所以 `title` 传 `nil`：清空按钮并进这一页的导航栏，不另画一条。
///
/// 它在「功能」里而不是在终端里，因为它不绑定任何一个终端会话：不选会话也能进，
/// 选了会话也不影响它。挪出来之后终端列表那一页只剩设备行加会话。
struct ClipboardHistoryView: View {
    @Environment(SynapseAppModel.self) private var model

    var body: some View {
        ClipboardList(
            entries: model.activeClipboardEntries,
            title: nil,
            desktopName: model.selectedDesktopClientInstanceId.map { model.desktopName($0) },
            onCopy: { model.copyClipboardEntry($0) },
            onClear: { model.clearClipboardHistory(for: model.selectedDesktopClientInstanceId) }
        )
        .navigationTitle("剪贴板历史")
        .noticeOverlay(model)
    }
}
```

- [ ] **Step 4: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 5: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Terminal/ClipboardList.swift \
        SynapseMobile/SynapseMobile/Features/Terminal/TerminalShortcutPanel.swift \
        SynapseMobile/SynapseMobile/Features/Home/ClipboardHistoryView.swift
git commit -m "feat: 加入剪贴板历史页，列表头显示当前电脑名"
```

---

### Task 10: 终端列表移除剪贴板入口

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift:317-332`（删 sheet）、`:365-381`（删 `clipboardButton`）、`:314`（删挂载）、`:22`（删 `@State private var showingClipboard`）

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除）

**边界：只删会话列表设备行上的那一个入口。** `TerminalShortcutPanel` 里的剪贴板分段**不动** —— 那是某台电脑某个会话内的上下文入口（「我现在就要看这台机器刚复制的东西」），不是目录。剪贴板的目录入口从此只有主页功能里那一处。

- [ ] **Step 1: 删掉 sheet 与挂载**

- 删 `:22` 的 `@State private var showingClipboard = false`
- 删 `:317-332` 整段 `.sheet(isPresented: $showingClipboard) { ClipboardList(…) }`
- 删 `:314` 附近 `deviceSection` 里挂 `clipboardButton` 的那一处（读一遍 `:305-345` 确认它在哪个 HStack 里，把那一项连同它前面的 `Spacer` 之类的排布残留一起清掉）
- 删 `:365-381` 的 `clipboardButton` 定义

- [ ] **Step 2: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 3: 真机/模拟器上看一眼设备行**

确认设备行仍然是「设备名 + 在线状态 + 切换菜单」，没有多出来的空白或错位的箭头。

- [ ] **Step 4: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Sessions/SessionListView.swift
git commit -m "feat: 终端列表设备行不再挂剪贴板入口"
```

---

### Task 11: 主页（`HomeView` + `HomeRoute`）

**Files:**
- Create: `SynapseMobile/SynapseMobile/Features/Home/HomeRoute.swift`
- Create: `SynapseMobile/SynapseMobile/Features/Home/HomeView.swift`

**Interfaces:**
- Consumes: `model.waitingSessions`（`App/SynapseAppModel.swift:1126`）、`model.notifications.unreadCount`、`model.meetings.meetings.count`（`App/SynapseAppModel.swift:365` + `Features/Meeting/MeetingStore.swift:14`）、`model.selectedDesktopClientInstanceId`、`model.viewedDesktopIsOffline`、`PermissionRow` 无关
- Produces:
  - `enum HomeRoute: Hashable { case recordings, clipboard }`
  - `struct HomeView: View`，init 为 `HomeView(onOpenNotifications:onOpenRecordings:onOpenClipboard:onNewSession:onOpenWaitingSession:)`

- [ ] **Step 1: 写 `HomeRoute`**

创建 `SynapseMobile/SynapseMobile/Features/Home/HomeRoute.swift`：

```swift
import Foundation

/// 主页栈里的落点。
///
/// 只有两个 ——「新建会话」不在这里：它是一张 sheet，而 sheet 不是栈上的一层。
/// 把它做成页面意味着拆掉 `NewSessionSheet` 内部那套项目 / 供应商 / 模型的三层下钻
/// 再照着主页的栈重搭一遍，买不到任何东西。
enum HomeRoute: Hashable {
    case recordings
    case clipboard
}
```

- [ ] **Step 2: 写 `HomeView`**

创建 `SynapseMobile/SynapseMobile/Features/Home/HomeView.swift`：

```swift
import SwiftUI

/// 主页：所有入口，以及「有没有人需要你」。
///
/// 它是本次导航改版的落点 —— 底栏不再为每一个功能开一格，新能力一律进这里的「功能」清单，
/// 所以这一页会长，而底栏永远是三格。
///
/// 顶上那张待处理卡只在真有会话卡住时出现。它和终端列表行上的琥珀徽章读的是同一份
/// `waitingSessions`，不引入第二套状态；没有内容就不占位置。
struct HomeView: View {
    @Environment(SynapseAppModel.self) private var model

    let onOpenNotifications: () -> Void
    let onOpenRecordings: () -> Void
    let onOpenClipboard: () -> Void
    let onNewSession: () -> Void
    /// 打开一个正卡着等人的会话。参数是会话 id。
    let onOpenWaitingSession: (String) -> Void

    var body: some View {
        List {
            if !model.waitingSessions.isEmpty {
                Section { attentionCard }
                    .listSectionSpacing(.compact)
            }

            Section {
                row(
                    title: "录音",
                    subtitle: "会议录音、转写与回听",
                    symbol: "waveform",
                    value: recordingCount,
                    action: onOpenRecordings
                )
                row(
                    title: "新建会话",
                    subtitle: "在当前电脑上开一个终端",
                    symbol: "plus",
                    value: nil,
                    action: onNewSession
                )
                .disabled(newSessionUnavailable)
                row(
                    title: "剪贴板历史",
                    subtitle: "这台电脑上复制过的内容",
                    symbol: "doc.on.clipboard",
                    value: nil,
                    action: onOpenClipboard
                )
            } header: {
                Text("功能")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("主页")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { bell }
        }
    }

    /// 常驻的那一枚铃铛。
    ///
    /// 角标用系统红，不跟 `Theme.attention`：底栏主页那一格的未读数由系统 `.badge`
    /// 画，也是这个红，两处读的是同一个数字，颜色不一致就会像两套计数。红在这里只
    /// 表示「有未读」，不表示出错；琥珀仍然只留给「有人在等你回话」。
    ///
    /// 角标挑在铃铛框的右上角外，所以**这一层不能被裁剪**：以后给这个按钮加背景或
    /// 圆角时不要顺手加 `clipShape`，那会把角标切掉一半。
    private var bell: some View {
        Button(action: onOpenNotifications) {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if model.notifications.unreadCount > 0 {
                        Text("\(model.notifications.unreadCount)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Color(uiColor: .systemRed), in: Capsule())
                            .offset(x: 9, y: -8)
                    }
                }
        }
        .accessibilityIdentifier("home-notifications")
        .accessibilityLabel(
            model.notifications.unreadCount > 0
                ? "通知，\(model.notifications.unreadCount) 条未读"
                : "通知"
        )
    }

    /// 「N 个会话在等你」。
    ///
    /// 一条时直接进那个会话；多条时打开通知面板的「待处理」段 —— 卡片上写着 N，
    /// 却只把人送进其中一个，另外几个就藏起来了。
    private var attentionCard: some View {
        Button {
            let waiting = model.waitingSessions
            if waiting.count == 1, let only = waiting.first {
                onOpenWaitingSession(only.id)
            } else {
                onOpenNotifications()
            }
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(Theme.attention)
                    .frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(model.waitingSessions.count) 个会话在等你")
                        .font(.headline)
                        .foregroundStyle(Theme.attention)
                    Text("终端有输出，需要你回复")
                        .font(.subheadline)
                        .foregroundStyle(Theme.attention)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.attention)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
        .listRowBackground(Theme.attentionFill)
        .accessibilityIdentifier("home-attention")
    }

    /// 录音条数。为 0 时不显示值 —— 一个写着「0 条」的入口是在报告空，不是在报告有什么。
    private var recordingCount: String? {
        let count = model.meetings.meetings.count
        return count > 0 ? "\(count) 条" : nil
    }

    /// 与终端列表右上角那个 ＋ 同一条判据：电脑不在，建出来的东西会被一台没听说过它的
    /// 电脑拒绝。
    private var newSessionUnavailable: Bool {
        model.selectedDesktopClientInstanceId == nil || model.viewedDesktopIsOffline
    }

    private func row(
        title: String,
        subtitle: String,
        symbol: String,
        value: String?,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if let value {
                    Text(value)
                        .foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home-feature-\(title)")
    }
}
```

- [ ] **Step 3: 编译检查**

`HomeView` 此刻还没有调用方，但它在 `SynapseMobile` target 里会被编译。

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 4: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Home/HomeRoute.swift \
        SynapseMobile/SynapseMobile/Features/Home/HomeView.swift
git commit -m "feat: 加入主页，待处理卡与功能清单"
```

---

### Task 12: 通知面板（`InboxView` → `NotificationPanel`）

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Inbox/InboxView.swift`（去 selection、行改 Button、删 `NotificationDetailView`）
- Create: `SynapseMobile/SynapseMobile/Features/Inbox/NotificationPanel.swift`

**Interfaces:**
- Consumes: `NotificationDestination.resolve(_:)`（Task 1）、`NotificationRouter.shared.route(to:)`（`Core/Push/NotificationRouter.swift:35`）、`model.reloadNotifications(filter:)` / `readAllNotifications()` / `loadMoreNotifications()` / `deleteNotification(_:)` / `readNotification(_:)`（`App/SynapseAppModel.swift:538,551,542,555,546`）、`model.waitingSessions`、`model.refreshDesktops()`
- Produces:
  - `InboxView(onOpenTerminal:)`（原 `InboxView(selection:onOpenTerminal:)` 去掉 selection）
  - `struct NotificationPanel: View`，init 为 `NotificationPanel(onOpenTerminal:)`

- [ ] **Step 1: 改造 `InboxView`**

在 `InboxView.swift` 里：

- 删 `@Binding var selection: String?`（`:16`）
- `.navigationTitle("消息")`（`:81`）删掉（面板不叫「消息」，标题由面板给）
- `notificationRow`（`:120-141`）改成不依赖 selection 的行。`.swipeActions` 里 `if selection == item.id { selection = nil }` 一并删掉；改成点行时调新的 `onOpen(item)`：

```swift
    private func notificationRow(_ item: SynapseNotification) -> some View {
        Button {
            onOpen(item)
        } label: {
            NotificationRow(item: item)
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Haptics.warning()
                Task { await model.deleteNotification(item.id) }
            } label: {
                Label("删除", systemImage: "trash")
            }
            .tint(Color(uiColor: .systemRed))
        }
    }
```

- 给 `InboxView` 加一个 `let onOpen: (SynapseNotification) -> Void`。**声明在 `onOpenTerminal` 之后**，这样调用方才能用尾随闭包写法 `InboxView(onOpenTerminal: …) { item in … }`：

```swift
struct InboxView: View {
    /// 「待处理」段里的行打开一个终端会话。
    let onOpenTerminal: (String) -> Void
    /// 一条消息被点了。去向由调用方决定 —— 列表自己不做路由。
    let onOpen: (SynapseNotification) -> Void
```

`onOpenTerminal` 保留，因为「待处理」段读的不是消息记录而是实时会话列表，它那几行点开的是会话。
- 删掉 `NotificationDetailView`（`:282-368`）整个结构体

- [ ] **Step 2: 写 `NotificationPanel`**

创建 `SynapseMobile/SynapseMobile/Features/Inbox/NotificationPanel.swift`：

```swift
import SwiftUI

/// 通知面板。主页右上角那枚铃铛打开的就是它。
///
/// 它是一个**覆盖层**，不是一个位置 —— 通知的意义是「带你去某个地方」，读完它本身没有
/// 价值。所以点一条就把它收起来，直接去往目标：比「进一个消息位置 → 列表 → 详情 → 再跳转」
/// 少两步。
///
/// 取消详情页的代价是正文只能进到行里（最多两行）。这是划算的：通知的正文几乎总是
/// 一句话能说完的，而它要换来的那两步，是每一次点通知都要付的。
struct NotificationPanel: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// 「待处理」段里的行打开一个终端会话。
    let onOpenTerminal: (String) -> Void

    var body: some View {
        NavigationStack {
            InboxView(onOpenTerminal: openTerminal) { item in
                open(item)
            }
            .navigationTitle("通知")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // sheet 会盖住底层屏幕挂的那条通知覆盖层，所以这一层要自己再挂一次 ——
        // 与剪贴板 sheet 同一个做法。
        .noticeOverlay(model)
    }

    /// 点一条通知：先标已读，再按它自己的去向往外走。
    ///
    /// 走之前就收起来。留着一个盖住目标的 sheet，等于让人再点一次「完成」才看得见
    /// 他刚刚要求去的地方。
    private func open(_ item: SynapseNotification) {
        Task { await model.readNotification(item.id) }
        switch NotificationDestination.resolve(item) {
        case .route(let destination):
            dismiss()
            NotificationRouter.shared.route(to: destination)
        case .externalURL(let url):
            dismiss()
            openURL(url)
        case .none:
            // 没有去处的那一类留在原地读 —— 收起面板等于把它从眼前拿走。
            break
        }
    }

    private func openTerminal(_ sessionId: String) {
        dismiss()
        onOpenTerminal(sessionId)
    }
}
```

- [ ] **Step 3: 编译检查**

此刻 `RootView.swift:197-213` 仍然用着 `InboxView(selection:…)` 与 `NotificationDetailView`，所以这一步会编译失败。把 `RootView` 的那一段**临时**改成只留面板（正式改写是 Task 13）：

```swift
            AdaptiveFeatureNavigation(
                selection: $inboxSelection,
                emptyTitle: "选择消息",
                emptySymbol: "bell"
            ) {
                InboxView(onOpenTerminal: { sessionId in
                    selectedTab = .terminals
                    requestTerminal(sessionId)
                }) { item in
                    NotificationRouter.shared.route(to: .message(id: item.id))
                }
            } detail: { _ in
                EmptyView()
            }
            .tabItem { Label("消息", systemImage: "bell") }
            .badge(model.notifications.unreadCount)
            .tag(Tab.inbox)
```

这是一处**只在本次提交里存在的中间态**，Task 13 会把它整段删掉。它存在的意义是让本 Task 的改动可以单独编译、单独跑一次。

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。

- [ ] **Step 4: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Inbox/InboxView.swift \
        SynapseMobile/SynapseMobile/Features/Inbox/NotificationPanel.swift \
        SynapseMobile/SynapseMobile/Features/Root/RootView.swift
git commit -m "feat: 通知改为覆盖面板，取消通知详情页"
```

---

### Task 13: 底栏收敛为三格与深链改写（`RootView`）

本改版的拱顶石。`Tab` 从四项收敛为三项，主页接入 `HomeView` 与它自己的导航栈，通知面板改为 sheet，五条深链的落点全部改写。

**Files:**
- Modify: `SynapseMobile/SynapseMobile/Features/Root/RootView.swift`（`:10-25` 状态与枚举、`:106-115` 角标、`:126-131`、`:143-167`、`:169-222`、`:225-274`、`:81-93`）
- Modify: `SynapseMobile/SynapseMobile/Features/Settings/SettingsView.swift`（Task 6 里那个 `onOpenNotificationCenter: () -> Void = {}` 占位改成必传）

**Interfaces:**
- Consumes: `HomeView` / `HomeRoute`（Task 11）、`NotificationPanel`（Task 12）、`ClipboardHistoryView`（Task 9）、`NewSessionSheetModifier`（Task 8）、`NotificationBadgePreference`（Task 2）、`AdaptiveFeatureNavigation`、`AdaptiveSettingsView`、`MeetingListView` / `MeetingDetailView`、`SessionListView` / `TerminalScreen`
- Produces: `RootView` 的新形态；`popToRoot` / `handleRoute` 的新行为

- [ ] **Step 1: 改状态与枚举**

`RootView.swift:10-25` 换成：

```swift
    @State private var selectedTab = Tab.home
    @State private var terminalSelection: String?
    @State private var meetingSelection: String?
    /// 主页栈。`homePath` 而不是一个 `NavigationPath`：这一条栈窄到只有两个落点，
    /// 用得上「这一层是录音还是剪贴板」这个类型信息。
    @State private var homePath: [HomeRoute] = []
    @State private var settingsSelection: SettingsCategory?
    @State private var pendingWidgetTarget: TerminalWidgetLink.Target?
    @State private var isNotificationPanelPresented = false
    @State private var isNewSessionPresented = false
    /// 一个还没能判定的打开终端请求。
    ///
    /// 只在一种情况下存在：请求带来了一个会话 id，而**当下没有一份属于那台电脑的列表**可问
    /// （刚冷启动、刚切过电脑）。那不是「这个终端没有了」，是什么都还不知道，所以要留住它，
    /// 等下一份列表到了再判 —— 丢掉它就等于把用户点的那一下当作没发生。
    @State private var pendingTerminalOpen: PendingTerminalOpen?

    private enum Tab: Hashable {
        case home, terminals, settings
    }
```

`inboxSelection` 一并删除。

- [ ] **Step 2: 角标改成读偏好**

`:106-115` 换成：

```swift
        .onChange(of: model.notifications.unreadCount) { _, count in
            writeBadge(unreadCount: count)
        }
        .onChange(of: badgeEnabled) { _, _ in
            writeBadge(unreadCount: model.notifications.unreadCount)
        }
```

并加一个 `@AppStorage(NotificationBadgePreference.key) private var badgeEnabled = true`，以及方法：

```swift
    /// 写作 App 图标角标的数字。
    ///
    /// 关心的是「图标角标」这一个开关：底栏那一格的未读数与主页铃铛上的琥珀角标
    /// 都是应用内的，不经过系统通知中心的许可，也不受这个开关牵连。
    private func writeBadge(unreadCount: Int) {
        let badge = NotificationBadgePreference.badgeCount(unreadCount: unreadCount)
        Task {
            // 写角标不需要权限，但需要用户至少允许过通知。这个 App 把推送当作尽力而为
            // —— 没有它一切照常 —— 所以一次拒绝不是值得上报的错误，这里也没有上报它的 UI。
            try? await UNUserNotificationCenter.current().setBadgeCount(badge)
        }
    }
```

- [ ] **Step 3: 改 `popToRoot`**

`:156-167` 换成：

```swift
    private func popToRoot(_ tab: Tab) {
        switch tab {
        case .home:
            homePath = []
            meetingSelection = nil
        case .terminals:
            terminalSelection = nil
            // 「回到这一屏的列表」把等着的那个打开请求也一并作废：人已经往下走了，
            // 再把他拽进一个终端页不是他要的。
            pendingTerminalOpen = nil
        case .settings: settingsSelection = nil
        }
    }
```

- [ ] **Step 4: 改 `tabs`**

`:169-222` 换成：

```swift
    private var tabs: some View {
        TabView(selection: tabSelection) {
            // 主页有自己的一条栈，因为它是「列表 + 可下钻」：功能清单 → 录音列表 →
            // 录音详情。推入的 `AdaptiveFeatureNavigation` 自己就是一个
            // `NavigationSplitView`，所以 iPadOS 宽窗下录音仍然并排 —— 不要再为它
            // 外面套一层分栏，那会变成系统侧边栏 + 列表 + 详情三列。
            NavigationStack(path: $homePath) {
                HomeView(
                    onOpenNotifications: { isNotificationPanelPresented = true },
                    onOpenRecordings: { homePath.append(.recordings) },
                    onOpenClipboard: { homePath.append(.clipboard) },
                    onNewSession: { isNewSessionPresented = true },
                    onOpenWaitingSession: openWaitingSession
                )
                .navigationDestination(for: HomeRoute.self) { route in
                    switch route {
                    case .recordings:
                        AdaptiveFeatureNavigation(
                            selection: $meetingSelection,
                            emptyTitle: "选择录音",
                            emptySymbol: "waveform"
                        ) {
                            MeetingListView(selection: $meetingSelection)
                        } detail: { meetingId in
                            MeetingDetailView(meetingId: meetingId) { meetingSelection = nil }
                        }
                    case .clipboard:
                        ClipboardHistoryView()
                    }
                }
            }
            .tabItem { Label("主页", systemImage: "house") }
            // 系统角标，颜色不改。SwiftUI 的 `TabView` 没有自定义 tab 角标颜色的 API，
            // 桥接 `UITabBarItem` 只在 iPhone 底栏生效、iPadOS 侧边栏做不到同色。
            // 「有人需要你」的琥珀色由主页里那枚铃铛自绘承担。
            .badge(model.notifications.unreadCount)
            .tag(Tab.home)

            AdaptiveFeatureNavigation(
                selection: terminalEntry,
                emptyTitle: "选择会话",
                emptySymbol: "terminal"
            ) {
                SessionListView(selection: terminalEntry, onOpenCreated: openFreshTerminal)
            } detail: { sessionId in
                TerminalScreen(sessionId: sessionId) { terminalSelection = nil }
            }
            .tabItem { Label("终端", systemImage: "terminal") }
            .tag(Tab.terminals)

            AdaptiveSettingsView(selection: $settingsSelection) {
                terminalSelection = nil
            } onOpenNotificationCenter: {
                isNotificationPanelPresented = true
            }
            .tabItem { Label("我的", systemImage: "person") }
            .tag(Tab.settings)
        }
        .tabViewStyle(.sidebarAdaptable)
        .sheet(isPresented: $isNotificationPanelPresented) {
            NotificationPanel(onOpenTerminal: openWaitingSession)
                .noticeOverlay(model)
        }
        .newSessionSheet(isPresented: $isNewSessionPresented, onOpenCreated: openFreshTerminal)
    }
```

`AdaptiveSettingsView` 需要把新的 `onOpenNotificationCenter` 透传给 `SettingsView`：

```swift
struct AdaptiveSettingsView: View {
    @Binding var selection: SettingsCategory?
    let onSelectDesktop: () -> Void
    /// 打开通知面板。「我的 → 通知」里那一行要用。
    let onOpenNotificationCenter: () -> Void

    var body: some View {
        AdaptiveFeatureNavigation(
            selection: $selection,
            emptyTitle: "选择设置",
            emptySymbol: "gearshape"
        ) {
            SettingsCategoriesView(selection: $selection)
        } detail: { category in
            NavigationStack {
                SettingsView(
                    category: category,
                    onSelectDesktop: onSelectDesktop,
                    onOpenNotificationCenter: onOpenNotificationCenter
                )
            }
        }
    }
}
```

`SettingsView` 的 `onOpenNotificationCenter` 参数去掉默认值（Task 6 里给的那个 `= {}` 占位在此撤销）。

- [ ] **Step 5: 改 `handleRoute`**

`:225-274` 换成：

```swift
    /// 外部请求（通知、Widget、锁屏卡片）带来一个去向，把它落到界面上。
    private func handleRoute(_ destination: NotificationRouter.Destination?) {
        guard let destination else { return }
        switch destination {
        case .terminal(let sessionId, let desktopClientInstanceId):
            // Naming a computer is the reader saying which one they mean, so this is
            // honoured even when that computer is not reachable — landing them on
            // another one instead is the behaviour the switch exists to remove.
            model.selectDesktop(desktopClientInstanceId)
            selectedTab = .terminals
            // Only when that computer can actually open it. Selecting the terminal anyway
            // would show a screen with nothing in it and nothing to say; the list, whose
            // device row is now the way to switch, says what happened and what to do.
            //
            // 「能打开」是两个条件：那台电脑在线，**而且**它的列表里还有这个会话。
            if !model.viewedDesktopIsOffline {
                requestTerminal(sessionId, on: desktopClientInstanceId)
            }
        case .meeting(let meetingId):
            // 转写结果在服务端，不依赖任何一台电脑，所以这里不需要选桌面。
            selectedTab = .home
            homePath = [.recordings]
            meetingSelection = meetingId
        case .message(let id):
            // 一条通知的去向由**它自己**决定，不再有一个「消息」位置可落。
            openNotification(id)
        case .newRecording:
            // 主屏长按图标那一条。先把人带到录音列表，再让录音页自己浮出来——否则
            // 用户看到的是一片别的界面盖着一张录音页，退出之后不知道自己回到了哪。
            selectedTab = .home
            homePath = [.recordings]
            meetingSelection = nil
            model.isRecordingPresented = true
        case .liveRecording:
            // 锁屏那张卡。同样先落到录音列表，但**只在真的在录的时候**才把录音页浮
            // 出来：起新录音是 `.newRecording` 的事，这里只负责把人带到那一条跟前。
            selectedTab = .home
            homePath = [.recordings]
            meetingSelection = nil
            if model.recording.isRecording {
                model.isRecordingPresented = true
            } else {
                // 卡片还在、录音却没了：App 被系统杀掉过（系统最长把实时活动留 8 小时）。
                // 那条录音会在启动时被静默收尾、照常出现在列表里，所以这里只把锁屏上
                // 那条已经不作数的活动收掉，不凭空起一条新的。
                Task { await RecordingActivityHousekeeping.endOrphans() }
            }
        }
    }

    /// 一条通知被点开之后去哪。
    ///
    /// 先拉一次列表再判：一条通知记着的是「它完成那一轮时」的会话 id，那条会话后来
    /// 结束了、被删了都不会让这条记录失效，所以这个 id 今天还指不指得动要当场问一次。
    /// 列表到达之后才解析，是因为 `DeviceId` / `targetId` 都在通知自己身上，
    /// 而解析要用的 `model.notifications.items` 也在这一刻才更新。
    private func openNotification(_ id: String) {
        Task {
            await model.reloadNotifications()
            guard let item = model.notifications.items.first(where: { $0.id == id }) else {
                // 拉回来却没有这一条（已过期、已在别处删掉）。打开面板，让人自己看
                // 手上到底还有什么 —— 比什么都不做要好。
                isNotificationPanelPresented = true
                return
            }
            await model.readNotification(item.id)
            switch NotificationDestination.resolve(item) {
            case .route(let destination):
                handleRoute(destination)
            case .externalURL, .none:
                // 没有应用内的去处。打开面板让人读它自己。
                isNotificationPanelPresented = true
            }
        }
    }
```

- [ ] **Step 6: 加 `openWaitingSession`**

在 `openPendingWidgetTarget` 之后加：

```swift
    /// 从主页那张待处理卡进一个会话。
    ///
    /// 走 `requestTerminal` 同一道闸门：那条会话可能在卡片画出来与手指落下去之间结束掉。
    private func openWaitingSession(_ sessionId: String) {
        selectedTab = .terminals
        requestTerminal(sessionId)
    }
```

- [ ] **Step 7: 改登出清理**

`:81-93` 的 `onChange(of: model.authState)` 里，`inboxSelection = nil` 换成 `homePath = []`，并补上面板与录音页；`selectedTab = .terminals` 换成 `.home`：

```swift
        .onChange(of: model.authState) { _, state in
            if state == .signedOut {
                terminalSelection = nil
                meetingSelection = nil
                homePath = []
                settingsSelection = nil
                isNotificationPanelPresented = false
                isNewSessionPresented = false
                // 一个等着判定的打开请求也是「按会话 id 记住的东西」，登出之后它连属于
                // 哪台电脑都无从谈起。
                pendingTerminalOpen = nil
                selectedTab = .home
            }
            resolveExternalTerminalRequests()
        }
```

- [ ] **Step 8: 编译检查**

Run:
```bash
xcodebuild build -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```
Expected: `BUILD SUCCEEDED`。若报 `Tab.inbox` / `Tab.meetings` 找不到，说明还有残留引用，逐个清掉。

- [ ] **Step 9: 在模拟器上走一遍骨架**

装上去，确认：底栏三格且第一格是主页、冷启动落主页、主页上待处理卡与三行功能都在、铃铛能开出面板、终端与我的都在原来那两格上、终端会话页仍然隐藏底栏。

- [ ] **Step 10: 提交**

```bash
git add SynapseMobile/SynapseMobile/Features/Root/RootView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/AdaptiveSettingsView.swift \
        SynapseMobile/SynapseMobile/Features/Settings/SettingsView.swift
git commit -m "feat: 底栏收敛为三格并把通知与录音的落点改到主页"
```

---

### Task 14: 修正既有 UI 测试的 tab 索引，补一个导航骨架用例

**Files:**
- Modify: `SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift:63-79,197-198`
- Modify: `SynapseMobile/SynapseMobileUITests/TerminalGitUITests.swift:356-357`
- Create: `SynapseMobile/SynapseMobileUITests/NavigationStructureUITests.swift`

**Interfaces:**
- Consumes: `XCUIApplication`、既有登录辅助（从 `TerminalFlowUITests.signIn(_:)` 抄一份到新文件，或把新用例放进 `TerminalFlowUITests` 同一个类里 —— 选后者可以复用 `email` / `password` / `baseURL` / `barLaunchArguments` / `signIn`，少一份重复）
- Produces: 无

- [ ] **Step 1: 改三处索引**

三格之后主页 = 0、终端 = 1、我的 = 2。在 `TerminalFlowUITests` 里加一个常量组：

```swift
    /// 底栏的下标。三格之后主页占了 0，终端从 0 挪到 1。
    ///
    /// 用下标而不是按标签找，是因为**角标会改写它所在那一格的 accessibility label**
    /// ——「主页」带着未读数时 `buttons["主页"]` 会时灵时不灵。这个理由写在下面那段
    /// 原来就有的注释里，换成一个有名字的常量只是让它不必每次移动都逐个改数字。
    private enum TabIndex {
        static let home = 0
        static let terminals = 1
        static let settings = 2
    }
```

- `:63-71`：把「顺序是终端 / 录音 / 需要我 / 我的」那段注释改成「顺序是主页 / 终端 / 我的」，并把 `element(boundBy: 2)` 改成去主页看通知面板：

```swift
        // A locked-out Agent surfaces on the home page's attention card, and the
        // notifications panel is one tap further in. Tabs are addressed by index
        // because a badge rewrites the accessibility label of the tab it sits on —
        // which is now the home tab, since it carries the unread count.
        //
        // The order is 主页 / 终端 / 我的 — `RootView`'s `TabView`, in that order.
        let tabs = app.tabBars.firstMatch
        tabs.buttons.element(boundBy: TabIndex.home).tap()
        XCTAssertTrue(
            app.buttons["home-attention"].waitForExistence(timeout: 8),
            "the home page did not report a waiting session"
        )
        app.buttons["home-notifications"].tap()
        capture(app, name: "02-notifications")
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 8),
            "the notifications panel did not show the waiting session"
        )
        XCTAssertTrue(app.staticTexts["请求执行一个命令"].exists, "the panel lost the waiting reason")
```

- `:79` 的 `element(boundBy: 0)` → `element(boundBy: TabIndex.terminals)`
- `:198` 的 `element(boundBy: 3)` → `element(boundBy: TabIndex.settings)`，并把 `:197` 那句「index 3 since 录音 took 1」的注释改成「index 2 —— 主页占了 0、终端占了 1」
- `TerminalGitUITests.swift:357` 的 `element(boundBy: 0)` → `element(boundBy: 1)`，`:356` 注释改成「终端是第二个标签页（主页占了第一个）」

- [ ] **Step 2: 写导航骨架用例**

在 `TerminalFlowUITests` 里加（放在 `testSignInBrowseSessionsAndOpenTerminal` 之前）：

```swift
    /// 底栏结构与「不新增槽位」这条硬规则。
    ///
    /// 一条**会失败的**用例，而不是一条描述现状的用例：底栏从四格变三格是设计上要买的东西，
    /// 下一个人加第四个 tab 时，这里要红。
    func testBottomBarHasExactlyThreeTabsAndHomeIsTheDefault() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()

        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 20), "the bottom bar never appeared")

        // 数量先于位置：位置错了还能一眼看出，少一格或多一格不会。
        XCTAssertEqual(tabs.buttons.count, 3, "the bottom bar must stay at three tabs")

        // 冷启动落主页。
        XCTAssertTrue(
            app.buttons["home-attention"].exists || app.buttons["home-feature-录音"].exists,
            "the app did not open on the home page"
        )
        XCTAssertTrue(app.staticTexts["主页"].exists, "the home page has no title")

        // 三件功能都在，且「新建会话」是中间那一行。
        XCTAssertTrue(app.buttons["home-feature-录音"].exists, "the recordings entry is missing")
        XCTAssertTrue(app.buttons["home-feature-新建会话"].exists, "the new-session entry is missing")
        XCTAssertTrue(app.buttons["home-feature-剪贴板历史"].exists, "the clipboard entry is missing")

        // 铃铛是通知的唯一常驻入口。
        XCTAssertTrue(app.buttons["home-notifications"].exists, "the home page has no bell")
    }
```

- [ ] **Step 3: 跑这一个用例**

需要服务端与模拟桌面端在跑。按 `SynapseMobile/README.md` 的「端到端测试」一节起好，然后：

```bash
xcodebuild test-without-building -xctestrun <…>.xctestrun \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/TerminalFlowUITests/testBottomBarHasExactlyThreeTabsAndHomeIsTheDefault \
  -parallel-testing-enabled NO
```
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add SynapseMobile/SynapseMobileUITests/TerminalFlowUITests.swift \
        SynapseMobile/SynapseMobileUITests/TerminalGitUITests.swift
git commit -m "test: 按三格底栏修正 tab 下标并加入底栏结构用例"
```

---

### Task 15: 文档同步与发布说明

**Files:**
- Modify: `docs/agents/mobile-adaptive-layout.md:7,28`
- Modify: `docs/agents/capability-registry.md:22`
- Modify: `docs/superpowers/specs/2026-09-23-account-notification-center-design.md:5,13`
- Modify: `SynapseMobile/README.md:5`（并补一小节）
- Modify: `AGENTS.md:70`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 改移动端布局规则**

`docs/agents/mobile-adaptive-layout.md:7`：

```
- 顶层「主页 / 终端 / 我的」使用系统 `TabView` 的自适应呈现：iPhone 为底部标签，iPadOS 可显示顶部标签或侧边栏。不要自行画一套与系统并行的全局导航。
- **底栏永远三格，不因任何理由增加第四个。** 新增能力一律进「主页 → 功能」清单：位置是稀缺资源，功能不是。功能超过十二项左右时给「功能」加搜索与「常用」置顶，而不是开新槽位。
```

`:28`：

```
- 「我的」在 iPhone 与 iPadOS 都是分类列表加下钻二级页，走同一条 `AdaptiveFeatureNavigation` 路径；宽窗列表与设置内容并排，紧凑窗单列。外层只放分类名，只有账号与电脑两行显示状态值。电脑选择与终端页使用同一份 `SynapseAppModel` 状态。
```

`:27` 里「消息筛选属于消息列表，不是顶层功能」一句改成：

```
- 通知是主页右上角铃铛打开的覆盖面板，不是顶层功能。面板里点一条直接去往目标并关闭；「待处理」段读的是实时会话列表，打开终端时跳到终端功能并选中对应会话。
```

**`:28` 为什么也要改：** 那一行写的是「iPhone 保持现有分组列表」，而现有分组列表是把四段设置平铺在一屏。七个分类之后那是错的（spec §6.5）。

- [ ] **Step 2: 改能力注册表**

`docs/agents/capability-registry.md:22`：

```
账号消息中心是桌面全局壳层面板与 iOS 主页右上角铃铛打开的通知面板，未注册新的 System App、Dock、Workflow、Automation、MCP 或 Deep Link；下表数量不变。System Notifier 的既有能力在用户已登录且在线时同步正式触发内容到消息中心，测试通知仍仅本机显示。
```

- [ ] **Step 3: 改账号消息中心规格**

`docs/superpowers/specs/2026-09-23-account-notification-center-design.md`：

- `:5` 「桌面全局消息面板与 iOS「消息」Tab 按账号读取同一份记录」→「桌面全局消息面板与 iOS 主页的通知面板按账号读取同一份记录」
- `:13` 「普通点按先按消息 ID 打开详情」→「普通点按先按消息 ID 取回那一条，再按它自己的目标直接去往会话或录音；没有目标或只有外部链接的，打开通知面板让人读。**通知详情页已取消**（见 `2026-09-25-mobile-navigation-restructure-design.md`）」

- [ ] **Step 4: 改移动端 README**

`SynapseMobile/README.md:5` 换成，并在其后补一小节：

```markdown
iPadOS 的可缩放窗口使用系统自适应标签栏和列表 / 详情分栏；窗口变窄时自动折叠为单列。移动端新页面的布局要求见[移动端布局规则](../docs/agents/mobile-adaptive-layout.md)。

## 导航结构

底栏三格，**不再增加**：

| 位置 | 放什么 |
|---|---|
| 主页 | 待处理会话、通知铃铛、功能清单（录音 / 新建会话 / 剪贴板历史） |
| 终端 | 电脑切换、会话列表、终端画布（进入后隐藏底栏） |
| 我的 | 七个分类，点进去才是设置 |

新能力一律进「主页 → 功能」，不为它开第四个槽位。通知是主页右上角铃铛打开的覆盖面板，
不是一格 tab；通知详情页已取消，正文进到行里，点一条直接去往目标。
```

- [ ] **Step 5: 改 `AGENTS.md`**

`:70` 「录音、消息和终端的现有业务状态不可因栏位折叠丢失。」→「录音、通知和终端的现有业务状态不可因栏位折叠丢失。」

- [ ] **Step 6: 写发布说明**

`RELEASE_NOTES_PENDING.md` 的「功能优化」小节下加五行。**只有五行，不加「问题修复」小节** —— 本改版没有修复任何用户能遇到的问题；底栏与「我的」的结构变化属于优化，不是修复。

```markdown
## 功能优化

- 手机端底栏改为「主页 / 终端 / 我的」三格，不再为单个功能占位置，以后的新功能会陆续出现在主页的功能清单里。
- 手机端通知不再占一格底栏：主页右上角的铃铛随时可打开通知面板，点一条直接去到对应的会话或录音，不再需要先打开通知再点进详情。
- 手机端「我的」改成分类列表，账号、电脑、终端、录音、通知、诊断、关于各自一页，不再把全部设置铺在同一屏。
- 手机端剪贴板历史移到主页的功能里（终端页设备行上那个入口取消），列表上方会写明是哪台电脑的。
- 手机端「我的 → 通知」可以关闭 App 图标上的角标。
```

**不要写版本号相关的任何一条。** 终端顶栏第二行的版本号在本改版里一个字都没动，而「关于」页新增那一行只是多了一个入口 —— 没有变化就没有可报告的，写进去反而会让人以为终端页那一行被搬走了。

- [ ] **Step 7: 提交**

```bash
git add docs/agents/mobile-adaptive-layout.md docs/agents/capability-registry.md \
        docs/superpowers/specs/2026-09-23-account-notification-center-design.md \
        SynapseMobile/README.md AGENTS.md RELEASE_NOTES_PENDING.md
git commit -m "docs: 同步手机端三格底栏的导航规则与发布说明"
```

---

## 收尾检查

全部 Task 完成后：

- [ ] `xcodebuild build` 通过，`SynapseMobileTests` 全绿。
- [ ] spec §10.2 的十条行为验证逐条走过（深链五条、待处理卡两种条数、面板点行、主页栈三层、重按回根、登出清理、七分类、新建会话置灰、剪贴板离线、四种窗口宽度）。
- [ ] spec §10.3 那条**必须实测**的：iPadOS 宽窗下主页推入的 `AdaptiveFeatureNavigation` 是否真的并排。不成立就照那里的回退方案改，并回头改 spec。
- [ ] `git log --oneline` 里每个 Task 一条提交，没有一条把别的任务的改动卷进去。
- [ ] `RELEASE_NOTES_PENDING.md` 只留真正的用户可感知变化。
