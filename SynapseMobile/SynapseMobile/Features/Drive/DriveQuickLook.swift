import QuickLook
import SwiftUI

/// 系统预览器，只接收**本机**文件。
///
/// 远程模式用不了：给 `QLPreviewController` 一个地址让它自己去取，它加不了
/// `Authorization` 头，而 owner 的下载路由正是要靠这个头认人（Spec §5.4）。所以字节
/// 先由 `DriveFileExport` 落到临时目录，这里只认那个本地 URL。
struct DriveQuickLook: UIViewControllerRepresentable {
    let url: URL
    /// 用户按了「完成」。关闭交给调用方，两种装法（sheet、被 push）下才是同一件事。
    let onDone: () -> Void

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = DriveQuickLookController()
        controller.dataSource = context.coordinator
        controller.onDone = onDone
        return controller
    }

    /// 换了一份文件就该由调用方重建这一层（`.sheet(item:)` 或 `.id(url)`）：
    /// `QLPreviewController` 不会自己回头再问数据源。这里只把回调换成最新的。
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        (controller as? DriveQuickLookController)?.onDone = onDone
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    /// 一份预览只有一项，所以数据源只回答「一条」。
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            url as NSURL
        }
    }
}

/// 导航栏上那颗「完成」。
///
/// `QLPreviewController` 自己画导航栏，而它那颗按钮是按「我是被 present 出来的控制器」
/// 设计的；作为 SwiftUI 那一层的内容嵌进来时，那一下不一定退得掉，按了没反应又退不出去
/// 是最坏的一种。换成自己的：退的永远是 SwiftUI 那一层。
private final class DriveQuickLookController: QLPreviewController {
    var onDone: (() -> Void)?

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 系统是在 `viewWillAppear` 之后才装它自己那套按钮的，所以这里换得掉。
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            systemItem: .done,
            primaryAction: UIAction { [weak self] _ in self?.onDone?() }
        )
    }
}
