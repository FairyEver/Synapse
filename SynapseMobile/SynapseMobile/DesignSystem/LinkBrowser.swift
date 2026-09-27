import SafariServices
import SwiftUI
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
    private static let paths = ["/api", "/drive"]

    static func currentToken(origin: URL) async -> String? {
        let cookies = await all()
        return cookies.first {
            matchesOrigin($0, origin: origin) && $0.path == "/api" &&
            ($0.expiresDate.map { $0 > Date() } ?? true)
        }?.value
    }

    static func install(token: String, expiresAt: Date, origin: URL) async throws {
        guard origin.host != nil else { throw CocoaError(.fileReadInvalidFileName) }
        await clear(origin: origin)
        for path in paths {
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
        paths.contains(cookie.path)
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

    @State private var phase: Phase = .checking
    @State private var consent: Consent?
    @State private var consentAccepted = false

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .checking:
                    ProgressView("正在检查登录状态")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .ready:
                    SynapseWebView(url: url, onLoginRequired: { Task { await prepare() } })
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
            }
        }
        .task(id: url) { await prepare() }
        .sheet(item: $consent, onDismiss: {
            if !consentAccepted { onFinish() }
        }) { request in
            VStack(alignment: .leading, spacing: 16) {
                Text(request.existingEmail == nil ? "使用 Synapse Remote 登录 Synapse Console？" : "切换 Synapse Console 账号？")
                    .font(.headline)
                if let existingEmail = request.existingEmail {
                    Text("网页端：\(existingEmail)")
                }
                Text("Synapse Remote：\(model.email ?? "")")
                Spacer(minLength: 0)
                Button("继续") { consentAccepted = true; consent = nil; Task { await authorize() } }
                    .buttonStyle(.borderedProminent)
                Button("取消", action: onFinish)
            }
            .padding()
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
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

private struct SynapseWebView: UIViewRepresentable {
    let url: URL
    let onLoginRequired: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onLoginRequired: onLoginRequired) }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onLoginRequired: () -> Void

        init(onLoginRequired: @escaping () -> Void) { self.onLoginRequired = onLoginRequired }

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
