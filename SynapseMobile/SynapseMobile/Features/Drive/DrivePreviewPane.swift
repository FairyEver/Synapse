import QuickLook
import SwiftUI
import UIKit

/// 一项文件该走哪条预览路线（Spec §4.4）。
///
/// 判据只有服务端给的那一个 `previewKind`，外加下载前后各一次判断：
///
/// 1. **下之前**只回答「值不值得为预览花这个流量」。这一步没法交给系统——`canPreview` 对
///    **还不存在**的地址一律答 false（2026-09-25 在 iOS 模拟器上实测：17 种扩展名全
///    false），所以「先问系统再决定下不下」这条路不存在，只能按大类粗筛。粗筛用的是
///    `DriveText.kind` 那张既有的表，不另写一份扩展名表。
/// 2. **下之后**问系统，见 `quickLookCanPreview`。以它的回答为准。
///
/// 纯函数，边界钉在 `DrivePreviewTests`。
enum DrivePreviewRoute: Equatable {
    case image
    /// 文本、Markdown、HTML 源码。三种读法一样，只是画法不同，所以带着种类。
    case text(DrivePreviewKind)
    /// 交给系统预览器。
    case quickLook
    /// 本机没有能打开它的东西，只有导出。
    case unavailable

    static func route(kind: DrivePreviewKind, name: String) -> DrivePreviewRoute {
        switch kind {
        case .image:
            return .image
        case .text, .markdown, .htmlSource:
            return .text(kind)
        case .downloadOnly:
            // 这一档服务端不分格式（不是图片/文本/Markdown/HTML 的全在这里），所以能不能看
            // 得自己判。粗筛只分「值得下」与「不值得下」，第二步由系统说了算。
            return worthDownloading(name) ? .quickLook : .unavailable
        }
    }

    /// 这一项值不值得下下来交给系统试一次。
    ///
    /// 系统能打开的东西比原先那张表宽得多：音视频、`.csv`/`.rtf`/`.key` 这些系统自己都有
    /// 查看器（实测 `canPreview` 对这些都答 true），所以媒体、PDF、Office、文本类都值得
    /// 花这个流量。
    ///
    /// 压缩包与磁盘映像不值当：`canPreview` 其实能列出一个 zip 的内容（实测 true），但为看
    /// 一个文件列表下几十兆没有道理，而磁盘映像系统在 iOS 上根本打不开。判不出类型的一个
    /// 也不猜——那正是流量最可能白花的一档。
    private static func worthDownloading(_ name: String) -> Bool {
        switch DriveText.kind(of: name) {
        case .pdf, .image, .video, .audio, .document, .spreadsheet, .presentation, .code:
            return true
        case .archive, .unknown:
            return false
        }
    }

    /// 系统自己的判据：QuickLook 打不打得开这一份**已经在本机**的文件。
    ///
    /// 比任何扩展名表都准——被改名的文件、苹果以后才支持的格式，表都覆盖不了。它认的是
    /// 扩展名推出来的类型、不是内容（实测：空文件叫 `.zip` 也答 true，一个 PNG 改名
    /// `.zip` 也答 true），也**必须**文件真的在盘上（地址不存在一律 false），所以它只能在
    /// 下完之后问。
    static func quickLookCanPreview(_ url: URL) -> Bool {
        QLPreviewController.canPreview(url as NSURL)
    }
}

/// 文本预览读多少、读到哪停、只读了开头怎么说。
enum DriveTextPreview {
    /// 一次预览最多读这么多。
    ///
    /// 服务端一段只给 8 KB 左右，所以这是七八次请求的量：再多用户等的就不是「翻一下」
    /// 而是「下载」了，而文本预览要的是立刻能看（Spec §4.4）。
    static let byteLimit = 64 * 1024

    /// 还要不要接着读下一段。
    ///
    /// 三个停下来的理由：已经到头、到了 64 KiB、或者这一段没有比上一段往前挪——
    /// 最后一条是防死循环的：游标不前进时再问一次还是同一段，一个 while true 会一直
    /// 问下去。
    static func shouldContinue(previousEnd: Int, chunk: DriveContentChunk) -> Bool {
        guard !chunk.endOfFile, chunk.nextCursor != nil else { return false }
        guard chunk.endByte > previousEnd else { return false }
        return chunk.endByte < byteLimit
    }

    /// 只读了开头时底部那一行；读全了就没有这一行。
    ///
    /// 用 1024 进制：这一行的参照物是上面那个 64 KiB 的上限，两处得是同一把尺子。
    static func truncationNote(shownBytes: Int, totalBytes: Int) -> String? {
        guard totalBytes > shownBytes, shownBytes > 0 else { return nil }
        let kb = max(1, Int((Double(shownBytes) / 1024).rounded()))
        return "已显示前 \(kb) KB"
    }
}

/// 文本预览的取数：`content/inspect` 拿版本号，再按 `content/chunk` 一段一段读。
@MainActor
@Observable
final class DrivePreviewContent {
    enum State: Equatable {
        case idle
        case loading
        case ready(text: String, note: String?)
        case failed(String)
    }

    private(set) var state: State = .idle

    /// 第几次取。上一项的结果不该画到这一项上。
    @ObservationIgnored private var generation = 0

    func load(_ item: DriveBrowserItem, using model: SynapseAppModel) async {
        generation += 1
        let mine = generation
        state = .loading

        do {
            let inspect = try await model.driveContentInspect(itemId: item.id)
            var text = ""
            var end = 0
            var total = inspect.sizeBytes
            var cursor: String?

            while true {
                let chunk = try await model.driveContentChunk(
                    itemId: item.id,
                    versionId: inspect.versionId,
                    cursor: cursor
                )
                text += chunk.text
                total = chunk.totalBytes
                cursor = chunk.nextCursor
                let previous = end
                end = chunk.endByte
                guard DriveTextPreview.shouldContinue(previousEnd: previous, chunk: chunk) else { break }
            }

            guard mine == generation, !Task.isCancelled else { return }
            state = .ready(
                text: text,
                note: DriveTextPreview.truncationNote(shownBytes: end, totalBytes: total)
            )
        } catch {
            // 取消（换了另一项、离开了这一屏）不是失败，也不该有话说。
            guard mine == generation, !Task.isCancelled else { return }
            state = .failed(DriveText.errorMessage(error))
        }
    }

    /// 不再显示这一项了。
    func clear() {
        generation += 1
        state = .idle
    }
}

/// 预览列。Task 6 的浏览界面把它放在 `NavigationSplitView` 的详情列（紧凑窗推入
/// 单列），所以这一层自带空态、自带标题栏、自带底部动作栏——它是一整块内容区，
/// 不是一个嵌入片段。
///
/// 三件事在这里分工：字节走 `DriveFileExport`（图片与 QuickLook 都先下到本机），文本走
/// `DrivePreviewContent`，分享表单与信息页交给调用方——那两层要用 `DriveStore` 与网络，
/// 不属于预览。
struct DrivePreviewPane: View {
    /// 要预览的那一项。`nil` 是空态。
    let item: DriveBrowserItem?
    /// 「分享」：调用方开分享表单（Task 8）。
    let onShare: (DriveBrowserItem) -> Void
    /// 「简介」：调用方开信息页（Task 9）。
    let onInfo: (DriveBrowserItem) -> Void

    @Environment(SynapseAppModel.self) private var model
    @State private var content = DrivePreviewContent()
    @State private var export = DriveFileExport()
    @State private var quickLook: QuickLookRequest?

    var body: some View {
        Group {
            if let item {
                loaded(item)
            } else {
                ContentUnavailableView("选择一项来预览", systemImage: "doc.text.magnifyingglass")
            }
        }
        // 分享那一层挂在这里，QuickLook 那一层挂在里面。两片 sheet 挂在同一个视图上
        // 只有一片会出来，而且出来的可能是错的那一片。
        .sheet(item: $export.shareRequest, onDismiss: { export.finishSharing() }) { request in
            DriveShareSheet(items: request.files)
        }
        .alert(
            confirmationTitle,
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
    }

    // MARK: - 一项

    private func loaded(_ item: DriveBrowserItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(item)
            Divider()
            preview(item)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .safeAreaInset(edge: .bottom) { actions(item) }
        // 整个值当身份，不只是 id：改了名、换了版本之后名字要重算、字节要重下，而同一项
        // 反复重画不该再触发一次（`DriveBrowserItem` 可比）。
        .task(id: item) { await begin(item) }
        .onChange(of: export.preview.staged) { _, staged in
            presentQuickLook(item, staged)
        }
        .onDisappear {
            content.clear()
            export.releasePreview()
        }
        .sheet(item: $quickLook) { request in
            DriveQuickLook(url: request.url) { quickLook = nil }
        }
    }

    private func header(_ item: DriveBrowserItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.name)
                .font(.headline)
                .lineLimit(2)
            Text(subtitle(item))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    /// 名字下面那一行：多大、什么时候改的。
    private func subtitle(_ item: DriveBrowserItem) -> String {
        // 文件夹没有大小这一格：服务端给的那个数是它自己节点的，报出来会小得离谱。
        // 读不出大小的文件用「—」占位，不要一个假的「0 字节」。
        let size = item.isFolder
            ? "文件夹"
            : item.sizeBytes.map { DriveText.bytes(String($0)) } ?? "—"
        let updated = DriveText.date(item.updatedAt)
        return updated.isEmpty ? size : "\(size) · 修改于 \(updated)"
    }

    @ViewBuilder
    private func preview(_ item: DriveBrowserItem) -> some View {
        // 这一列只画预览那一趟的进度：导出那一趟的进度挂在动作栏上面（见 `sharing`），
        // 两趟各占各的地方，同时进行也不会互相盖掉。
        if let progress = export.preview.progress {
            downloading(progress)
        } else if item.isFolder {
            folder(item)
        } else {
            switch route(item) {
            case .image:
                if let file = previewFile(item) {
                    DriveZoomableImage(url: file, label: item.name)
                } else {
                    awaitingBytes(item)
                }
            case .text(let kind):
                text(kind, item: item)
            case .quickLook:
                if let file = previewFile(item) {
                    if DrivePreviewRoute.quickLookCanPreview(file) {
                        // 自动打开过一次之后就剩这一颗按钮：收起系统预览器不该等于再也
                        // 不能打开它，而字节已经在盘上，按一下不该重新下一次。
                        Button { quickLook = QuickLookRequest(url: file) } label: {
                            tappableLabel("预览")
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        // 粗筛放它下来的，系统说打不开——以系统为准。落在这里的是粗筛没料到
                        // 的那几种（磁盘映像、没有扩展名的、苹果以后不认的格式）。
                        unavailable(item)
                    }
                } else {
                    awaitingBytes(item)
                }
            case .unavailable:
                unavailable(item)
            }
        }
    }

    /// 系统打不开，本机就只有导出这一条路。
    ///
    /// 动作栏上也有一颗「导出」，这一颗是给「预览列一片空白、用户不知道能做什么」的那个
    /// 处境用的：空态里能直接动手，不用去找底部那一排。
    private func unavailable(_ item: DriveBrowserItem) -> some View {
        ContentUnavailableView {
            Label("这个格式无法预览", systemImage: "eye.slash")
        } actions: {
            Button { exportNow(item) } label: {
                tappableLabel("导出")
            }
        }
    }

    /// 字节还没到本机（正在下的时候走的是上面那一条）。
    ///
    /// 用户按过取消、或者上一次没下成，都会落到这儿，而两者的说法是一样的：还没有
    /// 本机这一份，要不要现在下。失败的原因由底部那条 notice 说，这里不重复。
    private func awaitingBytes(_ item: DriveBrowserItem) -> some View {
        ContentUnavailableView {
            Label("还没有下载到本机", systemImage: "arrow.down.circle")
        } actions: {
            Button { downloadBytes(item) } label: {
                tappableLabel("下载")
            }
        }
    }

    private func downloading(_ progress: DriveFileExport.Download) -> some View {
        VStack(spacing: 12) {
            if let fraction = progress.fraction {
                ProgressView(value: fraction)
                    .progressViewStyle(.linear)
            } else {
                // 服务端没给总长时画比例就是编的。
                ProgressView()
            }
            Text(progress.name)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Button { export.cancel(.preview) } label: {
                tappableLabel("取消")
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func folder(_ item: DriveBrowserItem) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "folder.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color(uiColor: .systemBlue))
            // 文件夹走的是同一个下载路由，服务端压成 zip 回来。不说这一句，用户会以为
            // 导出的是一个文件夹，或者等一个几十秒的任务却不知道在等什么（Spec §5.4）。
            Text("导出时会打包成一个 zip")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func text(_ kind: DrivePreviewKind, item: DriveBrowserItem) -> some View {
        switch content.state {
        case .idle, .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label(message, systemImage: "exclamationmark.triangle")
            } actions: {
                Button { Task { await content.load(item, using: model) } } label: {
                    tappableLabel("重试")
                }
                .buttonStyle(.bordered)
            }
        case .ready(let body, let note):
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(rendered(body, kind: kind))
                        .font(kind == .htmlSource ? .body.monospaced() : .body)
                        .textSelection(.enabled)
                    if let note {
                        Text(note)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
        }
    }

    /// Markdown 只走行内语法。
    ///
    /// `AttributedString(markdown:)` 的默认档就是不解析块级的：SwiftUI 的 `Text` 不认
    /// 段落与标题那几样语义，给 `.full` 换来的只是空行被吃掉。行内这一档保留换行，
    /// 粗体与行内代码照旧。
    private func rendered(_ text: String, kind: DrivePreviewKind) -> AttributedString {
        guard kind == .markdown else { return AttributedString(text) }
        return (try? AttributedString(markdown: text)) ?? AttributedString(text)
    }

    private func actions(_ item: DriveBrowserItem) -> some View {
        VStack(spacing: 0) {
            // 导出那一趟的进度挂在这一排上面：它不该占住预览列，而它在跑的时候用户还要
            // 接着看现在这一项（两趟的进度各是各的，可以同时看得见）。
            if let progress = export.share.progress {
                Divider()
                sharing(progress)
            }
            HStack(spacing: 8) {
                barButton("分享") { onShare(item) }
                barButton("导出") { exportNow(item) }
                barButton("简介") { onInfo(item) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }

    /// 导出那一趟在做什么。
    private func sharing(_ progress: DriveFileExport.Download) -> some View {
        HStack(spacing: 12) {
            if let fraction = progress.fraction {
                ProgressView(value: fraction)
                    .progressViewStyle(.linear)
            } else {
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

    /// 一颗够得着的按钮。
    private func barButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget)
        }
        .buttonStyle(.bordered)
    }

    /// 按钮上的字，连着它该有的可点面积。
    ///
    /// 最小尺寸加在 label 上而不是按钮外面：加在外面只是把按钮摆在一块 44pt 高的空地
    /// 中间，按到边缘不算数——`Metrics.minimumTapTarget` 要的是**可点区域**。宽度也要
    /// 一份：两个汉字大约 34pt，不带内边距的按钮比 44pt 窄。
    private func tappableLabel(_ title: String) -> some View {
        Text(title)
            .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
    }

    // MARK: - 一件事

    private func route(_ item: DriveBrowserItem) -> DrivePreviewRoute {
        DrivePreviewRoute.route(kind: item.previewKind, name: item.name)
    }

    /// 这一项落到本机的那一份，还没有就是 nil。
    private func previewFile(_ item: DriveBrowserItem) -> URL? {
        guard let staged = export.preview.staged else { return nil }
        // 核对是这一项的：上一项下完的字节不该画到这一项上。
        guard staged.itemIds.contains(item.id) else { return nil }
        return staged.files.first
    }

    /// 换了项就该重新开始：文本重新读、字节重新下，上一次的那些不算数。
    private func begin(_ item: DriveBrowserItem) async {
        content.clear()
        quickLook = nil
        switch route(item) {
        case .image, .quickLook:
            downloadBytes(item)
        case .text:
            export.releasePreview()
            await content.load(item, using: model)
        case .unavailable:
            export.releasePreview()
        }
    }

    private func downloadBytes(_ item: DriveBrowserItem) {
        export.download([item], purpose: .preview, using: model)
    }

    private func exportNow(_ item: DriveBrowserItem) {
        export.download([item], purpose: .share, using: model)
    }

    /// 字节一落地就把系统预览器打开。
    ///
    /// 只看预览那一趟下完的那一批：导出那一趟落地时不该顺手弹出一个预览器（用户在动作栏
    /// 上按的是导出）。离开这一屏、换一项都不会再触发（那一份已经不是这一项的了）。
    private func presentQuickLook(_ item: DriveBrowserItem, _ staged: DriveFileExport.Staged?) {
        guard let staged, !staged.files.isEmpty else { return }
        guard staged.itemIds.contains(item.id), route(item) == .quickLook else { return }
        // 系统打不开就别弹：粗筛把它放进来了，这里以系统的回答为准，弹一片空白不如留在
        // 「这个格式无法预览」那一屏上。
        guard DrivePreviewRoute.quickLookCanPreview(staged.files[0]) else { return }
        quickLook = QuickLookRequest(url: staged.files[0])
    }

    private var confirmationTitle: String {
        guard let pending = export.pendingConfirmation else { return "" }
        guard pending.items.count == 1, let name = pending.items.first?.name else {
            return "要下载这 \(pending.items.count) 项吗？"
        }
        return "要下载「\(name)」吗？"
    }
}

/// QuickLook 那一层要的那一份文件。
///
/// 包一层是因为 `sheet(item:)` 要一个身份：同一份文件连着打开两次也该各弹一次，
/// 拿 URL 本身当身份做不到这件事。
private struct QuickLookRequest: Identifiable {
    let id = UUID()
    let url: URL
}

/// 图片预览：下到本机的字节画出来，能捏合缩放、双击放大。
///
/// 用 `UIScrollView` 而不是给 `Image` 叠 `scaleEffect`：缩放要有边界与回弹，放大之后
/// 还得能拖着看，这几样自己拼要写一堆状态，而系统这个早就做完了。远程地址不进来
/// ——它加不了 `Authorization` 头（Spec §5.4），进来的永远是本机那一个文件。
struct DriveZoomableImage: UIViewRepresentable {
    let url: URL
    /// 说给 VoiceOver 的名字。图片本身没有可读的内容，只有文件名。
    let label: String

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = UIScrollView()
        scrollView.delegate = context.coordinator
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 8
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.backgroundColor = .clear

        let imageView = UIImageView(image: UIImage(contentsOfFile: url.path))
        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true
        imageView.isAccessibilityElement = true
        imageView.accessibilityLabel = label
        imageView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(imageView)
        // 图片跟着可滚动区域长，「适应宽度」与缩放才对得上；钉在 frame 上放大的时候
        // 只会把内容挤在中间不动。
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            imageView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            imageView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
            imageView.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor),
        ])

        // 一指缩放之外再留一条不用捏的路：系统那些图片查看器都是这么做的。
        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.doubleTapped(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)

        context.coordinator.imageView = imageView
        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        guard context.coordinator.url != url, let imageView = context.coordinator.imageView else { return }
        context.coordinator.url = url
        imageView.image = UIImage(contentsOfFile: url.path)
        imageView.accessibilityLabel = label
        scrollView.setZoomScale(1, animated: false)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        var url: URL
        weak var imageView: UIImageView?

        init(url: URL) {
            self.url = url
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            imageView
        }

        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scrollView = gesture.view as? UIScrollView else { return }
            let zoomedIn = scrollView.zoomScale > scrollView.minimumZoomScale
            scrollView.setZoomScale(zoomedIn ? scrollView.minimumZoomScale : 3, animated: true)
        }
    }
}
