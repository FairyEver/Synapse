import Foundation
import XCTest

/// Starting a Claude Code conversation from the phone, over the real path.
///
/// Requires a server and a desktop signed in to the same account, with at least one
/// project configured — the conversation is created *on that computer*, so there is
/// nothing to assert against without one. Credentials and the server address come
/// from the environment, so the file carries no secrets:
///
///   SYNAPSE_TEST_EMAIL, SYNAPSE_TEST_PASSWORD, SYNAPSE_TEST_BASE_URL
///
/// The test walks the acceptance baseline rather than the implementation: the two
/// taps, the remembered choice, the untouched terminal segment, and that no key ever
/// appears on this side of the wire.
final class AgentConversationUITests: XCTestCase {
    private var reviewDesktopRestoration: (id: String, name: String)?
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://localhost:3001/api"
    }

    override func setUpWithError() throws {
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        if let restoration = reviewDesktopRestoration {
            let app = XCUIApplication()
            if app.state == .runningForeground {
                let cancel = app.navigationBars.buttons["取消"].firstMatch
                if cancel.exists && cancel.isHittable { cancel.tap() }
                reviewGoHome(in: app)
                reviewSelectDesktop(restoration.id, name: restoration.name,
                    switcher: "home-switch-computer", optionPrefix: "home-switch-computer-option-", in: app)
            }
            reviewDesktopRestoration = nil
        }
        try super.tearDownWithError()
    }

    /// The first visit and the second, in one run, because the second is defined by
    /// what the first left behind. Split into two tests they would also be split across
    /// two app installs, and the remembered choice would never be there to check.
    func testStartsAConversationAndRemembersTheChoiceNextTime() throws {
        let app = launch(freshChoice: true)

        // MARK: First visit — the project has to be chosen once, and only once.

        app.buttons["new-session"].tap()
        if !app.buttons["new-session-project"].waitForExistence(timeout: 10) {
            // 「面板没出现」有两个完全不同的原因，而它们在屏幕上长得一样：那一格被
            // 禁用了（没有可用的电脑），或者点了没反应。把当时的状态一起报出来。
            capture(app, name: "new-session-never-appeared")
            XCTFail("""
            the panel never appeared; \
            new-session exists=\(app.buttons["new-session"].exists) \
            enabled=\(app.buttons["new-session"].isEnabled) \
            hittable=\(app.buttons["new-session"].isHittable)
            """)
        }
        // Scoped to the segmented control, because the screen behind the sheet has a
        // 终端 tab of its own — and addressed by label rather than by an identifier,
        // since a `Picker` in this style is a container of buttons and the container is
        // not what a tap lands on.
        XCTAssertTrue(segments(in: app)["对话"].exists, "the segmented control is missing")
        XCTAssertTrue(segments(in: app)["对话"].isSelected, "the panel did not open on 对话")
        // The Provider and model rows are already resolved by the computer, so the only
        // thing standing between the reader and the button is the project.
        XCTAssertTrue(app.buttons["new-session-provider"].exists, "供应商 row missing")
        XCTAssertTrue(app.buttons["new-session-model"].exists, "模型 row missing")
        XCTAssertFalse(
            app.buttons["start-conversation"].isEnabled,
            "开始对话 was live with no project chosen — first use has to ask for one"
        )
        XCTAssertFalse(app.staticTexts["上次"].exists, "a fresh install claimed a remembered project")

        let chosen = chooseFirstProject(in: app)
        XCTAssertFalse(app.staticTexts["上次"].exists, "a newly chosen project was marked as previously used")
        XCTAssertTrue(
            app.buttons["start-conversation"].waitForExistence(timeout: 5),
            "开始对话 never came back after choosing a project"
        )
        XCTAssertTrue(app.buttons["start-conversation"].isEnabled, "开始对话 stayed disabled")
        capture(app, name: "01-panel-ready")

        // MARK: The two taps — the button, and nothing decided in between.

        app.buttons["start-conversation"].tap()

        // A terminal, with the desktop's own title on it: the conversation was created
        // there, which is the only place it could have been.
        XCTAssertTrue(
            app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 30),
            "the phone never landed on the new terminal"
        )
        XCTAssertTrue(
            waitForLabel(containing: "Claude Code", in: app, timeout: 15),
            "the new session is not titled for Claude Code"
        )
        capture(app, name: "02-new-conversation")

        // MARK: Nothing on this side ever holds a credential or an endpoint.

        let lineage = app.debugDescription
        XCTAssertFalse(lineage.contains("ANTHROPIC_AUTH_TOKEN"), "a credential reached the phone")
        XCTAssertFalse(lineage.contains("ANTHROPIC_BASE_URL"), "a Provider endpoint reached the phone")

        // A fresh launch rather than a tap on the terminal screen's own back button:
        // what is being checked is that the choice survived the app, not that it
        // survived a navigation, and the terminal screen owns its own chrome.
        app.terminate()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()
        XCTAssertTrue(app.buttons["new-session"].waitForExistence(timeout: 30), "never got back to the list")

        // MARK: Second visit — nothing to read, nothing to decide.

        app.buttons["new-session"].tap()
        let project = app.buttons["new-session-project"]
        XCTAssertTrue(project.waitForExistence(timeout: 10), "the panel did not come back")
        // The tag is what says the row needs no reading.
        XCTAssertTrue(
            app.staticTexts["上次"].waitForExistence(timeout: 5),
            "the remembered project is not marked 上次"
        )
        XCTAssertTrue(
            waitForLabel(containing: chosen, in: app, timeout: 5),
            "the panel forgot which project was used"
        )
        XCTAssertTrue(app.buttons["start-conversation"].isEnabled, "开始对话 needs a decision on the second visit")
        capture(app, name: "03-remembered")
    }

    /// The terminal segment is unchanged on purpose, and this is what "unchanged" means:
    /// tapping a group creates a terminal, with no button to confirm it first. It grew a
    /// search box, which shortens the list and decides nothing — see the assertions below.
    ///
    /// 「点分组即建」现在只对**没配快捷命令**的分组成立：配了命令的分组右侧有箭头，
    /// 点进去先选命令。这里量的是没配的那些今天的样子，所以它在两种账号下都还成立。
    func testLeavesTheTerminalSegmentAlone() throws {
        let app = launch()

        app.buttons["new-session"].tap()
        XCTAssertTrue(segments(in: app)["对话"].waitForExistence(timeout: 10), "the panel never appeared")

        segments(in: app)["终端"].tap()
        // The group list, and no primary button: a terminal group has no default worth
        // guessing, so a confirm step here would be friction with nothing behind it.
        XCTAssertFalse(
            app.buttons["start-conversation"].exists,
            "the terminal segment grew a confirm button"
        )
        XCTAssertFalse(app.buttons["new-session-project"].exists, "the terminal segment shows the conversation rows")
        // The groups themselves, which are what the segment has always offered.
        //
        // 数的是带标识的分组行，不是 `app.cells`：弹层背后那条会话列表也在这棵树里，
        // 数 cell 数到的是它，分组列表空着这句也照样绿。
        let groups = app.buttons.matching(identifier: "terminal-group")
        XCTAssertGreaterThan(groups.count, 0, "the terminal segment lost its group list")
        capture(app, name: "04-terminal-segment")

        // 搜索框跟项目、供应商那两页是同一个做法，位置和外观都交给系统；这里验的是它在，
        // 而且真的在筛——只画一个搜索框也能让上面那句「分组还在」成立。
        let search = app.searchFields["搜索分组"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), "终端分组这一段没有搜索框")
        let found = groups.count

        let miss = "zzz-没有这个分组"
        search.tap()
        search.typeText(miss)
        XCTAssertTrue(waitForCount(groups, 0), "搜索没有把分组列表筛掉")
        capture(app, name: "05-terminal-segment-no-match")

        // 清掉搜索，分组要回来：筛得下去也要回得来。
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: miss.count))
        XCTAssertTrue(waitForCount(groups, found), "清掉搜索以后分组没有回来")
    }

    /// 给分组配了快捷命令的电脑上，终端分组那一段会长出第二层：行右一个箭头，点进去是
    /// 命令列表，列表底部永远有一条「直接新建终端」。
    ///
    /// 第一个分组没配快捷命令的账号跑不了这个用例 —— 有没有配是用户自己的数据，测试造不出来，
    /// 所以这里以跳过说明，而不是把电脑上的东西改掉。
    func testRunsASavedCommandFromThePanel() throws {
        let app = launch()

        app.buttons["new-session"].tap()
        XCTAssertTrue(segments(in: app)["对话"].waitForExistence(timeout: 10), "the panel never appeared")
        segments(in: app)["终端"].tap()

        let groups = app.buttons.matching(identifier: "terminal-group")
        XCTAssertGreaterThan(groups.count, 0, "the terminal segment lost its group list")
        groups.firstMatch.tap()

        // 第一个分组没配命令时它会直接建终端 —— 那正是「没命令的分组一点即建」，本用例
        // 要验的是另一条路，所以跳过并说清缺什么。
        let plain = app.buttons["terminal-group-command-none"]
        guard plain.waitForExistence(timeout: 10) else {
            throw XCTSkip("这个账号的第一个分组没有配快捷命令；在电脑上给第一个分组加一条命令后重跑")
        }
        capture(app, name: "06-group-command-list")

        // 命令列表：至少一条命令，加底部那条「直接新建终端」。
        let commands = app.buttons.matching(identifier: "terminal-group-command")
        XCTAssertGreaterThan(commands.count, 0, "进了命令列表却没有命令")
        XCTAssertTrue(plain.isHittable, "「直接新建终端」不在列表底部")

        // 点一条命令：面板关掉，落到一个终端上 —— 与「开始对话」落的是同一屏。
        let name = commands.firstMatch.staticTexts.firstMatch.label
        XCTAssertFalse(name.isEmpty, "命令没有名字")
        commands.firstMatch.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 30),
            "点了命令没有落到终端上（命令：\(name)）"
        )
        // 面板还必须先于终端消失。只看终端出现是不够的：弹层背后的东西也在这棵树里
        // （见 `testLeavesTheTerminalSegmentAlone` 里那条注释），「面板没关、终端在面板
        // 后面跑起来了」会让上面那条断言照样变绿 —— 而这正是本用例唯一要钉住的危险。
        //
        // 用命令列表这一屏自己的标识符，而不是分段器：命令列表正压在根视图上时它一定在树里，
        // 面板真的关掉时它一定不在。
        XCTAssertFalse(
            plain.waitForExistence(timeout: 10),
            "点了命令面板没关（命令：\(name)）"
        )
    }

    // MARK: - Opt-in, owned terminal peripheral review

    // Run only the five testReviewOwnedTerminal methods and the separately gated
    // testReviewReadOnlyNewSessionCatalogAndCancel for the read-only review.
    // The older conversation tests above create or run things on a computer.
    // No method below presses Send, Enter, a PTY key, Run, Insert, or a Git mutation.

    func testReviewOwnedTerminalDraftAndLocalKeyboardState() throws {
        let app = try openOwnedReviewTerminal()
        enterOwnedReviewDraft(in: app)
        assertOwnedReviewDraft(in: app)

        let keyboard = app.buttons["toolbar-keyboard"].firstMatch
        reviewTap(keyboard, in: app, name: "keyboard-open")
        let combination = app.switches["panelkey-combination"].firstMatch
        XCTAssertTrue(combination.waitForExistence(timeout: 10) && combination.isHittable)
        if combination.value as? String == "0" { combination.tap() }
        XCTAssertEqual(combination.value as? String, "1")

        let control = app.buttons["panelkey-modifier-Ctrl"].firstMatch
        reviewTap(control, in: app, name: "modifier-local-latch")
        reviewWait({ control.isSelected }, "The local Ctrl latch must be visible")
        for identifier in ["Shift", "Alt", "⌘"] {
            let modifier = app.buttons["panelkey-modifier-\(identifier)"].firstMatch
            XCTAssertTrue(modifier.exists && modifier.isHittable,
                "The modifier name must remain reachable")
            XCTAssertFalse(modifier.label.isEmpty)
        }

        // Page controls and modifier controls only change local state. Never tap
        // any panelkey-key-* or toolbar-* command, even on a rejecting fixture.
        revealOwnedKeyboardControl("panelkey-page-1", in: app)
        reviewTap(app.buttons["panelkey-page-1"].firstMatch, in: app, name: "keyboard-page-two")
        reviewWait({ app.buttons["panelkey-page-1"].firstMatch.isSelected }, "Page two must be selected")
        revealOwnedKeyboardControl("panelkey-key-F1", in: app)
        XCTAssertTrue(app.buttons["panelkey-key-F1"].firstMatch.isHittable)
        XCTAssertFalse(control.isSelected, "Changing page must release the local modifier")
        reviewCapture(app, name: "keyboard-function-page-read-only")
        revealOwnedKeyboardControl("panelkey-page-0", in: app)
        reviewTap(app.buttons["panelkey-page-0"].firstMatch, in: app, name: "keyboard-page-one")
        reviewWait({ app.buttons["panelkey-page-0"].firstMatch.isSelected }, "Page one must be selected")
        revealOwnedKeyboardControl("panelkey-key-ArrowUp", in: app)
        XCTAssertTrue(app.buttons["panelkey-key-ArrowUp"].firstMatch.isHittable)

        // TerminalScreen's single-tap callback dismisses local keyboards. This
        // does not press a keyboard key or send terminal input.
        reviewTap(app.descendants(matching: .any)["terminal.text"].firstMatch,
            in: app, name: "keyboard-dismiss")
        reviewWait({ !control.exists }, "The keyboard panel must close")
        assertOwnedReviewDraft(in: app)
        reviewCapture(app, name: "draft-preserved-after-local-keyboard")
    }

    func testReviewOwnedTerminalUnsupportedShortcutFallbackKeepsDraft() throws {
        let fallbackApp = try openOwnedReviewTerminal(extraArguments: [
            "-terminal.shortcutPanel.segment", "phrases",
        ])
        reviewTap(fallbackApp.buttons["toolbar-all"].firstMatch, in: fallbackApp, name: "shortcut-fallback-open")
        let fallbackPicker = fallbackApp.segmentedControls["shortcut-panel-segment"].firstMatch
        XCTAssertTrue(fallbackPicker.waitForExistence(timeout: 10) && fallbackPicker.isHittable)
        XCTAssertFalse(fallbackPicker.buttons["快捷输入"].exists,
            "This first-stage fixture must not advertise mobile.quickPhrases support")
        XCTAssertTrue(fallbackPicker.buttons["剪贴板"].isSelected,
            "A remembered unavailable segment must select its actually displayed fallback")
        XCTAssertTrue(fallbackApp.staticTexts["clipboard-empty"].firstMatch.exists,
            "The owned fixture's empty clipboard must be visible")
        reviewCapture(fallbackApp, name: "unsupported-phrase-displays-clipboard-fallback")
        dismissOwnedShortcut(in: fallbackApp, picker: fallbackPicker)

        // The argument domain intentionally fixes the initial remembered value.
        // Relaunch without it before testing the user's normal local selection.
        let app = try openOwnedReviewTerminal()
        enterOwnedReviewDraft(in: app)
        reviewTap(app.buttons["toolbar-all"].firstMatch, in: app, name: "shortcut-open")
        let picker = app.segmentedControls["shortcut-panel-segment"].firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10) && picker.isHittable)
        reviewTap(picker.buttons["剪贴板"].firstMatch, in: app, name: "shortcut-clipboard-read-only")
        reviewWait({ picker.buttons["剪贴板"].isSelected }, "The real clipboard segment must become selected")
        XCTAssertTrue(app.staticTexts["clipboard-empty"].firstMatch.exists)
        reviewTap(picker.buttons["自定义命令"].firstMatch, in: app, name: "shortcut-commands-read-only")
        reviewWait({ picker.buttons["自定义命令"].isSelected }, "The real command segment must become selected")
        XCTAssertTrue(app.staticTexts["shortcut-commands-empty"].firstMatch.waitForExistence(timeout: 5))
        reviewCapture(app, name: "unsupported-phrase-fallback-and-empty-commands")
        dismissOwnedShortcut(in: app, picker: picker)
        assertOwnedReviewDraft(in: app)
    }

    func testReviewOwnedTerminalPickerCancelsAndDeniedVoiceKeepDraft() throws {
        guard ProcessInfo.processInfo.environment["SYNAPSE_TERMINAL_REVIEW_MICROPHONE_DENIED"] == "1" else {
            throw reviewConfigurationError("The app's microphone permission must already be denied; this test never changes permissions")
        }
        let app = try openOwnedReviewTerminal()
        enterOwnedReviewDraft(in: app)
        for action in ["照片和视频", "文件"] {
            reviewTap(app.buttons["attach"].firstMatch, in: app, name: "attachment-menu")
            reviewTap(reviewMenuAction(action, in: app), in: app, name: "picker-open")
            let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel"]))
            XCTAssertTrue(cancel.firstMatch.waitForExistence(timeout: 10))
            XCTAssertEqual(cancel.count, 1, "Only the actual presented system picker's Cancel may be used")
            reviewCapture(app, name: "system-picker-before-cancel")
            reviewTap(cancel.firstMatch, in: app, name: "system-picker-cancel")
            reviewWait({ !cancel.firstMatch.exists }, "Cancel must dismiss the system picker")
            assertOwnedReviewDraft(in: app)
            XCTAssertFalse(app.descendants(matching: .any).matching(
                NSPredicate(format: "identifier BEGINSWITH 'relay-chip-'")).firstMatch.exists,
                "Cancelling must not create an attachment")
        }

        let voice = app.buttons["voice-mode-toggle"].firstMatch
        XCTAssertEqual(voice.value as? String, "keyboard")
        reviewTap(voice, in: app, name: "already-denied-voice-preflight")
        let denial = app.staticTexts["麦克风权限未开启 · 设置 › Synapse › 麦克风"].firstMatch
        XCTAssertTrue(denial.waitForExistence(timeout: 10) && denial.isHittable)
        XCTAssertEqual(voice.value as? String, "keyboard", "A denied preflight must keep keyboard mode")
        XCTAssertFalse(app.buttons["voice-hold"].firstMatch.exists)
        XCTAssertFalse(app.alerts.firstMatch.exists, "An already denied permission must not ask again")
        assertOwnedReviewDraft(in: app)
        reviewCapture(app, name: "denied-voice-preserves-local-draft")
    }

    func testReviewOwnedTerminalGitReadFailureAndFormsCancel() throws {
        let app = try openOwnedReviewTerminal()
        enterOwnedReviewDraft(in: app)
        openOwnedGit(in: app)
        revealOwnedGitRow("git-panel-branch", in: app)
        reviewTap(app.buttons["git-panel-branch"].firstMatch, in: app, name: "git-branches-read-only")
        // The fixture supports status but rejects branches. Verify an honest
        // failure, not a made-up successful branch list or a checkout.
        let failure = app.alerts.firstMatch
        XCTAssertTrue(failure.waitForExistence(timeout: 15))
        XCTAssertTrue(failure.staticTexts["读取分支失败"].exists)
        XCTAssertGreaterThan(failure.staticTexts.count, 1, "The rejected read must have a visible reason")
        reviewCapture(app, name: "git-branch-read-rejected")
        reviewTap(failure.buttons["好"].firstMatch, in: app, name: "git-read-failure-close")
        XCTAssertTrue(app.staticTexts["git-branches-empty"].firstMatch.waitForExistence(timeout: 5))
        reviewTap(app.buttons["git-branch-new"].firstMatch, in: app, name: "git-new-branch-form")
        let name = app.textFields["git-new-branch-name"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10) && name.isHittable)
        XCTAssertFalse(app.buttons["git-new-branch-create"].firstMatch.isEnabled)
        name.tap(); name.typeText("review-local-form-only")
        XCTAssertTrue(app.buttons["git-new-branch-create"].firstMatch.isEnabled)
        reviewCapture(app, name: "git-new-branch-not-submitted")
        reviewBack(from: "新建分支", to: "分支", in: app)
        if failure.exists {
            XCTAssertTrue(failure.staticTexts["读取分支失败"].exists)
            reviewTap(failure.buttons["好"].firstMatch, in: app, name: "git-read-failure-close-after-back")
        }
        reviewBack(from: "分支", to: "Git", in: app)
        closeOwnedGit(in: app)

        openOwnedGit(in: app)
        revealOwnedGitRow("git-panel-commit", in: app)
        reviewTap(app.buttons["git-panel-commit"].firstMatch, in: app, name: "git-commit-form")
        reviewWait({ app.textFields["git-commit-message"].firstMatch.exists
            || app.textViews["git-commit-message"].firstMatch.exists }, "The commit message editor must appear")
        let message = app.textViews["git-commit-message"].firstMatch.exists
            ? app.textViews["git-commit-message"].firstMatch : app.textFields["git-commit-message"].firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 10) && message.isHittable)
        XCTAssertFalse(app.buttons["git-commit-submit"].firstMatch.isEnabled)
        message.tap(); message.typeText("Local review form - never committed")
        XCTAssertTrue(app.buttons["git-commit-submit"].firstMatch.isEnabled)
        reviewCapture(app, name: "git-commit-not-submitted")
        reviewBack(from: "提交", to: "Git", in: app)
        closeOwnedGit(in: app)

        openOwnedGit(in: app)
        revealOwnedGitRow("git-panel-merge", in: app)
        reviewTap(app.buttons["git-panel-merge"].firstMatch, in: app, name: "git-merge-form")
        let branch = app.buttons["git-merge-branch"].firstMatch
        revealOwnedGitMergeForm(branch, in: app)
        XCTAssertTrue(branch.exists && branch.isHittable)
        let plan = app.staticTexts["git-merge-plan"].firstMatch
        revealOwnedGitMergeForm(plan, in: app)
        XCTAssertTrue(plan.exists && plan.isHittable)
        XCTAssertFalse(app.buttons["git-merge-run"].firstMatch.isEnabled)
        reviewCapture(app, name: "git-merge-not-submitted")
        reviewBack(from: "合并分支", to: "Git", in: app)
        closeOwnedGit(in: app)
        assertOwnedReviewDraft(in: app)
    }

    /// Run separately after the second owned endpoint advertises a real nonempty
    /// mobile.quickPhrases payload. A missing payload is not a passed preview test.
    func testReviewOwnedTerminalPhraseFullTextDoesNotInsertOrSend() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let id = environment["SYNAPSE_TERMINAL_REVIEW_PHRASE_ID"], !id.isEmpty,
              let content = environment["SYNAPSE_TERMINAL_REVIEW_PHRASE_CONTENT"], !content.isEmpty else {
            throw reviewConfigurationError("The second owned fixture must provide its exact nonempty phrase ID and content")
        }
        let app = try openOwnedReviewTerminal()
        enterOwnedReviewDraft(in: app)
        reviewTap(app.buttons["toolbar-all"].firstMatch, in: app, name: "phrase-panel-open")
        let picker = app.segmentedControls["shortcut-panel-segment"].firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        reviewTap(picker.buttons["快捷输入"].firstMatch, in: app, name: "phrase-segment")
        XCTAssertTrue(picker.buttons["快捷输入"].isSelected)
        XCTAssertTrue(app.buttons["phrase-row-\(id)"].firstMatch.waitForExistence(timeout: 10))
        reviewTap(app.buttons["phrase-preview-\(id)"].firstMatch, in: app, name: "phrase-full-text")
        let preview = app.staticTexts["phrase-preview-text"].firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 10) && preview.isHittable)
        XCTAssertEqual(preview.label, content, "The preview must expose the whole supplied phrase")
        reviewCapture(app, name: "owned-phrase-full-text-read-only")
        reviewTap(app.navigationBars["全文"].buttons["完成"].firstMatch,
            in: app, name: "phrase-preview-close")
        reviewWait({ !preview.exists }, "Closing full text must return to the shortcut panel")
        XCTAssertTrue(picker.exists && picker.buttons["快捷输入"].isSelected)
        dismissOwnedShortcut(in: app, picker: picker)
        assertOwnedReviewDraft(in: app)
    }

    func testReviewReadOnlyNewSessionCatalogAndCancel() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["SYNAPSE_NEW_SESSION_READONLY_REVIEW"] == "1",
              let desktopID = environment["SYNAPSE_NEW_SESSION_READONLY_DESKTOP_ID"], !desktopID.isEmpty,
              let desktopName = environment["SYNAPSE_NEW_SESSION_READONLY_DESKTOP_NAME"], !desktopName.isEmpty,
              let ownedID = environment["SYNAPSE_TEST_DESKTOP_ID"], !ownedID.isEmpty,
              let ownedName = environment["SYNAPSE_TEST_DESKTOP_NAME"], !ownedName.isEmpty,
              desktopID != ownedID else {
            throw reviewConfigurationError("The explicitly authorized read-only catalog desktop and the owned desktop to restore are required")
        }
        let app = try openOwnedReviewTerminal()
        reviewGoHome(in: app)
        reviewSelectDesktop(desktopID, name: desktopName,
            switcher: "home-switch-computer", optionPrefix: "home-switch-computer-option-", in: app)
        reviewDesktopRestoration = (ownedID, ownedName)
        let newSession = app.buttons["home-feature-新建会话"].firstMatch
        reviewWait({ newSession.exists && newSession.isEnabled && newSession.isHittable },
            "The authorized online desktop must advertise its new-session catalog", timeout: 25)
        reviewTap(newSession, in: app, name: "readonly-catalog-open")
        XCTAssertTrue(app.buttons["new-session-project"].firstMatch.waitForExistence(timeout: 10),
            "The actual desktop must provide the conversation catalog")

        for (identifier, title) in [("new-session-project", "项目"),
                                    ("new-session-provider", "供应商"),
                                    ("new-session-model", "模型")] {
            reviewTap(app.buttons[identifier].firstMatch, in: app, name: "readonly-catalog-picker")
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
            let lists = reviewForegroundChoiceLists(in: app)
            if lists.count != 1 { reviewCapture(app, name: "readonly-catalog-native-list-not-unique") }
            XCTAssertEqual(lists.count, 1, "The picker must expose one actual native List")
            guard lists.count == 1 else { return }
            let choices = lists[0].cells.buttons.allElementsBoundByIndex.filter { $0.isHittable }
            if choices.isEmpty { reviewCapture(app, name: "readonly-catalog-missing-data") }
            XCTAssertGreaterThan(choices.count, 0, "An empty or failed catalog is not a successful data-picker review")
            XCTAssertTrue(choices.allSatisfy { !$0.label.isEmpty })
            reviewCapture(app, name: "readonly-catalog-" + title)
            // Back never chooses a project, provider or model or writes its memory.
            reviewBack(from: title, to: "新建", in: app)
        }

        let segments = app.segmentedControls["new-session-segment"].firstMatch
        if segments.exists {
            reviewTap(segments.buttons["终端"].firstMatch, in: app, name: "readonly-catalog-terminal-segment")
        } else {
            reviewTap(reviewNativeControl("new-session-segment", in: app), in: app, name: "readonly-catalog-segment-menu")
            let choices = app.buttons.matching(NSPredicate(format: "label == '终端'")).allElementsBoundByIndex
                .filter { $0.isHittable }
            XCTAssertEqual(choices.count, 1, "Only the active picker menu's Terminal option may be used")
            reviewTap(choices[0], in: app, name: "readonly-catalog-terminal-segment")
        }
        XCTAssertTrue(app.searchFields["搜索分组"].firstMatch.waitForExistence(timeout: 10))
        let groups = app.buttons.matching(identifier: "terminal-group")
        if groups.count == 0 { reviewCapture(app, name: "readonly-catalog-no-terminal-groups") }
        XCTAssertGreaterThan(groups.count, 0, "The advertised terminal groups must actually appear")
        reviewCapture(app, name: "readonly-catalog-terminal-groups-no-activation")
        // A group without commands creates immediately. Its disclosure has no
        // stable semantic identifier, so do not activate any group here. Reading
        // a command subpage needs a separately verified configured group; this
        // method claims only the displayed groups, not that unproved subpage.
        reviewTap(app.navigationBars["新建"].buttons["取消"].firstMatch,
            in: app, name: "readonly-catalog-cancel-without-start")
        reviewWait({ !app.navigationBars["新建"].exists }, "Cancel must close the new-session panel")
        reviewGoHome(in: app)
        reviewSelectDesktop(ownedID, name: ownedName,
            switcher: "home-switch-computer", optionPrefix: "home-switch-computer-option-", in: app)
        reviewDesktopRestoration = nil
    }

    // MARK: - Helpers

    /// The panel's own segmented control, kept apart from the app's tab bar — which has
    /// a 终端 of its own, so an unscoped query matches two different things.
    private func segments(in app: XCUIApplication) -> XCUIElementQuery {
        app.segmentedControls.firstMatch.buttons
    }

    /// `freshChoice` stages a phone that has never started a conversation.
    ///
    /// The app container keeps what it remembers between runs, so the second visit
    /// cannot be checked without the first having happened — and the first cannot be
    /// checked at all once a previous run has left a project behind. The argument
    /// domain is how `UserDefaults` lets a launch override a stored value, which is
    /// the only way to stage a fresh install without deleting the app. The sentinel is
    /// not an id any project could have, so it resolves to nothing, which is what "no
    /// remembered project" means to the panel.
    private func launch(freshChoice: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        if freshChoice {
            app.launchArguments += [
                "-SynapseAgentConversationProject", "__never_chosen__",
                "-SynapseAgentConversationProvider", "__never_chosen__",
                "-SynapseAgentConversationModelTier", "__never_chosen__",
            ]
        }
        app.launch()
        signIn(app)
        // The ＋ is disabled until a computer is reachable, which is also what makes the
        // panel's data available — waiting on it here keeps every later step about the
        // panel rather than about the connection.
        //
        // 等的是「能按」，不是「在那儿」：按钮在会话列表一画出来就存在，而电脑要等摘要
        // 回来才算上线。只等存在就点，点到的是一个禁用按钮——什么都没发生，报出来的
        // 却是后面那句「面板没出来」。
        let plus = app.buttons["new-session"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30), "no computer came online")
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: plus)
        waitForExpectations(timeout: 30)
        return app
    }

    private func signIn(_ app: XCUIApplication) {
        guard app.textFields.firstMatch.waitForExistence(timeout: 20) else { return }
        app.textFields.firstMatch.tap()
        app.textFields.firstMatch.typeText(email)
        app.secureTextFields.firstMatch.tap()
        app.secureTextFields.firstMatch.typeText(password)
        app.buttons["登录"].tap()
    }

    /// Opens the project picker, takes the first project, and answers what it was called
    /// so the second visit can be checked against it.
    private func chooseFirstProject(in app: XCUIApplication) -> String {
        app.buttons["new-session-project"].tap()

        let options = app.cells.allElementsBoundByIndex.filter { $0.isHittable }
        guard let first = options.first else {
            XCTFail("the project picker offered nothing")
            return ""
        }
        let name = first.staticTexts.firstMatch.label
        first.tap()
        return name
    }

    private func waitForLabel(containing needle: String, in app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            // Matched on any element type: a navigation title is a static text today and
            // a button next, and either way it is the same label.
            if app.descendants(matching: .any).allElementsBoundByIndex.contains(where: {
                $0.label.contains(needle)
            }) {
                return true
            }
            usleep(300_000)
        }
        return false
    }

    /// 等查询到的行数变成 `expected`。
    ///
    /// 搜索是逐字生效的，一次查询拿到的是那一刻的快照，紧接着断言会读到还没重算完的
    /// 行数。等到行数对上，才是在断言筛完的结果。
    private func waitForCount(_ query: XCUIElementQuery, _ expected: Int, timeout: TimeInterval = 5) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if query.count == expected { return true }
            usleep(200_000)
        }
        return false
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private let ownedReviewDraft = "iOS review local draft - never sent"

    private func reviewConfigurationError(_ message: String) -> NSError {
        NSError(domain: "OwnedTerminalReadOnlyReview", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func openOwnedReviewTerminal(extraArguments: [String] = []) throws -> XCUIApplication {
        let environment = ProcessInfo.processInfo.environment
        guard environment["SYNAPSE_FILES_ACCEPTANCE"] == "1",
              environment["SYNAPSE_TERMINAL_REVIEW_OWN_FIXTURE"] == "1",
              let desktopID = environment["SYNAPSE_TEST_DESKTOP_ID"], !desktopID.isEmpty,
              let desktopName = environment["SYNAPSE_TEST_DESKTOP_NAME"], desktopName.hasPrefix("iOS Review"),
              let title = environment["SYNAPSE_FILES_SESSION_TITLE"], title.hasPrefix("iOS Review"),
              let endpoint = environment["SYNAPSE_TEST_BASE_URL"], !endpoint.isEmpty else {
            throw reviewConfigurationError("Explicitly owned temporary desktop ID, iOS Review desktop/session names, relay URL and both opt-in flags are required")
        }

        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", endpoint,
            "-terminal.inputBar.voiceMode", "NO", "-SynapseChromeIdleSeconds", "3600"] + extraArguments
        app.launch()
        let home = app.buttons["home-feature-云盘"].firstMatch
        let loginEmail = app.textFields["邮箱"].firstMatch
        reviewWait({ home.exists || loginEmail.exists }, "Normal login or Home must appear", timeout: 25)
        if !home.exists {
            reviewTap(loginEmail, in: app, name: "login-email")
            loginEmail.typeText(email)
            let secret = app.secureTextFields.firstMatch
            XCTAssertTrue(secret.exists && secret.isHittable)
            secret.tap(); secret.typeText(password)
            app.buttons["登录"].firstMatch.tap()
        }
        XCTAssertTrue(home.waitForExistence(timeout: 25))
        if app.tabBars.buttons["终端"].firstMatch.exists {
            app.tabBars.buttons["终端"].firstMatch.tap()
        } else {
            reviewTap(reviewNativeControl("terminal", in: app), in: app, name: "terminal-tab")
        }
        XCTAssertTrue(app.buttons["new-session"].firstMatch.waitForExistence(timeout: 15),
            "The normal terminal list must be selected; do not create a session")

        reviewTap(reviewNativeControl("switch-computer", in: app), in: app, name: "owned-computer-menu")
        reviewWait({ app.buttons.matching(NSPredicate(format:
            "identifier BEGINSWITH 'switch-computer-option-'")).firstMatch.exists }, "The actual desktop switch menu must open")
        let ownedOption = app.buttons.matching(identifier: "switch-computer-option-\(desktopID)")
        if !ownedOption.firstMatch.exists {
            // The menu excludes the current ID. Prove the owned selection by
            // selecting the separately authorized read-only desktop, then the
            // exact owned ID; a matching name is never evidence of ownership.
            guard environment["SYNAPSE_NEW_SESSION_READONLY_REVIEW"] == "1",
                  let readonlyID = environment["SYNAPSE_NEW_SESSION_READONLY_DESKTOP_ID"], !readonlyID.isEmpty,
                  let readonlyName = environment["SYNAPSE_NEW_SESSION_READONLY_DESKTOP_NAME"], !readonlyName.isEmpty,
                  readonlyID != desktopID else {
                reviewCapture(app, name: "owned-id-not-selectable")
                throw reviewConfigurationError("The owned ID is not offered; only an explicitly authorized read-only desktop may be used for the normal UI round trip")
            }
            let readonly = app.buttons.matching(identifier: "switch-computer-option-\(readonlyID)")
            XCTAssertEqual(readonly.count, 1, "The authorized read-only option must match its exact ID uniquely")
            XCTAssertEqual(readonly.firstMatch.label, readonlyName)
            reviewTap(readonly.firstMatch, in: app, name: "authorized-computer-local-select")
            reviewTap(reviewNativeControl("switch-computer", in: app), in: app, name: "owned-computer-menu-after-round-trip")
        }
        XCTAssertTrue(ownedOption.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(ownedOption.count, 1, "The explicit owned ID must identify one actual option")
        XCTAssertEqual(ownedOption.firstMatch.label, desktopName)
        reviewTap(ownedOption.firstMatch, in: app, name: "owned-computer-exact-id-select")

        let excluded = NSPredicate(format:
            "identifier == 'switch-computer' OR identifier BEGINSWITH 'switch-computer-option-'")
        let matchingCells = { app.cells.allElementsBoundByIndex.filter { cell in
            cell.staticTexts[title].firstMatch.exists && cell.staticTexts.count >= 3
                && !cell.descendants(matching: .any).matching(excluded).firstMatch.exists
        } }
        reviewWait({ matchingCells().count == 1 }, "Exactly one explicitly owned terminal row must arrive", timeout: 25)
        let cells = matchingCells()
        XCTAssertEqual(cells.count, 1, "Never fall back to the first real computer's session")
        let link = cells[0].buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        if link.exists { reviewTap(link, in: app, name: "owned-terminal-row") }
        else { reviewTap(cells[0].staticTexts[title].firstMatch, in: app, name: "owned-terminal-title") }
        XCTAssertTrue(app.descendants(matching: .any)["terminal.text"].firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts[title].firstMatch.exists, "The opened detail must retain the owned session title")
        return app
    }

    private func enterOwnedReviewDraft(in app: XCUIApplication) {
        reviewTap(app.buttons["terminal-expand-input"].firstMatch, in: app, name: "expanded-input-open")
        let editor = app.textViews["terminal-expanded-input"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 10) && editor.isHittable)
        XCTAssertEqual(editor.value as? String ?? "", "", "Only an empty draft on the temporary fixture may be edited")
        editor.tap(); editor.typeText(ownedReviewDraft) // No newline or submit key.
        XCTAssertEqual(editor.value as? String, ownedReviewDraft)
        XCTAssertTrue(app.buttons["terminal-expanded-send"].firstMatch.isEnabled)
        reviewTap(app.buttons["terminal-expanded-close"].firstMatch, in: app, name: "expanded-input-close-without-send")
        reviewWait({ !editor.exists }, "Closing must dismiss the expanded editor")
        assertOwnedReviewDraft(in: app)
    }

    private func assertOwnedReviewDraft(in app: XCUIApplication) {
        let field = app.textFields["输入命令"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10) && field.isHittable)
        XCTAssertEqual(field.value as? String, ownedReviewDraft, "Read-only navigation must preserve the exact local draft")
        XCTAssertTrue(app.buttons["send"].firstMatch.isEnabled)
    }

    private func reviewNativeControl(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let popup = app.popUpButtons[identifier].firstMatch
        return popup.exists ? popup : app.buttons[identifier].firstMatch
    }

    private func reviewMenuAction(_ label: String, in app: XCUIApplication) -> XCUIElement {
        let item = app.menuItems.matching(NSPredicate(format: "label == %@", label)).firstMatch
        return item.exists ? item : app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func reviewGoHome(in app: XCUIApplication) {
        if app.descendants(matching: .any)["terminal.text"].firstMatch.exists {
            let back = app.buttons.matching(NSPredicate(format: "label == %@", "返回"))
            XCTAssertEqual(back.count, 1, "Only the owned terminal's actual Back may be used")
            reviewTap(back.firstMatch, in: app, name: "readonly-return-terminal-list")
            reviewWait({ !app.descendants(matching: .any)["terminal.text"].firstMatch.exists },
                "Back must return from the owned detail to its terminal list")
            XCTAssertTrue(app.buttons["new-session"].firstMatch.waitForExistence(timeout: 10))
        }
        let tab = app.tabBars.buttons["主页"].firstMatch
        reviewTap(tab.exists ? tab : reviewNativeControl("主页", in: app), in: app, name: "readonly-return-home")
        XCTAssertTrue(app.buttons["home-feature-云盘"].firstMatch.waitForExistence(timeout: 10))
    }

    private func reviewSelectDesktop(_ id: String, name: String, switcher: String,
                                     optionPrefix: String, in app: XCUIApplication) {
        reviewTap(reviewNativeControl(switcher, in: app), in: app, name: "readonly-exact-computer-menu")
        let options = app.buttons.matching(identifier: optionPrefix + id)
        XCTAssertTrue(options.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(options.count, 1, "Only the exact explicitly authorized desktop option may be selected")
        XCTAssertEqual(options.firstMatch.label, name)
        reviewTap(options.firstMatch, in: app, name: "readonly-exact-computer-select")
    }

    private func openOwnedGit(in app: XCUIApplication) {
        reviewTap(reviewNativeControl("更多", in: app), in: app, name: "terminal-more-menu")
        reviewTap(reviewNativeControl("terminal-menu-git", in: app), in: app, name: "git-panel-open")
        XCTAssertTrue(app.buttons["git-panel-done"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["git-panel-cwd"].firstMatch.exists)
        XCTAssertFalse(app.descendants(matching: .any)["git-panel-unavailable"].firstMatch.exists)
    }

    private func revealOwnedGitRow(_ identifier: String, in app: XCUIApplication) {
        XCTAssertTrue(["git-panel-branch", "git-panel-commit", "git-panel-merge"].contains(identifier))
        let row = app.buttons[identifier].firstMatch
        let table = app.tables.containing(.any, identifier: "git-panel-cwd").firstMatch
        let list = table.exists ? table : app.collectionViews.containing(.any, identifier: "git-panel-cwd").firstMatch
        XCTAssertTrue(list.exists, "The Git panel must expose its actual native List")
        for _ in 0..<8 {
            if row.exists && row.isHittable { break }
            list.swipeUp() // Never pull down: that would fetch remote references.
        }
        XCTAssertTrue(row.exists && row.isHittable && row.isEnabled)
    }

    private func reviewForegroundChoiceLists(in app: XCUIApplication) -> [XCUIElement] {
        // iOS exposes these native Lists as Table or CollectionView. The sheet's
        // actual reachable choices distinguish it from the retained background List.
        (app.tables.allElementsBoundByIndex + app.collectionViews.allElementsBoundByIndex)
            .filter { list in
                list.exists && !list.frame.isEmpty && list.frame.intersects(app.frame)
                    && list.cells.buttons.allElementsBoundByIndex.contains { $0.isHittable }
            }
    }

    private func revealOwnedGitMergeForm(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(app.navigationBars["合并分支"].firstMatch.exists)
        let lists = reviewForegroundChoiceLists(in: app)
        if lists.count != 1 { reviewCapture(app, name: "git-merge-native-list-not-unique") }
        XCTAssertEqual(lists.count, 1, "The current merge form must expose one actual native List")
        guard lists.count == 1 else { return }
        let list = lists[0]
        for _ in 0..<8 {
            if element.exists && element.isHittable { break }
            list.swipeUp() // Read the form; never select a direction, branch, or Run.
        }
        if !(element.exists && element.isHittable) { reviewCapture(app, name: "git-merge-form-control-not-revealed") }
        reviewWait({ element.exists && element.isHittable },
            "The actual merge form content must become reachable through native scrolling")
    }

    private func closeOwnedGit(in app: XCUIApplication) {
        reviewTap(app.buttons["git-panel-done"].firstMatch, in: app, name: "git-panel-close")
        reviewWait({ !app.buttons["git-panel-done"].firstMatch.exists }, "The Git panel must close")
        assertOwnedReviewDraft(in: app)
    }

    private func reviewBack(from title: String, to previous: String, in app: XCUIApplication) {
        let back = app.navigationBars[title].buttons[previous].firstMatch
        reviewTap(back, in: app, name: "git-form-system-back")
        reviewWait({ !app.navigationBars[title].exists }, "System Back must leave the current Git form")
    }

    private func dismissOwnedShortcut(in app: XCUIApplication, picker: XCUIElement) {
        let bar = app.navigationBars.containing(.segmentedControl, identifier: "shortcut-panel-segment").firstMatch
        XCTAssertTrue(bar.exists && bar.isHittable)
        // A navbar swipe is only about 42 points in the medium sheet. Use the
        // actual system grabber and enough of the available window to dismiss;
        // neither the gesture's start nor end activates an insertion/command row.
        for _ in 0..<2 where picker.exists {
            let grabbers = app.descendants(matching: .any).matching(identifier: "Sheet Grabber")
                .allElementsBoundByIndex.filter { $0.isHittable }
            if grabbers.count != 1 { reviewCapture(app, name: "shortcut-system-grabber-not-unique") }
            XCTAssertEqual(grabbers.count, 1, "The foreground shortcut sheet must expose one actual system grabber")
            guard grabbers.count == 1 else { return }
            let grabber = grabbers[0]
            let distance = min(app.frame.height * 0.45, app.frame.maxY - grabber.frame.midY - 16)
            XCTAssertGreaterThan(distance, bar.frame.height * 2)
            let start = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)))
            if picker.waitForNonExistence(timeout: 3) { break }
        }
        if picker.exists { reviewCapture(app, name: "shortcut-system-dismissal-incomplete") }
        reviewWait({ !picker.exists }, "The shortcut panel must actually dismiss")
    }

    private func revealOwnedKeyboardControl(_ identifier: String, in app: XCUIApplication) {
        let target = app.buttons[identifier].firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10))
        let panels = app.scrollViews.containing(.button, identifier: "panelkey-page-1")
        XCTAssertEqual(panels.count, 1, "The page controls identify the real vertical keyboard ScrollView")
        let panel = panels.firstMatch
        // These are native pans; the production board uses standard Buttons,
        // whose actions do not activate during scrolling. Never tap a PTY key.
        for _ in 0..<8 {
            if target.isHittable { break }
            let targetFrame = target.frame
            let viewport = panel.frame
            XCTAssertTrue(targetFrame.midY.isFinite && viewport.minY.isFinite && viewport.maxY.isFinite)
            if targetFrame.midY < viewport.minY { panel.swipeDown() }
            else { panel.swipeUp() }
        }
        if !target.isHittable { reviewCapture(app, name: "keyboard-control-not-revealed") }
        XCTAssertTrue(target.isHittable, "The actual keyboard control must become reachable through normal scrolling")
    }

    private func reviewTap(_ element: XCUIElement, in app: XCUIApplication, name: String) {
        let exists = element.waitForExistence(timeout: 10)
        if !exists || !element.isHittable { reviewCapture(app, name: name + "-unreachable") }
        XCTAssertTrue(exists && element.isHittable, "The exact intended native control must be reachable")
        element.tap()
    }

    private func reviewWait(_ condition: @escaping () -> Bool, _ message: String, timeout: TimeInterval = 10) {
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in condition() }, object: nil)], timeout: timeout)
        XCTAssertEqual(result, .completed, message)
    }

    private func reviewCapture(_ app: XCUIApplication, name: String) {
        // Attach privately to xcresult; never print UI content or credentials to logs.
        capture(app, name: "owned-terminal-" + name)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "owned-terminal-" + name + "-native-tree"
        tree.lifetime = .keepAlways
        add(tree)
    }
}
