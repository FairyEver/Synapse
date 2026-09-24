import Observation
import QuickLook
import SwiftUI
import WebKit

enum TerminalResourceResponsePolicy {
    enum Action: Equatable {
        case show(TerminalResource.Kind)
        case download(TerminalResource.Kind)
    }

    static func decide(mimeType: String?, contentDisposition: String?, canShow: Bool) -> Action {
        let mime = mimeType?.lowercased() ?? ""
        let kind: TerminalResource.Kind = mime.hasPrefix("image/") ? .image
            : mime == "application/pdf" ? .file : .webpage
        let attachment = contentDisposition?
            .split(separator: ";", maxSplits: 1)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() == "attachment"
        return attachment || !canShow ? .download(kind == .webpage ? .file : kind) : .show(kind)
    }
}

@MainActor
@Observable
final class TerminalResourceBrowserState {
    enum Presentation: Equatable {
        case loading
        case downloading
        case web
        case downloaded(URL, TerminalResource.Kind)
        case failed(String)
    }

    var presentation: Presentation = .loading
    var displayedKind: TerminalResource.Kind = .link
}

struct TerminalResourceBrowser: UIViewRepresentable {
    let url: URL
    let state: TerminalResourceBrowserState
    let onKind: (TerminalResource.Kind) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(state: state, onKind: onKind) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        private let state: TerminalResourceBrowserState
        private let onKind: (TerminalResource.Kind) -> Void
        private var downloadKind: TerminalResource.Kind = .file
        private var destination: URL?

        init(state: TerminalResourceBrowserState, onKind: @escaping (TerminalResource.Kind) -> Void) {
            self.state = state
            self.onKind = onKind
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            guard navigationResponse.isForMainFrame else {
                decisionHandler(.allow)
                return
            }
            let response = navigationResponse.response
            let headers = (response as? HTTPURLResponse)?.allHeaderFields
            let disposition = headers?.first { "\($0.key)".caseInsensitiveCompare("Content-Disposition") == .orderedSame }
                .map { "\($0.value)" }
            switch TerminalResourceResponsePolicy.decide(
                mimeType: response.mimeType,
                contentDisposition: disposition,
                canShow: navigationResponse.canShowMIMEType
            ) {
            case .show(let kind):
                state.displayedKind = kind
                state.presentation = .web
                onKind(kind)
                decisionHandler(.allow)
            case .download(let kind):
                downloadKind = kind
                state.displayedKind = kind
                state.presentation = .downloading
                onKind(kind)
                decisionHandler(.download)
            }
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard state.presentation != .downloading else { return }
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            state.presentation = .failed("网页无法打开")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard state.presentation != .downloading else { return }
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            state.presentation = .failed("网页无法打开")
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("terminal-resources", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let filename = (suggestedFilename as NSString).lastPathComponent
                let safeName = filename.isEmpty || filename == "." || filename == ".." ? "download" : filename
                let url = directory.appendingPathComponent(safeName)
                destination = url
                completionHandler(url)
            } catch {
                state.presentation = .failed("文件无法下载")
                completionHandler(nil)
            }
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let destination else {
                state.presentation = .failed("文件无法下载")
                return
            }
            state.presentation = .downloaded(destination, downloadKind)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            state.presentation = .failed("文件无法下载")
        }
    }
}

struct TerminalDownloadedPreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}
