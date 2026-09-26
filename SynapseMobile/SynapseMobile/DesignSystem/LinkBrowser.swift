import SafariServices
import SwiftUI

/// 要在系统浏览器里打开的那一条链接。
///
/// 包一层是因为 `sheet(item:)` 要一个身份：同一条链接连着打开两次也该各弹一次，拿 `URL`
/// 自己当身份做不到这件事。
struct WebLink: Identifiable {
    let id = UUID()
    let url: URL
}

/// 打开一条链接。
///
/// **全 App 只有这一条路。** 终端里嗅探到的资源与云盘里的文件都从这里走：同一件事在两处
/// 各写一份的话，「怎么打开、打开之后算什么、关掉之后回到哪」迟早会漂成两种。
///
/// 用 `SFSafariViewController` 而不是 `UIApplication.open`：它是用户已经在 Safari 里认得的
/// 那个控件，加载条、页面设置菜单、分享面板与「在 Safari 中打开」都跟着它一起来，而且它们
/// 始终跟着系统当前长什么样 —— 跳出去开 Safari 会把这一屏整个交出去，自己画一套壳子则做
/// 不到前一句。页面里发生的事一概不回传：这条链接打开的是系统管的页面，不是这一屏的内容。
struct LinkBrowser: UIViewControllerRepresentable {
    let url: URL
    /// 用户按了那枚关闭。退掉哪一层交给调用方 —— 装法不同（sheet、整屏），「退」的动作
    /// 也不一样。
    let onFinish: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: configuration)
        // 这一页盖住的是一条列表，所以 ✕ 读作「回到列表」；一枚「完成」或者返回箭头会让人
        // 以为身后还有一条栈。
        controller.dismissButtonStyle = .close
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}

    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        private let onFinish: () -> Void

        init(onFinish: @escaping () -> Void) {
            self.onFinish = onFinish
        }

        func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
            onFinish()
        }
    }
}

extension View {
    /// 把要打开的那条链接摆成一片 sheet，关掉之后把那个可选项清空。
    ///
    /// 唯一入口的意义见 `LinkBrowser`：调用方只管「要打开这一条」，怎么打开、谁来关是这一层
    /// 的事。
    func linkBrowser(_ link: Binding<WebLink?>) -> some View {
        sheet(item: link) { target in
            LinkBrowser(url: target.url) { link.wrappedValue = nil }
        }
    }
}
