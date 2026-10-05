import XCTest

/// Opt-in exploration of the actual SpringBoard galleries on a review Simulator.
/// Start Synapse, log in, and select the temporary fixture before running these tests.
/// Missing system elements mean incomplete runtime coverage, not a diagnosed app defect.
final class SystemWidgetControlUITests: XCTestCase {
    private let app = XCUIApplication()
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let environment = ProcessInfo.processInfo.environment
    private var reviewEnabled = false
    private var ownsWidget = false
    private var ownsControl = false
    private var mayOwnRecording = false
    private var fixtureTitle: String { environment["SYNAPSE_FILES_SESSION_TITLE"] ?? "iOS Review Fixture" }
    private var controlCleanupOnly: Bool { environment["SYNAPSE_CONTROL_REVIEW_CLEANUP_ONLY"] == "1" }
    private var widgetCleanupOnly: Bool { environment["SYNAPSE_WIDGET_REVIEW_CLEANUP_ONLY"] == "1" }
    private var cleanupOnly: Bool { controlCleanupOnly || widgetCleanupOnly }

    override func setUpWithError() throws {
        try super.setUpWithError()
        try XCTSkipIf(environment["SYNAPSE_IPAD_REVIEW"] != "1", "Explicit iPad review opt-in is required")
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .pad, "This exploration requires iPad")
        #if !targetEnvironment(simulator)
        throw XCTSkip("Only the review Simulator layout may be changed")
        #endif
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        try require(app.state != .notRunning, "precondition-running-app",
            "Start the authenticated app manually; this test does not launch or log in")
        reviewEnabled = true
        // The coordinator may authorize recovery only after the saved before/add
        // evidence proves the unique current widget/control belongs to this review.
        if cleanupOnly { return }
        app.activate()
        if !app.buttons["home-feature-录音"].firstMatch.exists {
            let recordingsBack = app.buttons["recordings-back-home"].firstMatch
            if recordingsBack.exists && recordingsBack.isHittable {
                recordingsBack.tap()
            } else {
                tapIfPresent(app, labels: ["主页"])
            }
        }
        capture("precondition-app")
        try require(app.buttons["home-feature-录音"].firstMatch.waitForExistence(timeout: 10),
            "precondition-authenticated-home", "Leave the already authenticated app on Home")
    }

    override func tearDownWithError() throws {
        guard reviewEnabled else { try super.tearDownWithError(); return }
        // Cleanup never selects an arbitrary old widget/control. A unique item is
        // removable only after its category had zero candidates before our addition.
        if mayOwnRecording { cancelOwnRecordingIfPresented() }
        if ownsWidget { removeOwnWidgetIfIdentifiable() }
        if ownsControl { removeOwnControlIfIdentifiable() }
        XCUIDevice.shared.press(.home)
        tapIfPresent(springboard, labels: ["完成", "Done"])
        app.activate()
        capture("cleanup-app-restored")
        try super.tearDownWithError()
    }

    func testHomeWidgetGalleryPreviewsAndTemporaryWidget() throws {
        try XCTSkipIf(cleanupOnly, "This invocation is authorized for recovery cleanup only")
        XCUIDevice.shared.press(.home)
        capture("widget-home-before")
        try require(try homeWidgets().isEmpty, "widget-safe-layout-precondition",
            "Use a Home Screen without an existing Synapse widget; old layout items are never removed")
        try holdUnoccupiedHomeBackground()
        try tap(springboard, labels: ["编辑", "Edit"], stage: "widget-home-edit")
        try tap(springboard, labels: ["添加小组件", "Add Widget"], stage: "widget-add-gallery")
        try searchGallery(stage: "widget-search-synapse")
        try tap(springboard, labels: ["Synapse"], stage: "widget-provider")

        var previews: [CGRect] = []
        var previewValues: [String] = []
        for index in 0..<3 {
            let preview = try widgetPreview(stage: "widget-preview-\(index + 1)")
            previews.append(preview.frame)
            previewValues.append(preview.value as? String ?? "")
            capture("widget-preview-\(index + 1)")
            if index < 2 {
                try widgetPreviewPager(containing: preview, stage: "widget-preview-pager-\(index + 1)").swipeLeft()
                capture("widget-preview-swipe-\(index + 1)")
            }
        }
        // Measure real native preview frames rather than infer coverage from source families.
        let small = previews[0], medium = previews[1], large = previews[2]
        let frames = XCTAttachment(string: "small \(small) \(previewValues[0])\nmedium \(medium) \(previewValues[1])\nlarge \(large) \(previewValues[2])")
        frames.name = "widget-observed-preview-frames"; frames.lifetime = .keepAlways; add(frames)
        try require(previewValues[0] == "小组件, 小" && Set(previewValues).count == 3
            && small.width / small.height < 1.25
            && medium.width / medium.height > 1.25
            && large.width / large.height < 1.25
            && medium.width > small.width * 1.35
            && large.height > small.height * 1.35,
            "widget-three-native-sizes", "The observed gallery must expose distinct small, medium, and large previews; inspect the attached frames")

        // Medium opens its displayed session. Return to the actual measured medium preview.
        let largeBeforeReturn = try widgetPreview(stage: "widget-large-before-return")
        try widgetPreviewPager(containing: largeBeforeReturn, stage: "widget-preview-pager-return").swipeRight()
        let mediumAgain = try widgetPreview(stage: "widget-medium-before-add")
        try require(abs(mediumAgain.frame.width - medium.width) < 4
            && abs(mediumAgain.frame.height - medium.height) < 4,
            "widget-medium-selected", "Return to the measured medium preview before adding")
        try tap(springboard, labels: [" 添加小组件", "添加小组件", "Add Widget"], stage: "widget-added")
        ownsWidget = true
        tapIfPresent(springboard, labels: ["完成", "Done"])
        capture("widget-home-added")
        let widget = try unique(try homeWidgets(), stage: "widget-new-item-identity")
        let fixture = widget.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", fixtureTitle)).firstMatch
        if fixture.exists || widget.label.contains(fixtureTitle) {
            widget.tap()
            capture("widget-open-app-requested")
            try require(app.wait(for: .runningForeground, timeout: 15),
                "widget-app-opened", "The new widget must open Synapse")
            try require(app.staticTexts["terminal-second-line"].firstMatch.waitForExistence(timeout: 20)
                && app.navigationBars.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fixtureTitle)).firstMatch.exists,
                "widget-fixture-terminal", "The displayed fixture session must open the real terminal; no command is sent")
            capture("widget-fixture-terminal-opened")
        } else {
            evidence("widget-session-link-uncovered",
                "The added widget did not expose the prepared fixture session. Gallery and addition were observed; session deep-link activation was not verified.")
        }
    }

    func testControlCenterRecordingGalleryAndTemporaryControl() throws {
        try XCTSkipIf(cleanupOnly, "This invocation is authorized for recovery cleanup only")
        // A fresh New action proves there is no old recording for cleanup to cancel.
        app.buttons["home-feature-录音"].firstMatch.tap()
        try require(app.buttons["new-recording"].firstMatch.waitForExistence(timeout: 15)
            && !app.buttons["resume-recording"].firstMatch.exists,
            "control-no-existing-recording", "Do not run the control activation while an existing recording is active")
        capture("control-no-existing-recording")
        XCUIDevice.shared.press(.home)
        openControlCenter()
        capture("control-center-before")
        try require(try recordingControls().isEmpty, "control-safe-layout-precondition",
            "Use a Control Center without an existing Recording control; old controls are never removed")
        try tap(springboard, labels: ["添加", "Add", "添加控制", "Add Controls"], stage: "control-edit")
        try tap(springboard, labels: ["添加控制", "添加控件", "Add a Control", "Add Control"], stage: "control-add-gallery")
        try searchGallery(stage: "control-search-synapse")
        let control = springboard.buttons["com.liy.SynapseMobile.recording"].firstMatch
        try require(control.waitForExistence(timeout: 8) && control.isHittable,
            "control-gallery-recording", "The real gallery must expose the observed Synapse recording provider button")
        capture("control-gallery-recording-preview")
        control.tap()
        ownsControl = true
        capture("control-added")
        closeControlCenter()
        openControlCenter()
        let added = try unique(try recordingControls(), stage: "control-new-item-identity")
        mayOwnRecording = true
        added.tap()
        capture("control-activation-requested")

        let presented = XCTNSPredicateExpectation(predicate: NSPredicate { [self] _, _ in
            app.buttons["recording-cancel"].firstMatch.exists
                || springboard.alerts.firstMatch.exists || app.alerts.firstMatch.exists
        }, object: nil)
        try require(XCTWaiter.wait(for: [presented], timeout: 20) == .completed,
            "control-activation-result", "Record whether the control opens recording or a system permission prompt")
        capture("control-activation-result")
        for owner in [springboard, app] {
            let alert = owner.alerts.firstMatch
            if alert.exists {
                let text = alert.label + " " + alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
                try require(text.localizedCaseInsensitiveContains("microphone") || text.contains("麦克风"),
                    "control-permission-identity", "An unexpected alert is recorded without accepting it")
                try tap(alert, labels: ["不允许", "Don’t Allow", "Don't Allow", "取消", "Cancel"], stage: "control-microphone-declined")
                evidence("control-permission-boundary", "The microphone prompt was declined. This observes control reachability, not successful audio capture.")
            }
        }
        if app.buttons["recording-cancel"].firstMatch.waitForExistence(timeout: 5) {
            cancelOwnRecordingIfPresented()
            try require(!app.buttons["recording-cancel"].firstMatch.exists,
                "control-own-recording-cancelled", "Cancel only the recording started by this test; do not finish or upload")
        } else {
            mayOwnRecording = false
        }
        capture("control-recording-restored")
    }

    func testCleanupOnlyPreviouslyAddedRecordingControl() throws {
        try XCTSkipIf(!controlCleanupOnly, "Explicit one-time provenance authorization is required for recovery cleanup")
        evidence("cleanup-only-authorization",
            "The coordinator confirmed saved before/add evidence: the unique current Recording control was added by this review. This test performs no control activation.")
        ownsControl = true
        removeOwnControlIfIdentifiable()
        try require(!ownsControl, "cleanup-only-control-removed",
            "Only the unique review-added control may be removed through its observed native child DeleteButton")
        evidence("cleanup-only-coverage",
            "Recovery cleanup only. This result does not verify the complete gallery/add/activate/cancel/remove test.")
        capture("cleanup-only-completed")
    }

    func testCleanupOnlyPreviouslyAddedHomeWidget() throws {
        try XCTSkipIf(!widgetCleanupOnly, "Explicit one-time widget provenance authorization is required for recovery cleanup")
        evidence("widget-cleanup-only-authorization",
            "The coordinator confirmed saved before/add evidence: the unique current Synapse widget was added by this review. This test performs no widget activation.")
        ownsWidget = true
        removeOwnWidgetIfIdentifiable()
        try require(!ownsWidget, "cleanup-only-widget-removed",
            "Only the unique review-added widget may be removed through its native Remove Widget action")
        evidence("widget-cleanup-only-coverage",
            "Recovery cleanup only. This result does not verify the complete gallery/preview/add/open/remove test.")
        capture("widget-cleanup-only-completed")
    }

    private func holdUnoccupiedHomeBackground() throws {
        let widgets = try homeWidgets()
        let bounds = springboard.frame
        let blocked = springboard.descendants(matching: .any).allElementsBoundByAccessibilityElement.filter { item in
            guard [.icon, .button, .link, .staticText].contains(item.elementType), item.exists else { return false }
            let frame = item.frame
            guard frame.minX.isFinite && frame.minY.isFinite && frame.maxX.isFinite && frame.maxY.isFinite
                && frame.width > 0 && frame.height > 0 && frame.intersects(bounds) else { return false }
            return item.isHittable
        }.map { $0.frame.insetBy(dx: -16, dy: -16) }
        for y: CGFloat in [0.45, 0.60, 0.75, 0.30] {
            for x: CGFloat in [0.5, 0.25, 0.75] {
                let point = CGPoint(x: bounds.minX + bounds.width * x, y: bounds.minY + bounds.height * y)
                if !blocked.contains(where: { $0.contains(point) })
                    && !widgets.contains(where: { $0.frame.contains(point) }) {
                    springboard.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).press(forDuration: 3)
                    capture("widget-background-held")
                    return
                }
            }
        }
        try require(false, "widget-home-background", "No unoccupied native Home Screen point was found; no icon is long-pressed")
    }

    private func searchGallery(stage: String) throws {
        var search = springboard.searchFields.firstMatch
        if !search.waitForExistence(timeout: 5) { search = springboard.textFields.firstMatch }
        try require(search.exists && search.isHittable, stage, "The native system gallery must expose its real search field")
        search.tap(); search.typeText("Synapse")
        capture(stage)
    }

    private func widgetPreview(stage: String) throws -> XCUIElement {
        let bounds = springboard.frame
        // These are the actual gallery Button label/value observed on this runtime.
        let identity = NSPredicate(format: "label == %@ AND value BEGINSWITH %@", "Synapse, 终端", "小组件,")
        let candidates = springboard.buttons.matching(identity).allElementsBoundByIndex.filter { item in
            guard item.exists else { return false }
            let frame = item.frame
            guard frame.minX.isFinite && frame.minY.isFinite && frame.maxX.isFinite && frame.maxY.isFinite
                && frame.intersects(bounds) && frame.width > 100 && frame.height > 100
                && frame.width < bounds.width * 0.9 && frame.height < bounds.height * 0.7
                && item.isHittable else { return false }
            return true
        }
        let preview = try unique(candidates, stage: stage)
        capture(stage)
        return preview
    }

    private func widgetPreviewPager(containing preview: XCUIElement, stage: String) throws -> XCUIElement {
        let previewFrame = preview.frame
        let identity = NSPredicate(format: "label == %@ AND value == %@", preview.label, preview.value as? String ?? "")
        let containers = springboard.scrollViews.allElementsBoundByIndex.filter { item in
            guard item.exists else { return false }
            let frame = item.frame
            guard frame.minX.isFinite && frame.minY.isFinite && frame.maxX.isFinite && frame.maxY.isFinite
                && frame.width > 0 && frame.height > 0 && frame.contains(previewFrame)
                && item.isHittable else { return false }
            return item.descendants(matching: .button).matching(identity).allElementsBoundByIndex.contains {
                $0.exists && $0.frame == previewFrame
            }
        }
        guard let minimum = containers.map({ $0.frame.width * $0.frame.height }).min() else {
            try require(false, stage, "The native preview has no identifiable containing paging ScrollView")
            throw Incomplete(stage: stage)
        }
        let closest = containers.filter { abs($0.frame.width * $0.frame.height - minimum) < 1 }
        let pager = try unique(closest, stage: stage)
        capture(stage)
        return pager
    }

    private func homeWidgets() throws -> [XCUIElement] {
        // The observed native widget is an Icon with value 小组件. Its app Icon
        // has the same label/identifier but lacks this widget value.
        // Scope to the actual Home Screen, excluding the app switcher and Dock.
        let home = springboard.descendants(matching: .any)["Home screen icons"].firstMatch
        try require(home.waitForExistence(timeout: 5), "widget-home-container",
            "The native Home Screen container must be identifiable before inspecting layout ownership")
        let bounds = springboard.frame
        return home.descendants(matching: .icon).matching(NSPredicate(format:
            "(label == %@ OR identifier == %@) AND value == %@", "Synapse", "Synapse", "小组件"))
            .allElementsBoundByIndex.filter {
                guard $0.exists else { return false }
                let frame = $0.frame
                return frame.minX.isFinite && frame.minY.isFinite && frame.maxX.isFinite && frame.maxY.isFinite
                    && frame.width > 100 && frame.height > 100
                    && frame.width < bounds.width * 0.9 && frame.height < bounds.height * 0.7
            }
    }

    private func recordingControls() throws -> [XCUIElement] {
        let center = springboard.descendants(matching: .any)["cc-root-folder-view"].firstMatch
        try require(center.waitForExistence(timeout: 5), "control-center-container",
            "The native Control Center container must be identifiable before inspecting layout ownership")
        let identity = NSPredicate(format:
            "label IN %@ OR identifier IN %@", ["录音", "Recording"], ["录音", "Recording", "com.liy.SynapseMobile.recording"])
        let icons = center.descendants(matching: .icon).matching(identity)
            .allElementsBoundByAccessibilityElement.filter { $0.exists && $0.frame.width > 0 && $0.frame.height > 0 }
        // A nonediting Icon can contain the provider Button. Count that as one
        // layout item, while still detecting Button-only existing controls.
        if !icons.isEmpty { return icons }
        return center.buttons.matching(identity).allElementsBoundByAccessibilityElement.filter { $0.exists && $0.isHittable }
    }

    private func cancelOwnRecordingIfPresented() {
        app.activate()
        let cancel = app.buttons["recording-cancel"].firstMatch
        if cancel.waitForExistence(timeout: 5) && cancel.isHittable {
            cancel.tap()
            capture("cleanup-own-recording-cancelled")
            if cancel.waitForNonExistence(timeout: 5) { mayOwnRecording = false }
        }
        if mayOwnRecording {
            capture("cleanup-recording-unidentified")
            XCTFail("Runtime cleanup incomplete: a recording started by this test could not be identified; no old recording was ended")
        }
    }

    private func removeOwnWidgetIfIdentifiable() {
        XCUIDevice.shared.press(.home)
        tapIfPresent(springboard, labels: ["完成", "Done"])
        let items: [XCUIElement]
        do { items = try homeWidgets() }
        catch {
            capture("cleanup-widget-home-unavailable")
            XCTFail("Runtime cleanup incomplete: the native Home Screen could not be inspected; no existing widget was removed")
            return
        }
        guard items.count == 1, items[0].isHittable else {
            capture("cleanup-widget-unidentified")
            XCTFail("Runtime cleanup incomplete: the new widget is not uniquely identifiable; no existing widget was removed")
            return
        }
        items[0].press(forDuration: 1.2)
        capture("cleanup-widget-context-menu")
        guard tapIfPresent(springboard, labels: ["移除小组件", "Remove Widget"]) else {
            capture("cleanup-widget-remove-unavailable")
            XCTFail("Runtime cleanup incomplete: the native Remove Widget action was unavailable")
            return
        }
        if springboard.alerts.firstMatch.waitForExistence(timeout: 2) {
            tapIfPresent(springboard.alerts.firstMatch, labels: ["移除", "Remove"])
        }
        capture("cleanup-widget-removed")
        do { if try homeWidgets().isEmpty { ownsWidget = false } }
        catch {
            capture("cleanup-widget-removal-unverified")
            XCTFail("Runtime cleanup incomplete: the Home Screen could not be inspected after removal")
        }
        XCTAssertFalse(ownsWidget, "The test-added widget must be removed through its native action")
    }

    private func removeOwnControlIfIdentifiable() {
        XCUIDevice.shared.press(.home)
        openControlCenter()
        guard tapIfPresent(springboard, labels: ["添加", "Add", "添加控制", "Add Controls"]) else {
            capture("cleanup-control-edit-unavailable")
            XCTFail("Runtime cleanup incomplete: Control Center edit action unavailable")
            return
        }
        let controls: [XCUIElement]
        do { controls = try recordingControls() }
        catch {
            capture("cleanup-control-center-unavailable")
            XCTFail("Runtime cleanup incomplete: Control Center could not be inspected; no old control was removed")
            closeControlCenter()
            return
        }
        guard controls.count == 1 else {
            capture("cleanup-control-unidentified")
            XCTFail("Runtime cleanup incomplete: the added control is not unique; no old control was removed")
            return
        }
        // This identifier was observed inside the unique test-added Icon in the
        // actual edit-mode native tree. Never select another item's delete button.
        let remove = controls[0].buttons["DeleteButton"].firstMatch
        guard remove.exists && remove.isHittable else {
            capture("cleanup-control-remove-unidentified")
            XCTFail("Runtime cleanup incomplete: no native DeleteButton belongs to the new control; old controls were left intact")
            closeControlCenter()
            return
        }
        remove.tap()
        capture("cleanup-control-removed")
        do { ownsControl = try !recordingControls().isEmpty }
        catch {
            capture("cleanup-control-removal-unverified")
            XCTFail("Runtime cleanup incomplete: Control Center could not be inspected after removal")
        }
        XCTAssertFalse(ownsControl, "The test-added control must be removed through its native action")
        closeControlCenter()
    }

    private func openControlCenter() {
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.01))
            .press(forDuration: 0.05, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.55)))
        capture("control-center-open-gesture")
    }

    private func closeControlCenter() {
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
            .press(forDuration: 0.05, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)))
        capture("control-center-close-gesture")
    }

    private func unique(_ items: [XCUIElement], stage: String) throws -> XCUIElement {
        try require(items.count == 1, stage, "The actual system item must be uniquely identifiable; inspect the attached native tree")
        return items[0]
    }

    private func tap(_ owner: XCUIElement, labels: [String], stage: String) throws {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.nativeAction(owner, labels: labels) != nil
        }, object: nil)
        try require(XCTWaiter.wait(for: [ready], timeout: 8) == .completed, stage,
            "Native system action absent: \(labels.joined(separator: "/")); runtime exploration incomplete, not a diagnosed app defect")
        guard let action = nativeAction(owner, labels: labels) else { throw Incomplete(stage: stage) }
        action.tap()
        capture(stage)
    }

    @discardableResult
    private func tapIfPresent(_ owner: XCUIElement, labels: [String]) -> Bool {
        guard let action = nativeAction(owner, labels: labels) else { return false }
        action.tap()
        return true
    }

    private func nativeAction(_ owner: XCUIElement, labels: [String]) -> XCUIElement? {
        for query in [owner.buttons, owner.cells, owner.staticTexts] {
            let elements = query.matching(NSPredicate(format: "label IN %@", labels)).allElementsBoundByIndex.filter(\.isHittable)
            if elements.count == 1 { return elements[0] }
        }
        return nil
    }

    private func require(_ value: Bool, _ stage: String, _ reason: String) throws {
        guard value else {
            capture("incomplete-\(stage)")
            evidence("incomplete-\(stage)-reason", reason)
            throw Incomplete(stage: "\(stage): \(reason)")
        }
    }

    private struct Incomplete: Error, CustomStringConvertible {
        let stage: String
        var description: String { "System runtime exploration incomplete: \(stage)" }
    }

    private func evidence(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        evidence("\(name)-springboard-ax", springboard.debugDescription)
        evidence("\(name)-app-ax", app.debugDescription)
        evidence("\(name)-runtime", "iPadOS \(UIDevice.current.systemVersion)\nSpringBoard \(springboard.frame)\nApp \(app.frame)")
    }
}
