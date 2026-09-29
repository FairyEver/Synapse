import SafariServices
import SwiftUI
import UIKit
import WebKit

struct WebLink: Identifiable {
    let id = UUID()
    let url: URL
}

enum SynapseWebLink {
    static func isTrusted(_ url: URL, origin: URL = AppConfiguration.apiOrigin) -> Bool {
        guard url.scheme == origin.scheme, url.host == origin.host,
              url.port == origin.port else { return false }
        let prefix = origin.path == "/" ? "" : origin.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return prefix.isEmpty || url.path == "/\(prefix)" || url.path.hasPrefix("/\(prefix)/")
    }

    static func isPublic(_ url: URL, origin: URL = AppConfiguration.apiOrigin) -> Bool {
        let prefix = origin.path == "/" ? "" : origin.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let prefixPath = "/\(prefix)"
        guard prefix.isEmpty || url.path.hasPrefix(prefixPath + "/") else { return false }
        let path = prefix.isEmpty ? url.path : String(url.path.dropFirst(prefixPath.count))
        return path == "/share" || path.hasPrefix("/share/") ||
        path == "/object" || path.hasPrefix("/object/")
    }

    static func isSignIn(_ url: URL) -> Bool {
        url.path == "/console/sign-in" || url.path.hasSuffix("/console/sign-in")
    }
}

/// WebKit stores the actual browser credential. It never enters a URL or JavaScript.
@MainActor
enum SynapseWebCookies {
    private static let name = "synapse_user_session"

    private static func paths(for origin: URL) -> [String] {
        let prefix = origin.path == "/" ? "" : origin.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let base = prefix.isEmpty ? "" : "/\(prefix)"
        return [base + "/api", base + "/drive"]
    }

    static func currentToken(origin: URL) async -> String? {
        let cookies = await all()
        return cookies.first {
            matchesOrigin($0, origin: origin) && $0.path == paths(for: origin)[0] &&
            ($0.expiresDate.map { $0 > Date() } ?? true)
        }?.value
    }

    static func install(token: String, expiresAt: Date, origin: URL) async throws {
        guard origin.host != nil else { throw CocoaError(.fileReadInvalidFileName) }
        await clear(origin: origin)
        for path in paths(for: origin) {
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: name,
                .value: token,
                .originURL: origin,
                .path: path,
                .expires: expiresAt,
                HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                HTTPCookiePropertyKey("SameSite"): "Lax",
            ]
            if origin.scheme == "https" { properties[.secure] = "TRUE" }
            guard let cookie = HTTPCookie(properties: properties), cookie.isHTTPOnly else {
                throw CocoaError(.fileReadCorruptFile)
            }
            await withCheckedContinuation { continuation in
                WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie) { continuation.resume() }
            }
        }
    }

    static func clear(origin: URL) async {
        for cookie in await all() where matchesOrigin(cookie, origin: origin) {
            await withCheckedContinuation { continuation in
                WKWebsiteDataStore.default().httpCookieStore.delete(cookie) { continuation.resume() }
            }
        }
    }

    private static func all() async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
    }

    private static func matchesOrigin(_ cookie: HTTPCookie, origin: URL) -> Bool {
        cookie.name == name && cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == origin.host &&
        paths(for: origin).contains(cookie.path)
    }
}

struct LinkBrowser: View {
    let url: URL
    let onFinish: () -> Void

    var body: some View {
        if SynapseWebLink.isTrusted(url) {
            SynapseSiteBrowser(url: url, onFinish: onFinish)
        } else {
            SafariLinkBrowser(url: url, onFinish: onFinish)
        }
    }
}

private struct SynapseSiteBrowser: View {
    @Environment(SynapseAppModel.self) private var model
    let url: URL
    let onFinish: () -> Void

    private enum Phase {
        case checking
        case ready
        case failed(String)
    }

    private struct Consent: Identifiable {
        let id = UUID()
        let existingEmail: String?
    }

    /// 顶上那枚分享键交出去的那一条。
    ///
    /// 包一层身份是 `sheet(item:)` 要的：同一页连着分享两次，也该各弹一次面板。
    private struct Share: Identifiable {
        let id = UUID()
        let url: URL
    }

    @State private var phase: Phase = .checking
    @State private var consent: Consent?
    @State private var consentAccepted = false
    /// 网页当前那一页的地址。跟着网页走而不是钉在进来时那一条上：网页版云盘是单页应用，
    /// 从一份分享里进一个目录不重新加载，那时屏幕上已经不是进来时那一页了。还没报回来
    /// 之前是 nil，分享退回进来时那一条。
    @State private var liveURL: URL?
    @State private var sharing: Share?

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .checking:
                    ProgressView("正在检查登录状态")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .ready:
                    SynapseWebView(
                        url: url,
                        onLoginRequired: { Task { await prepare() } },
                        onURLChange: { liveURL = $0 }
                    )
                case .failed(let message):
                    ContentUnavailableView {
                        Label("无法打开网页", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("重试") { Task { await prepare() } }
                    }
                }
            }
            .navigationTitle(url.host ?? "Synapse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onFinish) { Label("关闭", systemImage: "xmark") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { sharing = Share(url: liveURL ?? url) } label: {
                        Label("分享", systemImage: "square.and.arrow.up")
                    }
                }
            }
            // 分享面板挂在栈里，登录那张挂在栈外：同一片视图上挂两片 sheet 只有一片会
            // 出来（云盘那一屏踩过，见 `DriveBrowserView`）。
            .sheet(item: $sharing) { target in
                SystemShareSheet(items: [target.url])
            }
        }
        .task(id: url) { await prepare() }
        .sheet(item: $consent, onDismiss: {
            if !consentAccepted { onFinish() }
        }) { request in
            WebLoginConsentSheet(
                remoteEmail: model.email ?? "",
                existingEmail: request.existingEmail,
                onConfirm: {
                    consentAccepted = true
                    consent = nil
                    Task { await authorize() }
                },
                onCancel: onFinish
            )
        }
    }

    private func prepare() async {
        phase = .checking
        consent = nil
        consentAccepted = false
        if SynapseWebLink.isPublic(url) { phase = .ready; return }
        do {
            guard let cookie = await SynapseWebCookies.currentToken(origin: AppConfiguration.apiOrigin) else {
                consent = Consent(existingEmail: nil)
                return
            }
            if let web = try await model.webIdentity(cookie: cookie) {
                if web.userId == (try await model.currentUserID()) {
                    phase = .ready
                } else {
                    consent = Consent(existingEmail: web.email)
                }
            } else {
                consent = Consent(existingEmail: nil)
            }
        } catch {
            phase = .failed("登录状态检查失败，请重试。")
        }
    }

    private func authorize() async {
        phase = .checking
        do {
            let credential = try await model.issueRemoteWebCredential()
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let expiry = formatter.date(from: credential.expiresAt),
                  expiry > Date(), credential.userId == (try await model.currentUserID()) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            try await SynapseWebCookies.install(token: credential.token, expiresAt: expiry, origin: AppConfiguration.apiOrigin)
            phase = .ready
        } catch {
            phase = .failed("登录失败，请重试。")
        }
    }
}

private struct WebLoginConsentSheet: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ScaledMetric(relativeTo: .body) private var compactHeight: CGFloat = 300

    let remoteEmail: String
    let existingEmail: String?
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                ScrollView { content }
                    .presentationDetents([.height(compactHeight + (existingEmail == nil ? 0 : 60)), .large])
            } else {
                content
                    .presentationSizing(.form.fitted(horizontal: false, vertical: true))
            }
        }
        .presentationDragIndicator(.hidden)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 12) {
                Text(existingEmail == nil ? "登录 Synapse Console" : "切换 Synapse Console 账号")
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("取消登录")
            }

            VStack(alignment: .leading, spacing: 16) {
                if let existingEmail {
                    accountRow(label: "当前网页账号", email: existingEmail)
                }
                accountRow(label: "Synapse Remote", email: remoteEmail)
            }

            Button(action: onConfirm) {
                Text(existingEmail == nil ? "登录" : "切换账号")
                    .font(.body.weight(.semibold))
                    .frame(minWidth: 160, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(uiColor: .systemBlue))
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 32)
    }

    private func accountRow(label: String, email: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(email)
                .font(.body)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// `internal` 而不是 `private`：这一层是「网页换了页也要知道换到哪」唯一测得着的地方
/// （`LinkBrowserWebViewTests` 拿一个真的 `WKWebView` 驱动它），而顶栏那枚分享键交出去的
/// 是哪一条，全看这里报回来的地址。
struct SynapseWebView: UIViewRepresentable {
    let url: URL
    let onLoginRequired: () -> Void
    /// 网页当前那一页的地址，整页加载与网页自己换页都报。
    let onURLChange: (URL) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoginRequired: onLoginRequired, onURLChange: onURLChange)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.followAddress(of: webView)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onLoginRequired: () -> Void
        let onURLChange: (URL) -> Void
        /// 地址那一条观察。得持有它才一直在 —— `NSKeyValueObservation` 一放就停。
        private var address: NSKeyValueObservation?

        init(onLoginRequired: @escaping () -> Void, onURLChange: @escaping (URL) -> Void) {
            self.onLoginRequired = onLoginRequired
            self.onURLChange = onURLChange
        }

        /// 网页换了地址就报一次。
        ///
        /// 不听委托：`WKNavigationDelegate` 里没有「同文档导航」那一条 —— 旧 `WebView` 的
        /// `didSameDocumentNavigation` 在 `WKWebView` 的委托上不存在，照那个名字写一个方法
        /// 出来能编译、也能站在这个类里，但 WebKit 一次都不会调它。网页版云盘是单页应用，
        /// 从一份分享里进一个目录、点开另一份文件都不重新加载，那样写的结果是分享的一直停在
        /// 进来时那一条。`url` 是地址变化的唯一出口，整页加载与单页换页都落在它上面。
        func followAddress(of webView: WKWebView) {
            address = webView.observe(\.url, options: [.new]) { [weak self] webView, _ in
                guard let url = webView.url else { return }
                self?.onURLChange(url)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let destination = navigationAction.request.url,
                  navigationAction.targetFrame?.isMainFrame != false else {
                decisionHandler(.allow)
                return
            }
            if SynapseWebLink.isTrusted(destination) && SynapseWebLink.isSignIn(destination) {
                decisionHandler(.cancel)
                onLoginRequired()
            } else if !SynapseWebLink.isTrusted(destination) {
                decisionHandler(.cancel)
                UIApplication.shared.open(destination)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}

private struct SafariLinkBrowser: UIViewControllerRepresentable {
    let url: URL
    let onFinish: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: configuration)
        controller.dismissButtonStyle = .close
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}

    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        let onFinish: () -> Void
        init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onFinish() }
    }
}

extension View {
    func linkBrowser(_ link: Binding<WebLink?>) -> some View {
        sheet(item: link) { target in
            LinkBrowser(url: target.url) { link.wrappedValue = nil }
        }
    }
}
