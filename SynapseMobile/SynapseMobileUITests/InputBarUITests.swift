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

    /// §8 第 12 条：压到面板左半松手 = 这一段丢掉，而且**留在语音态**。
    ///
    /// 按住**期间**的样子（蒙层盖上来、压着的那半高亮、滑下来复原）在这里断言不了：
    /// `press(forDuration:thenDragTo:)` 是一次全程阻塞的调用，而 XCUITest 的查询必须在
    /// 主线程上跑，所以没有「按住不放、同时在旁边看」的写法。那几条由用例留下的截图与
    /// `HoldToTalkPresentationTests` 一起作证。
    ///
    /// 去路就在**面板本身**上，所以手指从输入栏往上滑到面板就够 —— 那个距离是
    /// `upToThePanel`，由浮层那几段固定高度加起来得到。
    func testSlidingUpOntoCancelDropsItAndStaysInVoiceMode() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        let hold = app.descendants(matching: .any)["voice-hold"]
        let centre = hold.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // 不横着挪：这一格的中心落在屏幕中线左边，压上去就是面板的左半「取消」。
        centre.press(forDuration: 1.0, thenDragTo: centre.withOffset(CGVector(dx: 0, dy: -Self.upToThePanel)))
        settle(seconds: 1)

        // 取消多半是想重说一遍，让人再按一次切换键没有道理 —— 所以它**不回**键盘态。
        XCTAssertEqual(app.buttons["voice-mode-toggle"].value as? String, "voice", "取消之后离开了语音态")
        XCTAssertEqual(hold.label, "按住 说话", "取消之后那一格没有回到待按的样子")
        XCTAssertFalse(app.textFields.firstMatch.exists, "取消留在语音态，输入框不该回来")
        shot(app, "22-after-cancel")
    }

    /// §8 第 8～11 条：按住期间气泡浮出来，滑动让气泡下方的提示跟着变。
    ///
    /// 只留下一段录屏与三张图 —— 断言不了（见上一条），但松手之前的画面在录屏里，
    /// 有没有气泡、提示是哪一句，看得到。
    func testCaptureTheHoldAndTheTwoGestures() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        let hold = app.descendants(matching: .any)["voice-hold"]
        let centre = hold.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        shot(app, "50-voice-mode-before-holding")
        centre.press(forDuration: 2.0, thenDragTo: centre.withOffset(CGVector(dx: 0, dy: -Self.upToThePanel)))
        settle(seconds: 1)
        shot(app, "51-after-dragging-up-and-releasing")
    }

    /// §8 第 17～20 条：压到面板右半松手 = 录音继续，输入栏那一格变成「完成」，
    /// 面板上多一枚「取消」，按下去整段丢掉并回键盘态。
    func testStoppingOnPinLocksTheRecordingAndCancelGivesItUp() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        let hold = app.descendants(matching: .any)["voice-hold"]
        let centre = hold.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // 往右上方滑：越过屏幕中线就是面板的右半「固定」。
        centre.press(
            forDuration: 1.0,
            thenDragTo: centre.withOffset(CGVector(dx: 120, dy: -Self.upToThePanel))
        )

        let cancel = app.buttons["voice-lock-cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 6), "固定之后面板上没有出现「取消」")
        // 顶上那行不是废话：麦克风还开着这件事不写出来只能靠猜。
        XCTAssertTrue(app.staticTexts["已固定 · 持续识别"].exists, "面板没有报「已固定」")
        // 手指走了，那层蒙层就该收起来 —— 留着它等于还在教人滑。
        XCTAssertFalse(app.descendants(matching: .any)["voice-zone-cancel"].exists, "固定之后蒙层还盖着")
        // 面板自己也认一遍：`voice-panel` 这个 id 要在这里坐实能被查到，另一条测试才敢
        // 拿「面板不在了」当收尾结束的信号（按面板上的字认，文案一改就恒为真）。
        XCTAssertTrue(app.descendants(matching: .any)["voice-panel"].exists, "voice-panel 这个 id 查不到")
        XCTAssertEqual(hold.label, "完成", "固定之后那一格不是「完成」")
        shot(app, "30-locked")

        cancel.tap()
        waitUntil(timeout: 5) { !cancel.exists }
        XCTAssertFalse(cancel.exists, "取消之后面板还挂着")
        // §3.3（2026-09-18 改判）：收摊不改模式 —— 取消就是取消，要打字得点切换键。
        XCTAssertEqual(app.buttons["voice-mode-toggle"].value as? String, "voice", "取消之后把语音态一起收走了")
        XCTAssertFalse(app.textFields.firstMatch.exists, "语音态还把输入框留在屏幕上")
        shot(app, "31-after-discard")
    }

    /// §8 第 19 条：固定之后按「完成」之后仍在语音态，走的与松手那条是同一条路。
    func testFinishingALockedRecordingStaysInVoiceMode() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        let hold = app.descendants(matching: .any)["voice-hold"]
        let centre = hold.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        centre.press(
            forDuration: 1.0,
            thenDragTo: centre.withOffset(CGVector(dx: 120, dy: -Self.upToThePanel))
        )

        XCTAssertTrue(
            app.buttons["voice-lock-cancel"].waitForExistence(timeout: 6),
            "固定之后面板上没有出现「取消」"
        )
        XCTAssertEqual(hold.label, "完成", "固定之后那一格不是「完成」")
        hold.tap()

        // 模式不动（§3.3）：收尾之后这一格回到「按住 说话」，等着说下一句。
        waitUntil(timeout: 8) { hold.exists && hold.label != "完成" }
        XCTAssertEqual(app.buttons["voice-mode-toggle"].value as? String, "voice", "完成之后把语音态一起收走了")
        shot(app, "32-after-confirm")
    }

    /// 说完一句（松手）之后仍在语音态，接着按住就能说下一句。
    ///
    /// 这条正是产品负责人在真机上判错的那一处：以前收尾会顺手把输入栏打回键盘态，
    /// 说一句就得再点一次切换键。模拟器里说不出话（没有音频喂进去），所以这里走的
    /// 是「松手 → 收尾」这段本身 —— 模式就是在这一步被改掉的。
    func testReleasingLeavesTheBarInVoiceMode() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        let hold = app.descendants(matching: .any)["voice-hold"]
        XCTAssertTrue(hold.waitForExistence(timeout: 5), "语音态没有「按住 说话」那一格")
        hold.press(forDuration: 1.2)
        // 收尾要走完才谈得上「说完了」：面板收掉就说明落定结束了（§4.6）。
        //
        // 认的是面板本身（`voice-panel`），不是上面那行字。按文案认的写法在文案一改之后
        // 就恒为真 —— 面板还挂着，这条断言照样绿。
        let panel = app.descendants(matching: .any)["voice-panel"]
        waitUntil(timeout: 10) { !panel.exists }

        XCTAssertEqual(app.buttons["voice-mode-toggle"].value as? String, "voice", "松手之后被打回了键盘态")
        XCTAssertTrue(hold.waitForExistence(timeout: 5), "说完之后「按住 说话」那一格不见了")
        shot(app, "51-still-voice-after-release")
    }

    /// 输入栏记住上次选定的是哪种模式：再进终端、重开 App，都从它起手。
    ///
    /// 记的是**选定**那一下，不是这一刻栏的样子 —— 说完一句之后留在语音态（§3.3）
    /// 与滑走取消之后留在语音态，都不该改写它。所以下面先按切换键过去、再让一次
    /// 说话走完，重新进来时仍然是语音态。
    func testTheInputBarRemembersWhichModeWasLastChosen() throws {
        let app = openTerminal()
        enterVoiceMode(app)

        // 关掉重开。这条偏好是 App 自己的，得活过一次启动才算记住。
        app.terminate()
        app.launch()
        enterTerminal(app)
        let toggle = app.buttons["voice-mode-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "输入栏上没有切换键")
        XCTAssertEqual(toggle.value as? String, "voice", "记住的语音态没有再进终端时生效")
        shot(app, "50-remembered-voice-mode")

        // 反过来也要记住：切回键盘态，重开之后从键盘态起手。
        // 这一步同时把偏好放回默认值，后面的用例（别的文件也在内）按键盘态起手。
        setKeyboardMode(app)
        app.terminate()
        app.launch()
        enterTerminal(app)
        XCTAssertEqual(
            app.buttons["voice-mode-toggle"].value as? String,
            "keyboard",
            "切回键盘态没有被记住"
        )
    }

    /// 从输入栏那一格往上滑多远才压得到面板。
    ///
    /// 去路长在**面板本身**上（左半取消、右半固定），所以够得着的距离就是「输入栏
    /// 那一格的中心」到「面板」这一段：中间隔着工具栏约 48、浮层的下边距 16，加上输入栏
    /// 那一格中心到底边约 28；面板自己约 152 高（上下各 16 内边距，里面是状态行、三行
    /// 转写、提示行）。于是往上走的距离落在 80～256 这一段里，取 170 是它的正中间，
    /// 两侧各留八十多点 ——
    ///
    /// 这个数**故意写宽**而不是贴着边界取：浮层里任何一段高度变了，贴着边界取的数
    /// 会立刻掉出去，而落在中间的数还能容忍几十点的出入。
    private static let upToThePanel: CGFloat = 170

    /// §8 第 5 条：进语音态要顺手把键盘收走。
    ///
    /// 自绘面板那一半现在**从界面上够不着**：面板开着时工具栏与输入栏整条让位，切换键
    /// 就在那条输入栏上，所以「面板开着的时候进语音态」构造不出来。能构造的是另一半 ——
    /// 系统键盘——而它仍然由 `enterVoiceMode` 里那次 `dismissKeyboards()` 收掉；这一条
    /// 验的就是那一下。
    func testEnteringVoiceModePutsTheKeyboardAway() throws {
        let app = openTerminal()

        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "输入栏上没有输入框")
        field.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 10),
            "点了输入框，系统键盘没起来"
        )

        enterVoiceMode(app)
        XCTAssertFalse(
            app.keyboards.firstMatch.exists,
            "进语音态没有收起系统键盘"
        )
        shot(app, "40-voice-mode-without-panel")
    }

    private func enterVoiceMode(_ app: XCUIApplication) {
        let toggle = app.buttons["voice-mode-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "输入栏上没有切换键")
        guard toggle.value as? String != "voice" else { return }
        toggle.tap()
        waitUntil(timeout: 10) { (toggle.value as? String) == "voice" }
        if (toggle.value as? String) != "voice" {
            // 三种进不去的原因各自会浮一条提示条（§3.8）。把它们留下来，否则失败信息
            // 只能说「没进去」，而这句话对麦克风被拒、断网、和停在键盘态同样成立。
            shot(app, "13-toggle-never-became-voice")
            attach("diag-app-tree", app.debugDescription)
        }
        XCTAssertEqual(toggle.value as? String, "voice", "点了切换键没进语音态")
    }

    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !condition() {
            usleep(120_000)
        }
    }

    private func attach(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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

    /// 开一个终端，并且**把输入栏摆回键盘态**。
    ///
    /// 摆而不是假定：输入栏记着上次选的是哪种模式，上一个用例、上一次运行留下了
    /// 什么，与本次要验的东西无关。与 `testThePanelRemembersWhichSegmentWasLastOpen`
    /// 是同一条约定 —— 记着的那个值是 App 自己的，用例自己把起手态摆好。
    private func openTerminal() -> XCUIApplication {
        let app = XCUIApplication()
        // 时长顶到一小时：终端那三条栏闲置三秒会自己收起来，而这些用例一路要点
        // `voice-mode-toggle` / `voice-hold`，中间隔着十几秒的等待。机制一个字不改，
        // 变的只有时钟；真正的三秒由 `ChromeAutoHideUITests` 用一秒的时长覆盖。
        app.launchArguments = [
            "-SynapseAPIBaseURL", baseURL,
            "-SynapseChromeIdleSeconds", "3600",
        ]
        app.launch()
        enterTerminal(app)
        setKeyboardMode(app)
        return app
    }

    /// 走到某个终端里面。已经在里面的时候只等它出现 —— 重开 App 之后它可能直接
    /// 恢复到上次那个终端，列表就不在屏幕上。
    private func enterTerminal(_ app: XCUIApplication) {
        signIn(app)

        let terminal = app.descendants(matching: .any)["terminal.text"]
        guard !terminal.waitForExistence(timeout: 5) else { return }

        let row = app.staticTexts[sessionTitle]
        XCTAssertTrue(row.waitForExistence(timeout: 30), "会话列表里没有 \(sessionTitle)")
        row.tap()
        XCTAssertTrue(terminal.waitForExistence(timeout: 20), "终端没有出现")
    }

    private func setKeyboardMode(_ app: XCUIApplication) {
        let toggle = app.buttons["voice-mode-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "输入栏上没有切换键")
        guard toggle.value as? String != "keyboard" else { return }
        toggle.tap()
        waitUntil(timeout: 10) { (toggle.value as? String) == "keyboard" }
        XCTAssertEqual(toggle.value as? String, "keyboard", "没能把输入栏摆回键盘态")
    }

    private func signIn(_ app: XCUIApplication) {
        defer { enterTerminalTab(app) }
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
