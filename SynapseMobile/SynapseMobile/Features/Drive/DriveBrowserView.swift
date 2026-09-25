import PhotosUI
import SwiftUI
import UIKit

/// 手机端云盘的浏览界面（Spec §4.2、§5.1、§5.2）。
///
/// **这一屏自己带一个 `NavigationSplitView`**：左边是浏览列（文件夹逐层下钻），右边是预览
/// 列，紧凑宽度折成一列。它因此是一整块内容区，**不能被推进任何 `NavigationStack`** ——
/// 分栏视图里再套一条导航栈，紧凑窗要出现两条导航栏，返回手势落在哪一层也说不清。
/// 调用方把它当作本 Tab 的一页摆出来（`RootView` 里那种「本 Tab 的一页」的写法）。
///
/// 三件事在这里分工：浏览状态（在哪一层、加载标志、代次）全在 `DriveStore` 上，这一层不自己
/// 发请求；行、多选与空/加载/失败三态在 `DriveBrowserList`；预览在 `DrivePreviewPane`。
/// 这里管的是**跨这些块的东西**：撑起分栏、把栈与 store 的层对上、以及那几张对话框
/// （`···` 菜单、行菜单与预览列的动作栏开的是同一批，所以由这里统一持有）。
struct DriveBrowserView: View {
    /// 「返回主页」。回到哪儿由调用方决定 —— 这一屏不知道自己在哪个 Tab 里。
    let onExit: () -> Void

    @Environment(SynapseAppModel.self) private var model

    /// 窗口现在有多宽。**只用来判「有没有第二列可以放预览」**，不看机型也不看屏幕尺寸：
    /// 同一个 iPad 分屏时是紧凑、全屏时是常规，用户手上的窗口才是判据
    /// （`docs/agents/mobile-adaptive-layout.md`）。
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// 浏览列栈上的层：根一层，下钻的每个文件夹一层，三个整屏的列表页与紧凑窗里的预览
    /// 也在这条栈上。
    ///
    /// 栈与 `DriveStore.path` 是同一件事的两种表示（一个是视图栈，一个是数据栈），
    /// 保持一致由 `layerChanged` 负责。
    @State private var path: [DriveRoute] = []
    /// 宽窗下详情列里那一样东西。紧凑窗不用它（见 `DriveRoute.preview`）。
    @State private var preview: DriveBrowserItem?

    /// 多选。放在这里而不是列表里：`···` 菜单里那颗「选择」与列表内部的行都动它。
    @State private var editing = false
    @State private var picked: Set<String> = []

    /// 有一件事在办（下钻、删除）。办的时候行菜单里那些项置灰，免得两件事撞在同一层上。
    @State private var busy = false
    /// 刚收起的这一张动过分享没有。见 `sheetDismissed` 与 `shareChanged`。
    @State private var shareChanged = false

    /// 这一屏会开出来的那几张。收成一片 sheet：`···` 菜单、行菜单与预览列的动作栏开的是
    /// 同一批对话框，而两片 sheet 挂在同一个视图上只有一片会出来。
    @State private var sheet: Sheet?
    /// 导出那一趟。与预览列自己那个是两份 —— 那里是「预览这一项」下的字节，这里是
    /// 「导出选中的这些」下的字节，进度、取消与落地目录都各是各的。
    @State private var export = DriveFileExport()
    /// 已经因为传完而重取过的上传项，见 `uploadsChanged`。
    @State private var seenUploads: Set<String> = []
    /// 上一次栈变化是不是「窗口变宽、把预览那一页换成详情列」那一趟，见 `layerChanged`。
    @State private var keepingPreview = false
    /// 栈上一次量出来的文件夹深度。
    ///
    /// `layerChanged` 判「层变没变」用的是它，而不是 store 的 `path.count`（后者在下钻时
    /// 已经先写好了，比不出变化）。初始值 0 对得上 `path` 的初始值：这一屏进来就停在根层。
    @State private var lastDepth = 0

    /// 分栏现在摆几列。
    ///
    /// 常规宽度下得**明说要两列**，不能留给默认的 `.automatic`：这一屏活在 `.sidebarAdaptable`
    /// 的 `TabView` 的一格里，默认值在 iPad 上会把浏览列整列收起来 —— 2026-09-25 在
    /// iPad Pro 13 英寸（iPadOS 18）实测，进去只看得到预览列那句「选择一项来预览」，
    /// 浏览列与栏上那枚「返回主页」都不在屏上，展开侧边栏出来的是 App 自己那三个 Tab，
    /// 于是这一屏在 iPad 上没有文件、也没路可回。紧凑宽度照旧 `.automatic`（折成一列，
    /// 由分栏自己决定停在哪一列）。
    ///
    /// 而且**不能把它存在 `@State` 里**：存了的话，系统在 iPad 上转过屏、切过标签之后再按
    /// `.automatic` 摆一次时，我们那位「已经写进去了」不算变化 —— 同一个值再写一次不触发
    /// 重算，收起来的浏览列就回不来（2026-09-25 实测：iPad 竖屏进云盘、下钻、转横屏，
    /// 列表整列消失，只剩「选择一项来预览」，屏上也没有路把它叫回来）。这里给的是**算出来的
    /// 常量**：每次重绘都按当下的宽度重新摆，系统收不动它。
    private var columnVisibility: NavigationSplitViewVisibility {
        isCompact ? .automatic : .doubleColumn
    }
    /// 栈顶上一次是哪一格。判「是不是刚从一张整屏的列表页退回来」用它，见 `layerChanged`。
    @State private var lastRoute: DriveRoute?

    /// 浏览列栈上的一格。
    private enum DriveRoute: Hashable {
        case folder(DriveBrowserItem)
        /// 紧凑窗里的文件预览。**只**在紧凑窗用，见 `open(_:)`。
        case preview(DriveBrowserItem)
        case trash
        case assets
        case shares
    }

    /// 这一屏会开出来的那几张。
    ///
    /// 身份按内容给：同一项连着开两次要各弹一次（`sheet(item:)` 靠这个），而换了项、
    /// 换了批次就是另一片。
    private enum Sheet: Identifiable {
        case createFolder
        case rename(DriveBrowserItem)
        case move([DriveBrowserItem])
        case share(DriveBrowserItem)
        case info(DriveBrowserItem)
        case pick(UploadSource)

        var id: String {
            switch self {
            case .createFolder: return "createFolder"
            case .rename(let item): return "rename.\(item.id)"
            case .move(let items): return "move.\(items.map(\.id).joined(separator: ","))"
            case .share(let item): return "share.\(item.id)"
            case .info(let item): return "info.\(item.id)"
            case .pick(let source): return "pick.\(source.rawValue)"
            }
        }
    }

    /// 从哪儿取要上传的文件。
    ///
    /// 三个 picker 是接力那一套现成的（`Features/Terminal/TerminalFilePicker.swift`）：
    /// 相册那条不申请相册权限，文件那条拿到的字节已经在 App 容器里。
    private enum UploadSource: String, Identifiable {
        case photos
        case documents
        case camera

        var id: String { rawValue }
    }

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(columnVisibility)) {
            browse
        } detail: {
            previewPane
        }
        // 对话框那一批挂在外层，导出那一批挂在浏览列上（见 `browse`）：分开挂是因为
        // 同一个视图上挂两片 sheet 只有一片会出来，而且出来的可能是错的那一片。
        .sheet(item: $sheet, onDismiss: sheetDismissed) { presented($0) }
        .onChange(of: path) { _, routes in layerChanged(routes) }
        .onChange(of: sizeClass) { _, new in widthChanged(new) }
        .onChange(of: editing) { _, on in if !on { picked = [] } }
        .onChange(of: model.driveUploader.items) { _, items in uploadsChanged(items) }
        .task {
            await enter()
        }
        .noticeOverlay(model)
    }

    // MARK: - 两列

    private var browse: some View {
        NavigationStack(path: $path) {
            page(.root)
                .navigationDestination(for: DriveRoute.self) { destination($0) }
        }
        // 导出那一趟的两片（系统面板与超过阈值那一问）挂在这儿。
        .sheet(item: $export.shareRequest, onDismiss: exportDismissed) { request in
            DriveActivityView(items: request.files)
        }
        .alert(
            exportTitle,
            isPresented: Binding(
                get: { export.pendingConfirmation != nil },
                set: { presented in if !presented { export.declinePending() } }
            ),
            presenting: export.pendingConfirmation
        ) { _ in
            Button("下载") { export.confirmPending(using: model) }
            Button("取消", role: .cancel) { export.declinePending() }
        } message: { pending in
            // 问这一句的全部理由是大小，所以这一行只说大小。
            Text("共 \(DriveText.bytes(String(pending.totalBytes)))")
        }
        .navigationSplitViewColumnWidth(min: 320, ideal: 360, max: 460)
    }

    /// 预览列。它自带空态、自带标题与动作栏（Task 7），这里只递进去要预览的那一项。
    ///
    /// 紧凑窗里这一列根本不会被显示（分栏折成单列，停在浏览列上），预览走栈上的一页——
    /// 为什么不用 `preferredCompactColumn = .detail` 把这一列推上来，见 `open(_:)`。
    private var previewPane: some View {
        DrivePreviewPane(
            item: preview,
            onShare: { sheet = .share($0) },
            onInfo: { sheet = .info($0) }
        )
    }

    // MARK: - 一页

    /// 浏览列上的一页：面包屑、计数行、列表。
    ///
    /// 标题与工具栏挂在页上而不是列表里：`DriveBrowserList` 是「一页的内容」，
    /// 而这一页叫什么、右上角有什么是这一层的事。
    private func page(_ layer: DriveBrowserLayer) -> some View {
        VStack(spacing: 0) {
            if layer.isCurrent(in: model.drive), model.drive.path.count >= 2 {
                // 深度够了才出现：根层下面没有可跳的上面一层，多一行面包屑只是多一行字。
                breadcrumbs
            }
            countLine(layer)
            DriveBrowserList(
                layer: layer,
                editing: $editing,
                picked: $picked,
                actions: actions,
                isCompact: isCompact
            )
                .safeAreaInset(edge: .bottom) { sharingProgress }
        }
        .navigationTitle(title(layer))
        .navigationBarTitleDisplayMode(.large)
        .toolbar { toolbar }
    }

    @ViewBuilder
    private func destination(_ route: DriveRoute) -> some View {
        switch route {
        case .folder(let item):
            page(.folder(item))
        case .preview(let item):
            // 紧凑窗里的预览：整块内容区，自带标题与动作栏。这里不另加标题 ——
            // 它自己那一条头部已经写着名字了，导航栏上再来一次是同一句话说两遍。
            DrivePreviewPane(
                item: item,
                onShare: { sheet = .share($0) },
                onInfo: { sheet = .info($0) }
            )
            .navigationBarTitleDisplayMode(.inline)
        case .trash:
            // 三张整屏的列表页（Task 9）：从环境取 model、自带标题与 `.noticeOverlay`，
            // 所以这里只把它们推上栈，不再包一层 List，也不再挂一份 overlay。
            //
            // 宽窄必须由这里传（它们住在这条分栏的浏览列里，自己读到的
            // `horizontalSizeClass` 是列自己的，见 `refreshableIfCompact`）：这一个值决定
            // 它们那条下拉刷新挂不挂。
            DriveTrashView(isCompact: isCompact)
                .environment(model)
        case .assets:
            DrivePublicAssetsView(isCompact: isCompact)
                .environment(model)
        case .shares:
            DriveShareListView(isCompact: isCompact)
                .environment(model)
        }
    }

    /// 这一页叫什么。
    ///
    /// 这一页就是 store 加载的那一层时用 store 的说法：改名之后它才是权威（页上带着的那一份
    /// 名字是推栈当时抄下来的）。不是它的时候按页自己的说 —— 被压在后面的那一页仍然是它自己。
    private func title(_ layer: DriveBrowserLayer) -> String {
        guard layer.isCurrent(in: model.drive) else {
            switch layer {
            case .root: return DriveText.rootTitle
            case .folder(let item): return item.name
            }
        }
        return model.drive.title
    }

    /// 大标题下面那一行「N 项 · 按名称升序」（Spec §4.2）。
    ///
    /// 数还不知道时（这一层还没取回来、或者正在重取）画灰条而不是说「0 项」：那是替服务端
    /// 说话，而这一刻它还没回答。
    private func countLine(_ layer: DriveBrowserLayer) -> some View {
        let known = layer.isCurrent(in: model.drive) && !model.drive.loading
        return Text(
            DriveBrowserHeader.countLine(
                count: known ? model.drive.visibleChildren.count : 0,
                key: model.drive.sortKey,
                ascending: model.drive.sortAscending
            )
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .redacted(reason: known ? [] : .placeholder)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    /// 面包屑：从「云盘」到这一层，点哪一级跳哪一级。
    ///
    /// 自己可横滚：层深下去之后这一行一定比屏幕宽，而最右边的当前层名是这一行里最该看见的
    /// 那一个字。
    private var breadcrumbs: some View {
        let crumbs = model.drive.breadcrumbs
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(crumbs.enumerated()), id: \.offset) { index, crumb in
                    if index > 0 {
                        Image(systemName: "chevron.forward")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Button {
                        jump(to: index)
                    } label: {
                        // 最小可点面积加在 label 上，不是加在按钮外面：加在外面只是把按钮摆在
                        // 一块 44pt 高的空地中间（`Metrics.minimumTapTarget` 要的是可点区域）。
                        Text(crumb.name)
                            .font(.footnote)
                            .fontWeight(index == crumbs.count - 1 ? .semibold : .regular)
                            .foregroundStyle(index == crumbs.count - 1 ? Color.primary : Color.secondary)
                            .lineLimit(1)
                            .frame(minHeight: Metrics.minimumTapTarget)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    /// 导出那一趟在做什么，加一个取消。
    ///
    /// 没有这一行的话，一次大文件的导出在字节下完之前屏幕上什么都不会发生，而用户按的
    /// 那一下（行菜单里的「导出」、多选底栏的「导出」）看起来就像丢了。
    @ViewBuilder
    private var sharingProgress: some View {
        if let progress = export.share.progress {
            VStack(spacing: 0) {
                Divider()
                HStack(spacing: 12) {
                    if let fraction = progress.fraction {
                        ProgressView(value: fraction)
                            .progressViewStyle(.linear)
                    } else {
                        // 服务端没给总长度时走不确定态，不画一个假的比例。
                        ProgressView()
                    }
                    Text(progress.name)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Button { export.cancel(.share) } label: {
                        tappableLabel("取消")
                    }
                    .buttonStyle(.borderless)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .background(.bar)
        }
    }

    // MARK: - 工具栏

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(action: onExit) {
                Image(systemName: "house")
                    .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
            }
            .accessibilityLabel("返回主页")
            .accessibilityIdentifier("drive-browser-back-home")
        }
        ToolbarItem(placement: .topBarTrailing) {
            menu
        }
    }

    private var menu: some View {
        Menu {
            Button {
                sheet = .createFolder
            } label: {
                Label("新建文件夹", systemImage: "folder.badge.plus")
            }
            Menu {
                Button {
                    sheet = .pick(.photos)
                } label: {
                    Label("照片", systemImage: "photo")
                }
                Button {
                    sheet = .pick(.documents)
                } label: {
                    Label("文件", systemImage: "folder")
                }
                Button {
                    sheet = .pick(.camera)
                } label: {
                    Label("拍照", systemImage: "camera")
                }
                // 没有相机的机器上置灰而不是藏起来：菜单短一行，用户读到的却是「这一版
                // 没有这个功能」（与行菜单同一条）。
                .disabled(!CameraPicker.isAvailable)
            } label: {
                Label("上传文件", systemImage: "square.and.arrow.up")
            }
            sortMenu
            Button {
                editing.toggle()
            } label: {
                Label(editing ? "完成" : "选择", systemImage: editing ? "checkmark.circle.fill" : "checkmark.circle")
            }
            Button {
                path.append(.shares)
            } label: {
                Label("分享管理", systemImage: "link")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
        }
        .accessibilityLabel("更多")
    }

    /// 排序方式：先选按什么排，再选升还是降。
    ///
    /// 两件事分开两项，与标题下那一行「按X升序」读起来是同一句话的两个词。当前那一项带
    /// 勾 —— 菜单收起之后，勾是「现在是按什么排的」唯一还能看见的地方。
    private var sortMenu: some View {
        Menu {
            ForEach(DriveSortKey.allCases, id: \.self) { key in
                Button {
                    model.drive.setSortKey(key)
                } label: {
                    if key == model.drive.sortKey {
                        Label(key.label, systemImage: "checkmark")
                    } else {
                        Text(key.label)
                    }
                }
            }
            Divider()
            ForEach([true, false], id: \.self) { ascending in
                Button {
                    model.drive.setSortAscending(ascending)
                } label: {
                    if ascending == model.drive.sortAscending {
                        Label(DriveBrowserHeader.direction(ascending: ascending), systemImage: "checkmark")
                    } else {
                        Text(DriveBrowserHeader.direction(ascending: ascending))
                    }
                }
            }
        } label: {
            Label("排序方式", systemImage: "arrow.up.arrow.down")
        }
    }

    // MARK: - 行与菜单的动作

    private var actions: DriveBrowserActions {
        DriveBrowserActions(
            busy: busy,
            exporting: exporting,
            open: { open($0) },
            rename: { sheet = .rename($0) },
            move: { sheet = .move($0) },
            share: { sheet = .share($0) },
            info: { sheet = .info($0) },
            export: { exportItems($0) },
            trash: { items in Task { await remove(items) } },
            openTrash: { path.append(.trash) },
            openAssets: { path.append(.assets) }
        )
    }

    /// 点一行。文件夹下钻（推一层），文件去预览。
    ///
    /// **文件用它自己那一份，不拿 id 回 store 反查**：`DriveStore.open` 是给文件夹的
    /// （它拉的是子层快照），拿文件 id 去走那条路只会把当前这一层弄丢。
    ///
    /// 预览落到哪里按窗口宽度分（实测出来的，不是照着分栏的直觉写的）：
    ///
    /// - **常规宽度**：分栏并排，`preview` 交给详情列。
    /// - **紧凑宽度**：预览是这条栈上推出来的一页。
    ///
    /// 紧凑窗本来该用 `preferredCompactColumn = .detail` 把详情列推上来，实测这么做站不住：
    /// 用户在预览那一页按返回之后，系统弹的是它自己那条导航栈（栈深从 2 回到 1），而
    /// `preferredCompactColumn` 仍停在 `.detail` —— 它既不会写回绑定，详情列的
    /// `onDisappear` 也不触发（详情那一块在折起来的分栏里一直活着）。于是再点第二个文件时
    /// `column = .detail` 不算变化，界面上什么都不会发生，看起来像点不动。
    ///
    /// 推一页则把这段状态整个绕开：返回手势、导航栏、深链目标都在同一条栈上，与文件夹下钻
    /// 共用一套。`DrivePreviewPane` 本来就是「一整块内容区」（自带空态、头部与动作栏），
    /// 推上来与放在详情列里长得一样。
    private func open(_ item: DriveBrowserItem) {
        guard item.isFolder else {
            if isCompact {
                path.append(.preview(item))
            } else {
                preview = item
            }
            return
        }
        Task { await drill(into: item) }
    }

    /// 有没有第二列可以放预览。
    private var isCompact: Bool { sizeClass == .compact }

    /// 下钻一层。
    ///
    /// 先让 store 走一趟再推栈：store 说它没进去（这一项已经不是文件夹了、请求失败了）
    /// 就不推 —— 栈上多一格空页面比这一次没反应更糟。推栈之后 `layerChanged` 会把
    /// 多选与预览清掉。
    ///
    /// **注意这里的写入次序**：store 的路径是在 `path.append` **之前**写好的，所以栈变的
    /// 那一刻 `model.drive.path.count` 已经等于新的深度了。`layerChanged` 判「层变没变」
    /// 因此不能拿 `depth` 与 `model.drive.path.count` 比 —— 那样这一次下钻会被当成没变化，
    /// 见那里的注释。
    private func drill(into item: DriveBrowserItem) async {
        guard !busy else { return }
        busy = true
        await model.driveOpen(itemId: item.id)
        busy = false
        guard model.drive.path.last?.id == item.id else { return }
        path.append(.folder(item))
    }

    /// 面包屑跳转：第 0 级是「云盘」。
    ///
    /// 截栈而不是推栈：往回跳是往回走，栈上留着中间那几层只会让返回手势一层层穿过去。
    private func jump(to index: Int) {
        guard index < path.count else { return }
        path = Array(path.prefix(index))
    }

    /// 导出这一批。
    ///
    /// 走 `DriveFileExport`：它自己决定要不要先问一句（超过 50 MB），下完把一组 URL 交给
    /// 系统面板。多选那一批导完就退出编辑模式 —— 那一批的事办完了，选择留着只会让用户
    /// 再按一次「完成」。
    ///
    /// **有一批还在下时不再发起第二批**：行菜单的「导出」与底部工具条的「导出」是两颗按钮，
    /// 但这一屏只有一个 `share` 槽，第二趟会在 `download` 里把在飞的那一趟取消掉 —— 用户
    /// 看不到第二颗按钮与第一趟是同一件事，只会看到进度行自己没了。两颗按钮同样按
    /// `exporting` 置灰，所以这道守卫在界面上是看得见的，不是一个闷掉的手势。
    private func exportItems(_ items: [DriveBrowserItem]) {
        guard !items.isEmpty, !busy, !exporting else { return }
        export.download(items, purpose: .share, using: model)
    }

    /// 这一屏正在下一批导出（进度行还在）。下完交给面板时 `progress` 就空了，那一趟不再算
    /// 「在飞」——面板开着的时候这一屏被盖住，没有第二颗按钮可按。
    private var exporting: Bool {
        export.share.progress != nil
    }

    /// 移入回收站。
    ///
    /// 可恢复，所以不二次确认（与公开素材那一屏同一条：不可撤销的那一下才问一句，
    /// 而回收站正是为了「删错了还能回来」）。失败的那几条由 `noticeText` 说清原因，
    /// 全成时不说话 —— 列表已经变了。
    ///
    /// 选择恢复成**失败的那几项**，不是清空（Spec §5.2「成功的从列表移除，失败的保留选中」）：
    /// 失败的那几项还在列表里，把选择留给它们，用户再按一次「删除」就是重试，不必回到列表里
    /// 把它们一个个重新找出来。全成时这个集合本来就是空的，选择照旧被清掉。
    private func remove(_ items: [DriveBrowserItem]) async {
        guard !items.isEmpty, !busy else { return }
        busy = true
        let outcome = await model.driveTrashItems(items)
        busy = false
        picked = outcome.failedItemIds
        if let notice = outcome.noticeText("删除") {
            model.notice(notice, tone: .failure)
        }
    }

    // MARK: - 层变了

    /// 栈变了：把 store 的层对齐，并清掉属于上一层的那几样东西。
    ///
    /// 预览那一项与多选都是「上一层的事」：留着它们，下一层会看起来像是点过了一行。
    private func layerChanged(_ routes: [DriveRoute]) {
        // `keepingPreview` 那一趟不是用户往回走，是「窗口变宽」把栈上那页预览换成了详情列的
        // 选择（见 `widthChanged`）：刚写进去的那一项不该被这里抹掉。
        if keepingPreview {
            keepingPreview = false
        } else {
            preview = nil
        }
        // 三个整屏的列表页不是一层文件夹：它们各自取数，store 的层不动。栈退回它们下面时
        // 也要把 store 扳回对应那一层（否则退回浏览页会看到上一层的列表）。
        let depth = routes.prefix { route in
            if case .folder = route { return true }
            return false
        }
        .count
        // 编辑模式与多选是**这一层的事**，所以只在层真的变了时清。
        //
        // 「层变了」只能跟**上一次的深度**比，不能跟 `model.drive.path.count` 比：下钻时
        // `drill` 先把 store 推下去、再 `path.append`，所以栈变的那一刻两边的深度已经相等了
        // ——拿它们比会把「往前下一层」误判成没变化。那不只是少清一次状态：编辑态下经长按
        // 菜单的「打开」进文件夹是会发生的（那颗键只按 `busy` 置灰），回来时选择圈停在上一层
        // 的那几项上，工具条按 `picked.count` 说「已选 N 项」，而按钮作用的对象是过滤后
        // 的空集 —— 一串看起来能用、按下去什么都不发生的键。
        //
        // 宽度跨过 compact/regular 阈值时这条也会跑（`widthChanged` 把那页预览从栈上摘掉，
        // 栈一变就走到这里），但文件夹深度没变，所以仍然提前返回：那不是「用户离开了这一层」，
        // 而 `docs/agents/mobile-adaptive-layout.md` 写着折叠与展开不能重置选择。
        if depth != lastDepth {
            lastDepth = depth
            editing = false
            picked = []
        }
        // 从三张整屏的列表页退回来时，把这一层重取一次。
        //
        // 它们改的正是浏览层要显示的东西：回收站里恢复或彻底删除会改这一层的行，分享管理里
        // 停用分享会改行尾那枚 `link` 角标。那几个页面是**推入**的、不是 sheet，所以
        // `sheetDismissed` 那套（只在动过分享时重取）覆盖不到它们 —— 不补这一趟，用户恢复
        // 一个文件、返回，看不见它，要下拉一次才出现，看起来像操作没生效。
        //
        // 这里是**无条件**重取，不判「动没动过」：那几屏拿不到回调，而判错一次的代价是用户
        // 以为操作没生效；多打的那一趟 GET 只在他真的走过这三屏时发生。三屏自己那些动作
        // （恢复 / 彻底删除 / 停用分享）在 `DriveStore` 里已经各自重取过自己那一份。
        if Self.isManagementRoute(lastRoute), !Self.isManagementRoute(routes.last) {
            Task { await model.driveReload() }
        }
        lastRoute = routes.last
        // store 那一趟另判：`driveJump` 只有真差着层时才值得发（下钻那一趟已经把它推到位了，
        // 再跳一次就是白多打一趟请求）。
        guard depth != model.drive.path.count else { return }
        Task { await model.driveJump(to: depth) }
    }

    /// 栈上这一格是不是那三张「整屏的列表页」（回收站 / 公开素材 / 分享管理）。
    ///
    /// 它们与文件夹页不同：自己取数、不动 `model.drive.path`，所以「从它们退回来」要单独认。
    private static func isManagementRoute(_ route: DriveRoute?) -> Bool {
        switch route {
        case .trash, .assets, .shares: return true
        case .folder, .preview, .none: return false
        }
    }

    // MARK: - 窗口变宽了

    /// 从紧凑转到常规：栈上那一页预览在分栏里没有位置（它只属于单列），换成详情列里的选择。
    ///
    /// 不处理的话会同时出现两处预览：侧栏那一列里推着一页预览，右边详情列还画着另一样东西。
    /// 窗口宽度变了：换分栏的列数，并把紧凑窗里那一页预览收进详情列。
    private func widthChanged(_ sizeClass: UserInterfaceSizeClass?) {
        guard sizeClass != .compact else { return }
        guard case .preview(let item)? = path.last else { return }
        path.removeLast()
        keepingPreview = true
        preview = item
    }

    // MARK: - 对话框

    @ViewBuilder
    private func presented(_ sheet: Sheet) -> some View {
        switch sheet {
        case .createFolder:
            DriveRenameSheet(purpose: .createFolder, parentName: model.drive.title)
        case .rename(let item):
            DriveRenameSheet(purpose: .rename(item), parentName: model.drive.title)
        case .move(let items):
            // 从这一层开始往下找目标（`from` 传的正是 store 的 path）。
            DriveMoveTargetPicker(items: items, from: model.drive.path) { outcome in
                // 移走了的那几项已经不在这一层了，选择只留给**没移成**的那几项：
                // 它们还在列表里，用户再按一次「移动」就是重试（Spec §5.2）。全成时
                // 这个集合是空的，选择照旧被清掉。
                picked = outcome.failedItemIds
            }
        case .share(let item):
            DriveShareSheet(item: item) { shareChanged = true }
        case .info(let item):
            DriveItemInfoView(item: item, path: model.drive.path) { shareChanged = true }
        case .pick(let source):
            picker(source)
        }
    }

    /// 系统 picker。选完的东西先落成磁盘上的一份（`DriveFileIntake`），再进上传队列。
    @ViewBuilder
    private func picker(_ source: UploadSource) -> some View {
        switch source {
        case .photos:
            PhotoLibraryPicker(
                // 一批的上限与接力那条通路一致：它一次最多带 9 个附件，队列的并发上限是 2，
                // 再多也只是排在后面（`AppConfiguration.relayMaxFileCount`）。
                selectionLimit: AppConfiguration.relayMaxFileCount,
                onPicked: { results in
                    sheet = nil
                    Task { await upload(results: results) }
                },
                onCancelled: { sheet = nil }
            )
            .ignoresSafeArea()
        case .documents:
            DocumentPicker(
                onPicked: { urls in
                    sheet = nil
                    Task { await upload(documentURLs: urls) }
                },
                onCancelled: { sheet = nil }
            )
            .ignoresSafeArea()
        case .camera:
            CameraPicker(
                onPicked: { capture in
                    sheet = nil
                    Task { await upload(capture: capture) }
                },
                onCancelled: { sheet = nil }
            )
            .ignoresSafeArea()
        }
    }

    /// 一张收起了。
    ///
    /// 动过分享的那一次要重取：新建或停用一条分享都不改浏览的那份快照，行尾那枚
    /// `link` 角标不会自己变（`DriveStore` 只在变更成功后重取，而分享不改列表）。
    /// 只在「动过」时才重取，不是每次都重取：用户只是打开来看了一眼也重取一次的话，
    /// 每看一次分享就白跑一趟 GET。
    private func sheetDismissed() {
        guard shareChanged else { return }
        shareChanged = false
        Task { await model.driveReload() }
    }

    /// 系统面板收起了。
    private func exportDismissed() {
        export.finishSharing()
        // 多选导出完就退出编辑模式：那一批的事办完了。
        if editing {
            editing = false
        }
    }

    /// 「要下载这几项吗」那一句的标题。
    private var exportTitle: String {
        guard let pending = export.pendingConfirmation else { return "" }
        guard pending.items.count == 1, let name = pending.items.first?.name else {
            return "要下载这 \(pending.items.count) 项吗？"
        }
        return "要下载「\(name)」吗？"
    }

    // MARK: - 进屏与上传

    /// 进屏取数。
    ///
    /// 三件都要：这一层的快照（列表）、用量（最底下那一行）、回收站条数（「N 项」）。
    /// 依次发而不是并发：三条都落在同一份 `DriveStore` 状态上，而列表那一趟是用户等着的
    /// 那一条，先让它落地。
    ///
    /// **进屏先把 store 扳回根层。** 这一屏是「主页那一格的一页」，`path` 每次进来都是空的
    /// （见那个属性的注释：这一屏进来就停在根层），而 `DriveStore.path` 挂在 model 上、
    /// 活得比这一屏长 —— 上一次钻到哪一层会原样留到这一次。两边差着层时列表按
    /// `layer.isCurrent` 判成「不是这一层」，于是整页画成占位：返回主页再进云盘，看到的
    /// 是一片空白，下拉与重试也回不来（它们取的是 store 那一层，越取越不对）。
    /// 所以两者必须在进屏这一刻对齐，而不只是在栈变化时对齐（`layerChanged`）。
    private func enter() async {
        if model.drive.path.isEmpty {
            await model.driveReload()
        } else {
            // `jump` 自己会取根层那一份，不必再 `reload` 一次。
            await model.driveJump(to: 0)
        }
        await model.driveLoadUsage()
        await model.driveLoadTrash(search: nil)
    }

    private func upload(results: [PHPickerResult]) async {
        await enqueue(await DriveFileIntake.prepare(results: results))
    }

    private func upload(documentURLs: [URL]) async {
        await enqueue(DriveFileIntake.prepare(documentURLs: documentURLs))
    }

    private func upload(capture: CameraCapture) async {
        guard let file = await DriveFileIntake.prepare(camera: capture) else { return }
        await enqueue([file])
    }

    /// 交给上传队列。
    ///
    /// **起飞之前按大小拦一道**：`PHPickerResult` / `NSItemProvider` 都不暴露字节数（要拿得走
    /// 相册权限那条路，而 picker 这条路的设计恰恰是不申请权限），所以只能在文件落到磁盘之后
    /// 量。超限的那一个不进队列 —— 让它发给服务端的话，用户等到传完才知道（说法与接力那一套
    /// 逐字相同：同一条上限不该有两种措辞）。
    private func enqueue(_ files: [PickedFile]) async {
        guard !files.isEmpty else { return }
        var accepted: [PickedFile] = []
        for file in files {
            guard file.size <= Int64(AppConfiguration.relayMaxFileBytes) else {
                // 不进队列的那一份是本机刚落下的拷贝，一样要删（谁落下谁删）。
                DriveFileIntake.discard(file)
                model.notice(
                    PickRejection.tooLarge(name: file.name, bytes: file.size).message,
                    tone: .failure
                )
                continue
            }
            accepted.append(file)
        }
        guard !accepted.isEmpty else { return }
        // 传到眼前这一层：根层给 nil（服务端把根当成「没有父级」）。
        model.driveEnqueueUploads(accepted, parentId: model.drive.folderId)
    }

    /// 一项传完了：落进这一层的话把这一层重取一次。
    ///
    /// 浏览的那份快照不会因为本机传完一个文件而变化（上传走的是自己的那条路由），不重取的话
    /// 用户要下拉一次才看得见自己刚传上去的东西。传到别的文件夹去的话这一层没有新东西可看。
    private func uploadsChanged(_ items: [DriveUploadItem]) {
        for item in items {
            guard case .completed = item.state else { continue }
            guard seenUploads.insert(item.id).inserted else { continue }
            guard item.parentId == model.drive.folderId else { continue }
            Task { await model.driveReload() }
        }
    }

    /// 按钮上的字，连着它该有的可点面积。加在 label 上而不是按钮外面，理由见
    /// `DriveBrowserList` 里那一份。
    private func tappableLabel(_ title: String) -> some View {
        Text(title)
            .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
    }
}
