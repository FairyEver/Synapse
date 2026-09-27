import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct LinkBrowserTests {
    private let origin = URL(string: "https://synapse.d2.pub")!

    @Test func onlyConfiguredOriginCanReceiveBrowserSession() {
        #expect(SynapseWebLink.isTrusted(URL(string: "https://synapse.d2.pub/drive/items/1")!, origin: origin))
        #expect(!SynapseWebLink.isTrusted(URL(string: "https://synapse.d2.pub.evil.example/drive/items/1")!, origin: origin))
        #expect(!SynapseWebLink.isTrusted(URL(string: "http://synapse.d2.pub/drive/items/1")!, origin: origin))
        #expect(!SynapseWebLink.isTrusted(URL(string: "https://synapse.d2.pub:8443/drive/items/1")!, origin: origin))
    }

    @Test func publicShareDoesNotRequireRemoteLogin() {
        #expect(SynapseWebLink.isPublic(URL(string: "https://synapse.d2.pub/share/abc")!, origin: origin))
        #expect(!SynapseWebLink.isPublic(URL(string: "https://synapse.d2.pub/drive/items/abc")!, origin: origin))
    }

    @Test func recognizesConsoleSignInRedirect() {
        #expect(SynapseWebLink.isSignIn(URL(string: "https://synapse.d2.pub/console/sign-in?redirect=%2Fdrive%2Fitems%2F1")!))
    }
}
