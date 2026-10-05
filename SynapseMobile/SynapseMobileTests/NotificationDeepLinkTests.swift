import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct NotificationDeepLinkTests {
    @Test func anOlderNotificationOutsideTheFirstPageCanStillResolveItsTerminal() async throws {
        let fixture = fixture()
        defer { fixture.tokens.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "test@example.invalid", password: "test")
        let store = NotificationStore()
        await store.load(using: fixture.client)
        #expect(store.items.map(\.id) == ["newest"])
        #expect(store.nextCursor != nil)

        await store.ensure("older", using: fixture.client)
        let item = try #require(store.items.first(where: { $0.id == "older" }))
        #expect(NotificationDestination.resolve(item) == .route(.terminal(
            sessionId: "older-session", desktopClientInstanceId: "original-desktop", entry: .inboxRecord
        )))
    }

    @Test func readingAnEnsuredOlderNotificationKeepsItAvailableForNavigation() async throws {
        let fixture = fixture()
        defer { fixture.tokens.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "test@example.invalid", password: "test")
        let store = NotificationStore()
        await store.load(using: fixture.client)
        await store.ensure("older", using: fixture.client)
        await store.read("older", using: fixture.client)
        let item = try #require(store.items.first(where: { $0.id == "older" }))
        #expect(item.readAt != nil)
        #expect(item.targetId == "older-session")
        #expect(store.items.filter { $0.id == "older" }.count == 1)
    }

    @Test func aRemovedNotificationDoesNotBecomeANavigableTarget() async throws {
        let fixture = fixture()
        defer { fixture.tokens.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "test@example.invalid", password: "test")
        let store = NotificationStore()
        await store.load(using: fixture.client)
        await store.ensure("removed", using: fixture.client)
        #expect(store.items.map(\.id) == ["newest"])
        #expect(store.error != nil)
    }

    private func fixture() -> (client: APIClient, tokens: TokenStore, session: URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NotificationDeepLinkURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let tokens = TokenStore(service: "com.liy.SynapseMobile.tests.notification-deep-link.\(UUID().uuidString)")
        return (APIClient(tokens: tokens, session: session, onCredentialsChanged: {}), tokens, session)
    }
}

private final class NotificationDeepLinkURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body: String
        let status: Int
        switch request.url?.lastPathComponent {
        case "login":
            status = 200
            body = #"{"accessToken":"test-access","refreshToken":"test-refresh"}"#
        case "notifications":
            status = 200
            body = #"{"items":[{"id":"newest","source":"external","title":"最新通知","body":"最新正文","level":"active","createdAt":"2026-10-04T00:00:00Z"}],"nextCursor":"older-page"}"#
        case "count":
            status = 200
            body = #"{"unread":1}"#
        case "older":
            status = 200
            body = #"{"id":"older","source":"terminal-complete","title":"旧通知","body":"旧正文","level":"active","targetId":"older-session","deviceId":"original-desktop","readAt":"2026-10-04T01:00:00Z","createdAt":"2026-10-01T00:00:00Z"}"#
        case "read":
            status = 200
            body = "{}"
        case "removed":
            status = 404
            body = #"{"message":"not found"}"#
        default:
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
