import SwiftUI
import UIKit

// MARK: - 一页

/// 浏览列栈上的一页：根，或者一个文件夹。
///
/// 页与「层」是同一个东西，只是两处叫法：页是栈上的那一格，层是 store 里那一份快照。
/// 把文件夹本身（而不是一个 id）带在页上，是因为标题、下钻的目标、面包屑都以它为准，
/// 而它从哪来就是哪一层，改名之后也不该在两处说两个名字。
enum DriveBrowserLayer: Hashable {
    case root
    case folder(DriveBrowserItem)

    /// 这一页对应哪一层。根那一层用 `DrivePath.rootId` 认。
    var id: String {
        switch self {
        case .root: return DrivePath.rootId
        case .folder(let item): return item.id
        }
    }

    var isRoot: Bool { self == .root }

    /// 这一层在服务端那边的文件夹 id；根层是 nil（服务端把根当成「没有父级」，
    /// 而 `"root"` 在它那边是一个要去库里找的真实文件夹，`DriveStore.folderId` 记着这条）。
    ///
    /// 上传落到哪儿、顶部那一组上传行给谁看，认的都是它。
    var folderId: String? {
        switch self {
        case .root: return nil
        case .folder(let item): return item.id
        }
    }

    /// store 现在加载的就是这一页吗。
    ///
    /// 不是的话（还没取回来、或者回退动画里被压在后面的那一页）画占位，绝不画别人那一层
    /// 的内容 —— 一页的标题说 A、列表显示 B 是这一屏最容易出的一种错。
    ///
    /// 一层都还没加载出来时（刚进这一屏）根页按「是」算：那一刻在飞的那一趟正是为它
    /// 取的数，失败时那一行错误也该落在它上面。
    func isCurrent(in store: DriveStore) -> Bool {
        guard let current = store.current else { return isRoot }
        return current.current.id == id
    }
}

// MARK: - 一行

/// 一行文件 / 文件夹在屏幕上那两行字。
enum DriveBrowserRow {
    /// 读不出来的那一格。
    static let unreadable = "—"

    /// 副标题：文件是「大小 · 修改时间」，文件夹只有修改时间（Spec §4.2）。
    ///
    /// 大小的第一个判据是 `sizeBytes`（`Int64?`）而不是那个字符串：`DriveText.bytes(_:)`
    /// 把「读不出的大小」和「0 字节」渲染成同一个结果，而超出 `Int64` 的 `size` 字符串
    /// 正好落进前一种 —— 那会把一个超大文件说成空的。读不出来就说「—」。
    static func subtitle(for item: DriveBrowserItem) -> String {
        let updated = updatedAt(item)
        guard !item.isFolder else { return updated }
        return "\(size(item)) · \(updated)"
    }

    static func size(_ item: DriveBrowserItem) -> String {
        guard let bytes = item.sizeBytes else { return unreadable }
        return DriveText.bytes(String(bytes))
    }

    /// 修改时间。服务端的时间戳认不出来时（`DriveText.date` 给空串）说「—」，不留一格空白。
    static func updatedAt(_ item: DriveBrowserItem) -> String {
        let text = DriveText.date(item.updatedAt)
        return text.isEmpty ? unreadable : text
    }

    /// 这一行有没有分享：行尾那枚 `link` 符号（Spec §4.3）。
    static func isShared(_ item: DriveBrowserItem) -> Bool {
        !(item.shareUrl ?? "").isEmpty
    }

    /// 长按菜单里头一条的叫法：文件夹是「打开」，文件是「预览」。
    static func openLabel(_ item: DriveBrowserItem) -> String {
        item.isFolder ? "打开" : "预览"
    }

    /// 这一项能不能直接导出成文件。
    ///
    /// 文件夹不能：服务端那条下载路由认的是单个文件，文件夹要打包（`canZip`）才是另一条
    /// 事，而这一屏没有打包入口。菜单里这一条**置灰**而不是藏起来 —— 消失的菜单项会让
    /// 用户以为这一版没有导出。
    static func canExport(_ item: DriveBrowserItem) -> Bool {
        !item.isFolder
    }
}

/// 大标题下面那一行「N 项 · 按名称升序」。
enum DriveBrowserHeader {
    /// 排序方向的说法。菜单里的两项与这一行共用，免得两处各写一份。
    static func direction(ascending: Bool) -> String {
        ascending ? "升序" : "降序"
    }

    static func countLine(count: Int, key: DriveSortKey, ascending: Bool) -> String {
        "\(count) 项 · 按\(key.label)\(direction(ascending: ascending))"
    }
}

// MARK: - 多选

/// 多选那一套纯计算。
enum DriveBrowserSelection {
    /// 底部工具条左边那一句。
    static func countLabel(_ count: Int) -> String {
        "已选 \(count) 项"
    }

    /// 这一层是不是全被选上了。
    static func isAll(picked: Set<String>, in items: [DriveBrowserItem]) -> Bool {
        !items.isEmpty && items.allSatisfy { picked.contains($0.id) }
    }

    /// 右上那一颗上的字：全选上了就是「取消全选」。
    static func toggleTitle(picked: Set<String>, in items: [DriveBrowserItem]) -> String {
        isAll(picked: picked, in: items) ? "取消全选" : "全选"
    }

    /// 按一下那一颗之后选中的应该是哪些。
    static func toggled(picked: Set<String>, in items: [DriveBrowserItem]) -> Set<String> {
        isAll(picked: picked, in: items) ? [] : Set(items.map(\.id))
    }

    /// 一条选中的项。项不见了（别人删了、这一层重取过）就落成空的。
    static func items(_ picked: Set<String>, in items: [DriveBrowserItem]) -> [DriveBrowserItem] {
        items.filter { picked.contains($0.id) }
    }
}

// MARK: - 上传那一组

/// 组里一项在界面上的一句话。
enum DriveUploadRow {
    /// 这一项此刻在做什么。
    static func detail(_ item: DriveUploadItem) -> String {
        switch item.state {
        case .queued:
            return "等待上传"
        case .awaitingOverwrite:
            return "已有同名文件"
        case .uploading:
            return "\(Int((item.progress * 100).rounded()))%"
        case .completed:
            return "已完成"
        case .failed(let message):
            return message
        }
    }

    /// 这一行画不画进度条。
    ///
    /// 只有真的在排、在传的项画：等待确认覆盖的那一项一个字节都没发出去，画一条 0% 的
    /// 进度条是在说一件没发生的事。
    static func showsProgress(_ item: DriveUploadItem) -> Bool {
        switch item.state {
        case .queued, .uploading: return true
        case .awaitingOverwrite, .completed, .failed: return false
        }
    }

    /// 这一项还在动，右侧那一颗是「取消」。
    static func isRunning(_ item: DriveUploadItem) -> Bool {
        switch item.state {
        case .queued, .uploading, .awaitingOverwrite: return true
        case .completed, .failed: return false
        }
    }

    /// 这一项卡在「目标位置已经有同名文件」上，等用户点头。
    ///
    /// 队列的约定是**不确认就不覆盖**（`DriveUploader`），所以这一组必须给出那一颗：
    /// 不给的话这一项只能被取消，用户永远传不上去。
    static func needsOverwrite(_ item: DriveUploadItem) -> Bool {
        if case .awaitingOverwrite = item.state { return true }
        return false
    }
}

// MARK: - 用量

/// 列表最底下那一行用量。
enum DriveUsageRow {
    /// 「已用 1.4 GB / 5 GB」。读不出来时这一行整个不显示 —— 一个半截的「已用 」比没有
    /// 这一行更糟。
    static func text(for usage: DriveUsage?) -> String? {
        guard let usage, let used = usage.used, let quota = usage.quota else { return nil }
        return "已用 \(DriveText.bytes(String(used))) / \(DriveText.bytes(String(quota)))"
    }
}

// MARK: - 交给调用方的动作

/// 行菜单、左滑与底部工具条上那些「要问调用方」的动作。
///
/// 收成一个值而不是十几条闭包参数：同一件事在三处入口都要用，而且列表不该知道那些动作
/// 是怎么完成的（开哪张 sheet、要不要二次确认、改完清不清选择）—— 那都是这一屏的事。
struct DriveBrowserActions {
    /// 有一件事在办。办的时候改名 / 移动到 / 删除一起置灰，免得两件事撞在同一层上。
    let busy: Bool
    /// 有一批导出正在下。只置灰「导出」那一项：这一屏只有一个 `share` 槽，第二趟会把
    /// 在飞的那一趟取消掉，而下这一批不碰这一层的任何一行，其余动作不必跟着停。
    let exporting: Bool
    let open: (DriveBrowserItem) -> Void
    let rename: (DriveBrowserItem) -> Void
    let move: ([DriveBrowserItem]) -> Void
    let share: (DriveBrowserItem) -> Void
    let info: (DriveBrowserItem) -> Void
    let export: ([DriveBrowserItem]) -> Void
    let trash: ([DriveBrowserItem]) -> Void
    /// 根层底部那两个入口。它们是整屏的列表页（Task 9 那三张中的两张），不是一层文件夹，
    /// 所以不走 `open`。
    let openTrash: () -> Void
    let openAssets: () -> Void
}

// MARK: - 列表

/// 一页的内容：上传组、这一层的行、根层的两个入口与用量、空 / 加载 / 失败三态。
///
/// 取数全部走 `DriveStore`（它读 `model.drive`），这一层不自己发请求：层的代次、排序偏好
/// 与加载标志都在 store 里，视图这里再存一份只会与它漂开。
struct DriveBrowserList: View {
    /// 这是哪一页。
    let layer: DriveBrowserLayer
    /// 编辑模式。放在调用方那边：`···` 菜单里那一颗「选择」也要动它。
    @Binding var editing: Bool
    @Binding var picked: Set<String>
    let actions: DriveBrowserActions

    /// 窗口是不是紧凑的。**由调用方给，不在这里读 `horizontalSizeClass`。**
    ///
    /// 这一条列表住在分栏的浏览列里，而列里读到的是那一列自己的宽度类别，不是窗口的：
    /// 2026-09-25 在 iPad 全屏下拿「这条下拉刷新挂不挂」当探针量过 —— 同一个开关，读这里
    /// 环境值的那一版**没能**把下拉刷新摘掉（列里读到的是 `compact`），改成由调用方
    /// （`DriveBrowserView`，它读的是窗口那一层）传进来才摘掉。只用来判下拉刷新挂不挂，
    /// 见 `refreshableIfCompact`。
    let isCompact: Bool

    @Environment(SynapseAppModel.self) private var model

    /// 等用户点头的那一项覆盖（只有文本文档会走到这里，见 `requestOverwrite`）。
    @State private var pendingOverwrite: DriveUploadItem?

    var body: some View {
        List {
            if !uploads.isEmpty {
                // 上传的项在本机是「刚发生的事」，排在列表最上面：用户刚选完文件，
                // 要看到的是它们在动，而不是在下面找自己刚传的那一行。
                Section {
                    ForEach(uploads) { uploadRow($0) }
                } header: {
                    Text("上传")
                }
            }

            Section {
                ForEach(items) { row($0) }
            }
            if items.isEmpty || model.drive.errorMessage != nil {
                statusSection
            }

            if layer.isRoot {
                entriesSection
                usageSection
            }
        }
        .listStyle(.insetGrouped)
        .refreshableIfCompact(isCompact) { await model.driveReload() }
        .safeAreaInset(edge: .bottom) {
            if editing { selectionBar }
        }
        .toolbar {
            if editing {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(DriveBrowserSelection.toggleTitle(picked: picked, in: items)) {
                        picked = DriveBrowserSelection.toggled(picked: picked, in: items)
                    }
                }
            }
        }
        // 覆盖文本文档那一问。挂在这一屏上（这一屏没有别的 sheet 或 alert），
        // 宿主那一片 sheet 是别的几张对话框。
        .alert(
            overwriteTitle,
            isPresented: Binding(
                get: { pendingOverwrite != nil },
                set: { presented in if !presented { pendingOverwrite = nil } }
            ),
            presenting: pendingOverwrite
        ) { item in
            Button("覆盖") { model.driveConfirmUploadOverwrite(item.id) }
            Button("取消", role: .cancel) {}
        } message: { _ in
            // 这一问存在的全部理由就是「它可能正在被改」，所以正文只说这一句。
            Text("这个文件可能正在编辑器里打开。")
        }
    }

    private var overwriteTitle: String {
        guard let target = pendingOverwrite?.overwriteTarget else { return "" }
        return "要覆盖「\(target.name)」吗？"
    }

    /// 这一页现在该显示的行。
    private var items: [DriveBrowserItem] {
        layer.isCurrent(in: model.drive) ? model.drive.visibleChildren : []
    }

    /// 上传那一组：只给**落在这一层**的那几项。
    ///
    /// 队列活在这一屏之外，所以它可能同时在往两个文件夹里传；把别的层的那几条也画在这一层
    /// 顶上，用户会以为自己刚传的东西跑到了别的文件夹里。
    private var uploads: [DriveUploadItem] {
        model.driveUploader.items.filter { $0.parentId == layer.folderId }
    }

    // MARK: - 一行

    private func row(_ item: DriveBrowserItem) -> some View {
        Button {
            if editing {
                toggle(item)
            } else {
                actions.open(item)
            }
        } label: {
            rowLabel(item)
        }
        .buttonStyle(.plain)
        .contextMenu { menu(item) }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                actions.trash([item])
            } label: {
                Label("删除", systemImage: "trash")
            }
            // 左滑这一颗自己指定底色：左滑动作拿全局 tint 当**填充**，而它是
            // `Color.primary`，深色外观下白底白图标（见 `MeetingListView` 那段）。
            .tint(Color(uiColor: .systemRed))
            .disabled(actions.busy || editing)
        }
        .swipeActions(edge: .leading) {
            // 前缘是建设性的、后缘是破坏性的（Spec §5.1）。分享给蓝底，理由同上。
            Button {
                actions.share(item)
            } label: {
                Label("分享", systemImage: "link")
            }
            .tint(Color(uiColor: .systemBlue))
            .disabled(actions.busy || editing)
        }
        .onAppear { loadMoreIfNeeded(item) }
    }

    private func rowLabel(_ item: DriveBrowserItem) -> some View {
        HStack(spacing: 12) {
            if editing {
                Image(systemName: picked.contains(item.id) ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(picked.contains(item.id) ? Theme.ink : Color.secondary)
            }
            DriveFileIcon(name: item.name, isFolder: item.isFolder)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.name)
                        .font(.subheadline)
                        .lineLimit(1)
                    if DriveBrowserRow.isShared(item) {
                        Image(systemName: "link")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(DriveBrowserRow.subtitle(for: item))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if item.isFolder {
                Image(systemName: "chevron.forward")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: Metrics.minimumTapTarget)
        .contentShape(Rectangle())
    }

    /// 长按菜单。**不可用的项置灰而不是藏起来**：菜单短一行，用户读到的却是「没有这个
    /// 功能」，而置灰说的是「这一次不行」。
    @ViewBuilder
    private func menu(_ item: DriveBrowserItem) -> some View {
        Button {
            actions.open(item)
        } label: {
            Label(DriveBrowserRow.openLabel(item), systemImage: item.isFolder ? "folder" : "eye")
        }
        .disabled(actions.busy)

        Button {
            actions.share(item)
        } label: {
            Label("分享", systemImage: "link")
        }
        .disabled(actions.busy)

        Button {
            actions.rename(item)
        } label: {
            Label("重命名", systemImage: "pencil")
        }
        .disabled(actions.busy)

        Button {
            actions.move([item])
        } label: {
            Label("移动到", systemImage: "folder.badge.plus")
        }
        .disabled(actions.busy)

        Button {
            actions.export([item])
        } label: {
            Label("导出", systemImage: "square.and.arrow.down")
        }
        .disabled(actions.busy || actions.exporting || !DriveBrowserRow.canExport(item))

        Button {
            actions.info(item)
        } label: {
            Label("显示简介", systemImage: "info.circle")
        }

        Button(role: .destructive) {
            actions.trash([item])
        } label: {
            Label("删除", systemImage: "trash")
        }
        .disabled(actions.busy)
    }

    // MARK: - 上传那一组

    private func uploadRow(_ item: DriveUploadItem) -> some View {
        HStack(spacing: 12) {
            DriveFileIcon(name: item.name, isFolder: false, size: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.subheadline)
                    .lineLimit(1)
                if DriveUploadRow.showsProgress(item) {
                    ProgressView(value: item.progress)
                        .progressViewStyle(.linear)
                }
                Text(DriveUploadRow.detail(item))
                    .font(.caption)
                    // 失败那一句要说得出是红的：那一行是这一组里唯一需要用户做点什么的。
                    .foregroundStyle(item.message == nil ? Color.secondary : Theme.failure)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            trailing(for: item)
        }
        .frame(minHeight: Metrics.minimumTapTarget)
    }

    /// 每一项右边那一两颗。等确认的给「覆盖」，还在动的给「取消」，停下来的给「重试」与「移除」。
    @ViewBuilder
    private func trailing(for item: DriveUploadItem) -> some View {
        if DriveUploadRow.needsOverwrite(item) {
            Button {
                requestOverwrite(item)
            } label: {
                tappableLabel("覆盖")
            }
            .buttonStyle(.borderless)
            cancelButton(item)
        } else if DriveUploadRow.isRunning(item) {
            cancelButton(item)
        } else {
            if item.message != nil {
                Button {
                    model.driveRetryUpload(item.id)
                } label: {
                    tappableLabel("重试")
                }
                .buttonStyle(.borderless)
            }
            Button {
                model.driveDismissUpload(item.id)
            } label: {
                tappableLabel("移除")
            }
            .buttonStyle(.borderless)
        }
    }

    private func cancelButton(_ item: DriveUploadItem) -> some View {
        Button {
            Task { await model.driveCancelUpload(item.id) }
        } label: {
            tappableLabel("取消")
        }
        .buttonStyle(.borderless)
    }

    /// 覆盖那一下要不要先问一句。
    ///
    /// 只有**文本文档**（Markdown / 纯文本）要先问：服务端为这一类单独给了 `documentText`
    /// 标志，理由是这种文件人随时可能正在编辑器里改它，一个同名文件很可能不是「旧的那一份」。
    /// 别的类型一下点过：同名覆盖本来就是用户自己要的，多问一句只是多一次点击。
    private func requestOverwrite(_ item: DriveUploadItem) {
        if item.overwriteTarget?.documentText == true {
            pendingOverwrite = item
        } else {
            model.driveConfirmUploadOverwrite(item.id)
        }
    }

    // MARK: - 三态

    /// 空、加载中、失败。画成列表里的一段而不是整块盖在列表上：根层下面还有「回收站」
    /// 「公开素材」与用量三行，盖上去的那一块会把它们挡在下面点不着 —— 网盘空的时候
    /// 恰恰只剩从那里进去。
    @ViewBuilder
    private var statusSection: some View {
        Section {
            if let error = model.drive.errorMessage {
                failureRow(error)
            } else if items.isEmpty, layer.isCurrent(in: model.drive), !model.drive.loading {
                ContentUnavailableView("文件夹为空", systemImage: "folder")
                    .listRowBackground(Color.clear)
            } else {
                placeholderRows
            }
        }
    }

    /// 加载中的占位：几行灰条，比一整屏转圈好在它告诉用户这里将来会是一列东西。
    private var placeholderRows: some View {
        ForEach(0..<6, id: \.self) { _ in
            HStack(spacing: 12) {
                DriveFileIcon(name: "placeholder", isFolder: false)
                VStack(alignment: .leading, spacing: 3) {
                    Text("占位名字")
                        .font(.subheadline)
                    Text("占位副标题")
                        .font(.caption)
                }
            }
            .frame(minHeight: Metrics.minimumTapTarget)
            .redacted(reason: .placeholder)
        }
    }

    private func failureRow(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(error)
                .font(.footnote)
                .foregroundStyle(Theme.failure)
            Button("重试") {
                Task { await model.driveReload() }
            }
            .font(.footnote)
        }
    }

    // MARK: - 根层的两个入口与用量

    private var entriesSection: some View {
        Section {
            entryRow("回收站", symbol: "trash", subtitle: trashSubtitle) {
                actions.openTrash()
            }
            entryRow("公开素材", symbol: "link", subtitle: nil) {
                actions.openAssets()
            }
        }
    }

    /// 「N 项」；一条都没有时不给值（服务端那条总数是空的，写「0 项」是替它说话）。
    private var trashSubtitle: String? {
        model.drive.trashTotal > 0 ? "\(model.drive.trashTotal) 项" : nil
    }

    private func entryRow(
        _ title: String,
        symbol: String,
        subtitle: String?,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 20))
                    .foregroundStyle(.secondary)
                    .frame(width: 29 * 1.18)
                Text(title)
                    .font(.subheadline)
                Spacer(minLength: 0)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.forward")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .frame(minHeight: Metrics.minimumTapTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var usageSection: some View {
        if let text = DriveUsageRow.text(for: model.drive.usage) {
            Section {
                Text(text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    // MARK: - 多选

    private var selectionBar: some View {
        HStack(spacing: 8) {
            Text(DriveBrowserSelection.countLabel(picked.count))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            barButton("移动") { actions.move(selected) }
            barButton("导出", disabled: actions.exporting) { actions.export(selected) }
            barButton("删除") { actions.trash(selected) }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func barButton(
        _ title: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .frame(minHeight: Metrics.minimumTapTarget)
                .padding(.horizontal, 6)
        }
        .buttonStyle(.bordered)
        .disabled(picked.isEmpty || disabled)
    }

    private var selected: [DriveBrowserItem] {
        DriveBrowserSelection.items(picked, in: items)
    }

    private func toggle(_ item: DriveBrowserItem) {
        if picked.contains(item.id) {
            picked.remove(item.id)
        } else {
            picked.insert(item.id)
        }
    }

    // MARK: - 两件小事

    /// 滚到最后一行时接着取下一页。
    ///
    /// 判据是「这一行进过列表」而不是滚动位置：`List` 的行本来就是懒加载的，最后一行
    /// 出现即到底，位置那套要自己接 `UIScrollView`，多一层就没必要了。
    private func loadMoreIfNeeded(_ item: DriveBrowserItem) {
        guard item.id == items.last?.id, model.drive.hasMore else { return }
        Task { await model.driveLoadMore() }
    }

    /// 按钮上的字，连着它该有的可点面积。
    ///
    /// 最小尺寸加在 label 上而不是按钮外面：加在外面只是把按钮摆在一块 44pt 高的空地
    /// 中间，按到边缘不算数 —— `Metrics.minimumTapTarget` 要的是**可点区域**。
    private func tappableLabel(_ title: String) -> some View {
        Text(title)
            .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
    }
}

private extension View {
    /// 紧凑宽度下才挂下拉刷新。
    ///
    /// **常规宽度（iPad 全屏 / 分栏并排）下不挂。** 那会儿这一屏是分栏的浏览列，钻过文件夹
    /// 之后那条栏上还挂着面包屑；从这一格换回主页时，整棵分栏子树会一起拆掉，拆到这条列表
    /// 的下拉刷新时 `AttributeGraph` 断言失败、App 当场 `SIGABRT`——只在辅助功能正查控件树
    /// 时出现（XCUITest 与 VoiceOver 都算），去掉这一条下拉刷新之后逐层退、面包屑退、
    /// 从回收站退都不崩。完整堆栈与逐种试过的改法见
    /// `.superpowers/sdd/2026-09-25-mobile-drive/task-10-report.md`。
    ///
    /// 丢掉的只是 iPad 上「往下拉一把」这个手势：进屏、传完文件、分享改动过、从回收站那几屏
    /// 回来都已经各自重取，这一层失败态还另有一枚「重试」。紧凑宽度（iPhone、iPad 半窗）
    /// 一点没变。
    @ViewBuilder
    func refreshableIfCompact(
        _ isCompact: Bool,
        action: @escaping @Sendable () async -> Void
    ) -> some View {
        if isCompact {
            refreshable(action: action)
        } else {
            self
        }
    }
}
