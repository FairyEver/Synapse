import Foundation
import XCTest

/// 手机端 Git 操作的真机走查：对着**真的电脑、真的仓库**走一遍产品设计文档 §8 里
/// 能用自动化的那几条。
///
/// 与同目录其它用例不同，这一条**不用 `server/test/mock-desktop.mjs`**。Git 这一轮要看
/// 的是「手机点的那一下，电脑真的在那个目录上做了什么」—— 假电脑没有目录、没有 git、
/// 也没有 `mobile.gitStatus` 的夹具，答不了这个。所以它要求：
///
/// - `SYNAPSE_TEST_EMAIL` / `SYNAPSE_TEST_PASSWORD` / `SYNAPSE_TEST_BASE_URL`；
/// - 一台**登录了同一个账号、在线**的电脑（桌面端开着，里面至少有一个终端分组）；
/// - 夹具仓库：跑之前先 `SynapseMobile/scripts/make-git-acceptance-fixture.sh`。
///
/// 夹具是**有状态**的：`testSecondLineMenuAndTheThreeDirtyChoices` 会把 `dirty` 仓库的
/// 改动丢掉（那正是它要验的），所以每一次跑之前都要重建一次。
final class TerminalGitUITests: XCTestCase {
    private var email: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_EMAIL"] ?? "" }
    private var password: String { ProcessInfo.processInfo.environment["SYNAPSE_TEST_PASSWORD"] ?? "" }
    private var baseURL: String {
        ProcessInfo.processInfo.environment["SYNAPSE_TEST_BASE_URL"] ?? "http://localhost:3001/api"
    }

    /// 三条栏闲置三秒会自己收起来，而这里要按的键都在栏上（与 `TerminalFlowUITests`
    /// 同一条理由：把时钟顶到一小时，机制一个字不改）。
    private let barLaunchArguments = [
        "-terminal.inputBar.voiceMode", "NO",
    ]

    /// 两个夹具仓库，各自验一半。
    ///
    /// A 用来验「有改动」那一半：一个已跟踪文件的修改 + 一个未跟踪的新文件。
    /// B 用来验合并：`feature/conflict` 与 `main` 改的是同一行（必定冲突），
    /// `feature/other` 只加了个文件（必定合得上）。
    private let dirtyRepository = "/tmp/synapse-git-acceptance/dirty"
    private let conflictRepository = "/tmp/synapse-git-acceptance/conflict"

    override func setUpWithError() throws {
        // **默认跳过**：这一条走查要一台登录着、在线、且能跑 git 的电脑，还要先把夹具
        // 建好（`scripts/make-git-acceptance-fixture.sh`）—— 它不是一个可以在任何机器上
        // 直接跑的用例，所以由人来点名开启，而不是让每一次全量跑都红着一条。
        try XCTSkipIf(
            ProcessInfo.processInfo.environment["SYNAPSE_GIT_ACCEPTANCE"] != "1",
            "set SYNAPSE_GIT_ACCEPTANCE=1 (and build the fixture) to run the acceptance walk"
        )
        try XCTSkipIf(email.isEmpty || password.isEmpty, "SYNAPSE_TEST_EMAIL and SYNAPSE_TEST_PASSWORD are required")
        continueAfterFailure = false
    }

    // MARK: - 有改动的目录：第二行、入口、三选一、丢弃

    func testSecondLineMenuAndTheThreeDirtyChoices() throws {
        let app = launchAndOpenATerminal()

        // 1. 终端当前目录是仓库 → 第二行变成分支与改动数。这里同时验了「跟着 cd 走」：
        //    会话是在别的目录里建出来的，是这一条命令把它带过来的。
        run("cd \(dirtyRepository)", in: app, expecting: "main · 2 个改动")

        // 3/4. 换到一个不是仓库的目录 → 第二行退回版本号，**不残留上一次的分支名**。
        run("cd /tmp && pwd", in: app, expecting: "/tmp")
        XCTAssertTrue(waitFor(gitSecondLine: "运行中 · ", in: app, timeout: 10, prefix: true))
        XCTAssertFalse(
            app.staticTexts["terminal-second-line"].label.contains("main"),
            "换目录之后第二行还留着上一条分支：\(app.staticTexts["terminal-second-line"].label)"
        )

        // 7. 非 Git 目录时，⋯ 菜单里**没有**「Git」这一行 —— 与「列表为空时入口不出现」
        // 同一条口径，不摆一个点开是空的入口。
        app.buttons["更多"].tap()
        XCTAssertTrue(app.buttons["全屏"].waitForExistence(timeout: 5), "⋯ 菜单没打开")
        XCTAssertFalse(app.buttons["terminal-menu-git"].exists, "不是仓库的目录上仍然摆着「Git」")
        capture(app, name: "git-00-menu-without-git")
        app.buttons["全屏"].tap()   // 收栏，回到画布；点一下画布栏就回来
        app.descendants(matching: .any)["terminal.text"]
            .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).tap()

        // 2. 再 cd 回另一个仓库 → 第二行跟着变（两个仓库之间也跟得上）。
        run("cd \(conflictRepository) && pwd", in: app, expecting: conflictRepository)
        XCTAssertTrue(waitFor(gitSecondLine: "main", in: app, timeout: 10))

        // 回到有改动的那个仓库，后面都在这上面走。
        run("cd \(dirtyRepository)", in: app, expecting: "main · 2 个改动")

        // 6. ⋯ 菜单里有「Git」，而且打开的是面板。
        openGitPanel(in: app)

        // 8/9. 面板第一段是当前目录的完整路径 —— 与终端里 cd 到的目录一致。
        // 只断言路径的尾巴：`/tmp` 在电脑那边可能是 `/private/tmp`，两者说的是同一个地方。
        if !waitForLabel(containing: "synapse-git-acceptance/dirty", in: app, timeout: 10) {
            capture(app, name: "git-96-no-cwd")
            let rows = app.staticTexts.allElementsBoundByIndex.prefix(15).map(\.label)
            XCTFail("面板没显示当前目录；屏幕上是：\(rows)")
        }
        // 10/12. 有改动时「提交」可点；没有上游时「推送」写着「首次推送」。
        XCTAssertTrue(app.buttons["git-panel-commit"].isEnabled, "有改动，提交却是灰的")
        XCTAssertTrue(app.staticTexts["首次推送"].exists, "没有上游时没写「首次推送」")
        capture(app, name: "git-01-panel")

        // 13/14. 分支列表：当前分支、搜索框、以及搜不到时的空态。
        app.buttons["git-panel-branch"].tap()
        XCTAssertTrue(app.buttons["git-branch-main"].waitForExistence(timeout: 10), "分支列表里没有 main")
        XCTAssertTrue(app.buttons["git-branch-feature/other"].exists, "分支列表少了一条分支")
        capture(app, name: "git-02-branches")

        expandSheetIfNeeded(in: app)
        let search = app.searchFields.firstMatch
        if !search.waitForExistence(timeout: 5) {
            let tree = app.descendants(matching: .any).allElementsBoundByIndex.prefix(40)
                .map { "\($0.elementType.rawValue):\($0.identifier)|\($0.label.prefix(24))" }
            XCTFail("分支列表没有搜索框；树是：\(tree)")
        }
        search.tap()
        search.typeText("zzz")
        XCTAssertTrue(
            app.staticTexts["git-branches-empty"].waitForExistence(timeout: 5),
            "搜不到时没有空态"
        )
        capture(app, name: "git-03-branches-empty")
        // 清掉查询，回到完整列表。
        if app.buttons["Clear text"].exists { app.buttons["Clear text"].tap() }
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        XCTAssertTrue(app.buttons["git-branch-main"].waitForExistence(timeout: 5), "清掉查询后列表没回来")
        // 退出搜索态、把键盘收掉。搜索框旁边那颗「取消」是**搜索自己的**（不是这个
        // 应用画的），它的字跟着**系统语言**走 —— 模拟器是英文的 Cancel，中文设备才是
        // 「取消」，所以两个都试。键盘不收掉，后面那张操作表会被它顶到屏幕外。
        for label in ["Cancel", "取消"] {
            let button = app.buttons[label]
            if button.exists, button.isHittable { button.tap(); break }
        }
        if app.keyboards.firstMatch.exists {
            // 兜底：在列表上拖一下，iOS 会把键盘收走（这一页没有下拉刷新，拖了不做事）。
            app.swipeDown()
        }

        // 16/17. 有改动时切分支 → **恰好三个选项**，且没有「暂存并切换」；取消之后什么也没变。
        app.buttons["git-branch-feature/other"].tap()
        XCTAssertTrue(
            app.buttons["git-dirty-discard"].waitForExistence(timeout: 8),
            "有改动时切分支没有先问"
        )
        XCTAssertTrue(app.buttons["git-dirty-commit"].exists, "三选一里少了「提交并切换」")
        XCTAssertTrue(app.buttons["git-dirty-cancel"].exists, "三选一里少了「取消」")
        // 恰好三个：多一个「暂存并切换」就是初稿里被砍掉的那一项回来了。
        // 数**不同的标识符**而不是元素个数：同一条操作表在无障碍树里会出现两次。
        let choices = Set(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'git-dirty-'"))
                .allElementsBoundByIndex.map(\.identifier)
        )
        XCTAssertEqual(choices, ["git-dirty-commit", "git-dirty-discard", "git-dirty-cancel"])
        XCTAssertFalse(app.buttons["暂存并切换"].exists, "「暂存并切换」被加回来了")
        capture(app, name: "git-04-dirty-choices")
        tap("git-dirty-cancel", in: app)
        XCTAssertTrue(app.buttons["git-branch-main"].waitForExistence(timeout: 5), "取消之后仍然切了分支")

        // 19. 丢弃并切换：二次确认里要写明未跟踪的新文件不会被删除；确认之后改动没了、
        //     分支切过去了、**未跟踪的 scratch.md 还在**。
        app.buttons["git-branch-feature/other"].tap()
        XCTAssertTrue(app.buttons["git-dirty-discard"].waitForExistence(timeout: 8))
        let probe = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'git-dirty-'"))
            .allElementsBoundByIndex.map { "\($0.identifier)@\(Int($0.frame.minY))hit=\($0.isHittable)" }
        let sheets = app.sheets.count
        tap("git-dirty-discard", in: app)
        let confirm = app.alerts.firstMatch
        if !confirm.waitForExistence(timeout: 8) {
            capture(app, name: "git-95-no-discard-confirm")
            XCTFail("丢弃没有二次确认；sheets=\(sheets)；buttons=\(probe)；alerts=\(app.alerts.count)")
        }
        // 这一条是整轮里最要紧的一句话：用户看不出手机会不会顺手删掉他放在同一个目录里的
        // 草稿，所以二次确认必须写出来。
        XCTAssertTrue(
            waitForLabel(containing: "未跟踪的新文件不会被删除", in: app, timeout: 5),
            "二次确认没有说清未跟踪文件的下场：\(confirm.debugDescription.prefix(400))"
        )
        capture(app, name: "git-05-discard-confirm")
        tap("git-discard-confirm", in: app, within: confirm)

        // 切换已完成：第二行换了分支名。**右边还有 1 个改动**，那正是没被删掉的那个
        // 未跟踪文件 —— 脏的判定把未跟踪文件也算进去（沿用桌面端口径），而丢弃不动它们。
        _ = waitFor(gitSecondLine: "feature/other · 1 个改动", in: app, timeout: 15)
        capture(app, name: "git-06-switched")

        // 未跟踪的新文件还在 —— 这一条只能用终端自己看：`git status` 还把它列成未跟踪，
        // 说明它没被那次丢弃顺手删掉。
        run("git status --short", in: app, expecting: "?? scratch.md")
    }

    // MARK: - 合并：冲突自动回退，成功的那条照常

    func testMergeConflictAbortsRollsBackAndCopies() throws {
        let app = launchAndOpenATerminal()
        run("cd \(conflictRepository)", in: app, expecting: "main")

        // 34. 冲突：不弹「要不要解决」的岔路，而是自动中止并回退，然后弹出「合并已取消」。
        openGitPanel(in: app)
        app.buttons["git-panel-merge"].tap()
        XCTAssertTrue(app.buttons["git-merge-run"].waitForExistence(timeout: 5), "合并页没打开")
        // 30/31. 两个方向都在；方向二把「切过去 → 合并 → 切回来」写在脸上。
        XCTAssertTrue(app.buttons["git-merge-direction-intoCurrent"].exists, "合并页少了方向一")
        XCTAssertTrue(app.buttons["git-merge-direction-outOfCurrent"].exists, "合并页少了方向二")
        app.buttons["git-merge-direction-outOfCurrent"].tap()
        // 32. 选分支那一页也有搜索框。
        app.buttons["git-merge-branch"].tap()
        expandSheetIfNeeded(in: app)
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5), "合并选分支那一页没有搜索框")
        app.buttons["git-branch-feature/conflict"].tap()
        // 31. 方向二把「切过去 → 合并 → 切回来」写在脸上。选完分支才看得出来 ——
        // 没选之前那句话是「先选一条分支」。
        XCTAssertTrue(
            app.staticTexts["git-merge-plan"].label.contains("切回"),
            "方向二没把链路写在脸上：\(app.staticTexts["git-merge-plan"].label)"
        )
        capture(app, name: "git-07-merge-plan")
        app.buttons["git-merge-run"].tap()

        // 冲突页：说明里有来源、目标、冲突文件数，而且没有「重试」这类岔路。
        XCTAssertTrue(
            app.staticTexts["git-conflict-summary"].waitForExistence(timeout: 30),
            "合并冲突之后没有出现「合并已取消」"
        )
        XCTAssertTrue(app.staticTexts["git-conflict-summary"].label.contains("feature/conflict"))
        XCTAssertTrue(app.staticTexts["git-conflict-summary"].label.contains("main"))
        XCTAssertTrue(app.buttons["git-conflict-copy"].exists, "冲突页没有「复制冲突信息」")
        XCTAssertFalse(app.buttons["重试"].exists, "冲突页出现了「重试」")
        XCTAssertFalse(app.buttons["继续合并"].exists, "冲突页出现了「继续合并」")
        capture(app, name: "git-08-conflict")
        app.buttons["git-conflict-copy"].tap()

        // 到这里为止：冲突页出现了、说明里有两条分支、复制进了剪贴板。
        //
        // 剩下两件事（关掉这一页、然后确认仓库真的回退了）**不在这里做**：这一页的
        // 出口是右上角那颗「好」，而它在用例里读不到（嵌套弹窗的工具栏那一层不进
        // 无障碍树）。硬要按它只会让这一条在最后一步变成假红，而它前面那几条真正要
        // 验的东西那时已经验完了 —— 回退本身另有 `terminal-git` 的用例守着。
    }

    // MARK: - 无冲突的合并

    /// 33：合得上的一条分支真的合上了，而且留在当前分支上。
    func testMergeThatSucceedsKeepsItsBranch() throws {
        let app = launchAndOpenATerminal()
        run("cd \(conflictRepository)", in: app, expecting: "main")

        openGitPanel(in: app)
        app.buttons["git-panel-merge"].tap()
        XCTAssertTrue(app.buttons["git-merge-run"].waitForExistence(timeout: 5), "合并页没打开")
        // 方向一：合进当前分支，合完停在这里。
        app.buttons["git-merge-direction-intoCurrent"].tap()
        app.buttons["git-merge-branch"].tap()
        expandSheetIfNeeded(in: app)
        app.buttons["git-branch-feature/other"].tap()
        capture(app, name: "git-10-merge-clean-plan")
        app.buttons["git-merge-run"].tap()

        XCTAssertTrue(
            waitFor(gitSecondLine: "main", in: app, timeout: 30),
            "合并之后第二行不是 main"
        )
        XCTAssertTrue(
            app.buttons["git-panel-done"].waitForExistence(timeout: 10),
            "合并之后没有回到面板"
        )
        XCTAssertTrue(app.staticTexts["工作区干净"].exists, "合并之后工作区不干净")
        capture(app, name: "git-11-merged")
        app.buttons["git-panel-done"].tap()

        // 合进来的那个文件在 main 上，说明合并真的发生了（不是只换了一句话）。
        run("ls", in: app, expecting: "added-by-other.txt")
    }

    // MARK: - 公共步骤

    private func launchAndOpenATerminal() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", baseURL] + barLaunchArguments
        app.launch()
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 25), "没有标签栏")
        // 终端是第一个标签页。
        tabs.buttons.element(boundBy: 0).tap()
        selectAnOnlineDesktop(in: app)

        // 现建一个终端，而不是点列表里现成的那一行：列表的第 0 行是「正在看的那台电脑」
        // 本身（点它会弹出换电脑的菜单），而会话行没有任何标识符可以指认 —— 从列表里挑
        // 一行等于在猜哪一行是会话。建一个则是确定的，而且建完就在它自己的终端页上。
        app.buttons["new-session"].tap()
        // 弹层默认停在「项目」那一段（新建 Agent 对话），终端分组在另一段上。
        let terminalSegment = app.buttons["终端分组"]
        XCTAssertTrue(terminalSegment.waitForExistence(timeout: 10), "新建弹层没有分段器")
        terminalSegment.tap()
        let group = app.buttons["terminal-group"].firstMatch
        XCTAssertTrue(group.waitForExistence(timeout: 15), "电脑上一个终端分组都没有，先建一个再用")
        group.tap()

        let terminal = app.descendants(matching: .any)["terminal.text"]
        if !terminal.waitForExistence(timeout: 30) {
            capture(app, name: "git-99-no-terminal")
            let visible = app.descendants(matching: .any).allElementsBoundByIndex
                .prefix(25)
                .map { "\($0.elementType.rawValue):\($0.identifier.isEmpty ? $0.label : $0.identifier)" }
            XCTFail("终端始终没出现；屏幕上有：\(visible)")
        }
        return app
    }

    /// 把「正在看的那台电脑」换成跑着夹具的那一台。
    ///
    /// 手机记着上一次看的是哪一台（`ViewedDesktopPreference`），而它可能是别的机器：
    /// 同一个账号下能同时有好几台电脑在线，夹具只在**跑测试的这一台**上。所以换成哪一台
    /// 由 `SYNAPSE_TEST_DESKTOP_NAME` 指定（与这台 Mac 的 `os.hostname()` 一致，
    /// 例如 `liyang.local`）；没指定时退而求其次，挑一台不是 UI 测试留下的假电脑的。
    private func selectAnOnlineDesktop(in app: XCUIApplication) {
        let switchMenu = app.buttons["switch-computer"]
        guard switchMenu.waitForExistence(timeout: 20) else { return }
        let wanted = ProcessInfo.processInfo.environment["SYNAPSE_TEST_DESKTOP_NAME"]
        // 已经在正确的那一台上就什么都不用做。
        if let wanted, app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", wanted)).firstMatch.exists {
            return
        }
        guard app.staticTexts["这台电脑不在线"].exists || wanted != nil else { return }

        switchMenu.tap()
        let options = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH 'switch-computer-option-'")
        )
        var fellBack: XCUIElement?
        for index in 0..<options.count {
            let option = options.element(boundBy: index)
            guard option.exists else { continue }
            if let wanted {
                if option.label.contains(wanted) {
                    choose(option, in: app)
                    return
                }
                continue
            }
            // UI 测试留下的假电脑还在账号里（`server/test/mock-desktop.mjs` 注册过），
            // 但它这会儿没跑。
            guard !option.label.contains("Mock") else { continue }
            fellBack = option
            break
        }
        if let fellBack {
            choose(fellBack, in: app)
            return
        }
        XCTFail("这台电脑不在账号的在线列表里，这一轮走查需要它")
    }

    private func choose(_ option: XCUIElement, in app: XCUIApplication) {
        option.tap()
        _ = app.staticTexts["这台电脑不在线"].waitForNonExistence(timeout: 25)
        dismissMenuIfStillOpen(in: app)
        capture(app, name: "git-0-desktop")
    }

    /// 选完电脑之后菜单有时还挂在屏幕上，而它是浮在最上面的一层 —— 后面每一次点按都
    /// 会落在它身上，症状是「什么都没发生」。点一下列表本体把它收掉。
    private func dismissMenuIfStillOpen(in app: XCUIApplication) {
        let options = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH 'switch-computer-option-'")
        )
        guard options.count > 0 else { return }
        app.navigationBars.firstMatch.tap()
        _ = options.firstMatch.waitForNonExistence(timeout: 5)
    }

    /// 在终端里跑一条命令，并等到屏幕上出现期望的输出。
    ///
    /// 会重发。这条路上的第一条命令是发给**刚起来的 shell** 的（这个环境里 oh-my-zsh
    /// 自己还会在启动时问一句要不要更新），落进那句话里的输入会被当成回答吃掉 ——
    /// 症状是「命令打上去了，却什么都没发生」。等人打完字再按一次就好，而 `cd` / `pwd` /
    /// `git status` 重发一次都没有副作用。
    private func run(_ command: String, in app: XCUIApplication, expecting needle: String) {
        var arrived = false
        for attempt in 1...3 {
            send(command, in: app)
            if waitForLabel(containing: needle, in: app, timeout: attempt == 1 ? 8 : 12) {
                arrived = true
                break
            }
            // 那一行有时落进了命令行却没等到回车（提示符正在重画时会这样）：补一次回车。
            // 键盘收起来时工具栏上的「回车」也跟着让位，那时就没有这一颗可补。
            if app.buttons["toolbar-enter"].exists {
                app.buttons["toolbar-enter"].tap()
                if waitForLabel(containing: needle, in: app, timeout: 8) {
                    arrived = true
                    break
                }
            }
        }
        if !arrived {
            capture(app, name: "git-98-\(command.prefix(24))")
            let second = app.staticTexts["terminal-second-line"]
            XCTFail(
                "终端里没等到「\(needle)」，命令是：\(command)；"
                    + "第二行是「\(second.exists ? second.label : "（没有这一行）")」"
            )
        }
        // 键盘**不收**：收一次就丢一次焦点，而下一条命令还得再把它要回来。这一页上真正
        // 需要键盘让位的只有输入栏本身，而它一直在键盘上方 —— 读输出读的是画布，不是
        // 键盘底下的那几行。
        capture(app, name: "git-run-\(command.prefix(18))")
    }

    private func send(_ command: String, in app: XCUIApplication) {
        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10), "输入栏不见了")
        // 点一下不一定拿到焦点（上一处收键盘的动作可能刚把焦点交出去），而**没焦点就打不了
        // 字**。等一小会儿再打：这几百毫秒换的是那一下输入一定落在输入框里。
        // 不去等系统键盘 —— 模拟器接了硬件键盘时它根本不出现，等它只会等出一个假红。
        input.tap()
        usleep(300_000)
        // 再点一次：这个输入框在画布刚被点过之后，第一下有时只是把焦点要回来而不落定。
        input.tap()
        usleep(300_000)
        input.typeText(command)
        app.buttons["send"].firstMatch.tap()
    }

    /// 把弹窗拖到全屏。
    ///
    /// 半屏（`.medium`）装不下一条搜索框，系统会把它整个收起来 —— 真人要看搜索框也得先
    /// 把弹窗拉上去，这一步就是那个动作。
    /// 按标识符点一颗键。
    ///
    /// 操作表与弹窗在无障碍树里会各出现**两次**（同一条 `Button` 的副本），
    /// `app.buttons["x"].tap()` 因此会报「找到多个」—— 按到那一颗真的能按的上面去。
    private func tap(_ identifier: String, in app: XCUIApplication, within container: XCUIElement? = nil) {
        // 先在那张弹窗自己那一层里找：同一条 `Button` 在整个应用里能找到两份，而按到
        // 错的那一份上等于点了一下蒙层 —— 弹窗关掉了，动作没发生。
        let scopes: [XCUIElement] = container.map { [$0] } ?? [app.sheets.firstMatch, app.alerts.firstMatch, app]
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            for scope in scopes where scope.exists {
                let matches = scope.buttons.matching(identifier: identifier)
                for index in 0..<matches.count {
                    let candidate = matches.element(boundBy: index)
                    if candidate.exists, candidate.isHittable {
                        candidate.tap()
                        return
                    }
                }
            }
            usleep(200_000)
        }
        XCTFail("按不到「\(identifier)」")
    }

    private func expandSheetIfNeeded(in app: XCUIApplication) {
        let grabber = app.otherElements["Sheet Grabber"].firstMatch
        guard grabber.exists else { return }
        let start = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: 0, dy: -420))
        start.press(forDuration: 0.1, thenDragTo: end)
        _ = app.searchFields.firstMatch.waitForExistence(timeout: 5)
    }

    private func openGitPanel(in app: XCUIApplication) {
        let menu = app.buttons["更多"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "⋯ 菜单不见了")
        menu.tap()
        XCTAssertTrue(
            app.buttons["terminal-menu-git"].waitForExistence(timeout: 5),
            "⋯ 菜单里没有「Git」——目录是仓库时它必须出现"
        )
        app.buttons["terminal-menu-git"].tap()
        XCTAssertTrue(app.buttons["git-panel-done"].waitForExistence(timeout: 10), "Git 面板没打开")
    }

    /// 第二行是不是那句话。它是顶栏里的一行文字，标识符只有一个，变的是它的值。
    ///
    /// `prefix: true` 用来匹配「运行中 · 1.0.16 (13)」这种**尾部是版本号**的一句：
    /// 版本号跟着构建走，用例里写死它只会在下一次发版时变成一个假红。
    private func waitFor(
        gitSecondLine line: String,
        in app: XCUIApplication,
        timeout: TimeInterval,
        prefix: Bool = false
    ) -> Bool {
        let element = app.staticTexts["terminal-second-line"]
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists, prefix ? element.label.hasPrefix(line) : element.label == line {
                return true
            }
            usleep(200_000)
        }
        XCTFail("第二行始终不是「\(line)」，现在是「\(element.exists ? element.label : "（没有这一行）")」")
        return false
    }

    private func waitForLabel(containing text: String, in app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        return app.staticTexts.matching(predicate).firstMatch.waitForExistence(timeout: timeout)
    }

    private func signIn(_ app: XCUIApplication) {
        let emailField = app.textFields.firstMatch
        let tabs = app.tabBars.firstMatch
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            if tabs.exists || emailField.exists { break }
            usleep(200_000)
        }
        guard !tabs.exists else { return }
        guard emailField.exists else {
            capture(app, name: "git-00-signin-never-appeared")
            XCTFail("登录页与已恢复的会话都没有出现")
            return
        }
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields.firstMatch
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "没有密码框")
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["登录"].firstMatch.tap()
        XCTAssertTrue(tabs.waitForExistence(timeout: 30), "登录之后没有进到列表")
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
