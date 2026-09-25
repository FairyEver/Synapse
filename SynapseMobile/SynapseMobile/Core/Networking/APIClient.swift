import Foundation
import os

/// 服务端签好的一条语音识别会话。
struct AsrSessionTicket: Decodable {
    let url: String
    let voiceId: String
    /// 签名过期时刻，epoch 秒。
    let expiredAt: Int
}

private struct EmptyBody: Encodable {}

struct APIError: Error, LocalizedError {
    let status: Int
    let code: String?
    let message: String
    /// 错误响应体的原文。
    ///
    /// 绝大多数调用方只看 `status` 与 `code`，但问题反馈的 `PRIVACY_RISK` 把命中的风险
    /// 类别放在 `data.category` 里，而那是决定要说哪一句话的唯一依据 —— 只留 code 的话，
    /// 六种风险会塌成同一句「包含隐私风险」。
    ///
    /// 有默认值，所以既有的三参构造点一个都不用改。
    var payload: Data? = nil

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

    /// 传字节用的会话（云盘的下载）。
    ///
    /// 与 REST 那个**不能共用**：REST 的资源超时是 30 秒（`requestResourceTimeout`），那是给
    /// 一次请求-响应的总时长定的上限。而下载是一整段几十兆、最多上百兆（`DRIVE_MAX_FILE_BYTES`）
    /// 的传输，30 秒到点就断 —— 一个 100 MB 的文件要在 30 秒内下完，等于要求 27 Mbit/s 的稳定
    /// 带宽。这里的上限只用来兜住「彻底卡死」，单包间隔仍然按 `AppConfiguration.requestTimeout`
    /// 算（20 秒没动静就是一个坏连接）。
    ///
    /// `waitsForConnectivity = false`：这是用户按下去、正看着进度条的那个动作。没有网络路径时
    /// 应该立刻说「网络不可用」，而不是让进度条停在那儿等十分钟 —— REST 那一边等是应该的，
    /// 那是后台请求，而它那 30 秒的上限正好也是这个用意。
    ///
    /// 第一次真的下载时才建：不碰云盘的会话不必多一个 URLSession。
    private lazy var downloadSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = AppConfiguration.requestTimeout
        configuration.timeoutIntervalForResource = 600
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

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
        struct Entry: Decodable {
            let clientInstanceId: String
            let deviceName: String?
        }

        let clientInstanceIds: [String]
        /// Optional because the field is newer than the list itself. Absent means the
        /// server cannot name these computers, not that there are none — the ids still
        /// are, and a computer the phone cannot name is still one it can switch to.
        let desktops: [Entry]?
    }

    func onlineDesktops() async throws -> [ReachableDesktop] {
        let response: DesktopList = try await send(path: "/mobile/desktops", method: "GET")
        guard let desktops = response.desktops else {
            return response.clientInstanceIds.map {
                ReachableDesktop(clientInstanceId: $0, deviceName: nil)
            }
        }
        return desktops.map {
            ReachableDesktop(clientInstanceId: $0.clientInstanceId, deviceName: $0.deviceName)
        }
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

    func listNotifications(filter: String, cursor: String? = nil) async throws -> NotificationPage {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "filter", value: filter)]
        if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await send(path: "/notifications?\(components.percentEncodedQuery ?? "")", method: "GET")
    }

    func notification(_ id: String) async throws -> SynapseNotification {
        try await send(path: "/notifications/\(id)", method: "GET")
    }

    func notificationUnreadCount() async throws -> Int {
        struct Response: Decodable { let unread: Int }
        let response: Response = try await send(path: "/notifications/count", method: "GET")
        return response.unread
    }

    func markNotificationRead(_ id: String) async throws {
        let _: EmptyResponse = try await send(path: "/notifications/\(id)/read", method: "PATCH", body: EmptyBody())
    }

    func markAllNotificationsRead() async throws {
        let _: EmptyResponse = try await send(path: "/notifications/read-all", method: "PATCH", body: EmptyBody())
    }

    func deleteNotification(_ id: String) async throws {
        let _: EmptyResponse = try await send(path: "/notifications/\(id)", method: "DELETE")
    }

    /// 平台有没有开语音识别。
    ///
    /// 这是服务端的部署事实——腾讯云密钥在服务端，不是每台设备的设置——所以麦克风
    /// 入口显不显示由这个答案决定。
    func asrAvailability() async throws -> Bool {
        struct Response: Decodable {
            let available: Bool
        }
        let response: Response = try await send(path: "/voice/asr", method: "GET")
        return response.available
    }

    /// 要一条已签名的实时语音识别会话。
    ///
    /// 密钥只在服务端：回来的 URL 已经带好 signature，手机拿它直连腾讯云。每次都要
    /// 换新的，中断之后旧的一律作废。
    func asrSession() async throws -> AsrSessionTicket {
        try await send(path: "/voice/asr/session", method: "POST", body: EmptyBody())
    }

    /// 录音列表。转写结果在服务端，和电脑在不在线无关。
    func listMeetings() async throws -> [MeetingSummary] {
        struct Response: Decodable {
            let items: [MeetingSummary]
        }
        let response: Response = try await send(path: "/meetings", method: "GET")
        return response.items
    }

    func meetingDetail(_ meetingId: String) async throws -> MeetingDetail {
        let encoded = meetingId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? meetingId
        return try await send(path: "/meetings/\(encoded)", method: "GET")
    }

    // MARK: - 录音

    /// 开一条录音。
    ///
    /// 服务端在这一步就把三张表建好、分块上传也开好了，所以从这一刻起「这条录音」在
    /// 列表里已经存在——异常退出之后要收的就是它。
    struct StartedRecording: Decodable {
        let meetingId: String
        let recordingId: String
        let uploadId: String
        let title: String
    }

    func startMeetingRecording(title: String?, startedAt: Date?) async throws -> StartedRecording {
        struct Body: Encodable {
            let title: String?
            let startedAt: String?
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try await send(
            path: "/meetings/recordings",
            method: "POST",
            body: Body(title: title, startedAt: startedAt.map(formatter.string(from:)))
        )
    }

    /// 传一个分片。
    ///
    /// 分片是**裸字节**，不套 multipart 表单：服务端原样把它转给对象存储，中间不做任
    /// 何解析。`APIClient` 另外两个出口都会把 body 当成 JSON，所以这里窄开一个只发原
    /// 始字节的口子，而不是绕开 `APIClient` 自己拼 URLSession——那样就绕开了 token
    /// 刷新和 401 重试。
    func uploadMeetingPart(recordingId: String, partNumber: Int, bytes: Data) async throws {
        let _: EmptyResponse = try await perform(
            path: "/meetings/recordings/\(escaped(recordingId))/parts/\(partNumber)",
            method: "PUT",
            encodedBody: bytes,
            contentType: "application/octet-stream",
            authenticated: true,
            allowRefresh: true
        )
    }

    /// 收尾：合并、提交转写。客户端拿到响应就可以回列表了。
    ///
    /// `peaks` 是波形振幅（0–255 字节）的 base64。
    func completeMeetingRecording(recordingId: String, durationMs: Int, peaks: String) async throws {
        struct Body: Encodable {
            let durationMs: Int
            let peaks: String
        }
        let _: EmptyResponse = try await send(
            path: "/meetings/recordings/\(escaped(recordingId))/complete",
            method: "POST",
            body: Body(durationMs: durationMs, peaks: peaks)
        )
    }

    /// 取消录音。服务端会**中止**这次分块上传，已传的分片一并丢弃，不留残留。
    func cancelMeetingRecording(recordingId: String) async throws {
        let _: EmptyResponse = try await send(
            path: "/meetings/recordings/\(escaped(recordingId))",
            method: "DELETE"
        )
    }

    func renameMeeting(_ meetingId: String, to title: String) async throws {
        struct Body: Encodable { let title: String }
        let _: EmptyResponse = try await send(
            path: "/meetings/\(escaped(meetingId))",
            method: "PATCH",
            body: Body(title: title)
        )
    }

    /// 删掉整条：音频和文字一起，行从列表里消失，不可恢复。
    func deleteMeeting(_ meetingId: String) async throws {
        let _: EmptyResponse = try await send(path: "/meetings/\(escaped(meetingId))", method: "DELETE")
    }

    /// 转写失败之后重来一次。**不需要重新上传音频**：音频已经在服务端了。
    func retryMeetingTranscription(_ meetingId: String) async throws {
        let _: EmptyResponse = try await send(
            path: "/meetings/\(escaped(meetingId))/transcription/retry",
            method: "POST"
        )
    }

    /// 音频的回放地址。录音还在才有；删掉之后是 nil，界面据此显示「录音已删除」。
    func meetingAudioURL(_ meetingId: String) async throws -> String? {
        struct Response: Decodable { let url: String? }
        let response: Response = try await send(path: "/meetings/\(escaped(meetingId))/audio-url", method: "GET")
        return response.url
    }

    /// 回放波形的振幅。服务端给的是 0–255 字节的 base64，**画之前要除以 255**。
    func meetingPeaks(_ meetingId: String) async throws -> String? {
        struct Response: Decodable { let peaks: String? }
        let response: Response = try await send(path: "/meetings/\(escaped(meetingId))/peaks", method: "GET")
        return response.peaks
    }

    /// 把一段音频下到本机，落在 `destination`。
    ///
    /// 走 `URLSession.downloadTask` 而不是 `send`：这是一段字节，不是 JSON；而且地址是服务端
    /// 现签的，凭据就在地址里，**不能再套一层 token**。
    ///
    /// 落盘这一步必须在这里当场做完：`downloadTask` 给的那个临时文件在下载方法返回之后
    /// 随时会被系统收走（几兆的音频重下一次代价不小）。目标已存在时 `moveItem` 会失败，
    /// 所以先清掉它——上一份要么是坏的，要么已经不作数了。
    func downloadMeetingAudio(from url: URL, to destination: URL) async throws {
        let (temporary, response) = try await session.download(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError(status: http.statusCode, code: nil, message: "音频没能下载下来。")
        }
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.moveItem(at: temporary, to: destination)
        } catch {
            throw APIError(status: 0, code: nil, message: "音频没能存到本机。")
        }
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
            createdSessionId: nil,
            landedPath: nil,
            // 这条路上不会有 Git 的**数据**回答：HTTP 回执只带一句话，而分支与冲突
            // 只在实时通道上走（`mobile.gitStatus` 与 `mobile.intentResult`）。
            git: nil
        )
    }

    // MARK: - File hand-off

    struct DriveItem: Decodable {
        let id: String
        let name: String
        let size: String
    }

    /// Where to put the bytes, and what the drive will call the result.
    struct DriveUploadTicket: Decodable {
        struct Destination: Decodable {
            let method: String
            let url: String
            let expiresAt: String
            let headers: [String: String]
        }

        let sessionId: String
        let item: DriveItem
        let upload: Destination
        /// 目标位置已经有一个同名文件时由服务端给出。
        ///
        /// 服务端确实把它放在 prepare 响应的**顶层**（`drive.service.ts` 的
        /// `DriveUploadPrepareResult`），不是嵌在 `item` 里。旧服务端整个键都不返回，
        /// 所以它是可选的：缺失 = **未知**，解码不能因此失败，调用方按「未知」处理
        /// （不弹确认、直接传）。
        let overwrite: DriveUploadOverwriteTarget?
    }

    /// Reserves a place in the drive for a file the phone is about to upload.
    ///
    /// `size` is a decimal string because the server's schema says so, and the
    /// declared size is checked against the object that arrives — a file whose real
    /// size disagrees is refused at completion rather than stored.
    ///
    /// `parentId` 是落到哪个文件夹，nil 是根；`expectedItemId` 是「确认覆盖那个已经存在的
    /// 文件」——服务端拿它核对目标在 prepare 到 complete 之间没有被换掉。两者都有默认值：
    /// 终端文件接力那条路只传前三个参数。
    func prepareDriveUpload(
        name: String,
        size: Int64,
        mimeType: String?,
        parentId: String? = nil,
        expectedItemId: String? = nil
    ) async throws -> DriveUploadTicket {
        struct Body: Encodable {
            let name: String
            let size: String
            let mimeType: String?
            let parentId: String?
            let expectedItemId: String?
        }
        return try await send(
            path: "/drive/uploads/prepare",
            method: "POST",
            body: Body(
                name: name,
                size: String(size),
                mimeType: mimeType,
                parentId: parentId,
                expectedItemId: expectedItemId
            )
        )
    }

    /// Turns the reserved upload into a real file. Only after this can the desktop
    /// download it.
    func completeDriveUpload(sessionId: String) async throws -> DriveItem {
        try await send(path: "/drive/uploads/\(escaped(sessionId))/complete", method: "POST")
    }

    /// Releases a reservation whose bytes never arrived, or that is no longer wanted.
    func cancelDriveUpload(sessionId: String) async throws {
        let _: EmptyResponse = try await send(path: "/drive/uploads/\(escaped(sessionId))/cancel", method: "POST")
    }

    /// Removes a file and the object behind it, with no way back.
    ///
    /// This is not the trash: `DELETE /drive/items/:id` only moves an item along its
    /// lifecycle and leaves the bytes in the bucket. The desktop normally does this
    /// as soon as a relayed file is on its disk; the phone does it for a transfer
    /// that was never delivered.
    func permanentlyDeleteDriveItem(itemId: String) async throws {
        let _: EmptyResponse = try await send(path: "/drive/items/\(escaped(itemId))/permanent", method: "DELETE")
    }

    /// 路径段里的 id 一律按 URL 路径规则编码。
    ///
    /// 规则只写一遍：下面 `DriveRoute` 里的路径是纯字符串拼出来的，`static` 才够得着它。
    private static func escapedPathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func escaped(_ value: String) -> String {
        Self.escapedPathComponent(value)
    }

    // MARK: - Drive

    /// 云盘各条路由的路径。
    ///
    /// 单独抽出来是给契约测试用的：路径写在方法体里就只能靠一次真请求去验，而拼错在真请求上
    /// 表现成 404 —— 与「服务端没有这个能力」分不开。方法发出去的和测试断言的是同一个函数，
    /// 钉住的就是真正发出去的那一条，不是它的副本。
    ///
    /// id 一律在这里过 `escapedPathComponent`：调用方传原始值，编码不可能被漏掉。
    enum DriveRoute {
        /// 控制台那一套浏览接口。另一档 `standalone` 回来的是公开页的地址，
        /// 手机端要的是同一批 id、同一套权限的这一档。
        static let consoleSurface = "console"

        static func root(childrenOffset: Int?, childrenLimit: Int?) -> String {
            "/drive/browser/owner/root"
                + queryString(childrenItems(childrenOffset: childrenOffset, childrenLimit: childrenLimit))
        }

        static func itemSnapshot(itemId: String, childrenOffset: Int?, childrenLimit: Int?) -> String {
            let items = [URLQueryItem(name: "surface", value: consoleSurface)]
                + childrenItems(childrenOffset: childrenOffset, childrenLimit: childrenLimit)
            return "/drive/browser/owner/items/\(escapedPathComponent(itemId))" + queryString(items)
        }

        static let createFolder = "/drive/folders"

        /// 改名、移动、移入回收站共用这一条，动作由方法与请求体决定。
        static func item(itemId: String) -> String {
            "/drive/items/\(escapedPathComponent(itemId))"
        }

        static func restoreItem(itemId: String) -> String {
            "/drive/items/\(escapedPathComponent(itemId))/restore"
        }

        static func share(itemId: String) -> String {
            "/drive/items/\(escapedPathComponent(itemId))/share"
        }

        static func trash(offset: Int?, limit: Int?, search: String?) -> String {
            "/drive/trash"
                + queryString(pageItems(offset: offset, limit: limit) + searchItem(search))
        }

        static func hideTrashItem(id: String) -> String {
            "/drive/trash/\(escapedPathComponent(id))"
        }

        static func shares(offset: Int?, limit: Int?) -> String {
            "/drive/shares" + queryString(pageItems(offset: offset, limit: limit))
        }

        /// 一条分享记录。`GET` 读它（`driveShareRecord(id:)`），`DELETE` 停用它
        /// （`disableShare(id:)`）——路径是同一条，动作由方法决定。
        ///
        /// 两个编号都收：服务端按 `OR: [{ id }, { shareId }]` 找（`drive.service.ts` 的
        /// `getShare`），所以调用方随手边有哪个就用哪个。浏览行上那个站内路径里带着的是
        /// `shareId`，分享列表里那行带着的是 `id`。
        static func shareRecord(id: String) -> String {
            "/drive/shares/\(escapedPathComponent(id))"
        }

        static func disableShare(id: String) -> String {
            shareRecord(id: id)
        }

        static let usage = "/drive/usage"

        static func publicAssets(offset: Int?, limit: Int?, search: String?) -> String {
            "/drive/public-assets"
                + queryString(pageItems(offset: offset, limit: limit) + searchItem(search))
        }

        static let preparePublicAssetUpload = "/drive/public-assets/uploads/prepare"

        static func completePublicAssetUpload(sessionId: String) -> String {
            "/drive/public-assets/uploads/\(escapedPathComponent(sessionId))/complete"
        }

        /// 改名与移入回收站共用这一条。
        static func publicAsset(assetId: String) -> String {
            "/drive/public-assets/\(escapedPathComponent(assetId))"
        }

        static func restorePublicAsset(assetId: String) -> String {
            "/drive/public-assets/\(escapedPathComponent(assetId))/restore"
        }

        static func contentInspect(itemId: String) -> String {
            "/drive/browser/owner/items/\(escapedPathComponent(itemId))/content/inspect"
        }

        static func contentChunk(itemId: String, versionId: String, cursor: String?) -> String {
            let items = [
                URLQueryItem(name: "versionId", value: versionId),
                URLQueryItem(name: "cursor", value: cursor),
            ]
            return "/drive/browser/owner/items/\(escapedPathComponent(itemId))/content/chunk"
                + queryString(items)
        }

        /// 这条**不在** `/api` 前缀下（服务端把它注册在 `@Controller()` 上），所以要拼到源站上，
        /// 而不是 `apiBaseURL` 上。
        ///
        /// 源站是**参数**而不是在这里读 `AppConfiguration`：`DriveRoute` 里全是纯函数，
        /// 契约测试断言的「源站 + 这条路径」才不会从 `UserDefaults` 取值 —— 那个键在并行测试里
        /// 会被 `AppConfigurationTests` 改写（其中一例正是 `…/apiary`），断言跟着飘就没有意义了。
        static func download(itemId: String, origin: URL) -> String {
            origin.absoluteString + "/drive/items/\(escapedPathComponent(itemId))/download"
        }

        /// 一页的两个参数。没给的那个不拼进去：服务端把「没给」当成它自己的默认值，
        /// 而拼一个空串（`?offset=&limit=`）会被参数校验挡下来。
        private static func pageItems(offset: Int?, limit: Int?) -> [URLQueryItem] {
            [
                URLQueryItem(name: "offset", value: offset.map(String.init)),
                URLQueryItem(name: "limit", value: limit.map(String.init)),
            ]
        }

        /// 浏览接口那两个参数叫 `childrenOffset`/`childrenLimit`，与列表页的 `offset`/`limit` 不同名。
        private static func childrenItems(childrenOffset: Int?, childrenLimit: Int?) -> [URLQueryItem] {
            [
                URLQueryItem(name: "childrenOffset", value: childrenOffset.map(String.init)),
                URLQueryItem(name: "childrenLimit", value: childrenLimit.map(String.init)),
            ]
        }

        private static func searchItem(_ search: String?) -> [URLQueryItem] {
            [URLQueryItem(name: "search", value: search)]
        }

        /// `?a=1&b=2`；一个参数都没有时是空串。
        private static func queryString(_ items: [URLQueryItem]) -> String {
            let present = items.filter { $0.value != nil }
            guard !present.isEmpty else { return "" }
            var components = URLComponents()
            components.queryItems = present
            guard let encoded = components.percentEncodedQuery else { return "" }
            return "?" + encoded
        }
    }

    /// `PATCH /drive/items/:id` 的两种请求体。
    ///
    /// 服务端按「体里有没有 `name`」分流，而两条 schema 都是 `.strict()`：改名必须只带
    /// `name`，多带一个 `parentId` 会被整条拒掉。
    ///
    /// 移动则必须**显式**带 `parentId`（可空但不可缺，`moveSchema` 里没有 `.optional()`）：
    /// 缺了这个键，「移到根目录」会被判成「移动请求无效」。JSONEncoder 默认会把值为 nil 的
    /// 键省掉，所以这里自己写 `encode(to:)` 把它发成 `null`。
    struct DriveRenameBody: Encodable {
        let name: String
    }

    struct DriveMoveBody: Encodable {
        let parentId: String?

        enum CodingKeys: String, CodingKey { case parentId }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(parentId, forKey: .parentId)
        }
    }

    /// 创建分享时要告诉服务端的三件事（外加一个指定邮箱名单）。
    ///
    /// 字段名就是服务端 `driveAccessSettingsSchema` 里的名字，而 nil 的字段根本不会发出去：
    /// 「没说要什么」与「要永久有效」是两件事，前者由服务端拿它自己的默认值定。
    struct DriveShareSettings: Encodable {
        var passwordEnabled: Bool?
        /// `expiresIn` 的取值就是 `DriveExpiry` 的原始值。
        var expiresIn: DriveExpiry?
        var accessMode: DriveAccessMode?
        /// 只有 `specifiedUsersEdit` 用得上。
        var editorEmails: [String]?

        init(
            passwordEnabled: Bool? = nil,
            expiresIn: DriveExpiry? = nil,
            accessMode: DriveAccessMode? = nil,
            editorEmails: [String]? = nil
        ) {
            self.passwordEnabled = passwordEnabled
            self.expiresIn = expiresIn
            self.accessMode = accessMode
            self.editorEmails = editorEmails
        }
    }

    // MARK: 浏览

    /// 根那一层的快照。根是服务端合成的一项，两个参数只作用于子项那一页。
    func driveRootSnapshot(
        childrenOffset: Int? = nil,
        childrenLimit: Int? = nil
    ) async throws -> DriveBrowserSnapshot {
        try await send(
            path: DriveRoute.root(childrenOffset: childrenOffset, childrenLimit: childrenLimit),
            method: "GET"
        )
    }

    /// 任意一项那一层的快照（文件夹给子项，文件给它的预览）。
    func driveItemSnapshot(
        itemId: String,
        childrenOffset: Int? = nil,
        childrenLimit: Int? = nil
    ) async throws -> DriveBrowserSnapshot {
        try await send(
            path: DriveRoute.itemSnapshot(
                itemId: itemId,
                childrenOffset: childrenOffset,
                childrenLimit: childrenLimit
            ),
            method: "GET"
        )
    }

    // MARK: 项

    /// 新建文件夹，`parentId` 为 nil 时建在根下。
    ///
    /// 服务端回来的是 `DriveItemDto`，它没有 `previewKind`/`browserUrl`，接不上
    /// `DriveBrowserItem`；而调用方建完都要重取当前层，所以这里只取「成没成」。
    func driveCreateFolder(parentId: String?, name: String) async throws {
        struct Body: Encodable {
            let parentId: String?
            let name: String
        }
        let _: EmptyResponse = try await send(
            path: DriveRoute.createFolder,
            method: "POST",
            body: Body(parentId: parentId, name: name)
        )
    }

    func driveRenameItem(itemId: String, name: String) async throws {
        let _: EmptyResponse = try await send(
            path: DriveRoute.item(itemId: itemId),
            method: "PATCH",
            body: DriveRenameBody(name: name)
        )
    }

    /// 移动，`parentId` 为 nil 时移到根下。
    func driveMoveItem(itemId: String, parentId: String?) async throws {
        let _: EmptyResponse = try await send(
            path: DriveRoute.item(itemId: itemId),
            method: "PATCH",
            body: DriveMoveBody(parentId: parentId)
        )
    }

    /// 移入回收站。字节还在，恢复走 `driveRestoreItem`。
    func driveTrashItem(itemId: String) async throws {
        let _: EmptyResponse = try await send(path: DriveRoute.item(itemId: itemId), method: "DELETE")
    }

    // MARK: 回收站

    func driveTrash(offset: Int? = nil, limit: Int? = nil, search: String? = nil) async throws -> DriveTrashPage {
        try await send(
            path: DriveRoute.trash(offset: offset, limit: limit, search: search),
            method: "GET"
        )
    }

    /// 把普通项从回收站恢复回原处。
    ///
    /// 公开素材的条目是**另一条接口**（`driveRestorePublicAsset`），判据在条目自己的
    /// `isPublicAsset` 上 —— 两条路的差别只有这一处，所以走哪条由调用方按那个字段选。
    func driveRestoreItem(itemId: String) async throws {
        let _: EmptyResponse = try await send(
            path: DriveRoute.restoreItem(itemId: itemId),
            method: "POST"
        )
    }

    /// 从回收站里移掉。用户看不见它有「彻底删除」，这一步之后字节才由服务端按自己的节奏回收。
    func driveHideTrashItem(id: String) async throws {
        let _: EmptyResponse = try await send(path: DriveRoute.hideTrashItem(id: id), method: "DELETE")
    }

    func driveRestorePublicAsset(assetId: String) async throws -> DrivePublicAsset {
        try await send(path: DriveRoute.restorePublicAsset(assetId: assetId), method: "POST")
    }

    // MARK: 分享

    /// 创建分享，或改一项已有分享的访问设置。
    ///
    /// 服务端对同一项只会有一条活跃分享：已经有的时候这次请求是把那条**更新**掉，
    /// 不会多出一条链接。于是调用方不必先查再建 —— 但这也意味着「改设置」和「建分享」
    /// 是同一个请求，传进来的三个字段就是链接最终的样子。
    func driveCreateShare(itemId: String, settings: DriveShareSettings) async throws -> DriveShare {
        try await send(path: DriveRoute.share(itemId: itemId), method: "POST", body: settings)
    }

    func driveShares(offset: Int? = nil, limit: Int? = nil) async throws -> DriveSharePage {
        try await send(path: DriveRoute.shares(offset: offset, limit: limit), method: "GET")
    }

    /// 读一条分享。**是读**：不新建、不改设置、不续期。
    ///
    /// `id` 与 `shareId` 都收。服务端只给「还活着」的那一条（`enabled: true` 且没过期，
    /// 见 `drive.service.ts` 的 `getShare`），所以已经停用或已过期的那一条回来的是 404 ——
    /// 调用方拿这个 404 当「现在没有能用的分享」，而不是当失败。
    ///
    /// 回来的类型是列表行而不是 `DriveShare`：这一条路由给的就是 `DriveShareListItemDto`
    /// （与 `GET /drive/shares` 的行同一个形状，`toDriveShareListItemDto`），它没有 `enabled`
    /// 那个字段——`DriveShare.enabled` 非可选，直接解到那边会缺键。
    func driveShareRecord(id: String) async throws -> DriveShareListItem {
        try await send(path: DriveRoute.shareRecord(id: id), method: "GET")
    }

    /// 关掉一条分享。链接立刻失效，记录还在。
    func driveDisableShare(id: String) async throws {
        let _: EmptyResponse = try await send(path: DriveRoute.disableShare(id: id), method: "DELETE")
    }

    // MARK: 用量

    func driveUsage() async throws -> DriveUsage {
        try await send(path: DriveRoute.usage, method: "GET")
    }

    // MARK: 公开素材

    func drivePublicAssets(
        offset: Int? = nil,
        limit: Int? = nil,
        search: String? = nil
    ) async throws -> DrivePublicAssetPage {
        try await send(
            path: DriveRoute.publicAssets(offset: offset, limit: limit, search: search),
            method: "GET"
        )
    }

    /// 公开素材的上传：与云盘里那套是同一个形状（预签名 PUT + complete），只是
    /// prepare 与 complete 换成 `public-assets` 那两条，回来的成品是一条直链。
    func drivePreparePublicAssetUpload(name: String, size: Int64, mimeType: String?) async throws -> DriveUploadTicket {
        struct Body: Encodable {
            let name: String
            let size: String
            let mimeType: String?
        }
        return try await send(
            path: DriveRoute.preparePublicAssetUpload,
            method: "POST",
            body: Body(name: name, size: String(size), mimeType: mimeType)
        )
    }

    /// 完成之后拿到的就是那条直链本身（`url`）。
    func driveCompletePublicAssetUpload(sessionId: String) async throws -> DrivePublicAsset {
        try await send(path: DriveRoute.completePublicAssetUpload(sessionId: sessionId), method: "POST")
    }

    func driveRenamePublicAsset(assetId: String, name: String) async throws -> DrivePublicAsset {
        try await send(
            path: DriveRoute.publicAsset(assetId: assetId),
            method: "PATCH",
            body: DriveRenameBody(name: name)
        )
    }

    /// 移入回收站。直链当下就不可用，素材还在回收站里等恢复。
    func driveTrashPublicAsset(assetId: String) async throws -> DrivePublicAsset {
        try await send(path: DriveRoute.publicAsset(assetId: assetId), method: "DELETE")
    }

    // MARK: 文本内容

    /// 文本文件的检查结果：拿 `versionId` 去分段读。
    func driveContentInspect(itemId: String) async throws -> DriveContentInspect {
        try await send(path: DriveRoute.contentInspect(itemId: itemId), method: "GET")
    }

    /// 读一段。`cursor` 为 nil 时从头读。
    ///
    /// `versionId` 必须是刚检查出来的那一个：换过一次的内容在服务端是另一个版本，
    /// 拿旧版本号读会被判成「快照过期」，而不是悄悄给你一段旧字节。
    func driveContentChunk(
        itemId: String,
        versionId: String,
        cursor: String? = nil
    ) async throws -> DriveContentChunk {
        try await send(
            path: DriveRoute.contentChunk(itemId: itemId, versionId: versionId, cursor: cursor),
            method: "GET"
        )
    }

    // MARK: 下载

    /// 下载一项的绝对地址：源站（`apiOrigin`，没有 `/api` 那一段）+ 路由。
    ///
    /// 是 `static`，因为它只做字符串拼接、不碰任何状态。
    static func driveDownloadURL(itemId: String) -> URL {
        // 到不了落空：origin 由 `apiBaseURL` 派生（那里已经保证有 host），
        // 路径段也全部编码过。所以这一串一定解析得出来。
        URL(string: DriveRoute.download(itemId: itemId, origin: AppConfiguration.apiOrigin))!
    }

    /// 把一项下到本机，落在 `destination`。
    ///
    /// 走 `URLSession.download` 而不是 `send`：这是一段字节，不是 JSON。与
    /// `downloadMeetingAudio` 那条不同的是**这条路要带账号令牌** —— 音频那条的地址是
    /// 服务端现签的，凭据已经在地址里；这一条靠 `Authorization` 头认人。
    ///
    /// 令牌只放头里，绝不放查询串：地址会被写进日志、被中间设备看到，头不会。
    ///
    /// 落盘必须在这里当场做完：`download` 给的那个临时文件在这个方法返回之后随时会被系统
    /// 收走，而一个几百兆的文件重下一次不是能接受的代价。
    func downloadDriveItem(
        itemId: String,
        to destination: URL,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws {
        // 令牌先换成可用的。这条路没有 `perform` 那种「401 之后刷新一次再重试」的兜底
        // ——它不走 `perform`——所以快过期的令牌要在发请求前就换掉，否则会白下一次。
        if accessToken == nil || accessTokenIsStale {
            switch await refreshAccessTokenOutcome() {
            case .success:
                break
            case .failure(.rejected):
                throw APIError(status: 401, code: "unauthenticated", message: "登录已过期，请重新登录。")
            case .failure(.unreachable):
                throw APIError(status: 0, code: "network", message: "网络不可用，请稍后重试。")
            }
        }
        guard let token = accessToken else {
            throw APIError(status: 401, code: "unauthenticated", message: "登录已过期，请重新登录。")
        }

        var request = URLRequest(url: Self.driveDownloadURL(itemId: itemId))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let temporary: URL
        let response: URLResponse
        do {
            (temporary, response) = try await downloadSession.download(
                for: request,
                delegate: DriveDownloadProgressObserver(onProgress: onProgress)
            )
        } catch {
            AppLog.network.warning("drive download failed to reach the server: \(error.localizedDescription, privacy: .public)")
            throw APIError(status: 0, code: "network", message: "网络不可用，请稍后重试。")
        }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            // 状态码只进日志，不进给用户看的那句话：403 与 500 对用户是同一件事
            // （这次没下下来），而排查要靠日志里那个数字。
            AppLog.network.warning("drive download was refused with status \(http.statusCode)")
            throw APIError(status: http.statusCode, code: nil, message: "文件没能下载下来。")
        }

        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.moveItem(at: temporary, to: destination)
        } catch {
            AppLog.network.error("drive download could not be stored: \(error.localizedDescription, privacy: .public)")
            throw APIError(status: 0, code: nil, message: "文件没能存到本机。")
        }
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

    /// 提交一条问题反馈。
    ///
    /// `authenticated: false`：这个接口是公开的，服务端只看来源 IP，不看账号。带令牌不但
    /// 没用，还会让「未登录时能不能反馈」凭空多出一种情况。
    ///
    /// 不在这里做隐私预校验。服务端持有一份权威校验（`@synapse/shared` 的
    /// `validateProblemFeedbackInput`，约一百行正则），把它抄到 Swift 里就是第二份会漂移的
    /// 实现 —— 而结果是按服务端说的算，第二份只会在两边不一致时先把人挡下来。
    func submitProblemFeedback(content: String) async -> ProblemFeedbackOutcome {
        struct Body: Encodable { let content: String }
        struct Ack: Decodable { let success: Bool? }

        do {
            let _: Ack = try await send(
                path: "/problem-feedback",
                method: "POST",
                body: Body(content: content),
                authenticated: false
            )
            return .submitted
        } catch let error as APIError {
            // 传输层的失败（`status == 0`）：请求可能已经出去了。
            guard !error.isTransport else { return .unknown }
            switch error.status {
            case 400: return .rejected
            case 422: return .privacyRisk(category: Self.privacyCategory(from: error.payload))
            case 429: return .rateLimited
            case 503: return .notSubmitted
            default: return .unknown
            }
        } catch {
            return .unknown
        }
    }

    /// 从 422 的响应体里取出 `data.category`。
    private static func privacyCategory(from payload: Data?) -> String? {
        struct RiskBody: Decodable {
            struct Payload: Decodable { let category: String? }
            let data: Payload?
        }
        guard let payload else { return nil }
        return try? JSONDecoder().decode(RiskBody.self, from: payload).data?.category
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
        contentType: String = "application/json",
        authenticated: Bool,
        allowRefresh: Bool
    ) async throws -> Response {
        // 一次 REST 请求 ↔ 响应。**一个 `defer` 覆盖全部出口**（包括抛出去的那些），
        // 401 之后的重试会递归进这里，于是"重试过"这个事实白得一条记录。
        //
        // **字段里没有任何一项来自请求体。** 连 `encodedBody?.count` 都不记 ——
        // `/auth/login` 的体是 `{"email":…,"password":…}`，它的长度就是密码的长度。
        // 下一个人会想在这里顺手加一个 `.bytes`，所以这句话留在这儿而不是留在文档里。
        let started = Date()
        var recordedStatus: Int?
        var recordedBytes: Int?
        defer {
            let elapsedMs = Int(Date().timeIntervalSince(started) * 1_000)
            // 2xx 降到 debug：正常流量几乎不值得占位，而桶里剩下的位置要留给异常。
            // 其余（含"连接都没成"的 0）走 error —— error 绕过令牌桶，故障风暴里不会丢。
            let succeeded = recordedStatus.map { (200..<300).contains($0) } ?? false
            DiagnosticLog.record(
                .rest,
                [
                    .init(.route, .route(DiagnosticRoute.family(of: path))),
                    .init(.method, .flag(Self.wireMethodFlag(method))),
                    .init(.status, .int(recordedStatus ?? 0)),
                    .init(.durationMs, .durationMs(elapsedMs)),
                    .init(.bytes, .int(recordedBytes ?? 0)),
                ],
                level: succeeded ? .debug : .error
            )
        }

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
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            request.httpBody = encodedBody
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(status: 0, code: "network", message: "网络不可用，请稍后重试。")
        }
        recordedBytes = data.count

        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "network", message: "服务器返回的数据无法读取。")
        }
        recordedStatus = http.statusCode

        if http.statusCode == 401 || http.statusCode == 403, authenticated, allowRefresh {
            // One refresh and one retry, matching the desktop client.
            if await refreshAccessToken() != nil {
                return try await perform(
                    path: path,
                    method: method,
                    encodedBody: encodedBody,
                    contentType: contentType,
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

    /// HTTP 方法 → 日志里的标签。认不出的走 `.other` —— 加一个方法却忘了这里，
    /// 日志会显示 `other`，记录本身不会丢。
    private static func wireMethodFlag(_ method: String) -> DiagnosticFlag {
        switch method.uppercased() {
        case "GET": .httpGet
        case "POST": .httpPost
        case "PUT": .httpPut
        case "PATCH": .httpPatch
        case "DELETE": .httpDelete
        default: .other
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
        return APIError(status: status, code: body?.code, message: message, payload: data)
    }
}

struct TokenPair: Decodable {
    let accessToken: String
    let refreshToken: String
}

struct EmptyResponse: Decodable {}

/// 云盘下载的进度。
///
/// 只活在一次下载里 —— 这正是进度回调能按调用传、而不必按键挂在共享 delegate 上的原因。
/// 与 `FileUploader` 里那个同一个写法，只是回调的方向相反。
private final class DriveDownloadProgressObserver: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        // 长度未知时（服务端没给 Content-Length）这里是 -1，报一个不是任何东西的分数没有意义。
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }
}
