import Foundation
import XCTest

/// Drives the app against a running server.
///
/// A UI test rather than scripted taps because the simulator exposes no scripting
/// interface — this is the supported way to exercise the real network path,
/// decode real frames, and capture what the screens actually look like.
///
/// Requires the server, and a desktop acting as the terminal source, to be
/// running. Credentials and the server address come from the environment so the
/// test file carries no secrets:
///
///   SYNAPSE_TEST_EMAIL, SYNAPSE_TEST_PASSWORD, SYNAPSE_TEST_BASE_URL
final class TerminalFlowUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://localhost:3001/api"
    }

    /// 每一次启动都从「输入栏还没被选过」开始，也就是键盘态。
    ///
    /// 输入栏会记住上次选的是键盘还是语音，那个偏好是 App 自己的、跨用例留着
    /// （`InputBarUITests` 专测它）。这个文件里的用例用的都是键盘态那条栏：要往输入框
    /// 里打字的、要按 `＋` 的，语音态下输入框根本不在屏幕上，而它们会不会踩到语音态
    /// 取决于前面跑过哪些用例 —— 一次运行里跑全量时，InputBarUITests 就在它前面。
    ///
    /// 用启动参数钉住，而不是让每个用例自己去把栏摆回来：参数进的是 `UserDefaults`
    /// 的参数域，优先级高于存下来的值，而且**不改写**它 —— 钉住的只是这一次启动。
    /// 起手态，以及一个跑不完的"闲置"时长。
    ///
    /// 终端那三条栏闲置三秒会自己收起来（`AppConfiguration.terminalChromeIdleSeconds`），
    /// 而这些用例里有大量 15–90 秒的等待，等完之后 `toolbar-*` 早就不在屏幕上了 ——
    /// 失败会读成"工具栏不见了"，而不是"计时器"。这里把时长顶到一小时，机制一个字不改，
    /// 变的只有时钟。真正的三秒由 `ChromeAutoHideUITests` 用一秒的时长单独覆盖。
    private let barLaunchArguments = [
        "-terminal.inputBar.voiceMode", "NO",
        "-SynapseChromeIdleSeconds", "3600",
    ]

    /// 底栏的下标：主页、终端、通知、我的。
    ///
    /// 用下标而不是按标签找，是因为**角标会改写它所在那一格的 accessibility label**
    /// ——「主页」带着未读数时 `buttons["主页"]` 会时灵时不灵。这一条理由下面那段注释里
    /// 原来就有，换成一个有名字的常量只是让它不必每次移动都逐个改数字。
    private enum TabIndex {
        static let home = 0
        static let terminals = 1
        static let notifications = 2
        static let settings = 3
    }

    override func setUpWithError() throws {
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    /// Selection is local UI state; no delete, move, export, or upload is submitted.
    func testReviewOwnedDriveFolderSelectionTogglesOnlyThatRow() throws {
        guard let name = ProcessInfo.processInfo.environment["SYNAPSE_DRIVE_REVIEW_OWN_FOLDER"],
              name.hasPrefix("iOSReview-"), name.count > "iOSReview-".count else {
            throw XCTSkip("An explicitly owned review folder is required")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        app.tabBars.buttons.element(boundBy: TabIndex.home).tap()
        let drive = app.buttons["home-feature-云盘"].firstMatch
        XCTAssertTrue(drive.waitForExistence(timeout: 15) && drive.isHittable)
        drive.tap()

        let folder = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name + ", "))
        XCTAssertTrue(folder.firstMatch.waitForExistence(timeout: 15))
        XCTAssertEqual(folder.count, 1, "Only the explicitly owned folder may be toggled")
        let more = app.navigationBars.buttons["更多"].firstMatch
        XCTAssertTrue(more.exists && more.isHittable)
        more.tap()
        let select = app.buttons["选择"].firstMatch
        XCTAssertTrue(select.waitForExistence(timeout: 5) && select.isHittable)
        select.tap()

        func verifyCount(_ count: Int, _ stage: String) {
            XCTAssertTrue(app.staticTexts["已选 \(count) 项"].firstMatch.waitForExistence(timeout: 5))
            capture(app, name: stage)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = stage + "-ax"; tree.lifetime = .keepAlways; add(tree)
        }
        verifyCount(0, "drive-selection-empty")
        XCTAssertTrue(folder.firstMatch.isHittable)
        folder.firstMatch.tap()
        verifyCount(1, "drive-selection-one-owned-row")
        folder.firstMatch.tap()
        verifyCount(0, "drive-selection-owned-row-cleared")

        app.navigationBars.buttons["全选"].firstMatch.tap()
        let counters = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "已选 "))
        XCTAssertEqual(counters.count, 1)
        let components = counters.firstMatch.label.split(separator: " ")
        guard components.count == 3, let total = Int(components[1]), total > 1 else {
            XCTFail("The actual root list must provide multiple items for this selection check"); return
        }
        verifyCount(total, "drive-selection-all-local")
        folder.firstMatch.tap()
        verifyCount(total - 1, "drive-selection-only-owned-row-removed")
        folder.firstMatch.tap()
        verifyCount(total, "drive-selection-only-owned-row-restored")
        app.navigationBars.buttons["取消全选"].firstMatch.tap()
        verifyCount(0, "drive-selection-local-state-cleared")
        more.tap()
        let done = app.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5) && done.isHittable)
        done.tap()
        XCTAssertTrue(app.staticTexts["已选 0 项"].firstMatch.waitForNonExistence(timeout: 5))
    }

    /// 底栏结构与四个顶层分区。
    ///
    func testBottomBarHasExactlyFourTabsAndHomeIsTheDefault() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()

        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 20), "the bottom bar never appeared")

        // 数量先于位置：位置错了还能一眼看出，少一格或多一格不会。
        XCTAssertEqual(tabs.buttons.count, 4, "the bottom bar must have four tabs")

        // 第一格是主页。按前缀比而不是相等：主页那一格带着未读角标时，系统会把角标写进
        // 它的 accessibility label。
        XCTAssertTrue(
            tabs.buttons.element(boundBy: TabIndex.home).label.hasPrefix("主页"),
            "the first tab is not the home page"
        )
        XCTAssertTrue(tabs.buttons.element(boundBy: TabIndex.terminals).label.hasPrefix("终端"))
        XCTAssertTrue(tabs.buttons.element(boundBy: TabIndex.notifications).label.hasPrefix("通知"))
        XCTAssertTrue(tabs.buttons.element(boundBy: TabIndex.settings).label.hasPrefix("我的"))

        tabs.buttons.element(boundBy: TabIndex.home).tap()

        // 三件功能都在。
        XCTAssertTrue(app.buttons["home-feature-录音"].exists, "the recordings entry is missing")
        XCTAssertTrue(app.buttons["home-feature-新建会话"].exists, "the new-session entry is missing")
        XCTAssertTrue(app.buttons["home-feature-剪贴板历史"].exists, "the clipboard entry is missing")

        XCTAssertFalse(app.buttons["home-notifications"].exists, "the home page still exposes the removed bell")
    }

    /// 录音页那两枚键（返回主页、加号）必须在同一行。
    ///
    /// 这一页自带 `AdaptiveFeatureNavigation`，而分栏自己带一条导航栏。它一度是主页栈里推入
    /// 的一层，于是屏幕上同时出现两条栏：上面那条只剩系统的返回键，标题和加号落在下面那条，
    /// 中间空出整整一条标题带（2026-09-25 真机截图，iPhone 与 iPadOS 同形）。两枚键的竖直
    /// 中心差着整整一条栏，量得出来，所以这条用例量它 —— 再次被推进栈里就会红。
    func testRecordingsPageKeepsItsTwoButtonsOnOneRow() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()

        signIn(app)

        app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.home).tap()
        app.buttons["home-feature-录音"].tap()

        let back = app.buttons["recordings-back-home"]
        let add = app.buttons["new-recording"]
        XCTAssertTrue(back.waitForExistence(timeout: 15), "录音页没有返回主页那枚键")
        XCTAssertTrue(add.exists, "录音页没有加号")
        XCTAssertEqual(
            back.frame.midY,
            add.frame.midY,
            accuracy: 12,
            "录音页的返回键和加号不在同一行：这一页又成了主页栈里推入的一层"
        )
    }

    /// On a wide iPad window the recording list must be visible on entry. Otherwise the
    /// empty detail and sidebar toggle hide both the recordings and the way back home.
    func testWideRecordingsShowsItsListOnEntry() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()

        signIn(app)
        try XCTSkipIf(app.windows.firstMatch.frame.width < 1000, "需要 iPad 宽窗")

        app.buttons["home-feature-录音"].tap()
        XCTAssertTrue(app.buttons["recordings-back-home"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["new-recording"].exists)
    }

    func testSignInBrowseSessionsAndOpenTerminal() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()

        signIn(app)
        capture(app, name: "01-session-list")

        // The list is the whole product for most visits, so it has to be right
        // before anything else is worth checking.
        let claudeRow = app.staticTexts["claude-code"]
        XCTAssertTrue(claudeRow.waitForExistence(timeout: 25), "session list never arrived")
        XCTAssertTrue(app.staticTexts["build"].exists, "second session missing")
        XCTAssertTrue(app.staticTexts["api-logs"].exists, "third session missing")
        XCTAssertTrue(app.staticTexts["等待确认"].exists, "attention badge missing from the list")

        // A locked-out Agent surfaces on the home page's attention card. The
        // notification tab is a top-level page, so it can be selected directly.
        let tabs = app.tabBars.firstMatch
        tabs.buttons.element(boundBy: TabIndex.home).tap()
        XCTAssertTrue(
            app.buttons["home-attention"].waitForExistence(timeout: 8),
            "the home page did not report a waiting session"
        )
        tabs.buttons.element(boundBy: TabIndex.notifications).tap()
        capture(app, name: "02-notifications")
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 8),
            "the notifications page did not show the waiting session"
        )
        XCTAssertTrue(app.staticTexts["请求执行一个命令"].exists, "the notifications page lost the waiting reason")

        tabs.buttons.element(boundBy: TabIndex.terminals).tap()
        app.staticTexts["claude-code"].tap()

        // The collection view is not an `otherElement`; match on any element type
        // so the query survives a UIKit class change.
        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal view never appeared")
        capture(app, name: "03-terminal")
        // Terminal lines keep their leading indentation, so match on content
        // rather than on an exact label.
        XCTAssertTrue(
            waitForLabel(containing: "Claude Code v2.1.0", in: app, timeout: 15),
            "the terminal never rendered the desktop's output"
        )

        // No gate to open: opening the terminal is enough to type into it.
        XCTAssertFalse(app.buttons["解锁输入"].exists, "the removed read-only gate is still on screen")

        // The bar leads with the phone's own keys and carries the computer's commands
        // behind them. The return key is the one that must be here: without it a TUI
        // cannot be answered at all, since the input field sends text and an empty send
        // is not a message the protocol can carry.
        XCTAssertTrue(app.buttons["toolbar-enter"].exists, "the bar has no return key")
        XCTAssertTrue(app.buttons["toolbar-keyboard"].exists, "the bar has no way into the keyboard panel")

        // The keys that left this bar are behind the keyboard button, in the panel.
        XCTAssertFalse(app.buttons["esc"].exists, "a fixed key is still on the accessory bar")
        XCTAssertFalse(app.buttons["^C"].exists, "a fixed key is still on the accessory bar")

        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5), "the input field is missing from an opened terminal")
        input.tap()
        input.typeText("ls -la")
        app.buttons["send"].firstMatch.tap()
        capture(app, name: "04-command-sent")

        // The desktop echoes what it received, which proves the intent round trip.
        XCTAssertTrue(
            app.staticTexts["mock desktop received: ls -la"].waitForExistence(timeout: 10),
            "the command never reached the desktop"
        )

        // Answering the prompt is a key press. Return leads the front row this phone
        // keeps in its own code, which is where it lives now that the computer no longer
        // sends it — and it is addressed by an id this side owns.
        //
        // 先收键盘：那一条栏在打字的时候是让位的（`toolbarStandDown`）—— 手在系统键盘上
        // 的时候，眼前那一行指令按不到，也帮不上忙。点一下画布把它叫回来，这也是它
        // 一直在的那条路。
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            waitForHittable(app.buttons["toolbar-enter"], timeout: 10),
            "收起键盘之后，工具栏没有回来"
        )
        app.buttons["toolbar-enter"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "built in 4.21s", in: app, timeout: 15),
            "the approval round trip produced no output"
        )
        capture(app, name: "05-terminal-after-approval")
    }

    /// The keyboard must not hide the newest output, and must be dismissible.
    ///
    /// Both were reported from a real device: the keyboard covered the bottom of
    /// the terminal with no way to put it away short of leaving the screen.
    func testKeyboardKeepsNewestOutputVisibleAndDismissesOnTap() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")

        app.staticTexts["build"].tap()
        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")
        // Wait for the desktop's snapshot before touching anything, so the
        // screenshot below shows a real screen rather than an empty one.
        XCTAssertTrue(
            waitForLabel(containing: "chunk", in: app, timeout: 15),
            "terminal never rendered content"
        )

        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5), "input field missing")
        input.tap()

        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 8), "keyboard never appeared")
        // Read before dismissing: this is the state that was reported as broken.
        capture(app, name: "06-keyboard-up")

        // The input bar must still be above the keyboard, not behind it.
        XCTAssertTrue(input.isHittable, "the input field is covered by the keyboard")

        // Tap the terminal itself to put the keyboard away.
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            keyboard.waitForNonExistence(timeout: 8),
            "tapping the terminal did not dismiss the keyboard"
        )
        capture(app, name: "07-keyboard-dismissed")
    }

    /// 我的 is account, desktops, and sign-out — nothing else.
    ///
    /// The lock and server blocks were removed rather than hidden, so this checks
    /// 「我的」是分类列表加二级下钻：七个分类在外层，点进去才是设置。
    func testSettingsCategoriesLeadToTheirPages() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 25), "no tab bar")
        // 我的 — 四格之后它是最后一格。
        tabs.buttons.element(boundBy: TabIndex.settings).tap()

        // 七个分类都在外层。
        for category in ["account", "desktops", "terminal", "recording", "notifications", "diagnostics", "about"] {
            XCTAssertTrue(
                app.descendants(matching: .any)["settings-category-\(category)"].waitForExistence(timeout: 10),
                "the \(category) category is missing"
            )
        }
        capture(app, name: "08-settings")

        // 账号那一页：邮箱与退出登录。
        app.descendants(matching: .any)["settings-category-account"].tap()
        XCTAssertTrue(app.staticTexts["邮箱"].waitForExistence(timeout: 8), "the account page never opened")
        XCTAssertTrue(app.buttons["退出登录"].exists, "sign-out is missing")

        XCTAssertFalse(app.staticTexts["安全"].exists, "the removed security section is still listed")
        XCTAssertFalse(app.staticTexts["服务器"].exists, "the removed server section is still listed")
        capture(app, name: "09-settings-account")
    }

    func testSettingsCategoriesOpenTheirContentWithoutAnExtraPage() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let settingsTab = app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.settings)
        settingsTab.tap()

        app.descendants(matching: .any)["settings-category-recording"].tap()
        XCTAssertTrue(app.buttons["permission-麦克风"].waitForExistence(timeout: 10))

        settingsTab.tap()
        app.descendants(matching: .any)["settings-category-notifications"].tap()
        XCTAssertTrue(app.switches["settings-badge-toggle"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["settings-notification-center"].exists)

        settingsTab.tap()
        app.descendants(matching: .any)["settings-category-about"].tap()
        XCTAssertTrue(app.staticTexts["版本"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["问题反馈"].exists)
    }

    /// Actual denied-permission path; opens Settings without changing permissions.
    func testReviewDeniedRecordingSettingsAndCancellation() throws {
        guard ProcessInfo.processInfo.environment["SYNAPSE_TERMINAL_REVIEW_MICROPHONE_DENIED"] == "1" else {
            throw XCTSkip("The review requires a simulator with microphone permission already denied")
        }
        let app = try launchReadOnlyReview()
        app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.home).tap()
        let recording = app.buttons["home-feature-录音"].firstMatch
        revealReviewElement(recording, in: app)
        recording.tap()
        let newRecording = app.buttons["new-recording"].firstMatch
        XCTAssertTrue(newRecording.waitForExistence(timeout: 15) && newRecording.isHittable)
        newRecording.tap()
        let denied = app.staticTexts["未取得麦克风权限"].firstMatch
        XCTAssertTrue(denied.waitForExistence(timeout: 10) && denied.isHittable)
        XCTAssertFalse(app.staticTexts["录音会保存，用于转写"].firstMatch.exists)
        let finish = app.buttons["recording-finish"].firstMatch
        let cancel = app.buttons["recording-cancel"].firstMatch
        let settings = app.buttons["recording-open-settings"].firstMatch
        XCTAssertTrue(finish.exists && !finish.isEnabled)
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        XCTAssertTrue(settings.exists && settings.isHittable)
        capture(app, name: "review-recording-denied-truthful-state")
        settings.tap()
        let preferences = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            preferences.state == .runningForeground && app.state != .runningForeground
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 10), .completed,
            "The real denied-permission action must open system Settings")
        let tree = XCTAttachment(string: preferences.debugDescription)
        tree.name = "review-recording-native-app-settings-accessibility"
        tree.lifetime = .keepAlways; add(tree)
        capture(preferences, name: "review-recording-native-app-settings-read-only")
        if !preferences.navigationBars["Synapse"].firstMatch.exists {
            XCTAssertTrue(preferences.navigationBars["设置"].firstMatch.exists
                || preferences.navigationBars["Settings"].firstMatch.exists,
                "The supported settings URL must reach the real system Settings")
            recordReviewBoundary("This Simulator runtime opened Settings home and did not expose app-specific permission settings; the physical-device destination remains unverified.")
        }
        app.activate()
        XCTAssertTrue(denied.waitForExistence(timeout: 10) && !finish.isEnabled)
        XCTAssertFalse(app.staticTexts["录音会保存，用于转写"].firstMatch.exists)
        cancel.tap()
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 5))
        XCTAssertTrue(newRecording.exists && newRecording.isHittable)
        capture(app, name: "review-recording-denied-cancel-returned-to-list")
    }

    /// Root configures maximum Dynamic Type; permission values and density stay unchanged.
    func testReviewMaximumTypeSettingsDetailsAndSafeCancellation() throws {
        let app = try launchReadOnlyReview()
        let settings = app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.settings)

        func open(_ category: String, title: String) {
            settings.tap()
            let row = app.descendants(matching: .any)["settings-category-\(category)"].firstMatch
            revealReviewElement(row, in: app)
            row.tap()
            XCTAssertTrue(app.navigationBars[title].firstMatch.waitForExistence(timeout: 10))
        }

        open("account", title: "账号")
        XCTAssertTrue(app.staticTexts["邮箱"].firstMatch.waitForExistence(timeout: 10))
        let fullEmail = app.descendants(matching: .any).matching(NSPredicate(
            format: "label == %@ OR value == %@ OR (label CONTAINS %@ AND label CONTAINS %@)",
            email, email, "邮箱", email
        )).firstMatch
        revealReviewElement(fullEmail, in: app)
        capture(app, name: "review-settings-account-full-field")
        let signOut = app.buttons["退出登录"].firstMatch
        revealReviewElement(signOut, in: app)
        signOut.tap()
        let signOutAlert = app.alerts["退出登录？"].firstMatch
        XCTAssertTrue(signOutAlert.waitForExistence(timeout: 5))
        XCTAssertTrue(signOutAlert.buttons["退出"].exists)
        capture(app, name: "review-settings-sign-out-cancel")
        signOutAlert.buttons["取消"].tap()
        XCTAssertTrue(signOutAlert.waitForNonExistence(timeout: 5))
        XCTAssertTrue(fullEmail.exists, "Cancel must retain the signed-in account")

        open("desktops", title: "电脑")
        XCTAssertTrue(app.staticTexts["已连接的电脑"].firstMatch.waitForExistence(timeout: 10))
        let desktop = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "settings-desktop-")).firstMatch
        revealReviewElement(desktop, in: app)
        XCTAssertFalse(desktop.label.isEmpty, "The actual desktop row must identify its computer")
        capture(app, name: "review-settings-desktops-read-only")

        open("terminal", title: "终端")
        XCTAssertTrue(app.staticTexts["显示密度"].firstMatch.waitForExistence(timeout: 10))
        let density = app.segmentedControls.firstMatch
        revealReviewElement(density, in: app)
        XCTAssertEqual(Set(density.buttons.allElementsBoundByIndex.map(\.label)), Set(["紧凑", "正常", "稀疏"]))
        capture(app, name: "review-settings-density-unchanged")

        open("recording", title: "录音")
        assertReviewPermission(app.buttons["permission-麦克风"].firstMatch, in: app)
        capture(app, name: "review-settings-microphone-status-only")

        open("notifications", title: "通知")
        assertReviewPermission(app.buttons["permission-系统通知"].firstMatch, in: app)
        let badge = app.switches["settings-badge-toggle"].firstMatch
        revealReviewElement(badge, in: app)
        XCTAssertNotNil(badge.value, "The native badge switch must expose its current state")
        capture(app, name: "review-settings-system-notification-status-only")
        XCTAssertFalse(app.buttons["settings-notification-center"].exists,
            "设置页仍然暴露通知中心跳转")

        open("diagnostics", title: "诊断")
        let logging = app.switches["记录诊断日志"].firstMatch
        revealReviewElement(logging, in: app)
        XCTAssertNotNil(logging.value)
        let logs = app.buttons["诊断日志"].firstMatch
        revealReviewElement(logs, in: app)
        logs.tap()
        XCTAssertTrue(app.navigationBars["诊断日志"].firstMatch.waitForExistence(timeout: 10))
        for field in ["状态", "占用", "文件数"] {
            let row = app.cells.containing(.staticText, identifier: field).firstMatch
            revealReviewElement(row, in: app)
            XCTAssertTrue(row.staticTexts[field].firstMatch.exists)
            XCTAssertTrue(row.staticTexts.allElementsBoundByIndex.contains {
                !$0.label.isEmpty && $0.label != field
            }, "The native summary row must expose its actual value as well as its heading")
            capture(app, name: "review-diagnostics-real-summary-\(field)")
        }
        capture(app, name: "review-diagnostics-real-summary")
        let content = app.switches["记录终端屏幕内容"].firstMatch
        revealReviewElement(content, in: app)
        XCTAssertNotNil(content.value)
        capture(app, name: "review-diagnostics-content-state-unchanged")
        let export = app.buttons["导出并分享"].firstMatch
        revealReviewElement(export, in: app)
        XCTAssertTrue(export.isEnabled, "Existing app logs are required for the real export-cancel path")
        export.tap()
        let contentAlert = app.alerts["这份压缩包里包含终端屏幕内容"].firstMatch
        let exportPresented = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            contentAlert.exists || self.reviewVisibleDismissButtons(in: app).count == 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [exportPresented], timeout: 25), .completed)
        if contentAlert.exists {
            XCTAssertTrue(contentAlert.buttons["继续分享"].exists)
            capture(app, name: "review-diagnostics-content-confirmation-cancel")
            contentAlert.buttons["取消"].tap()
            XCTAssertTrue(contentAlert.waitForNonExistence(timeout: 5))
        } else {
            capture(app, name: "review-diagnostics-native-share-cancel")
            let dismiss = reviewVisibleDismissButtons(in: app)
            guard dismiss.count == 1 else {
                XCTFail("Only the actual native share dismissal may be tapped"); return
            }
            dismiss[0].tap()
        }
        XCTAssertTrue(waitForHittable(export, timeout: 10) && export.isEnabled,
            "Cancelling must return to the unchanged diagnostic log page")
        let deleteLogs = app.buttons["删除全部日志"].firstMatch
        revealReviewElement(deleteLogs, in: app)
        XCTAssertTrue(deleteLogs.isEnabled)
        deleteLogs.tap()
        let deleteAlert = app.alerts["删除全部日志？"].firstMatch
        XCTAssertTrue(deleteAlert.waitForExistence(timeout: 5))
        XCTAssertTrue(deleteAlert.buttons["删除"].exists)
        capture(app, name: "review-diagnostics-delete-confirmation-cancel")
        deleteAlert.buttons["取消"].tap()
        XCTAssertTrue(deleteAlert.waitForNonExistence(timeout: 5))
        XCTAssertTrue(deleteLogs.exists && deleteLogs.isEnabled)
        reviewBack(from: "诊断日志", to: "诊断", in: app)
        XCTAssertTrue(logging.waitForExistence(timeout: 5))

        open("about", title: "关于")
        let version = app.cells.containing(.staticText, identifier: "版本").firstMatch
        revealReviewElement(version, in: app)
        XCTAssertTrue(version.staticTexts["版本"].firstMatch.exists)
        XCTAssertTrue(version.staticTexts.allElementsBoundByIndex.contains {
            !$0.label.isEmpty && $0.label != "版本"
        }, "The native About row must expose its actual full version value")
        capture(app, name: "review-settings-about-real-version")
        let feedback = app.buttons["问题反馈"].firstMatch
        revealReviewElement(feedback, in: app)
        feedback.tap()
        XCTAssertTrue(app.navigationBars["问题反馈"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["feedback-text"].firstMatch.exists)
        let submit = app.buttons["feedback-submit"].firstMatch
        XCTAssertTrue(submit.exists && !submit.isEnabled, "Empty feedback must never be submitted")
        capture(app, name: "review-settings-empty-feedback-disabled")
        reviewBack(from: "问题反馈", to: "关于", in: app)
        XCTAssertTrue(feedback.waitForExistence(timeout: 5))
        settings.tap()
        revealReviewElement(app.descendants(matching: .any)["settings-category-account"].firstMatch,
            in: app, towardTop: true)
        capture(app, name: "review-settings-returned-to-categories")
    }

    /// Searches real recipients but selects none, imports no file, and sends no preview.
    func testReviewMaximumTypeMailPickersAndDraftCancellation() throws {
        let app = try launchReadOnlyReview()
        app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.home).tap()
        let mail = app.buttons["home-feature-站内信"].firstMatch
        revealReviewElement(mail, in: app)
        mail.tap()
        XCTAssertTrue(app.navigationBars["站内信"].firstMatch.waitForExistence(timeout: 15))
        let compose = app.buttons["写信"].firstMatch
        XCTAssertTrue(compose.exists && compose.isHittable)
        compose.tap()
        XCTAssertTrue(app.navigationBars["写信"].firstMatch.waitForExistence(timeout: 10))
        let preview = app.buttons["预览发送"].firstMatch
        XCTAssertTrue(preview.exists && !preview.isEnabled)
        capture(app, name: "review-mail-empty-compose-disabled")

        for title in ["选择收件人", "选择抄送"] {
            let picker = app.buttons[title].firstMatch
            revealReviewElement(picker, in: app)
            picker.tap()
            XCTAssertTrue(app.navigationBars[title].firstMatch.waitForExistence(timeout: 10))
            let search = app.searchFields.firstMatch
            XCTAssertTrue(search.waitForExistence(timeout: 10) && search.isHittable)
            search.tap()
            search.typeText("iOSReview-NoRecipient-" + UUID().uuidString)
            let empty = app.staticTexts["没有匹配的成员或组织"].firstMatch
            XCTAssertTrue(empty.waitForExistence(timeout: 20),
                "The actual recipient query must finish with its real empty-result state")
            capture(app, name: "review-mail-\(title)-query-empty")
            guard dismissReviewSearch(in: app, returningTo: title) else { return }
            let done = app.navigationBars[title].buttons["完成"].firstMatch
            XCTAssertTrue(done.exists && done.isHittable)
            done.tap()
            XCTAssertTrue(app.navigationBars[title].firstMatch.waitForNonExistence(timeout: 5))
            XCTAssertTrue(app.navigationBars["写信"].firstMatch.exists)
            XCTAssertTrue(preview.exists && !preview.isEnabled,
                "Closing an unselected recipient picker must not make this draft sendable")
        }

        let importFile = app.buttons["选取文件"].firstMatch
        revealReviewElement(importFile, in: app)
        XCTAssertTrue(importFile.isEnabled)
        importFile.tap()
        let pickerHosts = [app, XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")]
        let dismissMarker = NSPredicate(format: "label IN %@", ["取消", "Cancel", "关闭", "Close", "close"])
        func documentPicker(in host: XCUIApplication) -> XCUIElement {
            host.otherElements["Browse View (Picker)"].firstMatch
        }
        func pickerDismissButtons(in host: XCUIApplication) -> [XCUIElement] {
            documentPicker(in: host).navigationBars["FullDocumentManagerViewControllerNavigationBar"]
                .buttons.matching(dismissMarker).allElementsBoundByIndex.filter { $0.isHittable }
        }
        func actualDocumentPickerHost() -> XCUIApplication? {
            pickerHosts.first { host in
                guard host.state != .notRunning else { return false }
                let picker = documentPicker(in: host)
                return picker.exists && picker.searchFields.firstMatch.exists
                    && pickerDismissButtons(in: host).count == 1
            }
        }
        let pickerPresented = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            actualDocumentPickerHost() != nil
        }, object: nil)
        let presented = XCTWaiter.wait(for: [pickerPresented], timeout: 15)
        if presented != .completed {
            captureReviewFailure(app, name: "review-mail-document-picker-not-resolved")
            for host in pickerHosts.dropFirst() where host.state != .notRunning {
                let tree = XCTAttachment(string: host.debugDescription)
                tree.name = "review-mail-document-picker-system-host-native-accessibility"
                tree.lifetime = .keepAlways; add(tree)
            }
        }
        XCTAssertEqual(presented, .completed,
            "The real system document picker must appear above the compose form")
        guard let pickerHost = actualDocumentPickerHost() else {
            XCTFail("The foreground document browser must remain available for native cancellation"); return
        }
        capture(app, name: "review-mail-native-document-picker-cancel")
        let pickerTree = XCTAttachment(string: pickerHost.debugDescription)
        pickerTree.name = "review-mail-document-picker-native-accessibility"
        pickerTree.lifetime = .keepAlways; add(pickerTree)
        let pickerCancel = pickerDismissButtons(in: pickerHost)
        guard pickerCancel.count == 1 else {
            XCTFail("Only the actual native picker dismissal may be tapped"); return
        }
        pickerCancel[0].tap()
        XCTAssertTrue(waitForHittable(importFile, timeout: 10))
        XCTAssertTrue(app.navigationBars["写信"].firstMatch.exists)

        let subject = app.textFields["主题"].firstMatch
        revealReviewElement(subject, in: app, towardTop: true)
        let localDraft = "iOS Review UI draft — do not send"
        subject.tap()
        subject.typeText(localDraft)
        XCTAssertTrue(preview.exists && !preview.isEnabled)
        let cancel = app.navigationBars["写信"].buttons["取消"].firstMatch
        XCTAssertTrue(cancel.exists && cancel.isHittable)
        cancel.tap()
        XCTAssertTrue(app.staticTexts["放弃这封信？"].firstMatch.waitForExistence(timeout: 5))
        let continueWriting = app.buttons["继续写信"].firstMatch
        capture(app, name: "review-mail-local-draft-discard-confirmation")
        let confirmationTree = XCTAttachment(string: app.debugDescription)
        confirmationTree.name = "review-mail-native-discard-confirmation-accessibility"
        confirmationTree.lifetime = .keepAlways; add(confirmationTree)
        if continueWriting.exists {
            XCTAssertTrue(continueWriting.isHittable)
            continueWriting.tap()
        } else {
            // Native popover confirmations dismiss outside instead of rendering
            // their cancel action. The source Cancel is a safe visible target.
            let popover = app.popovers.firstMatch
            let outside = CGPoint(x: cancel.frame.minX + cancel.frame.width * 0.1, y: cancel.frame.midY)
            XCTAssertTrue(popover.exists && app.frame.contains(outside) && !popover.frame.contains(outside),
                "Only an observed point outside the native confirmation popover may dismiss it")
            cancel.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
        }
        XCTAssertTrue(app.staticTexts["放弃这封信？"].firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue(waitForHittable(subject, timeout: 5))
        XCTAssertEqual(subject.value as? String, localDraft)
        capture(app, name: "review-mail-local-draft-retained")
        cancel.tap()
        let discard = app.buttons["放弃"].firstMatch
        XCTAssertTrue(discard.waitForExistence(timeout: 5) && discard.isHittable)
        discard.tap()
        XCTAssertTrue(app.navigationBars["写信"].firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue(compose.exists && compose.isHittable)
        capture(app, name: "review-mail-local-draft-cancelled-no-send")
    }

    /// Existing messages only. Opening may perform the app's normal read acknowledgement.
    func testReviewExistingMailContentAndReadOnlyActions() throws {
        let app = try launchReadOnlyReview()
        app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.home).tap()
        let entry = app.buttons["home-feature-站内信"].firstMatch
        revealReviewElement(entry, in: app)
        entry.tap()
        XCTAssertTrue(app.navigationBars["站内信"].firstMatch.waitForExistence(timeout: 15))
        for box in ["已发送", "收件箱"] {
            let button = app.buttons[box].firstMatch
            revealReviewElement(button, in: app, towardTop: true)
            button.tap()
            XCTAssertTrue(app.staticTexts[box].firstMatch.waitForExistence(timeout: 10))
            capture(app, name: "review-mail-box-\(box)")
        }
        let search = app.searchFields.firstMatch
        if !(search.exists && search.isHittable) {
            guard let list = reviewForegroundList(in: app) else {
                captureReviewFailure(app, name: "review-mail-search-no-foreground-list")
                XCTFail("The current mailbox must expose its native scrolling List"); return
            }
            for _ in 0..<3 where !(search.exists && search.isHittable) { list.swipeDown() }
        }
        guard waitForHittable(search, timeout: 10) else {
            captureReviewFailure(app, name: "review-mail-search-not-revealed")
            XCTFail("Native pull-down must reveal the mailbox search field"); return
        }
        let query = "iOSReview-NoMail-" + UUID().uuidString
        search.tap()
        search.typeText(query)
        XCTAssertTrue(app.staticTexts["没有信件"].firstMatch.waitForExistence(timeout: 20))
        capture(app, name: "review-mail-real-search-empty")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: query.count))
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let value = search.value as? String ?? ""
            return value.isEmpty || value == search.placeholderValue
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed,
            "Native deletion must clear the entire search query")
        guard dismissReviewSearch(in: app, returningTo: "站内信") else { return }
        let mailbox = app.buttons["信箱操作"].firstMatch
        XCTAssertTrue(mailbox.exists && mailbox.isHittable)
        for title in ["只看未读", "显示全部"] {
            mailbox.tap()
            let option = app.buttons[title].firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 5) && option.isHittable)
            option.tap()
            capture(app, name: "review-mail-filter-\(title)")
        }
        let rows = app.cells.buttons.matching(NSPredicate(format: "NOT (label IN %@)", ["收件箱", "已发送", "加载更多"]))
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            rows.firstMatch.exists || app.staticTexts["没有信件"].firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 20), .completed)
        if !rows.firstMatch.exists {
            XCTAssertTrue(app.staticTexts["没有信件"].firstMatch.exists)
            recordReviewBoundary("Current inbox is genuinely empty; detail, attachment, relation and reply paths are not supplied by this account state.")
            capture(app, name: "review-mail-current-inbox-empty")
            return
        }
        let message = rows.firstMatch
        revealReviewElement(message, in: app)
        message.tap()
        XCTAssertTrue(app.navigationBars["信件"].firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "发件人：")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "收件人：")).firstMatch.exists)
        let document = app.scrollViews.firstMatch
        XCTAssertTrue(document.exists && document.staticTexts.count >= 4)
        capture(app, name: "review-mail-existing-body")
        document.swipeUp()
        capture(app, name: "review-mail-existing-body-scrolled")
        let earlier = app.buttons["加载更早往来"].firstMatch
        if earlier.exists {
            revealReviewDocumentElement(earlier, in: document)
            XCTAssertTrue(earlier.isEnabled)
            earlier.tap()
            capture(app, name: "review-mail-real-earlier-context-requested")
        } else {
            recordReviewBoundary("The opened existing message has no earlier-context paging action; no relation data was manufactured.")
        }
        let attachmentHeading = app.staticTexts["附件"].firstMatch
        if attachmentHeading.exists {
            revealReviewDocumentElement(attachmentHeading, in: document)
            let contextHeading = app.staticTexts["关联往来"].firstMatch
            let attachment = document.buttons.allElementsBoundByIndex.first { button in
                !button.label.hasPrefix("分享 ") && button.frame.minY >= attachmentHeading.frame.maxY
                    && (!contextHeading.exists || button.frame.maxY <= contextHeading.frame.minY)
            }
            guard let attachment else { XCTFail("The genuine attachment section must expose its file button"); return }
            revealReviewDocumentElement(attachment, in: document)
            let filename = attachment.label
            attachment.tap()
            let previewClosed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                self.reviewVisiblePreviewDismissButtons(in: app).count == 1
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [previewClosed], timeout: 30), .completed)
            capture(app, name: "review-mail-existing-attachment-native-preview")
            let dismiss = reviewVisiblePreviewDismissButtons(in: app)
            guard dismiss.count == 1 else { XCTFail("Only the real preview or download confirmation dismissal may be tapped"); return }
            dismiss[0].tap()
            let share = app.buttons["分享 " + filename].firstMatch
            if share.waitForExistence(timeout: 5) {
                revealReviewDocumentElement(share, in: document)
                share.tap()
                let nativeShare = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    self.reviewVisibleDismissButtons(in: app).count == 1
                }, object: nil)
                XCTAssertEqual(XCTWaiter.wait(for: [nativeShare], timeout: 10), .completed)
                capture(app, name: "review-mail-downloaded-attachment-share-cancel")
                let cancel = reviewVisibleDismissButtons(in: app)
                guard cancel.count == 1 else { XCTFail("Only the real native share dismissal may be tapped"); return }
                cancel[0].tap()
            } else {
                recordReviewBoundary("The actual attachment flow was cancelled before a downloadable share item became available.")
            }
        } else {
            recordReviewBoundary("The opened existing message supplies no attachment; no file was uploaded or synthetic message created.")
        }
        let operations = app.buttons["信件操作"].firstMatch
        for action in ["回复", "转发"] {
            XCTAssertTrue(operations.exists && operations.isHittable)
            operations.tap()
            XCTAssertTrue(app.buttons["删除"].firstMatch.waitForExistence(timeout: 5))
            capture(app, name: "review-mail-existing-action-menu-\(action)")
            let button = app.buttons[action].firstMatch
            if !button.exists {
                // A native menu occludes its source button. Tap the visible current
                // tab outside the menu, then require the same detail to remain.
                let home = app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.home)
                XCTAssertTrue(home.exists && app.frame.contains(home.frame),
                    "The current native tab must provide a visible area outside the menu")
                home.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                XCTAssertTrue(app.buttons["删除"].firstMatch.waitForNonExistence(timeout: 5))
                XCTAssertTrue(app.navigationBars["信件"].firstMatch.exists && operations.isHittable,
                    "Dismissal must retain the current message without a mutation")
                recordReviewBoundary("The opened message does not offer " + action + "; its platform-message restrictions are retained.")
                continue
            }
            XCTAssertTrue(button.isHittable)
            button.tap()
            XCTAssertTrue(app.navigationBars[action].firstMatch.waitForExistence(timeout: 10))
            capture(app, name: "review-mail-existing-\(action)-cancel")
            let cancel = app.navigationBars[action].buttons["取消"].firstMatch
            XCTAssertTrue(cancel.exists && cancel.isHittable)
            cancel.tap()
            if app.staticTexts["放弃这封信？"].firstMatch.waitForExistence(timeout: 1) {
                app.buttons["放弃"].firstMatch.tap()
            }
            XCTAssertTrue(app.navigationBars[action].firstMatch.waitForNonExistence(timeout: 5))
            XCTAssertTrue(operations.exists && operations.isHittable)
        }
        reviewBack(from: "信件", to: "站内信", in: app)
        capture(app, name: "review-mail-read-only-returned-to-inbox")
    }

    func testReviewExistingNotificationBodyAndInternalTarget() throws {
        let app = try launchReadOnlyReview()
        app.tabBars.firstMatch.buttons.element(boundBy: TabIndex.notifications).tap()
        let filter = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "筛选：")).firstMatch
        XCTAssertTrue(filter.waitForExistence(timeout: 10) && filter.isHittable)
        filter.tap()
        app.buttons["全部通知"].firstMatch.tap()
        XCTAssertTrue(waitForHittable(filter, timeout: 5))
        XCTAssertEqual(filter.label, "筛选：全部通知")

        let bodyRows = app.cells.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "查看通知"))
        let mailRows = app.cells.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "查看站内信"))
        let otherTargetRows = app.cells.buttons.matching(NSPredicate(format: "label ENDSWITH %@ OR label ENDSWITH %@", "查看转写", "打开终端"))
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            bodyRows.firstMatch.exists || mailRows.firstMatch.exists || otherTargetRows.firstMatch.exists
                || app.staticTexts["暂无通知"].firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 20), .completed)
        capture(app, name: "review-notifications-current-all-records")

        // 每条通知只有整行主操作；旧的正文图标不应再出现。
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "正文")).firstMatch.exists)
        if bodyRows.firstMatch.exists {
            let row = bodyRows.firstMatch
            revealReviewElement(row, in: app)
            row.tap()
            XCTAssertTrue(filter.waitForNonExistence(timeout: 5))
            XCTAssertTrue(app.navigationBars["通知"].firstMatch.exists)
            XCTAssertTrue(app.scrollViews.firstMatch.waitForExistence(timeout: 10))
            let back = app.navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["通知", "返回", "Back"]))
                .allElementsBoundByIndex.filter { $0.isHittable }.first
            XCTAssertNotNil(back)
            back?.tap()
            XCTAssertTrue(filter.waitForExistence(timeout: 5))
        } else {
            recordReviewBoundary("The current notification page supplies no plain notification row; no notification was created.")
        }

        if mailRows.firstMatch.exists {
            let mail = mailRows.firstMatch
            revealReviewElement(mail, in: app)
            mail.tap()
            let opened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                app.buttons["信件操作"].exists
                    || app.staticTexts["要打开的会话已结束。"].exists
                    || app.staticTexts["这台电脑不在线"].exists
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 20), .completed,
                "站内信通知整行应打开真实站内信页面")
            XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "查看站内信正文")).firstMatch.exists)
        } else {
            recordReviewBoundary("The current notification page supplies no internal Mail target; no notification was created.")
        }
    }

    private func revealReviewDocumentElement(_ element: XCUIElement, in document: XCUIElement) {
        for _ in 0..<12 where !(element.exists && element.isHittable) { document.swipeUp() }
        XCTAssertTrue(waitForHittable(element, timeout: 10), "The actual document action must be reachable by scrolling")
    }

    private func reviewVisiblePreviewDismissButtons(in app: XCUIApplication) -> [XCUIElement] {
        app.buttons.matching(NSPredicate(format: "label IN %@", ["完成", "Done", "取消", "Cancel", "关闭", "Close"]))
            .allElementsBoundByIndex.filter { $0.isHittable }
    }

    private func recordReviewBoundary(_ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = "review-current-data-boundary"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func launchReadOnlyReview() throws -> XCUIApplication {
        try XCTSkipIf(ProcessInfo.processInfo.environment["SYNAPSE_IPAD_REVIEW"] != "1"
            || ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"]?.isEmpty != false,
            "Explicitly configured production UI review is required")
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 20))
        return app
    }

    private func revealReviewElement(_ element: XCUIElement, in app: XCUIApplication, towardTop: Bool = false) {
        if waitForHittable(element, timeout: 1) { return }
        guard let list = reviewForegroundList(in: app) else {
            captureReviewFailure(app, name: "review-detail-no-foreground-list")
            XCTFail("The foreground native List/Form must provide scrolling"); return
        }
        for _ in 0..<8 where !(element.exists && element.isHittable) {
            if towardTop { list.swipeDown() } else { list.swipeUp() }
        }
        let reached = waitForHittable(element, timeout: 10)
        if !reached { captureReviewFailure(app, name: "review-detail-control-not-reached") }
        XCTAssertTrue(reached, "The requested detail control must be reachable by native scrolling")
    }

    private func reviewForegroundList(in app: XCUIApplication) -> XCUIElement? {
        let lists = app.tables.allElementsBoundByIndex + app.collectionViews.allElementsBoundByIndex
        return lists.first { list in
            list.exists && !list.frame.isEmpty && list.frame.intersects(app.frame)
                && list.descendants(matching: .any).allElementsBoundByIndex.contains { $0.isHittable }
        }
    }

    private func dismissReviewSearch(in app: XCUIApplication, returningTo title: String) -> Bool {
        let buttons = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "Close", "close"]))
            .allElementsBoundByIndex.filter { $0.isHittable }
        guard buttons.count == 1 else {
            captureReviewFailure(app, name: "review-search-native-cancel-not-unique")
            XCTFail("The active native search must expose one actual Cancel action"); return false
        }
        buttons[0].tap()
        let restored = app.navigationBars[title].firstMatch.waitForExistence(timeout: 5)
        if !restored { captureReviewFailure(app, name: "review-search-navigation-not-restored") }
        XCTAssertTrue(restored, "Cancelling native search must restore the actual page navigation")
        return restored
    }

    private func captureReviewFailure(_ app: XCUIApplication, name: String) {
        capture(app, name: name)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-native-AX"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    private func assertReviewPermission(_ row: XCUIElement, in app: XCUIApplication) {
        revealReviewElement(row, in: app)
        let state = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let exposed = row.label + " " + (row.value as? String ?? "")
            return ["已允许", "已拒绝", "未请求"].contains { exposed.contains($0) }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [state], timeout: 10), .completed,
            "The actual permission state must be readable without invoking the permission action")
    }

    private func reviewVisibleDismissButtons(in app: XCUIApplication) -> [XCUIElement] {
        app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "关闭", "Close"]))
            .allElementsBoundByIndex.filter { $0.isHittable }
    }

    private func reviewBack(from title: String, to parent: String, in app: XCUIApplication) {
        let buttons = app.navigationBars[title].buttons
            .matching(NSPredicate(format: "label IN %@", [parent, "返回", "Back"]))
            .allElementsBoundByIndex.filter { $0.isHittable }
        guard buttons.count == 1 else {
            XCTFail("The real navigation bar must expose one native Back action"); return
        }
        buttons[0].tap()
        XCTAssertTrue(app.navigationBars[title].firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars[parent].firstMatch.waitForExistence(timeout: 5))
    }

    /// A phone opened before any computer was online must notice one signing in.
    ///
    /// This is the reported bug: the app was started with nothing online, the
    /// computer signed in afterwards, and the phone kept saying 电脑离线 forever.
    /// The computer is put away first so the app starts in exactly that state, and
    /// from the moment it signs in the phone is not touched.
    func testPhoneGoesOnlineWhenADesktopSignsInLater() throws {
        XCTAssertEqual(
            post("/desktop/disconnect"), 200,
            "the mock desktop control channel is unreachable at \(controlBaseURL)"
        )

        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 25), "no tab bar")
        XCTAssertTrue(
            app.staticTexts["电脑不在线"].waitForExistence(timeout: 25),
            "the app did not start in the offline state this test needs"
        )
        capture(app, name: "13-offline-with-no-desktop")

        // The computer signs in. Nothing below touches the phone.
        XCTAssertEqual(post("/desktop/connect"), 200, "the mock desktop would not reconnect")

        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 30),
            "the phone never noticed the computer signing in — it stayed offline"
        )
        capture(app, name: "14-online-after-desktop-signs-in")
    }

    /// A row swipes open to rename and delete, and delete asks before it acts.
    ///
    /// Destructive, so it runs against whatever the mock still has: it renames
    /// `api-logs` and deletes `build`. Both are fixtures the other tests have
    /// already finished with by the time this one runs.
    func testSwipeActionsRenameAndDelete() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        XCTAssertTrue(app.staticTexts["api-logs"].waitForExistence(timeout: 20), "session list never arrived")

        // Rename. The sheet opens on the current name — most renames change a word
        // or two — and the list has to show the new one without leaving the screen.
        revealSwipeActions(on: "api-logs", in: app)
        let renameButton = app.buttons["重命名"]
        XCTAssertTrue(renameButton.waitForExistence(timeout: 5), "swipe did not reveal rename")
        XCTAssertTrue(app.buttons["删除"].exists, "swipe did not reveal delete")
        // The actions themselves, before the sheet covers them.
        capture(app, name: "15-swipe-actions")
        renameButton.tap()

        XCTAssertTrue(
            app.navigationBars["重命名终端"].waitForExistence(timeout: 5),
            "rename never asked for a name"
        )
        let nameField = app.textFields["rename-field"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 5), "rename opened no field")
        // The old name is in the box, not left behind on the row: editing one word is
        // what this is opened for, and there is a name to save from the first moment.
        XCTAssertEqual(nameField.value as? String, "api-logs", "the old name was not carried into the field")
        let save = app.buttons["保存"]
        XCTAssertTrue(save.isEnabled, "save was grey with a name in the field")

        // ✕ empties the field, which is the other thing a rename is: the whole name
        // goes. With nothing left there is nothing to save, so the button greys out.
        app.buttons["清空"].tap()
        XCTAssertFalse(save.isEnabled, "save stayed live after the field was emptied")

        nameField.typeText("api-logs v2")
        XCTAssertTrue(save.isEnabled, "save stayed grey after a name was typed")
        save.tap()
        XCTAssertTrue(
            app.staticTexts["api-logs v2"].waitForExistence(timeout: 10),
            "the renamed row never appeared"
        )
        capture(app, name: "10-renamed")

        // Delete must ask first, and cancelling must keep the row.
        revealSwipeActions(on: "build", in: app)
        let deleteButton = app.buttons["删除"]
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 5), "swipe did not reveal delete")
        deleteButton.tap()

        let confirm = app.alerts.firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "delete asked for no confirmation")
        XCTAssertEqual(confirm.label, "删除这个终端？", "the confirmation is not about deleting")
        capture(app, name: "11-delete-confirm")
        confirm.buttons["取消"].tap()
        XCTAssertTrue(app.staticTexts["build"].waitForExistence(timeout: 5), "cancelling still removed the row")

        // Now actually delete it.
        revealSwipeActions(on: "build", in: app)
        app.buttons["删除"].firstMatch.tap()
        app.alerts.firstMatch.buttons["删除"].tap()
        XCTAssertTrue(
            app.staticTexts["build"].waitForNonExistence(timeout: 15),
            "the deleted row is still listed"
        )
        capture(app, name: "12-deleted")
    }

    /// The terminal can be left by the system's edge-swipe gesture.
    ///
    /// This test previously asserted the opposite — that the swipe did *nothing* —
    /// because hiding the navigation bar turns the gesture off. That assertion was
    /// correct for the code as it stood and deliberately inverted here, when the
    /// gesture was restored. Its failing on the change was the proof the gesture
    /// had actually come back, rather than being assumed to.
    func testTerminalCanBeLeftByEdgeSwipe() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        XCTAssertTrue(app.staticTexts["claude-code"].waitForExistence(timeout: 20), "session list never arrived")
        app.staticTexts["claude-code"].tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")

        let edge = terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: edge.withOffset(CGVector(dx: 320, dy: 0)))
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 8),
            "the edge swipe did not go back to the list"
        )
        XCTAssertFalse(terminal.exists, "the terminal is still on screen after the swipe")
        capture(app, name: "21-edge-swipe-back")

        // The recogniser keeps its delegate after the pop, so the guard has to hold
        // on the stack's root too. An ungated swipe there is the classic way this
        // technique leaves the stack wedged.
        // From the screen's own left edge, which is where the system gesture
        // starts — dragging from a row's left edge is a different gesture.
        let rootEdge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
        rootEdge.press(forDuration: 0.05, thenDragTo: rootEdge.withOffset(CGVector(dx: 320, dy: 0)))
        Thread.sleep(forTimeInterval: 0.8)
        // `claude-code` rather than another row: the swipe-actions test deletes one
        // fixture and renames another, and this test has to survive running after it.
        XCTAssertTrue(app.staticTexts["claude-code"].exists, "an edge swipe at the stack root disturbed the list")

        // And the stack still works afterwards.
        app.staticTexts["claude-code"].tap()
        XCTAssertTrue(terminal.waitForExistence(timeout: 10), "the stack stopped working after a root swipe")
    }

    /// A swipe that is dragged and released without completing must leave nothing
    /// behind — the back button is the fallback for a gesture that was abandoned.
    func testCancelledEdgeSwipeLeavesTheScreenUsable() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        XCTAssertTrue(app.staticTexts["claude-code"].waitForExistence(timeout: 20), "session list never arrived")
        app.staticTexts["claude-code"].tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")

        // A fifth of the way across, then released: not enough to commit.
        let edge = terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: edge.withOffset(CGVector(dx: 80, dy: 0)))
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertTrue(terminal.exists, "a short drag popped the terminal")

        app.buttons["chevron.left"].firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 8),
            "the back button stopped working after a cancelled swipe"
        )
    }

    /// A tab holding more than one terminal is drawn as one block on the list.
    ///
    /// Run against the mock started with `--splits`; without it the desktop sends
    /// no `workspaces` and there is no hierarchy to draw — which the last
    /// assertion here covers, so this test is meaningful in both runs.
    func testSplitTabGroupsItsTerminals() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 20),
            "session list never arrived"
        )

        guard app.staticTexts["网页调试"].exists else {
            // The plain run: the flat list must look exactly as it always did.
            XCTAssertTrue(app.staticTexts["build"].exists, "flat list lost a terminal")
            XCTAssertTrue(app.staticTexts["api-logs"].exists, "flat list lost a terminal")
            capture(app, name: "18-list-without-splits")
            return
        }

        // The tab names itself, and its terminals are inside it rather than loose
        // among the others.
        XCTAssertTrue(app.staticTexts["web-a"].exists, "a pane of the split tab is missing")
        XCTAssertTrue(app.staticTexts["web-b"].exists, "a pane of the split tab is missing")
        // A terminal that is a tab of its own must NOT be inside the split block:
        // its row sits further left than the panes indented under the tab.
        let pane = app.staticTexts["web-a"].frame.minX
        let loose = app.staticTexts["claude-code"].frame.minX
        XCTAssertGreaterThan(pane, loose, "the split tab's panes are not indented under it")
        capture(app, name: "18-list-with-split-tab")

        // Delete and rename must keep working inside the tab: a pane row still has
        // to answer a swipe, and the disclosure gesture must not eat it.
        revealSwipeActions(on: "web-a", in: app)
        XCTAssertTrue(
            app.buttons["重命名"].waitForExistence(timeout: 5),
            "a pane inside a split tab does not answer a swipe"
        )
    }

    /// Leaving the terminal must show the list already in the system's appearance.
    ///
    /// The terminal is a dark screen, and it used to force the whole scene dark
    /// while it was up — so coming back made the list fade from dark to light.
    /// Run this in light system appearance; the recordings taken alongside it are
    /// what show whether the transition is there.
    func testLeavingTheTerminalShowsTheListImmediately() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        XCTAssertTrue(app.staticTexts["claude-code"].waitForExistence(timeout: 20), "session list never arrived")
        app.staticTexts["claude-code"].tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")
        capture(app, name: "16-terminal-dark-screen")

        app.buttons["chevron.left"].firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 10),
            "never returned to the list"
        )
        capture(app, name: "17-list-right-after-back")
    }

    /// A write the desktop refuses as preempted has to be replayed by the client.
    ///
    /// The mock desktop holds the lease for `build` (its `--contend` fixture), so
    /// the first send is refused exactly the way a real desktop refuses it when
    /// its own user is typing. The user taps send once; the command still has to
    /// arrive. Nothing in this test answers a prompt or sends a second time.
    func testSendSurvivesAPreemptedLeaseWithoutASecondTap() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        app.staticTexts["build"].tap()
        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")

        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5), "input field missing")
        input.tap()
        input.typeText("ls -la")
        // Exactly one tap, and no unlock button exists to press in between.
        XCTAssertFalse(app.buttons["解锁输入"].exists, "a lock gate is back on screen")
        app.buttons["send"].firstMatch.tap()

        XCTAssertTrue(
            waitForLabel(containing: "mock desktop received: ls -la", in: app, timeout: 20),
            "the refused command was never replayed"
        )
        // Positive proof the refusal happened, so this cannot pass merely because
        // the preemption path was never exercised.
        XCTAssertTrue(
            waitForLabel(containing: "desktop took the lease", in: app, timeout: 5),
            "the preemption path was never exercised — the test proves nothing"
        )
        capture(app, name: "09-preempted-send-replayed")
    }

    /// The sheet edits the bar's draft, and a confirmed multiline send folds it away.
    func testExpandedInputKeepsDraftOnCloseAndClosesAfterSend() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        selectMockDesktop(app)
        openClaudeCodeTerminal(app)

        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the compact input is missing")
        field.tap()
        field.typeText("expanded-input-first")

        let expand = app.buttons["terminal-expand-input"]
        XCTAssertTrue(expand.exists, "the input has no manual expand control")
        expand.tap()

        let editor = app.textViews["terminal-expanded-input"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10), "the multiline editor did not open")
        XCTAssertTrue((editor.value as? String ?? "").contains("expanded-input-first"))
        editor.tap()
        editor.typeText("\nexpanded-input-second")
        app.buttons["terminal-expanded-close"].tap()

        XCTAssertTrue(editor.waitForNonExistence(timeout: 10), "closing left the editor open")
        XCTAssertTrue(waitForValue(containing: "expanded-input-second", in: field, timeout: 10), "the compact input lost the edited draft")

        expand.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 10), "the edited draft could not be reopened")
        XCTAssertTrue((editor.value as? String ?? "").contains("expanded-input-first"))
        XCTAssertTrue((editor.value as? String ?? "").contains("expanded-input-second"))
        app.buttons["terminal-expanded-send"].tap()

        XCTAssertTrue(editor.waitForNonExistence(timeout: 15), "the editor stayed open after the desktop accepted the command")
        XCTAssertFalse((field.value as? String ?? "").contains("expanded-input-"), "the accepted command remained in the compact input")
        XCTAssertTrue(waitForLabel(containing: "expanded-input-second", in: app, timeout: 10), "the multiline command did not reach the desktop")
    }

    func testExpandedInputWaitsForLeaseReplayBeforeClosing() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        XCTAssertTrue(app.staticTexts["build"].waitForExistence(timeout: 25))
        app.staticTexts["build"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 15))
        app.buttons["terminal-expand-input"].tap()

        let editor = app.textViews["terminal-expanded-input"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        editor.typeText("expanded-input-lease")
        app.buttons["terminal-expanded-send"].tap()

        XCTAssertTrue(waitForLabel(containing: "desktop took the lease", in: app, timeout: 10))
        XCTAssertTrue(waitForLabel(containing: "mock desktop received: expanded-input-lease", in: app, timeout: 20))
        XCTAssertTrue(editor.waitForNonExistence(timeout: 10), "the editor did not close after the replay was accepted")
    }

    /// 按工具栏上的指令不唤起系统键盘。
    ///
    /// 产品负责人 2026-09-21 在真机上点的：按「回车」把手机键盘抬起来了。根因是每颗指令
    /// 胶囊的点击处理里都跟着一句 `inputFocused = true`（手机端第一版就在），而
    /// `toolbarStandDown` 把「正在打字」算成了工具栏让位的条件之一 —— 于是按下一颗键的
    /// 代价是两件事：键盘盖住终端，整条栏自己消失；想再按一次 Ctrl+C，得先把键盘收掉。
    ///
    /// 两条断言就是上面那两件事，只断键盘会漏掉第二条。而起手那一下（点输入框、键盘起来、
    /// 点画布收掉）不是走过场：少了它，这台机器要是根本弹不出键盘，下面那张「没弹」
    /// 也照样是绿的。
    func testTappingAToolbarCommandRaisesNoKeyboard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminal = openClaudeCodeTerminal(app)
        let enter = app.buttons["toolbar-enter"]
        XCTAssertTrue(enter.waitForExistence(timeout: 15), "the mirrored toolbar has no return key")

        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "input field missing")
        field.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 10),
            "点了输入框，系统键盘没起来 —— 这个环境证明不了任何事"
        )
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForNonExistence(timeout: 8),
            "tapping the terminal did not dismiss the keyboard"
        )
        XCTAssertTrue(waitForHittable(enter, timeout: 10), "收起键盘之后，工具栏没有回来")

        enter.tap()
        // 先等这条键真的到了电脑。否则「键盘没起来」也可能只是因为它压根没发出去。
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Enter", in: app, timeout: 20),
            "the return key never reached the computer"
        )
        XCTAssertFalse(
            app.keyboards.firstMatch.waitForExistence(timeout: 3),
            "按指令把系统键盘抬起来了"
        )
        XCTAssertTrue(enter.isHittable, "按完指令，工具栏自己让位了")
        capture(app, name: "16-toolbar-command-keeps-the-keyboard-down")
    }

    /// The bar under the terminal is the phone's own front row and the computer's
    /// commands, and the keys that left it are behind the keyboard button.
    ///
    /// Both halves are the feature. The front row is written on the phone — arrows, Tab,
    /// return, the interrupt and the two slash commands — and behind it come the commands
    /// the user wrote on their computer, whose own `Clear` is absent because it never
    /// reaches the terminal. The panel is where the rest of the keys live.
    func testToolbarMirrorsTheComputerAndTheKeyboardPanelSendsKeys() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        // `claude-code` rather than `build`: tests run in name order, this one sorts last,
        // and by then `testSwipeActionsRenameAndDelete` has deleted `build` and renamed
        // `api-logs`. The first session is the only fixture nobody consumes.
        let sessionRow = app.staticTexts["claude-code"]
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 25), "the claude-code session never appeared")
        if !waitForHittable(sessionRow, timeout: 10) {
            capture(app, name: "00-session-row-not-tappable")
            let visible = app.descendants(matching: .any).allElementsBoundByIndex
                .prefix(12)
                .map { "\($0.elementType.rawValue):\($0.identifier.isEmpty ? $0.label : $0.identifier)" }
            XCTFail("the session never became tappable; visible: \(visible)")
            return
        }
        sessionRow.tap()
        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")

        // The mock sends six buttons. Four of them are its built-ins — the computer's own
        // front row, which it no longer sends and which this phone draws for itself. So
        // all six ids are on the bar: the four from this side, and the mock's two.
        for id in ["toolbar-enter", "toolbar-interrupt", "toolbar-slash-exit", "toolbar-slash-clear",
                   "toolbar-mock-deploy", "toolbar-mock-port"] {
            XCTAssertTrue(app.buttons[id].waitForExistence(timeout: 10), "the bar is missing \(id)")
        }
        // Not sent at all: it clears the desktop's own renderer and never reaches the
        // terminal, so drawing it here would promise something that cannot happen.
        XCTAssertFalse(app.buttons["toolbar-clear"].exists, "Clear was drawn on the phone")
        // The two fixed keys at the ends, the phone's own seven, and the two of the
        // mock's six that the user wrote. Read-only either way: managing the commands
        // belongs to the computer, and the front row to the phone's own build.
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'toolbar-'")).count, 11,
            "the bar has an unexpected number of buttons (11 = two fixed keys + the phone's 7 + 2 commands)"
        )
        capture(app, name: "10-toolbar-mirrored")

        // Return, through the mirrored bar. It is the one button that has to work: the
        // input field sends text and an empty send is not a message the protocol can
        // carry, so without this there is no way to answer a TUI at all — including the
        // approval prompts Claude Code waits on. Pressed first, while the bar is still
        // at its leading edge.
        app.buttons["toolbar-enter"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Enter", in: app, timeout: 20),
            "the mirrored return key did not reach the computer"
        )

        // A button that runs its command: the computer echoes it, and the echo is proof
        // the press crossed the socket rather than being drawn and dropped. The user's
        // own commands sit past the phone's front row, so the bar is scrolled first —
        // the same gesture a user makes, and the reason the bar scrolls at all.
        let bar = app.scrollViews["toolbar-scroll"]
        XCTAssertTrue(bar.exists, "the toolbar is not a scroll view")
        bar.swipeLeft()
        XCTAssertTrue(
            waitForHittable(app.buttons["toolbar-mock-deploy"], timeout: 10),
            "the user's own command never came into view"
        )
        app.buttons["toolbar-mock-deploy"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "mock desktop received: pnpm mock-deploy", in: app, timeout: 20),
            "a mirrored command button did not reach the computer"
        )

        // The keyboard panel, and a key from it. The mock echoes which key arrived,
        // which is the only way this test can tell one key from another.
        bar.swipeRight()
        XCTAssertTrue(
            waitForHittable(app.buttons["toolbar-keyboard"], timeout: 10),
            "the keyboard button never came back into view"
        )
        app.buttons["toolbar-keyboard"].tap()
        XCTAssertTrue(
            app.buttons["panelkey-modifier-Ctrl"].waitForExistence(timeout: 10),
            "the panel never opened"
        )
        capture(app, name: "11-keyboard-panel-board")

        // 第 1 页是高频页，也是这一版重排版的全部理由：**方向键和回车都在这一页**。
        // Claude Code 弹选项时要按 ↑↓ 再回车，翻页的成本正好落在最不该落的地方。
        XCTAssertTrue(app.buttons["panelkey-key-ArrowDown"].isHittable, "第 1 页没有方向键")
        XCTAssertTrue(app.buttons["panelkey-key-ArrowUp"].isHittable, "第 1 页只有一半方向键")
        XCTAssertTrue(app.buttons["panelkey-key-Enter"].isHittable, "第 1 页没有回车")

        // 第二页：符号、编辑块、F1–F12，以及 F12 后面那三颗终端发不出去的键。翻页靠板子
        // 底下那两个点 —— 板子本身也能滑，但滑动在 UI 测试里落点不稳，点是最确定的一条路。
        // 两页各问一次，是因为「并页时悄悄丢了一半」这种错，只问落点那一页是看不出来的。
        // 「这一页在不在前面」问的是**能不能点到**，不是存不存在：`TabView` 会把两页
        // 都建出来，没露面的那一页的键在无障碍树里照样存在，只是落在屏幕外面。
        // 用 `waitForExistence` 问的话，`boardPage` 哪天又渲染错页了也照样是绿的。
        XCTAssertTrue(app.buttons["panelkey-page-1"].exists, "the board has no second page")
        app.buttons["panelkey-page-1"].tap()
        XCTAssertTrue(
            waitForHittable(app.buttons["panelkey-key-F1"], timeout: 5),
            "the second page has no function keys"
        )
        XCTAssertTrue(app.buttons["panelkey-key-PageUp"].isHittable, "the second page has no navigation block")
        XCTAssertTrue(app.buttons["panelkey-dead-PrtScr"].isHittable, "the second page is missing the keys a terminal cannot send")
        // 方向键搬走之后这一页不该还留着一份：一颗键在两个地方，等于「键靠位置找」是句
        // 空话，而两处的压暗逻辑哪天会各自漂开。
        XCTAssertFalse(app.buttons["panelkey-key-ArrowUp"].isHittable, "方向键在第 2 页还留着一份")
        capture(app, name: "12-keyboard-panel-function-page")

        // The function keys are the names this version added to the wire (38 → 51), so
        // one of them has to go all the way. Asserting the key is drawn would pass even
        // if the cloud or the computer had never heard of the name.
        app.buttons["panelkey-key-F1"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:F1", in: app, timeout: 20),
            "a function key did not reach the computer"
        )
        // And the ones a terminal has no byte for: drawn on the board, but a press sends
        // nothing at all. Waited out rather than checked immediately — an arrival would
        // come back over the wire, so only silence after a round trip proves anything.
        let lastLine = { app.staticTexts.allElementsBoundByIndex.last?.label ?? "" }
        let beforeDead = lastLine()
        app.buttons["panelkey-dead-PrtScr"].tap()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertEqual(lastLine(), beforeDead, "a key the terminal has no byte for was sent anyway")

        // Back to the first page, which is what the rest of this test presses. 同上：
        // 两页都在无障碍树里，只有「点得到」的那一页才是前面那一页。
        app.buttons["panelkey-page-0"].tap()
        XCTAssertTrue(
            waitForHittable(app.buttons["panelkey-key-Backspace"], timeout: 5),
            "the board did not come back"
        )

        // 方向键和回车这一版搬到了第 1 页，所以它们也得走完整条 wire。断言「键画出来了」
        // 对一个把 `ArrowDown` 拼错、或把字节接反了的实现照样是绿的 —— 电脑端收到什么
        // 才算数。这是这次重排版真正要买的东西，所以两条都问。
        app.buttons["panelkey-key-ArrowDown"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:ArrowDown", in: app, timeout: 20),
            "第 1 页的 ↓ 没有到达电脑端"
        )
        app.buttons["panelkey-key-Enter"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Enter", in: app, timeout: 20),
            "第 1 页的回车没有到达电脑端"
        )

        // `⇧tab` 在这一版里没有自己的键 —— 电脑键盘上本来也没有这样一颗，这是照 ToDesk
        // 的键位排的。它是 Claude Code 切权限模式用的那一颗，所以它必须拼得出来：修饰键
        // 那一行两页都常驻，而 Tab 跟着高频键一起搬到了第 1 页 —— 于是它现在是「同页两
        // 步」，不再要先翻页（上一版要翻到第二页才拼得出来，代价记在设计文档 §3.8）。
        XCTAssertTrue(
            waitForHittable(app.buttons["panelkey-modifier-Shift"], timeout: 10),
            "the modifier row never became pressable"
        )
        app.buttons["panelkey-modifier-Shift"].tap()
        app.buttons["panelkey-key-Tab"].tap()
        if !waitForLabel(containing: "[mock] keys key:Shift+Tab", in: app, timeout: 20) {
            // What the screen actually holds, because "did not reach the computer" has
            // several causes that look identical from here: the key was never pressed,
            // the press was refused, or the terminal is not showing what arrived. The
            // last lines are the ones that answer it — a refusal prints its own marker.
            capture(app, name: "22-shifttab-not-reached")
            let visible = app.staticTexts.allElementsBoundByIndex.suffix(12).map(\.label)
            XCTFail("⇧tab did not reach the computer; last lines: \(visible)")
        }

        // The point of the page: a chord is two taps, and what the computer receives is
        // the combination rather than the letter. Latched first, then the letter.
        app.buttons["panelkey-modifier-Ctrl"].tap()
        XCTAssertTrue(app.buttons["panelkey-letter-a"].waitForExistence(timeout: 5),
                      "the full keyboard has no letter keys")
        app.buttons["panelkey-letter-a"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Ctrl+A", in: app, timeout: 20),
            "a latched chord did not reach the computer"
        )
        // Still up: pressing several keys in a row is the ordinary way to use it.
        XCTAssertTrue(app.buttons["panelkey-modifier-Ctrl"].exists, "the panel closed after one key")
        capture(app, name: "13-keyboard-panel-stays-open")

        // `I` and `M` are the two chords the wire has no separate name for — their bytes
        // are Tab's and Return's — so they are sent as those keys. This is the assertion
        // that the panel knows it: pressing the chord has to produce `Tab`, not nothing
        // and not a name the computer would reject.
        //
        // `Shift` is tapped first each time, and not only to prove a second modifier
        // replaces the first. Two taps on one modifier in quick succession are the
        // double-tap that locks it, and here the interval is a network round trip that
        // nothing keeps above the threshold. Interleaving another modifier makes every
        // pair of `Ctrl` taps unambiguously separate, so the latch is always a single
        // tap and the assertion can only be about the chord.
        for (letter, expected) in [("i", "Tab"), ("m", "Enter")] {
            app.buttons["panelkey-modifier-Shift"].tap()
            app.buttons["panelkey-modifier-Ctrl"].tap()
            XCTAssertTrue(app.buttons["panelkey-letter-\(letter)"].waitForExistence(timeout: 5),
                          "no \(letter) key")
            app.buttons["panelkey-letter-\(letter)"].tap()
            XCTAssertTrue(
                waitForLabel(containing: "[mock] keys key:\(expected)", in: app, timeout: 20),
                "Ctrl+\(letter.uppercased()) did not arrive as \(expected)"
            )
        }

        // Alt is an Escape prefix, and both halves have to arrive as one intent — sent
        // separately the terminal would act on the bare Escape first.
        app.buttons["panelkey-modifier-Alt"].tap()
        app.buttons["panelkey-letter-b"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Escape text:b", in: app, timeout: 20),
            "the Alt chord did not arrive as one intent"
        )
        capture(app, name: "14-keyboard-panel-alt-chord")

        // With nothing latched the panel types the character, which is the whole reason
        // it can answer a TUI's `y`/`n` or a permission prompt's `1`/`2`/`3` without
        // being lowered to reach the system keyboard. A chord here would be wrong.
        app.buttons["panelkey-digit-3"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:3", in: app, timeout: 20),
            "an unlatched digit did not go out as text"
        )
        app.buttons["panelkey-letter-y"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:y", in: app, timeout: 20),
            "an unlatched letter did not go out as lower-case text"
        )

        // `Ctrl` is latched first and then replaced by `Shift`. What the computer
        // receives is what tells the two possibilities apart: if the modifiers stacked
        // instead of replacing, this would have gone out as `Ctrl+C` rather than as the
        // capital `C` — and a board that stacks has no key left that can be pressed.
        app.buttons["panelkey-modifier-Ctrl"].tap()
        app.buttons["panelkey-modifier-Shift"].tap()
        app.buttons["panelkey-letter-c"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:C", in: app, timeout: 20),
            "a second modifier stacked onto the first instead of replacing it"
        )
        capture(app, name: "15-keyboard-panel-shift")

        // Double-tapping locks the modifier, which is how a chord gets pressed several
        // times in a row. Two different letters have to go out as two different chords
        // without the modifier letting go in between, and the single tap after them has
        // to unlock it — otherwise the assert below would still arrive as a chord.
        let control = app.buttons["panelkey-modifier-Ctrl"]
        control.doubleTap()
        app.buttons["panelkey-letter-c"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Ctrl+C", in: app, timeout: 20),
            "the first chord after a locking double-tap did not arrive"
        )
        app.buttons["panelkey-letter-d"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Ctrl+D", in: app, timeout: 20),
            "a locked modifier let go after one key"
        )
        control.tap()
        app.buttons["panelkey-letter-e"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:e", in: app, timeout: 20),
            "the lock did not release, so the next key was still a chord"
        )
        capture(app, name: "16-keyboard-panel-locked")

        // Caps is the one key on the board that is pure client state: it capitalises
        // letters and needs no name on the wire. Both halves are asserted, because a
        // latch that never lets go is the failure a one-sided check would miss.
        app.buttons["panelkey-page-1"].tap()
        XCTAssertTrue(waitForHittable(app.buttons["panelkey-caps"], timeout: 10), "no Caps key")
        app.buttons["panelkey-caps"].tap()
        capture(app, name: "17-keyboard-panel-caps")
        app.buttons["panelkey-page-0"].tap()
        app.buttons["panelkey-letter-a"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:A", in: app, timeout: 20),
            "Caps did not capitalise the next letter"
        )
        app.buttons["panelkey-page-1"].tap()
        app.buttons["panelkey-caps"].tap()
        app.buttons["panelkey-page-0"].tap()
        app.buttons["panelkey-letter-a"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:a", in: app, timeout: 20),
            "Caps stayed on after being switched off"
        )

        // 收起这块面板的路只剩一条：点键盘外侧那块画布。面板一上来，工具栏和输入栏
        // 整条让位 —— 那颗 ⌘ 也跟着走了，所以屏幕下半部分就是一块电脑键盘，它上面压着的
        // 东西只剩终端本身。
        //
        // 「手机键盘」那一栏因此没有了：系统键盘走的是它本来就该走的那条路，点输入框。
        // 而输入栏在面板收起来之后才回到屏幕上，两块键盘撞不到一起。
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            app.buttons["panelkey-modifier-Ctrl"].waitForNonExistence(timeout: 10),
            "点画布没有收起电脑键盘"
        )
        XCTAssertTrue(
            app.buttons["toolbar-keyboard"].waitForExistence(timeout: 10),
            "收了面板，工具栏没有回来"
        )
        XCTAssertTrue(
            app.buttons["voice-mode-toggle"].exists,
            "收了面板，输入栏没有回来"
        )
        capture(app, name: "18-panel-dismissed-by-canvas")
    }

    /// The panel is a keyboard, so it answers what a keyboard answers: it holds still
    /// while it is up, and the one gesture outside it puts it away.
    ///
    /// 「面板开着的时候上面还剩什么」是这一条量得出来的另一半：工具栏与输入栏整条让位，
    /// 键盘上面只剩终端。收它的路也只剩一条 —— 点画布（竖屏；横屏那颗 ⌘ 并进了顶栏，
    /// 所以两条路都通）。
    func testThePanelAnswersTheKeyboardGestures() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        app.staticTexts["claude-code"].tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")
        XCTAssertTrue(
            waitForLabel(containing: "Claude Code v2.1.0", in: app, timeout: 15),
            "the terminal never rendered the desktop's output"
        )

        let keyboardButton = app.buttons["toolbar-keyboard"]
        let toolbar = app.buttons["toolbar-all"]
        let toggle = app.buttons["voice-mode-toggle"]
        // 用修饰键那一行当「面板开没开」的探针：它两页都在，所以拿它当探针不会随版面
        // 改动失效 —— `esc` 曾住在第二页，2026-09-20 搬到了第一页，这颗探针两次都还在。
        let escapeKey = app.buttons["panelkey-modifier-Ctrl"]
        XCTAssertTrue(waitForHittable(keyboardButton, timeout: 10), "no way into the panel")

        // Up, and the two bars go with it: the keyboard is the whole of the bottom of the
        // screen, and the terminal is what gives up the room. 栏是滑走的，所以先等它落定
        // 再断言「不在了」—— 只断言一边的检查，标识符写错了也会绿。
        keyboardButton.tap()
        XCTAssertTrue(escapeKey.waitForExistence(timeout: 10), "the panel never opened")
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(toolbar.exists, "面板开着，工具栏还压在键盘上面")
        XCTAssertFalse(toggle.exists, "面板开着，输入栏还压在键盘上面")
        capture(app, name: "17-panel-in-the-keyboard-slot")
        let withPanel = terminal.frame.height

        // 板子得是一个网格：纵向的缝和横向的缝一样宽。
        //
        // 这是 2026-09-19 那次真机截图留下的回归项。当时一颗键的点击盒比键自己高
        // 6pt（点击区），那 6pt 又以「布局高度」的形式被算了一遍，于是行距从 42 变成
        // 48 —— 纵向的缝 12pt、横向还是 6pt，而同一块板子还因此比面板高了 36pt，
        // 第二页要滚才够得着底行。
        //
        // 量的都是 a11y 框的位置，不是尺寸：点击盒归谁不影响「两颗键之间多高」。
        let q = app.buttons["panelkey-letter-q"].frame
        let a = app.buttons["panelkey-letter-a"].frame
        let z = app.buttons["panelkey-letter-z"].frame
        XCTAssertEqual(a.minY - q.minY, 42, accuracy: 1, "行距不是键高 36 + 键距 6")
        XCTAssertEqual(z.minY - a.minY, 42, accuracy: 1, "三行字母的行距不均匀")

        // 横向那一份由数字行反推：十列从第一颗的左沿铺到最后一颗的右沿，那段是
        // 10 个键宽 + 9 道缝；而相邻两颗左沿之差是 1 个键宽 + 1 道缝。两个一减就是
        // 一道缝 —— 这样写不必假定键有多宽，屏宽变了也成立。
        let digitOne = app.buttons["panelkey-digit-1"].frame
        let digitTwo = app.buttons["panelkey-digit-2"].frame
        let digitZero = app.buttons["panelkey-digit-0"].frame
        let columnPitch = digitTwo.minX - digitOne.minX
        let keyWidth = (digitZero.maxX - digitOne.minX) - 9 * columnPitch
        XCTAssertEqual(columnPitch - keyWidth, 6, accuracy: 1, "键距不是 6")
        XCTAssertEqual((a.minY - q.minY) - 36, columnPitch - keyWidth, accuracy: 1,
                       "纵向的缝和横向的缝不一样宽，板子就不是一个网格")

        // 面板只有一个高度，两页都是这个高度 —— 翻页时终端一动不动。2026-09-20 之前
        // 这条是用「第一页底下空两行」换来的；方向键搬上去之后两页都铺满，它仍然成立，
        // 但不再是白扔两行换的。
        app.buttons["panelkey-page-1"].tap()
        XCTAssertTrue(
            waitForHittable(app.buttons["panelkey-key-F1"], timeout: 10),
            "the second page never came up"
        )
        capture(app, name: "17b-panel-second-page")
        XCTAssertEqual(
            terminal.frame.height, withPanel, accuracy: 2,
            "翻到第二页动了终端的高度"
        )
        // 板子也没跟着长：第二页的底行不靠滚动就够得着（板子和面板一样高）。
        XCTAssertTrue(
            app.buttons["panelkey-key-F12"].isHittable,
            "第二页的底行要滚才够得着"
        )
        app.buttons["panelkey-page-0"].tap()
        XCTAssertTrue(
            waitForHittable(app.buttons["panelkey-letter-q"], timeout: 10),
            "the first page never came back"
        )
        XCTAssertEqual(
            terminal.frame.height, withPanel, accuracy: 2,
            "翻回第一页动了终端的高度"
        )

        // 收面板：点键盘外侧那块画布。竖屏里这是唯一的一条路 —— 那颗 ⌘ 随着工具栏
        // 一起让位了，看不见就点不到。两条栏随之回来。
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            escapeKey.waitForNonExistence(timeout: 10),
            "tapping the canvas did not put the panel away"
        )
        capture(app, name: "19-panel-dismissed-by-canvas")
        XCTAssertTrue(waitForHittable(toolbar, timeout: 10), "收了面板，工具栏没有回来")
        XCTAssertTrue(waitForHittable(toggle, timeout: 10), "收了面板，输入栏没有回来")
        XCTAssertGreaterThan(
            terminal.frame.height, withPanel,
            "the terminal did not get its height back when the panel closed"
        )

        // 打字是另一个键盘，走的是它本来就该走的那条路：点输入框把系统键盘叫起来。
        // 面板这时候是收着的，两块键盘撞不到一起 —— 没有那条「手机键盘」的岔路了。
        app.textFields.firstMatch.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 10),
            "点了输入框，系统键盘没有起来"
        )
        XCTAssertFalse(escapeKey.exists, "叫起系统键盘的时候面板也跟着起来了")
    }

    /// 「组合键」那颗开关只管锁存，不动版面。
    ///
    /// 两句都要量，因为它们是同一句话的两半。关掉之后四颗修饰键**还在原处** —— 一整行
    /// 随开关出现和消失，等于同一块键盘在两种状态下是两张图，刚找到 Ctrl 的人得在拨一下
    /// 开关之后再找一次。而关掉之后按 Ctrl 再按字母，电脑端收到的是**那一个字母**：这一半
    /// 同时钉住了「关掉 = 组合不成立」和「关掉之后板子照旧发得出去」—— 后者才是这条改动
    /// 真正有后果的地方。
    func testTheCombinationSwitchChangesTheLatchAndNothingElse() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        app.staticTexts["claude-code"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "Claude Code v2.1.0", in: app, timeout: 15),
            "the terminal never rendered the desktop's output"
        )

        let keyboardButton = app.buttons["toolbar-keyboard"]
        XCTAssertTrue(waitForHittable(keyboardButton, timeout: 10), "no way into the panel")
        keyboardButton.tap()

        // 四颗按顺序取一遍：`⌘` 的标识符里带的是那个字符本身，和它键帽上印的一样。
        let modifiers = KeyboardPanelModifierProbe.all
        let before = modifiers.map { key -> CGRect in
            let element = app.buttons[key.id]
            XCTAssertTrue(element.waitForExistence(timeout: 10), "面板上少了 \(key.name)")
            return element.frame
        }
        XCTAssertTrue(app.switches["panelkey-combination"].exists, "面板上没有「组合键」那颗开关")

        // 关掉。四颗的框一个点都不该动。
        app.switches["panelkey-combination"].tap()
        Thread.sleep(forTimeInterval: 0.5)
        for (index, key) in modifiers.enumerated() {
            XCTAssertTrue(app.buttons[key.id].exists, "关掉组合键之后 \(key.name) 不见了")
            XCTAssertEqual(app.buttons[key.id].frame, before[index],
                           "关掉组合键之后 \(key.name) 挪了位置")
        }

        // 按得动，但没有下一步：发出去的是字母本身。
        app.buttons["panelkey-modifier-Ctrl"].tap()
        app.buttons["panelkey-letter-a"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:a", in: app, timeout: 20),
            "组合键关着的时候，Ctrl 还是把下一个字母变成了组合"
        )

        // 打开，同一串动作变成组合。两半都问，才不是只钉住一边。
        app.switches["panelkey-combination"].tap()
        app.buttons["panelkey-modifier-Ctrl"].tap()
        app.buttons["panelkey-letter-a"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Ctrl+A", in: app, timeout: 20),
            "组合键开着的时候，Ctrl 不再锁存"
        )
    }

    /// 修饰键那四颗的标识符与名字。写在用例里而不是读面板的模型：读过来的话，键被删掉
    /// 一颗这里就跟着少一颗，而「少了一颗」正是这条用例要发现的事。
    private enum KeyboardPanelModifierProbe: String, CaseIterable {
        case control = "Ctrl"
        case shift = "Shift"
        case alt = "Alt"
        case command = "⌘"

        var name: String { rawValue }
        var id: String { "panelkey-modifier-\(rawValue)" }
        static var all: [KeyboardPanelModifierProbe] { allCases }
    }

    /// 在终端页上把它停掉，这一页就该自己回到列表上。
    ///
    /// 停止之后电脑那边就没有这个会话了：进程退出，下一份列表里不再有它。留下来的
    /// 那一页既没有内容可画（画布上最后几行是会消失的），输入栏也没有收件人，退出
    /// 只能靠用户自己想起返回键 —— 而屏幕上没有任何地方说过这件事。
    ///
    /// 用 `scratch` 而不是别的 fixture：那几只各自被后面的用例改名或删掉，停掉一只
    /// 就等于把它从那些用例手里拿走。
    func testStoppingTheTerminalReturnsToTheList() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        let sessionRow = app.staticTexts["scratch"]
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 25), "the scratch session never appeared")
        XCTAssertTrue(waitForHittable(sessionRow, timeout: 10), "the session never became tappable")
        sessionRow.tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")
        XCTAssertTrue(app.buttons["toolbar-enter"].waitForExistence(timeout: 15), "the bar never arrived")

        // Stop it from the screen's own menu, the way a user would.
        app.buttons["更多"].tap()
        let stop = app.buttons["停止终端"]
        XCTAssertTrue(stop.waitForExistence(timeout: 5), "the more menu has no stop entry")
        stop.tap()
        let confirm = app.alerts.firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "stopping asked for no confirmation")
        confirm.buttons["停止"].tap()

        // Nothing below taps back: the screen has to leave on its own.
        XCTAssertTrue(
            terminal.waitForNonExistence(timeout: 20),
            "the terminal screen stayed up after the terminal was stopped"
        )
        XCTAssertTrue(
            app.buttons["toolbar-enter"].waitForNonExistence(timeout: 10),
            "the input bar was still up after the terminal was stopped"
        )
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 10),
            "the list never came back"
        )
        XCTAssertTrue(
            sessionRow.waitForNonExistence(timeout: 10),
            "the stopped terminal is still in the list"
        )
        capture(app, name: "16-stop-returns-to-the-list")
    }

    /// 电脑联系不上的时候，这一页留着，但栏上的东西点不动。
    ///
    /// 与上面那条划的是同一条线：终端「没了」和终端「够不着」不是一件事。电脑掉线时
    /// 列表整个是空的，哪个会话都不在里面 —— 这不是这些会话结束了，所以这一页必须留
    /// 着（人还坐在这个终端前面，电脑回来时他还在原地），而这段时间里按下的每一个键
    /// 都发不出去，栏得说出这件事。
    func testTheBarGreysOutWhenTheComputerGoesAway() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        let sessionRow = app.staticTexts["claude-code"]
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 25), "the claude-code session never appeared")
        XCTAssertTrue(waitForHittable(sessionRow, timeout: 10), "the session never became tappable")
        sessionRow.tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")
        let enter = app.buttons["toolbar-enter"]
        XCTAssertTrue(enter.waitForExistence(timeout: 15), "the bar never arrived")
        XCTAssertTrue(enter.isEnabled, "the bar is greyed out on a running terminal")

        // 这条用例要把电脑从整轮运行里拿走一会儿，所以无论成败都要还回去：mock 的断开
        // 是持久的（它自己不会重连），而后面每一个用例都指望着一台在线的电脑。
        addTeardownBlock {
            XCTAssertEqual(self.post("/desktop/connect"), 200, "the mock desktop would not come back")
        }
        XCTAssertEqual(
            post("/desktop/disconnect"), 200,
            "the mock desktop control channel is unreachable at \(controlBaseURL)"
        )

        XCTAssertTrue(waitForDisabled(enter, timeout: 30), "the bar stayed live with no computer behind it")
        XCTAssertTrue(terminal.exists, "the terminal screen left when the computer went away")

        // 面板照旧打得开 —— 它里面是这颗手机自己认识的字，读一读不欠谁什么 —— 但一颗
        // 键都按不动：按下去就是一条没人接的 intent。
        app.buttons["toolbar-keyboard"].tap()
        let escape = app.buttons["panelkey-modifier-Ctrl"]
        XCTAssertTrue(escape.waitForExistence(timeout: 10), "the panel never opened")
        XCTAssertTrue(waitForDisabled(escape, timeout: 10), "a panel key is still live with no computer behind it")
        capture(app, name: "16-greyed-out-with-no-computer")
    }

    /// A computer with nothing of the user's to show still leaves a bar that works.
    ///
    /// The front row is the phone's own and is drawn whatever the computer says, so this
    /// bar is the ordinary one minus its commands. What is being pinned is that it is
    /// never empty: with no keyboard of its own, a phone with no return key cannot
    /// confirm anything in a TUI, including the approval prompts Claude Code waits on.
    ///
    /// Needs a computer that genuinely does not send the message, so it is skipped
    /// unless the run is set up for one — a mock desktop started with `--no-toolbar`.
    /// Asserting it by reading the front-row constant would only prove the constant
    /// exists, not that the bar ever draws it.
    func testAnOldComputerStillGetsAUsableBar() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["SYNAPSE_TEST_OLD_DESKTOP"] == "1",
            "run with a mock desktop started --no-toolbar and SYNAPSE_TEST_OLD_DESKTOP=1"
        )

        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        let sessionRow = app.staticTexts["claude-code"]
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 25), "the claude-code session never appeared")
        XCTAssertTrue(waitForHittable(sessionRow, timeout: 10), "the session never became tappable")
        sessionRow.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 15),
            "terminal never appeared"
        )

        // Long enough that a list which was going to arrive would have.
        XCTAssertTrue(app.buttons["toolbar-enter"].waitForExistence(timeout: 15), "no return key: a TUI cannot be confirmed")
        for id in ["toolbar-interrupt", "toolbar-slash-exit", "toolbar-slash-clear"] {
            XCTAssertTrue(app.buttons[id].exists, "the bar is missing \(id)")
        }
        XCTAssertTrue(app.buttons["toolbar-keyboard"].exists, "the keyboard button is the phone's own and must stay")
        // The assertion that makes this test mean anything. The front row's ids are on
        // the bar whether or not a computer has spoken, so checking only for them passes
        // either way. `mock-deploy` is a command this mock owns and this phone has never
        // heard of, so its absence is what says nothing was received — and if that
        // computer ever did send a list, this test fails rather than quietly passing for
        // the wrong reason.
        XCTAssertFalse(
            app.buttons["toolbar-mock-deploy"].exists,
            "the computer sent its own list after all — this test proves nothing about the empty case"
        )
        capture(app, name: "15-computer-with-no-commands")
    }

    /// What the computer offers follows the user's edits.
    ///
    /// The computer's list is a snapshot the phone replaces wholesale, so all three
    /// edits a user can make are the same event seen from here: add, rename and delete
    /// each arrive as "the list is now this". A merge rather than a replace would show
    /// a deleted command forever, which is the failure this pins down.
    func testToolbarFollowsTheComputerWhenItsCommandsChange() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        let sessionRow = app.staticTexts["claude-code"]
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 25), "the claude-code session never appeared")
        XCTAssertTrue(waitForHittable(sessionRow, timeout: 10), "the session never became tappable")
        sessionRow.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 15),
            "terminal never appeared"
        )
        XCTAssertTrue(app.buttons["toolbar-mock-deploy"].waitForExistence(timeout: 15), "the computer's own commands are missing")

        // Added on the computer.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("fresh", "刚建的", "custom", text: "pnpm fresh", pressEnter: true),
        ])
        XCTAssertTrue(
            app.buttons["toolbar-fresh"].waitForExistence(timeout: 15),
            "a command added on the computer never reached the phone"
        )
        XCTAssertFalse(app.buttons["toolbar-mock-deploy"].exists, "a removed command is still on the bar")

        // Renamed, which keeps the id and changes only the wording.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("fresh", "改过名的", "custom", text: "pnpm fresh", pressEnter: true),
        ])
        XCTAssertTrue(
            app.buttons["toolbar-fresh"].waitForExistence(timeout: 15),
            "the renamed command disappeared instead of being renamed"
        )
        XCTAssertTrue(
            app.buttons["toolbar-fresh"].label == "改过名的",
            "the phone is still showing the old wording: \(app.buttons["toolbar-fresh"].label)"
        )

        // Deleted, leaving a computer that has said it has nothing of the user's — which
        // empties the commands and nothing else. Inventing a command here would offer one
        // this computer never had; the front row is not invented, and stays.
        try setMockToolbar([])
        XCTAssertTrue(
            app.buttons["toolbar-fresh"].waitForNonExistence(timeout: 15),
            "a command deleted on the computer is still on the phone"
        )
        XCTAssertTrue(app.buttons["toolbar-keyboard"].exists, "the keyboard button is not this phone's own and must stay")
        XCTAssertTrue(
            app.buttons["toolbar-enter"].waitForExistence(timeout: 15),
            "the phone's own front row went missing when the computer had nothing to say"
        )
        capture(app, name: "14-toolbar-empty")

        // Left how it was found: the mock outlives this test, and the ones after it
        // expect the fixtures they were written against.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("interrupt", "Ctrl+C", "key", key: "Ctrl+C"),
            button("slash-exit", "/exit", "command", text: "/exit", pressEnter: true),
            button("slash-clear", "/clear", "command", text: "/clear", pressEnter: true),
            button("mock-deploy", "部署", "custom", text: "pnpm mock-deploy", pressEnter: true),
            button("mock-port", "查端口", "custom", text: "lsof -i :3001", pressEnter: false),
        ])
        XCTAssertTrue(
            app.buttons["toolbar-mock-deploy"].waitForExistence(timeout: 15),
            "the toolbar was not restored for the tests that follow"
        )
    }

    private func button(
        _ id: String,
        _ label: String,
        _ group: String,
        key: String? = nil,
        text: String? = nil,
        pressEnter: Bool = true
    ) -> [String: Any] {
        let action: [String: Any] = key.map { ["type": "key", "key": $0] }
            ?? ["type": "text", "text": text ?? "", "pressEnter": pressEnter]
        return ["id": id, "label": label, "group": group, "action": action]
    }

    private func setMockToolbar(_ buttons: [[String: Any]]) throws {
        let body = try JSONSerialization.data(withJSONObject: buttons)
        XCTAssertEqual(
            post("/desktop/toolbar", body: body), 200,
            "the mock desktop control channel is unreachable at \(controlBaseURL)"
        )
    }

    /// What this run's computer keeps in its 快捷输入 table.
    ///
    /// The same fixtures the mock starts with, so a test that changes them can put them
    /// back — the mock outlives the test and the runs after it expect what they were
    /// written against.
    private var defaultMockQuickPhrases: [[String: Any]] {
        [
            ["id": "mock-log", "content": "用 Easy Worklog 初始化今天的工作日志"],
            ["id": "mock-commit", "content": "这次改动整理成提交说明，中文，说清楚改了什么、为什么改"],
            ["id": "mock-review", "content": "把这次改动按可读性、边界情况、错误处理三个方面复查一遍"],
        ]
    }

    private func setMockQuickPhrases(_ phrases: [[String: Any]]) throws {
        let body = try JSONSerialization.data(withJSONObject: phrases)
        XCTAssertEqual(
            post("/desktop/quick-phrases", body: body), 200,
            "the mock desktop control channel is unreachable at \(controlBaseURL)"
        )
    }

    /// One copied item, in the shape the real computer sends.
    ///
    /// Callers pass ids unique to their own test, and that is not tidiness. The phone's
    /// clipboard list is persisted and its clear is remembered against the exact rows it
    /// removed, so two tests sharing an id interfere through the app's own storage even
    /// though the mock is restarted between runs: the second one finds its rows missing
    /// and the watermark refusing to accept them back.
    private func mockClipboardEntry(_ id: String, _ text: String, secondsAgo: Int) -> [String: Any] {
        // Stamped against now rather than a fixed moment, for the second half of the same
        // problem: the phone keeps the newest fifty, so fixtures frozen at one timestamp
        // would eventually be pushed out of its own list by later runs' identical ones.
        ["id": id, "text": text, "copiedAt": clipboardWireStamp.string(from: Date().addingTimeInterval(-Double(secondsAgo)))]
    }

    private let clipboardWireStamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Replaces what the computer has copied, and pushes it — the same thing the real one
    /// does on every copy, and the reason the clear tests below can drive it.
    private func setMockClipboard(_ entries: [[String: Any]]) throws {
        let body = try JSONSerialization.data(withJSONObject: entries)
        XCTAssertEqual(
            post("/desktop/clipboard", body: body), 200,
            "the mock desktop control channel is unreachable at \(controlBaseURL)"
        )
    }

    /// A suffix unique to this run, used by every clipboard fixture.
    ///
    /// Not tidiness. The phone persists this list and remembers a clear against the exact
    /// rows it removed, and the clearing test legitimately clears whatever is in the list
    /// at that moment — so a fixture id reused across runs gets watermarked by a previous
    /// run's clear and is refused forever after. Unique ids are what make these tests
    /// order-independent, which is what a test that runs beside three others has to be.
    private lazy var clipboardRunId = String(UUID().uuidString.prefix(8))

    /// The name this run's mock desktop publishes, which is `mock-desktop.mjs`'s own
    /// default and therefore what the switch below looks for.
    private var mockDesktopName: String { "Mock MacBook Pro" }

    /// Puts the phone on the mock desktop, whichever computer it started on.
    ///
    /// Not a convenience. A real Synapse signed into the same account is another online
    /// computer, and a phone that has viewed it before starts there — so the terminal
    /// these tests drive would be somebody else's, and the failures would read as a
    /// broken feature. What this adds is only the switch a reader would make by hand.
    /// An account with a single computer needs none of it, which is the case this is
    /// written to be a no-op in.
    private func selectMockDesktop(_ app: XCUIApplication) {
        let switchControl = app.buttons["switch-computer"]
        guard switchControl.waitForExistence(timeout: 25) else { return }
        guard !switchControl.label.hasPrefix(mockDesktopName) else { return }

        switchControl.tap()
        let option = app.buttons[mockDesktopName]
        if option.waitForExistence(timeout: 8) {
            option.tap()
        }
        // No assertion here on purpose: if the switch did not land, the caller's own
        // wait for the session row fails, and it fails saying what it was looking for.
    }

    /// Opens the terminal `claude-code` and waits for its toolbar to arrive.
    ///
    /// The first session is the only fixture nobody consumes, and the toolbar is the
    /// last thing the phone needs before this screen is usable — see
    /// `testToolbarMirrorsTheComputerAndTheKeyboardPanelSendsKeys` for why it is that
    /// row and not another.
    @discardableResult
    private func openClaudeCodeTerminal(_ app: XCUIApplication) -> XCUIElement {
        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        let sessionRow = app.staticTexts["claude-code"]
        XCTAssertTrue(sessionRow.waitForExistence(timeout: 25), "the claude-code session never appeared")
        XCTAssertTrue(waitForHittable(sessionRow, timeout: 10), "the session never became tappable")
        sessionRow.tap()
        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 15), "terminal never appeared")
        return terminal
    }

    /// The whole point of the restructure: the commands scroll, the two fixed keys do not.
    ///
    /// Before this, the bar was one `ScrollView` and the key at its leading edge slid off
    /// the screen along with the commands — so the only control that opens the keyboard
    /// panel became the one control that could not be found. The check that says the fix
    /// works is that the keys' own frames do not move, not merely that they still exist.
    func testTheTwoFixedKeysStayPutWhileTheCommandsScroll() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        // Fourteen commands — past one screen at any width, which is what a user with a
        // list of their own has.
        var many: [[String: Any]] = [
            button("enter", "回车", "key", key: "Enter"),
            button("interrupt", "Ctrl+C", "key", key: "Ctrl+C"),
            button("slash-exit", "/exit", "command", text: "/exit", pressEnter: true),
            button("slash-clear", "/clear", "command", text: "/clear", pressEnter: true),
        ]
        for index in 1...10 {
            many.append(button(
                "bulk-\(index)", "第\(index)条", "custom",
                text: "pnpm run task-\(index)", pressEnter: true
            ))
        }
        try setMockToolbar(many)

        let keyboardKey = app.buttons["toolbar-keyboard"]
        let panelKey = app.buttons["toolbar-all"]
        XCTAssertTrue(panelKey.waitForExistence(timeout: 15), "the panel key never arrived")
        let keyboardFrame = keyboardKey.frame
        let panelFrame = panelKey.frame

        let bar = app.scrollViews["toolbar-scroll"]
        XCTAssertTrue(bar.exists, "the commands are not the scroll view")
        bar.swipeLeft()
        bar.swipeLeft()

        // Scrolled to the far end: the last command is now on screen...
        XCTAssertTrue(
            app.buttons["toolbar-bulk-10"].waitForExistence(timeout: 10),
            "the command strip never scrolled to the end"
        )
        // ...and the two keys are exactly where they were, still on screen.
        XCTAssertTrue(keyboardKey.isHittable, "the keyboard key slid out of the bar")
        XCTAssertTrue(panelKey.isHittable, "the panel key slid out of the bar")
        XCTAssertEqual(keyboardKey.frame, keyboardFrame, "the keyboard key moved while the commands scrolled")
        XCTAssertEqual(panelKey.frame, panelFrame, "the panel key moved while the commands scrolled")
        capture(app, name: "21-fixed-keys-scrolled")

        // Left as the tests that follow expect it.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("interrupt", "Ctrl+C", "key", key: "Ctrl+C"),
            button("slash-exit", "/exit", "command", text: "/exit", pressEnter: true),
            button("slash-clear", "/clear", "command", text: "/clear", pressEnter: true),
            button("mock-deploy", "部署", "custom", text: "pnpm mock-deploy", pressEnter: true),
            button("mock-port", "查端口", "custom", text: "lsof -i :3001", pressEnter: false),
        ])
    }

    /// An edit on the computer reaches the phone, and the phone replaces rather than merges.
    ///
    /// The same event `testToolbarFollowsTheComputerWhenItsCommandsChange` pins down for
    /// the commands, on the other list. A merge would leave a sentence the user deleted
    /// on their computer showing forever on the phone.
    func testPhraseEditsOnTheComputerReachThePhone() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        try setMockQuickPhrases([["id": "q1", "content": "第一版"]])

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["快捷输入"].tap()
        XCTAssertTrue(
            app.buttons["phrase-row-q1"].waitForExistence(timeout: 15),
            "the sentence never reached the phone"
        )
        XCTAssertEqual(app.buttons["phrase-row-q1"].label, "第一版")

        // Edited on the computer, keeping its id — which is how a rename arrives.
        try setMockQuickPhrases([["id": "q1", "content": "改过之后的那一句"]])
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "改过之后的那一句"))
                .firstMatch.waitForExistence(timeout: 15),
            "the phone is still showing the old sentence"
        )

        // Deleted, leaving a computer that has said it has none — an empty state, not the
        // segment control disappearing, which is the other answer entirely.
        try setMockQuickPhrases([])
        XCTAssertTrue(
            app.buttons["phrase-row-q1"].waitForNonExistence(timeout: 15),
            "a sentence deleted on the computer is still on the phone"
        )
        XCTAssertTrue(app.staticTexts["shortcut-phrases-empty"].waitForExistence(timeout: 10))
        XCTAssertTrue(segment.exists, "an empty list took the segments away with it")

        // Left as the tests that follow expect it.
        try setMockQuickPhrases(defaultMockQuickPhrases)
    }

    /// The panel comes back on the segment it was left on, across a relaunch.
    ///
    /// It is a setting rather than a per-visit choice, so it outlives the process — and
    /// it is deliberately *not* corrected when the remembered segment is empty: swapping
    /// the user's own last choice for another one silently is worse than letting them see
    /// an empty state, because the empty state says why it is empty.
    func testThePanelRemembersWhichSegmentWasLastOpen() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        // Set rather than assumed. What is being tested is that a *change* to the segment
        // survives a close and a relaunch — not what it happened to be when this test
        // started, which depends on every test that ran before it and on whatever the
        // simulator's defaults still hold from the last run.
        if !segment.buttons["自定义命令"].isSelected {
            segment.buttons["自定义命令"].tap()
        }
        XCTAssertTrue(segment.buttons["自定义命令"].isSelected, "the panel would not go back to the commands")
        segment.buttons["快捷输入"].tap()
        XCTAssertTrue(
            app.buttons["phrase-row-mock-log"].waitForExistence(timeout: 10),
            "the sentences never appeared"
        )

        // Closed and reopened in the same run. The backdrop is the half of the screen
        // above the sheet, minus the strip at the very top that belongs to the status bar.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(segment.waitForNonExistence(timeout: 10), "the panel did not close")
        app.buttons["toolbar-all"].tap()
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel did not reopen")
        XCTAssertTrue(
            segment.buttons["快捷输入"].isSelected,
            "the panel came back on a different segment"
        )

        // And across a relaunch, which is what makes it a setting rather than a courier.
        app.terminate()
        app.launch()
        signIn(app)
        // A relaunch may restore straight into the terminal it was on. Opening it again
        // is what a launch from the list needs, and a no-op when it is already up.
        if !app.buttons["toolbar-all"].waitForExistence(timeout: 5) {
            openClaudeCodeTerminal(app)
        }
        app.buttons["toolbar-all"].tap()
        let afterRelaunch = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(afterRelaunch.waitForExistence(timeout: 10), "the panel did not reopen after a relaunch")
        XCTAssertTrue(
            afterRelaunch.buttons["快捷输入"].isSelected,
            "the remembered segment did not survive a relaunch"
        )

        // Put back on the commands: the tests that follow open the panel expecting them,
        // and this preference is the app's own, not the mock's.
        afterRelaunch.buttons["自定义命令"].tap()
        XCTAssertTrue(app.buttons["shortcut-mock-deploy"].waitForExistence(timeout: 10))
    }

    /// A computer whose owner has added nothing of their own says so.
    ///
    /// The common case, and the one this segment is named for. With nothing the user
    /// wrote — the mock's built-ins are the phone's own keys, which live on the bar one
    /// swipe away — this segment has nothing to show, and saying that in place beats an
    /// empty card with no explanation.
    func testThePanelSaysWhenThereAreNoCustomCommands() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        // The mock's built-ins only: no 部署, no 查端口.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("interrupt", "Ctrl+C", "key", key: "Ctrl+C"),
            button("slash-exit", "/exit", "command", text: "/exit", pressEnter: true),
            button("slash-clear", "/clear", "command", text: "/clear", pressEnter: true),
        ])

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["自定义命令"].tap()

        XCTAssertTrue(
            app.staticTexts["shortcut-commands-empty"].waitForExistence(timeout: 10),
            "a computer with no commands of its own did not say so"
        )
        XCTAssertFalse(app.buttons["shortcut-enter"].exists, "a built-in was listed in the panel")
        capture(app, name: "23-command-panel-empty")

        // Left as the tests that follow expect it: the mock outlives this run.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("interrupt", "Ctrl+C", "key", key: "Ctrl+C"),
            button("slash-exit", "/exit", "command", text: "/exit", pressEnter: true),
            button("slash-clear", "/clear", "command", text: "/clear", pressEnter: true),
            button("mock-deploy", "部署", "custom", text: "pnpm mock-deploy", pressEnter: true),
            button("mock-port", "查端口", "custom", text: "lsof -i :3001", pressEnter: false),
        ])
    }

    /// The panel's command section: the whole list at once, and it sends like the bar.
    func testTheCommandPanelShowsEveryCommandAndStillSendsOne() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        let panelKey = app.buttons["toolbar-all"]
        XCTAssertTrue(panelKey.waitForExistence(timeout: 15), "the bar has no key into the command panel")
        panelKey.tap()

        // Which segment the panel opens on is a setting of the app's own that outlives
        // this test, so this one asks for the commands rather than assuming they are what
        // came up. The tests that switch segments leave it switched — deliberately, since
        // that is what the setting is — and a test that assumed otherwise would pass or
        // fail on the order it happened to run in.
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["自定义命令"].tap()

        // Everything the computer offers, which is the point of the panel: the bar has
        // to be scrolled to be read, and this does not.
        for id in ["shortcut-mock-deploy", "shortcut-mock-port"] {
            XCTAssertTrue(app.buttons[id].waitForExistence(timeout: 10), "the panel is missing \(id)")
        }
        // 内置那四条**不进面板**：它们在工具栏最前面，贴着终端横滑一下就有，而面板是
        // 给「我不记得自己加过什么」用的。列出它们只会把真正的自定义挤下去。
        for id in ["shortcut-enter", "shortcut-interrupt", "shortcut-slash-exit", "shortcut-slash-clear"] {
            XCTAssertFalse(app.buttons[id].exists, "\(id) is a built-in and belongs on the bar, not in the panel")
        }
        capture(app, name: "15-command-panel")

        // A command sent from the panel crosses the socket exactly as one sent from the
        // bar does — the two are views of one list, so a press has to mean one thing.
        app.buttons["shortcut-mock-port"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys text:lsof -i :3001", in: app, timeout: 20),
            "a command pressed in the panel did not reach the computer"
        )
        // And the panel is gone, the way it is for a command pressed on the bar.
        XCTAssertTrue(
            app.buttons["shortcut-mock-port"].waitForNonExistence(timeout: 10),
            "the panel stayed open after a command was sent"
        )

        // Running a command focuses the input field, which raises the system keyboard —
        // the same thing pressing a command on the bar does, and the reason the keyboard
        // exists there at all. Left up, it is still animating into place when the next
        // test in the class starts, and a key press that lands mid-transition goes
        // nowhere. Put away here, the way a user puts it away and the way the other
        // tests in this file leave the screen.
        app.descendants(matching: .any)["terminal.text"]
            .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()

        // Left as the bar's own test needs it: the mock outlives this run.
        try setMockToolbar([
            button("enter", "回车", "key", key: "Enter"),
            button("interrupt", "Ctrl+C", "key", key: "Ctrl+C"),
            button("slash-exit", "/exit", "command", text: "/exit", pressEnter: true),
            button("slash-clear", "/clear", "command", text: "/clear", pressEnter: true),
            button("mock-deploy", "部署", "custom", text: "pnpm mock-deploy", pressEnter: true),
            button("mock-port", "查端口", "custom", text: "lsof -i :3001", pressEnter: false),
        ])
    }

    /// The 快捷输入 segment: the computer's own sentences, and what tapping one does.
    ///
    /// The one thing this test is really about is what tapping a sentence must *not* do.
    /// A command is an act and a sentence is text, so a tap puts the sentence in the
    /// composer and switches the bar out of voice mode — it is not sent, and it does
    /// not raise the keyboard.
    /// Getting that wrong would send, unread, a message the user had not looked at yet.
    func testThePhraseSegmentFillsTheFieldWithoutSending() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        selectMockDesktop(app)
        openClaudeCodeTerminal(app)

        let toggle = app.buttons["voice-mode-toggle"]
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "voice", "the input bar did not enter voice mode")

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        XCTAssertEqual(segment.buttons.count, 3, "the panel should offer three segments")

        segment.buttons["快捷输入"].tap()
        let row = app.buttons["phrase-row-mock-commit"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the computer's sentences never appeared")
        capture(app, name: "16-phrase-segment")

        row.tap()

        // The field replaces the voice bar and shows exactly what the computer wrote.
        XCTAssertEqual(toggle.value as? String, "keyboard", "the phrase left its draft hidden in voice mode")
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the input field is missing")
        let expected = "这次改动整理成提交说明，中文，说清楚改了什么、为什么改"
        XCTAssertTrue(
            waitForValue(containing: expected, in: field, timeout: 10),
            "the sentence did not reach the input field: \(field.value as? String ?? "(nil)")"
        )
        XCTAssertTrue(app.buttons["send"].isEnabled, "the filled draft cannot be sent")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "selecting a phrase raised the system keyboard")
        // Not sent. The computer echoes every command it receives, so an echo is proof
        // one went out — and there must not be one. Matched on the sentence rather than
        // on the echo prefix: the mock outlives this test and its terminal still holds
        // the commands earlier tests sent, so the prefix on its own is always on screen.
        XCTAssertFalse(
            waitForLabel(containing: "received: 这次改动", in: app, timeout: 3),
            "tapping a sentence sent it"
        )
        // And the panel closed, so the reader is looking at what they are about to send.
        XCTAssertTrue(
            app.segmentedControls["shortcut-panel-segment"].waitForNonExistence(timeout: 10),
            "the panel stayed open over the field it just filled"
        )
        capture(app, name: "17-phrase-filled")
    }

    /// A computer too old to have been asked gets no 快捷输入 segment, and still gets the
    /// other two.
    ///
    /// The other half of the pair. "This computer has none" and "this computer has never
    /// heard of these" are different answers, and they arrive as different things: an
    /// empty list in the first case, no message at all in the second. Only the second
    /// must leave the segment out — a computer that cannot answer must not be drawn as
    /// having answered "none", which a user reads as their own sentences having gone
    /// missing.
    ///
    /// The picker itself stays, unlike before the clipboard existed: two of the three
    /// segments need no answer from any computer — one is the reader's own list and the
    /// other is built in — so there is still somewhere to switch from and somewhere to
    /// switch to, and hiding the whole control would hide the clipboard with it.
    ///
    /// Run with a mock started `--no-toolbar`, which suppresses this message along with
    /// the toolbar, and `SYNAPSE_TEST_OLD_DESKTOP=1` — the same arrangement
    /// `testAnOldComputerStillGetsAUsableBar` uses, and for the same reason: a phone
    /// cannot be told a computer is old, it can only fail to be told anything.
    func testAnOldComputerGetsNoPhraseSegment() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["SYNAPSE_TEST_OLD_DESKTOP"] == "1",
            "run with a mock desktop started --no-toolbar and SYNAPSE_TEST_OLD_DESKTOP=1"
        )

        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        XCTAssertTrue(
            app.staticTexts["shortcut-commands-empty"].waitForExistence(timeout: 10),
            "the panel never opened, so the segment assertions below would prove nothing"
        )
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        XCTAssertEqual(segment.buttons.count, 2, "an unanswered computer should offer two segments")
        XCTAssertFalse(
            segment.buttons["快捷输入"].exists,
            "a computer that never sent the sentences was drawn as having none"
        )
        XCTAssertFalse(
            app.staticTexts["shortcut-phrases-empty"].exists,
            "an unanswered computer was shown the empty state meant for one that answered"
        )
        capture(app, name: "20-panel-old-desktop")
    }

    /// The clipboard segment shows what the computer copied, and tapping an item copies
    /// it without closing the panel.
    ///
    /// What this can assert is the pair of things the reader sees: the confirmation, and
    /// the list still being there. The pasteboard write itself is deliberately not read
    /// back from here — reading what another app put on the pasteboard raises the system
    /// paste prompt, and a test that hangs on a dialog is worse than no test. It is
    /// covered by the acceptance walkthrough, where a person pastes it somewhere.
    func testTheClipboardSegmentCopiesWithoutClosingThePanel() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        selectMockDesktop(app)
        // Pushed now rather than before the launch, and that is the difference between a
        // test that works and one that races: the control channel delivers to whatever
        // phone is connected, and before the launch there is none — so the fixture would
        // have to wait for the sync the phone sends on connecting, whose arrival is not
        // this test's to schedule.
        try setMockClipboard([
            mockClipboardEntry("clip-single-\(clipboardRunId)-1", "pnpm mobile:install", secondsAgo: 10),
            mockClipboardEntry("clip-single-\(clipboardRunId)-2", "这次改动整理成提交说明", secondsAgo: 8),
        ])
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")

        segment.buttons["剪贴板"].tap()
        let first = app.buttons["clipboard-row-clip-single-\(clipboardRunId)-1"]
        XCTAssertTrue(first.waitForExistence(timeout: 15), "the computer's copied text never appeared")
        capture(app, name: "24-clipboard-segment")

        first.tap()
        // The row itself reports the state, which can be asserted deterministically:
        // the app's banner carries the same word but lives one second, and XCUITest waits
        // for this app to go quiet after a tap — with a terminal streaming, that wait
        // outlives the banner.
        XCTAssertTrue(
            waitForValue(containing: "已复制", in: first, timeout: 10),
            "copying an item said nothing on the row it was copied from"
        )
        // Still open, unlike the two older segments: copying is usually followed by
        // copying a second one, and this is the list the reader is choosing from.
        XCTAssertTrue(segment.exists, "the panel closed over the list being chosen from")

        let second = app.buttons["clipboard-row-clip-single-\(clipboardRunId)-2"]
        XCTAssertTrue(second.waitForExistence(timeout: 10), "the second copied item is missing")
        second.tap()
        XCTAssertTrue(
            waitForValue(containing: "已复制", in: second, timeout: 10),
            "the second copy said nothing on the row it was copied from"
        )
    }

    /// The eye beside an item reads it; it does not copy it.
    ///
    /// The two controls are in the same row and mean different things, so the assertion
    /// that matters is that pressing the eye leaves the clipboard alone — an item put on
    /// the reader's clipboard by someone who only wanted to read the end of it is the
    /// failure. The confirmation is what says a copy happened, so its absence is the
    /// evidence.
    func testTheEyeShowsTheWholeCopiedItemWithoutCopyingIt() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        selectMockDesktop(app)
        try setMockClipboard([
            mockClipboardEntry("clip-eye-\(clipboardRunId)-1", "pnpm mobile:install", secondsAgo: 10),
            mockClipboardEntry("clip-eye-\(clipboardRunId)-2", "这次改动整理成提交说明，中文，说清楚改了什么", secondsAgo: 8),
        ])
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["剪贴板"].tap()

        let eye = app.buttons["clipboard-preview-clip-eye-\(clipboardRunId)-2"]
        XCTAssertTrue(eye.waitForExistence(timeout: 15), "the eye is missing")
        eye.tap()

        let full = app.staticTexts["clipboard-preview-text"]
        XCTAssertTrue(full.waitForExistence(timeout: 10), "the eye showed nothing")
        XCTAssertEqual(
            full.label,
            "这次改动整理成提交说明，中文，说清楚改了什么",
            "the preview is not the item it stands for"
        )
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(full.waitForNonExistence(timeout: 10), "the preview did not close")
        let copied = app.buttons["clipboard-row-clip-eye-\(clipboardRunId)-2"]
        XCTAssertTrue(copied.waitForExistence(timeout: 10), "the clipboard row disappeared")
        XCTAssertNotEqual(copied.value as? String, "已复制", "the eye copied the item")
        capture(app, name: "25-clipboard-preview")
    }

    /// Clearing the list survives the computer sending the same rows again.
    ///
    /// The failure this exists for is the ordinary one: the computer keeps those entries
    /// in its own ring and re-sends all of them the next time anything is copied, so
    /// without a watermark the rows the reader just deleted come straight back and
    /// "clear" means "until the next copy anywhere".
    func testClearingKeepsTheClearedRowsFromComingBack() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        selectMockDesktop(app)
        let fixture = [
            mockClipboardEntry("clip-clear-\(clipboardRunId)-1", "pnpm mobile:install", secondsAgo: 10),
            mockClipboardEntry("clip-clear-\(clipboardRunId)-2", "这次改动整理成提交说明", secondsAgo: 8),
        ]
        try setMockClipboard(fixture)
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["剪贴板"].tap()
        XCTAssertTrue(
            app.buttons["clipboard-row-clip-clear-\(clipboardRunId)-1"].waitForExistence(timeout: 15),
            "the list never filled, so clearing it would prove nothing"
        )

        app.buttons["clipboard-clear"].tap()
        app.alerts.firstMatch.buttons["清空"].tap()
        XCTAssertTrue(
            app.staticTexts["clipboard-empty"].waitForExistence(timeout: 10),
            "clearing left the list standing"
        )

        // The computer's next copy, as far as the phone can tell: the same rows, the same
        // moments, sent again — which is exactly what its ring produces.
        try setMockClipboard(fixture)
        XCTAssertFalse(
            app.buttons["clipboard-row-clip-clear-\(clipboardRunId)-1"].waitForExistence(timeout: 5),
            "a cleared row came back on the computer's next snapshot"
        )
        XCTAssertTrue(
            app.staticTexts["clipboard-empty"].exists,
            "the list is no longer showing its empty state"
        )
    }

    /// The device row opens the same list, for a reader who is not in a terminal yet.
    ///
    /// This is the entry that exists before any terminal is open, which is the whole
    /// reason there are two: the clipboard belongs to a computer, and this row is the only
    /// place on the session list that names one.
    func testTheDeviceRowOpensTheClipboard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        selectMockDesktop(app)

        try setMockClipboard([mockClipboardEntry("clip-row-\(clipboardRunId)-1", "pnpm mobile:install", secondsAgo: 10)])

        let button = app.buttons["device-clipboard"]
        XCTAssertTrue(button.waitForExistence(timeout: 25), "the device row has no clipboard button")
        button.tap()

        XCTAssertTrue(
            app.buttons["clipboard-row-clip-row-\(clipboardRunId)-1"].waitForExistence(timeout: 15),
            "the device row's clipboard never opened the list"
        )
        capture(app, name: "26-clipboard-sheet")
    }

    /// The eye beside a sentence reads it; it does not use it.
    ///
    /// The two controls sit in the same row and mean opposite things — one puts the
    /// sentence in the composer, the other only shows it — so the test that matters is
    /// that pressing the eye leaves the composer exactly as it was. A sentence typed into
    /// the field by someone who only wanted to read the end of it is the failure.
    func testTheEyeShowsTheWholeSentenceWithoutUsingIt() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["快捷输入"].tap()

        // A sentence long enough that one line cannot hold it, which is the whole reason
        // the key exists. The list shows the beginning; the preview shows all of it.
        let long = "这次改动整理成提交说明，中文，说清楚改了什么、为什么改"
        let row = app.buttons["phrase-row-mock-commit"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the sentences never appeared")
        XCTAssertTrue(row.label.hasPrefix("这次改动整理成提交说明"), "the row is not the sentence it should be")

        app.buttons["phrase-preview-mock-commit"].tap()

        let preview = app.staticTexts["phrase-preview-text"]
        XCTAssertTrue(preview.waitForExistence(timeout: 10), "the preview never opened")
        XCTAssertEqual(preview.label, long, "the preview is not showing the whole sentence")
        capture(app, name: "19-phrase-preview")

        // The field is untouched: reading a sentence is not using it.
        let field = app.textFields.firstMatch
        let before = field.value as? String ?? ""
        XCTAssertFalse(before.contains("整理成提交说明"), "opening the preview filled the input field")

        // Closing it comes back to the panel, still open and still on this segment —
        // the preview floats over the panel rather than replacing it. Dismissed by the
        // dimmed strip above it, which is one of the two ways the design allows and the
        // one a test can aim at without guessing at the sheet's drag geometry. Aimed
        // well below the top of the screen: a sheet leaves roughly half of it dimmed,
        // and the first few percent belong to the status bar, which swallows touches
        // rather than passing them on to the sheet underneath.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            preview.waitForNonExistence(timeout: 10),
            "the preview did not close"
        )
        XCTAssertTrue(
            app.buttons["phrase-preview-mock-log"].waitForExistence(timeout: 10),
            "closing the preview closed the panel behind it"
        )
        XCTAssertEqual(
            segment.buttons["快捷输入"].isSelected, true,
            "the panel came back on a different segment"
        )
    }

    /// A computer that has none says so, and the phone shows an empty state — not an
    /// empty panel, and not the segment control missing.
    ///
    /// This is one half of the pair the whole feature turns on. The other half — a
    /// computer too old to send the message at all — cannot be reached from here: the
    /// mock decides that when it starts (`--no-toolbar`), not while it runs. It is
    /// covered by `TerminalQuickPhrasesState`'s own tests, and by running this suite
    /// against a mock started that way.
    func testAComputerWithNoPhrasesShowsAnEmptyState() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        // The mock pushes the new list the moment it is set, the same way the real
        // computer pushes an edit rather than waiting to be asked.
        try setMockQuickPhrases([])

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "an empty list is an answer, so the segments stay")
        segment.buttons["快捷输入"].tap()

        XCTAssertTrue(
            app.staticTexts["电脑上还没有快捷输入"].waitForExistence(timeout: 10),
            "an empty list did not produce the empty state"
        )
        XCTAssertFalse(app.buttons["phrase-row-mock-log"].exists, "a sentence the computer no longer has is still here")
        capture(app, name: "18-phrase-empty")

        // Left as it was found: the mock outlives this run. `--no-toolbar` runs get a
        // mock of their own and do not see this at all.
        try setMockQuickPhrases(defaultMockQuickPhrases)
        XCTAssertTrue(
            app.buttons["phrase-row-mock-log"].waitForExistence(timeout: 10),
            "the sentences were not restored for the tests that follow"
        )
    }

    /// Where the mock desktop listens for control commands.
    ///
    /// The test process runs inside the simulator, which shares the host's
    /// loopback, so this reaches the mock on the machine running the server.
    private var controlBaseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_CONTROL_URL"] ?? "http://127.0.0.1:3011"
    }

    /// Drives the mock desktop. A UI test cannot start a host process, so making
    /// a computer come and go has to go through the mock's own control channel.
    private func post(_ path: String) -> Int? { post(path, body: nil) }

    private func post(_ path: String, body: Data?) -> Int? {
        guard let url = URL(string: controlBaseURL + path) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        let finished = DispatchSemaphore(value: 0)
        var status: Int?
        URLSession.shared.dataTask(with: request) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode
            finished.signal()
        }.resume()
        _ = finished.wait(timeout: .now() + 15)
        return status
    }

    /// Opens a list row's swipe actions.
    ///
    /// `swipeLeft()` swipes across the matched element, so on a short title like
    /// "build" the gesture is a few dozen points — too short to register, and the
    /// row reads it as a tap and opens the terminal instead. Dragging across most
    /// of the row's own width is the same gesture at a length the list honours.
    private func revealSwipeActions(on title: String, in app: XCUIApplication) {
        let row = app.cells.containing(.staticText, identifier: title).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(title) is not in the list")
        // The desktop streams summaries, and one arriving mid-drag cancels the
        // swipe. A person would simply swipe again, so this does too.
        for _ in 0..<3 {
            let start = row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
            let end = row.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5))
            start.press(forDuration: 0.05, thenDragTo: end)
            if app.buttons["重命名"].waitForExistence(timeout: 3) { return }
        }
        XCTFail("swiping \(title) never revealed its actions")
    }

    /// Signs in unless the app restored a session from the keychain.
    ///
    /// Credentials outlive the app process, so every run after the first starts
    /// already signed in — which is itself worth not fighting, since it is the
    /// behaviour a real user gets.
    private func signIn(_ app: XCUIApplication) {
        defer { enterTerminalTab(app) }
        let emailField = app.textFields.firstMatch
        let tabs = app.tabBars.firstMatch

        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            if tabs.exists || emailField.exists { break }
            usleep(200_000)
        }
        if !tabs.exists {
            guard emailField.exists else {
                // The screen at the moment it was given up on. Without it the only
                // message this failure can give is that nothing was found, which is
                // equally true of a stuck launch, a system permission alert and a
                // build that never installed.
                capture(app, name: "00-signin-never-appeared")
                let visible = app.descendants(matching: .any).allElementsBoundByIndex
                    .prefix(12)
                    .map { "\($0.elementType.rawValue):\($0.identifier.isEmpty ? $0.label : $0.identifier)" }
                XCTFail("neither the login screen nor a restored session appeared; visible: \(visible)")
                return
            }
            emailField.tap()
            emailField.typeText(email)

            let passwordField = app.secureTextFields.firstMatch
            passwordField.tap()
            passwordField.typeText(password)

            app.buttons["登录"].firstMatch.tap()
        }
        dismissSavePasswordPromptIfPresent(app)
    }

    /// Dismisses the system's "保存密码？" offer that follows a login.
    ///
    /// It belongs to a system process, sits over the app, and swallows the next
    /// gesture — so leaving it up makes a later, unrelated test fail.
    private func dismissSavePasswordPromptIfPresent(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for candidate in [app, springboard] where candidate.buttons["以后"].exists {
            candidate.buttons["以后"].tap()
            return
        }
        if springboard.buttons["以后"].waitForExistence(timeout: 3) {
            springboard.buttons["以后"].tap()
        }
    }

    /// XCTest matches accessibility labels exactly; terminal content is
    /// indented, so presence checks have to be substring matches.
    /// Exists and can be tapped are different things: a row that is on screen while the
    /// list is still settling fails a tap with "not hittable", which reads as a missing
    /// control rather than as a race.
    private func waitForHittable(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists && element.isHittable { return true }
            usleep(200_000)
        }
        return false
    }

    /// Waits for a control to grey out.
    ///
    /// The phone learns that from the computer, so the test has to wait for it rather
    /// than read it right after the call that caused it. Case the element is missing
    /// entirely, which reads as disabled too, so callers assert it is there first.
    private func waitForDisabled(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "enabled == false")
        return XCTWaiter().wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: element)],
            timeout: timeout
        ) == .completed
    }

    private func waitForLabel(containing text: String, in app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        let element = app.staticTexts.matching(predicate).firstMatch
        return element.waitForExistence(timeout: timeout)
    }

    /// Waits for a field's own text to contain something.
    ///
    /// `XCUIElement.value` rather than `label`: a text field carries what it holds in
    /// `value`, and its label is empty.
    private func waitForValue(containing text: String, in element: XCUIElement, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "value CONTAINS %@", text)
        return XCTWaiter().wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: element)],
            timeout: timeout
        ) == .completed
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 底栏冷启动落在主页，而这个文件里的用例绝大多数要的是终端列表。
    ///
    /// 挂在 `signIn` 的 `defer` 里，是因为那个函数有不止一条返回路径（会话已经恢复时
    /// 直接返回），而每一条之后人都需要在终端那一格上。要留在主页或去别处的用例，自己
    /// 再切一次即可。
    private func enterTerminalTab(_ app: XCUIApplication) {
        let tabs = app.tabBars.firstMatch
        guard tabs.exists else { return }
        let terminals = tabs.buttons.element(boundBy: TabIndex.terminals)
        guard terminals.exists else { return }
        terminals.tap()
    }

}
