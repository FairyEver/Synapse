import Foundation
import Testing
import WebKit
@testable import SynapseMobile

/// 顶栏那枚分享键交出去的是哪一条链接。
///
/// 网页版云盘是单页应用：从一份分享里进一个目录、点开另一份文件都不重新加载，地址只在
/// `WKWebView.url` 上变。少了盯着它那一条，分享出去的是进来时那一条，而屏幕上已经不是
/// 那一页了 —— 这正是这一条要钉住的：换页之后必须报新地址。
///
/// 用一个真的 `WKWebView` 驱动，不自己调一遍观察者／委托方法：要量的是「WebKit 会不会把
/// 换页告诉我们」，手写一遍只会量到自己。
@MainActor
struct LinkBrowserWebViewTests {
    private func waitUntil(
        _ predicate: () -> Bool,
        timeout: TimeInterval = 15
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return predicate()
    }

    /// 等这一页自己的文档真的建起来，返回它当时的地址。
    ///
    /// 不能等 `document.readyState`：WebKit 起手就有一份 about:blank，那一份也是
    /// `complete`。也不能只等地址报回来 —— `url` 是在**开页那一刻**就设上的，那时文档还
    /// 没有，换页会被 WebKit 以 `URL is invalid` 顶回来，量到的会是「换页不给报」。
    private func waitUntilDocument(_ webView: WKWebView, timeout: TimeInterval = 15) async -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let url = try? await webView.evaluateJavaScript("document.URL") as? String,
               !url.isEmpty, url != "about:blank" {
                return url
            }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return nil
    }

    /// 换页那一条：整页加载与网页自己换页都要把地址报回来。
    ///
    /// 页面用本机字符串喂进去，**基地址取这个 App 自己配的源站** —— 委托只放行同源导航
    /// （`SynapseWebView.Coordinator` 那条 `decidePolicyFor`），拿别的地址试，第一页就会被
    /// 它自己取消掉，量到的是「什么都没发生」。基地址只定 origin，不必真的有这个服务器。
    @Test func reportsClientSidePageChangesNotOnlyWholePageLoads() async throws {
        let origin = AppConfiguration.apiOrigin
        let entry = origin.appending(path: "share/shr_1")
        let next = entry.path + "/items/itm_2"

        var reported: [URL] = []
        let coordinator = SynapseWebView.Coordinator(
            onLoginRequired: {},
            onURLChange: { reported.append($0) }
        )
        // `navigationDelegate` 是弱引用。本地变量在函数末尾才释放，这里显式写出来：它得活到
        // 用完之后，不然换页那一段量到的会是「委托早就没了」。
        defer { withExtendedLifetime(coordinator) {} }

        let webView = WKWebView()
        webView.navigationDelegate = coordinator
        // 与 `SynapseWebView.makeUIView` 里那两行同序：地址那一条观察要在开页之前挂上。
        coordinator.followAddress(of: webView)
        webView.loadHTMLString("<html><body>分享</body></html>", baseURL: entry)

        let opened = await waitUntil({ reported.contains { $0.path == entry.path } })
        #expect(
            opened,
            "整页加载之后没有报地址：\(reported.map(\.absoluteString))，当前 \(webView.url?.absoluteString ?? "nil")"
        )

        let document = await waitUntilDocument(webView)
        #expect(document != nil, "这一页的文档没有起来，当前地址 \(webView.url?.absoluteString ?? "nil")")

        // 换到同一份分享里的另一个条目 —— 与在网页里点一下走的是同一条路。
        _ = try await webView.evaluateJavaScript("history.pushState({}, '', '\(next)')")

        let changed = await waitUntil({ reported.contains { $0.path == next } }, timeout: 10)
        #expect(changed, "网页自己换页之后报回来的还是旧地址：\(reported.map(\.absoluteString))")
    }
}
