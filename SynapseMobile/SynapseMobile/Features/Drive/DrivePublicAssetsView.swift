import SwiftUI
import UIKit

/// 公开素材行副标题那两段（Spec §4.7）。
///
/// 纯函数：与 `DriveTrashRow` 同一套写法，不读 `UserDefaults`。
enum DrivePublicAssetRow {
    /// 「访问 N 次 · 最近访问时间」。
    ///
    /// 访问次数是服务端给的大整数字符串，读不出来按 0 算 —— 与 `DriveText.bytes` 同一条
    /// 兜底，屏幕上那一格宁可说「访问 0 次」，也不该整行空着。从没被访问过时服务端不给
    /// `lastAccessedAt`，那就只留前半段，不留一个吊在末尾的「 · 」。
    static func subtitle(for asset: DrivePublicAsset) -> String {
        let count = max(0, Int64(asset.accessCount) ?? 0)
        let visits = "访问 \(count) 次"
        let last = DriveText.date(asset.lastAccessedAt ?? "")
        return last.isEmpty ? visits : "\(visits) · \(last)"
    }
}

/// 公开素材（Spec §4.7）：平铺的一页直链。
///
/// **不做文件夹**：服务端规定公开素材是平铺的、允许重名，所以这里没有层级可下钻。
///
/// 取数只取首页：`DriveStore.pageLimit` 是服务端的上限 100，超过 100 条时手机端只看得到
/// 前 100 条（桌面端可以看全）。本期的已知上限，不做「加载更多」。
///
/// 调用方把它**推入**一个已有的 `NavigationStack`（它是列表底部那两个「位置」入口之一）：
/// 本视图不带自己的 `NavigationStack`。
struct DrivePublicAssetsView: View {
    @Environment(SynapseAppModel.self) private var model

    /// 正在选文件 / 正在改名的那一张。两件事共用一片 sheet：同一个视图上挂两片 `.sheet`
    /// 只有一片会出来，而且出来的可能是错的那一片（`DrivePreviewPane` 记着这一条）。
    @State private var sheet: Sheet?
    /// 刚传完那几条的直链：要摆到用户面前（Spec §4.7「上传后直接给出直链」）。
    /// 空数组表示不弹。
    @State private var uploadedLinks: [String] = []
    /// 有一趟上传在飞。工具栏那颗 ＋ 这时换成一个转圈。
    @State private var uploading = false
    /// 行上那些动作在飞。一次只办一件。
    @State private var busy = false

    /// 这一屏会开出来的两张。
    private enum Sheet: Identifiable {
        case pick(UploadSource)
        case rename(DrivePublicAsset)

        var id: String {
            switch self {
            case .pick(let source): return "pick.\(source.rawValue)"
            case .rename(let asset): return "rename.\(asset.assetId)"
            }
        }
    }

    /// 从哪儿取要上传的文件。
    ///
    /// 三个 picker 是接力那一套现成的（`Features/Terminal/TerminalFilePicker.swift`）：
    /// 相册那条不申请相册权限，文件那条的字节已经在 App 容器里。
    private enum UploadSource: String, Identifiable {
        case photos
        case documents

        var id: String { rawValue }
    }

    var body: some View {
        List {
            if let error = model.drive.assetsErrorMessage {
                // 与回收站那一屏同一条：失败说成一行，不叠空态，重试就是下拉。
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }
            Section {
                ForEach(model.drive.assets) { asset in
                    row(asset)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.drive.assets.isEmpty {
                if model.drive.assetsLoading {
                    ProgressView()
                } else if model.drive.assetsErrorMessage == nil {
                    ContentUnavailableView("还没有公开素材", systemImage: "link")
                }
            }
        }
        .navigationTitle("公开素材")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if uploading {
                    ProgressView()
                } else {
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
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("上传")
                }
            }
        }
        .task {
            await model.driveLoadAssets()
        }
        .refreshable {
            await model.driveLoadAssets()
        }
        .sheet(item: $sheet) { sheet in
            presented(sheet)
        }
        .alert(
            "直链已就绪",
            isPresented: Binding(
                get: { !uploadedLinks.isEmpty },
                set: { presented in if !presented { uploadedLinks = [] } }
            )
        ) {
            // 一次选了好几个文件时连着拷，中间用换行隔开：它们本来就是一组。
            Button("拷贝直链") { copy(uploadedLinks.joined(separator: "\n")) }
            Button("完成", role: .cancel) {}
        } message: {
            // 直链是这一趟唯一的结果，所以它自己是这条消息的正文。
            Text(uploadedLinks.joined(separator: "\n"))
        }
        .noticeOverlay(model)
    }

    // MARK: - 一行

    /// 一行：图标 + 名字 + 「访问 N 次 · 最近访问时间」。
    ///
    /// 手势与菜单的分工与回收站那一屏一致：右滑露「拷贝直链」（这一屏最常用的那一下）、
    /// 左滑露「删除」，长按菜单三条全在。
    private func row(_ asset: DrivePublicAsset) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.fill")
                .foregroundStyle(DriveText.kindColor(DriveText.kind(of: asset.name)))
            VStack(alignment: .leading, spacing: 3) {
                Text(asset.name)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(DrivePublicAssetRow.subtitle(for: asset))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(minHeight: Metrics.minimumTapTarget)
        .contentShape(Rectangle())
        .contextMenu { actions(asset) }
        .swipeActions(edge: .leading) {
            Button {
                copyLink(asset)
            } label: {
                Label("拷贝直链", systemImage: "doc.on.doc")
            }
            .tint(Color(uiColor: .systemBlue))
        }
        // 左滑这一颗自己指定底色：左滑动作拿全局 tint 当**填充**，而它是 `Color.primary`，
        // 深色外观下白底白图标（见 `MeetingListView` 那段）。
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await remove(asset) }
            } label: {
                Label("删除", systemImage: "trash")
            }
            .tint(Color(uiColor: .systemRed))
            .disabled(busy)
        }
    }

    @ViewBuilder
    private func actions(_ asset: DrivePublicAsset) -> some View {
        Button {
            copyLink(asset)
        } label: {
            Label("拷贝直链", systemImage: "doc.on.doc")
        }
        Button {
            sheet = .rename(asset)
        } label: {
            Label("重命名", systemImage: "pencil")
        }
        .disabled(busy)
        Button(role: .destructive) {
            Task { await remove(asset) }
        } label: {
            Label("删除", systemImage: "trash")
        }
        .disabled(busy)
    }

    // MARK: - 两张弹窗

    @ViewBuilder
    private func presented(_ sheet: Sheet) -> some View {
        switch sheet {
        case .pick(let source):
            picker(source)
        case .rename(let asset):
            // 改名那一张与云盘里那些共用（`DriveRenameSheet`）：改一个名字、一个输入框、
            // 取消加保存，四处都是同一件事，不该有第二种样子。公开素材没有上一层，
            // 所以 `parentName` 只是一个不会被显示的占位。
            DriveRenameSheet(purpose: .renameAsset(asset), parentName: "")
        }
    }

    /// 系统 picker。选完的东西先落成磁盘上的一份（`DriveFileIntake`），再进上传。
    @ViewBuilder
    private func picker(_ source: UploadSource) -> some View {
        switch source {
        case .photos:
            PhotoLibraryPicker(
                // 一次一张：公开素材多是一条要发出去的图或文档，选完就传，不需要一次挑一叠。
                selectionLimit: 1,
                onPicked: { results in
                    sheet = nil
                    Task {
                        await upload(await DriveFileIntake.prepare(results: results))
                    }
                },
                onCancelled: { sheet = nil }
            )
            .ignoresSafeArea()
        case .documents:
            DocumentPicker(
                onPicked: { urls in
                    sheet = nil
                    Task {
                        await upload(DriveFileIntake.prepare(documentURLs: urls))
                    }
                },
                onCancelled: { sheet = nil }
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - 三件事

    /// 这一条的直链，交给 `DriveStore` 决定用哪一条来源。
    ///
    /// 服务端给的 `url`（按 `APP_PUBLIC_URL` 拼）优先，本机拼的 `/files/<assetId>` 只是
    /// 兜底 —— 自建部署下这两个站点的域名可能不是同一个（`DrivePublicAssetLink`）。
    private func copyLink(_ asset: DrivePublicAsset) {
        copy(model.drive.directLink(for: asset))
    }

    /// 拷一段东西进剪贴板。
    ///
    /// 直链**只**进剪贴板：不写日志、不进 `AppLog` —— 它离开这一屏就是这一页唯一的结果，
    /// 所以给一声嗡 + 一句提示。一个固定的 id：连着拷两条时重启这一句，而不是排两句
    /// 一模一样的「已复制」。
    private func copy(_ value: String) {
        UIPasteboard.general.string = value
        Haptics.success()
        model.notice("已复制直链", tone: .success, id: "drive.asset.copied")
    }

    /// 传一批。
    ///
    /// **选中之后、起飞之前先按大小拦一道**：`PHPickerResult` / `NSItemProvider` 都不暴露
    /// 字节数（要拿得走相册权限那条路，而 picker 这条路的设计恰恰是不申请权限），所以只能
    /// 在文件落到磁盘之后量。超限的那一个不发给服务端 —— 让它拒的话，用户等到传完才知道。
    private func upload(_ files: [PickedFile]) async {
        guard !uploading, !files.isEmpty else { return }
        var accepted: [PickedFile] = []
        for file in files {
            guard file.size <= Int64(AppConfiguration.relayMaxFileBytes) else {
                // 说法与接力那一套逐字相同（`PickRejection.tooLarge`）：同一条上限在两处
                // 不该有两种措辞。
                model.notice(
                    PickRejection.tooLarge(name: file.name, bytes: file.size).message,
                    tone: .failure
                )
                continue
            }
            accepted.append(file)
        }
        guard !accepted.isEmpty else { return }

        uploading = true
        var links: [String] = []
        for file in accepted {
            // 一条失败不影响后面的：失败的那一条说清是哪一条、为什么（见 `send`）。
            if let link = await send(file) { links.append(link) }
        }
        uploading = false
        // 传完重取：新素材要出现在列表里。成了的那几条由 `uploadedLinks` 把直链摆出来。
        await model.driveLoadAssets()
        uploadedLinks = links
    }

    /// 一条：prepare（走 `public-assets` 那条）→ 字节 → complete，回来的就是那条直链本身。
    ///
    /// 这一条不走 `DriveUploader` 那套队列：prepare / complete 是**另一条路由**
    /// （`public-assets/uploads/...`），而且公开素材一次就一个文件 —— 那套队列的重试、
    /// 取消、并发上限在这里换不来什么。字节走 `FileUploader`（目标是预签名地址，不带 bearer）。
    private func send(_ file: PickedFile) async -> String? {
        do {
            let asset = try await model.driveUploadPublicAsset(file)
            return model.drive.directLink(for: asset)
        } catch {
            model.notice("「\(file.name)」\(DriveText.errorMessage(error))", tone: .failure)
            return nil
        }
    }

    /// 删除=移入回收站，直链当下就不可用。成了由 store 就地去掉那一行（回收站那一屏下次
    /// 进去自己会重取），所以不报成功 —— 列表已经变了。
    private func remove(_ asset: DrivePublicAsset) async {
        guard !busy else { return }
        busy = true
        let outcome = await model.driveTrashAsset(asset)
        busy = false
        if let notice = outcome.noticeText("删除") {
            model.notice(notice, tone: .failure)
        }
    }
}
