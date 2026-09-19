import XCTest

/// 三条栏的自动收放：闲置到点收起来、点一下画布回来、手上有事的时候不收。
///
/// 别的 UI 用例都把闲置时长顶到一小时（它们要的是"栏一直在"），所以那套用例**证明不了**
/// 三秒这件事。这个文件反过来，让收放真的发生。
///
/// **每碰一颗栏上的按钮之前都要先 `revealBars`。** 这不是绕路：这一页进来之后不做任何
/// 事，三条栏自己就会走 —— 用例等终端画出来、等登录过去的那几秒，正好就是"闲置"。少了
/// 那一下点击，失败会读成「输入栏上没有切换键」，而真实原因是用例自己在等的时候把它们
/// 等走了。
///
/// 凭据从环境里来，测试文件不带密钥：
///
///   SYNAPSE_TEST_EMAIL, SYNAPSE_TEST_PASSWORD, SYNAPSE_TEST_BASE_URL,
///   SYNAPSE_TEST_SESSION（要打开的终端，默认 `claude-code`）
final class ChromeAutoHideUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://127.0.0.1:3001/api"
    }
    private var sessionTitle: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_SESSION"] ?? "claude-code"
    }

    /// 线上那个数。不压小：压小只会让每一次查询都跑在计时器边上，而这里要验的
    /// 恰恰是"线上这三秒会不会收"。
    private static let idleSeconds: TimeInterval = 3
    /// 等它收。留出计时 + 收栏那 0.22 秒动画 + 几次元素查询的余量。
    private static let waitForHide: TimeInterval = 8

    override func setUpWithError() throws {
        try XCTSkipIf(
            email.isEmpty || password.isEmpty,
            "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required"
        )
        continueAfterFailure = false
    }

    /// 闲置到点，三条栏自己让开；点一下画布，它们回来并且能接着用。
    func testTheBarsTakeThemselvesAwayAndComeBackOnATap() throws {
        let app = openTerminal()
        let toggle = app.buttons["voice-mode-toggle"]
        let keyboardKey = app.buttons["toolbar-keyboard"]
        let more = app.buttons["更多"]

        // 先叫回来再认。三条栏各认一个，而且**都要先在** —— 下面那几条「不在了」只有
        // 在同一次运行里它们确实存在过才算数。只断言一边的测试，标识符写错了也会绿。
        revealBars(app)
        XCTAssertTrue(toggle.waitForExistence(timeout: 6), "点了画布，输入栏也不在")
        XCTAssertTrue(keyboardKey.exists, "点了画布，工具栏也不在")
        XCTAssertTrue(more.exists, "点了画布，顶栏也不在")

        // 什么都不做地等过去。
        settle(seconds: Self.waitForHide)

        XCTAssertFalse(toggle.exists, "闲置到点了，输入栏还留在屏幕上")
        XCTAssertFalse(keyboardKey.exists, "闲置到点了，工具栏还留在屏幕上")
        XCTAssertFalse(more.exists, "闲置到点了，顶栏还留在屏幕上")

        // 点画布把它们叫回来。点了那一格是终端内容，不是任何一颗按钮。
        revealBars(app)

        XCTAssertTrue(toggle.waitForExistence(timeout: 6), "点了画布，栏没有回来")
        XCTAssertTrue(toggle.isHittable, "栏回来了但点不动")
        XCTAssertTrue(keyboardKey.exists, "工具栏没有跟着回来")
        XCTAssertTrue(more.exists, "顶栏没有跟着回来")

        // 回来之后要重新开始计时：再等一轮，它们应当再收一次。
        settle(seconds: Self.waitForHide)
        XCTAssertFalse(toggle.exists, "叫回来之后不再计时了")
    }

    /// 正在录的时候不收。
    ///
    /// 走的「右滑固定」那条路而不是按住不放：手指离开屏幕之后**录音还在继续**，
    /// 而这一条比按住那几秒更严格 —— 固定态可以一直持续下去。两种态共用
    /// `isVoiceBusy` 这一个条件，而按住那一条的判定本身在 `TerminalChromeTests` 里
    /// 被逐条走完了。
    func testARecordingInProgressKeepsTheBars() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        let hold = app.descendants(matching: .any)["voice-hold"]
        XCTAssertTrue(hold.waitForExistence(timeout: 6), "语音态没有「按住 说话」那一格")
        let centre = hold.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // 往右上方滑：越过屏幕中线就是面板的右半「固定」。距离与
        // `InputBarUITests.testStoppingOnPinLocksTheRecordingAndCancelsGivesItUp` 同一组。
        centre.press(forDuration: 1.0, thenDragTo: centre.withOffset(CGVector(dx: 120, dy: -160)))

        XCTAssertTrue(
            app.buttons["voice-lock-cancel"].waitForExistence(timeout: 8),
            "固定之后面板上没有出现「取消」，这条路没走通"
        )

        settle(seconds: Self.waitForHide)

        XCTAssertTrue(
            app.buttons["voice-lock-cancel"].exists,
            "录着的时候栏被收走了 —— 连「取消」都跟着不见了"
        )
        XCTAssertEqual(hold.label, "完成", "录着的时候那一格不该变")
    }

    /// 自绘键盘面板开着的时候不收 —— 它自己就坐在输入栏底下，收栏等于把键盘一起收走。
    func testTheKeyboardPanelKeepsTheBars() throws {
        let app = openTerminal()
        revealBars(app)

        let keyboardKey = app.buttons["toolbar-keyboard"]
        XCTAssertTrue(keyboardKey.waitForExistence(timeout: 6), "工具栏上没有 ⌘")
        keyboardKey.tap()

        XCTAssertTrue(
            app.buttons["toolbar-all"].waitForExistence(timeout: 6),
            "点了 ⌘ 没打开面板"
        )
        settle(seconds: Self.waitForHide)

        XCTAssertTrue(keyboardKey.exists, "面板开着，栏却被收走了")
        XCTAssertTrue(app.buttons["voice-mode-toggle"].exists, "面板开着，输入栏却被收走了")
    }

    /// 横屏把顶栏并进了工具栏：返回键与 ⌘ 落在同一行上。
    ///
    /// 这条量的是位置而不是眼睛，理由是"并成一行"正是这一轮横屏改造的全部内容 ——
    /// 而它最容易做坏的地方是**只有横屏并、竖屏不能并**。所以两头都量：转过去两键同高，
    /// 转回来两键不同高。少了后半段，一个"竖屏也并上了"的实现照样全绿。
    func testLandscapeFoldsTheTopBarIntoTheToolbarAndPortraitDoesNot() throws {
        // 这一条量的是版式，不是计时，所以栏要一直在。
        let app = openTerminal(idleSeconds: 3600)
        revealBars(app)

        let back = app.buttons["返回"]
        let keyboardKey = app.buttons["toolbar-keyboard"]
        XCTAssertTrue(back.waitForExistence(timeout: 6), "顶栏上没有返回键")
        XCTAssertTrue(keyboardKey.exists, "工具栏上没有 ⌘")

        let portraitGap = abs(back.frame.midY - keyboardKey.frame.midY)
        XCTAssertGreaterThan(portraitGap, 20, "竖屏的顶栏与工具栏本来就该是两行")

        addTeardownBlock { XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        // 转过去是一次布局，要等它落定；`revealBars` 顺带把可能收起来的栏叫回来。
        waitUntil(timeout: 10) { abs(back.frame.midY - keyboardKey.frame.midY) < 20 }
        revealBars(app)

        XCTAssertTrue(back.exists, "转过去之后返回键不见了")
        XCTAssertTrue(keyboardKey.exists, "转过去之后 ⌘ 不见了")
        XCTAssertEqual(
            back.frame.midY, keyboardKey.frame.midY, accuracy: 4,
            "横屏没有把顶栏并进工具栏"
        )

        // 并成一行之后，中间那段指令条**还在**。少了这一条，一个"标题撑满整行、指令条
        // 被挤成零宽"的实现照样能过上面那条断言 —— 而那一行就白并了。
        let command = app.buttons["toolbar-enter"]
        XCTAssertTrue(command.exists, "横屏合并之后指令条不见了")
        XCTAssertTrue(command.isHittable, "指令条被挤没了，点不到")
    }

    // MARK: - Helpers

    private func openTerminal(idleSeconds: TimeInterval = ChromeAutoHideUITests.idleSeconds)
        -> XCUIApplication
    {
        let app = XCUIApplication()
        app.launchArguments = [
            "-SynapseAPIBaseURL", baseURL,
            "-SynapseChromeIdleSeconds", String(Int(idleSeconds)),
        ]
        app.launch()
        enterTerminal(app)
        return app
    }

    /// 点一下画布，把收了的三条栏叫回来。
    private func revealBars(_ app: XCUIApplication) {
        let canvas = app.descendants(matching: .any)["terminal.text"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "终端画布一直没出现")
        // 点的位置避开屏幕正中最下面那片内容：这一格是终端本身，不是任何按钮。
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
    }

    /// 走到某个终端里面。
    ///
    /// **两条路一起等。** 重开 App 之后它可能直接恢复到上次那个终端，也可能停在会话
    /// 列表 —— 而"先只等终端、没等到再去列表上找"那一种写法，会把前一条路上的每一秒
    /// 都算成后一条路的超时：连接慢一点，终端第 6 秒才画出来，人已经跑到列表上找一个
    /// 永远不会再出现的行去了。
    private func enterTerminal(_ app: XCUIApplication) {
        signIn(app)

        let terminal = app.descendants(matching: .any)["terminal.text"]
        let row = app.staticTexts[sessionTitle]

        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if terminal.exists { return }
            if row.exists { break }
            usleep(300_000)
        }

        guard !terminal.exists else { return }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "会话列表里没有 \(sessionTitle)")
        row.tap()
        XCTAssertTrue(terminal.waitForExistence(timeout: 25), "终端没有出现")
    }

    /// 点左端那颗切换键，进语音态。
    private func enterVoiceMode(_ app: XCUIApplication) {
        revealBars(app)
        let toggle = app.buttons["voice-mode-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 6), "输入栏上没有切换键")
        guard toggle.value as? String != "voice" else { return }
        toggle.tap()
        waitUntil(timeout: 10) { (toggle.value as? String) == "voice" }
        XCTAssertEqual(toggle.value as? String, "voice", "没能进语音态")
    }

    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !condition() {
            usleep(120_000)
        }
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
}
