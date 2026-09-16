import Foundation
import XCTest

/// Sends a file from the phone to a real computer, over a real server.
///
/// The other UI suites prove the phone can talk to a desktop. This one has to
/// prove something a mock cannot: that the bytes went somewhere the desktop could
/// fetch them from, and that the path it typed back is real. So it needs all three
/// of the server, the account, and a desktop with a terminal open — and it needs
/// the photo library to already hold something, because the picker is the system's
/// and this test does not get to invent what is in it.
///
///   SYNAPSE_TEST_EMAIL, SYNAPSE_TEST_PASSWORD, SYNAPSE_TEST_BASE_URL
///   SYNAPSE_TEST_SESSION_TITLE   which terminal to send the file to
///
/// Seed the library first, on the same simulator the test runs on:
///
///   xcrun simctl addmedia booted screenshot.png
final class TerminalFileRelayUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://localhost:3001/api"
    }
    private var sessionTitle: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_SESSION_TITLE"] ?? "relay-test"
    }

    /// Not skipped for missing credentials, unlike the other suites.
    ///
    /// This test is about a file crossing between two signed-in machines, and the
    /// device it runs on usually already holds a session — asking for a password it
    /// will not use would be asking for a secret to satisfy a condition that is not
    /// true. If the app turns out to be signed out, the failure says so.
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSendsAPhotoAndGetsItsPathTypedIntoTheTerminal() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()

        signIn(app)
        openTerminal(app)

        let attach = app.buttons["attach"]
        XCTAssertTrue(attach.waitForExistence(timeout: 15), "the input bar has no + button")
        attach.tap()

        let photos = app.buttons["照片"]
        XCTAssertTrue(photos.waitForExistence(timeout: 8), "the source menu did not offer the photo library")
        photos.tap()
        capture(app, name: "01-photo-picker")

        try pickFirstPhoto(app)
        capture(app, name: "02-after-picking")

        // The chip appears the moment the file is accepted, before any bytes move,
        // so this also proves the pick survived the trip back from the picker.
        let strip = app.descendants(matching: .any)["relay-strip"]
        XCTAssertTrue(strip.waitForExistence(timeout: 30), "no relay strip appeared after picking a photo")

        // Undo is offered only for a file the desktop actually typed. It is the one
        // signal in the app that every hop completed — upload, hand-off, download
        // onto the computer's disk, and the path going into the terminal — so it is
        // what the test waits for, rather than something weaker that would pass on a
        // transfer that never arrived.
        let undo = app.buttons["relay-undo"]
        XCTAssertTrue(
            undo.waitForExistence(timeout: 90),
            "the computer never reported a landed path. The strip still showed: "
            + describeStrip(app)
        )
        capture(app, name: "03-delivered")

        // And it is a real undo: pressing it takes the text back out of the terminal,
        // which the terminal only reflects because the desktop accepted the keys.
        undo.tap()
        XCTAssertFalse(undo.waitForExistence(timeout: 5), "the undo row stayed after being used")
        capture(app, name: "04-after-undo")
    }

    // MARK: - Steps

    private func openTerminal(_ app: XCUIApplication) {
        let row = app.staticTexts[sessionTitle]
        XCTAssertTrue(
            row.waitForExistence(timeout: 30),
            "no terminal named \"\(sessionTitle)\" in the list. The computer has to be signed in "
            + "and have that session open before this test can run."
        )
        row.tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 20), "the terminal never appeared")
    }

    /// The picker is the system's, and its furniture differs between iOS versions,
    /// so this looks for the confirm button by any of the names it has had rather
    /// than by one.
    private func pickFirstPhoto(_ app: XCUIApplication) throws {
        let photo = app.images.element(boundBy: 0)
        XCTAssertTrue(photo.waitForExistence(timeout: 25), "the photo library is empty; seed it with `simctl addmedia`")
        photo.tap()

        for label in ["添加", "Add", "完成", "Done"] {
            let confirm = app.buttons[label]
            if confirm.waitForExistence(timeout: 3), confirm.isHittable {
                confirm.tap()
                return
            }
        }
        // A single-selection picker dismisses on the tap itself, which is a
        // legitimate way for this to have worked.
        XCTAssertFalse(
            app.images.element(boundBy: 0).exists,
            "a photo was tapped but the picker never dismissed"
        )
    }

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
            guard !email.isEmpty, !password.isEmpty else {
                XCTFail("the app is signed out and SYNAPSE_TEST_EMAIL / SYNAPSE_TEST_PASSWORD were not provided")
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

    private func dismissSavePasswordPromptIfPresent(_ app: XCUIApplication) {
        let notNow = app.buttons["以后再说"]
        let never = app.buttons["从不"]
        if notNow.waitForExistence(timeout: 3), notNow.isHittable {
            notNow.tap()
        } else if never.exists, never.isHittable {
            never.tap()
        }
    }

    /// What the strip was showing when the test gave up, so a failure says which
    /// hop stalled instead of only that the whole thing did.
    private func describeStrip(_ app: XCUIApplication) -> String {
        let labels = app.descendants(matching: .any)
            .allElementsBoundByIndex
            .filter { $0.identifier.hasPrefix("relay-") || $0.label.contains("等待") }
            .map { "\($0.identifier)=\($0.label)" }
        return labels.isEmpty ? "(the strip was empty)" : labels.joined(separator: ", ")
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
