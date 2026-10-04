import SwiftUI

/// Native sheet and list/detail navigation follow Apple's Sheets, Split views,
/// Searching and Accessibility guidance. NavigationSplitView adapts to the actual
/// available window, including an iPad page sheet and compact-height iPhone.
struct WorkspaceFilesPanel: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var flow: WorkspaceFilesFlow
    let onReference: (String) async -> Bool
    @State private var query = ""
    @State private var searchPresented = false
    @State private var preferredColumn: NavigationSplitViewColumn = .sidebar
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var detent: PresentationDetent = .medium

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility, preferredCompactColumn: $preferredColumn) {
            WorkspaceFilesBrowser(flow: flow, query: searchQuery, searchPresented: $searchPresented,
                preferredColumn: $preferredColumn, onSelect: selectContent, onReference: onReference, onClose: { dismiss() })
                .navigationTitle("工作区文件")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("关闭", systemImage: "xmark") { dismiss() }
                            .labelStyle(.iconOnly)
                            .accessibilityIdentifier("files-close")
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("刷新", systemImage: "arrow.clockwise") {
                            Task { await flow.refresh() }
                        }
                        .disabled(!flow.canRead || flow.isReading)
                        .labelStyle(.iconOnly)
                        .accessibilityIdentifier("files-refresh")
                        .keyboardShortcut("r", modifiers: .command)
                    }
                    if verticalSizeClass != .compact, UIDevice.current.userInterfaceIdiom == .phone {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(detent == .large ? "收起面板" : "展开面板",
                                systemImage: detent == .large ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                                detent = detent == .large ? .medium : .large
                            }
                            .labelStyle(.iconOnly)
                            .accessibilityIdentifier("files-detent-toggle")
                        }
                    }
                }
                .navigationSplitViewColumnWidth(min: 240, ideal: 340, max: 440)
        } detail: {
            if let selected = flow.selected {
                WorkspaceFilesContent(flow: flow, selection: selected, onReference: onReference,
                    onClose: { dismiss() }, onReveal: { Task { await flow.locate(selected.entry) } })
            } else {
                ContentUnavailableView("选择文件", systemImage: "doc.text")
            }
        }
        .navigationSplitViewStyle(.balanced)
        .presentationSizing(.page)
        .presentationDetents(verticalSizeClass == .compact ? [.large] : [.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .task {
            if verticalSizeClass == .compact || UIDevice.current.userInterfaceIdiom == .pad { detent = .large }
            await flow.open()
        }
        .onChange(of: flow.selected) { _, value in
            if value != nil { detent = .large; preferredColumn = .detail }
        }
        .onChange(of: flow.locationGeneration) { _, _ in
            guard flow.locationState == .located else { return }
            columnVisibility = .all
            preferredColumn = .sidebar
        }
        .onChange(of: verticalSizeClass) { _, value in if value == .compact { detent = .large } }
        .onChange(of: flow.searchResetGeneration) { _, _ in
            query = ""; searchPresented = false
        }
        .onChange(of: scenePhase) { flow.checkConnectivity() }
        .onDisappear { Task { await flow.close() } }
    }

    /// Opening an already-selected file is a new navigation action after Back.
    /// Activate the detail immediately; a later network result must not navigate.
    private func selectContent(_ selection: WorkspaceFilesSelection) {
        guard flow.canRead, flow.scope != nil else { flow.checkConnectivity(); return }
        detent = .large
        preferredColumn = .detail
        Task { await flow.select(selection) }
    }

    /// User editing invalidates an in-flight search or location. A programmatic
    /// scope/location reset assigns query directly and must not cancel itself.
    private var searchQuery: Binding<String> {
        Binding(get: { query }, set: { value in
            guard value != query else { return }
            query = value
            if !value.isEmpty { detent = .large }
            flow.searchEdited()
        })
    }

}

/// Observes the browser state in its own body, independently of navigation.
private struct WorkspaceFilesBrowser: View {
    @Bindable var flow: WorkspaceFilesFlow
    @Binding var query: String
    @Binding var searchPresented: Bool
    @Binding var preferredColumn: NavigationSplitViewColumn
    let onSelect: (WorkspaceFilesSelection) -> Void
    let onReference: (String) async -> Bool
    let onClose: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var appliedLocationGeneration: Int?

    private var browserRole: WorkspaceFilesBrowserRole {
        flow.tab == .changed ? .changes : flow.searchQuery.isEmpty ? .tree : .search
    }

    private var scrollsControls: Bool {
        dynamicTypeSize.isAccessibilitySize || verticalSizeClass == .compact
    }

    var body: some View {
        let locationGeneration = flow.locationGeneration
        return VStack(spacing: 0) {
            if !scrollsControls { browserControls }
            browserList
        }
            .onChange(of: locationGeneration) { _, _ in
                guard flow.locationState == .located else { return }
                preferredColumn = .sidebar
            }
    }

    private var browserList: some View {
        let rows = nativeRows
        let scope = flow.scope
        let ownerContext = scope.map { "\($0.id)|\($0.contextVersion)" } ?? flow.id.uuidString
        let viewContext = browserRole.rawValue
        let location = preferredColumn == .sidebar && flow.locationState == .located
            && appliedLocationGeneration != flow.locationGeneration
            ? flow.locatedRowID.map { WorkspaceFilesNativeLocation(rowID: $0, generation: flow.locationGeneration) } : nil
        let estimateIntent = flow.locationState == .locating || flow.locationState == .located
            ? flow.searchResetGeneration : nil
        return WorkspaceFilesNativeTable(rows: rows, ownerContext: ownerContext,
                    viewContext: viewContext, location: location, dynamicTypeSize: dynamicTypeSize,
                    estimateIntent: estimateIntent,
                    resetTokens: ["search": flow.searchQuery, "changes": flow.range.rawValue],
                    separatorStyle: rows.contains { $0.kind == .gitUnavailable } ? .none : .singleLine,
                    selectedRowID: horizontalSizeClass == .regular ? flow.selected?.entry.id : nil,
                    keepsSelection: horizontalSizeClass == .regular,
                    heightClass: { row in
                        guard row.entry?.isDirectory == false else { return nil }
                        switch row.kind {
                        case .tree: return .file
                        case .search: return .searchFile
                        default: return nil
                        }
                    },
                    cellIdentifier: { $0.accessibilityIdentifier },
                    nativeItem: nativeItem,
                    onPrimaryAction: { row in
                        guard flow.canRead, let entry = row.entry else { flow.checkConnectivity(); return }
                        if entry.isDirectory {
                            Task {
                                if row.kind == .search { await flow.locate(entry) }
                                else { await flow.toggleDirectory(entry) }
                            }
                        } else { onSelect(.disk(entry)) }
                    },
                    menuItems: nativeMenuItems,
                    onMenuAction: performNativeMenuAction,
                    content: { row in nativeContent(row) }, onLocationVisible: { receipt in
                        guard preferredColumn == .sidebar, flow.locationState == .located,
                              flow.locationGeneration == receipt.generation,
                              flow.locatedRowID == receipt.rowID, flow.scope?.id == scope?.id,
                              flow.scope?.contextVersion == scope?.contextVersion else { return }
                        appliedLocationGeneration = receipt.generation
                    })
        .accessibilityIdentifier("files-browser")
        .modifier(WorkspaceFilesSearch(isEnabled: flow.tab == .all, query: $query, isPresented: $searchPresented, submit: { submittedQuery in
            Task { await flow.submitSearch(submittedQuery) }
        }))
    }

    private var nativeRows: [WorkspaceFilesNativeBrowserRow] {
        var rows: [WorkspaceFilesNativeBrowserRow] = []
        if flow.scope != nil, scrollsControls {
            rows += [.control(.scopeControls), .control(.viewControls)]
            if flow.tab == .changed, flow.scope?.gitAvailable == true { rows.append(.control(.changeControls)) }
            if flow.phase == .offlineSnapshot { rows.append(.control(.snapshot)) }
        }
        if flow.failure != nil { rows.append(.control(.failure)) }
        if flow.phase == .opening { rows.append(.control(.opening)); return rows }
        guard flow.scope != nil else { return rows }
        if flow.tab == .all {
            if !flow.searchQuery.isEmpty {
                rows += flow.searchEntries.map { .entry($0, kind: .search) }
                if let page = flow.searchLastPage,
                   flow.searchEntries.isEmpty && page.scanComplete == true
                    || page.scanComplete == false || hasContinuation(page) {
                    rows.append(.control(.searchContinuation))
                }
            } else {
                for row in flow.treeRows {
                    rows.append(.entry(row.entry, kind: .tree, depth: row.depth, isExpanded: flow.expanded.contains(row.entry.id)))
                    if row.entry.isDirectory, let id = row.entry.entryId, flow.expanded.contains(id),
                       flow.directoryIsLoading(id) || flow.directoryPage(id).map(hasContinuation) == true {
                        rows.append(.directoryContinuation(row.entry, depth: row.depth + 1))
                    }
                }
                if let root = flow.scope?.rootEntryId,
                   flow.directoryIsLoading(root) || flow.directoryPage(root).map({
                       flow.treeRows.isEmpty && $0.collectionComplete == true || hasContinuation($0)
                   }) == true { rows.append(.control(.rootContinuation)) }
            }
        } else if flow.scope?.gitAvailable == true {
            rows += flow.changes.map { .entry($0, kind: .change) }
            if flow.isReading || flow.changes.isEmpty && flow.changesLastPage?.collectionComplete == true
                || flow.changesLastPage.map(hasContinuation) == true {
                rows.append(.control(.changeContinuation))
            }
        } else { rows.append(.control(.gitUnavailable)) }
        return rows
    }

    private func hasContinuation(_ page: WorkspaceFilesData) -> Bool {
        page.nextCursor != nil || page.completion == "truncated"
    }

    private func nativeItem(_ row: WorkspaceFilesNativeBrowserRow) -> WorkspaceFilesNativeEntry? {
        guard row.kind == .tree || row.kind == .search,
              let entry = row.entry else { return nil }
        let parent = (entry.relativePath as NSString).deletingLastPathComponent
        return WorkspaceFilesNativeEntry(title: entry.name,
            parentPath: row.kind == .search && !parent.isEmpty ? parent : nil,
            systemImage: entry.isDirectory ? "folder" : entry.kind == "symlink" ? "link" : "doc.text", depth: row.depth,
            accessibilityIdentifier: row.accessibilityIdentifier,
            accessibilityLabel: WorkspaceFilesContentLabels.entry(entry.relativePath, directory: entry.isDirectory),
            isDirectory: entry.isDirectory, isExpanded: row.isExpanded,
            actionsIdentifier: entry.isDirectory ? "files-directory-actions-\(entry.relativePath)" : nil,
            primaryActionHint: row.kind == .search && entry.isDirectory ? "在目录中显示" : nil,
            isEnabled: flow.canRead)
    }

    private func nativeMenuItems(_ row: WorkspaceFilesNativeBrowserRow) -> [WorkspaceFilesNativeMenuAction] {
        guard let entry = row.entry else { return [] }
        var items: [WorkspaceFilesNativeMenuAction] = []
        if entry.canReference == true, entry.entryId != nil {
            items.append(WorkspaceFilesNativeMenuAction(id: "insert", title: "插入到输入框", symbol: "text.insert",
                isEnabled: flow.canRead && !flow.isReferencing))
        }
        if row.kind == .search {
            items.append(WorkspaceFilesNativeMenuAction(id: "locate", title: "在目录中显示", symbol: "folder",
                isEnabled: flow.canRead && flow.locationState != .locating))
        }
        return items
    }

    private func performNativeMenuAction(_ row: WorkspaceFilesNativeBrowserRow, _ actionID: String) {
        guard let entry = row.entry else { return }
        switch actionID {
        case "insert": if let id = entry.entryId { insert(id) }
        case "locate": Task { await flow.locate(entry) }
        default: break
        }
    }

    @ViewBuilder private func nativeContent(_ row: WorkspaceFilesNativeBrowserRow) -> some View {
        switch row.kind {
        case .scopeControls: scopeControls
        case .viewControls: viewControls
        case .snapshot: snapshot
        case .failure: VStack(alignment: .leading) { failureContent }
        case .opening: ProgressView("等待电脑").accessibilityIdentifier("files-loading")
        case .gitUnavailable: ContentUnavailableView(gitUnavailableTitle, systemImage: "arrow.triangle.branch")
        case .search, .tree: EmptyView() // Native list content owns file and directory rows.
        case .directoryContinuation:
            if let entry = row.entry { directoryContinuation(entry, depth: row.depth) }
        case .change: if let entry = row.entry { changeRow(entry) }
        case .changeControls: VStack(alignment: .leading) { changeControls }
        case .searchContinuation: VStack(alignment: .leading) { searchContinuation }
        case .rootContinuation: VStack(alignment: .leading) { rootContinuation }
        case .changeContinuation: VStack(alignment: .leading) { changeContinuation }
        }
    }

    @ViewBuilder private var failureContent: some View {
        if let failure = flow.failure {
                Text(failure.message).foregroundStyle(Theme.failure)
                    .accessibilityIdentifier("files-error")
                if flow.phase == .stale || flow.phase == .offlineSnapshot || flow.phase == .closed {
                    Button { Task { await flow.reopen() } } label: {
                        Text("重新打开").frame(minHeight: Metrics.minimumTapTarget)
                    }
                        .disabled(!flow.canReopen)
                        .accessibilityIdentifier("files-reopen")
                }
        }
    }

    /// Keep ordinary controls compact; at accessibility sizes they become
    /// separate scrolling rows so they never consume the entire sheet viewport.
    private var browserControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            if flow.scope != nil {
                scopeControls
                viewControls
                if flow.tab == .changed, flow.scope?.gitAvailable == true { changeControls }
                snapshot
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var scopeControls: some View {
        if let scope = flow.scope {
            HStack(alignment: .center, spacing: 8) {
                Menu {
                    Picker("范围", selection: scopeSelection) {
                        Text("当前目录").tag(WorkspaceFilesScopeMode.currentDirectory)
                        Text("仓库").tag(WorkspaceFilesScopeMode.repository)
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "folder").accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(scope.rootDisplayName).font(.subheadline.weight(.semibold))
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                                .truncationMode(.middle)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(flow.mode == .repository ? "仓库" : "当前目录")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.down").font(.caption).accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .menuIndicator(.hidden)
                .disabled(!flow.canRead || flow.isReading)
                .accessibilityLabel("范围")
                .accessibilityValue("\(flow.mode == .repository ? "仓库" : "当前目录")，\(scope.rootDisplayName)")
                .accessibilityIdentifier("files-scope")
                Button { insert(scope.rootEntryId) } label: {
                    Label(scope.mode == .repository ? "插入仓库根目录" : "插入当前目录", systemImage: "text.insert")
                        .labelStyle(.iconOnly)
                        .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!flow.canRead || flow.isReferencing)
                .accessibilityIdentifier("files-root-reference")
            }
        }
    }

    private var scopeSelection: Binding<WorkspaceFilesScopeMode> {
        Binding(get: { flow.mode }, set: { mode in Task { await flow.switchScope(mode) } })
    }

    @ViewBuilder private var viewControls: some View {
        if dynamicTypeSize.isAccessibilitySize {
            WorkspaceFilesPickerRow("文件视图", value: flow.tab == .changed ? "已修改" : "所有文件", selection: tabSelection) {
                fileViews
            }
            .accessibilityIdentifier("files-tabs")
        } else {
            Picker("文件视图", selection: tabSelection) { fileViews }
                .pickerStyle(.segmented)
                .frame(minHeight: Metrics.minimumTapTarget)
                .accessibilityIdentifier("files-tabs")
        }
    }

    private var tabSelection: Binding<WorkspaceFilesTab> {
        Binding(get: { flow.tab }, set: { tab in Task { await flow.selectTab(tab) } })
    }

    private var fileViews: some View {
        Group {
            Text("所有文件").tag(WorkspaceFilesTab.all)
            Text("已修改").tag(WorkspaceFilesTab.changed)
        }
    }

    @ViewBuilder private var snapshot: some View {
        if flow.phase == .offlineSnapshot, let readAt = flow.readAt,
           let date = ISO8601DateFormatter.parseWireTimestamp(readAt) {
            Text("离线快照 · \(date.formatted(date: .abbreviated, time: .shortened))")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func directoryContinuation(_ entry: WorkspaceFileEntry, depth: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let id = entry.entryId {
                if flow.directoryIsLoading(id) { ProgressView("等待电脑") }
                if let last = flow.directoryPage(id) {
                    continuation(last) { await flow.loadDirectory(id, next: true) }
                        .accessibilityIdentifier("files-directory-next-\(entry.relativePath)")
                }
            }
        }
        .padding(.leading, CGFloat(WorkspaceFilesTreeMetrics.visualDepth(depth)) * WorkspaceFilesTreeMetrics.indentStep)
    }

    @ViewBuilder private var searchContinuation: some View {
        if flow.searchEntries.isEmpty, flow.searchLastPage?.scanComplete == true {
            Text("没有匹配的文件").foregroundStyle(.primary)
        }
        if let last = flow.searchLastPage {
            if last.scanComplete == false {
                Text("已扫描 \(last.scannedEntries ?? 0) 项，搜索尚未完成")
                    .font(.footnote).foregroundStyle(.primary)
            }
            continuation(last) { await flow.submitSearch(flow.searchQuery, next: true) }
        }
    }

    @ViewBuilder private var rootContinuation: some View {
        if let root = flow.scope?.rootEntryId {
            if flow.directoryIsLoading(root) { ProgressView("等待电脑") }
            if let last = flow.directoryPage(root) {
                if flow.treeRows.isEmpty, last.collectionComplete == true { Text("目录为空").foregroundStyle(.primary) }
                continuation(last) { await flow.loadDirectory(root, next: true) }
            }
        }
    }

    private var gitUnavailableTitle: String {
        switch flow.scope?.gitUnavailableReason {
        case "not_git_repository": "这个目录不是 Git 仓库"
        case "git_unavailable": "Git 不可用"
        case "external_filter_required": "仓库需要外部 Git 过滤器"
        case "permission_denied": "没有读取仓库的权限"
        case "unsafe_path": "仓库路径无法安全读取"
        case "limit_exceeded": "仓库超过读取限制"
        default: "无法查看 Git 更改"
        }
    }

    private var changeControls: some View {
        VStack(alignment: .leading, spacing: 4) {
            WorkspaceFilesPickerRow("更改范围", value: flow.range == .staged ? "已暂存" : "未暂存",
                selection: Binding(get: { flow.range }, set: { value in Task { await flow.selectRange(value) } })) {
                Text("未暂存").tag(WorkspaceFilesChangeRange.unstaged)
                Text("已暂存").tag(WorkspaceFilesChangeRange.staged)
            }
            .accessibilityIdentifier("files-change-range")
            if let summary = flow.rangeSummary { WorkspaceFilesStatistics(summary: summary) }
        }
    }

    private func changeRow(_ entry: WorkspaceFileEntry) -> some View {
        Button { onSelect(.change(entry)) } label: {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 8))
            layout {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.name).foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                        let parent = (entry.relativePath as NSString).deletingLastPathComponent
                        if !parent.isEmpty { Text(parent).font(.footnote).foregroundStyle(.secondary) }
                        Text(WorkspaceFilesContentLabels.status(entry.status))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "doc.text").foregroundStyle(.secondary).accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WorkspaceFilesCounts(additions: entry.additions, deletions: entry.deletions)
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("files-change-\(entry.relativePath)")
        .accessibilityLabel("\(WorkspaceFilesContentLabels.status(entry.status))，\(WorkspaceFilesContentLabels.entry(entry.relativePath, directory: false))")
        .accessibilityValue(WorkspaceFilesContentLabels.counts(entry.additions, entry.deletions))
        .accessibilityAddTraits(horizontalSizeClass == .regular && flow.selected?.entry.id == entry.id ? .isSelected : [])
    }

    @ViewBuilder private var changeContinuation: some View {
                if flow.changes.isEmpty, flow.changesLastPage?.collectionComplete == true {
                    Text("没有\(flow.range == .unstaged ? "未暂存" : "已暂存")更改").foregroundStyle(.primary)
                }
                if let last = flow.changesLastPage { continuation(last) { await flow.loadChanges(next: true) } }
                if flow.isReading { ProgressView("等待电脑") }
    }

    @ViewBuilder private func continuation(_ page: WorkspaceFilesData, action: @escaping () async -> Void) -> some View {
        if page.nextCursor != nil {
            Button { Task { await action() } } label: {
                Text(flow.searchQuery.isEmpty ? "加载更多" : "继续搜索")
                    .frame(minHeight: Metrics.minimumTapTarget)
            }
                .disabled(!flow.canRead || flow.isReading)
        } else if page.completion == "truncated" {
            Text(page.truncatedReason ?? "结果已截断，请缩小范围。")
                .font(.footnote).foregroundStyle(.primary)
        }
    }

    private func insert(_ entryId: String) {
        Task { if await onReference(entryId) { onClose() } }
    }
}

private enum WorkspaceFilesBrowserRole: String { case tree, search, changes }

/// Stable IDs identify the rendered item. Immutable metadata determines whether
/// an existing native cell needs reconfiguration; all business state stays in Flow.
private struct WorkspaceFilesNativeBrowserRow: Identifiable, Equatable {
    enum Kind: String { case scopeControls, viewControls, snapshot, failure, opening, gitUnavailable, tree, search, change,
        changeControls, directoryContinuation, searchContinuation, rootContinuation, changeContinuation }
    let id: String
    let kind: Kind
    let entry: WorkspaceFileEntry?
    let depth: Int
    let isExpanded: Bool

    var accessibilityIdentifier: String {
        guard let entry else { return id }
        switch kind {
        case .tree: return "files-entry-\(entry.relativePath)"
        case .search: return "files-search-result-\(entry.relativePath)"
        case .change: return "files-change-\(entry.relativePath)"
        default: return id
        }
    }

    static func control(_ kind: Kind) -> Self {
        Self(id: "files-browser-\(kind.rawValue)", kind: kind, entry: nil, depth: 0, isExpanded: false)
    }
    static func directoryContinuation(_ entry: WorkspaceFileEntry, depth: Int) -> Self {
        Self(id: "files-directory-continuation-\(entry.id)", kind: .directoryContinuation, entry: entry, depth: depth, isExpanded: false)
    }
    static func entry(_ entry: WorkspaceFileEntry, kind: Kind, depth: Int = 0, isExpanded: Bool = false) -> Self {
        Self(id: entry.id, kind: kind, entry: entry, depth: depth, isExpanded: isExpanded)
    }
}

/// Keep the native picker and its selection while giving both label and value
/// their own row at accessibility sizes, as in Apple's AnyLayout example.
private struct WorkspaceFilesPickerRow<Selection: Hashable, Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: LocalizedStringKey
    let value: String
    @Binding var selection: Selection
    let content: Content

    init(_ title: LocalizedStringKey, value: String, selection: Binding<Selection>, @ViewBuilder content: () -> Content) {
        self.title = title
        self.value = value
        self._selection = selection
        self.content = content()
    }

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading))
            : AnyLayout(HStackLayout())
        layout {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
            Menu {
                Picker(title, selection: $selection) { content }
            } label: {
                HStack {
                    Text(value).lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                    Image(systemName: "chevron.down").font(.caption).accessibilityHidden(true)
                }
                .font(.body)
                .frame(minHeight: Metrics.minimumTapTarget)
            }
            .menuIndicator(.hidden)
            .accessibilityLabel(Text(title))
            .accessibilityValue(value)
            .frame(maxWidth: .infinity, alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        }
        .frame(minHeight: Metrics.minimumTapTarget)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct WorkspaceFilesCounts: View {
    let additions: Int?
    let deletions: Int?
    var body: some View {
        Text("\(additions.map { "+\($0)" } ?? "新增未计算")  \(deletions.map { "−\($0)" } ?? "删除未计算")")
            .font(.footnote.monospacedDigit()).foregroundStyle(.primary)
            .accessibilityLabel(WorkspaceFilesContentLabels.counts(additions, deletions))
    }
}
struct WorkspaceFilesStatistics: View {
    let summary: WorkspaceFilesSummary
    var body: some View {
        HStack {
            Text(summary.fileCount.map { "\($0) 个文件" } ?? "文件数未计算")
            Spacer()
            WorkspaceFilesCounts(additions: summary.additions, deletions: summary.deletions)
        }
        .font(.footnote)
    }
}

enum WorkspaceFilesContentLabels {
    static func counts(_ additions: Int?, _ deletions: Int?) -> String {
        "新增\(additions.map(String.init) ?? "未计算")行，删除\(deletions.map(String.init) ?? "未计算")行"
    }
    static func entry(_ relativePath: String, directory: Bool) -> String {
        let components = relativePath.split(separator: "/").map(String.init)
        guard let name = components.last else { return directory ? "目录" : "文件" }
        let parents = components.dropLast().map { "目录，\(identifier($0))" }
        let target = directory ? "目录，\(identifier(name))" : filename(name)
        return (parents + [target]).joined(separator: "，")
    }

    static func filename(_ name: String) -> String {
        let path = name as NSString
        let ext = path.pathExtension
        let stem = identifier(ext.isEmpty ? name : path.deletingPathExtension)
        return ext.isEmpty ? "文件名，\(stem)" : "文件名，\(stem)，扩展名 \(identifier(ext))"
    }

    private static func identifier(_ value: String) -> String {
        value.replacingOccurrences(of: ".", with: " 点 ")
            .replacingOccurrences(of: "_", with: " 下划线 ")
    }

    static func status(_ value: String?) -> String {
        switch value {
        case "modified": "已修改"
        case "added": "新增"
        case "deleted": "已删除"
        case "renamed": "已重命名"
        case "untracked": "未跟踪"
        case "conflict": "冲突"
        case "type_changed": "类型已改变"
        case "gitlink": "子模块指针"
        default: "文件"
        }
    }
    static func contentState(_ value: String?) -> String {
        switch value {
        case "binary": "二进制文件，无法显示文本。"
        case "unsupported_encoding": "文件不是有效的 UTF-8 文本。"
        case "external_filter_required": "文件需要外部 Git 过滤器，无法只读预览。"
        case "absent": "此比较侧没有文件。"
        case "gitlink": "仅显示子模块指针更改。"
        case "conflict": "文件存在冲突。"
        case "type_change": "文件类型已改变。"
        case "special_file": "不支持预览链接或特殊文件。"
        case "limit_exceeded": "文件超出预览上限。"
        case "unsupported_platform": "电脑平台不支持此操作。"
        default: "这个文件无法显示文本。"
        }
    }
}

/// Search belongs to the file browser, and only sends a read on explicit submit.
private struct WorkspaceFilesSearch: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let isEnabled: Bool
    @Binding var query: String
    @Binding var isPresented: Bool
    @State private var isComposing = false
    let submit: (String) -> Void

    @ViewBuilder func body(content: Content) -> some View {
        if isEnabled {
            // An inline system field keeps the explicit submit and clearing
            // actions reachable at every supported content size.
            VStack(spacing: 0) {
                // The opaque table must not paint over the native field's shadow.
                inlineSearch.zIndex(1)
                content
            }
        } else { content }
    }

    private var inlineSearch: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading))
            : AnyLayout(HStackLayout())
        return layout {
            HStack {
                WorkspaceFilesNativeSearchField(text: $query, isPresented: $isPresented, isComposing: $isComposing, submit: submit)
            }
            HStack {
                Button(action: performSearch) {
                    Text("搜索").frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                }
                .buttonStyle(.plain)
                .disabled(isComposing || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("files-search-submit")
            }
        }
        .font(.body)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func performSearch() {
        guard !isComposing else { return }
        let submittedQuery = query
        isPresented = false
        submit(submittedQuery)
    }
}
