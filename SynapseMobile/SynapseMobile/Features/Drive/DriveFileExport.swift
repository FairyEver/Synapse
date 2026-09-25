import Foundation
import Observation
import SwiftUI
import UIKit
import os

/// 导出：把云盘里的字节下到临时目录，再交给系统分享面板。
///
/// 只有一条路——「存储到文件」是面板里的一个动作，所以不再单独做一个导出按钮
/// （Spec §5.4）。单个文件与多选走的是同一条：先把字节下到本机，再把一组文件 URL
/// 交给面板；预览里的图片与 PDF 也从这里取本机那一份，省掉第二条下载通路。
///
/// **下载必须自己带令牌。** owner 的下载路由在 `/api` 前缀之外，认的是
/// `Authorization` 头；面板与 `QLPreviewController` 都是系统自己去读那些文件，加不了
/// 自定义头。所以远程地址绝不能交给 `AsyncImage`、QuickLook 的远程模式或
/// `SFSafariViewController` —— 字节一定先在 `APIClient.downloadDriveItem` 里落盘。
@MainActor
@Observable
final class DriveFileExport {
    /// 超过这个大小先问一句。
    ///
    /// 50 MB 不是服务端的限制（单文件上限是 100 MB），是一个「值不值得现在下」的判断：
    /// 移动网络上是几十秒到几分钟，而用户可能只是点错了一项。用十进制，与
    /// `DriveText.bytes` 和系统「文件」App 报的是同一个数。
    static let confirmationThresholdBytes: Int64 = 50 * 1000 * 1000

    // MARK: - 类型

    /// 正在下的那一项。
    struct Download: Equatable {
        let name: String
        /// 服务端没给总长度时是 nil：进度条走不确定态，不画一个假的比例。
        let fraction: Double?
    }

    /// 这一批字节下下来做什么用。
    ///
    /// 只有去向不同：交给系统面板，还是留给调用方（预览：图片要画出来、PDF 要交给
    /// QuickLook）。下载、进度、取消、超过阈值先问一句，两条路走的是同一套。
    enum Purpose: Equatable {
        case share
        case preview
    }

    /// 下好的那一组本地文件。
    struct Staged: Equatable {
        let files: [URL]
        let purpose: Purpose
        /// 这一批是为哪几项下的。预览那条路只有一项，落地时用它核对现在拿到的还是不是
        /// 同一项——上一项的字节不该画到这一项上。
        let itemIds: [String]
    }

    /// 面板要分享的那一组本地文件。
    ///
    /// 单独包一层是因为 `sheet(item:)` 要一个身份：同一批文件连着导出两次也要能各弹
    /// 一次面板，拿 URL 数组本身当身份做不到这件事。
    struct ShareRequest: Identifiable, Equatable {
        let id = UUID()
        let files: [URL]
    }

    /// 超过阈值、等用户点头的那一批。点头之前一个字节都没下。
    struct PendingConfirmation: Equatable {
        let items: [DriveBrowserItem]
        let totalBytes: Int64
        let purpose: Purpose
    }

    // MARK: - 状态

    private(set) var progress: Download?
    private(set) var pendingConfirmation: PendingConfirmation?
    private(set) var staged: Staged?
    /// 面板该出来了。非 nil 即呈现；收起时调 `finishSharing()`。
    var shareRequest: ShareRequest?

    /// 在飞的那一趟。
    @ObservationIgnored private var task: Task<Void, Never>?
    /// 在飞的那一趟是干什么用的。
    ///
    /// 单独记一份是因为字节还在路上时 `staged` 还是空的：那时候判断「这一趟该不该被
    /// 取消」只能靠它。
    @ObservationIgnored private var runningPurpose: Purpose?
    /// 第几趟。上一趟的最后一次进度回调不该落到接手那一趟的进度行上。
    @ObservationIgnored private var generation = 0
    /// 这一次落地的目录。换一趟就换一个，收尾时整棵删掉。
    @ObservationIgnored private var stagingDirectory: URL?

    // MARK: - 动作

    /// 下这一批。
    ///
    /// 出现 `pendingConfirmation` 时先问一句，用户点头后调 `confirmPending(using:)`。
    func download(_ items: [DriveBrowserItem], purpose: Purpose, using model: SynapseAppModel) {
        guard !items.isEmpty else { return }
        // 上一趟还在跑就先放掉：新的选择是用户后来的意思，两趟同时往一行进度上写只会
        // 互相顶。取消是安全的——取消标志在，被放掉的那一趟不会再落任何状态。
        cancel()
        // 还没回答的那一问一起作废：它问的是上一批，用户换了选择之后再点「下载」，
        // 下下来的会是上一批。
        pendingConfirmation = nil
        if let total = Self.confirmationTotal(for: items) {
            pendingConfirmation = PendingConfirmation(items: items, totalBytes: total, purpose: purpose)
            return
        }
        start(items, purpose: purpose, using: model)
    }

    /// 用户点了「下载」。
    func confirmPending(using model: SynapseAppModel) {
        guard let pending = pendingConfirmation else { return }
        pendingConfirmation = nil
        start(pending.items, purpose: pending.purpose, using: model)
    }

    /// 用户点了「取消」，或者把那一句划掉了。
    func declinePending() {
        pendingConfirmation = nil
    }

    /// 取消正在下的那一趟。进度行上那个「取消」用它。
    ///
    /// 进度行得在这里收掉。被取消的那一趟自己不敢动它 —— 它连「我是不是当前这一趟」
    /// 都判不出来的时候就返回了（接手的那一趟可能正写着同一行）—— 而取消是知道的：
    /// 这一趟到此为止，不会有别的结果了。`generation` 一起加上去，那些已经排在主线程
    /// 队列里的进度回调落到这里也会被丢掉，否则取消之后进度条会自己再跳一下。
    func cancel() {
        task?.cancel()
        task = nil
        generation += 1
        runningPurpose = nil
        progress = nil
    }

    /// 面板收起了。
    ///
    /// 落地的字节一起删：「存储到文件」是先把文件拷出去、之后由系统自己管，所以删本机
    /// 这一份是安全的；留着才是问题——临时目录系统不会替我们收。
    func finishSharing() {
        shareRequest = nil
        // 只收分享那一份。预览那一份还在被这一屏读着（一张图、一份 PDF），面板收起
        // 不该把它从下面抽走。
        guard staged?.purpose == .share else { return }
        discardStaged()
    }

    /// 预览那一份不再需要了：换了一项，或者离开了这一屏。
    ///
    /// 只有预览那一份会被收掉。正在下或者已经下好的分享那一批不动——它要么还没交给
    /// 面板，要么面板正开着，顺手取消它等于把用户刚按下去的那一次导出吃掉。
    func releasePreview() {
        // 还没落地的那一趟也得算进来：换了一项时上一次下载可能正下载到一半，
        // 光看 `staged` 会漏掉它，那些字节会在没人要的情况下继续下完。
        guard (staged?.purpose ?? runningPurpose) == .preview else { return }
        cancel()
        discardStaged()
    }

    // MARK: - 一趟

    private func start(_ items: [DriveBrowserItem], purpose: Purpose, using model: SynapseAppModel) {
        generation += 1
        let mine = generation
        runningPurpose = purpose
        task = Task { [weak self] in
            await self?.run(items, purpose: purpose, using: model, generation: mine)
        }
    }

    private func run(
        _ items: [DriveBrowserItem],
        purpose: Purpose,
        using model: SynapseAppModel,
        generation: Int
    ) async {
        discardStaged()
        let directory: URL
        do {
            directory = try makeStagingDirectory()
        } catch {
            AppLog.drive.error(
                "drive export could not make a staging directory: \(error.localizedDescription, privacy: .public)"
            )
            runningPurpose = nil
            model.notice(DriveText.unknownErrorMessage, tone: .failure)
            return
        }

        var landed: [URL] = []
        var taken: Set<String> = []
        for item in items {
            guard !Task.isCancelled else { return }
            let name = Self.unique(Self.stagedName(for: item), taken: taken)
            taken.insert(name)
            let destination = directory.appendingPathComponent(name)
            progress = Download(name: item.name, fraction: nil)
            do {
                try await model.downloadDriveItem(itemId: item.id, to: destination) { [weak self] fraction in
                    // 进度从别的线程推过来，回主 actor 再落地。先把弱引用收成常量：
                    // 直接在 `Task` 里引用弱捕获的 `self` 是「并发里碰一个可变捕获」。
                    guard let self else { return }
                    Task { @MainActor in self.land(item.name, fraction, generation: generation) }
                }
            } catch {
                // 取消不是失败：`APIClient` 把断掉的下载报成「网络不可用」，而用户只是
                // 按了取消。判据是这一趟自己的取消标志，不是那个错误——那条路会把一次
                // 取消说成一次网络故障，让人跑去检查 WiFi。
                guard !Task.isCancelled else { return }
                AppLog.drive.warning(
                    "drive download failed: \(error.localizedDescription, privacy: .public)"
                )
                // 只有还是当前这一趟时才收自己的摊子：替接手的那一趟擦掉它写着的东西
                // 比什么都不做更糟。
                if generation == self.generation {
                    runningPurpose = nil
                    progress = nil
                    discardStaged()
                }
                model.notice(DriveText.errorMessage(error), tone: .failure)
                return
            }
            landed.append(destination)
        }

        // 这一趟被取消时什么都不落：`progress` 与 `staged` 已经是接手那一趟的了。
        guard !Task.isCancelled, generation == self.generation else { return }
        runningPurpose = nil
        progress = nil
        staged = Staged(files: landed, purpose: purpose, itemIds: items.map(\.id))
        if purpose == .share {
            shareRequest = ShareRequest(files: landed)
        }
    }

    /// 一次进度回调。
    private func land(_ name: String, _ fraction: Double, generation: Int) {
        guard generation == self.generation else { return }
        progress = Download(name: name, fraction: fraction)
    }

    // MARK: - 落地

    /// 一次下载落到一个自己的子目录里。
    ///
    /// 不直接往 `temporaryDirectory` 里扔：那些文件与别处的临时文件混在一层，收尾时
    /// 就只能照着文件名一个个删，而文件名不唯一。
    private func makeStagingDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("SynapseDriveExport", isDirectory: true)
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        stagingDirectory = directory
        sweep(root)
        return directory
    }

    /// 清掉过期的那些。
    ///
    /// 上一趟开始时与面板收起时都会删掉当时那一份，但 App 在那之前被系统杀掉的话它会
    /// 留在盘上，而临时目录系统不会替我们收。只清一天之前的：更近的那几份可能正被
    /// 另一个界面用着（一个还开着的面板就在读它）。
    private func sweep(_ root: URL) {
        let manager = FileManager.default
        guard let entries = try? manager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        for entry in entries where entry != stagingDirectory {
            let values = try? entry.resourceValues(forKeys: [.contentModificationDateKey])
            // 读不出来时按「刚刚」算：宁可留一份，也不要删掉一份说不清年纪的。
            let modified = values?.contentModificationDate ?? Date()
            if modified < cutoff {
                try? manager.removeItem(at: entry)
            }
        }
    }

    private func discardStaged() {
        if let stagingDirectory {
            try? FileManager.default.removeItem(at: stagingDirectory)
        }
        stagingDirectory = nil
        staged = nil
    }

    // MARK: - 纯判据

    /// 这一批里有没有大到要先问一句的；有的话返回这一批的总字节数。
    ///
    /// 判据是「其中任何一项超过阈值」，问的时候报的是这一批的总量——一次导出问一次就
    /// 够了，逐项问会把一次多选变成一串弹窗。
    ///
    /// 读不出大小的一项不算数：量不到大小不等于它是大文件，为一句「可能很大」拦住一次
    /// 本来能直接做完的下载不划算。
    static func confirmationTotal(for items: [DriveBrowserItem]) -> Int64? {
        let sizes = items.compactMap(\.sizeBytes)
        guard sizes.contains(where: { $0 > confirmationThresholdBytes }) else { return nil }
        return sizes.reduce(0, +)
    }

    /// 落地那一份叫什么。
    ///
    /// 用云盘里的名字（连扩展名）：面板上、「存储到文件」之后、以及 QuickLook 按什么
    /// 打开它，认的都是这个名字。只剥路径分隔符——名字里带一个 `/` 会让 URL 指到别的
    /// 目录去；而中文、空格、括号都是这个名字本来的样子，一个都不动。
    static func stagedName(for item: DriveBrowserItem) -> String {
        let stripped = (item.name.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base = stripped.isEmpty ? "下载" : stripped
        // 文件夹那条路由服务端压成 zip 回来，名字跟着它变：面板上看到的就是最后解压出来的那个。
        guard item.isFolder, !base.lowercased().hasSuffix(".zip") else { return base }
        return base + ".zip"
    }

    /// 同一批里重名时补一个序号。
    ///
    /// 云盘允许同一层有同名文件（改名与上传都只管 id），而面板拿到两个同名 URL 时用户
    /// 分不出哪个是哪个，有些动作还会互相盖掉。序号是系统自己的写法（`报告 (2).pdf`）。
    static func unique(_ name: String, taken: Set<String>) -> String {
        guard taken.contains(name) else { return name }
        let ext = (name as NSString).pathExtension
        let stem = ext.isEmpty ? name : String(name.dropLast(ext.count + 1))
        var index = 2
        while true {
            let candidate = ext.isEmpty ? "\(stem) (\(index))" : "\(stem) (\(index)).\(ext)"
            if !taken.contains(candidate) { return candidate }
            index += 1
        }
    }
}

/// 系统分享面板。
///
/// 自己写一份，不去够 `DiagnosticLogView` 里那个：那个是 `private`，跨文件拿不到。
/// 「存储到文件」就在面板里，所以导出不需要第二个按钮（Spec §5.4）。
///
/// 收起由调用方的 `.sheet(onDismiss:)` 接：面板自己那个 `completionWithItemsHandler`
/// 只在它被 present 出来时保证会到，嵌在 sheet 里时不保证。
struct DriveShareSheet: UIViewControllerRepresentable {
    let items: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // iPad 上它会以 popover 出现，没有锚点 UIKit 会直接抛异常。`sourceView` 就在
        // 自己身上，取中间那一点——呈现出来是整幅面板，箭头指哪都一样。
        if let popover = controller.popoverPresentationController {
            popover.sourceView = controller.view
            popover.sourceRect = CGRect(
                x: controller.view.bounds.midX,
                y: controller.view.bounds.midY,
                width: 0,
                height: 0
            )
            popover.permittedArrowDirections = []
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
