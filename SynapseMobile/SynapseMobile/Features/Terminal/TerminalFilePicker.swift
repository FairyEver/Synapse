import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Turns what a system picker hands back into files this app can upload.
///
/// All the sources converge here because the rest of the feature does not care
/// where a file came from — the design's whole point is that picking a photo,
/// shooting one and pasting one are the same channel with different first steps.
/// Nor does it care what kind of file it is: the drive stores bytes and the
/// desktop only splits the name, so a video takes the same path a picture does.
enum TerminalFileIntake {
    /// A photo-library item, still or moving.
    ///
    /// `loadFileRepresentation` hands over the asset's own file, and the URL it
    /// gives is only valid until the callback returns, so the copy has to happen
    /// inside it.
    static func prepare(provider: NSItemProvider) async -> PickedFile? {
        guard let type = representationType(of: provider) else { return nil }
        let copied = await copyRepresentation(of: provider, as: type)
        guard let copied else { return nil }
        return await normalizeLibraryFile(at: copied.url, name: copied.name)
    }

    /// 相册里已经知道是哪一张的图 —— 用户没进相册，App 自己找出来的那一张。
    ///
    /// 它和上面那条停在同一个地方（`normalizeLibraryFile`），这是有意的：气泡发出去
    /// 的文件必须和从相册里挑出来的那一个长得一样，包括 HEIC 转 JPEG 这一步。
    static func prepare(libraryAssetId: String) async -> PickedFile? {
        guard let written = await TerminalRecentPhotoLibrary.writeOriginal(for: libraryAssetId) else {
            return nil
        }
        return await normalizeLibraryFile(at: written.url, name: written.name)
    }

    /// A document the user chose. `asCopy: true` means the URL already points at a
    /// copy inside this app's container, so it can be read without a security scope.
    static func prepare(documentURL url: URL) async -> PickedFile? {
        await copyFile(at: url, name: url.lastPathComponent)
    }

    /// A picture taken with the camera.
    static func prepare(cameraImage image: UIImage) async -> PickedFile? {
        let name = generatedFileName(prefix: "照片", extension: "jpg")
        return await write(image: image, name: name, type: .jpeg)
    }

    /// A video recorded with the camera.
    ///
    /// The picker writes it into this app's own temporary directory under a name of
    /// its own choosing. That name is kept out of the user's way and replaced with
    /// the one a shot photo gets, so a clip arrives looking like something they
    /// took rather than like a scratch file.
    static func prepare(cameraVideo url: URL) async -> PickedFile? {
        await copyFile(at: url, name: generatedFileName(prefix: "视频", extension: "mov"))
    }

    /// A picture from the pasteboard.
    ///
    /// The design names these by timestamp because a pasted image has no name of
    /// its own — there is nothing to preserve.
    static func prepare(pastedImage image: UIImage) async -> PickedFile? {
        let name = generatedFileName(prefix: "粘贴图片", extension: "png")
        return await write(image: image, name: name, type: .png)
    }

    // MARK: - Internals

    /// Which representation a library item is asked for.
    ///
    /// Image first, and deliberately so: a Live Photo offers both, and the still is
    /// what this picker has always handed over. Taking the movie would quietly turn
    /// a photo the user picked into a moving picture.
    private static func representationType(of provider: NSItemProvider) -> UTType? {
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) { return .image }
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) { return .movie }
        return nil
    }

    private static func copyRepresentation(of provider: NSItemProvider, as type: UTType) async -> (url: URL, name: String)? {
        await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                let destination = FileManager.default.temporaryDirectory
                    .appendingPathComponent("relay-\(UUID().uuidString)-\(url.lastPathComponent)")
                do {
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume(returning: (destination, url.lastPathComponent))
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    /// Copies a file this app can already read into the temporary directory, under
    /// the name the computer will see.
    /// `nonisolated` 且 `async` —— 两样缺一不可。这个工程默认每个类型都归主 actor 管，
    /// 所以一个 `async` 函数**不等于**不占主线程；只有 `nonisolated` 的 `async` 函数才
    /// 会跑到主 actor 之外（SE-0338）。而这里拷的可能是 100 MB 的视频，在主线程上就是
    /// 整屏冻住那一下。
    nonisolated private static func copyFile(at url: URL, name: String) async -> PickedFile? {
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("relay-\(UUID().uuidString)-\(name)")
        do {
            try FileManager.default.copyItem(at: url, to: destination)
        } catch {
            return nil
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int64) ?? nil
        return PreparedFile.standardized(destination, name: name, size: size ?? 0)
    }

    /// Converts HEIC to JPEG, and passes everything else through untouched.
    ///
    /// iPhone photos are HEIC by default and most command-line tools and models
    /// cannot read it, so the file that reaches the computer has to be JPEG — with
    /// the extension to match, because the extension is what those tools believe.
    /// A video has no such problem, and takes the pass-through branch below.
    /// 解码、重编码、落盘，整段都在主线程之外。
    ///
    /// 这是最容易冻住界面的那一条：从相册一次选九张 HEIC，`TerminalScreen.intake` 会
    /// 顺序 await 九次，而每一张全分辨率解码在内存里就是一份上百兆的位图，`jpegData`
    /// 再来第二份 —— 全在主线程上背靠背地跑，界面完全冻住、选择器里的转圈也不动，
    /// 大图还能摸到 watchdog 的窗口。
    ///
    /// 只接 URL 与 String（都是 Sendable），位图本身一步都不跨 actor，所以这条路上没有
    /// 任何跨隔离传递。
    nonisolated private static func normalizeLibraryFile(at url: URL, name: String) async -> PickedFile? {
        guard isHeic(name) else {
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? nil
            return PreparedFile.standardized(url, name: name, size: size ?? 0)
        }
        guard let image = UIImage(contentsOfFile: url.path) else { return nil }
        let jpegName = (name as NSString).deletingPathExtension + ".jpg"
        // The HEIC copy was only ever a staging file.
        try? FileManager.default.removeItem(at: url)
        guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
        return await store(data: data, name: jpegName, type: .jpeg)
    }

    /// 已经把字节拿在手上的那条路：写盘 + 命名。
    nonisolated private static func store(data: Data, name: String, type: UTType) async -> PickedFile? {
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("relay-\(UUID().uuidString)-\(name)")
        do {
            try data.write(to: destination)
        } catch {
            return nil
        }
        guard let relayName = PickedFile.relayName(for: name, fallbackExtension: ".\(type.preferredFilenameExtension ?? "dat")")
        else { return nil }
        return PickedFile(
            url: destination,
            name: relayName,
            size: Int64(data.count),
            mimeType: type.preferredMIMEType
        )
    }

    /// 相机与剪贴板那条路：字节在主 actor 上拿到（那里本来就有一张 `UIImage`，而它
    /// 不是 Sendable，跨出去只会换来一条警告而不是一次真正的搬家）。
    private static func write(image: UIImage, name: String, type: UTType) async -> PickedFile? {
        let data = type == .jpeg
            ? image.jpegData(compressionQuality: 0.9)
            : image.pngData()
        guard let data else { return nil }
        return await store(data: data, name: name, type: type)
    }

    /// `nonisolated`：判断一个扩展名，没有任何一件和主 actor 有关，而它的调用方
    /// （`normalizeLibraryFile`）在主线程之外跑。
    nonisolated private static func isHeic(_ name: String) -> Bool {
        let ext = (name as NSString).pathExtension.lowercased()
        return ext == "heic" || ext == "heif"
    }
}

/// `nonisolated`：命名与 mimeType 的推导是纯字符串处理，而拷贝与转码都在主线程之外，
/// 这两处都要用它。
nonisolated private enum PreparedFile {
    /// Applies the relay naming rules to a file that is already on disk under
    /// `name`.
    static func standardized(_ url: URL, name: String, size: Int64) -> PickedFile? {
        let ext = (name as NSString).pathExtension
        guard let relayName = PickedFile.relayName(for: name, fallbackExtension: ext.isEmpty ? "" : ".\(ext)")
        else { return nil }
        return PickedFile(url: url, name: relayName, size: size, mimeType: mimeType(forFileNamed: name))
    }
}

// MARK: - System pickers

/// The photo library.
///
/// `PHPickerViewController` runs out of process, which is why **this** needs no photo
/// permission and has no usage description of its own. The app does now hold one —
/// for the newest-picture offer, which by definition cannot come from a picker the
/// user has not opened yet (see `TerminalRecentPhotoLibrary`). This picker is
/// unaffected by it: it would work the same with the permission denied.
///
/// The whole `PHPickerResult` is handed back rather than just its item provider,
/// because the result also carries the library's own identifier for what was picked.
/// That identifier is what keeps a picture the user just chose here from floating up
/// as the newest one a moment later.
struct PhotoLibraryPicker: UIViewControllerRepresentable {
    let selectionLimit: Int
    let onPicked: ([PHPickerResult]) -> Void
    let onCancelled: () -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        // Both, because a video is the same kind of thing to everything downstream:
        // the drive stores its bytes and the desktop types its path. `.livePhotos`
        // is left out on purpose — its asset carries a movie alongside the still,
        // and a photo the user picked should stay a photo.
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = selectionLimit
        // The image itself, not a transcoded rendition: the file has to arrive on
        // the computer as the bytes the user picked.
        configuration.preferredAssetRepresentationMode = .current

        let controller = PHPickerViewController(configuration: configuration)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPicked: onPicked, onCancelled: onCancelled)
    }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let onPicked: ([PHPickerResult]) -> Void
        private let onCancelled: () -> Void

        init(onPicked: @escaping ([PHPickerResult]) -> Void, onCancelled: @escaping () -> Void) {
            self.onPicked = onPicked
            self.onCancelled = onCancelled
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else {
                onCancelled()
                return
            }
            onPicked(results)
        }
    }
}

/// The Files app.
///
/// Also out of process. `asCopy` is what makes the returned URL readable without a
/// security-scoped bookmark dance.
struct DocumentPicker: UIViewControllerRepresentable {
    let onPicked: ([URL]) -> Void
    let onCancelled: () -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        controller.allowsMultipleSelection = true
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPicked: onPicked, onCancelled: onCancelled)
    }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        private let onPicked: ([URL]) -> Void
        private let onCancelled: () -> Void

        init(onPicked: @escaping ([URL]) -> Void, onCancelled: @escaping () -> Void) {
            self.onPicked = onPicked
            self.onCancelled = onCancelled
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard !urls.isEmpty else {
                onCancelled()
                return
            }
            onPicked(urls)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            onCancelled()
        }
    }
}

/// What the camera handed back.
///
/// The shutter and the record button are the same screen with a mode switch, so one
/// picker serves both and the delegate can be handed either.
enum CameraCapture {
    case photo(UIImage)
    case video(URL)
}

/// The camera. The only source here that needs a usage description, because it is
/// the only one that is not running in another process on the user's behalf.
struct CameraPicker: UIViewControllerRepresentable {
    let onPicked: (CameraCapture) -> Void
    let onCancelled: () -> Void

    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        // Both, which is what puts the photo/video switch in the camera's own bar.
        controller.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        // The default here is VGA, which is not worth the trip to the computer.
        controller.videoQuality = .typeHigh
        // A recording is stopped where the upload would have refused it. The picker's
        // own default is ten minutes, several times what the relay carries, so
        // without this the user could record for minutes and then be told the file
        // is too big — a recording made entirely to be thrown away.
        controller.videoMaximumDuration = AppConfiguration.relayCameraVideoSeconds
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPicked: onPicked, onCancelled: onCancelled)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onPicked: (CameraCapture) -> Void
        private let onCancelled: () -> Void

        init(onPicked: @escaping (CameraCapture) -> Void, onCancelled: @escaping () -> Void) {
            self.onPicked = onPicked
            self.onCancelled = onCancelled
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                onPicked(.photo(image))
                return
            }
            // A recording lands in this app's own temporary directory rather than in
            // the library, so it is the intake's copy — not this URL — that has to
            // outlive the picker.
            if let url = info[.mediaURL] as? URL {
                onPicked(.video(url))
                return
            }
            onCancelled()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCancelled()
        }
    }
}
