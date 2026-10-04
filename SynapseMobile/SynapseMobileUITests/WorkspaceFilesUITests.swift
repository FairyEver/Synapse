import XCTest

/// Read-only acceptance against an authenticated relay and the real desktop file
/// adapter. The prepared terminal is selected explicitly; these tests never run
/// checkout/discard or create edits in the user's repositories.
final class WorkspaceFilesUITests: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment
    private var sessionTitle: String { environment["SYNAPSE_FILES_SESSION_TITLE"] ?? "Files acceptance" }
    private var sceneRestoreFrame: CGRect?

    override func tearDownWithError() throws {
        if let target = sceneRestoreFrame {
            let app = XCUIApplication()
            if app.state == .runningForeground { restoreSceneWindow(in: app, to: target) }
            sceneRestoreFrame = nil
        }
        try super.tearDownWithError()
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "System password prompt") { alert in
            for title in ["以后", "Not Now", "Later"] where alert.buttons[title].exists {
                alert.buttons[title].tap(); return true
            }
            return false
        }
        guard environment["SYNAPSE_FILES_ACCEPTANCE"] == "1",
              environment["SYNAPSE_TEST_EMAIL"]?.isEmpty == false,
              environment["SYNAPSE_TEST_PASSWORD"]?.isEmpty == false,
              environment["SYNAPSE_TEST_BASE_URL"]?.isEmpty == false else {
            throw NSError(domain: "WorkspaceFilesAcceptance", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Read-only acceptance needs the configured real relay, desktop and prepared Files acceptance terminal."])
        }
    }

    func testBrowseSearchPreviewAndNativeLayout() throws {
        let app = openPreparedTerminal()
        openFiles(in: app)
        if app.frame.height > app.frame.width, app.segmentedControls["files-tabs"].exists {
            let browser = app.tables["files-browser"].firstMatch
            let firstEntry = browser.cells.matching(NSPredicate(format: "identifier BEGINSWITH 'files-entry-'" )).firstMatch
            XCTAssertTrue(firstEntry.waitForExistence(timeout: 15) && firstEntry.isHittable,
                "The ordinary portrait sheet must show file content before expansion")
            XCTAssertTrue(browser.frame.contains(firstEntry.frame), "The first file row must be fully visible")
            capture(app, name: "files-initial-content-density")
        }
        expandSheet(in: app)
        let notes = browserEntry("files-entry-nested", in: app)
        reveal(notes, in: app)
        XCTAssertTrue(notes.waitForExistence(timeout: 15))
        notes.tap()
        XCTAssertTrue(browserEntry("files-entry-nested/notes.txt", in: app, file: true).waitForExistence(timeout: 15))
        capture(app, name: "files-tree")
        try audit(app)

        expandSheet(in: app)
        var search = searchInput(in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("notes")
        let submit = app.buttons["files-search-submit"].firstMatch
        XCTAssertTrue(submit.waitForExistence(timeout: 5) && submit.isHittable)
        submit.tap()
        var result = browserEntry("files-search-result-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(result.waitForExistence(timeout: 15), "The submitted search must return a result row")
        XCTAssertTrue(result.label.contains("目录，nested"), "The result must describe its parent directory")
        capture(app, name: "files-search-results-parent-path")
        try audit(app)
        let clear = app.buttons["files-search-clear"].firstMatch
        XCTAssertTrue(clear.waitForExistence(timeout: 5) && clear.isHittable)
        clear.tap()
        XCTAssertTrue(browserEntry("files-entry-nested", in: app).waitForExistence(timeout: 15))
        XCTAssertTrue(["", "搜索文件"].contains(search.value as? String ?? ""))

        selectFileView("已修改", in: app)
        let changedFile = app.tables["files-browser"].buttons["files-change-review.txt"].firstMatch
        XCTAssertTrue(changedFile.waitForExistence(timeout: 15), "The changed view must show the real fixture's modified file")
        XCTAssertFalse(browserEntry("files-entry-nested", in: app).exists)
        capture(app, name: "files-view-changed")
        selectFileView("所有文件", in: app)
        XCTAssertTrue(browserEntry("files-entry-nested", in: app).waitForExistence(timeout: 15))
        XCTAssertFalse(changedFile.exists, "Returning to all files must restore the directory tree")
        capture(app, name: "files-view-all")

        search = searchInput(in: app)
        search.tap(); search.typeText("notes")
        submit.tap()
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        let scope = app.buttons["files-scope"].firstMatch
        XCTAssertTrue(scope.waitForExistence(timeout: 5))
        if !scope.isHittable { reveal(scope, in: app, towardStart: true) }
        XCTAssertTrue(scope.isHittable)
        scope.tap()
        tapContextAction("仓库", in: app)
        XCTAssertTrue(browserEntry("files-entry-nested", in: app).waitForExistence(timeout: 15))
        search = searchInput(in: app)
        XCTAssertTrue(["", "搜索文件"].contains(search.value as? String ?? ""))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Scope reset must dismiss the search focus")
        search.tap(); search.typeText("notes\n")
        result = browserEntry("files-search-result-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        XCTAssertTrue(result.label.contains("目录，nested"))
        capture(app, name: "files-search-results-after-scope-reset")
        result.press(forDuration: 1)
        capture(app, name: "files-search-context-menu")
        tapContextAction("在目录中显示", in: app)
        let contextLocated = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(contextLocated.waitForExistence(timeout: 15) && contextLocated.isHittable,
            "The search context action must reveal the actual file in its directory")
        capture(app, name: "files-search-context-revealed")
        search = searchInput(in: app)
        search.tap(); search.typeText("notes\n")
        result = browserEntry("files-search-result-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        result.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.waitForExistence(timeout: 15))
        capture(app, name: "files-preview")
        try audit(app)
        let path = app.textViews.matching(NSPredicate(format: "value == %@", "nested/notes.txt")).firstMatch
        XCTAssertTrue(path.exists)
        // The native control's minimum tap bounds also include empty space below
        // its first line. Select a word at the start of that visible line.
        path.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.2)).press(forDuration: 1)
        capture(app, name: "files-copy-menu")
        let copyLabel = NSPredicate(format: "label == '拷贝' OR label == '复制' OR label == 'Copy'")
        let copyMenu = app.menuItems.matching(copyLabel).firstMatch
        let copyButton = app.buttons.matching(copyLabel).firstMatch
        let copying = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in copyMenu.exists || copyButton.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [copying], timeout: 5), .completed,
            "Native read-only path must offer Copy after selection")
        if copyMenu.exists { copyMenu.tap() } else { copyButton.tap() }
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        app.navigationBars.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        app.buttons["files-content-menu"].firstMatch.tap()
        app.buttons["在目录中显示"].firstMatch.tap()
        let located = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(located.waitForExistence(timeout: 15))
        capture(app, name: "files-small-reveal-before-hit-check")
        XCTAssertTrue(located.isHittable, "Reveal must return to the real tree and scroll to the file")
        XCTAssertTrue(["", "搜索文件"].contains(searchInput(in: app).value as? String ?? ""))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture(app, name: "files-revealed-search-result")
        located.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.waitForExistence(timeout: 15))

        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.waitForExistence(timeout: 5))
        capture(app, name: "files-landscape")
        XCUIDevice.shared.orientation = .portrait
    }

    func testGitEntranceShowsRealUnstagedAndStagedContent() throws {
        let app = openPreparedTerminal()
        app.buttons["更多"].firstMatch.tap()
        app.buttons["terminal-menu-git"].firstMatch.tap()
        let changed = app.buttons["git-panel-changes"].firstMatch
        XCTAssertTrue(app.buttons["git-panel-done"].firstMatch.waitForExistence(timeout: 15))
        // At the largest accessibility size, this row is lazily created below
        // the repository/branch/remote/sync rows. Identify the presented Git
        // List by its visible repository header, avoiding hidden terminal lists.
        let collections = app.collectionViews.allElementsBoundByIndex
        let tables = app.tables.allElementsBoundByIndex
        let gitLists = (collections + tables).filter {
            $0.staticTexts["仓库目录"].exists && $0.isHittable &&
                !$0.frame.intersection(app.frame).isEmpty
        }
        XCTAssertEqual(gitLists.count, 1, "The presented Git sheet must contain one accessible native List")
        let gitList = gitLists.first
        capture(app, name: "files-git-entrance-before-scroll")
        for _ in 0..<8 {
            if changed.exists && changed.isHittable { break }
            gitList?.swipeUp()
        }
        XCTAssertTrue(changed.waitForExistence(timeout: 15) && changed.isHittable)
        capture(app, name: "files-git-entrance-after-scroll")
        changed.tap()
        let review = app.tables["files-browser"].buttons["files-change-review.txt"].firstMatch
        XCTAssertTrue(app.buttons["files-close"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["git-panel-done"].exists, "Git sheet must dismiss before Files opens")
        capture(app, name: "files-git-medium")
        expandSheet(in: app)
        reveal(review, in: app)
        XCTAssertTrue(review.waitForExistence(timeout: 15)); review.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "WORKTREE")).firstMatch.waitForExistence(timeout: 15))
        capture(app, name: "files-unstaged")
        try audit(app)
        let range = app.buttons["files-change-range"].firstMatch
        if !range.isHittable {
            let back = app.navigationBars.buttons["工作区文件"].firstMatch
            if back.exists { back.tap() }
            if !range.isHittable { reveal(range, in: app, towardStart: true) }
        }
        XCTAssertTrue(range.waitForExistence(timeout: 5) && range.isHittable)
        range.tap()
        tapContextAction("已暂存", in: app)
        XCTAssertTrue(review.waitForExistence(timeout: 15)); review.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "BASE")).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "STAGED")).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "WORKTREE")).firstMatch.waitForNonExistence(timeout: 15))
        capture(app, name: "files-staged")
    }

    func testIPadHiddenSidebarRevealRestoresTarget() throws {
        let app = openPreparedTerminal()
        openFiles(in: app)
        let nested = browserEntry("files-entry-nested", in: app)
        reveal(nested, in: app)
        XCTAssertTrue(nested.waitForExistence(timeout: 15)); nested.tap()
        let notes = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(notes.waitForExistence(timeout: 15)); notes.tap()
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.waitForExistence(timeout: 15))
        let navigation = XCTAttachment(string: app.navigationBars.debugDescription)
        navigation.name = "files-ipad-navigation"; navigation.lifetime = .keepAlways; add(navigation)
        let hide = app.navigationBars["工作区文件"].buttons.matching(NSPredicate(format:
            "label == 'Hide Sidebar' OR label == 'Toggle Sidebar' OR label == '隐藏边栏' OR label == '切换边栏'")).firstMatch
        XCTAssertTrue(hide.waitForExistence(timeout: 5), "The regular Files split view must expose its native sidebar toggle")
        hide.tap()
        let show = app.buttons.matching(NSPredicate(format:
            "label == 'Show Sidebar' OR label == '显示边栏'")).firstMatch
        XCTAssertTrue(show.waitForExistence(timeout: 5))
        XCTAssertFalse(notes.isHittable, "The system toggle must actually hide the sidebar")
        capture(app, name: "files-ipad-sidebar-hidden")
        app.buttons["files-content-menu"].firstMatch.tap()
        app.buttons["在目录中显示"].firstMatch.tap()
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            notes.exists && notes.isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 15), .completed,
            "Reveal must restore the hidden regular sidebar and expose its real target")
        capture(app, name: "files-ipad-sidebar-restored-by-reveal")
        notes.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format:
            "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.waitForExistence(timeout: 15))
    }

    func testIPadWindowResizePreservesFilesAndDraft() {
        let app = openPreparedTerminal()
        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("窗口草稿 😀")
        openFiles(in: app)
        let nested = browserEntry("files-entry-nested", in: app)
        reveal(nested, in: app)
        XCTAssertTrue(nested.waitForExistence(timeout: 15)); nested.tap()
        let notes = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(notes.waitForExistence(timeout: 15)); notes.tap()
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.waitForExistence(timeout: 15))
        let window = app.windows.firstMatch
        let original = window.frame
        sceneRestoreFrame = original
        captureScreen(name: "files-scene-original-width")
        let dimensions = XCTAttachment(string: "App \(app.frame)\nWindow \(original)")
        dimensions.name = "files-scene-original-frame"; dimensions.lifetime = .keepAlways; add(dimensions)
        // Apple's iPadOS Windowed Apps guide permits resizing from a corner.
        // The coordinate targets that real OS corner, never a file hit target.
        window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
            .withOffset(CGVector(dx: -4, dy: -4))
            .press(forDuration: 0.2,
                thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.65)),
                withVelocity: .slow, thenHoldForDuration: 0.2)
        let resized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            window.frame.width < original.width && app.frame.width < original.width
        }, object: nil)
        captureScreen(name: "files-scene-after-system-corner-drag")
        XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 5), .completed,
            "The system gesture must change the real app scene width")
        let smaller = window.frame
        let changedDimensions = XCTAttachment(string: "App \(app.frame)\nWindow \(smaller)")
        changedDimensions.name = "files-scene-resized-frame"; changedDimensions.lifetime = .keepAlways; add(changedDimensions)
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.isHittable)
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format:
            "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.exists)
        let back = app.navigationBars.buttons["工作区文件"].firstMatch
        XCTAssertTrue(back.exists && back.isHittable, "The narrow scene must expose the collapsed split view's Back action")
        back.tap()
        let search = searchInput(in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("notes\n")
        let result = browserEntry("files-search-result-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(result.waitForExistence(timeout: 15)); reveal(result, in: app)
        XCTAssertTrue(result.isHittable); result.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format:
            "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["files-content-menu"].firstMatch.tap()
        app.buttons["在目录中显示"].firstMatch.tap()
        let located = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in notes.exists && notes.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [located], timeout: 15), .completed)
        XCTAssertTrue(["", "搜索文件"].contains(searchInput(in: app).value as? String ?? ""))
        notes.tap()
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.waitForExistence(timeout: 5))
        captureScreen(name: "files-scene-narrow-search-reveal")
        window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
            .withOffset(CGVector(dx: -4, dy: -4))
            .press(forDuration: 0.2,
                thenDragTo: window.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: original.width * 0.7, dy: original.height * 0.7)),
                withVelocity: .slow, thenHoldForDuration: 0.2)
        let middle = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            window.frame.width > smaller.width && window.frame.width < original.width
                && app.frame.width > smaller.width && app.frame.width < original.width
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [middle], timeout: 5), .completed)
        let middleDimensions = XCTAttachment(string: "App \(app.frame)\nWindow \(window.frame)")
        middleDimensions.name = "files-scene-middle-frame"; middleDimensions.lifetime = .keepAlways; add(middleDimensions)
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.isHittable)
        captureScreen(name: "files-scene-middle-width")
        restoreSceneWindow(in: app, to: original)
        captureScreen(name: "files-scene-restored-width")
        app.buttons["files-detail-close"].firstMatch.tap()
        XCTAssertTrue(app.buttons["files-close"].waitForNonExistence(timeout: 15))
        XCTAssertEqual(app.textFields.firstMatch.value as? String, "窗口草稿 😀")
        XCTAssertFalse(app.keyboards.firstMatch.exists)
    }

    /// Also runs with the Simulator's actual largest accessibility category and
    /// dark appearance. Scrolling and activation prove a result below controls
    /// remains reachable; an audit's temporary font cycle alone cannot do that.
    func testSearchResultScrollAndPreview() throws {
        let app = openPreparedTerminal()
        openFiles(in: app)
        expandSheet(in: app)
        let search = searchInput(in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("notes\n")
        let result = browserEntry("files-search-result-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        reveal(result, in: app)
        XCTAssertTrue(result.isHittable)
        XCTAssertTrue(result.label.contains("目录，nested"))
        capture(app, name: "files-search-scrolled-to-result")
        result.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format:
            "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.waitForExistence(timeout: 15))
        capture(app, name: "files-search-reachable-preview")
        let menu = app.buttons["files-content-menu"].firstMatch
        let close = app.buttons["files-detail-close"].firstMatch
        XCTAssertTrue(menu.exists && menu.isHittable)
        XCTAssertTrue(close.exists && close.isHittable)
        try audit(app)
        menu.tap(); app.buttons["在目录中显示"].firstMatch.tap()
        let notes = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        let revealed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            notes.exists && notes.isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [revealed], timeout: 15), .completed)
        XCTAssertTrue(["", "搜索文件"].contains(searchInput(in: app).value as? String ?? ""))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture(app, name: "files-search-reachable-reveal")
    }

    func testComposerReferencePreservesDraftAndDoesNotSend() {
        let app = openPreparedTerminal()
        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("保留草稿")
        app.buttons["terminal-expand-input"].firstMatch.tap()
        let editor = app.textViews["terminal-expanded-input"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); editor.typeText(" 😀扩展输入")
        app.buttons["terminal-expanded-close"].firstMatch.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "保留草稿 😀扩展输入")
        app.buttons["attach"].firstMatch.tap()
        app.buttons["terminal-attach-workspace-files"].firstMatch.tap()
        let directory = browserEntry("files-entry-nested", in: app)
        expandSheet(in: app)
        let rootReference = app.buttons["files-root-reference"].firstMatch
        XCTAssertTrue(rootReference.waitForExistence(timeout: 15))
        if !rootReference.isHittable { reveal(rootReference, in: app, towardStart: true) }
        XCTAssertTrue(rootReference.isHittable,
            "The insertion action must remain reachable in the header or accessibility rows")
        capture(app, name: "files-root")
        checkLastFile(in: app)
        checkLongTitle(in: app)
        reveal(directory, in: app, towardStart: true)
        XCTAssertTrue(directory.waitForExistence(timeout: 15)); directory.tap()
        capture(app, name: "files-reference-tree")
        let notes = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        reveal(notes, in: app)
        XCTAssertTrue(notes.waitForExistence(timeout: 15)); notes.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "UTF-8 中文 😀")).firstMatch.waitForExistence(timeout: 15))
        let actions = app.buttons["files-content-menu"].firstMatch
        XCTAssertTrue(actions.waitForExistence(timeout: 15))
        capture(app, name: "files-reference-preview")
        actions.tap()
        app.buttons["插入到输入框"].firstMatch.tap()
        XCTAssertTrue(app.buttons["files-close"].waitForNonExistence(timeout: 15))
        let filled = app.textFields.firstMatch
        XCTAssertTrue(filled.waitForExistence(timeout: 5))
        XCTAssertTrue((filled.value as? String)?.hasPrefix("保留草稿 😀扩展输入 ") == true)
        XCTAssertTrue((filled.value as? String)?.contains("nested/notes.txt") == true)
        XCTAssertTrue(app.buttons["更多"].firstMatch.exists, "Closing Files must restore the terminal accessibility controls")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Reference insertion must not request keyboard focus")
        capture(app, name: "files-reference-draft")

        let draftWithReference = filled.value as? String ?? ""
        app.buttons["attach"].firstMatch.tap()
        app.buttons["terminal-attach-workspace-files"].firstMatch.tap()
        expandSheet(in: app)
        let secondDirectory = browserEntry("files-entry-nested", in: app)
        reveal(secondDirectory, in: app)
        XCTAssertTrue(secondDirectory.waitForExistence(timeout: 15)); secondDirectory.tap()
        let contextFile = browserEntry("files-entry-nested/notes.txt", in: app, file: true)
        XCTAssertTrue(contextFile.waitForExistence(timeout: 15))
        reveal(contextFile, in: app)
        contextFile.press(forDuration: 1)
        capture(app, name: "files-tree-context-reference-menu")
        tapContextAction("插入到输入框", in: app)
        XCTAssertTrue(app.buttons["files-close"].waitForNonExistence(timeout: 15))
        let twiceFilled = app.textFields.firstMatch
        XCTAssertTrue(twiceFilled.waitForExistence(timeout: 5))
        let twiceValue = twiceFilled.value as? String ?? ""
        XCTAssertTrue(twiceValue.hasPrefix(draftWithReference), "Context insertion must preserve the complete existing draft")
        XCTAssertEqual(twiceValue.components(separatedBy: "nested/notes.txt").count, 3)
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Context insertion must not request keyboard focus")
        capture(app, name: "files-context-reference-draft")
    }

    func testPagedDirectoryBoundaryAndRevealLoadsThirdPage() throws {
        let app = openPreparedTerminal()
        openFiles(in: app)
        expandSheet(in: app)
        let nested = browserEntry("files-entry-nested", in: app)
        reveal(nested, in: app)
        nested.tap()
        let directory = browserEntry("files-entry-nested/paging", in: app)
        XCTAssertTrue(directory.waitForExistence(timeout: 15))
        reveal(directory, in: app)
        directory.tap()
        let more = app.buttons["files-directory-next-nested/paging"].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15))
        reveal(more, in: app)
        more.tap()

        let boundary = searchAndReveal("page-0098", in: app)
        XCTAssertTrue(boundary.isHittable)
        let preceding = browserEntry("files-entry-nested/paging/page-0097.txt", in: app, file: true)
        reveal(preceding, in: app, towardStart: true)
        capture(app, name: "files-boundary-visible-position")
        XCTAssertTrue(preceding.isHittable, "The preceding adjacent file must remain reachable by scrolling")
        capture(app, name: "files-adjacent-preceding-row")
        reveal(boundary, in: app)
        XCTAssertTrue(boundary.isHittable, "The next adjacent file must remain reachable by scrolling")
        capture(app, name: "files-adjacent-boundary")
        try audit(app)
        capture(app, name: "files-boundary-after-font-audit")
        XCTAssertTrue(boundary.isHittable, "Font changes must preserve the revealed file's viewport position")

        let secondPage = searchAndReveal("page-0100", in: app)
        XCTAssertTrue(secondPage.isHittable, "The second wire page must remain reachable")
        capture(app, name: "files-directory-second-page-revealed")

        // The complete audit and AX snapshots can exceed the documented
        // 60-second idle cursor lifetime. Continue with an explicit user refresh.
        let refresh = app.buttons["files-refresh"].firstMatch
        XCTAssertTrue(refresh.exists && refresh.isHittable)
        refresh.tap()
        let refreshed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            refresh.exists && refresh.isEnabled && self.browserEntry("files-entry-nested", in: app).exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [refreshed], timeout: 15), .completed)
        capture(app, name: "files-directory-explicit-refresh")

        let last = searchAndReveal("page-0204", in: app)
        XCTAssertTrue(last.isHittable, "Reveal must fetch the real third directory page and scroll to its target")
        capture(app, name: "files-directory-third-page-revealed")
        last.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "分页验收 0204")).firstMatch.waitForExistence(timeout: 15))
        capture(app, name: "files-directory-third-page-preview")

        let back = app.navigationBars.buttons["工作区文件"].firstMatch
        if back.exists { back.tap() }
        let another = browserEntry("files-entry-nested/paging/page-0160.txt", in: app, file: true)
        reveal(another, in: app, towardStart: true)
        XCTAssertTrue(another.exists && another.isHittable)
        XCTAssertFalse(last.isHittable, "User scrolling must be allowed to leave the previous revealed file")
        another.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "分页验收 0160")).firstMatch.waitForExistence(timeout: 15))
        if back.exists { back.tap() }
        XCTAssertTrue(another.isHittable, "Back after selecting a new file must retain its tree position")
        XCTAssertFalse(last.isHittable, "Back must not replay a completed reveal for an older file")
        capture(app, name: "files-new-selection-back-position")
    }

    private func searchAndReveal(_ stem: String, in app: XCUIApplication) -> XCUIElement {
        let search = searchInput(in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText(stem)
        let submit = app.buttons["files-search-submit"].firstMatch
        if submit.exists { submit.tap() } else { search.typeText("\n") }
        let path = "nested/paging/\(stem).txt"
        let result = browserEntry("files-search-result-\(path)", in: app, file: true)
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        XCTAssertTrue(result.label.contains("目录，paging"))
        result.tap()
        XCTAssertTrue(app.buttons["files-content-menu"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["files-content-menu"].firstMatch.tap()
        app.buttons["在目录中显示"].firstMatch.tap()
        let target = browserEntry("files-entry-\(path)", in: app, file: true)
        XCTAssertTrue(target.waitForExistence(timeout: 15))
        capture(app, name: "files-located-\(stem)-before-hit-check")
        return target
    }

    private func openPreparedTerminal() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", environment["SYNAPSE_TEST_BASE_URL"]!,
            "-terminal.inputBar.voiceMode", "NO"]
        app.launch()
        let tabs = app.tabBars.firstMatch
        let home = app.buttons["home-feature-云盘"].firstMatch
        let email = app.textFields["邮箱"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in home.exists || email.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
        if !home.exists {
            email.tap(); email.typeText(environment["SYNAPSE_TEST_EMAIL"]!)
            app.secureTextFields.firstMatch.tap()
            app.secureTextFields.firstMatch.typeText(environment["SYNAPSE_TEST_PASSWORD"]!)
            app.buttons["登录"].firstMatch.tap()
        }
        XCTAssertTrue(home.waitForExistence(timeout: 25))
        let terminalList = app.buttons["new-session"].firstMatch
        for _ in 0..<3 {
            dismissSavePasswordPrompt(in: app)
            if tabs.exists { tabs.buttons.element(boundBy: 1).tap() }
            else { app.buttons["终端"].firstMatch.tap() }
            if terminalList.waitForExistence(timeout: 3) { break }
        }
        XCTAssertTrue(terminalList.exists, "Terminal tab must become the active native navigation")
        if let name = environment["SYNAPSE_TEST_DESKTOP_NAME"], app.buttons["switch-computer"].exists,
           !app.buttons["switch-computer"].label.contains(name) {
            app.buttons["switch-computer"].tap()
            let option = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'switch-computer-option-' AND label CONTAINS %@", name)).firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 10)); option.tap()
        }
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", sessionTitle)).firstMatch
        let title = app.staticTexts[sessionTitle].firstMatch
        let rowReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in row.exists || title.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [rowReady], timeout: 25), .completed, "Desktop must provide the prepared real fixture terminal")
        if row.exists { row.tap() } else { title.tap() }
        XCTAssertTrue(app.descendants(matching: .any)["terminal.text"].waitForExistence(timeout: 20))
        return app
    }

    private func dismissSavePasswordPrompt(in app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // The iOS 26 password prompt is presented by the runtime's SafariViewService.
        let passwordPrompt = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        for candidate in [app, springboard, passwordPrompt] where candidate.state == .runningForeground {
            for title in ["以后", "Not Now", "Later"] where candidate.buttons[title].exists { candidate.buttons[title].tap(); return }
        }
    }

    private func openFiles(in app: XCUIApplication) {
        app.buttons["更多"].firstMatch.tap()
        let entry = app.buttons["terminal-menu-workspace-files"].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        XCTAssertTrue(app.buttons["files-close"].firstMatch.waitForExistence(timeout: 15))
    }

    private func expandSheet(in app: XCUIApplication) {
        XCTAssertTrue(app.buttons["files-close"].firstMatch.waitForExistence(timeout: 15))
        let toggle = app.buttons["files-detent-toggle"].firstMatch
        if toggle.exists, toggle.label == "展开面板" { toggle.tap() }
    }

    private func checkLastFile(in app: XCUIApplication) {
        let last = browserEntry("files-entry-review.txt", in: app, file: true)
        reveal(last, in: app)
        XCTAssertTrue(last.exists && last.isHittable)
        capture(app, name: "files-last-row")
        let search = searchInput(in: app)
        if search.exists, search.frame.midY > app.frame.midY {
            XCTAssertLessThanOrEqual(contentFrame(last).maxY, search.frame.minY,
                "The last file's full visible name and icon must scroll above the native floating search")
        }
        last.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "WORKTREE")).firstMatch.waitForExistence(timeout: 15))
        capture(app, name: "files-last-file-preview")
        let back = app.navigationBars.buttons["工作区文件"].firstMatch
        if back.exists { back.tap() }
    }

    private func checkLongTitle(in app: XCUIApplication) {
        let name = "0-这是用于验证最大动态字号和关闭菜单可达性的很长中文文件名称.txt"
        let file = browserEntry("files-entry-\(name)", in: app, file: true)
        reveal(file, in: app, towardStart: true)
        XCTAssertTrue(file.exists && file.isHittable)
        file.tap()
        XCTAssertTrue(content(in: app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "长标题预览")).firstMatch.waitForExistence(timeout: 15))
        let menu = app.buttons["files-content-menu"].firstMatch
        let close = app.buttons["files-detail-close"].firstMatch
        XCTAssertTrue(menu.exists && menu.isHittable)
        XCTAssertTrue(close.exists && close.isHittable)
        capture(app, name: "files-long-title")
        let back = app.navigationBars.buttons["工作区文件"].firstMatch
        if back.exists { back.tap() }
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, towardStart: Bool = false) {
        let browser = app.descendants(matching: .any)["files-browser"].firstMatch
        for _ in 0..<16 {
            let viewport = browser.frame
            let navigation = app.navigationBars["工作区文件"].firstMatch
            var top = navigation.exists ? max(viewport.minY, navigation.frame.maxY) : viewport.minY
            var bottom = viewport.maxY - 16
            let search = searchInput(in: app)
            if search.exists {
                if search.frame.midY > viewport.midY { bottom = min(bottom, search.frame.minY) }
                else { top = max(top, search.frame.maxY) }
            }
            if element.exists && element.isHittable {
                let bounds = contentFrame(element)
                if bounds.minY >= top, bounds.maxY <= bottom { return }
            }
            if element.exists {
                let bounds = contentFrame(element)
                guard bounds.width > 0, bounds.height > 0 else {
                    if towardStart { browser.swipeDown() } else { browser.swipeUp() }
                    continue
                }
                if bounds.minY >= top, bounds.maxY <= bottom {
                    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in element.isHittable }, object: nil)
                    _ = XCTWaiter.wait(for: [ready], timeout: 2)
                    return
                }
                let distance = bounds.minY < top ? top - bounds.minY + bounds.height / 2 : bottom - bounds.maxY - bounds.height / 2
                let limit = (bottom - top) * 0.4
                let delta = max(-limit, min(limit, distance))
                let centerY = (top + bottom) / 2
                let center = browser.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: viewport.width / 2, dy: centerY - viewport.minY))
                let destination = center.withOffset(CGVector(dx: 0, dy: delta))
                center.press(forDuration: 0.05,
                    thenDragTo: destination,
                    withVelocity: .slow, thenHoldForDuration: 0.1)
            } else if towardStart { browser.swipeDown() }
            else { browser.swipeUp() }
        }
    }

    private func contentFrame(_ element: XCUIElement) -> CGRect {
        // Check the actual primary control's complete bounds.
        element.frame
    }

    private func browserEntry(_ identifier: String, in app: XCUIApplication, file _: Bool = false) -> XCUIElement {
        // Native cells own touch actions. Directories expose their independent
        // semantic primary button alongside the accessory menu.
        let cell = app.tables["files-browser"].cells[identifier].firstMatch
        return cell.buttons[identifier].firstMatch
    }

    private func tapContextAction(_ title: String, in app: XCUIApplication) {
        let button = app.buttons[title].firstMatch
        let item = app.menuItems[title].firstMatch
        let appeared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            button.exists || item.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [appeared], timeout: 5), .completed)
        let action = button.exists ? button : item
        XCTAssertTrue(action.isHittable)
        action.tap()
    }

    private func content(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["files-content"].firstMatch
    }

    private func searchInput(in app: XCUIApplication) -> XCUIElement {
        // UISearchTextField and UITextField can have different native element
        // types; the stable identifier selects the actual editable control.
        app.descendants(matching: .any)["files-search"].firstMatch
    }

    private func selectFileView(_ title: String, in app: XCUIApplication) {
        let control = app.descendants(matching: .any)["files-tabs"].firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 5))
        if !control.isHittable { reveal(control, in: app, towardStart: true) }
        XCTAssertTrue(control.isHittable)
        let segmented = app.segmentedControls["files-tabs"].firstMatch
        if segmented.exists {
            let option = segmented.buttons[title].firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 5) && option.isHittable)
            option.tap()
        } else {
            // Accessibility text sizes use the same choices in a native menu.
            control.tap()
            tapContextAction(title, in: app)
        }
    }

    private func audit(_ app: XCUIApplication) throws {
        let coveredTerminal = app.buttons["更多"].firstMatch
        XCTAssertFalse(coveredTerminal.exists && coveredTerminal.isHittable,
            "The modal Files sheet must prevent activating its covered terminal controls")
        // Apple's WWDC23 audit guidance recommends collecting every failure.
        // Scope this to the audit; functional steps keep fail-fast behavior.
        let priorContinueAfterFailure = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = priorContinueAfterFailure }
        var issueIndex = 0
        try app.performAccessibilityAudit { issue in
            issueIndex += 1
            let element = issue.element
            let location = element.map { "Label: \($0.label)\nFrame: \($0.frame)" } ?? "No element"
            let details = "\(issue.compactDescription)\n\(issue.detailedDescription)\n\(location)"
            let attachment = XCTAttachment(string: details)
            attachment.name = "accessibility-issue"
            attachment.lifetime = .keepAlways
            self.add(attachment)
            if element == nil {
                self.capture(app, name: "accessibility-unlocated-\(issue.auditType)-\(issueIndex)")
            }
            return false // Keep every issue as a test failure; no audit filters.
        }
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func captureScreen(name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func restoreSceneWindow(in app: XCUIApplication, to target: CGRect) {
        let window = app.windows.firstMatch
        if window.frame.size != target.size {
            // Restore the scene through its system corner handle. Both endpoints
            // come from this application's real window frames, never the runner's
            // UIScreen or the Simulator's canvas scale.
            let current = window.frame
            window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
                .withOffset(CGVector(dx: -4, dy: -4))
                .press(forDuration: 0.2,
                    thenDragTo: window.coordinate(withNormalizedOffset: .zero)
                        .withOffset(CGVector(dx: target.maxX - current.minX - 4,
                            dy: target.maxY - current.minY - 4)),
                    withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            window.frame.size == target.size && app.frame.size == target.size
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 5), .completed,
            "The real app scene must return to its original screen size")
    }
}
