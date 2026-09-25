import Foundation
import XCTest

/// Switching between two computers on one account, against a running server.
///
/// Requires **two** mock desktops with different names on the same account, because
/// that is the only arrangement in which the feature exists at all:
///
///   node server/test/mock-desktop.mjs <email> <password> --name "Mock MacBook Pro"
///   node server/test/mock-desktop.mjs <email> <password> --name "Mock iMac" --control-port 3012
///
/// The second one needs its own control port so the disconnect case can be driven from
/// here. Credentials and the server address come from the environment, like
/// `TerminalFlowUITests`.
///
/// Both halves matter, and both are asserted on the computers' *names* rather than on
/// session titles: the two doubles ship the same fixtures, so a title is identical on
/// both and could not tell them apart. Note also that a double whose `hello` name and
/// whose summary name disagree will make these tests fail for a reason that is the
/// double's, not the app's — that is not hypothetical, it is what they caught first.
///
/// `testThePhoneStaysOnAComputerThatWentAway` puts the double it takes down back in
/// `tearDown`, because the phone now *remembers* which computer it is on across launches:
/// leaving one down would make every later test in the same run start on a computer that
/// is not there, and fail for a reason belonging to this file.
final class ComputerSwitchUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://localhost:3001/api"
    }
    /// The control channel of the desktop this test switches away from and then takes
    /// down. The other one is the default port.
    private var otherControlPort: Int {
        Int(ProcessInfo.processInfo.environment["SYNAPSE_TEST_OTHER_CONTROL_PORT"] ?? "3012") ?? 3012
    }

    private let desktopA = "Mock MacBook Pro"
    private let desktopB = "Mock iMac"

    /// The computer this test took down, if any, so `tearDown` can put it back.
    private var tookDown: String?

    override func setUpWithError() throws {
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        if let tookDown {
            // Best effort, and deliberately not an assertion: a failure here is not the
            // thing the test was about, and a double that would not come back is a
            // harness problem that the next test will report in its own words.
            try? control(computerNamed: tookDown, route: "connect")
            self.tookDown = nil
        }
    }

    /// The whole feature in one pass: the row names the computer, tapping it offers the
    /// other one, and choosing it moves the list.
    ///
    /// Asserted on the names rather than on session titles: both doubles ship the same
    /// fixtures, so a title would be identical on both and could not tell them apart.
    func testTheDeviceRowSwitchesToTheOtherComputer() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()
        signIn(app)

        let switchControl = app.buttons["switch-computer"]
        XCTAssertTrue(
            switchControl.waitForExistence(timeout: 25),
            "the device row is not a control, so there is no way to switch computers"
        )

        // Which one the phone started on is not this test's business — a fresh install
        // adopts whichever the cloud lists first. The *other* one is what it must offer.
        let startedOn = try XCTUnwrap(deviceRowComputer(app), "the device row names no computer")
        let target = startedOn == desktopA ? desktopB : desktopA

        switchControl.tap()
        let option = app.buttons[target]
        XCTAssertTrue(option.waitForExistence(timeout: 8), "the other computer is not offered: \(target)")
        option.tap()

        XCTAssertTrue(
            waitForDeviceRow(app, naming: target, timeout: 20),
            "the device row still says \(deviceRowComputer(app) ?? "nothing") after switching to \(target)"
        )
        capture(app, name: "01-switched-\(target)")
    }

    /// The case the feature exists for: the computer being viewed goes away.
    ///
    /// The phone must stay on it and say so, rather than silently landing the reader on
    /// the other computer's terminals. And the row has to stay a control — the one other
    /// computer is the only way out.
    func testThePhoneStaysOnAComputerThatWentAway() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()
        signIn(app)

        let switchControl = app.buttons["switch-computer"]
        XCTAssertTrue(switchControl.waitForExistence(timeout: 25), "the device row is not a control")

        // Put the phone on the second computer, so the one this test takes down is the
        // one being viewed.
        let startedOn = try XCTUnwrap(deviceRowComputer(app), "the device row names no computer")
        let target = startedOn == desktopA ? desktopB : desktopA
        switchControl.tap()
        let option = app.buttons[target]
        XCTAssertTrue(option.waitForExistence(timeout: 8), "the other computer is not offered")
        option.tap()
        if !waitForDeviceRow(app, naming: target, timeout: 20) {
            capture(app, name: "99-switch-did-not-land")
            XCTFail("the switch did not land: the row says \(app.buttons["switch-computer"].label)")
        }

        try takeDown(computerNamed: target)

        XCTAssertTrue(
            app.staticTexts["这台电脑不在线"].waitForExistence(timeout: 30),
            "the phone did not say the computer it is on has gone"
        )
        XCTAssertTrue(
            waitForDeviceRow(app, naming: target, timeout: 10),
            "the phone moved off the computer it was on instead of staying and saying so"
        )
        XCTAssertTrue(app.buttons["switch-computer"].exists, "the only way out of an offline computer is gone")
        capture(app, name: "02-stayed-on-\(target)")
    }

    // MARK: -

    /// Which computer the device row is naming.
    ///
    /// Read off the control that wraps the row — its label is the row's own text — rather
    /// than by looking for the name anywhere on the screen. "Any static text with this
    /// name" also matches an option in the menu this test just opened, which reports the
    /// phone as being somewhere it is not, and does it most reliably right after a switch.
    private func deviceRowComputer(_ app: XCUIApplication) -> String? {
        let control = app.buttons["switch-computer"]
        if control.exists {
            let label = control.label
            for candidate in [desktopA, desktopB] where label.hasPrefix(candidate) {
                return candidate
            }
            return nil
        }
        // Not a control: only one computer, so the row is plain text.
        for candidate in [desktopA, desktopB] where app.staticTexts[candidate].exists {
            return candidate
        }
        return nil
    }

    private func waitForDeviceRow(_ app: XCUIApplication, naming name: String, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if deviceRowComputer(app) == name { return true }
            usleep(300_000)
        }
        return false
    }

    /// Takes one of the doubles offline through its control channel.
    private func takeDown(computerNamed name: String) throws {
        try control(computerNamed: name, route: "disconnect")
        tookDown = name
    }

    private func control(computerNamed name: String, route: String) throws {
        // Only the second double is addressable by name; the first is on the default port.
        let port = name == desktopB ? otherControlPort : 3011
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/desktop/\(route)"))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = Data()

        let done = expectation(description: "\(route) \(name)")
        var status = -1
        URLSession.shared.dataTask(with: request) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? -1
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        XCTAssertEqual(status, 200, "the mock desktop on port \(port) did not accept \(route) for \(name)")
    }

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
                capture(app, name: "00-signin-never-appeared")
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

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 底栏三格之后冷启动落在主页，而这一份用例要的是终端列表。
    ///
    /// 挂在 `signIn` 的 `defer` 里，是因为那个函数有不止一条返回路径（会话已经恢复时
    /// 直接返回），而每一条之后人都需要在终端那一格上。
    private func enterTerminalTab(_ app: XCUIApplication) {
        let tabs = app.tabBars.firstMatch
        guard tabs.exists else { return }
        let terminals = tabs.buttons.element(boundBy: 1)
        guard terminals.exists else { return }
        terminals.tap()
    }

}
