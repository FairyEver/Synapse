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

        XCTAssertTrue(app.buttons["esc"].exists, "accessory keys missing")
        XCTAssertTrue(app.buttons["^C"].exists, "control key missing")
        // Anything the desktop cannot encode must not be offered.
        XCTAssertFalse(app.buttons["ctrl"].exists, "accessory bar offers a key the backend rejects")

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

        // Answering the prompt is a key press, from the accessory bar.
        app.buttons["return"].tap()
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

    /// Where the mock desktop listens for control commands.
    ///
    /// The test process runs inside the simulator, which shares the host's
    /// loopback, so this reaches the mock on the machine running the server.
    private var controlBaseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_CONTROL_URL"] ?? "http://127.0.0.1:3011"
    }

    /// Drives the mock desktop. A UI test cannot start a host process, so making
    /// a computer come and go has to go through the mock's own control channel.
    private func post(_ path: String) -> Int? {
        guard let url = URL(string: controlBaseURL + path) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
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
                XCTFail("neither the login screen nor a restored session appeared")
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
