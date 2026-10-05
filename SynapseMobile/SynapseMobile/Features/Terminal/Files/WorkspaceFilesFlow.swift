import Foundation
import Observation

enum WorkspaceFilesTab: String, CaseIterable { case changed, all }
enum WorkspaceFilesPhase: Equatable { case closed, opening, ready, stale, offlineSnapshot, closing }
enum WorkspaceFilesLocationState: Equatable { case idle, locating, located, failed }
enum WorkspaceFilesSelection: Hashable {
    case disk(WorkspaceFileEntry)
    case change(WorkspaceFileEntry)
    var entry: WorkspaceFileEntry { switch self { case .disk(let e), .change(let e): e } }
}

struct WorkspaceFileTreeRow: Identifiable {
    let entry: WorkspaceFileEntry
    let depth: Int
    var id: String { entry.id }
}

/// All pages belong to one frozen desktop/session scope. No file content is persisted.
@MainActor @Observable
final class WorkspaceFilesFlow: Identifiable {
    let id = UUID()
    let sessionId: String
    private(set) var mode: WorkspaceFilesScopeMode
    let initialTab: WorkspaceFilesTab
    private(set) var phase: WorkspaceFilesPhase = .closed
    private(set) var scope: WorkspaceFilesScope?
    var tab: WorkspaceFilesTab
    private(set) var range: WorkspaceFilesChangeRange = .unstaged
    private(set) var selected: WorkspaceFilesSelection?
    // A selected change keeps its original baseline even when its list pages
    // leave the bounded LRU. This is part of that selection's scope context.
    private var selectedChangeSetVersion: String?
    private(set) var failure: WorkspaceFilesFailure?
    private(set) var contentFailureAtEnd = false
    private(set) var expanded: Set<String> = []
    private(set) var searchQuery = ""
    private(set) var searchResetGeneration = 0
    private(set) var locationState: WorkspaceFilesLocationState = .idle
    private(set) var locatedRowID: String?
    private(set) var locationGeneration = 0
    private(set) var readAt: String?
    var wrapsLines = true
    var rendersMarkdown = true
    private(set) var previewSide: String?
    private(set) var isReferencing = false
    private(set) var markdownDocument: MarkdownDocument?
    private(set) var displayRows: [WorkspaceFilesDisplayRow] = []
    @ObservationIgnored private let client: WorkspaceFilesClient
    @ObservationIgnored private var owner: WorkspaceFilesOwner?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var locationRequestGeneration = 0
    @ObservationIgnored private var locationRead: (key: String, intentID: String)?
    private(set) var pending: [String: String] = [:]
    private var pages: [String: [WorkspaceFilesData]] = [:]
    private var recency: [String] = []
    private(set) var retainedBytes = 0
    private var userSelectedRange = false

    init(sessionId: String, mode: WorkspaceFilesScopeMode, tab: WorkspaceFilesTab, client: WorkspaceFilesClient) {
        self.sessionId = sessionId; self.mode = mode; self.initialTab = tab
        self.tab = tab; self.client = client
    }

    var isReading: Bool { !pending.isEmpty }
    var canRead: Bool { phase == .ready && client.availability() == nil && client.owner() == owner }
    var canReopen: Bool { client.owner() != nil && client.availability() == nil && phase != .opening && phase != .closing }
    var rangeSummary: WorkspaceFilesSummary? {
        guard let ranges = pages[changesKey]?.first?.ranges else { return nil }
        return range == .unstaged ? ranges.unstaged : ranges.staged
    }
    var changes: [WorkspaceFileEntry] { pages[changesKey]?.flatMap { $0.entries ?? [] } ?? [] }
    var searchEntries: [WorkspaceFileEntry] { pages[searchKey]?.flatMap { $0.entries ?? [] } ?? [] }
    var searchLastPage: WorkspaceFilesData? { pages[searchKey]?.last }
    var changesLastPage: WorkspaceFilesData? { pages[changesKey]?.last }
    var contentPages: [WorkspaceFilesData] { pages[contentKey] ?? [] }
    var contentLastPage: WorkspaceFilesData? { contentPages.last }
    var contentIsPreview: Bool { previewSide != nil || { if case .disk? = selected { return true }; return false }() }
    var treeRows: [WorkspaceFileTreeRow] {
        guard let root = scope?.rootEntryId else { return [] }
        var result: [WorkspaceFileTreeRow] = []
        func append(_ id: String, depth: Int) {
            guard depth <= 256 else { return }
            for entry in pages[directoryKey(id)]?.flatMap({ $0.entries ?? [] }) ?? [] {
                result.append(WorkspaceFileTreeRow(entry: entry, depth: depth))
                if entry.isDirectory, expanded.contains(entry.id), let child = entry.entryId {
                    append(child, depth: depth + 1)
                }
            }
        }
        append(root, depth: 0)
        return result
    }

    func open() async {
        guard phase == .closed else { return }
        if let unavailable = client.availability() { failure = unavailable; return }
        owner = client.owner(); phase = .opening; failure = nil
        var request = intent(.open); request.scopeMode = mode
        guard let result = await fetch(request, key: "open"), let opened = Self.scope(from: result.data) else { return }
        scope = opened; phase = .ready
        await loadSelectedTab()
    }

    func refresh() async {
        guard canRead, let scope else { checkConnectivity(); return }
        cancelPending()
        var request = intent(.refresh, scope: scope)
        request.expectedContextVersion = scope.contextVersion
        guard let result = await fetch(request, key: "refresh"), let refreshed = Self.scope(from: result.data) else { return }
        clearPages(); expanded.removeAll(); selected = nil; previewSide = nil; selectedChangeSetVersion = nil
        resetSearchPresentation()
        self.scope = refreshed; failure = nil; phase = .ready
        await loadSelectedTab()
    }

    func reopen() async {
        guard canReopen else { checkConnectivity(); return }
        await close(); phase = .closed; await open()
    }

    func switchScope(_ mode: WorkspaceFilesScopeMode) async {
        guard self.mode != mode else { return }
        await close(); self.mode = mode; userSelectedRange = false; range = .unstaged
        resetSearchPresentation(); await open()
    }

    func close() async {
        guard phase != .closed, phase != .closing else { return }
        let closingScope = scope
        phase = .closing; cancelPending(); scope = nil
        selected = nil; selectedChangeSetVersion = nil; expanded.removeAll(); clearPages()
        if let closingScope, let owner {
            let request = intent(.close, scope: closingScope)
            _ = try? await client.send(request, owner)
        }
        phase = .closed
    }

    func checkConnectivity() {
        guard phase != .closed, phase != .closing else { return }
        let current = client.owner()
        if current == nil || owner == nil || !current!.sameTarget(as: owner!) {
            cancelPending(); clearPages(); scope = nil; selected = nil; selectedChangeSetVersion = nil; expanded.removeAll()
            phase = .stale
            failure = WorkspaceFilesFailure(code: "scope_stale", message: "会话已改变，请重新打开。")
        } else if let unavailable = client.availability() {
            cancelPending(); failure = unavailable
            if unavailable.code == "session_ended" || unavailable.code == "permission_denied" {
                clearPages(); scope = nil; selected = nil; selectedChangeSetVersion = nil; expanded.removeAll(); phase = .stale
            } else { phase = unavailable.code == "desktop_offline" ? .offlineSnapshot : .stale }
        } else if current != owner || phase == .offlineSnapshot {
            phase = .stale
            failure = WorkspaceFilesFailure(code: "scope_stale", message: "连接已恢复，请重新打开。")
        }
    }

    func selectTab(_ value: WorkspaceFilesTab) async {
        if value == .changed { clearSearch(); resetSearchPresentation() }
        tab = value
        await restoreBrowser()
    }

    private func loadSelectedTab() async {
        guard canRead, let scope else { return }
        if tab == .all {
            if pages[directoryKey(scope.rootEntryId)] == nil { await loadDirectory(scope.rootEntryId) }
        } else if scope.gitAvailable {
            if pages[changesKey] == nil { await loadChanges() }
        }
    }

    /// LRU recovery starts the current browser at page zero. It is invoked by
    /// returning to the browser or an explicit reread, never by cache eviction.
    func restoreBrowser() async {
        guard canRead else { return }
        if tab == .all, !searchQuery.isEmpty {
            if pages[searchKey] == nil { await submitSearch(searchQuery) }
        } else {
            await loadSelectedTab()
        }
    }

    func toggleDirectory(_ entry: WorkspaceFileEntry) async {
        guard entry.isDirectory, let id = entry.entryId else { return }
        if expanded.remove(id) != nil { return }
        expanded.insert(id)
        if pages[directoryKey(id)] == nil { await loadDirectory(id) }
    }

    func directoryPage(_ id: String) -> WorkspaceFilesData? { pages[directoryKey(id)]?.last }
    func directoryIsLoading(_ id: String) -> Bool { pending[directoryKey(id)] != nil }

    func loadDirectory(_ id: String, next: Bool = false) async {
        _ = await readDirectory(id, next: next)
    }

    private func readDirectory(_ id: String, next: Bool = false, locationTicket: Int? = nil) async -> Bool {
        guard canRead, let scope else { checkConnectivity(); return false }
        let key = directoryKey(id)
        if let locationTicket {
            guard locationTicket == locationRequestGeneration else { return false }
            guard pending[key] == nil else {
                failure = WorkspaceFilesFailure(code: "busy", message: "目录正在读取，请稍后重试。")
                return false
            }
        }
        var request = intent(.directory, scope: scope); request.directoryEntryId = id
        if next { guard let cursor = pages[key]?.last?.nextCursor else { return false }; request.cursor = cursor }
        if locationTicket != nil { locationRead = (key, request.intentId) }
        defer { if locationRead?.intentID == request.intentId { locationRead = nil } }
        guard let result = await fetch(request, key: key) else { return false }
        if let locationTicket, locationTicket != locationRequestGeneration { return false }
        store(result.data, key: key, next: next, version: { $0.directoryVersion })
        return failure == nil
    }

    func submitSearch(_ query: String, next: Bool = false) async {
        guard canRead, let scope else { checkConnectivity(); return }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { clearSearch(); return }
        guard trimmed.utf16.count <= 256, trimmed.utf8.count <= 1024 else {
            failure = WorkspaceFilesFailure(code: "invalid_request", message: "搜索词过长。")
            return
        }
        if !next, trimmed == searchQuery, pending[searchKey] != nil { return }
        if !next { invalidateLocation(); cancel(key: searchKey); removePage(forKey: searchKey); searchQuery = trimmed }
        let key = searchKey
        var request = intent(.search, scope: scope); request.query = searchQuery
        if next { guard let cursor = pages[key]?.last?.nextCursor else { return }; request.cursor = cursor }
        guard let result = await fetch(request, key: key) else { return }
        store(result.data, key: key, next: next, version: { $0.searchVersion })
    }

    func searchEdited() { clearSearch() }
    func clearSearch() {
        invalidateLocation()
        cancel(key: searchKey); removePage(forKey: searchKey); searchQuery = ""
    }

    private func resetSearchPresentation() {
        searchQuery = ""; searchResetGeneration &+= 1
    }

    func locate(_ entry: WorkspaceFileEntry) async {
        guard canRead, let frozenScope = scope, let frozenOwner = owner else { checkConnectivity(); return }
        clearSearch(); resetSearchPresentation(); tab = .all
        let ticket = locationRequestGeneration, contextTicket = generation
        locationState = .locating; failure = nil
        func isCurrent() -> Bool {
            ticket == locationRequestGeneration && contextTicket == generation &&
                scope == frozenScope && owner == frozenOwner && client.owner() == frozenOwner && canRead
        }
        defer {
            if ticket == locationRequestGeneration, locationState == .locating {
                if isCurrent() {
                    locationState = .failed
                    if failure == nil { failure = WorkspaceFilesFailure(code: "content_stale", message: "条目已改变，请刷新。") }
                } else { invalidateLocation(); checkConnectivity() }
            }
        }
        let components = entry.relativePath.split(separator: "/").map(String.init)
        guard !components.isEmpty else { return }
        var parent = frozenScope.rootEntryId, prefix: [String] = []
        for (index, component) in components.enumerated() {
            guard isCurrent() else { return }
            prefix.append(component)
            let relative = prefix.joined(separator: "/"), key = directoryKey(parent)
            if pages[key] == nil {
                guard await readDirectory(parent, locationTicket: ticket), isCurrent() else { return }
            }
            var visitedCursors: Set<String> = []
            func matchingEntry() -> WorkspaceFileEntry? {
                pages[key]?.flatMap { $0.entries ?? [] }.first { $0.relativePath.utf8.elementsEqual(relative.utf8) }
            }
            while matchingEntry() == nil, let cursor = pages[key]?.last?.nextCursor {
                guard visitedCursors.insert(cursor).inserted else { return }
                guard await readDirectory(parent, next: true, locationTicket: ticket), isCurrent() else { return }
            }
            guard let found = matchingEntry() else {
                if let last = pages[key]?.last, last.collectionComplete == false || last.completion == "truncated" {
                    failure = WorkspaceFilesFailure(code: "limit_exceeded", message: "目录超出读取上限，无法定位此条目。")
                }
                return
            }
            if index == components.count - 1 {
                guard isCurrent() else { return }
                guard treeRows.contains(where: { $0.id == found.id }) else {
                    failure = WorkspaceFilesFailure(code: "limit_exceeded", message: "内容超出手机内存预算，请缩小范围。")
                    return
                }
                await select(nil)
                guard isCurrent() else { return }
                locatedRowID = found.id; locationState = .located; locationGeneration &+= 1
            } else {
                guard found.isDirectory, let childId = found.entryId else { return }
                expanded.insert(childId); parent = childId
            }
        }
    }

    func selectRange(_ value: WorkspaceFilesChangeRange) async {
        userSelectedRange = true; range = value; selected = nil; previewSide = nil; selectedChangeSetVersion = nil
        if pages[changesKey] == nil { await loadChanges() }
    }

    func loadChanges(next: Bool = false) async {
        guard canRead, let scope, scope.gitAvailable else { checkConnectivity(); return }
        let key = changesKey
        var request = intent(.changes, scope: scope); request.changeRange = range
        if next { guard let cursor = pages[key]?.last?.nextCursor else { return }; request.cursor = cursor }
        guard let result = await fetch(request, key: key) else { return }
        store(result.data, key: key, next: next, version: { $0.changeSetVersion })
        if !next, !userSelectedRange, range == .unstaged,
           let stats = result.data.ranges, stats.unstaged.collectionComplete == true,
           stats.staged.collectionComplete == true, stats.unstaged.fileCount == 0,
           (stats.staged.fileCount ?? 0) > 0 {
            range = .staged; await loadChanges()
        }
    }

    func select(_ selection: WorkspaceFilesSelection?) async {
        guard canRead else { checkConnectivity(); return }
        if selection != nil { invalidateLocation() }
        if self.selected == selection, previewSide == nil, contentLastPage != nil { return }
        cancel(key: contentKey); removePage(forKey: contentKey)
        markdownDocument = nil
        displayRows = []
        selected = selection; previewSide = nil
        if case .change? = selection { selectedChangeSetVersion = pages[changesKey]?.first?.changeSetVersion }
        else { selectedChangeSetVersion = nil }
        contentFailureAtEnd = false
        guard selection != nil else { await restoreBrowser(); return }
        await loadContent()
    }

    func preview(_ side: String) async {
        cancel(key: contentKey); removePage(forKey: contentKey)
        markdownDocument = nil
        displayRows = []
        contentFailureAtEnd = false
        previewSide = side; await loadContent()
    }

    func loadContent(next: Bool = false) async {
        guard canRead, let scope, let selected else { checkConnectivity(); return }
        let selectedVersion = selectedChangeSetVersion
        let key = contentKey
        var request: MobileIntentRequest
        switch selected {
        case .disk(let entry):
            guard entry.canPreview == true, let id = entry.entryId else { return }
            request = intent(.preview, scope: scope)
            request.target = WorkspaceFilesPreviewTarget(source: "disk", entryId: id)
        case .change(let entry):
            guard let id = entry.changeId, let version = selectedVersion else { return }
            if let previewSide {
                request = intent(.preview, scope: scope)
                request.target = WorkspaceFilesPreviewTarget(source: "change", changeId: id, changeSetVersion: version, side: previewSide)
            } else {
                request = intent(.diff, scope: scope); request.changeId = id; request.changeSetVersion = version
            }
        }
        if next {
            guard let last = pages[key]?.last, let cursor = last.nextCursor else { return }
            request.cursor = cursor; request.expectedContentVersion = last.contentVersion
        }
        guard let result = await fetch(request, key: key) else {
            if next, failure != nil, self.selected == selected,
               selectedChangeSetVersion == selectedVersion,
               self.previewSide == request.target?.side, self.scope?.id == scope.id {
                contentFailureAtEnd = true
            }
            return
        }
        guard self.selected == selected, selectedChangeSetVersion == selectedVersion,
              self.previewSide == request.target?.side else { return }
        contentFailureAtEnd = false
        store(result.data, key: key, next: next, version: { $0.contentVersion })
        contentFailureAtEnd = next && failure != nil
        let contentTicket = generation
        let pagesToPrepare = contentPages
        let preparedRows = await Task.detached(priority: .userInitiated) {
            WorkspaceFilesContentModel.rows(from: pagesToPrepare)
        }.value
        guard contentTicket == generation, self.selected == selected, selectedChangeSetVersion == selectedVersion,
              self.previewSide == request.target?.side,
              contentLastPage?.contentVersion == result.data.contentVersion else { return }
        displayRows = preparedRows
        if result.data.format == "markdown", result.data.contentComplete == true {
            let source = contentPages.flatMap { $0.lines ?? [] }.map(\.text).joined(separator: "\n")
            // The general Markdown reader has no virtualized block parser. Keep its
            // formatted path to one display-page budget, with larger files in source.
            if source.utf8.count <= 64 * 1024 {
                let ticket = generation
                let version = result.data.contentVersion
                let document = await Task.detached(priority: .userInitiated) { MarkdownDocument(source) }.value
                guard ticket == generation, self.selected == selected, selectedChangeSetVersion == selectedVersion,
                      self.previewSide == request.target?.side,
                      contentLastPage?.format == "markdown",
                      contentLastPage?.contentVersion == version else { return }
                markdownDocument = document
            }
        }
    }

    func reference(_ entryId: String) async -> String? {
        guard canRead, let scope, !isReferencing else { checkConnectivity(); return nil }
        isReferencing = true; defer { isReferencing = false }
        var request = intent(.reference, scope: scope); request.entryId = entryId
        return await fetch(request, key: "reference")?.data.referenceText
    }

    func rejectReferenceInsertion() {
        failure = WorkspaceFilesFailure(code: "draft_changed", message: "输入草稿或会话已改变，请重新选择。")
    }

    func cancelPending() {
        invalidateLocation()
        generation += 1
        for key in Array(pending.keys) { cancel(key: key) }
    }

    private func cancel(key: String) {
        guard let target = pending.removeValue(forKey: key), let owner else { return }
        var request = intent(.cancel); request.targetIntentId = target
        if key != "open" { request.scopeId = scope?.id }
        Task { _ = try? await client.send(request, owner) }
    }

    private func invalidateLocation() {
        locationRequestGeneration &+= 1
        locatedRowID = nil; locationState = .idle
        if let read = locationRead, pending[read.key] == read.intentID { cancel(key: read.key) }
        locationRead = nil
    }

    private func fetch(_ request: MobileIntentRequest, key: String) async -> WorkspaceFilesResult? {
        guard let owner, client.owner() == owner else { checkConnectivity(); return nil }
        guard pending[key] == nil else { return nil }
        let ticket = generation
        pending[key] = request.intentId; failure = nil
        defer { if pending[key] == request.intentId { pending.removeValue(forKey: key) } }
        do {
            let result = try await client.send(request, owner).validated(for: request)
            guard ticket == generation, pending[key] == request.intentId, client.owner() == owner else {
                if request.operation == .open, let id = result.scopeId {
                    var close = intent(.close); close.scopeId = id
                    _ = try? await client.send(close, owner)
                }
                return nil
            }
            readAt = result.readAt
            return result
        } catch {
            guard ticket == generation, pending[key] == request.intentId else { return nil }
            let failure = error as? WorkspaceFilesFailure ?? .invalid
            self.failure = failure
            if failure.code == "session_ended" || failure.code == "permission_denied" {
                phase = .stale; cancelPending()
                clearPages(); scope = nil; selected = nil; expanded.removeAll()
            } else if ["scope_stale", "content_stale", "cursor_expired", "invalid_scope", "unsupported_version"].contains(failure.code) {
                phase = .stale; cancelPending()
            } else if failure.code == "desktop_offline" {
                phase = .offlineSnapshot; cancelPending()
            } else if phase == .opening { phase = .closed }
            return nil
        }
    }

    private func store(_ data: WorkspaceFilesData, key: String, next: Bool, version: (WorkspaceFilesData) -> String?) {
        let existing = pages[key] ?? []
        if next {
            guard let prior = existing.last, version(prior) == version(data) else { failure = .invalid; return }
            if data.pageIndex == prior.pageIndex {
                pages[key] = Array(existing.dropLast()) + [data]
            } else if data.pageIndex == (prior.pageIndex ?? -1) + 1 {
                pages[key] = existing + [data]
            } else { failure = .invalid; return }
        } else {
            guard data.pageIndex == 0 else { failure = .invalid; return }
            pages[key] = [data]
        }
        recency.removeAll { $0 == key }; recency.append(key); recount()
        // Conservatively account strings, array nodes and retained display-model overhead.
        while retainedBytes > 4 * 1024 * 1024, let oldest = recency.first {
            removePage(forKey: oldest)
            if oldest == contentKey { displayRows = []; markdownDocument = nil }
            if oldest == key { failure = WorkspaceFilesFailure(code: "limit_exceeded", message: "内容超出手机内存预算，请缩小范围。") }
        }
    }

    private func removePage(forKey key: String) {
        pages.removeValue(forKey: key)
        recency.removeAll { $0 == key }
        recount()
    }
    private func recount() { retainedBytes = pages.values.flatMap { $0 }.reduce(0) { $0 + Self.cost($1) } }
    private func clearPages() { invalidateLocation(); pages.removeAll(); recency.removeAll(); retainedBytes = 0; markdownDocument = nil; displayRows = []; contentFailureAtEnd = false }
    private static func cost(_ page: WorkspaceFilesData) -> Int {
        let entries = (page.entries ?? []).reduce(0) { $0 + 512 + ($1.relativePath.utf8.count + $1.name.utf8.count) * 4 }
        let hunks = (page.hunks ?? []).reduce(0) { sum, hunk in sum + 512 + hunk.lines.reduce(0) { $0 + 256 + $1.text.utf8.count * 4 } }
        let lines = (page.lines ?? []).reduce(0) { $0 + 256 + $1.text.utf8.count * 4 }
        return 1024 + entries + hunks + lines
    }
    private static func scope(from data: WorkspaceFilesData) -> WorkspaceFilesScope? {
        guard let id = data.scopeId, let root = data.rootEntryId, let mode = data.scopeMode,
              let name = data.rootDisplayName, let context = data.contextVersion, let git = data.gitAvailable else { return nil }
        return WorkspaceFilesScope(id: id, rootEntryId: root, mode: mode, rootDisplayName: name, contextVersion: context, gitAvailable: git, gitUnavailableReason: data.gitUnavailableReason)
    }
    private func intent(_ operation: WorkspaceFilesOperation, scope: WorkspaceFilesScope? = nil) -> MobileIntentRequest {
        var request = MobileIntentRequest(intentId: UUID().uuidString, kind: "workspaceFiles", sessionId: sessionId)
        request.filesVersion = 1; request.operation = operation
        if let scope {
            request.scopeId = scope.id
            if operation != .close { request.expectedContextVersion = scope.contextVersion }
        }
        return request
    }
    private var changesKey: String { "changes:\(range.rawValue)" }
    private var searchKey: String { "search:\(searchQuery)" }
    private var contentKey: String { "content" }
    private func directoryKey(_ id: String) -> String { "directory:\(id)" }
}
