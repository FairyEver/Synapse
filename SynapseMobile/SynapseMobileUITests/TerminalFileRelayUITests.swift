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

        // A chip only calls itself delivered once the desktop has reported a landed
        // path. That is the one signal in the app that every hop completed — upload,
        // hand-off, download onto the computer's disk, and the path going into the
        // terminal — so it is what the test waits for, rather than something weaker
        // that would pass on a transfer that never arrived.
        let chip = deliveredChip(app)
        XCTAssertTrue(
            chip.waitForExistence(timeout: 90),
            "the computer never reported a landed path. The strip still showed: "
            + describeStrip(app)
        )
        capture(app, name: "03-delivered")

        // Undo lives behind the chip now, so that is how a user reaches it and how
        // this has to reach it too.
        chip.tap()
        let undo = app.buttons["撤销插入"]
        XCTAssertTrue(undo.waitForExistence(timeout: 5), "the chip's menu offered no undo")
        undo.tap()

        // And it is a real undo: pressing it takes the text back out of the terminal,
        // which the terminal only reflects because the desktop accepted the keys, and
        // it takes the chip with it.
        XCTAssertTrue(
            app.descendants(matching: .any)["relay-strip"].waitForNonExistence(timeout: 5),
            "the chip stayed after its undo was used: " + describeStrip(app)
        )
        capture(app, name: "04-after-undo")
    }

    /// The chip for a file the computer has finished with.
    ///
    /// Matched on the state rather than on the file name, which the test never learns
    /// — the picker chooses the photo, not this.
    private func deliveredChip(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["relay-chip-delivered"]
    }

    /// A submitted line takes the chip with it.
    ///
    /// The chip is the undo for an inserted path, so it lives exactly as long as
    /// that path is still in the terminal's prompt. Both ways of submitting are
    /// covered because they are different code paths — the arrow sends the draft as
    /// a command, the accessory bar's return is a raw key — and a fix that only knew
    /// about one of them would still leave a chip stranded.
    ///
    /// Needs a terminal that submitting into is harmless: the return phase sends the
    /// inserted path itself, and the draft phase sends `echo`. A plain shell is the
    /// right kind of session to point `SYNAPSE_TEST_SESSION_TITLE` at.
    func testSubmittingTakesTheDeliveredChipOffTheStrip() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()

        signIn(app)
        openTerminal(app)

        try deliverAPhoto(app, name: "01-return-delivered")
        // The bar's own return key, which is the desktop's built-in as projected onto
        // this phone. It is the one control that submits a line — the input field's send
        // button is the other, and it is exercised further down.
        let returnKey = app.buttons["toolbar-enter"]
        XCTAssertTrue(returnKey.waitForExistence(timeout: 10), "the toolbar has no return key")
        returnKey.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["relay-strip"].waitForNonExistence(timeout: 10),
            "the strip stayed after the accessory return key submitted the line: " + describeStrip(app)
        )
        capture(app, name: "02-after-return")

        try deliverAPhoto(app, name: "03-draft-delivered")
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the input bar has no text field")
        field.tap()
        field.typeText("echo relay-commit")
        app.buttons["send"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["relay-strip"].waitForNonExistence(timeout: 10),
            "the strip stayed after the send button submitted the draft: " + describeStrip(app)
        )
        capture(app, name: "04-after-send")
    }

    // MARK: - Steps

    /// Picks a photo and waits until the computer has typed its path.
    ///
    /// The chip turning itself delivered is the only signal that covers every hop —
    /// upload, hand-off, download onto the computer's disk, and the path going into
    /// the terminal — so waiting for it is what makes anything asserted after it mean
    /// something.
    private func deliverAPhoto(_ app: XCUIApplication, name: String) throws {
        let attach = app.buttons["attach"]
        XCTAssertTrue(attach.waitForExistence(timeout: 15), "the input bar has no + button")
        attach.tap()

        let photos = app.buttons["照片"]
        XCTAssertTrue(photos.waitForExistence(timeout: 8), "the source menu did not offer the photo library")
        photos.tap()

        try pickFirstPhoto(app)

        XCTAssertTrue(
            app.descendants(matching: .any)["relay-strip"].waitForExistence(timeout: 30),
            "no relay strip appeared after picking a photo"
        )
        XCTAssertTrue(
            deliveredChip(app).waitForExistence(timeout: 90),
            "the computer never reported a landed path. The strip still showed: " + describeStrip(app)
        )
        capture(app, name: name)
    }

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

    /// Taps a photo and confirms, touching the picker's tree as little as possible.
    ///
    /// The picker holds the user's whole photo library, so its accessibility tree is
    /// enormous and every query against it costs a full snapshot of that tree.
    /// Asking it for "all the images" — which is how the first version of this looked
    /// for a thumbnail rather than the notice's icon — was slow enough to stall the
    /// test outright on a library of any size. One `firstMatch` wait to know the
    /// sheet is up, then the points a person would actually press.
    private func pickFirstPhoto(_ app: XCUIApplication) throws {
        XCTAssertTrue(
            app.images.firstMatch.waitForExistence(timeout: 25),
            "the picker never showed any photos; seed the library with `simctl addmedia`"
        )

        // The first tile of the grid.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.16, dy: 0.45)).tap()

        let confirm = app.buttons["添加"]
        if confirm.exists, confirm.isHittable {
            confirm.tap()
        } else {
            // The confirm control is a bare checkmark with no name of its own on this
            // version, which is why the position is the fallback: it is always the
            // top-right of the sheet.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.90, dy: 0.17)).tap()
        }
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
