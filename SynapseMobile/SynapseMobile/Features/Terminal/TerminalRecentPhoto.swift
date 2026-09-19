import CoreGraphics
import Foundation
import Photos
import UIKit

/// 相册里最新的一张图，摆在输入栏上方等着被一键发出去。
///
/// 它和「照片和视频」挑出来的是同一种东西，只是少了一次挑：刚截的图、刚拍的照片
/// 本来就是用户要发的那一张，再让他进一次相册，等于把同一个问题问第二遍。所以这
/// 条路全程不产生新的发送方式 —— 落到的还是 `PickedFile`，走的还是同一条 `hand(_:)`。
struct RecentPhoto: Equatable {
    let id: String
    let thumbnail: UIImage
    let createdAt: Date
}

/// 一张图还算不算「刚拍的」的那个窗口。
///
/// 气泡说的是「你刚刚拍了/截了一张」，而这句话只在很短的一段时间里成立。窗口外
/// 它必须消失：一个常驻的缩略图会变成输入栏上永久多出来的一格，而它本来只是一句
/// 时机性的提议，不是一条常设入口。
let recentPhotoFreshness: TimeInterval = 5 * 60

/// 它露一次脸多久。
///
/// 气泡是一个提议，不是输入栏上的一格：看过一眼就够了。没有关闭按钮也不是缺省 ——
/// 没有人需要为一条五分钟前就不再成立的说法专门去点一下叉，它自己走掉才是对的。
let recentPhotoDisplayDuration: TimeInterval = 5

/// 这一张该不该被摆出来。
///
/// 两端都是闭区间，而且**未来时间不算新鲜**。相册的拍摄时间和这台设备的时钟对不
/// 上是真会发生的（从备份恢复、时区跳过、跨设备同步），而把一个明年的日期当成
/// 「刚刚」摆出来，是这套判定里最难向用户解释的一种错法 —— 它会把一张陈年旧图
/// 说成刚拍的。宁可这次不提议。
func recentPhotoIsFresh(
    createdAt: Date,
    now: Date,
    within window: TimeInterval = recentPhotoFreshness
) -> Bool {
    let age = now.timeIntervalSince(createdAt)
    return age >= 0 && age <= window
}

/// 直接读相册，而不是绕过选择器。
///
/// 这个功能里其它每一条路都经过系统选择器，这也是 App 在此之前**完全没有相册权限**
/// 的原因：`PHPickerViewController` 跑在别的进程里，给用户他自己的相册看，而双方都
/// 没有因此拿到它。只是「最新的一张」这件事问不了选择器 —— 选择器只在有人挑完之后
/// 才回答问题 —— 所以这里是全 App 唯一一处自己读相册的地方，也是唯一需要那句用途
/// 说明的地方（见 `Info.plist`）。
@MainActor
enum TerminalRecentPhotoLibrary {
    /// 已经露过面的照片：气泡发走的、用户自己从相册里挑过的、以及已经浮出来过一次的。
    ///
    /// 三种情形记的是同一件事 —— 这一张不用再被提议了。发走的那张再浮回来，用户会
    /// 以为上一次没发出去；刚从相册里手动选过的那张可能正好就是最新的一张；而已经
    /// 浮过一次的那张，用户在那五秒里已经看过了，再浮一次不是「检测到变化」，只是
    /// 重复打扰。
    ///
    /// 只在这一次运行里记着。窗口只有五分钟，为它落一份盘不值得，而重启之后把五分钟
    /// 内那张再摆一次也不算什么错。
    private static var shown: Set<String> = []

    static func markShown(_ id: String) {
        shown.insert(id)
    }

    static var status: PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    /// 授权和「仅选中的照片」都算能读 —— 后者读到的是用户自己圈出来的那一小份，
    /// 里面的最新一张照样可以摆出来。读不到刚截的图是它的必然代价，不为它单独提示：
    /// 气泡是一个被动的提议，把系统设置的修补口摆在上面，比不提议更打扰。
    static var isAuthorized: Bool {
        let status = status
        return status == .authorized || status == .limited
    }

    /// 问一次相册权限。
    ///
    /// **时机不在这里决定**：调用方只在用户已经用过一次「照片和视频」之后才问
    /// （`TerminalScreen.offerRecentPhotoAccess()`）。这个功能的入口是那条菜单项，
    /// 让人在用过它之前先回答一个关于相册的问题，是在为一个还没人知道存在的功能
    /// 索取权限。
    static var isUndetermined: Bool { status == .notDetermined }

    @discardableResult
    static func requestAccess() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return status == .authorized || status == .limited
    }

    /// 相册里最新的一张图，前提是它够新、而且还没被发过。
    ///
    /// 排序按拍摄时间而不是入库时间：截图和刚拍的照片在相册看来是同一种东西，
    /// 差别只在 `mediaSubtypes`，而两者都带拍摄时间。视频不在候选里 —— 气泡只有
    /// 一个缩略图那么大，一张会动的图在这里没有诚实的画法。
    static func latestOfferable(now: Date = Date()) async -> RecentPhoto? {
        guard isAuthorized else { return nil }

        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 1
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        guard let asset = PHAsset.fetchAssets(with: options).firstObject else { return nil }
        guard let createdAt = asset.creationDate else { return nil }
        guard recentPhotoIsFresh(createdAt: createdAt, now: now) else { return nil }
        guard !shown.contains(asset.localIdentifier) else { return nil }
        guard let thumbnail = await thumbnail(for: asset) else { return nil }

        return RecentPhoto(id: asset.localIdentifier, thumbnail: thumbnail, createdAt: createdAt)
    }

    /// 把那一张的**原图**落进临时目录，交给和相册选择器同一条归一化。
    ///
    /// `PHAssetResourceManager` 交出来的是资源原本的字节（iPhone 上是 HEIC），与
    /// `PHPicker` 交出来的完全一致 —— 于是 HEIC→JPEG 那一步是同一份代码在跑，而不是
    /// 「气泡发出去的图碰巧也能用」。
    static func writeOriginal(for assetId: String) async -> (url: URL, name: String)? {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
        guard let asset = result.firstObject, let resource = photoResource(of: asset) else { return nil }

        let name = resource.originalFilename
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("relay-\(UUID().uuidString)-\(name)")
        let options = PHAssetResourceRequestOptions()
        // 这里允许联网，和上面取缩略图时正好相反：用户已经点名要发这一张了，为它等
        // 一次云端原图是对的；悄悄换一张、或者什么都不发，才是错的。
        options.isNetworkAccessAllowed = true

        return await withCheckedContinuation { (continuation: CheckedContinuation<(url: URL, name: String)?, Never>) in
            PHAssetResourceManager.default().writeData(for: resource, toFile: destination, options: options) { error in
                if error == nil {
                    continuation.resume(returning: (destination, name))
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    // MARK: - Internals

    /// 缩略图按显示尺寸的两倍要，多的像素没人看得见。
    ///
    /// `isNetworkAccessAllowed` 关着：这里读的是「刚刚那张」，它必然在本机。真落到
    /// 要联网才能取到一张图的元数据时，替用户在后台开一次网络去换一个缩略图，不如
    /// 这次不提议 —— 切回前台还会再问一次。
    private static func thumbnail(for asset: PHAsset, side: CGFloat = 144) async -> UIImage? {
        await withCheckedContinuation { (continuation: CheckedContinuation<UIImage?, Never>) in
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .exact
            options.isNetworkAccessAllowed = false

            // `highQualityFormat` 只回调一次，但降级图和取消也走这一个闭包，而续体
            // 只能 resume 一次 —— 多重 resume 会直接崩。
            var resumed = false
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: CGSize(width: side, height: side),
                contentMode: .aspectFill,
                options: options
            ) { image, info in
                if let image {
                    guard !resumed else { return }
                    resumed = true
                    continuation.resume(returning: image)
                    return
                }
                // 空的这一次不算结论之前先看它是不是降级图：是就等下一张，不是才收摊。
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                guard !degraded, !resumed else { return }
                resumed = true
                continuation.resume(returning: nil)
            }
        }
    }

    /// 哪一份资源是「这张图本身」。
    ///
    /// 实况照片同时带着一张静帧和一段短片，`.photo` 是静帧 —— 取到配对的视频，等于
    /// 把用户要发的照片换成一段会动的东西。优先 `.photo` 而不是 `.fullSizePhoto`：
    /// 前者才是选择器交出来的那一份，两条路要产出同一个文件。
    private static func photoResource(of asset: PHAsset) -> PHAssetResource? {
        let resources = PHAssetResource.assetResources(for: asset)
        return resources.first { $0.type == .photo }
            ?? resources.first { $0.type == .fullSizePhoto }
            ?? resources.first
    }
}

/// 相册里的变化，一发生就报。
///
/// 截图入库、别的 App 存下一张、iCloud 同步下来一张，都从这里进来。
///
/// 这条路上原先没有它，靠的是「截屏通知 + 等一秒再查」—— 实测那一秒猜错了：截第二张
/// 时第一次查还在写，查到的是上一张，而那一发没有第二次机会，于是气泡里一直停着旧的
/// 那张。等久一点只是把猜错的时间推后，问题在猜本身：入库是异步的，只有相册自己知道
/// 它什么时候完成。
@MainActor
final class TerminalRecentPhotoWatcher: NSObject, PHPhotoLibraryChangeObserver {
    private let onChange: () -> Void

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
        super.init()
    }

    func start() {
        PHPhotoLibrary.shared().register(self)
    }

    /// 不收回来它会一直活着：注册是强引用，而持有它的那个界面早就走了。
    func stop() {
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
    }

    /// 回调落在哪个线程上没有承诺，所以只借它敲一下门，判定留在主线程上做。
    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in onChange() }
    }
}
