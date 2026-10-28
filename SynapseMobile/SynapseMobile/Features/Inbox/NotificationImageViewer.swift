import Combine
import SwiftUI

/// 通知图片的加载与保存。
///
/// 一次只认一种状态：加载中、已经拿到那张原文件、或者失败。失败之后**可以重试** ——
/// 这条图片是一次按需下载，失败不留下任何东西，再按一次就是从头再来。
@MainActor
final class NotificationImageViewerModel: ObservableObject {
    enum State: Equatable { case loading, loaded(URL), failed }
    @Published private(set) var state: State = .loading
    @Published private(set) var notice: String?

    private let loader: () async throws -> URL
    private let saver: any PhotoLibrarySaving

    init(notificationId: String, loader: @escaping () async throws -> URL, saver: any PhotoLibrarySaving) {
        self.loader = loader
        self.saver = saver
    }

    func load() async {
        state = .loading
        do { state = .loaded(try await loader()) }
        catch { state = .failed }
    }

    /// 存的是下载下来的那份原文件。
    ///
    /// 屏幕上的图是降采样过的（见 `ZoomableImage`），那份只服务显示。相册要的是服务端给的
    /// 原图，所以这里把 URL 原样交给保存者 —— 不重新编码，也不为保存再整图解码一次。
    func save() async {
        guard case .loaded(let url) = state else { return }
        do {
            try await saver.save(originalFile: url)
            notice = "已保存到相册"
        } catch PhotoLibrarySaveError.denied {
            notice = "没有相册写入权限"
        } catch {
            notice = "保存失败"
        }
    }

    func clearNotice() { notice = nil }

    /// 显示那一层没解出图。
    ///
    /// 状态机只有三个态：拿不到一张能画的图，对用户来说就是失败，不必再多一个第四态。
    /// 从 `.loaded` 退回 `.failed` 之后，“重试”照常可用，保存按钮也随之禁用。
    func markUnreadable() {
        guard case .loaded = state else { return }
        state = .failed
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
                    .disabled({ if case .loaded = model.state { return false } else { return true } }())
                    .padding()
            }
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("关闭") { dismiss() } } }
            .task { await model.load() }
            .alert(model.notice ?? "", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.clearNotice() } })) {
                Button("好", role: .cancel) {}
            }
        }
    }
}

/// 能捏合缩放的那张图。
///
/// 显示走 ImageIO 降采样（`downsampledImage`）：原图可能是几千万像素，整图解进内存只为
/// 摆在 2048 点的屏上是纯浪费。缩放的上下限交给 `UIScrollView`，捏合那套手势系统本来就写得
/// 比手搓的好。
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
        return scroll
    }

    func updateUIView(_ uiView: UIScrollView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
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
