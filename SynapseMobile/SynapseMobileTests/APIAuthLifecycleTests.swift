import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct APIAuthLifecycleTests {
    @Test(arguments: [200, 401])
    func lateOldRefreshCannotAuthorizeANewAccountMailAttachment(status: Int) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let attachment = MailAttachment(attachmentId: "old-attachment", fileName: "test.txt", mimeType: "text/plain", size: 1)
        let download = Task { () -> String? in
            do {
                _ = try await fixture.client.mailDownloadAttachment(messageId: "old-message", attachment: attachment)
                return nil
            } catch let error as APIError { return error.code }
            catch { return "transport" }
        }
        try #require(await waitForRefreshCount(1, fixture.transport))
        await fixture.client.logout()
        try await fixture.client.login(email: "new@example.invalid", password: "test")
        fixture.transport.finishRefresh(status: status)
        #expect(await download.value == "credential_changed")
        #expect(fixture.store.refreshToken == "new-refresh")
        #expect(fixture.store.accountEmail == "new@example.invalid")
        if case .token("new-access") = await fixture.client.liveTokenOutcome() {} else {
            Issue.record("An old attachment request must leave the new account usable")
        }
    }

    @Test func aSameAccountPeerRotationDoesNotInvalidateAnAcceptedRESTResponse() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "first@example.invalid", password: "test")
        let request = Task { () -> String in
            do { return try await fixture.client.currentUserID() }
            catch let error as APIError { return "error:\(error.code ?? "unknown")" }
            catch { return "error" }
        }
        let deadline = Date().addingTimeInterval(3)
        while !fixture.transport.hasProtectedRequest, Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
        try #require(fixture.transport.hasProtectedRequest)
        let version = fixture.store.credentialVersion
        let peer = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let rotation = Task { await peer.restoreSession() }
        try #require(await waitForRefreshCount(1, fixture.transport))
        fixture.transport.finishRefresh(status: 200, refreshToken: "peer-refresh")
        #expect(await rotation.value == .restored)
        #expect(fixture.store.credentialVersion == version)
        fixture.transport.finishProtectedRequest(status: 200)
        #expect(await request.value == "same-account-user")
    }

    @Test(arguments: [false, true])
    func acceptedRESTCannotCrossCredentialClearOrSameValueReinstall(clear: Bool) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "first@example.invalid", password: "test")
        let request = Task { () -> String in
            do { return try await fixture.client.currentUserID() }
            catch let error as APIError { return error.code ?? "unknown" }
            catch { return "error" }
        }
        let deadline = Date().addingTimeInterval(3)
        while !fixture.transport.hasProtectedRequest, Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
        try #require(fixture.transport.hasProtectedRequest)
        if clear { fixture.store.clearCredentials() }
        else { fixture.store.refreshToken = "first-refresh" }
        fixture.transport.finishProtectedRequest(status: 200)
        #expect(await request.value == "credential_changed")
        #expect(!fixture.transport.hasRefresh)
        #expect(fixture.store.refreshToken == (clear ? nil : "first-refresh"))
    }

    @Test(arguments: [200, 401])
    func synchronizingAPeersRotationKeepsAnExistingLiveRefreshUsable(status: Int) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let initial = Task { await fixture.client.restoreSession() }
        try #require(await waitForRefreshCount(1, fixture.transport))
        fixture.transport.finishRefresh(status: 200, accessToken: "e30.eyJleHAiOjB9.sig", refreshToken: "first-refresh")
        #expect(await initial.value == .restored)
        let pendingLive = Task { await fixture.client.liveTokenOutcome() }
        try #require(await waitForRefreshCount(2, fixture.transport))
        let peer = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let rotation = Task { await peer.restoreSession() }
        try #require(await waitForRefreshCount(3, fixture.transport))
        fixture.transport.finishRefresh(status: 200, at: 1, refreshToken: "peer-refresh")
        #expect(await rotation.value == .restored)
        let synchronizingLive = Task { await fixture.client.liveTokenOutcome() }
        // Both live requests remain suspended on the controlled transport while
        // the second call synchronizes the peer's shared credential.
        try await Task.sleep(for: .milliseconds(20))
        #expect(fixture.transport.refreshTokens.count == 3)
        fixture.transport.finishRefresh(status: status)
        try #require(await waitForRefreshCount(4, fixture.transport))
        fixture.transport.finishRefresh(status: 200, accessToken: "current-access", refreshToken: "current-refresh")
        for outcome in [await pendingLive.value, await synchronizingLive.value] {
            if case .token("current-access") = outcome {} else {
                Issue.record("Same-account synchronization must preserve both live callers")
            }
        }
        #expect(fixture.transport.refreshTokens == ["old-refresh", "first-refresh", "first-refresh", "peer-refresh"])
        #expect(fixture.store.refreshToken == "current-refresh")
    }

    @Test func reinstallingTheSameCredentialInvalidatesItsCachedBearer() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let initial = Task { await fixture.client.restoreSession() }
        try #require(await waitForRefreshCount(1, fixture.transport))
        fixture.transport.finishRefresh(status: 200, accessToken: "first-access", refreshToken: "opaque-refresh")
        #expect(await initial.value == .restored)
        fixture.store.refreshToken = "opaque-refresh"
        let next = Task { await fixture.client.liveTokenOutcome() }
        try #require(await waitForRefreshCount(2, fixture.transport))
        fixture.transport.finishRefresh(status: 200, accessToken: "current-access", refreshToken: "current-refresh")
        if case .token("current-access") = await next.value {} else {
            Issue.record("A credential reinstall must not reuse the previous account lifetime's bearer")
        }
    }

    @Test func restoringTheSameOpaqueValueStillInvalidatesOldCredentialOwnership() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let account = fixture.store.credentialVersion
        let restore = Task { await fixture.client.restoreSession() }
        try #require(await waitForRefreshCount(1, fixture.transport))
        fixture.store.refreshToken = "old-refresh"
        fixture.store.accountEmail = "new@example.invalid"
        #expect(!fixture.store.replaceRefreshToken("bad-refresh", matching: "old-refresh", credentialVersion: account))
        #expect(!fixture.store.clearCredentials(matching: "old-refresh", credentialVersion: account))
        fixture.transport.finishRefresh(status: 200)
        #expect(await restore.value == .noCredentials)
        #expect(fixture.store.refreshToken == "old-refresh")
        #expect(fixture.store.accountEmail == "new@example.invalid")
        #expect(fixture.transport.refreshTokens.count == 1)
    }

    @Test(arguments: [200, 401], [false, true])
    func anotherClientsRotationKeepsTheSameAccountUsable(status: Int, restoreAtLaunch: Bool) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let version = fixture.store.credentialVersion
        let primary = Task { () -> Bool in
            if restoreAtLaunch { return await fixture.client.restoreSession() == .restored }
            if case .token("current-access") = await fixture.client.liveTokenOutcome() { return true }
            return false
        }
        try #require(await waitForRefreshCount(1, fixture.transport))
        let peer = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let rotating = Task { await peer.restoreSession() }
        try #require(await waitForRefreshCount(2, fixture.transport))
        fixture.transport.finishRefresh(status: 200, at: 1, accessToken: "peer-access", refreshToken: "peer-refresh")
        #expect(await rotating.value == .restored)
        fixture.transport.finishRefresh(status: status)
        try #require(await waitForRefreshCount(3, fixture.transport))
        #expect(fixture.transport.refreshTokens == ["old-refresh", "old-refresh", "peer-refresh"])
        fixture.transport.finishRefresh(status: 200, accessToken: "current-access", refreshToken: "current-refresh")
        #expect(await primary.value)
        #expect(fixture.store.refreshToken == "current-refresh")
        #expect(fixture.store.credentialVersion == version)
    }

    @Test func repeatedPeerRotationsStopAfterOneRetryWithoutDiscardingCredentials() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let primary = Task { await fixture.client.liveTokenOutcome() }
        try #require(await waitForRefreshCount(1, fixture.transport))
        let peer = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let firstRotation = Task { await peer.restoreSession() }
        try #require(await waitForRefreshCount(2, fixture.transport))
        fixture.transport.finishRefresh(status: 200, at: 1, refreshToken: "peer-first")
        #expect(await firstRotation.value == .restored)
        fixture.transport.finishRefresh(status: 200)
        try #require(await waitForRefreshCount(3, fixture.transport))
        let secondRotation = Task { await peer.restoreSession() }
        try #require(await waitForRefreshCount(4, fixture.transport))
        fixture.transport.finishRefresh(status: 200, at: 1, refreshToken: "peer-second")
        #expect(await secondRotation.value == .restored)
        fixture.transport.finishRefresh(status: 200)
        if case .unreachable = await primary.value {} else {
            Issue.record("Repeated rotation must remain retryable without claiming the account is gone")
        }
        #expect(fixture.transport.refreshTokens == ["old-refresh", "old-refresh", "peer-first", "peer-first"])
        #expect(!fixture.transport.hasRefresh)
        #expect(fixture.store.refreshToken == "peer-second")
    }

    @Test(arguments: [200, 401])
    func aNewAccountDuringTheRotationRetryCannotReceiveTheOldResult(status: Int) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let primary = Task { await fixture.client.restoreSession() }
        try #require(await waitForRefreshCount(1, fixture.transport))
        let peer = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let rotation = Task { await peer.restoreSession() }
        try #require(await waitForRefreshCount(2, fixture.transport))
        fixture.transport.finishRefresh(status: 200, at: 1, refreshToken: "peer-refresh")
        #expect(await rotation.value == .restored)
        fixture.transport.finishRefresh(status: 200)
        try #require(await waitForRefreshCount(3, fixture.transport))
        try await peer.login(email: "new@example.invalid", password: "test")
        fixture.transport.finishRefresh(status: status)
        #expect(await primary.value == .noCredentials)
        #expect(fixture.store.refreshToken == "new-refresh")
        #expect(fixture.store.accountEmail == "new@example.invalid")
        #expect(fixture.transport.refreshTokens.count == 3)
    }

    @Test func anOldAccountRequestCannotRetryWithTheNewAccountCredential() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "first@example.invalid", password: "test")
        let request = Task { () -> APIError? in
            do { _ = try await fixture.client.currentUserID(); return nil }
            catch { return error as? APIError }
        }
        let deadline = Date().addingTimeInterval(3)
        while !fixture.transport.hasProtectedRequest, Date() < deadline { await Task.yield() }
        #expect(fixture.transport.hasProtectedRequest)

        try await fixture.client.login(email: "second@example.invalid", password: "test")
        fixture.transport.finishProtectedRequest()
        #expect(await request.value?.code == "credential_changed")
        #expect(!fixture.transport.hasRefresh)
        #expect(fixture.store.accountEmail == "second@example.invalid")
    }

    @Test func lateRefreshCannotRestoreAnAccountAfterLogout() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let restore = Task { await fixture.client.restoreSession() }
        #expect(await waitForRefresh(fixture.transport))

        await fixture.client.logout()
        fixture.transport.finishRefresh(status: 200)
        #expect(await restore.value == .noCredentials)
        #expect(fixture.store.refreshToken == nil)
        if case .unauthenticated = await fixture.client.liveTokenOutcome() {} else {
            Issue.record("The logged-out account must not regain a bearer token")
        }
    }

    @Test(arguments: [200, 401])
    func lateRefreshCannotOverwriteOrClearANewLogin(status: Int) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let restore = Task { await fixture.client.restoreSession() }
        #expect(await waitForRefresh(fixture.transport))

        try await fixture.client.login(email: "new@example.invalid", password: "test")
        fixture.transport.finishRefresh(status: status)
        #expect(await restore.value == .noCredentials)
        #expect(fixture.store.refreshToken == "new-refresh")
        #expect(fixture.store.accountEmail == "new@example.invalid")
        if case .token(let token) = await fixture.client.liveTokenOutcome() {
            #expect(token == "new-access")
        } else {
            Issue.record("A late reply from the previous account must leave the new login usable")
        }
    }

    @Test func anotherClientsLateRefreshCannotRestoreTheLoggedOutKeychain() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let notificationClient = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let restore = Task { await notificationClient.restoreSession() }
        #expect(await waitForRefresh(fixture.transport))
        await fixture.client.logout()
        fixture.transport.finishRefresh(status: 200)
        #expect(await restore.value == .noCredentials)
        #expect(fixture.store.refreshToken == nil)
    }

    @Test(arguments: [200, 401])
    func anotherClientsLateRefreshCannotReplaceOrClearTheNewLogin(status: Int) async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        let notificationClient = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        let restore = Task { await notificationClient.restoreSession() }
        #expect(await waitForRefresh(fixture.transport))
        try await fixture.client.login(email: "new@example.invalid", password: "test")
        fixture.transport.finishRefresh(status: status)
        #expect(await restore.value == .noCredentials)
        #expect(fixture.store.refreshToken == "new-refresh")
        #expect(fixture.store.accountEmail == "new@example.invalid")
    }

    @Test func anotherClientsLogoutInvalidatesTheCachedBearer() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "first@example.invalid", password: "test")
        let notificationClient = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        await notificationClient.logout()
        if case .unauthenticated = await fixture.client.liveTokenOutcome() {} else {
            Issue.record("A separate client cleared the shared credentials; the old bearer must not remain usable")
        }
        #expect(!fixture.transport.hasRefresh)
    }

    @Test func anotherClientsLoginCannotMakeTheOutgoingRESTRequestRetry() async throws {
        let fixture = fixture()
        defer { fixture.store.clearCredentials(); fixture.session.invalidateAndCancel() }
        try await fixture.client.login(email: "first@example.invalid", password: "test")
        let request = Task { () -> APIError? in
            do { _ = try await fixture.client.currentUserID(); return nil }
            catch { return error as? APIError }
        }
        let deadline = Date().addingTimeInterval(3)
        while !fixture.transport.hasProtectedRequest, Date() < deadline { await Task.yield() }
        #expect(fixture.transport.hasProtectedRequest)
        let notificationClient = APIClient(tokens: fixture.store, session: fixture.session, onCredentialsChanged: {})
        try await notificationClient.login(email: "second@example.invalid", password: "test")
        fixture.transport.finishProtectedRequest()
        #expect(await request.value?.code == "credential_changed")
        #expect(!fixture.transport.hasRefresh)
        #expect(fixture.store.accountEmail == "second@example.invalid")
    }

    private func fixture() -> (client: APIClient, store: TokenStore, session: URLSession, transport: AuthLifecycleTransport) {
        let transport = AuthLifecycleTransport()
        let identifier = UUID().uuidString
        AuthLifecycleURLProtocol.register(transport, id: identifier)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthLifecycleURLProtocol.self]
        configuration.httpAdditionalHeaders = ["X-Auth-Test-ID": identifier]
        let session = URLSession(configuration: configuration)
        let store = TokenStore(service: "com.liy.SynapseMobile.tests.auth-lifecycle.\(identifier)")
        store.refreshToken = "old-refresh"
        return (APIClient(tokens: store, session: session, onCredentialsChanged: {}), store, session, transport)
    }

    private func waitForRefresh(_ transport: AuthLifecycleTransport) async -> Bool {
        let deadline = Date().addingTimeInterval(3)
        while !transport.hasRefresh, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
        return transport.hasRefresh
    }

    private func waitForRefreshCount(_ count: Int, _ transport: AuthLifecycleTransport) async -> Bool {
        let deadline = Date().addingTimeInterval(3)
        while transport.refreshTokens.count < count, Date() < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
        return transport.refreshTokens.count >= count
    }
}

private final class AuthLifecycleTransport: @unchecked Sendable {
    private let lock = NSLock()
    private var refreshes: [AuthLifecycleURLProtocol] = []
    private var requestedRefreshTokens: [String] = []
    private var protectedRequest: AuthLifecycleURLProtocol?

    var hasRefresh: Bool {
        lock.lock(); defer { lock.unlock() }
        return !refreshes.isEmpty
    }

    var refreshTokens: [String] {
        lock.lock(); defer { lock.unlock() }
        return requestedRefreshTokens
    }

    func hold(_ request: AuthLifecycleURLProtocol, token: String?) {
        lock.lock(); defer { lock.unlock() }
        refreshes.append(request)
        requestedRefreshTokens.append(token ?? "")
    }

    var hasProtectedRequest: Bool {
        lock.lock(); defer { lock.unlock() }
        return protectedRequest != nil
    }

    func holdProtectedRequest(_ request: AuthLifecycleURLProtocol) {
        lock.lock(); defer { lock.unlock() }
        protectedRequest = request
    }

    func finishProtectedRequest(status: Int = 401) {
        lock.lock()
        let pending = protectedRequest
        protectedRequest = nil
        lock.unlock()
        pending?.finish(status: status, body: status == 200
            ? #"{"user":{"id":"same-account-user"}}"# : #"{"message":"expired"}"#)
    }

    func finishRefresh(status: Int, at index: Int = 0, accessToken: String = "old-access", refreshToken: String = "rotated-old-refresh") {
        lock.lock()
        let pending = refreshes.indices.contains(index) ? refreshes.remove(at: index) : nil
        lock.unlock()
        pending?.finish(status: status, body: status == 200
            ? "{\"accessToken\":\"\(accessToken)\",\"refreshToken\":\"\(refreshToken)\"}"
            : #"{"message":"expired"}"#)
    }
}

private final class AuthLifecycleURLProtocol: URLProtocol {
    private final class Registry: @unchecked Sendable {
        private let lock = NSLock()
        private var transports: [String: AuthLifecycleTransport] = [:]
        func register(_ transport: AuthLifecycleTransport, id: String) {
            lock.lock(); defer { lock.unlock() }
            transports[id] = transport
        }
        func transport(for id: String) -> AuthLifecycleTransport? {
            lock.lock(); defer { lock.unlock() }
            return transports[id]
        }
    }
    private static let registry = Registry()

    static func register(_ transport: AuthLifecycleTransport, id: String) { registry.register(transport, id: id) }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let id = request.value(forHTTPHeaderField: "X-Auth-Test-ID"),
              let transport = Self.registry.transport(for: id) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        switch request.url?.lastPathComponent {
        case "refresh":
            let body = requestBody().flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
            transport.hold(self, token: body?["refreshToken"])
        case "login":
            let body = requestBody().flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
            finish(status: 200, body: body?["email"] == "first@example.invalid"
                ? #"{"accessToken":"first-access","refreshToken":"first-refresh"}"#
                : #"{"accessToken":"new-access","refreshToken":"new-refresh"}"#)
        case "logout": finish(status: 200, body: "{}")
        case "me": transport.holdProtectedRequest(self)
        default: client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
        }
    }

    func finish(status: Int, body: String) {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    private func requestBody() -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }

    override func stopLoading() {}
}
