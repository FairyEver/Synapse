import XCTest

/// 输入栏本身：两种模式、四个位置。
///
/// 手点不出来的是「位置有没有动」—— 设计文档 §8 第 2 条要的是四个元素的 x 坐标逐
/// 格相同，而「四个不搬家」正是这次重构最容易做坏的一处。所以这里量的是 frame，
/// 不是眼睛；截图只是留证。
///
/// 凭据从环境里来，测试文件不带密钥：
///
///   SYNAPSE_TEST_EMAIL, SYNAPSE_TEST_PASSWORD, SYNAPSE_TEST_BASE_URL,
///   SYNAPSE_TEST_SESSION（要打开的终端，默认 `claude-code`）
final class InputBarUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://127.0.0.1:3001/api"
    }
    private var sessionTitle: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_SESSION"] ?? "claude-code"
    }

    /// 两格之间允许的差。量的是同一台模拟器上同一次运行里的两个布局，所以这里要的是
    /// 逐点相等，留 0.5 只是给浮点表示。
    private let slack: CGFloat = 0.5

    override func setUpWithError() throws {
        try XCTSkipIf(
            email.isEmpty || password.isEmpty,
            "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required"
        )
        continueAfterFailure = false
    }

    /// §8 第 1～4 条：两种模式下四个元素逐格同位，输入栏高度不变。
    func testTheTwoModesDoNotMoveTheFourSlots() throws {
        let app = openTerminal()
        let toggle = app.buttons["voice-mode-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "输入栏上没有切换键")

        // 键盘态：切换键、输入框、＋、发送，从左到右。
        XCTAssertEqual(toggle.value as? String, "keyboard", "开局不是键盘态")
        let keyboardField = app.textFields.firstMatch
        XCTAssertTrue(keyboardField.waitForExistence(timeout: 5), "键盘态没有输入框")
        shot(app, "10-keyboard-mode")

        let keyboard = slots(
            toggle: toggle,
            field: keyboardField,
            attach: app.buttons["attach"],
            send: app.buttons["send"],
            bar: app
        )

        // 点切换键 → 语音态（§8 第 4 条）。
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "voice", "点了切换键没进语音态")

        let hold = app.descendants(matching: .any)["voice-hold"]
        XCTAssertTrue(hold.waitForExistence(timeout: 5), "语音态没有「按住 说话」那一格")
        // 输入框整块换掉了，不是叠了一层（§4.3）。
        XCTAssertFalse(keyboardField.exists, "语音态还把文本域留在屏幕上")
        // 点 🎤 开始的那套已经删干净了。
        XCTAssertFalse(app.buttons["voice-start"].exists, "点击式的麦克风键还在")
        shot(app, "11-voice-mode")

        let voice = slots(
            toggle: toggle,
            field: hold,
            attach: app.buttons["attach"],
            send: app.buttons["send"],
            bar: app
        )

        for name in Slot.allCases {
            guard let before = keyboard[name], let after = voice[name] else {
                XCTFail("\(name) 在两种模式里没有都量到")
                continue
            }
            // §8 第 2 条要的就是这两个：x 逐个相同、宽度一样。y 不比 —— 输入框那一格
            // 在键盘态是 22pt 高的文本域、在语音态是 44pt 高的按钮，它们占的是同一个
            // 格子，但那不是一个能逐点相同的量。栏高有没有变由终端高度作证。
            XCTAssertEqual(before.minX, after.minX, accuracy: slack, "\(name) 的 x 搬了家")
            XCTAssertEqual(before.width, after.width, accuracy: slack, "\(name) 的宽度变了")
        }
        // 三个按钮在两种模式下连 y 和高度都一样，所以这一条也钉住。
        for name in [Slot.toggle, .attach, .send] {
            guard let before = keyboard[name], let after = voice[name] else { continue }
            XCTAssertEqual(before.minY, after.minY, accuracy: slack, "\(name) 的 y 搬了家")
            XCTAssertEqual(before.height, after.height, accuracy: slack, "\(name) 的高度变了")
        }

        // 输入栏没长高：终端的高度就是这条栏有没有抢走空间的证据。
        XCTAssertEqual(keyboard.barHeight, voice.barHeight, accuracy: slack, "两种模式的输入栏高度不一样")

        // 语音态点切换键 → 回键盘态（§8 第 4 条）。
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "keyboard", "再点一次没回键盘态")
        XCTAssertTrue(keyboardField.waitForExistence(timeout: 5), "回到键盘态没有把输入框还回来")
        shot(app, "12-back-to-keyboard")
    }

    // MARK: - Helpers

    /// 输入栏上四个位置的 frame，外加终端画布的高度。
    private struct Layout {
        var values: [Slot: CGRect] = [:]
        var barHeight: CGFloat = 0

        subscript(_ slot: Slot) -> CGRect? { values[slot] }
    }

    private enum Slot: String, CaseIterable {
        case toggle, field, attach, send
    }

    private func slots(
        toggle: XCUIElement,
        field: XCUIElement,
        attach: XCUIElement,
        send: XCUIElement,
        bar: XCUIApplication
    ) -> Layout {
        var layout = Layout()
        layout.values[.toggle] = toggle.frame
        layout.values[.field] = field.frame
        layout.values[.attach] = attach.frame
        layout.values[.send] = send.frame
        // 终端画布：这条栏有没有变高，只有它能作证。
        layout.barHeight = bar.descendants(matching: .any)["terminal.text"].frame.height
        return layout
    }

    private func openTerminal() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
        app.launch()
        signIn(app)

        let row = app.staticTexts[sessionTitle]
        XCTAssertTrue(row.waitForExistence(timeout: 30), "会话列表里没有 \(sessionTitle)")
        row.tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(terminal.waitForExistence(timeout: 20), "终端没有出现")
        return app
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
            XCTFail("既没有登录屏也没有恢复出来的会话")
            return
        }

        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["登录"].firstMatch.tap()
        settle(seconds: 3)
        dismissSavePasswordPromptIfPresent(app)
    }

    /// 登录之后系统会弹出「保存密码？」，它属于系统进程、盖在 App 上，还会吃掉下一次
    /// 手势 —— 留着它，后面一个不相干的测试就会失败。
    private func dismissSavePasswordPromptIfPresent(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for candidate in [app, springboard] where candidate.buttons["以后"].exists {
            candidate.buttons["以后"].tap()
            return
        }
        settle(seconds: 1)
    }

    private func settle(seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
