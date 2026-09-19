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
    private let keyboardBarAtLaunch = ["-terminal.inputBar.voiceMode", "NO"]

    override func setUpWithError() throws {
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    func testSignInBrowseSessionsAndOpenTerminal() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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

        // The inbox is where a locked-out Agent surfaces. Tabs are addressed by
        // index because a badge rewrites the accessibility label of the tab it sits on.
        //
        // The order is 终端 / 录音 / 需要我 / 我的 — `RootView`'s `TabView`, in that
        // order. 录音 was inserted at 1 by the recording feature and left this index
        // pointing at the wrong tab, which is why the number is spelled out here rather
        // than left to be inferred: the next tab moves every number below it.
        let tabs = app.tabBars.firstMatch
        tabs.buttons.element(boundBy: 2).tap()
        capture(app, name: "02-inbox")
        XCTAssertTrue(
            app.staticTexts["claude-code"].waitForExistence(timeout: 8),
            "inbox did not show the waiting session"
        )
        XCTAssertTrue(app.staticTexts["请求执行一个命令"].exists, "inbox lost the waiting reason")

        tabs.buttons.element(boundBy: 0).tap()
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

        // The bar is the computer's own toolbar, mirrored — not this phone's fixed keys.
        // The return key is the one that must be here: without it a TUI cannot be
        // answered at all, since the input field sends text and an empty send is not a
        // message the protocol can carry.
        XCTAssertTrue(app.buttons["toolbar-enter"].exists, "the mirrored toolbar has no return key")
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

        // Answering the prompt is a key press. Return is the computer's own built-in,
        // mirrored onto this bar — which is why it is here at all, and why it is
        // addressed by the computer's id for it rather than by a label this phone chose.
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
    /// the page and not just the code behind it.
    func testSettingsListsOnlyAccountDesktopsAndSignOut() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
        app.launch()
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 25), "no tab bar")
        // 我的 — index 3 since 录音 took 1. See the note on the inbox tab above.
        tabs.buttons.element(boundBy: 3).tap()

        XCTAssertTrue(app.staticTexts["账号"].waitForExistence(timeout: 10), "settings never opened")
        XCTAssertTrue(app.staticTexts["已连接的电脑"].exists, "the desktops section is missing")
        XCTAssertTrue(app.buttons["退出登录"].exists, "sign-out is missing")

        XCTAssertFalse(app.staticTexts["安全"].exists, "the removed security section is still listed")
        XCTAssertFalse(app.staticTexts["服务器"].exists, "the removed server section is still listed")
        capture(app, name: "08-settings")
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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

    /// The bar under the terminal is the computer's own, and the keys that left it are
    /// behind the keyboard button.
    ///
    /// Both halves are the feature. The bar shows what the computer offers — its
    /// built-ins and the user's own commands, with `Clear` absent because it never
    /// reaches the terminal — and the panel is where the arrows, Tab and Escape went
    /// when the ten fixed keys stopped being drawn here.
    func testToolbarMirrorsTheComputerAndTheKeyboardPanelSendsKeys() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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

        // The mock's own list: two built-ins, two slash commands, two of its own.
        for id in ["toolbar-enter", "toolbar-interrupt", "toolbar-slash-exit", "toolbar-slash-clear",
                   "toolbar-mock-deploy", "toolbar-mock-port"] {
            XCTAssertTrue(app.buttons[id].waitForExistence(timeout: 10), "the bar is missing \(id)")
        }
        // Not projected: it clears the desktop's own renderer and never reaches the
        // terminal, so drawing it here would promise something that cannot happen.
        XCTAssertFalse(app.buttons["toolbar-clear"].exists, "Clear was projected onto the phone")
        // Read-only: managing the commands belongs to the computer.
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'toolbar-'")).count, 8,
            "the bar has an unexpected number of buttons (8 = two fixed keys + 6 commands)"
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
        // own commands sit past the built-ins, so the bar is scrolled first — the same
        // gesture a user makes, and the reason the bar scrolls at all.
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
        XCTAssertTrue(app.buttons["panelkey-Escape"].waitForExistence(timeout: 10), "the panel never opened")
        capture(app, name: "11-keyboard-panel-board")

        // `⇧tab` has no iPhone keyboard of its own. Shift and Tab do share a page these
        // days, but the key that cycles Claude Code's permission mode should not cost two
        // taps because the chord became expressible, so it keeps a slot on the board's
        // top row.
        XCTAssertTrue(app.buttons["panelkey-Shift+Tab"].exists, "the board has no ⇧tab")
        // Waited for, not merely existed: the panel is still settling into the layout
        // when it first appears, and a tap taken against the frame it had a moment ago
        // lands where the key no longer is. Every other press in this file that follows
        // an appearance waits first — this one did not.
        XCTAssertTrue(
            waitForHittable(app.buttons["panelkey-Shift+Tab"], timeout: 10),
            "the ⇧tab key never became pressable"
        )
        app.buttons["panelkey-Shift+Tab"].tap()
        if !waitForLabel(containing: "[mock] keys key:Shift+Tab", in: app, timeout: 20) {
            // What the screen actually holds, because "did not reach the computer" has
            // several causes that look identical from here: the key was never pressed,
            // the press was refused, or the terminal is not showing what arrived. The
            // last lines are the ones that answer it — a refusal prints its own marker.
            capture(app, name: "22-shifttab-not-reached")
            let visible = app.staticTexts.allElementsBoundByIndex.suffix(12).map(\.label)
            XCTFail("⇧tab did not reach the computer; last lines: \(visible)")
        }

        // Two pages now, and the second one carries both clusters — the arrows and the
        // six-key block used to be pages of their own. A merge that quietly dropped one
        // of them would still pass a check that only asked about the page it landed on,
        // so both are asked for. The loop ends on the board, which is what the rest of
        // this test presses.
        for (category, key) in [("导航", "panelkey-ArrowUp"), ("导航", "panelkey-PageUp"),
                                ("键盘", "panelkey-modifier-Ctrl")] {
            app.buttons[category].tap()
            XCTAssertTrue(app.buttons[key].waitForExistence(timeout: 5), "\(category) has no \(key)")
        }
        app.buttons["导航"].tap()
        capture(app, name: "12-keyboard-panel-navigation")
        app.buttons["键盘"].tap()
        XCTAssertTrue(
            app.buttons["panelkey-modifier-Ctrl"].waitForExistence(timeout: 5),
            "the board did not come back"
        )

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
    }

    /// The panel is a keyboard, so it answers what a keyboard answers.
    ///
    /// None of this was reachable while the panel was a sheet. A sheet covers the
    /// button that raised it, the input bar and the terminal underneath, so there was
    /// nothing left on screen to press — the button could only ever go one way. In the
    /// layout those three are all still there, and the rule they now serve is that
    /// this screen has two keyboards and only one of them may be up.
    func testThePanelAnswersTheKeyboardGestures() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        let escapeKey = app.buttons["panelkey-Escape"]
        XCTAssertTrue(waitForHittable(keyboardButton, timeout: 10), "no way into the panel")

        // Up, and showing that what is above it keeps its place: the toolbar and the
        // input bar are not covered, and the terminal is what gave up the room.
        keyboardButton.tap()
        XCTAssertTrue(escapeKey.waitForExistence(timeout: 10), "the panel never opened")
        capture(app, name: "17-panel-in-the-keyboard-slot")
        let withPanel = terminal.frame.height

        // Down again from the same button. A keyboard button that cannot put its
        // keyboard away is the one thing a sheet could not offer.
        keyboardButton.tap()
        XCTAssertTrue(
            escapeKey.waitForNonExistence(timeout: 10),
            "a second press did not put the panel away"
        )
        XCTAssertGreaterThan(
            terminal.frame.height, withPanel,
            "the terminal did not get its height back when the panel closed"
        )

        // The input is the other keyboard. Asking for it is asking for this one to go,
        // and never both at once.
        keyboardButton.tap()
        XCTAssertTrue(escapeKey.waitForExistence(timeout: 10), "the panel never came back")
        app.textFields.firstMatch.tap()
        XCTAssertTrue(
            escapeKey.waitForNonExistence(timeout: 10),
            "tapping the input left the panel up underneath the system keyboard"
        )

        // The canvas puts away whichever one is up — the same gesture that has always
        // dismissed the system keyboard here, so it is the same entry point.
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        keyboardButton.tap()
        XCTAssertTrue(escapeKey.waitForExistence(timeout: 10), "the panel never came back")
        capture(app, name: "18-panel-before-canvas-tap")
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(
            escapeKey.waitForNonExistence(timeout: 10),
            "tapping the canvas did not put the panel away"
        )
        capture(app, name: "19-panel-dismissed-by-canvas")
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        let escape = app.buttons["panelkey-Escape"]
        XCTAssertTrue(escape.waitForExistence(timeout: 10), "the panel never opened")
        XCTAssertTrue(waitForDisabled(escape, timeout: 10), "a panel key is still live with no computer behind it")
        capture(app, name: "16-greyed-out-with-no-computer")
    }

    /// A computer that cannot describe its buttons gets the phone's own built-ins.
    ///
    /// "I have no buttons" and "I am too old to say" arrive at the phone as the same
    /// state — no list has been adopted — and it must not answer them the same way. An
    /// empty bar is correct for the first and would be a dead end for the second: with
    /// no keyboard of its own, a phone with no return key cannot confirm anything in a
    /// TUI, including the approval prompts Claude Code waits on.
    ///
    /// Needs a computer that genuinely does not send the message, so it is skipped
    /// unless the run is set up for one — a mock desktop started with `--no-toolbar`.
    /// Asserting it by reading the fallback constant would only prove the constant
    /// exists, not that the bar ever reaches for it.
    func testAnOldComputerStillGetsAUsableBar() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["SYNAPSE_TEST_OLD_DESKTOP"] == "1",
            "run with a mock desktop started --no-toolbar and SYNAPSE_TEST_OLD_DESKTOP=1"
        )

        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
            XCTAssertTrue(app.buttons[id].exists, "the fallback bar is missing \(id)")
        }
        XCTAssertTrue(app.buttons["toolbar-keyboard"].exists, "the keyboard button is the phone's own and must stay")
        // The assertion that makes this test mean anything. The four built-ins are also
        // what a computer that *can* describe itself sends, so checking only for them
        // passes either way. `mock-deploy` is a command this mock owns and the fallback
        // has never heard of, so its absence is what says nothing was received — and if
        // that computer ever did send a list, this test fails rather than quietly
        // passing for the wrong reason.
        XCTAssertFalse(
            app.buttons["toolbar-mock-deploy"].exists,
            "the computer sent its own list after all — this test proves nothing about the fallback"
        )
        capture(app, name: "15-old-desktop-fallback")
    }

    /// What the computer offers follows the user's edits.
    ///
    /// The computer's list is a snapshot the phone replaces wholesale, so all three
    /// edits a user can make are the same event seen from here: add, rename and delete
    /// each arrive as "the list is now this". A merge rather than a replace would show
    /// a deleted command forever, which is the failure this pins down.
    func testToolbarFollowsTheComputerWhenItsCommandsChange() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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

        // Deleted, leaving a computer that has said it has nothing — which is an empty
        // bar, not the built-in fallback. The fallback is for a computer that cannot
        // describe itself at all, and inventing four buttons here would offer commands
        // this computer never had.
        try setMockToolbar([])
        XCTAssertTrue(
            app.buttons["toolbar-fresh"].waitForNonExistence(timeout: 15),
            "a command deleted on the computer is still on the phone"
        )
        XCTAssertTrue(app.buttons["toolbar-keyboard"].exists, "the keyboard button is not this phone's own and must stay")
        XCTAssertFalse(app.buttons["toolbar-enter"].exists, "an empty list fell back to invented buttons")
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        try setMockQuickPhrases([["id": "q1", "content": "第一版"]])

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        segment.buttons["快捷输入"].tap()
        XCTAssertTrue(
            app.staticTexts["phrase-row-q1"].waitForExistence(timeout: 15),
            "the sentence never reached the phone"
        )
        XCTAssertEqual(app.staticTexts["phrase-row-q1"].label, "第一版")

        // Edited on the computer, keeping its id — which is how a rename arrives.
        try setMockQuickPhrases([["id": "q1", "content": "改过之后的那一句"]])
        XCTAssertTrue(
            waitForLabel(containing: "改过之后的那一句", in: app, timeout: 15),
            "the phone is still showing the old sentence"
        )

        // Deleted, leaving a computer that has said it has none — an empty state, not the
        // segment control disappearing, which is the other answer entirely.
        try setMockQuickPhrases([])
        XCTAssertTrue(
            app.staticTexts["phrase-row-q1"].waitForNonExistence(timeout: 15),
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
            app.staticTexts["phrase-row-mock-log"].waitForExistence(timeout: 10),
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
    /// The common case, and the one this segment is named for. With nothing but the
    /// built-ins — which live on the bar, one swipe away — this segment has nothing to
    /// show, and saying that in place beats an empty card with no explanation.
    func testThePanelSaysWhenThereAreNoCustomCommands() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
    /// composer and stops there — it is not sent, and it does not raise the keyboard.
    /// Getting that wrong would send, unread, a message the user had not looked at yet.
    func testThePhraseSegmentFillsTheFieldWithoutSending() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        let segment = app.segmentedControls["shortcut-panel-segment"]
        XCTAssertTrue(segment.waitForExistence(timeout: 10), "the panel has no segment control")
        XCTAssertEqual(segment.buttons.count, 2, "the panel should offer two segments")

        segment.buttons["快捷输入"].tap()
        let row = app.staticTexts["phrase-row-mock-commit"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the computer's sentences never appeared")
        capture(app, name: "16-phrase-segment")

        row.tap()

        // In the field, exactly as the computer wrote it.
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the input field is missing")
        let expected = "这次改动整理成提交说明，中文，说清楚改了什么、为什么改"
        XCTAssertTrue(
            waitForValue(containing: expected, in: field, timeout: 10),
            "the sentence did not reach the input field: \(field.value as? String ?? "(nil)")"
        )
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

    /// A computer too old to have been asked gets a one-section panel.
    ///
    /// The other half of the pair. "This computer has none" and "this computer has never
    /// heard of these" are different answers, and they arrive as different things: an
    /// empty list in the first case, no message at all in the second. Only the second
    /// must leave the segment control off — a computer that cannot answer must not be
    /// drawn as having answered "none", which a user reads as their own sentences having
    /// gone missing.
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
        app.launch()
        signIn(app)
        openClaudeCodeTerminal(app)

        app.buttons["toolbar-all"].tap()
        XCTAssertTrue(
            app.staticTexts["shortcut-commands-empty"].waitForExistence(timeout: 10),
            "the panel never opened, so the segment assertion below would prove nothing"
        )
        XCTAssertFalse(
            app.segmentedControls["shortcut-panel-segment"].exists,
            "a computer that never sent the sentences was drawn as having none"
        )
        XCTAssertFalse(
            app.staticTexts["shortcut-phrases-empty"].exists,
            "an unanswered computer was shown the empty state meant for one that answered"
        )
        capture(app, name: "20-panel-old-desktop")
    }

    /// The eye beside a sentence reads it; it does not use it.
    ///
    /// The two controls sit in the same row and mean opposite things — one puts the
    /// sentence in the composer, the other only shows it — so the test that matters is
    /// that pressing the eye leaves the composer exactly as it was. A sentence typed into
    /// the field by someone who only wanted to read the end of it is the failure.
    func testTheEyeShowsTheWholeSentenceWithoutUsingIt() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        let row = app.staticTexts["phrase-row-mock-commit"]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + keyboardBarAtLaunch
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
        XCTAssertFalse(app.staticTexts["phrase-row-mock-log"].exists, "a sentence the computer no longer has is still here")
        capture(app, name: "18-phrase-empty")

        // Left as it was found: the mock outlives this run. `--no-toolbar` runs get a
        // mock of their own and do not see this at all.
        try setMockQuickPhrases(defaultMockQuickPhrases)
        XCTAssertTrue(
            app.staticTexts["phrase-row-mock-log"].waitForExistence(timeout: 10),
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
}
