import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Turns what a system picker hands back into files this app can upload.
///
/// All three sources converge here because the rest of the feature does not care
/// where a file came from — the design's whole point is that picking a photo,
/// shooting one and pasting one are the same channel with different first steps.
enum TerminalFileIntake {
    /// A photo-library item.
    ///
    /// `loadFileRepresentation` hands over the asset's own file, and the URL it
    /// gives is only valid until the callback returns, so the copy has to happen
    /// inside it.
    static func prepare(imageProvider provider: NSItemProvider) async -> PickedFile? {
        let copied = await copyRepresentation(of: provider)
        guard let copied else { return nil }
        return await normalizeImage(at: copied.url, name: copied.name)
    }

    /// A document the user chose. `asCopy: true` means the URL already points at a
    /// copy inside this app's container, so it can be read without a security scope.
    static func prepare(documentURL url: URL) async -> PickedFile? {
        let name = url.lastPathComponent
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("relay-\(UUID().uuidString)-\(name)")
        do {
            try FileManager.default.copyItem(at: url, to: destination)
        } catch {
            return nil
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int64) ?? nil
        guard let resolved = PreparedFile.standardized(destination, name: name, size: size ?? 0) else {
            return nil
        }
        return resolved
    }

    /// A picture taken with the camera.
    static func prepare(cameraImage image: UIImage) async -> PickedFile? {
        let name = generatedFileName(prefix: "照片", extension: "jpg")
        return write(image: image, name: name, type: .jpeg)
    }

    /// A picture from the pasteboard.
    ///
    /// The design names these by timestamp because a pasted image has no name of
    /// its own — there is nothing to preserve.
    static func prepare(pastedImage image: UIImage) async -> PickedFile? {
        let name = generatedFileName(prefix: "粘贴图片", extension: "png")
        return write(image: image, name: name, type: .png)
    }

    // MARK: - Internals

    private static func copyRepresentation(of provider: NSItemProvider) async -> (url: URL, name: String)? {
        await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
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

    /// Converts HEIC to JPEG, and passes everything else through untouched.
    ///
    /// iPhone photos are HEIC by default and most command-line tools and models
    /// cannot read it, so the file that reaches the computer has to be JPEG — with
    /// the extension to match, because the extension is what those tools believe.
    private static func normalizeImage(at url: URL, name: String) async -> PickedFile? {
        guard isHeic(name) else {
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? nil
            return PreparedFile.standardized(url, name: name, size: size ?? 0)
        }
        guard let image = UIImage(contentsOfFile: url.path) else { return nil }
        let jpegName = (name as NSString).deletingPathExtension + ".jpg"
        // The HEIC copy was only ever a staging file.
        try? FileManager.default.removeItem(at: url)
        return write(image: image, name: jpegName, type: .jpeg)
    }

    private static func write(image: UIImage, name: String, type: UTType) -> PickedFile? {
        let data = type == .jpeg
            ? image.jpegData(compressionQuality: 0.9)
            : image.pngData()
        guard let data else { return nil }
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

    private static func isHeic(_ name: String) -> Bool {
        let ext = (name as NSString).pathExtension.lowercased()
        return ext == "heic" || ext == "heif"
    }
}

private enum PreparedFile {
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
/// `PHPickerViewController` runs out of process, which is why it needs no photo
/// permission — there is no usage-description key for it and none should be added.
struct PhotoLibraryPicker: UIViewControllerRepresentable {
    let selectionLimit: Int
    let onPicked: ([NSItemProvider]) -> Void
    let onCancelled: () -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
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
        private let onPicked: ([NSItemProvider]) -> Void
        private let onCancelled: () -> Void

        init(onPicked: @escaping ([NSItemProvider]) -> Void, onCancelled: @escaping () -> Void) {
            self.onPicked = onPicked
            self.onCancelled = onCancelled
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else {
                onCancelled()
                return
            }
            onPicked(results.map(\.itemProvider))
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

/// The camera. The only source here that needs a usage description, because it is
/// the only one that is not running in another process on the user's behalf.
struct CameraPicker: UIViewControllerRepresentable {
    let onPicked: (UIImage) -> Void
    let onCancelled: () -> Void

    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.mediaTypes = [UTType.image.identifier]
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPicked: onPicked, onCancelled: onCancelled)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onPicked: (UIImage) -> Void
        private let onCancelled: () -> Void

        init(onPicked: @escaping (UIImage) -> Void, onCancelled: @escaping () -> Void) {
            self.onPicked = onPicked
            self.onCancelled = onCancelled
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            guard let image = info[.originalImage] as? UIImage else {
                onCancelled()
                return
            }
            onPicked(image)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCancelled()
        }
    }
}
