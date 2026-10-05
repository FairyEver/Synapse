import XCTest

/// Opt-in, read-only acceptance using an existing recording and a real iPad window.
final class IPadAdaptiveNavigationUITests: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment
    private var originalFrame: CGRect?

    override func setUpWithError() throws {
        try super.setUpWithError()
        try XCTSkipIf(environment["SYNAPSE_IPAD_REVIEW"] != "1"
            || ["SYNAPSE_TEST_EMAIL", "SYNAPSE_TEST_PASSWORD", "SYNAPSE_TEST_BASE_URL"]
                .contains { environment[$0]?.isEmpty != false }, "Configured iPad review is required")
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .pad, "A resizable iPad window is required")
        guard #available(iOS 26.0, *) else { throw XCTSkip("Windowed Apps requires iPadOS 26") }
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        addUIInterruptionMonitor(withDescription: "System password prompt") { alert in
            for title in ["以后", "Not Now", "Later"] where alert.buttons[title].exists {
                alert.buttons[title].tap(); return true
            }
            return false
        }
    }

    override func tearDownWithError() throws {
        if let originalFrame {
            let app = XCUIApplication()
            if app.state == .runningForeground { restoreWindow(app, to: originalFrame) }
            self.originalFrame = nil
        }
        try super.tearDownWithError()
    }

    func testRecordingSurvivesWindowResizeAndReopensAfterBack() {
        let app = openRecordings()
        let recording = app.cells.buttons.firstMatch
        XCTAssertTrue(recording.waitForExistence(timeout: 19) && recording.isHittable,
            "The authenticated account must provide a real existing recording")
        let rowLabel = recording.label
        XCTAssertFalse(rowLabel.isEmpty)
        recording.tap()

        let menu = app.descendants(matching: .any)["recording-menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 19) && menu.isHittable)
        let audio = app.segmentedControls.buttons["语音"].firstMatch
        XCTAssertTrue(audio.waitForExistence(timeout: 5) && audio.isHittable)
        audio.tap()
        let progress = app.descendants(matching: .any)["playback-waveform"].firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 19) && progress.isHittable)
        XCTAssertEqual(progress.label, "播放进度")
        let bar = app.navigationBars.containing(.any, identifier: "recording-menu").firstMatch
        let pickerFrame = app.segmentedControls.firstMatch.frame
        // The body owns the recording name; the native navigation title is "录音".
        let header = app.staticTexts.allElementsBoundByIndex.filter { text in
            text.isHittable && text.frame.minY >= bar.frame.maxY
                && text.frame.maxY <= pickerFrame.minY
                && text.frame.midX >= pickerFrame.minX && text.frame.midX <= pickerFrame.maxX
                && !text.label.isEmpty && rowLabel.contains(text.label)
        }.min { $0.frame.minY < $1.frame.minY }
        guard let header else { XCTFail("The selected recording must show its actual name above its content picker"); return }
        let recordingTitle = header.label

        capture(app, name: "recording-window-wide")
        let original = resizeWindow(app)
        XCTAssertTrue(menu.exists && menu.isHittable)
        XCTAssertTrue(app.staticTexts[recordingTitle].firstMatch.exists)
        XCTAssertTrue(progress.exists && progress.isHittable)
        capture(app, name: "recording-window-narrow")

        let back = app.navigationBars.buttons["录音"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5) && back.isHittable,
            "The narrow split view must expose its native recording-list Back action")
        back.tap()
        XCTAssertTrue(menu.waitForNonExistence(timeout: 5))
        let sameRecording = app.cells.buttons.matching(NSPredicate(format: "label == %@", rowLabel)).firstMatch
        XCTAssertTrue(sameRecording.waitForExistence(timeout: 19) && sameRecording.isHittable)
        sameRecording.tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 19) && menu.isHittable,
            "Back must release the selection so tapping the same recording opens its detail again")
        XCTAssertTrue(app.staticTexts[recordingTitle].firstMatch.exists)
        XCTAssertTrue(progress.waitForExistence(timeout: 19) && progress.isHittable)
        capture(app, name: "recording-window-same-item-reopened")

        restoreWindow(app, to: original)
        originalFrame = nil
        XCTAssertTrue(menu.exists && menu.isHittable)
        XCTAssertTrue(app.staticTexts[recordingTitle].firstMatch.exists)
        XCTAssertTrue(progress.exists && progress.isHittable)
        capture(app, name: "recording-window-restored")
    }

    /// Run with the system's largest accessibility text size so Home uses its native overflow.
    func testHomeOverflowNotificationHasAnIntelligibleNativeLabel() {
        let app = openHome()
        let more = app.navigationBars.buttons.matching(
            NSPredicate(format: "label IN %@", ["更多", "More"])
        ).firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 19) && more.isHittable,
            "Home must expose its real system toolbar overflow at the configured accessibility size")
        more.tap()
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "home-overflow-native-accessibility"; tree.lifetime = .keepAlways; add(tree)
        capture(app, name: "home-overflow-native")
        let identified = app.buttons["home-notifications"].firstMatch
        let notification = identified.exists ? identified
            : app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "通知")).firstMatch
        XCTAssertTrue(notification.waitForExistence(timeout: 5) && notification.isHittable,
            "The native overflow must contain a readable notification action")
        XCTAssertTrue(notification.label.contains("通知"),
            "A notification action cannot expose only its unread count as its native accessibility label")
        notification.tap()
        XCTAssertTrue(app.navigationBars["通知"].firstMatch.waitForExistence(timeout: 5))
    }

    /// The fixture's clipboard is already empty; this test never clears or copies its data.
    func testEmptyClipboardHeaderAndStateStayVisibleInARealNarrowWindow() {
        let app = openHome()
        let clipboard = app.buttons["home-feature-剪贴板历史"].firstMatch
        XCTAssertTrue(clipboard.waitForExistence(timeout: 5) && clipboard.isHittable)
        clipboard.tap()
        let empty = app.staticTexts["clipboard-empty"].firstMatch
        let title = app.staticTexts["还没有可粘贴的内容"].firstMatch
        XCTAssertTrue(empty.waitForExistence(timeout: 19) && title.exists,
            "The current fixture computer must provide the genuine empty clipboard state")
        let navigationBar = app.navigationBars["剪贴板历史"].firstMatch
        let header = app.staticTexts.allElementsBoundByIndex.first { text in
            text.isHittable && !text.label.isEmpty && text.label != empty.label
                && text.label != title.label && text.frame.minY >= navigationBar.frame.maxY
                && text.frame.maxY <= title.frame.minY
        }
        guard let header else { XCTFail("The empty list must still identify its actual computer in its section header"); return }
        let desktopName = header.label
        capture(app, name: "clipboard-empty-window-wide")
        let original = resizeWindow(app)
        let narrowHeader = app.staticTexts[desktopName].firstMatch
        XCTAssertTrue(narrowHeader.exists && narrowHeader.isHittable)
        XCTAssertFalse(narrowHeader.frame.intersects(title.frame))
        XCTAssertFalse(narrowHeader.frame.intersects(empty.frame))
        XCTAssertTrue(app.buttons["clipboard-clear"].exists)
        XCTAssertFalse(app.buttons["clipboard-clear"].isEnabled)
        capture(app, name: "clipboard-empty-window-narrow")
        let list = app.tables.firstMatch.exists ? app.tables.firstMatch : app.collectionViews.firstMatch
        XCTAssertTrue(list.exists, "The empty clipboard must remain in its native scrollable list")
        for (index, target) in [title, empty].enumerated() {
            for _ in 0..<3 where !(target.exists && target.isHittable) { list.swipeUp() }
            XCTAssertTrue(target.exists && target.isHittable,
                "The necessary empty state must be reachable by scrolling at the real narrow window size")
            capture(app, name: index == 0 ? "clipboard-empty-window-narrow-title" : "clipboard-empty-window-narrow-description")
        }
        restoreWindow(app, to: original)
        originalFrame = nil
        for _ in 0..<3 where !(narrowHeader.exists && narrowHeader.isHittable) { list.swipeDown() }
        XCTAssertTrue(narrowHeader.exists && narrowHeader.isHittable)
        XCTAssertTrue(title.exists && title.isHittable && empty.exists && empty.isHittable)
        capture(app, name: "clipboard-empty-window-restored")
    }

    /// The supplied folder must have been created by this review. No rename or move is submitted.
    func testReviewOwnedDriveFolderContextInfoRenameAndMoveCancel() throws {
        guard let name = environment["SYNAPSE_DRIVE_REVIEW_OWN_FOLDER"],
              name.hasPrefix("iOSReview-"), name.count > "iOSReview-".count else {
            throw XCTSkip("An explicitly owned review folder is required")
        }
        let app = openHome()
        let drive = app.buttons["home-feature-云盘"].firstMatch
        XCTAssertTrue(drive.waitForExistence(timeout: 15) && drive.isHittable)
        drive.tap()
        // Use the native list for mutation-context verification; grid rendering is covered
        // by the read-only navigation matrix, while list rows give the long-press target
        // an unambiguous native hit region at XXXL text.
        driveMenuPath(["显示方式", "列表"], in: app)
        func ownedFolder() -> XCUIElement {
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name + ", ")).firstMatch
        }
        let folderQuery = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name + ", "))
        let folder = ownedFolder()
        XCTAssertTrue(folder.waitForExistence(timeout: 15))
        XCTAssertEqual(folderQuery.count, 1, "Only the explicitly owned folder may be inspected")
        revealReviewElement(folder, in: app, fullyVisible: true)
        XCTAssertTrue(folder.isHittable)

        openOwnedDriveContext(folder, action: "显示简介", in: app)
        XCTAssertTrue(app.navigationBars["简介"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts[name].firstMatch.exists,
            "The real information sheet must expose the folder's complete name")
        capture(app, name: "drive-owned-folder-info")
        let close = app.navigationBars.buttons["关闭"].firstMatch
        XCTAssertTrue(close.exists && close.isHittable)
        close.tap()
        XCTAssertTrue(app.navigationBars["简介"].firstMatch.waitForNonExistence(timeout: 5))

        let renameFolder = ownedFolder()
        revealReviewElement(renameFolder, in: app, fullyVisible: true)
        XCTAssertTrue(renameFolder.label.hasPrefix(name + ", "))
        openOwnedDriveContext(renameFolder, action: "重命名", in: app)
        let field = app.textFields["drive-rename-field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10) && field.isHittable)
        XCTAssertEqual(field.value as? String, name)
        capture(app, name: "drive-owned-folder-rename-cancel")
        let renameCancel = app.navigationBars.buttons["取消"].firstMatch
        XCTAssertTrue(renameCancel.exists && renameCancel.isHittable)
        renameCancel.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        let movedFolder = ownedFolder()
        revealReviewElement(movedFolder, in: app, fullyVisible: true)
        XCTAssertTrue(movedFolder.exists && movedFolder.isHittable)

        openOwnedDriveContext(movedFolder, action: "移动到", in: app)
        XCTAssertTrue(app.navigationBars["移动到"].firstMatch.waitForExistence(timeout: 10))
        let confirm = app.buttons["移到这一层"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10) && confirm.isHittable)
        capture(app, name: "drive-owned-folder-move-cancel")
        let moveCancel = app.navigationBars.buttons["取消"].firstMatch
        XCTAssertTrue(moveCancel.exists && moveCancel.isHittable)
        moveCancel.tap()
        XCTAssertTrue(app.navigationBars["移动到"].firstMatch.waitForNonExistence(timeout: 5))
        let finalFolder = ownedFolder()
        revealReviewElement(finalFolder, in: app, fullyVisible: true)
        XCTAssertTrue(finalFolder.exists && finalFolder.isHittable,
            "Cancel must keep the owned folder in its original directory")
        capture(app, name: "drive-owned-folder-context-cancelled")
        let home = app.buttons["drive-browser-back-home"].firstMatch
        XCTAssertTrue(home.exists && home.isHittable)
        home.tap()
        XCTAssertTrue(drive.waitForExistence(timeout: 15))
    }

    /// Existing data is only read. Display/sort preferences are restored through their real menus.
    func testReadOnlyCloudCoreEntrypointsAndDocumentPickerCancel() throws {
        guard let folderName = environment["SYNAPSE_DRIVE_REVIEW_READONLY_FOLDER"],
              !folderName.isEmpty, !folderName.hasPrefix("iOSReview-") else {
            throw XCTSkip("An explicitly identified existing read-only folder is required")
        }
        let app = openHome()
        tapReview(app.buttons["home-feature-云盘"].firstMatch)
        let root = app.buttons["drive-browser-back-home"].firstMatch
        XCTAssertTrue(root.waitForExistence(timeout: 19) && root.isHittable)
        let header = app.staticTexts.matching(NSPredicate(
            format: "label MATCHES %@", "^[0-9]+ 项 · 按(名称|日期|大小|种类)(升序|降序)$"
        )).firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 19))
        let originalHeader = header.label
        let originalKey = try XCTUnwrap(["名称", "日期", "大小", "种类"].first {
            originalHeader.contains("按" + $0)
        })
        let originalDirection = originalHeader.hasSuffix("升序") ? "升序" : "降序"
        let grid = app.buttons.matching(identifier: "drive-browser-grid-cell")
        let originallyGrid = grid.firstMatch.exists
        captureReviewState(app, name: "cloud-core-root")
        driveMenuPath(["显示方式", "列表"], in: app)
        XCTAssertTrue(grid.firstMatch.waitForNonExistence(timeout: 5))

        let folder = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", folderName + ", "))
        revealReviewElement(folder.firstMatch, in: app)
        XCTAssertEqual(folder.count, 1, "The configured existing folder must identify one real row")
        tapReview(folder.firstMatch)
        XCTAssertTrue(app.navigationBars[folderName].firstMatch.waitForExistence(timeout: 19))
        captureReviewState(app, name: "cloud-core-existing-folder")
        returnToDriveRoot(app)
        revealReviewElement(header, in: app, upward: false)
        XCTAssertEqual(header.label, originalHeader)

        driveMenuPath(["显示方式", "网格"], in: app)
        XCTAssertTrue(grid.firstMatch.waitForExistence(timeout: 5) && grid.firstMatch.isHittable)
        captureReviewState(app, name: "cloud-core-grid")
        driveMenuPath(["显示方式", "列表"], in: app)
        XCTAssertTrue(grid.firstMatch.waitForNonExistence(timeout: 5))
        captureReviewState(app, name: "cloud-core-list")

        tapReview(app.navigationBars.buttons["更多"].firstMatch)
        tapReview(app.buttons["排序方式"].firstMatch)
        for title in ["名称", "日期", "大小", "种类", "升序", "降序"] {
            XCTAssertTrue(app.buttons[title].firstMatch.waitForExistence(timeout: 5),
                "Every real sort option must be reachable in the menu")
        }
        captureReviewState(app, name: "cloud-core-sort-menu")
        tapReview(app.buttons["日期"].firstMatch)
        revealReviewElement(header, in: app, upward: false)
        XCTAssertTrue(header.label.contains("按日期"))
        driveMenuPath(["排序方式", "降序"], in: app)
        XCTAssertTrue(header.label.hasSuffix("降序"))
        captureReviewState(app, name: "cloud-core-date-descending")
        driveMenuPath(["排序方式", originalKey], in: app)
        driveMenuPath(["排序方式", originalDirection], in: app)
        XCTAssertEqual(header.label, originalHeader, "The original local sort preference must be restored")

        driveMenuPath(["分享管理"], in: app)
        XCTAssertTrue(app.navigationBars["分享管理"].firstMatch.waitForExistence(timeout: 19))
        let share = app.cells.buttons.firstMatch
        let noShares = app.staticTexts["没有进行中的分享"].firstMatch
        reviewWait { share.exists || noShares.exists }
        captureReviewState(app, name: "cloud-core-share-list")
        let missingExistingShare = noShares.exists && !share.exists
        if !missingExistingShare {
            tapReview(share)
            XCTAssertTrue(app.navigationBars["分享"].firstMatch.waitForExistence(timeout: 10))
            XCTAssertTrue(app.staticTexts["链接"].firstMatch.waitForExistence(timeout: 19),
                "The existing share must finish its real read-only lookup")
            XCTAssertTrue(app.buttons["拷贝"].firstMatch.exists && app.buttons["拷贝"].firstMatch.isEnabled)
            captureReviewState(app, name: "cloud-core-existing-share-detail-readonly")
            tapReview(app.navigationBars.buttons["关闭"].firstMatch)
            XCTAssertTrue(app.navigationBars["分享"].firstMatch.waitForNonExistence(timeout: 5))
        }
        returnToDriveRoot(app)

        let publicAssets = app.buttons["公开素材"].firstMatch
        revealReviewElement(publicAssets, in: app)
        tapReview(publicAssets)
        XCTAssertTrue(app.navigationBars["公开素材"].firstMatch.waitForExistence(timeout: 19))
        let visits = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "访问 ")).firstMatch
        let noAssets = app.staticTexts["还没有公开素材"].firstMatch
        reviewWait { visits.exists || noAssets.exists }
        XCTAssertTrue(visits.exists || noAssets.exists,
            "Public assets must show a real loaded row or the genuine empty state")
        captureReviewState(app, name: "cloud-core-public-assets-readonly")
        returnToDriveRoot(app)

        driveMenuPath(["上传文件", "文件"], in: app)
        let files = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")
        let pickerHosts = [app, files]
        let cancelQuery = NSPredicate(format: "label IN %@", ["取消", "Cancel"])
        reviewWait { pickerHosts.contains { $0.navigationBars.buttons.matching(cancelQuery).firstMatch.exists } }
        let pickerHost = try XCTUnwrap(pickerHosts.first {
            $0.navigationBars.buttons.matching(cancelQuery).firstMatch.exists
        })
        let pickerHeading = NSPredicate(format: "label IN %@", ["浏览", "最近项目", "Browse", "Recents"])
        XCTAssertTrue(pickerHost.navigationBars.matching(pickerHeading).firstMatch.exists
            || pickerHost.staticTexts.matching(pickerHeading).firstMatch.exists,
            "The system document browser must actually be presented")
        captureReviewState(app, name: "cloud-core-document-picker-cancel")
        let pickerTree = XCTAttachment(string: pickerHost.debugDescription)
        pickerTree.name = "cloud-core-document-picker-native-accessibility"
        pickerTree.lifetime = .keepAlways; add(pickerTree)
        tapReview(pickerHost.navigationBars.buttons.matching(cancelQuery).firstMatch)
        reviewWait { app.navigationBars.buttons["更多"].firstMatch.isHittable }
        XCTAssertTrue(root.exists && root.isHittable)
        if originallyGrid { driveMenuPath(["显示方式", "网格"], in: app) }
        captureReviewState(app, name: "cloud-core-cancelled-preferences-restored")
        tapReview(root)
        XCTAssertTrue(app.buttons["home-feature-云盘"].firstMatch.waitForExistence(timeout: 19))
        if missingExistingShare {
            throw XCTSkip("Root/folder/display/sort/assets/picker paths ran; no existing active share was available for detail coverage")
        }
    }

    /// Never starts recording or mutates an existing recording; copy feedback is observed in the app.
    func testReadOnlyExistingRecordingAudioTextCopyAndReopen() throws {
        let app = openRecordings()
        let recording = app.cells.buttons.firstMatch
        let empty = app.staticTexts["还没有录音"].firstMatch
        reviewWait { recording.exists || empty.exists }
        captureReviewState(app, name: "meeting-core-existing-list")
        if !recording.exists && empty.exists {
            throw XCTSkip("No existing recording is available; no new recording was created")
        }
        let rowLabel = recording.label
        XCTAssertFalse(rowLabel.isEmpty)
        tapReview(recording)
        let menu = app.descendants(matching: .any)["recording-menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 19) && menu.isHittable)
        tapReview(app.segmentedControls.buttons["语音"].firstMatch)
        let waveform = app.descendants(matching: .any)["playback-waveform"].firstMatch
        XCTAssertTrue(waveform.waitForExistence(timeout: 19) && waveform.isHittable)
        XCTAssertEqual(waveform.label, "播放进度")
        captureReviewState(app, name: "meeting-core-audio")
        tapReview(app.buttons["播放"].firstMatch, timeout: 30)
        tapReview(app.buttons["暂停"].firstMatch)
        XCTAssertTrue(app.buttons["播放"].firstMatch.exists)
        tapReview(app.segmentedControls.buttons["文字"].firstMatch)
        let copy = app.buttons["copy-transcript"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 10) && copy.isEnabled,
            "The selected existing recording must provide real text for this copy path")
        XCTAssertFalse(app.staticTexts["还没有文字"].exists)
        XCTAssertGreaterThan(app.scrollViews.staticTexts.count, 0,
            "The text view must render actual transcript content")
        captureReviewState(app, name: "meeting-core-transcript")
        tapReview(copy)
        // NoticeBar exposes one combined element. Check immediately: success feedback
        // lasts one second, shorter than waitForExistence's first polling interval.
        let copyFeedback = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "已复制全文")
        ).firstMatch
        XCTAssertTrue(copyFeedback.exists || copyFeedback.waitForExistence(timeout: 5))
        captureReviewState(app, name: "meeting-core-copy-feedback")
        tapReview(app.buttons["recordings-back-home"].firstMatch)
        XCTAssertTrue(app.buttons["home-feature-录音"].firstMatch.waitForExistence(timeout: 19))
        tapReview(app.buttons["home-feature-录音"].firstMatch)
        let sameRecording = app.cells.buttons.matching(NSPredicate(format: "label == %@", rowLabel)).firstMatch
        tapReview(sameRecording)
        XCTAssertTrue(menu.waitForExistence(timeout: 19) && menu.isHittable)
        XCTAssertTrue(app.segmentedControls.buttons["文字"].firstMatch.exists)
        captureReviewState(app, name: "meeting-core-same-recording-reopened")
        tapReview(app.buttons["recordings-back-home"].firstMatch)
        XCTAssertTrue(app.buttons["home-feature-录音"].firstMatch.waitForExistence(timeout: 19))
    }

    private func reviewWait(timeout: TimeInterval = 19, _ condition: @escaping () -> Bool) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: timeout), .completed)
    }

    private func tapReview(_ element: XCUIElement, timeout: TimeInterval = 19) {
        reviewWait(timeout: timeout) { element.exists && element.isHittable && element.isEnabled }
        element.tap()
    }

    private func revealReviewElement(_ element: XCUIElement, in app: XCUIApplication, upward: Bool = true,
                                     fullyVisible: Bool = false) {
        let list = app.tables.firstMatch.exists ? app.tables.firstMatch : app.collectionViews.firstMatch
        XCTAssertTrue(list.exists, "A real native list must provide the scrolling surface")
        func revealed() -> Bool {
            guard element.exists && element.isHittable else { return false }
            guard fullyVisible else { return true }
            let viewport = app.windows.firstMatch.frame.insetBy(dx: 0, dy: 90)
            return viewport.contains(element.frame)
        }
        for _ in 0..<8 where !revealed() {
            if upward { list.swipeUp() } else { list.swipeDown() }
        }
        XCTAssertTrue(revealed())
    }

    private func driveMenuPath(_ titles: [String], in app: XCUIApplication) {
        tapReview(app.navigationBars.buttons["更多"].firstMatch)
        for title in titles { tapReview(app.buttons[title].firstMatch) }
    }

    private func returnToDriveRoot(_ app: XCUIApplication) {
        tapReview(app.navigationBars.buttons["云盘"].firstMatch)
        XCTAssertTrue(app.buttons["drive-browser-back-home"].firstMatch.waitForExistence(timeout: 19))
    }

    private func captureReviewState(_ app: XCUIApplication, name: String) {
        capture(app, name: name)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-native-accessibility"; tree.lifetime = .keepAlways; add(tree)
    }

    private func openOwnedDriveContext(_ folder: XCUIElement, action: String, in app: XCUIApplication) {
        XCTAssertTrue(folder.exists && folder.isHittable)
        folder.press(forDuration: 1.2)
        let button = app.buttons[action].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        // At accessibility XXXL the native context menu scrolls; the bottom actions
        // exist outside its viewport. Scroll the actual menu, never the folder list.
        var activeMenu: XCUIElement?
        for _ in 0..<4 where !button.isHittable {
            let candidates = app.scrollViews.containing(.button, identifier: action).allElementsBoundByIndex
                + app.collectionViews.containing(.button, identifier: action).allElementsBoundByIndex
            let menu = candidates.filter { element in
                let frame = element.frame
                return frame.minX.isFinite && frame.minY.isFinite && frame.width.isFinite
                    && frame.height.isFinite && frame.width > 0 && frame.height > 0 && element.isHittable
            }.min { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
            if let menu {
                activeMenu = menu
                menu.swipeUp()
            } else {
                // Build20's real menu exposes Rename in the visible upper portion.
                let visibleAction = app.buttons["重命名"].firstMatch
                XCTAssertTrue(visibleAction.exists && visibleAction.isHittable,
                    "The native context menu must provide a visible scrolling surface")
                visibleAction.swipeUp()
            }
        }
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "drive-owned-folder-context-" + action; tree.lifetime = .keepAlways; add(tree)
        capture(app, name: "drive-owned-folder-context-" + action)
        let scopedAction = activeMenu?.buttons[action].firstMatch
        let visibleAction = scopedAction.flatMap { $0.isHittable ? $0 : nil }
            ?? app.buttons.matching(identifier: action).allElementsBoundByIndex.first { $0.isHittable }
        XCTAssertNotNil(visibleAction, "The requested native context-menu action must be visible")
        visibleAction?.tap()
    }

    private func openRecordings() -> XCUIApplication {
        let app = openHome()
        let home = app.buttons["home-feature-录音"].firstMatch
        let list = app.buttons["new-recording"].firstMatch
        for _ in 0..<2 {
            home.tap()
            if list.waitForExistence(timeout: 3) { break }
        }
        XCTAssertTrue(list.exists && list.isHittable)
        return app
    }

    private func openHome() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SynapseAPIBaseURL", environment["SYNAPSE_TEST_BASE_URL"]!]
        app.launch()
        let home = app.buttons["home-feature-录音"].firstMatch
        let email = app.textFields["邮箱"].firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in home.exists || email.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed)
        if !home.exists {
            for (field, key) in [(email, "SYNAPSE_TEST_EMAIL"), (app.secureTextFields.firstMatch, "SYNAPSE_TEST_PASSWORD")] {
                XCTAssertTrue(field.exists && field.isHittable)
                field.tap(); field.typeText(environment[key]!)
            }
            app.buttons["登录"].firstMatch.tap()
        }
        XCTAssertTrue(home.waitForExistence(timeout: 25))
        return app
    }

    private func resizeWindow(_ app: XCUIApplication) -> CGRect {
        let window = app.windows.firstMatch
        let original = window.frame
        originalFrame = original
        XCTAssertGreaterThan(original.width, 600, "Start the review in a wide iPad window")
        // Same system corner gesture verified by WorkspaceFilesUITests.
        window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
            .withOffset(CGVector(dx: -4, dy: -4))
            .press(forDuration: 0.2,
                thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.65)),
                withVelocity: .slow, thenHoldForDuration: 0.2)
        let resized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            window.frame.width < original.width && app.frame.width < original.width
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 5), .completed,
            "The system gesture must reduce both the window and the app width")
        return original
    }

    private func restoreWindow(_ app: XCUIApplication, to target: CGRect) {
        let window = app.windows.firstMatch
        let current = window.frame
        if current.size != target.size {
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
            "The real window and app must return to their original size")
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let frame = XCTAttachment(string: "App \(app.frame)\nWindow \(app.windows.firstMatch.frame)")
        frame.name = "\(name)-frame"; frame.lifetime = .keepAlways; add(frame)
    }
}
