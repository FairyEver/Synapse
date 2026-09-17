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
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://localhost:3001/api"
    }

    override func setUpWithError() throws {
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    /// The first visit and the second, in one run, because the second is defined by
    /// what the first left behind. Split into two tests they would also be split across
    /// two app installs, and the remembered choice would never be there to check.
    func testStartsAConversationAndRemembersTheChoiceNextTime() throws {
        let app = launch(freshChoice: true)

        // MARK: First visit — the project has to be chosen once, and only once.

        app.buttons["new-session"].tap()
        XCTAssertTrue(
            app.buttons["new-session-project"].waitForExistence(timeout: 10),
            "the panel never appeared"
        )
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
        app.pointAtServer(baseURL)
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
    /// tapping a group creates a terminal, with no button to confirm it first.
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
        XCTAssertGreaterThan(app.cells.count, 0, "the terminal segment lost its group list")
        capture(app, name: "04-terminal-segment")
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
        app.pointAtServer(baseURL)
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
        XCTAssertTrue(app.buttons["new-session"].waitForExistence(timeout: 30), "no computer came online")
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

    private func capture(_ app: XCUIApplication, name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
