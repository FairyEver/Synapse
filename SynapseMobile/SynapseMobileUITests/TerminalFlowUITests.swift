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

    override func setUpWithError() throws {
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    func testSignInBrowseSessionsAndOpenTerminal() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        let tabs = app.tabBars.firstMatch
        tabs.buttons.element(boundBy: 1).tap()
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 25), "no tab bar")
        tabs.buttons.element(boundBy: 2).tap()

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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()
        signIn(app)

        let terminals = app.tabBars.firstMatch
        XCTAssertTrue(terminals.waitForExistence(timeout: 25), "no session list")
        XCTAssertTrue(app.staticTexts["api-logs"].waitForExistence(timeout: 20), "session list never arrived")

        // Rename. The alert opens on the current name, and the list has to show
        // the new one without leaving the screen.
        revealSwipeActions(on: "api-logs", in: app)
        let renameButton = app.buttons["重命名"]
        XCTAssertTrue(renameButton.waitForExistence(timeout: 5), "swipe did not reveal rename")
        XCTAssertTrue(app.buttons["删除"].exists, "swipe did not reveal delete")
        // The actions themselves, before the alert covers them.
        capture(app, name: "15-swipe-actions")
        renameButton.tap()

        let nameField = app.textFields.firstMatch
        XCTAssertTrue(nameField.waitForExistence(timeout: 5), "rename never asked for a name")
        // Tap past the end of the existing text so the caret lands at the end;
        // tapping the centre would drop it mid-string and scramble the result.
        nameField.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        nameField.typeText(" v2")
        app.alerts.firstMatch.buttons["保存"].tap()
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'toolbar-'")).count, 7,
            "the bar has an unexpected number of buttons (7 = keyboard icon + 6 commands)"
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
        capture(app, name: "11-keyboard-panel-common")

        for (category, key) in [("方向", "panelkey-ArrowUp"), ("功能", "panelkey-PageUp"), ("控制", "panelkey-Ctrl+A")] {
            app.buttons[category].tap()
            XCTAssertTrue(app.buttons[key].waitForExistence(timeout: 5), "\(category) has no \(key)")
        }
        capture(app, name: "12-keyboard-panel-control")

        app.buttons["panelkey-Ctrl+A"].tap()
        XCTAssertTrue(
            waitForLabel(containing: "[mock] keys key:Ctrl+A", in: app, timeout: 20),
            "a panel key did not reach the computer"
        )
        // Still up: pressing several keys in a row is the ordinary way to use it.
        XCTAssertTrue(app.buttons["panelkey-Ctrl+A"].exists, "the panel closed after one key")
        capture(app, name: "13-keyboard-panel-stays-open")
    }

    /// What the computer offers follows the user's edits.
    ///
    /// The computer's list is a snapshot the phone replaces wholesale, so all three
    /// edits a user can make are the same event seen from here: add, rename and delete
    /// each arrive as "the list is now this". A merge rather than a replace would show
    /// a deleted command forever, which is the failure this pins down.
    func testToolbarFollowsTheComputerWhenItsCommandsChange() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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

    private func waitForLabel(containing text: String, in app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        let element = app.staticTexts.matching(predicate).firstMatch
        return element.waitForExistence(timeout: timeout)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
