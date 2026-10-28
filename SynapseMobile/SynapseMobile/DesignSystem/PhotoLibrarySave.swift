import Photos
import UIKit

enum PhotoLibrarySaveError: Error, Equatable { case denied, failed }

protocol PhotoLibrarySaving {
    func save(originalFile: URL) async throws
}

/// 把下载下来的原图直接交给相册。
///
/// 交出去的是**下载原文件那段字节**，不是屏幕上那张降采样过的图：解码、缩放只服务显示，
/// 存进相册的应该是服务端给的那一份，不经二次编码，也不为保存再整图解码一次。
struct PhotoLibrarySaver: PhotoLibrarySaving {
    func save(originalFile: URL) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw PhotoLibrarySaveError.denied }
        guard let data = try? Data(contentsOf: originalFile) else { throw PhotoLibrarySaveError.failed }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }
        } catch {
            throw PhotoLibrarySaveError.failed
        }
    }
}
