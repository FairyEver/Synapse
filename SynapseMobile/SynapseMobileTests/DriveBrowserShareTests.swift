import Foundation
import Testing
@testable import SynapseMobile

@MainActor
struct DriveBrowserShareTests {
    private let origin = URL(string: "https://synapse.d2.pub")!

    @Test func ownerPageSharesAPublicLinkInsteadOfItsPrivateAddress() async {
        let state = DriveBrowserShareState()
        var requestedItems: [String] = []
        await prepareShare(state,
            url: URL(string: "https://synapse.d2.pub/drive/items/item-1?surface=standalone")!,
            origin: origin,
            isCurrent: { true },
            createShare: { id in
                requestedItems.append(id)
                return share(itemId: id)
            }
        )

        #expect(state.target?.url.absoluteString == "https://synapse.d2.pub/share/shr_1")
        #expect(requestedItems == ["item-1"])
        #expect(state.errorMessage == nil)
    }

    @Test func passwordProtectedShareUsesItsCompletePasswordLink() async {
        let state = DriveBrowserShareState()
        await prepareShare(state,
            url: URL(string: "https://synapse.d2.pub/console/drive/items/item-1?surface=console")!,
            origin: origin,
            isCurrent: { true },
            createShare: { id in share(itemId: id, password: "existing-password") }
        )

        #expect(state.target?.url.absoluteString == "https://synapse.d2.pub/share/shr_1?password=existing-password")
    }

    @Test func recognizesOwnerPagesUnderASelfHostedPrefix() throws {
        let hosted = URL(string: "https://synapse.d2.pub/service")!
        for path in ["/drive/items/item-1?surface=standalone", "/console/drive/items/item-1"] {
            #expect(try DriveBrowserShareLink.ownerItemID(
                in: URL(string: "https://synapse.d2.pub/service" + path)!, origin: hosted
            ) == "item-1")
        }
        #expect(try DriveBrowserShareLink.ownerItemID(
            in: URL(string: "https://synapse.d2.pub/service-other/drive/items/item-1")!, origin: hosted
        ) == nil)
    }

    @Test func selfHostedOwnerSharesUseTheReturnedPublicAddress() async {
        let state = DriveBrowserShareState()
        await prepareShare(
            state, url: URL(string: "https://synapse.d2.pub/service/drive/items/item-1")!,
            origin: URL(string: "https://synapse.d2.pub/service")!, isCurrent: { true }
        ) { id in share(itemId: id, address: "https://synapse.d2.pub/service/share/shr_1") }
        #expect(state.target?.url.absoluteString == "https://synapse.d2.pub/service/share/shr_1")
    }

    @Test(arguments: [
        "http://synapse.d2.pub/drive/items/item-1",
        "https://synapse.d2.pub:8443/drive/items/item-1",
        "https://synapse.d2.pub.evil.example/drive/items/item-1"
    ])
    func anotherOriginCannotCreateADriveShare(address: String) async {
        let state = DriveBrowserShareState()
        await prepareShare(state,url: URL(string: address)!, origin: origin, isCurrent: { true }) { _ in
            Issue.record("外站链接不能调用云盘分享接口")
            return share(itemId: "item-1")
        }
        #expect(state.target?.url.absoluteString == address)
    }

    @Test(arguments: ["", "/", "/a/b", "/%2F", "/%5C", "/%252F", "/.", "/%2E%2E", "/item-1/download"])
    func invalidOwnerPathsCannotBeSharedAsPrivateURLs(suffix: String) async {
        let state = DriveBrowserShareState()
        await prepareShare(state,
            url: URL(string: "https://synapse.d2.pub/drive/items" + suffix)!,
            origin: origin, isCurrent: { true }
        ) { _ in
            Issue.record("非法路径不能创建分享")
            return share(itemId: "item-1")
        }
        #expect(state.target == nil)
        #expect(state.errorMessage != nil)
    }

    @Test func sharesTheCurrentPublicChildWithoutCreatingAnotherShare() async {
        let state = DriveBrowserShareState()
        let current = URL(string: "https://synapse.d2.pub/share/shr_1/items/child-2?password=kept#comment")!
        await prepareShare(state,url: current, origin: origin, isCurrent: { true }) { _ in
            Issue.record("公开分享页无需创建新分享")
            return share(itemId: "child-2")
        }
        #expect(state.target?.url == current)
    }

    @Test func failedPreparationCanRetryWithoutSharingThePrivateURL() async {
        let state = DriveBrowserShareState()
        let ownerURL = URL(string: "https://synapse.d2.pub/drive/items/item-1")!
        await prepareShare(state,url: ownerURL, origin: origin, isCurrent: { true }) { _ in
            throw APIError(status: 403, code: "forbidden", message: "无权分享此文件。")
        }
        #expect(state.target == nil)
        #expect(state.errorMessage == "无权分享此文件。")
        #expect(!state.isPreparing)

        await prepareShare(state,url: ownerURL, origin: origin, isCurrent: { true }) { id in share(itemId: id) }
        #expect(state.errorMessage == nil)
        #expect(state.target?.url.absoluteString == "https://synapse.d2.pub/share/shr_1")
    }

    @Test func aSecondTapDoesNotStartAnotherPendingRequest() async throws {
        let state = DriveBrowserShareState()
        let gate = BrowserShareGate()
        defer { gate.release() }
        let pending = Task {
            await prepareShare(state,
                url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!,
                origin: origin, isCurrent: { true }
            ) { id in
                await gate.hold()
                return share(itemId: id)
            }
        }
        try #require(await gate.waitUntilHeld())
        #expect(state.isPreparing)
        await prepareShare(state,
            url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!,
            origin: origin, isCurrent: { true }
        ) { _ in
            Issue.record("重复点击不能再发一次请求")
            return share(itemId: "item-1")
        }
        #expect(state.target == nil)
        gate.release()
        await pending.value
        #expect(state.target?.url.absoluteString == "https://synapse.d2.pub/share/shr_1")
        #expect(!state.isPreparing)
    }

    @Test func rapidStartsReserveTheRealRequestBeforeCancellation() async {
        let state = DriveBrowserShareState()
        var requests = 0
        var refreshes = 0
        let create: (String) async throws -> DriveShare = { id in
            requests += 1
            return share(itemId: id)
        }
        let first = state.start(
            url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!, origin: origin,
            isCurrent: { true }, createShare: create, onShared: { refreshes += 1 }
        )
        let second = state.start(
            url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!, origin: origin,
            isCurrent: { true }, createShare: create, onShared: { refreshes += 1 }
        )
        #expect(state.isPreparing)
        #expect(second == nil)
        state.cancel()
        await first?.value
        await second?.value
        #expect(requests == 0)
        #expect(refreshes == 0)
        #expect(state.target == nil)
    }

    @Test(arguments: [false, true])
    func accountChangesAndPageClosureDiscardLateResults(accountChanged: Bool) async throws {
        let state = DriveBrowserShareState()
        let gate = BrowserShareGate()
        defer { gate.release() }
        var current = true
        let pending = Task {
            await prepareShare(state,
                url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!,
                origin: origin, isCurrent: { current }
            ) { id in
                await gate.hold()
                return share(itemId: id)
            }
        }
        try #require(await gate.waitUntilHeld())
        if accountChanged { current = false } else { state.cancel(); pending.cancel() }
        gate.release()
        await pending.value
        #expect(state.target == nil)
        #expect(state.errorMessage == nil)
        #expect(!state.isPreparing)
    }

    @Test func navigatingToAnotherFileKeepsItsNewRequestWhenTheOldOneFinishes() async throws {
        let state = DriveBrowserShareState()
        let oldGate = BrowserShareGate()
        let newGate = BrowserShareGate()
        defer { oldGate.release(); newGate.release() }
        let oldRequest = Task {
            await prepareShare(state,
                url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!,
                origin: origin, isCurrent: { true }
            ) { id in await oldGate.hold(); return share(itemId: id) }
        }
        try #require(await oldGate.waitUntilHeld())
        state.cancel()
        let newRequest = Task {
            await prepareShare(state,
                url: URL(string: "https://synapse.d2.pub/drive/items/item-2")!,
                origin: origin, isCurrent: { true }
            ) { id in await newGate.hold(); return share(itemId: id, shareId: "shr_2") }
        }
        try #require(await newGate.waitUntilHeld())
        oldGate.release()
        await oldRequest.value
        #expect(state.target == nil)
        #expect(state.isPreparing)
        newGate.release()
        await newRequest.value
        #expect(state.target?.url.absoluteString == "https://synapse.d2.pub/share/shr_2")
    }

    @Test func cancellationDoesNotShowAFailureAlert() async {
        let state = DriveBrowserShareState()
        await prepareShare(state,
            url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!,
            origin: origin, isCurrent: { true }
        ) { _ in throw URLError(.cancelled) }
        #expect(state.target == nil)
        #expect(state.errorMessage == nil)
        #expect(!state.isPreparing)
    }

    @Test func anInvalidReturnedShareDoesNotFallBackToTheOwnerPage() async {
        let state = DriveBrowserShareState()
        await prepareShare(state,
            url: URL(string: "https://synapse.d2.pub/drive/items/item-1")!,
            origin: origin, isCurrent: { true }
        ) { id in share(itemId: id, address: "https://synapse.d2.pub/drive/items/item-1") }
        #expect(state.target == nil)
        #expect(state.errorMessage != nil)
    }

    @Test func defaultShareUsesTheExistingAPIWithAnEmptyRequestBody() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BrowserShareURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let tokens = TokenStore(service: "com.liy.SynapseMobile.tests.browser-share.\(UUID().uuidString)")
        let client = APIClient(tokens: tokens, session: session, onCredentialsChanged: {})
        defer { tokens.clearCredentials(); session.invalidateAndCancel() }
        try await client.login(email: "test@example.invalid", password: "test")
        let store = DriveStore()
        let result = try await store.defaultShare(itemId: "item-1", using: client)
        #expect(result.urlWithPassword == "https://synapse.d2.pub/share/shr_1?password=kept")
        #expect(result.accessMode == .specifiedUsersEdit)
        #expect(result.editorEmails == ["editor@example.invalid"])
        #expect(result.expiresAt == "2099-01-01T00:00:00Z")
    }

    private func share(
        itemId: String, password: String? = nil, shareId: String = "shr_1", address: String? = nil
    ) -> DriveShare {
        let url = address ?? "https://synapse.d2.pub/share/\(shareId)"
        return DriveShare(
            id: "record-1", shareId: shareId, itemId: itemId, enabled: true,
            url: url, urlWithPassword: password.map { "\(url)?password=\($0)" } ?? url,
            passwordEnabled: password != nil, password: password, expiresAt: nil,
            accessMode: .linkRead, editorEmails: [], createdAt: "2026-10-13T00:00:00Z"
        )
    }
}

@MainActor
private func prepareShare(
    _ state: DriveBrowserShareState,
    url: URL, origin: URL, isCurrent: @escaping () -> Bool,
    createShare: @escaping (String) async throws -> DriveShare
) async {
    await state.start(
        url: url, origin: origin, isCurrent: isCurrent, createShare: createShare, onShared: {}
    )?.value
}

@MainActor
private final class BrowserShareGate {
    private var held = false
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?

    func hold() async {
        held = true
        guard !released else { return }
        await withCheckedContinuation { continuation = $0 }
    }

    func waitUntilHeld() async -> Bool {
        let deadline = Date().addingTimeInterval(3)
        while !held, Date() < deadline { try? await Task.sleep(for: .milliseconds(10)) }
        return held
    }

    func release() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

nonisolated private final class BrowserShareURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let url = try #require(request.url)
            let body: String
            if url.lastPathComponent == "login" {
                body = #"{"accessToken":"test-access","refreshToken":"test-refresh"}"#
            } else {
                #expect(url.path == "/api/drive/items/item-1/share")
                #expect(request.httpMethod == "POST")
                let data: Data
                if let stream = request.httpBodyStream {
                    stream.open()
                    defer { stream.close() }
                    var bytes = Data()
                    var buffer = [UInt8](repeating: 0, count: 1024)
                    while stream.hasBytesAvailable {
                        let count = stream.read(&buffer, maxLength: buffer.count)
                        guard count > 0 else { break }
                        bytes.append(buffer, count: count)
                    }
                    data = bytes
                } else { data = request.httpBody ?? Data() }
                let settings = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
                #expect(settings.isEmpty, "默认分享不能覆盖已有访问设置")
                body = #"{"id":"record-1","shareId":"shr_1","itemId":"item-1","enabled":true,"url":"https://synapse.d2.pub/share/shr_1","urlWithPassword":"https://synapse.d2.pub/share/shr_1?password=kept","passwordEnabled":true,"password":"kept","expiresAt":"2099-01-01T00:00:00Z","accessMode":"specified_users_edit","editorEmails":["editor@example.invalid"],"createdAt":"2026-10-13T00:00:00Z"}"#
            }
            let response = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }

    override func stopLoading() {}
}
