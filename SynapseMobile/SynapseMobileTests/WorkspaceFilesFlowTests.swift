import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct WorkspaceFilesFlowTests {
    @Test func accessibleFileNamesDescribePathAndExtension() {
        #expect(WorkspaceFilesContentLabels.entry("nested/notes.txt", directory: false) == "目录，nested，文件名，notes，扩展名 txt")
        #expect(WorkspaceFilesContentLabels.entry("docs/design", directory: true) == "目录，docs，目录，design")
        #expect(WorkspaceFilesContentLabels.filename("a_b.tar.gz") == "文件名，a 下划线 b 点 tar，扩展名 gz")
        #expect(WorkspaceFilesContentLabels.filename(".gitignore") == "文件名， 点 gitignore")
        #expect(WorkspaceFilesContentLabels.counts(nil, 2) == "新增未计算行，删除2行")
    }

    private final class Desktop {
        var owner: WorkspaceFilesOwner? = WorkspaceFilesOwner(accountGeneration: 1, connectionGeneration: 1,
            desktopId: "desktop", mobileId: "mobile", sessionId: "session")
        var unavailable: WorkspaceFilesFailure?
        var sent: [MobileIntentRequest] = []
        var intercept: ((MobileIntentRequest) async throws -> WorkspaceFilesResult)?
        var directoryPageIndex = 0
        var directoryVersion = "directory-v1"
        var directoryHasNext = false
        var directoryFileID = "entry"
        var unstagedCount: Int? = 1
        var stagedCount: Int? = 1
        var statsComplete = true
        var gitAvailable = true

        var client: WorkspaceFilesClient {
            WorkspaceFilesClient(owner: { self.owner }, availability: { self.unavailable }, send: { request, _ in
                self.sent.append(request)
                if let intercept = self.intercept { return try await intercept(request) }
                return try self.reply(request)
            })
        }

        func reply(_ request: MobileIntentRequest) throws -> WorkspaceFilesResult {
            let data: [String: Any]
            switch request.operation! {
            case .open, .refresh:
                data = ["scopeId": "scope", "rootEntryId": "root", "scopeMode": request.scopeMode?.rawValue ?? "currentDirectory",
                    "rootDisplayName": "fixture", "contextVersion": request.operation == .refresh ? "context-v2" : "context-v1",
                    "expiresAt": "2026-10-03T00:10:00Z", "gitAvailable": gitAvailable]
            case .directory:
                let path = request.directoryEntryId == "root" ? "nested" : "nested/notes.txt"
                data = ["directoryVersion": directoryVersion, "pageIndex": directoryPageIndex,
                    "nextCursor": directoryHasNext ? "next" : NSNull(), "completion": directoryHasNext ? "partial" : "complete",
                    "collectionComplete": true, "entries": [["entryId": request.cursor == nil ? (request.directoryEntryId == "root" ? "entry" : directoryFileID) : "other", "name": (path as NSString).lastPathComponent,
                        "relativePath": path, "kind": request.directoryEntryId == "root" ? "directory" : "file",
                        "metadata": ["sizeBytes": 10, "modifiedAt": NSNull()], "canPreview": true, "canReference": true]]]
            case .changes:
                let range = request.changeRange!
                let stat: (Int?) -> [String: Any] = { count in ["fileCount": count as Any? ?? NSNull(),
                    "additions": self.statsComplete ? 1 : NSNull(), "deletions": self.statsComplete ? 1 : NSNull(),
                    "collectionComplete": count != nil, "statsComplete": self.statsComplete] }
                data = ["changeSetVersion": "changes-\(range.rawValue)", "changeRange": range.rawValue,
                    "ranges": ["unstaged": stat(unstagedCount), "staged": stat(stagedCount)],
                    "entries": [["changeId": "change-\(range.rawValue)", "changeRange": range.rawValue,
                        "relativePath": "review.txt", "status": "modified", "additions": NSNull(), "deletions": NSNull(),
                        "statsComplete": false, "contentState": "available", "canPreviewBefore": true, "canPreviewAfter": true]],
                    "collectionComplete": true, "statsComplete": statsComplete, "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"]
            case .diff:
                data = ["contentVersion": "content-v1", "changeId": request.changeId!, "contentState": "available",
                    "hunks": [["hunkId": "hunk", "oldStart": 1, "oldCount": 1, "newStart": 1, "newCount": 1,
                        "lineOffset": 0, "continued": false,
                        "lines": [["kind": "addition", "oldLineNumber": NSNull(), "newLineNumber": 1, "text": "WORKTREE", "truncated": false]]]],
                    "additions": 1, "deletions": 1, "statsComplete": true, "contentComplete": true,
                    "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"]
            case .preview:
                data = ["contentVersion": "preview-v1", "source": request.target!.source,
                    "name": "notes.txt", "relativePath": "nested/notes.txt", "metadata": ["sizeBytes": 10, "modifiedAt": NSNull()],
                    "contentState": "available", "lines": [["lineNumber": 1, "text": "UTF-8 中文 😀", "truncated": false]],
                    "contentComplete": true, "format": "text", "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"]
                return try result(request, data: data.merging(request.target!.side.map { ["side": $0] } ?? [:]) { _, new in new })
            case .search:
                data = ["searchVersion": "search-v1", "entries": [], "scanComplete": false, "scannedEntries": 100,
                    "collectionComplete": false, "pageIndex": 0, "nextCursor": "scan-next", "completion": "partial"]
            case .reference: data = ["referenceText": "'/tmp/a b'", "contextVersion": request.expectedContextVersion!]
            case .cancel: data = ["status": "cancelled"]
            case .close: data = ["status": "closed", "pendingCancellationCount": 0]
            }
            return try result(request, data: data)
        }

        func result(_ request: MobileIntentRequest, data: [String: Any]) throws -> WorkspaceFilesResult {
            var value: [String: Any] = ["filesVersion": 1, "operation": request.operation!.rawValue,
                "sessionId": "session", "readAt": "2026-10-03T00:00:00Z", "data": data]
            if request.operation != .cancel {
                value["scopeId"] = request.scopeId ?? "scope"
                value["contextVersion"] = data["contextVersion"] ?? request.expectedContextVersion ?? "context-v1"
            }
            return try JSONDecoder().decode(WorkspaceFilesResult.self, from: JSONSerialization.data(withJSONObject: value))
        }
    }

    private func flow(_ desktop: Desktop, tab: WorkspaceFilesTab = .all) -> WorkspaceFilesFlow {
        WorkspaceFilesFlow(sessionId: "session", mode: .currentDirectory, tab: tab, client: desktop.client)
    }

    private func cacheKeys(_ files: WorkspaceFilesFlow) throws -> (pages: Set<String>, recency: [String]) {
        let properties = Mirror(reflecting: files).children
        let pages = try #require(properties.first { $0.label == "pages" || $0.label == "_pages" }?.value as? [String: [WorkspaceFilesData]])
        let recency = try #require(properties.first { $0.label == "recency" || $0.label == "_recency" }?.value as? [String])
        return (Set(pages.keys), recency)
    }

    private func wireEntry(_ id: String, path: String, directory: Bool = false) -> [String: Any] {
        ["entryId": id, "name": (path as NSString).lastPathComponent, "relativePath": path,
         "kind": directory ? "directory" : "file", "metadata": ["sizeBytes": 10, "modifiedAt": NSNull()],
         "canPreview": !directory, "canReference": true]
    }

    private func entry(_ id: String, path: String, directory: Bool = false) throws -> WorkspaceFileEntry {
        try JSONDecoder().decode(WorkspaceFileEntry.self, from: JSONSerialization.data(withJSONObject: wireEntry(id, path: path, directory: directory)))
    }

    @Test func locationLoadsParentContinuationAndPublishesItsActualTreeRowWithoutPreview() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        await files.submitSearch("target")
        let reset = files.searchResetGeneration
        desktop.intercept = { request in
            guard request.operation == .directory, request.directoryEntryId == "entry" else { return try desktop.reply(request) }
            let first = request.cursor == nil
            return try desktop.result(request, data: ["directoryVersion": "parent-v1", "entries": [self.wireEntry(first ? "first" : "tree-target", path: first ? "nested/first.txt" : "nested/target.txt")],
                "collectionComplete": true, "pageIndex": first ? 0 : 1,
                "nextCursor": first ? "parent-next" : NSNull(), "completion": first ? "partial" : "complete"])
        }
        let target = try entry("search-target", path: "nested/target.txt")
        await files.locate(target)
        #expect(files.searchQuery.isEmpty && files.searchResetGeneration > reset)
        #expect(files.locationState == .located && files.locatedRowID == "tree-target")
        #expect(files.locationGeneration == 1 && files.tab == .all)
        #expect(files.treeRows.map(\.id) == ["entry", "first", "tree-target"])
        #expect(files.expanded.contains("entry") && files.selected == nil)
        #expect(!desktop.sent.contains { $0.operation == .preview || $0.operation == .diff })
        let directories = desktop.sent.filter { $0.operation == .directory }
        #expect(directories.map(\.directoryEntryId) == ["root", "entry", "entry"])
        #expect(directories.last?.cursor == "parent-next")
        let count = desktop.sent.count
        await files.locate(target)
        #expect(desktop.sent.count == count && files.locationGeneration == 2)
        files.clearSearch()
        #expect(files.locationState == .idle && files.locatedRowID == nil)
        #expect(files.locationGeneration == 2 && files.treeRows.last?.id == "tree-target")
    }

    @Test func locatingAnExpandedDirectoryKeepsItsChildrenAndDoesNotToggleIt() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        let count = desktop.sent.count
        await files.locate(try entry("search-directory", path: "nested", directory: true))
        #expect(files.expanded.contains("entry") && files.treeRows.count == 2)
        #expect(files.locationState == .located && files.locatedRowID == "entry")
        #expect(desktop.sent.count == count && files.selected == nil)
    }

    @Test func successfulLocationClosesThePreviewSoTheSameFileCanOpenAgain() async {
        let desktop = Desktop(); desktop.directoryFileID = "file-entry"
        let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        let target = files.treeRows[1].entry
        await files.select(.disk(target))
        #expect(files.selected == .disk(target) && files.displayRows.last?.text == "UTF-8 中文 😀")
        let previews = desktop.sent.filter { $0.operation == .preview }.count
        await files.locate(target)
        #expect(files.locationState == .located && files.locatedRowID == target.id)
        #expect(files.selected == nil && files.previewSide == nil)
        #expect(files.contentPages.isEmpty && files.displayRows.isEmpty && files.markdownDocument == nil)
        #expect(desktop.sent.filter { $0.operation == .preview }.count == previews)
        await files.select(.disk(target))
        #expect(files.selected == .disk(target) && files.displayRows.last?.text == "UTF-8 中文 😀")
        #expect(desktop.sent.filter { $0.operation == .preview }.count == previews + 1)
        #expect(desktop.sent.last?.target?.entryId == target.entryId)
    }

    @Test func selectingAnotherFileClearsThePriorLocationWithoutPublishingAnotherEvent() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        desktop.intercept = { request in
            guard request.operation == .directory, request.directoryEntryId == "entry" else { return try desktop.reply(request) }
            return try desktop.result(request, data: ["directoryVersion": "siblings-v1", "entries": [self.wireEntry("file-a", path: "nested/a.txt"), self.wireEntry("file-b", path: "nested/b.txt")],
                "collectionComplete": true, "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"])
        }
        await files.toggleDirectory(files.treeRows[0].entry)
        let first = files.treeRows[1].entry, second = files.treeRows[2].entry
        await files.locate(first)
        #expect(files.locationState == .located && files.locatedRowID == first.id)
        let event = files.locationGeneration
        await files.select(.disk(second))
        #expect(files.locationState == .idle && files.locatedRowID == nil)
        #expect(files.locationGeneration == event && files.selected == .disk(second))
        #expect(desktop.sent.last?.operation == .preview && desktop.sent.last?.target?.entryId == second.entryId)
        let count = desktop.sent.count
        await files.select(.disk(second))
        #expect(desktop.sent.count == count && files.locationGeneration == event)
        #expect(files.locationState == .idle && files.locatedRowID == nil)
        #expect(files.treeRows.map(\.id) == ["entry", "file-a", "file-b"])
    }

    @Test func reselectingTheCachedFileCancelsOnlyItsInFlightLocationAndRejectsTheLateRow() async throws {
        let desktop = Desktop()
        var release: CheckedContinuation<WorkspaceFilesResult, Error>?
        desktop.intercept = { request in
            guard request.operation == .directory else { return try desktop.reply(request) }
            if request.directoryEntryId == "other-dir" {
                return try await withCheckedThrowingContinuation { release = $0 }
            }
            let entries = request.directoryEntryId == "root" ? [self.wireEntry("nested-dir", path: "nested", directory: true), self.wireEntry("other-dir", path: "other", directory: true)] : [self.wireEntry("file-b", path: "nested/b.txt")]
            return try desktop.result(request, data: ["directoryVersion": "directory-v1", "entries": entries,
                "collectionComplete": true, "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"])
        }
        let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        let selected = WorkspaceFilesSelection.disk(files.treeRows[1].entry)
        await files.select(selected)
        let previews = desktop.sent.filter { $0.operation == .preview }.count
        let target = try entry("search-a", path: "other/a.txt")
        let locating = Task { await files.locate(target) }
        while release == nil { await Task.yield() }
        let request = try #require(desktop.sent.last { $0.operation == .directory && $0.directoryEntryId == "other-dir" })
        await files.select(selected)
        while !desktop.sent.contains(where: { $0.operation == .cancel && $0.targetIntentId == request.intentId }) { await Task.yield() }
        #expect(files.locationState == .idle && files.locatedRowID == nil)
        #expect(files.selected == selected && files.displayRows.last?.text == "UTF-8 中文 😀")
        #expect(desktop.sent.filter { $0.operation == .preview }.count == previews)
        #expect(files.pending.isEmpty && !files.contentPages.isEmpty)
        release?.resume(returning: try desktop.result(request, data: ["directoryVersion": "other-v1", "entries": [wireEntry("file-a", path: "other/a.txt")],
            "collectionComplete": true, "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"]))
        await locating.value
        #expect(files.locationGeneration == 0 && files.locatedRowID == nil && files.locationState == .idle)
        #expect(!files.treeRows.contains { $0.entry.relativePath == "other/a.txt" })
        #expect(files.selected == selected && files.displayRows.last?.text == "UTF-8 中文 😀")
    }

    @Test func missingLocationReportsFailureAndNeverPublishesAnInvisibleTarget() async throws {
        let desktop = Desktop(); desktop.directoryFileID = "file-entry"
        let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        let selection = WorkspaceFilesSelection.disk(files.treeRows[1].entry)
        await files.select(selection)
        let previews = desktop.sent.filter { $0.operation == .preview }.count
        await files.locate(try entry("missing", path: "nested/missing.txt"))
        #expect(files.locationState == .failed && files.locatedRowID == nil)
        #expect(files.locationGeneration == 0 && files.failure?.code == "content_stale")
        #expect(files.selected == selection && files.displayRows.last?.text == "UTF-8 中文 😀")
        #expect(desktop.sent.filter { $0.operation == .preview }.count == previews)
    }

    @Test func repeatedDirectoryCursorCannotKeepLocationReadingForever() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        desktop.intercept = { request in
            guard request.operation == .directory, request.directoryEntryId == "entry" else { return try desktop.reply(request) }
            return try desktop.result(request, data: ["directoryVersion": "duplicate-v1", "entries": [self.wireEntry("other", path: "nested/other.txt")],
                "collectionComplete": true, "pageIndex": 0, "nextCursor": "same", "completion": "partial"])
        }
        await files.locate(try entry("missing", path: "nested/missing.txt"))
        #expect(files.locationState == .failed && files.locatedRowID == nil)
        #expect(files.failure?.code == "content_stale")
        #expect(desktop.sent.filter { $0.operation == .directory && $0.directoryEntryId == "entry" }.count == 2)
    }

    @Test func locationDoesNotDuplicateOrCancelAnotherDirectoryRead() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        var release: CheckedContinuation<WorkspaceFilesResult, Error>?
        desktop.intercept = { request in
            if request.operation == .directory, request.directoryEntryId == "entry" {
                return try await withCheckedThrowingContinuation { release = $0 }
            }
            return try desktop.reply(request)
        }
        let ordinaryRead = Task { await files.loadDirectory("entry") }
        while release == nil { await Task.yield() }
        await files.locate(try entry("search-target", path: "nested/notes.txt"))
        #expect(files.locationState == .failed && files.failure?.code == "busy")
        #expect(files.locatedRowID == nil && files.pending.count == 1)
        files.clearSearch()
        #expect(files.pending.count == 1 && !desktop.sent.contains { $0.operation == .cancel })
        let request = try #require(desktop.sent.last { $0.operation == .directory })
        release?.resume(returning: try desktop.reply(request))
        await ordinaryRead.value
        #expect(files.pending.isEmpty)
        #expect(desktop.sent.filter { $0.operation == .directory && $0.directoryEntryId == "entry" }.count == 1)
    }

    @Test func lateLocationCannotPublishAfterSearchOrScopeOwnerAndGenerationInvalidation() async throws {
        for action in ["clear", "close", "scope", "owner", "generation", "newSearch"] {
            let desktop = Desktop(); let files = flow(desktop); await files.open()
            var release: CheckedContinuation<WorkspaceFilesResult, Error>?
            desktop.intercept = { request in
                if request.operation == .directory, request.directoryEntryId == "entry" {
                    return try await withCheckedThrowingContinuation { release = $0 }
                }
                return try desktop.reply(request)
            }
            let target = try entry("search-target", path: "nested/notes.txt")
            let locating = Task { await files.locate(target) }
            while release == nil { await Task.yield() }
            let request = try #require(desktop.sent.last { $0.operation == .directory && $0.directoryEntryId == "entry" })
            #expect(files.locationState == .locating)
            switch action {
            case "clear": files.clearSearch()
            case "close": await files.close()
            case "scope": await files.switchScope(.repository)
            case "owner": desktop.owner = WorkspaceFilesOwner(accountGeneration: 1, connectionGeneration: 1, desktopId: "other", mobileId: "mobile", sessionId: "session")
            case "generation": files.cancelPending()
            default: await files.submitSearch("other")
            }
            release?.resume(returning: try desktop.reply(request))
            await locating.value
            #expect(files.locationState == .idle && files.locatedRowID == nil)
            #expect(files.locationGeneration == 0 && files.pending.isEmpty)
            #expect(!files.treeRows.contains { $0.entry.relativePath == "nested/notes.txt" })
            #expect(!desktop.sent.contains { $0.operation == .preview || $0.operation == .diff })
        }
    }

    @Test func repeatedEmptyAndSmallSearchesKeepOnlyLiveLRUKeysWithoutEvictingOtherContent() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        await files.select(.disk(files.treeRows[1].entry))
        let retained = files.retainedBytes, original = try cacheKeys(files)
        desktop.intercept = { request in
            guard request.operation == .search else { return try desktop.reply(request) }
            let entries: [[String: Any]] = request.query!.hasPrefix("empty-") ? [] : [[
                "entryId": "search-entry", "name": "notes.txt", "relativePath": "nested/notes.txt", "kind": "file",
                "metadata": ["sizeBytes": 10, "modifiedAt": NSNull()], "canPreview": true, "canReference": true,
            ]]
            return try desktop.result(request, data: ["searchVersion": "search-v1", "entries": entries,
                "scanComplete": true, "scannedEntries": 1, "collectionComplete": true,
                "pageIndex": 0, "nextCursor": NSNull(), "completion": "complete"])
        }
        for index in 0..<64 {
            for prefix in ["empty", "small"] {
                await files.submitSearch("\(prefix)-\(index)")
                #expect(files.searchEntries.count == (prefix == "empty" ? 0 : 1))
                let cached = try cacheKeys(files)
                #expect(cached.pages.count == original.pages.count + 1)
                #expect(Set(cached.recency) == cached.pages)
                #expect(cached.recency.count == cached.pages.count)
                #expect(files.retainedBytes < 4 * 1024 * 1024)
            }
            files.clearSearch()
            let cleared = try cacheKeys(files)
            #expect(cleared.pages == original.pages)
            #expect(cleared.recency == original.recency)
            #expect(files.retainedBytes == retained)
            #expect(files.treeRows.count == 2 && files.displayRows.last?.text == "UTF-8 中文 😀")
            #expect(files.pending.isEmpty)
        }
        #expect(desktop.sent.filter { $0.operation == .search }.count == 128)
        #expect(!desktop.sent.contains { $0.operation == .cancel })
    }

    @Test func replacingSearchRecountsTheRemovedPageBeforeItsReplyArrives() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        let retained = files.retainedBytes, original = try cacheKeys(files)
        await files.submitSearch("old")
        #expect(files.retainedBytes > retained)
        var release: CheckedContinuation<WorkspaceFilesResult, Error>?
        desktop.intercept = { request in
            if request.operation == .search {
                return try await withCheckedThrowingContinuation { release = $0 }
            }
            return try desktop.reply(request)
        }
        let replacing = Task { await files.submitSearch("new") }
        while release == nil { await Task.yield() }
        let reading = try cacheKeys(files)
        #expect(reading.pages == original.pages && reading.recency == original.recency)
        #expect(files.retainedBytes == retained)
        #expect(files.searchLastPage == nil && !files.pending.isEmpty)
        let request = try #require(desktop.sent.last)
        release?.resume(returning: try desktop.reply(request))
        await replacing.value
        files.clearSearch()
        #expect(files.retainedBytes == retained)
        #expect(try cacheKeys(files).recency == original.recency)
    }

    @Test func opensOneLayerAndOnlyReadsExpandedDirectories() async {
        let desktop = Desktop()
        let tested = flow(desktop)
        await tested.open()
        #expect(desktop.sent.map(\.operation) == [.open, .directory])
        #expect(tested.treeRows.count == 1)
        await tested.toggleDirectory(tested.treeRows[0].entry)
        #expect(tested.treeRows.count == 2)
        #expect(desktop.sent.last?.directoryEntryId == "entry")
        await tested.toggleDirectory(tested.treeRows[0].entry)
        #expect(desktop.sent.count == 3)
        #expect(tested.treeRows.count == 1)
        #expect(desktop.sent.allSatisfy { $0.kind == "workspaceFiles" && $0.filesVersion == 1 })
    }

    @Test func rangesStaySeparateAndUnknownStatsStayNil() async {
        let desktop = Desktop(); desktop.statsComplete = false; desktop.unstagedCount = nil
        let files = flow(desktop, tab: .changed)
        await files.open()
        #expect(files.range == .unstaged)
        #expect(files.rangeSummary?.fileCount == nil)
        #expect(files.rangeSummary?.additions == nil)
        let unstaged = files.changes[0].id
        await files.selectRange(.staged)
        #expect(files.changes[0].id != unstaged)
        #expect(desktop.sent.last?.changeRange == .staged)
    }

    @Test func automaticStagedSelectionRequiresCompleteBothLayerCounts() async {
        let desktop = Desktop(); desktop.unstagedCount = 0; desktop.stagedCount = 1
        let files = flow(desktop, tab: .changed)
        await files.open()
        #expect(files.range == .staged)
        #expect(desktop.sent.map(\.operation) == [.open, .changes, .changes])
    }

    @Test func searchRequiresSubmitAndIncompleteEmptyPageIsNotEmptyResult() async {
        let desktop = Desktop()
        let tested = flow(desktop)
        await tested.open(); tested.searchEdited()
        #expect(desktop.sent.count == 2)
        await tested.submitSearch("notes")
        #expect(desktop.sent.last?.operation == .search)
        #expect(tested.searchEntries.isEmpty)
        #expect(tested.searchLastPage?.scanComplete == false)
        #expect(tested.searchLastPage?.nextCursor == "scan-next")
        #expect(tested.searchLastPage?.completion == "partial")
    }

    @Test func duplicateSubmittedSearchCoalescesAndNewQueryCancelsTheOldRead() async throws {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        var releases: [String: CheckedContinuation<WorkspaceFilesResult, Error>] = [:]
        desktop.intercept = { request in
            if request.operation == .search, let query = request.query {
                return try await withCheckedThrowingContinuation { releases[query] = $0 }
            }
            return try desktop.reply(request)
        }
        let first = Task { await files.submitSearch(" notes ") }
        while releases["notes"] == nil { await Task.yield() }
        await files.submitSearch("notes\n")
        #expect(desktop.sent.filter { $0.operation == .search }.count == 1)
        #expect(!desktop.sent.contains { $0.operation == .cancel })

        let replacement = Task { await files.submitSearch("readme") }
        while releases["readme"] == nil || !desktop.sent.contains(where: { $0.operation == .cancel }) {
            await Task.yield()
        }
        let requests = desktop.sent.filter { $0.operation == .search }
        #expect(requests.map(\.query) == ["notes", "readme"])
        #expect(desktop.sent.filter { $0.operation == .cancel }.map(\.targetIntentId) == [requests[0].intentId])
        releases["notes"]?.resume(returning: try desktop.reply(requests[0]))
        await first.value
        #expect(files.searchQuery == "readme" && files.searchLastPage == nil)
        releases["readme"]?.resume(returning: try desktop.reply(requests[1]))
        await replacement.value
        #expect(files.searchQuery == "readme" && files.searchLastPage?.scanComplete == false)
    }

    @Test func searchUsesTheWireUTF16LimitForEmojiAndCombiningCharacters() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        for valid in [String(repeating: "😀", count: 128), String(repeating: "e\u{301}", count: 128)] {
            await files.submitSearch(valid)
            #expect(desktop.sent.last?.operation == .search)
            #expect(desktop.sent.last?.query == valid)
        }
        let sent = desktop.sent.count
        for invalid in [String(repeating: "😀", count: 129), String(repeating: "e\u{301}", count: 129)] {
            await files.submitSearch(invalid)
            #expect(files.failure?.code == "invalid_request")
            #expect(desktop.sent.count == sent)
        }
    }

    @Test func duplicatedPageReplacesAndMissingPageIsRejected() async {
        let desktop = Desktop(); desktop.directoryHasNext = true
        let files = flow(desktop); await files.open()
        await files.loadDirectory("root", next: true)
        #expect(files.treeRows.count == 1)
        desktop.directoryPageIndex = 2
        await files.loadDirectory("root", next: true)
        #expect(files.failure?.code == "invalid_result")
        #expect(files.treeRows.count == 1)
        desktop.directoryPageIndex = 1; desktop.directoryVersion = "different"
        await files.loadDirectory("root", next: true)
        #expect(files.failure?.code == "invalid_result")
    }

    @Test func diffThenBeforePreviewUseDesktopHandlesAndCorrectSide() async {
        let desktop = Desktop()
        let tested = flow(desktop, tab: .changed); await tested.open()
        await tested.select(.change(tested.changes[0]))
        #expect(desktop.sent.last?.operation == .diff)
        #expect(desktop.sent.last?.changeSetVersion == "changes-unstaged")
        #expect(tested.displayRows.last?.text == "WORKTREE")
        await tested.preview("before")
        #expect(desktop.sent.last?.target?.source == "change")
        #expect(desktop.sent.last?.target?.side == "before")
        #expect(tested.contentLastPage?.side == "before")
    }

    @Test func offlineKeepsSnapshotAndTargetSwitchClearsIt() async {
        let desktop = Desktop()
        let files = flow(desktop); await files.open()
        desktop.unavailable = .offline
        desktop.owner = WorkspaceFilesOwner(accountGeneration: 1, connectionGeneration: 2,
            desktopId: "desktop", mobileId: "mobile", sessionId: "session")
        files.checkConnectivity()
        #expect(files.phase == .offlineSnapshot)
        #expect(files.treeRows.count == 1)
        #expect(!files.canRead)
        #expect(!files.canReopen)
        let sent = desktop.sent.count
        await files.reopen()
        #expect(files.treeRows.count == 1 && files.scope != nil)
        #expect(desktop.sent.count == sent)
        desktop.unavailable = nil
        files.checkConnectivity()
        #expect(files.phase == .stale)
        #expect(files.canReopen)
        desktop.owner = WorkspaceFilesOwner(accountGeneration: 1, connectionGeneration: 2,
            desktopId: "other", mobileId: "mobile", sessionId: "session")
        files.checkConnectivity()
        #expect(files.treeRows.isEmpty)
        #expect(files.scope == nil)
        #expect(files.retainedBytes == 0)
    }

    @Test func desktopSessionEndedReceiptClearsAllContentAndHandlesImmediately() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        await files.select(.disk(files.treeRows[1].entry))
        #expect(!files.displayRows.isEmpty)
        desktop.intercept = { _ in throw WorkspaceFilesFailure(code: "session_ended", message: "会话已结束") }
        await files.refresh()
        #expect(files.failure?.code == "session_ended")
        #expect(files.phase == .stale)
        #expect(files.scope == nil && files.selected == nil && files.expanded.isEmpty)
        #expect(files.treeRows.isEmpty && files.displayRows.isEmpty && files.contentPages.isEmpty)
        #expect(files.retainedBytes == 0)
    }

    @Test func capabilityChangesKeepTheSnapshotWithoutClaimingTheDesktopIsOffline() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        desktop.unavailable = WorkspaceFilesFailure(code: "unsupported_version", message: "电脑不支持文件浏览")
        let count = desktop.sent.count
        files.checkConnectivity()
        #expect(files.phase == .stale && files.treeRows.count == 1)
        #expect(files.failure?.code == "unsupported_version")
        #expect(desktop.sent.count == count && !files.canRead)
    }

    @Test func scopeStaleDoesNotRetargetOrAutoReopen() async {
        let desktop = Desktop()
        let tested = flow(desktop); await tested.open()
        desktop.intercept = { _ in throw WorkspaceFilesFailure(code: "scope_stale", message: "目录已改变") }
        await tested.refresh()
        #expect(tested.phase == .stale)
        #expect(tested.scope?.rootDisplayName == "fixture")
        #expect(desktop.sent.filter { $0.operation == .open }.count == 1)
    }

    @Test func closeCancelsOpeningAndClosesLateCreatedScope() async {
        let desktop = Desktop()
        var release: CheckedContinuation<WorkspaceFilesResult, Error>?
        desktop.intercept = { request in
            if request.operation == .open {
                return try await withCheckedThrowingContinuation { release = $0 }
            }
            return try desktop.reply(request)
        }
        let files = flow(desktop)
        let opening = Task { await files.open() }
        while release == nil { await Task.yield() }
        await files.close()
        release?.resume(returning: try! desktop.reply(desktop.sent.first!))
        await opening.value
        #expect(files.phase == .closed)
        #expect(files.scope == nil)
        #expect(desktop.sent.contains { $0.operation == .cancel && $0.scopeId == nil })
        #expect(desktop.sent.contains { $0.operation == .close && $0.scopeId == "scope" })
    }

    @Test func unsupportedCapabilityDoesNotSendProbe() async {
        let desktop = Desktop(); desktop.unavailable = .unavailable
        let files = flow(desktop); await files.open()
        #expect(desktop.sent.isEmpty)
        #expect(files.failure?.code == "unsupported_version")
        for pair: (Int?, Int?) in [(nil, 1), (1, nil), (2, 1), (1, 2), (nil, nil)] {
            #expect(!WorkspaceFilesCapabilities.supportsFiles(relayVersion: pair.0, desktopVersion: pair.1))
        }
        #expect(WorkspaceFilesCapabilities.supportsFiles(relayVersion: 1, desktopVersion: 1))
    }

    @Test func ownerReceiptIncludesOuterDesktopAndCurrentConnection() throws {
        let owner = Desktop().owner!
        func receipt(_ desktop: String?, mobile: String = "mobile") throws -> MobileIntentResultPayload {
            var value: [String: Any] = ["mobileClientInstanceId": mobile, "result": ["intentId": "same", "outcome": "rejected"]]
            value["desktopClientInstanceId"] = desktop
            return try JSONDecoder().decode(MobileIntentResultPayload.self, from: JSONSerialization.data(withJSONObject: value))
        }
        #expect(try receipt("desktop").matchesWorkspaceOwner(owner, current: owner))
        #expect(try !receipt(nil).matchesWorkspaceOwner(owner, current: owner))
        #expect(try !receipt("other").matchesWorkspaceOwner(owner, current: owner))
        #expect(try !receipt("desktop", mobile: "other").matchesWorkspaceOwner(owner, current: owner))
        let reconnected = WorkspaceFilesOwner(accountGeneration: 1, connectionGeneration: 2, desktopId: "desktop", mobileId: "mobile", sessionId: "session")
        #expect(try !receipt("desktop").matchesWorkspaceOwner(owner, current: reconnected))
    }
    @Test func fallbackRequiresExactLiveOwnerAndRemainingOriginalDeadline() {
        let owner = Desktop().owner!
        #expect(WorkspaceFilesFallbackPolicy.allowsFallback(owner: owner, current: owner, available: true, remainingSeconds: 8))
        for remaining in [0.0, -1.0, 15.01] {
            #expect(!WorkspaceFilesFallbackPolicy.allowsFallback(owner: owner, current: owner, available: true, remainingSeconds: remaining))
        }
        #expect(!WorkspaceFilesFallbackPolicy.allowsFallback(owner: owner, current: owner, available: false, remainingSeconds: 8))
        #expect(!WorkspaceFilesFallbackPolicy.allowsFallback(owner: owner, current: nil, available: true, remainingSeconds: 8))
        let reconnected = WorkspaceFilesOwner(accountGeneration: 1, connectionGeneration: 2, desktopId: "desktop", mobileId: "mobile", sessionId: "session")
        #expect(!WorkspaceFilesFallbackPolicy.allowsFallback(owner: owner, current: reconnected, available: true, remainingSeconds: 8))
    }

    @Test func receiptDecoderRejectsOversizedOperationAndEnvelopeBeforeUI() throws {
        func response(_ length: Int) -> [String: Any] {
            ["intentId": "id", "outcome": "accepted", "workspaceFiles": ["filesVersion": 1, "operation": "reference", "sessionId": "session", "scopeId": "scope", "contextVersion": "v1", "readAt": "2026-10-03T00:00:00Z", "data": ["contextVersion": "v1", "referenceText": String(repeating: "a", count: length)]]]
        }
        let small: [String: Any] = ["desktopClientInstanceId": "desktop", "mobileClientInstanceId": "mobile", "result": response(10)]
        #expect(WorkspaceFilesReceiptDecoder.decode(try JSONSerialization.data(withJSONObject: ["payload": small])) != nil)
        let oversized: [String: Any] = ["desktopClientInstanceId": "desktop", "mobileClientInstanceId": "mobile", "result": response(70 * 1024)]
        #expect(WorkspaceFilesReceiptDecoder.decode(try JSONSerialization.data(withJSONObject: ["payload": oversized])) == nil)
        #expect(!WorkspaceFilesReceiptDecoder.httpWithinBudget(try JSONSerialization.data(withJSONObject: oversized)))
        #expect(!WorkspaceFilesReceiptDecoder.httpWithinBudget(Data(repeating: 32, count: 128 * 1024 + 1)))
    }

    @Test func locatingAndScopeChangeResetSearchPresentationWithoutTypingRequests() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        await files.submitSearch("notes")
        let reset = files.searchResetGeneration
        await files.locate(files.treeRows[0].entry)
        #expect(files.searchQuery.isEmpty)
        #expect(files.searchResetGeneration > reset)
        let reads = desktop.sent.count
        files.searchEdited()
        #expect(desktop.sent.count == reads)
        await files.switchScope(.repository)
        #expect(files.searchQuery.isEmpty)
        #expect(files.searchResetGeneration > reset + 1)
    }

    @Test func sameFileAndTabChangeKeepLoadedContentAndSelection() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        await files.toggleDirectory(files.treeRows[0].entry)
        let selection = WorkspaceFilesSelection.disk(files.treeRows[1].entry)
        await files.select(selection)
        let previews = desktop.sent.filter { $0.operation == .preview }.count
        await files.select(selection)
        #expect(desktop.sent.filter { $0.operation == .preview }.count == previews)
        await files.selectTab(.changed)
        #expect(files.selected == selection)
        #expect(files.displayRows.last?.text == "UTF-8 中文 😀")
    }

    @Test func mobilePageRetentionHasHardByteLimit() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        var index = 0
        desktop.intercept = { request in
            if request.operation != .directory { return try desktop.reply(request) }
            let entries = (0..<100).map { entry in ["entryId": "entry-\(index)-\(entry)", "name": String(repeating: "n", count: 180), "relativePath": String(repeating: "p", count: 180) + "/\(index)-\(entry)", "kind": "file", "metadata": ["sizeBytes": 10, "modifiedAt": NSNull()], "canPreview": true, "canReference": true] as [String: Any] }
            return try desktop.result(request, data: ["directoryVersion": "dir-large", "entries": entries, "collectionComplete": false, "pageIndex": index, "nextCursor": "next-\(index)", "completion": "partial"])
        }
        await files.loadDirectory("root")
        for next in 1...40 {
            index = next; await files.loadDirectory("root", next: true)
            #expect(files.retainedBytes <= 4 * 1024 * 1024)
            if files.failure?.code == "limit_exceeded" { break }
        }
        #expect(files.failure?.code == "limit_exceeded")
        #expect(files.treeRows.isEmpty)
    }

    @Test func optionalGitUnavailableReasonSurvivesScopeAndRejectsContradiction() async throws {
        let desktop = Desktop()
        desktop.intercept = { request in
            let original = try desktop.reply(request)
            guard request.operation == .open else { return original }
            var data = original.data; data.gitAvailable = false; data.gitUnavailableReason = "permission_denied"
            return WorkspaceFilesResult(filesVersion: 1, operation: .open, sessionId: original.sessionId, scopeId: original.scopeId, contextVersion: original.contextVersion, readAt: original.readAt, data: data)
        }
        let files = flow(desktop, tab: .changed); await files.open()
        #expect(files.scope?.gitAvailable == false)
        #expect(files.scope?.gitUnavailableReason == "permission_denied")
        #expect(!desktop.sent.contains { $0.operation == .changes })
        let request = desktop.sent.first!; let original = try await desktop.intercept!(request)
        var data = original.data; data.gitAvailable = true
        let contradictory = WorkspaceFilesResult(filesVersion: 1, operation: .open, sessionId: original.sessionId, scopeId: original.scopeId, contextVersion: original.contextVersion, readAt: original.readAt, data: data)
        #expect(throws: WorkspaceFilesFailure.self) { try contradictory.validated(for: request) }
    }

    @Test func unknownSummaryKeepsSnapshotButConfirmedEndClearsIt() async {
        let desktop = Desktop(); let files = flow(desktop); await files.open()
        let originalScope = files.scope
        desktop.unavailable = WorkspaceFilesFailure(code: "scope_stale", message: "等待电脑更新会话状态。")
        files.checkConnectivity()
        #expect(files.scope == originalScope)
        #expect(files.treeRows.count == 1)
        #expect(files.phase == .stale)
        #expect(!files.canRead)
        let requests = desktop.sent.count
        await files.loadDirectory("root")
        #expect(desktop.sent.count == requests)
        desktop.unavailable = WorkspaceFilesFailure(code: "session_ended", message: "这个终端已结束。")
        files.checkConnectivity()
        #expect(files.scope == nil)
        #expect(files.treeRows.isEmpty)
        #expect(files.retainedBytes == 0)
    }

}
