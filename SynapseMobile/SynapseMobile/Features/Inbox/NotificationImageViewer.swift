import Combine
import Foundation
import SwiftUI
import UIKit

/// 本次 App 运行期间按通知 id 记住图片字节。
///
/// 存字节而不是临时文件：临时文件在查看器消失或保存成功后要删掉，而重新打开同一条通知
/// 不该再走一趟网络。旋转、关闭后重开、从通知页再进来，都命中这一份。
actor NotificationImageCache {
    static let shared = NotificationImageCache()

    private var images: [String: Data] = [:]

    func data(for notificationId: String) -> Data? { images[notificationId] }

    func store(_ data: Data, for notificationId: String) { images[notificationId] = data }
}

/// 通知图片的加载与保存。
///
/// 一次只认一种状态：加载中、已经拿到那张原文件、或者失败。失败之后**可以重试** ——
/// 这条图片是一次按需下载，失败不留下任何东西，再按一次就是从头再来。
@MainActor
final class NotificationImageViewerModel: ObservableObject {
    enum State: Equatable { case loading, loaded(URL), failed }
    @Published private(set) var state: State = .loading
    @Published private(set) var notice: String?
    /// 这条提示要不要给「去设置」：只有相册权限被拒时才为真。
    @Published private(set) var noticeOffersSettings = false
    /// 保存进行中。重复点按不该写进相册第二份。
    @Published private(set) var isSaving = false

    private let notificationId: String
    private let loader: () async throws -> URL
    private let saver: any PhotoLibrarySaving
    private let cache: NotificationImageCache
    private let openSettings: () -> Void
    private var temporaryFile: URL?

    init(
        notificationId: String,
        loader: @escaping () async throws -> URL,
        saver: any PhotoLibrarySaving,
        cache: NotificationImageCache = .shared,
        openSettings: @escaping () -> Void = {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
    ) {
        self.notificationId = notificationId
        self.loader = loader
        self.saver = saver
        self.cache = cache
        self.openSettings = openSettings
    }

    func load() async {
        state = .loading
        if let cached = await cache.data(for: notificationId), let url = writeTemporaryFile(cached) {
            state = .loaded(url)
            return
        }
        do {
            let downloaded = try await loader()
            if let data = try? Data(contentsOf: downloaded), let url = writeTemporaryFile(data) {
                await cache.store(data, for: notificationId)
                try? FileManager.default.removeItem(at: downloaded)
                state = .loaded(url)
                return
            }
            // 读不出字节时退回下载器给的临时文件，至少还能显示一次。
            temporaryFile = downloaded
            state = .loaded(downloaded)
        } catch {
            state = .failed
        }
    }

    /// 存的是下载下来的那份原文件。
    ///
    /// 屏幕上的图是降采样过的（见 `ZoomableImage`），那份只服务显示。相册要的是服务端给的
    /// 原图，所以这里把 URL 原样交给保存者 —— 不重新编码，也不为保存再整图解码一次。
    func save() async {
        guard case .loaded(let url) = state, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await saver.save(originalFile: url)
            noticeOffersSettings = false
            notice = "已保存到相册"
            // 原图已经进相册；这一份临时文件不再需要。缓存里的字节仍可重开查看。
            discardTemporaryFile()
        } catch PhotoLibrarySaveError.denied {
            // 拒绝不是终点：图仍然看得见，提示里直接给出去设置的入口。
            noticeOffersSettings = true
            notice = "没有相册写入权限"
        } catch {
            noticeOffersSettings = false
            notice = "保存失败"
        }
    }

    func openNotificationSettings() {
        openSettings()
        clearNotice()
    }

    func clearNotice() {
        notice = nil
        noticeOffersSettings = false
    }

    /// 删掉当前这份临时文件。查看器消失或保存成功后调用；缓存里的字节不受影响。
    func discardTemporaryFile() {
        guard let url = temporaryFile else { return }
        temporaryFile = nil
        try? FileManager.default.removeItem(at: url)
    }

    /// 显示那一层没解出图。
    ///
    /// 状态机只有三个态：拿不到一张能画的图，对用户来说就是失败，不必再多一个第四态。
    /// 从 `.loaded` 退回 `.failed` 之后，“重试”照常可用，保存按钮也随之禁用。
    func markUnreadable() {
        guard case .loaded = state else { return }
        state = .failed
    }

    private func writeTemporaryFile(_ data: Data) -> URL? {
        discardTemporaryFile()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("notification-viewer-\(UUID().uuidString).img")
        do {
            try data.write(to: url, options: .atomic)
            temporaryFile = url
            return url
        } catch {
            return nil
        }
    }
}

struct NotificationImageViewer: View {
    @StateObject private var model: NotificationImageViewerModel
    @Environment(\.dismiss) private var dismiss

    init(notificationId: String, loader: @escaping () async throws -> URL, saver: any PhotoLibrarySaving = PhotoLibrarySaver()) {
        _model = StateObject(wrappedValue: NotificationImageViewerModel(notificationId: notificationId, loader: loader, saver: saver))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                switch model.state {
                case .loading: ProgressView().tint(.white)
                case .failed:
                    VStack(spacing: 12) {
                        Text("图片没能加载").foregroundStyle(.white)
                        Button("重试") { Task { await model.load() } }
                    }
                case .loaded(let url):
                    ZoomableImage(url: url) { model.markUnreadable() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button("保存到相册") { Task { await model.save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(!isLoaded || model.isSaving)
                    .padding()
            }
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("关闭") { dismiss() } } }
            .task { await model.load() }
            .onDisappear { model.discardTemporaryFile() }
            .alert(model.notice ?? "", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.clearNotice() } })) {
                if model.noticeOffersSettings {
                    Button("去设置") { model.openNotificationSettings() }
                }
                Button(model.noticeOffersSettings ? "取消" : "好", role: .cancel) { model.clearNotice() }
            }
        }
    }

    private var isLoaded: Bool {
        if case .loaded = model.state { return true }
        return false
    }
}

/// 能捏合缩放的那张图。
///
/// 显示走 ImageIO 降采样（`downsampledImage`）：原图可能是几千万像素，整图解进内存只为
/// 摆在 2048 点的屏上是纯浪费。缩放的上下限交给 `UIScrollView`，捏合那套手势系统本来就写得
/// 比手搓的好。双击在「整张适应屏幕」与 1:1 之间切换 —— 1:1 是一个图片像素对一个屏幕点，
/// 不是无限放大。
private struct ZoomableImage: UIViewRepresentable {
    let url: URL
    /// 解不出图时回报。这一层只管画，说不说得出口由状态机决定。
    let onUnreadable: () -> Void

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.delegate = context.coordinator
        guard let image = downsampledImage(at: url, maxPixelSize: 2048) else {
            // 不在视图更新中途改状态：等这一帧走完再报。
            Task { @MainActor in onUnreadable() }
            return scroll
        }
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.frame = scroll.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.addSubview(view)
        context.coordinator.imageView = view
        context.coordinator.scrollView = scroll
        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleDoubleTap(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ uiView: UIScrollView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        weak var scrollView: UIScrollView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
            guard let scrollView, let imageView, let image = imageView.image else { return }
            // 已经放大了就回到整张；否则从整张切到 1:1。
            if scrollView.zoomScale > scrollView.minimumZoomScale + 0.01 {
                scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
                return
            }
            let scale = NotificationImageViewZoom.oneToOneScale(
                imagePixelWidth: image.size.width,
                viewWidth: scrollView.bounds.width
            )
            guard scale > scrollView.minimumZoomScale + 0.01 else { return }
            scrollView.maximumZoomScale = max(scrollView.maximumZoomScale, scale)
            let point = recognizer.location(in: imageView)
            let size = CGSize(
                width: scrollView.bounds.width / scale,
                height: scrollView.bounds.height / scale
            )
            scrollView.zoom(
                to: CGRect(
                    x: point.x - size.width / 2,
                    y: point.y - size.height / 2,
                    width: size.width,
                    height: size.height
                ),
                animated: true
            )
        }
    }
}

enum NotificationImageViewZoom {
    /// 1:1 的倍率：一个图片像素对一个屏幕点。按降采样后图片的实际宽度与视图宽度算。
    static func oneToOneScale(imagePixelWidth: CGFloat, viewWidth: CGFloat) -> CGFloat {
        guard imagePixelWidth > 0, viewWidth > 0 else { return 1 }
        return imagePixelWidth / viewWidth
    }
}

private func downsampledImage(at url: URL, maxPixelSize: CGFloat) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: cg)
}
