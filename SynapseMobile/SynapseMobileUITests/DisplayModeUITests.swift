import XCTest

/// Drives the real app against the real desktop to see what the display modes
/// actually render.
///
/// Written to capture rather than to assert. The question these runs answer is what
/// the screen looks like — where the margins fall, how big the text is, whether a
/// gesture moved anything — and a screenshot answers that in a way an accessibility
/// query cannot. The captures land in the result bundle and are exported afterwards.
///
/// Credentials come from the environment, as in `TerminalFlowUITests`, so this file
/// carries no secrets:
///
///   SYNAPSE_TEST_EMAIL, SYNAPSE_TEST_PASSWORD, SYNAPSE_TEST_BASE_URL,
///   SYNAPSE_TEST_SESSION (the terminal to open; defaults to 显示模式验收)
final class DisplayModeUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "https://synapse.d2.pub/api"
    }
    private var sessionTitle: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_SESSION"] ?? "显示模式验收"
    }

    override func setUpWithError() throws {
        try XCTSkipIf(
            email.isEmpty || password.isEmpty,
            "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required"
        )
        // Every step is worth reaching even if an earlier one misbehaves; the
        // captures are the point, and stopping at the first surprise would hide the
        // rest of the screen.
        continueAfterFailure = true
    }

    func testCaptureDisplayModes() throws {
        let app = XCUIApplication()
        // Deliberately not passing `-SynapseAPIBaseURL`. The app defaults to the
        // hosted server, which is what this run targets, and passing the argument
        // made its live socket fail with a bad URL while the same app launched by
        // hand connected — so the argument is the thing to take out of the picture
        // rather than something to work around.
        app.launch()

        signIn(app)
        shot(app, "00-signed-in")

        let row = app.staticTexts[sessionTitle]
        XCTAssertTrue(row.waitForExistence(timeout: 30), "session list never showed \(sessionTitle)")
        row.tap()

        // The collection view is not an `otherElement`; match on any element type so
        // the query survives a UIKit class change.
        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 20), "terminal never appeared")
        settle(seconds: 5)
        shot(app, "01-desktop-grid")
        print("=== DIAG 01-desktop-grid: \(terminal.value ?? "nil") ===")
        print("=== DIAG 01-desktop-grid: \(terminal.value ?? "nil") ===")

        // What this screen offers, so the next run can address it by name instead of
        // guessing at identifiers.
        print("=== TERMINAL TREE START ===")
        print(app.debugDescription)
        print("=== TERMINAL TREE END ===")

        // Magnify. In the desktop-grid mode this is a multiple of the fit, so a
        // visible change means the pinch reached the terminal at all.
        terminal.pinch(withScale: 2.5, velocity: 1.0)
        settle(seconds: 2)
        shot(app, "02-pinched")
        print("=== DIAG 02-pinched: \(terminal.value ?? "nil") ===")
        print("=== DIAG 02-pinched: \(terminal.value ?? "nil") ===")

        // Magnified, a one-finger drag should move the canvas — the photo-viewer
        // gesture — rather than the buffer underneath it.
        terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.4))
            .press(forDuration: 0.05, thenDragTo: terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.65)))
        settle(seconds: 2)
        shot(app, "02b-dragged-while-magnified")
        print("=== DIAG 02b-dragged: \(terminal.value ?? "nil") ===")

        terminal.pinch(withScale: 0.4, velocity: -1.0)
        settle(seconds: 2)
        shot(app, "03-pinched-back")
        print("=== DIAG 03-pinched-back: \(terminal.value ?? "nil") ===")
        print("=== DIAG 03-pinched-back: \(terminal.value ?? "nil") ===")

        // Hold still long enough to mean "select" rather than "scroll". Aimed well
        // inside the rows: a press on the margin beside them lands on no cell at all.
        let pressPoint = terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.35))
        pressPoint.press(forDuration: 1.2)
        settle(seconds: 2)
        shot(app, "04-long-press")
        print("=== DIAG 04-long-press: \(terminal.value ?? "nil") ===")

        // Move the selection, which is where the loupe should be following the cell
        // rather than the finger.
        let dragTo = terminal.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.7))
        pressPoint.press(forDuration: 1.2, thenDragTo: dragTo)
        settle(seconds: 2)
        shot(app, "05-selection-dragged")
        print("=== DIAG 05-selection-dragged: \(terminal.value ?? "nil") ===")

        // Leave it in the phone-driven mode, so the desktop's own screen can be
        // checked afterwards for the badge that says a phone set its size.
        let more = app.buttons["More"]
        if more.waitForExistence(timeout: 5) {
            more.tap()
            let option = app.buttons["优先移动端"]
            if option.waitForExistence(timeout: 5) {
                option.tap()
                settle(seconds: 8)
                shot(app, "06-phone-driven")
            }
        }

        print("=== SECOND TREE START ===")
        print(app.debugDescription)
        print("=== SECOND TREE END ===")
    }

    // MARK: - Helpers

    private func settle(seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func signIn(_ app: XCUIApplication) {
        let emailField = app.textFields.firstMatch
        let tabs = app.tabBars.firstMatch

        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            if tabs.exists || emailField.exists { break }
            usleep(200_000)
        }
        guard !tabs.exists else { return }
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
        settle(seconds: 3)

        // iOS offers to save the password after a successful sign-in, over the top of
        // whatever comes next.
        for label in ["以后再说", "现在不", "Not Now", "稍后"] {
            let button = app.buttons[label]
            if button.exists { button.tap(); break }
        }
        settle(seconds: 2)
    }
}
