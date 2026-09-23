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
        if !app.buttons["new-session-project"].waitForExistence(timeout: 10) {
            // 「面板没出现」有两个完全不同的原因，而它们在屏幕上长得一样：那一格被
            // 禁用了（没有可用的电脑），或者点了没反应。把当时的状态一起报出来。
            capture(app, name: "new-session-never-appeared")
            XCTFail("""
            the panel never appeared; \
            new-session exists=\(app.buttons["new-session"].exists) \
            enabled=\(app.buttons["new-session"].isEnabled) \
            hittable=\(app.buttons["new-session"].isHittable)
            """)
        }
        // Scoped to the segmented control, because the screen behind the sheet has a
        // 终端 tab of its own — and addressed by label rather than by an identifier,
        // since a `Picker` in this style is a container of buttons and the container is
        // not what a tap lands on.
        XCTAssertTrue(segments(in: app)["项目"].exists, "the segmented control is missing")
        XCTAssertTrue(segments(in: app)["项目"].isSelected, "the panel did not open on 项目")
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
    /// tapping a group creates a terminal, with no button to confirm it first. It grew a
    /// search box, which shortens the list and decides nothing — see the assertions below.
    ///
    /// 「点分组即建」现在只对**没配快捷命令**的分组成立：配了命令的分组右侧有箭头，
    /// 点进去先选命令。这里量的是没配的那些今天的样子，所以它在两种账号下都还成立。
    func testLeavesTheTerminalSegmentAlone() throws {
        let app = launch()

        app.buttons["new-session"].tap()
        XCTAssertTrue(segments(in: app)["项目"].waitForExistence(timeout: 10), "the panel never appeared")

        segments(in: app)["终端分组"].tap()
        // The group list, and no primary button: a terminal group has no default worth
        // guessing, so a confirm step here would be friction with nothing behind it.
        XCTAssertFalse(
            app.buttons["start-conversation"].exists,
            "the terminal segment grew a confirm button"
        )
        XCTAssertFalse(app.buttons["new-session-project"].exists, "the terminal segment shows the conversation rows")
        // The groups themselves, which are what the segment has always offered.
        //
        // 数的是带标识的分组行，不是 `app.cells`：弹层背后那条会话列表也在这棵树里，
        // 数 cell 数到的是它，分组列表空着这句也照样绿。
        let groups = app.buttons.matching(identifier: "terminal-group")
        XCTAssertGreaterThan(groups.count, 0, "the terminal segment lost its group list")
        capture(app, name: "04-terminal-segment")

        // 搜索框跟项目、供应商那两页是同一个做法，位置和外观都交给系统；这里验的是它在，
        // 而且真的在筛——只画一个搜索框也能让上面那句「分组还在」成立。
        let search = app.searchFields["搜索分组"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), "终端分组这一段没有搜索框")
        let found = groups.count

        let miss = "zzz-没有这个分组"
        search.tap()
        search.typeText(miss)
        XCTAssertTrue(waitForCount(groups, 0), "搜索没有把分组列表筛掉")
        capture(app, name: "05-terminal-segment-no-match")

        // 清掉搜索，分组要回来：筛得下去也要回得来。
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: miss.count))
        XCTAssertTrue(waitForCount(groups, found), "清掉搜索以后分组没有回来")
    }

    /// 给分组配了快捷命令的电脑上，终端分组那一段会长出第二层：行右一个箭头，点进去是
    /// 命令列表，列表底部永远有一条「直接新建终端」。
    ///
    /// 一条命令都没配的账号跑不了这个用例 —— 有没有配是用户自己的数据，测试造不出来，
    /// 所以这里以跳过说明，而不是把电脑上的东西改掉。
    func testRunsASavedCommandFromThePanel() throws {
        let app = launch()

        app.buttons["new-session"].tap()
        XCTAssertTrue(segments(in: app)["项目"].waitForExistence(timeout: 10), "the panel never appeared")
        segments(in: app)["终端分组"].tap()

        let groups = app.buttons.matching(identifier: "terminal-group")
        XCTAssertGreaterThan(groups.count, 0, "the terminal segment lost its group list")
        groups.firstMatch.tap()

        // 第一个分组没配命令时它会直接建终端 —— 那正是「没命令的分组一点即建」，本用例
        // 要验的是另一条路，所以跳过并说清缺什么。
        let plain = app.buttons["terminal-group-command-none"]
        guard plain.waitForExistence(timeout: 10) else {
            throw XCTSkip("这个账号的第一个分组没有配快捷命令；在电脑上给任意分组加一条命令后重跑")
        }
        capture(app, name: "06-group-command-list")

        // 命令列表：至少一条命令，加底部那条「直接新建终端」。
        let commands = app.buttons.matching(identifier: "terminal-group-command")
        XCTAssertGreaterThan(commands.count, 0, "进了命令列表却没有命令")
        XCTAssertTrue(plain.isHittable, "「直接新建终端」不在列表底部")

        // 点一条命令：面板关掉，落到一个终端上 —— 与「开始对话」落的是同一屏。
        let name = commands.firstMatch.staticTexts.firstMatch.label
        XCTAssertFalse(name.isEmpty, "命令没有名字")
        commands.firstMatch.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 30),
            "点了命令没有落到终端上（命令：\(name)）"
        )
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
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL]
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
        //
        // 等的是「能按」，不是「在那儿」：按钮在会话列表一画出来就存在，而电脑要等摘要
        // 回来才算上线。只等存在就点，点到的是一个禁用按钮——什么都没发生，报出来的
        // 却是后面那句「面板没出来」。
        let plus = app.buttons["new-session"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30), "no computer came online")
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: plus)
        waitForExpectations(timeout: 30)
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

    /// 等查询到的行数变成 `expected`。
    ///
    /// 搜索是逐字生效的，一次查询拿到的是那一刻的快照，紧接着断言会读到还没重算完的
    /// 行数。等到行数对上，才是在断言筛完的结果。
    private func waitForCount(_ query: XCUIElementQuery, _ expected: Int, timeout: TimeInterval = 5) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if query.count == expected { return true }
            usleep(200_000)
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
