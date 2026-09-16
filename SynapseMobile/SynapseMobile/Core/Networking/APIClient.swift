import Foundation
import os

struct APIError: Error, LocalizedError {
    let status: Int
    let code: String?
    let message: String

    var errorDescription: String? { message }

    var isUnauthorized: Bool { status == 401 || status == 403 }

    /// A transport failure, not a server decision. Worth retrying; an
    /// authorization failure is not, until the token is refreshed.
    var isTransport: Bool { status == 0 }
}

/// REST access to the Synapse server.
///
/// Mirrors the desktop client's contract: the access token stays in memory and a
/// single refresh happens on a 401 before the request is retried once. Callers
/// never see a token.
actor APIClient {
    private let session: URLSession
    private let tokens: TokenStore
    private let onCredentialsChanged: @Sendable () -> Void

    private var accessToken: String?
    /// When the current access token stops being accepted; `nil` when its lifetime
    /// cannot be read from the token itself.
    private var accessTokenExpiresAt: Date?
    private var refreshInFlight: Task<Result<String, RefreshFailure>, Never>?

    /// A bound on the whole request, not just the gap between packets.
    ///
    /// `timeoutIntervalForRequest` covers the gap between packets, but
    /// `waitsForConnectivity` means a request with no usable path waits for a path
    /// to appear instead of failing. With no resource timeout that wait is
    /// unbounded, so a launch that awaits one never finishes and the app looks
    /// frozen rather than offline. Measured on a device: a refresh pointed at an
    /// unreachable host had still not returned after five minutes.
    private static let requestResourceTimeout: TimeInterval = 30

    init(tokens: TokenStore, onCredentialsChanged: @escaping @Sendable () -> Void) {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = AppConfiguration.requestTimeout
        configuration.timeoutIntervalForResource = Self.requestResourceTimeout
        configuration.waitsForConnectivity = true
        self.session = URLSession(configuration: configuration)
        self.tokens = tokens
        self.onCredentialsChanged = onCredentialsChanged
    }

    var hasStoredCredentials: Bool { tokens.refreshToken != nil }

    /// The bearer token for the websocket handshake.
    ///
    /// Refreshes an expired token, not just a missing one. The handshake has no
    /// 401 retry of its own — unlike `perform`, which refreshes and retries once —
    /// so handing out a dead token would leave the socket reconnecting with a
    /// credential the server keeps rejecting until some unrelated REST request
    /// happened to replace it. That state is indistinguishable from a bad network
    /// on the phone, and it does not clear on its own.
    /// What the live socket should do about its credential.
    ///
    /// The first two cases must not be collapsed into one. A refresh that failed
    /// because the server could not be reached says nothing about the credential —
    /// the account is still signed in and the token is still on disk. Reporting it
    /// as an authentication failure is what used to stop the socket for good: the
    /// account screen kept showing the signed-in email while the terminal list said
    /// the computer was offline, and nothing retried until the app was relaunched.
    enum LiveTokenOutcome {
        case token(String)
        /// The path to the server is missing; the credential is intact.
        case unreachable
        /// The credential is gone and has been discarded.
        case unauthenticated
    }

    func liveTokenOutcome() async -> LiveTokenOutcome {
        if accessToken == nil || accessTokenIsStale {
            switch await refreshAccessTokenOutcome() {
            case .success(let token): return .token(token)
            case .failure(.rejected): return .unauthenticated
            case .failure(.unreachable): return .unreachable
            }
        }
        guard let accessToken else { return .unauthenticated }
        return .token(accessToken)
    }

    /// Refreshes slightly early: a token that expires between here and the
    /// handshake is rejected exactly as one that already has.
    private var accessTokenIsStale: Bool {
        guard let accessTokenExpiresAt else { return false }
        return accessTokenExpiresAt.timeIntervalSinceNow <= Self.tokenRefreshSkew
    }

    private static let tokenRefreshSkew: TimeInterval = 30

    /// Reads `exp` from the token so a credential the server will reject is
    /// replaced before it reaches the socket.
    ///
    /// The signature is deliberately not verified: the server is the only party
    /// that decides whether a token is valid, and this only decides whether asking
    /// for a new one is worth a round trip. Returns `nil` for a token whose
    /// lifetime cannot be read, which leaves the caller on the previous behaviour.
    ///
    /// Not private so it can be tested directly: the parsing is the only part of
    /// the refresh decision that can be wrong in a way nothing else reveals.
    static func expiry(of token: String) -> Date? {
        struct Claims: Decodable { let exp: Double? }

        let parts = token.split(separator: ".")
        guard parts.count == 3,
              let payload = decodeBase64URL(String(parts[1])),
              let claims = try? JSONDecoder().decode(Claims.self, from: payload),
              let exp = claims.exp else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    /// JWT segments are base64url and unpadded, which `Data` does not accept as-is.
    private static func decodeBase64URL(_ value: String) -> Data? {
        var padded = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while padded.count % 4 != 0 { padded += "=" }
        return Data(base64Encoded: padded)
    }

    // MARK: - Auth

    func login(email: String, password: String) async throws {
        let body: [String: String] = ["email": email, "password": password]
        let response: TokenPair = try await send(
            path: "/auth/login",
            method: "POST",
            body: body,
            authenticated: false
        )
        accessToken = response.accessToken
        accessTokenExpiresAt = Self.expiry(of: response.accessToken)
        tokens.refreshToken = response.refreshToken
        tokens.accountEmail = email
        // Writing to the keychain can fail, and it used to fail silently: the token
        // lived only in memory, the login looked like it worked, and the next launch
        // had nothing to restore. Reading it back is what keeps that from being
        // reported as a successful sign-in.
        guard tokens.refreshToken != nil else {
            throw APIError(
                status: 0,
                code: "credential_storage_failed",
                message: "登录信息没能保存，重启后需要重新登录。"
            )
        }
        onCredentialsChanged()
    }

    func logout() async {
        if let refreshToken = tokens.refreshToken {
            _ = try? await send(
                path: "/auth/logout",
                method: "POST",
                body: ["refreshToken": refreshToken],
                authenticated: false
            ) as EmptyResponse
        }
        accessToken = nil
        accessTokenExpiresAt = nil
        tokens.clearCredentials()
        onCredentialsChanged()
    }

    /// What happened when the app tried to restore a session at launch.
    ///
    /// `noCredentials` and `unreachable` are deliberately separate. They used to
    /// be one `false`, which sent a user whose token was sitting safely in the
    /// keychain to the login screen because the server happened to be restarting —
    /// telling them their account was gone when it was not, and hiding the one
    /// thing that would have explained it.
    enum SessionRestoreOutcome {
        /// A usable token was obtained.
        case restored
        /// There is nothing stored to restore, or the server rejected the token.
        case noCredentials
        /// The credential is intact; the server could not be reached.
        case unreachable
    }

    /// Restores a session from the keychain at launch.
    func restoreSession() async -> SessionRestoreOutcome {
        guard tokens.refreshToken != nil else { return .noCredentials }
        switch await refreshAccessTokenOutcome() {
        case .success:
            return .restored
        case .failure(.rejected):
            // The token was discarded on the way out; there is nothing left to use.
            return .noCredentials
        case .failure(.unreachable):
            return .unreachable
        }
    }

    // MARK: - Mobile endpoints

    func registerPushToken(_ token: String, deviceName: String, appVersion: String) async throws {
        struct Body: Encodable {
            let clientInstanceId: String
            let deviceName: String
            let platform: String
            let appVersion: String
            let pushToken: String
        }
        let _: EmptyResponse = try await send(
            path: "/mobile/devices",
            method: "POST",
            body: Body(
                clientInstanceId: tokens.clientInstanceId,
                deviceName: deviceName,
                platform: "ios",
                appVersion: appVersion,
                pushToken: token
            )
        )
    }

    func unregisterPushToken() async throws {
        let _: EmptyResponse = try await send(
            path: "/mobile/devices/\(tokens.clientInstanceId)",
            method: "DELETE"
        )
    }

    struct DesktopList: Decodable {
        let clientInstanceIds: [String]
    }

    func onlineDesktops() async throws -> [String] {
        let response: DesktopList = try await send(path: "/mobile/desktops", method: "GET")
        return response.clientInstanceIds
    }

    /// The last session list the desktop published. Used on cold start so the app
    /// shows real content immediately rather than an empty screen.
    func cachedSummary(desktopClientInstanceId: String) async throws -> MobileSummaryPayload? {
        struct Response: Decodable {
            let summary: MobileSummaryPayload?
        }
        let encoded = desktopClientInstanceId
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let response: Response = try await send(
            path: "/mobile/summary?desktopClientInstanceId=\(encoded)",
            method: "GET"
        )
        return response.summary
    }

    /// Sends an intent over HTTP instead of the socket.
    ///
    /// Notification actions run without a live connection, so the request has to
    /// carry the answer back rather than waiting for one on the socket.
    func submitIntent(
        desktopClientInstanceId: String,
        intent: MobileIntentRequest,
        waitForResult: Bool
    ) async throws -> MobileIntentResult? {
        struct Body: Encodable {
            let clientInstanceId: String
            let desktopClientInstanceId: String
            let intent: MobileIntentRequest
            let waitForResult: Bool
        }
        struct Response: Decodable {
            let delivered: Bool
            let code: String?
            let result: MobileIntentResult?
        }
        let response: Response = try await send(
            path: "/mobile/terminal/intent",
            method: "POST",
            body: Body(
                clientInstanceId: tokens.clientInstanceId,
                desktopClientInstanceId: desktopClientInstanceId,
                intent: intent,
                waitForResult: waitForResult
            )
        )
        if let result = response.result { return result }
        return MobileIntentResult(
            intentId: intent.intentId,
            outcome: "rejected",
            code: response.code ?? (response.delivered ? "no_result" : "delivery_failed"),
            message: response.delivered ? nil : "电脑离线。",
            sessionId: nil,
            createdSessionId: nil
        )
    }

    // MARK: - Transport

    /// Why a refresh did not produce an access token.
    private enum RefreshFailure: Error {
        /// The server refused the token. It is dead, and has been discarded.
        case rejected
        /// The server could not be reached, or did not answer. The stored token is
        /// untouched and may well still be good.
        case unreachable
    }

    /// Refreshes, or explains which kind of failure it was.
    ///
    /// One refresh runs at a time whichever caller asked: a socket reconnect and a
    /// 401 from a normal request must not race two refreshes against each other.
    private func refreshAccessTokenOutcome() async -> Result<String, RefreshFailure> {
        if let inFlight = refreshInFlight { return await inFlight.value }

        let task = Task<Result<String, RefreshFailure>, Never> { [weak self] in
            guard let self else { return .failure(.rejected) }
            defer { Task { await self.clearRefreshInFlight() } }
            guard let refreshToken = await self.tokens.refreshToken else { return .failure(.rejected) }
            do {
                let response: TokenPair = try await self.send(
                    path: "/auth/refresh",
                    method: "POST",
                    body: ["refreshToken": refreshToken],
                    authenticated: false,
                    allowRefresh: false
                )
                await self.storeRefreshed(response)
                return .success(response.accessToken)
            } catch {
                let apiError = error as? APIError
                // A rejected refresh token is dead; keeping it would make every
                // later request fail the same way. Anything else — no usable network
                // path, a timeout, a server that is restarting — says nothing about
                // the token, so the token is left alone.
                guard let apiError, apiError.isUnauthorized else {
                    AppLog.network.warning(
                        "token refresh could not reach the server: \(error.localizedDescription, privacy: .public)"
                    )
                    return .failure(.unreachable)
                }
                await self.discardCredentials()
                return .failure(.rejected)
            }
        }
        refreshInFlight = task
        return await task.value
    }

    private func refreshAccessToken() async -> String? {
        switch await refreshAccessTokenOutcome() {
        case .success(let accessToken): return accessToken
        case .failure: return nil
        }
    }

    private func storeRefreshed(_ pair: TokenPair) {
        accessToken = pair.accessToken
        accessTokenExpiresAt = Self.expiry(of: pair.accessToken)
        tokens.refreshToken = pair.refreshToken
    }

    private func clearRefreshInFlight() {
        refreshInFlight = nil
    }

    private func discardCredentials() {
        accessToken = nil
        accessTokenExpiresAt = nil
        tokens.clearCredentials()
        onCredentialsChanged()
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        authenticated: Bool = true,
        allowRefresh: Bool = true
    ) async throws -> Response {
        try await perform(
            path: path,
            method: method,
            encodedBody: nil,
            authenticated: authenticated,
            allowRefresh: allowRefresh
        )
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        body: Body,
        authenticated: Bool = true,
        allowRefresh: Bool = true
    ) async throws -> Response {
        try await perform(
            path: path,
            method: method,
            encodedBody: try JSONEncoder().encode(body),
            authenticated: authenticated,
            allowRefresh: allowRefresh
        )
    }

    private func perform<Response: Decodable>(
        path: String,
        method: String,
        encodedBody: Data?,
        authenticated: Bool,
        allowRefresh: Bool
    ) async throws -> Response {
        if authenticated, accessToken == nil {
            _ = await refreshAccessToken()
        }

        guard let url = URL(string: AppConfiguration.apiBaseURL.absoluteString + path) else {
            throw APIError(status: 0, code: "bad_url", message: "服务器地址无效。")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if authenticated, let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let encodedBody {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = encodedBody
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(status: 0, code: "network", message: "网络不可用，请稍后重试。")
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "network", message: "服务器返回的数据无法读取。")
        }

        if http.statusCode == 401 || http.statusCode == 403, authenticated, allowRefresh {
            // One refresh and one retry, matching the desktop client.
            if await refreshAccessToken() != nil {
                return try await perform(
                    path: path,
                    method: method,
                    encodedBody: encodedBody,
                    authenticated: authenticated,
                    allowRefresh: false
                )
            }
        }

        guard (200..<300).contains(http.statusCode) else {
            throw Self.decodeError(status: http.statusCode, data: data)
        }

        if Response.self == EmptyResponse.self {
            guard let empty = EmptyResponse() as? Response else {
                throw APIError(status: http.statusCode, code: "decode", message: "服务器返回的数据格式不正确。")
            }
            return empty
        }
        if data.isEmpty {
            throw APIError(status: http.statusCode, code: "empty", message: "服务器没有返回数据。")
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError(status: http.statusCode, code: "decode", message: "服务器返回了无法识别的数据。")
        }
    }

    private static func decodeError(status: Int, data: Data) -> APIError {
        struct ErrorBody: Decodable {
            let message: String?
            let error: String?
            let code: String?
        }
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        let message = body?.message ?? body?.error ?? "请求失败（\(status)）。"
        return APIError(status: status, code: body?.code, message: message)
    }
}

struct TokenPair: Decodable {
    let accessToken: String
    let refreshToken: String
}

struct EmptyResponse: Decodable {}
