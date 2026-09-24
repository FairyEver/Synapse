import SafariServices
import SwiftUI

/// Opens a sniffed link in the system browser.
///
/// `SFSafariViewController` is the control the reader already knows from Safari, so
/// the page-settings menu, the loading bar, the share sheet and "open in Safari" all
/// arrive with it, and they keep following whatever the system's browser chrome looks
/// like — which nothing drawn by hand here would do.
///
/// Nothing about the page is reported back. The app used to read the response's MIME
/// type and `Content-Disposition` while navigating, and hand anything that was not a
/// webpage to its own downloader; a browser the app does not own cannot be watched
/// that way, so attachments are the system's to handle now.
struct TerminalResourceBrowser: UIViewControllerRepresentable {
    let url: URL
    let onFinish: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: configuration)
        // The page covers the resource list rather than being pushed into it, so ✕
        // reads as "back to the list" where a chevron or "Done" would imply a stack.
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
