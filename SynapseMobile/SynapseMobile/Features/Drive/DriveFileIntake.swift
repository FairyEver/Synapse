import Foundation
import os
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// 三个 picker 交回来的东西 → 磁盘上一份能上传的文件。
///
/// 与终端接力那套（`TerminalFileIntake`）是两条路，只共用了三个 picker 本身：
///
/// - **名字。** `sanitizedFileName` 只留 ASCII 字母、数字与 `._-`，其余每个标量塌成一个
///   `-`：`需求规格.md` 会变成 `-.md`。那条规则是给「名字要被敲进 shell」用的，云盘的
///   文件名只进云盘，没有这个约束，所以这里只剥掉路径分隔符。
/// - **数量。** 接力一次打字有上限（`relayMaxFileCount`），云盘只受服务端「每个文件
///   100 MB」这一条限制，来多少收多少，这里不做截断。
///
/// 落地这一步没得选：`loadFileRepresentation` 交出来的 URL 只在回调返回之前有效，
/// 所以相册那条必须当场拷贝一份。
enum DriveFileIntake {
    // MARK: - 相册

    /// 相册选中的一批。一项落地失败只丢它自己，不影响其余的。
    static func prepare(results: [PHPickerResult]) async -> [PickedFile] {
        var files: [PickedFile] = []
        for result in results {
            guard let file = await prepare(result: result) else { continue }
            files.append(file)
        }
        return files
    }

    /// 相册选中的一项。
    static func prepare(result: PHPickerResult) async -> PickedFile? {
        let provider = result.itemProvider
        guard let type = representationType(of: provider) else { return nil }
        guard let landed = await land(provider: provider, as: type) else { return nil }
        return file(
            at: landed,
            name: libraryName(
                suggested: provider.suggestedName,
                landedExtension: landed.pathExtension,
                isMovie: type == .movie
            )
        )
    }

    // MARK: - 文件 App

    /// 文件 App 选中的一批。
    static func prepare(documentURLs urls: [URL]) -> [PickedFile] {
        urls.compactMap { prepare(documentURL: $0) }
    }

    /// 文件 App 选中的一项。`asCopy: true` 给的已经是本 App 容器里的一份拷贝，不需要
    /// 安全作用域，名字也就是它在「文件」里那个名字。
    static func prepare(documentURL url: URL) -> PickedFile? {
        let name = url.lastPathComponent
        guard !name.isEmpty else { return nil }
        return file(at: url, name: name)
    }

    // MARK: - 相机

    /// 相机交回来的东西。
    ///
    /// 相片没有文件名可用（内存里就是一张图），写一份到临时目录再按时间戳起名；录像
    /// picker 已经替我们落好了盘，直接用它的 URL 与它自己的文件名，不再拷第二份。
    static func prepare(camera capture: CameraCapture) async -> PickedFile? {
        switch capture {
        case .photo(let image):
            // 全分辨率重编码就在主 actor 上：`UIImage` 不是 Sendable，搬出去换来的只是
            // 一条警告，字节并没有真的搬到别处。与接力那条路同一条权衡。
            guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
            let name = generatedFileName(prefix: "照片", extension: "jpg")
            guard let url = try? write(data, as: name) else { return nil }
            return file(at: url, name: name)
        case .video(let url):
            guard !url.lastPathComponent.isEmpty else { return nil }
            return file(at: url, name: url.lastPathComponent)
        }
    }

    // MARK: - 收拾

    /// 删掉这一趟落在临时目录里的那份拷贝。
    ///
    /// 谁落下谁删：`land` 与 `write` 往 `temporaryDirectory` 里放的东西（一条最大 100 MB）
    /// 在这里之外的另一个删除点是 `DriveUploader.discard`（用户把一项从上传列表里拿掉时走
    /// 它；那条队列由 `DriveBrowserView.enqueue` 接上）。用完不删就随上传次数累积在盘上。
    ///
    /// 只有落在本 App 临时目录里的才删（与 `DriveUploader.discard` 同一条守卫）：文件 App
    /// 那条路交回来的是别的 App 或 iCloud 里的东西，删掉就是删用户的文件。
    static func discard(_ file: PickedFile) {
        guard file.url.path.hasPrefix(FileManager.default.temporaryDirectory.path) else { return }
        try? FileManager.default.removeItem(at: file.url)
    }

    // MARK: - 取名

    /// picker 交回来的名字 → 云盘里那个名字。
    ///
    /// 只做两件事：剥掉路径分隔符；缺扩展名时补上。别的都不做——不折叠、不转 ASCII、
    /// 不截断长度，中文、空格、括号都原样留住。
    ///
    /// - Parameter fallbackExtension: 补扩展名时用哪个（不带点）。空串表示补不了。
    /// - Returns: 归一之后的名字；连一个字符都没有时返回 nil，由调用方自己起一个。
    static func uploadName(_ raw: String, fallbackExtension: String) -> String? {
        let name = stripped(raw)
        guard !name.isEmpty else { return nil }
        let ext = fallbackExtension.trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        guard !ext.isEmpty, (name as NSString).pathExtension.isEmpty else { return name }
        return "\(name).\(ext)"
    }

    /// 相册那一项的名字从哪来。
    ///
    /// `suggestedName` 就是它在「照片」里的名字，多数时候带着扩展名，但有些 iOS 版本上
    /// 不带——而扩展名决定服务端按什么预览、别的机器能不能打开它，所以缺了就按落地的那份
    /// 文件补上。连 `suggestedName` 都没有（系统偶尔不给）时才自己按时间戳起一个。
    private static func libraryName(suggested: String?, landedExtension: String, isMovie: Bool) -> String {
        if let named = uploadName(suggested ?? "", fallbackExtension: landedExtension) { return named }
        return generatedFileName(
            prefix: isMovie ? "视频" : "照片",
            extension: landedExtension.isEmpty ? "dat" : landedExtension
        )
    }

    /// 只剥路径分隔符。
    ///
    /// 取最后一段（`a/b.md` 是 `b.md`），首尾的空白也去掉——复制粘贴进来的名字常带一个
    /// 换行，那不是名字的一部分。**里面**的空白不动：`我的 报告 (1).md` 是它本来的样子。
    private static func stripped(_ raw: String) -> String {
        (raw.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - 落地

    /// 磁盘上那一份 + 云盘里那个名字。
    private static func file(at url: URL, name: String) -> PickedFile? {
        guard FileManager.default.isReadableFile(atPath: url.path) else { return nil }
        // 量不到大小按 0 走：服务端自己会量真实字节数（声明的大小与对象不符会被它拒掉），
        // 而 0 在这里只表示「量不到」。
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? nil
        return PickedFile(url: url, name: name, size: size ?? 0, mimeType: mimeType(forFileNamed: name))
    }

    /// 把相册那一项拷到本 App 的临时目录，返回那份拷贝的 URL。
    ///
    /// 拷贝必须在回调内部完成：那边交出来的 URL 是系统为这一次访问临时放出来的，回调一
    /// 返回就作废。
    private static func land(provider: NSItemProvider, as type: UTType) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                let destination = FileManager.default.temporaryDirectory
                    .appendingPathComponent("drive-\(UUID().uuidString)-\(url.lastPathComponent)")
                do {
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume(returning: destination)
                } catch {
                    // 这一项就没有文件可传了，调用方按「它没进来」处理；原因留在日志里。
                    AppLog.drive.warning("drive intake copy failed: \(error.localizedDescription, privacy: .public)")
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    /// 相册那一项该要哪种表示。
    ///
    /// 先图后视频，与接力那条路同一条：一张实况照片两种都有，而用户挑的是那张**照片**，
    /// 取视频会把一张选中的照片悄悄变成一段会动的。
    private static func representationType(of provider: NSItemProvider) -> UTType? {
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) { return .image }
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) { return .movie }
        return nil
    }

    /// 字节落到临时目录里，文件名带上它自己的名字，好在盘上认出来是什么。
    private static func write(_ data: Data, as name: String) throws -> URL {
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("drive-\(UUID().uuidString)-\(name)")
        try data.write(to: destination)
        return destination
    }
}
