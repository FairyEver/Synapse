import Foundation

/// Where the app talks to.
///
/// The default is the hosted server so an installed build works with no setup.
/// A self-hosted or local development server is selected in Settings, or by
/// launching with `-SynapseAPIBaseURL http://localhost:3000/api` during
/// development, which `UserDefaults` picks up from the launch arguments.
enum AppConfiguration {
    static let defaultAPIBaseURL = "https://synapse.d2.pub/api"

    private static let apiBaseURLKey = "SynapseAPIBaseURL"

    static var apiBaseURL: URL {
        let raw = UserDefaults.standard.string(forKey: apiBaseURLKey) ?? defaultAPIBaseURL
        if let url = URL(string: raw), url.host != nil { return url }
        // A scheme written with one slash instead of two — `http:/host` rather than
        // `http://host`. It is what arrives when the address is handed over by
        // something that normalises paths on the way; `XCUIApplication` does exactly
        // that to its launch arguments, so the override a test run passes reaches the
        // app in this shape.
        //
        // Repaired rather than rejected, because `URL` accepts it and the failure is
        // silent and misleading: with no host it still parses, requests still go out —
        // `URLSession` reads the authority off the path — so sign-in and every list
        // fill in normally. Only the live socket refuses it, with a `bad URL` in the
        // log, and the symptom is a terminal that renders nothing at all. That reads
        // as a broken terminal rather than as a mistyped address, and it cost a round
        // of looking in the wrong place.
        if let url = URL(string: repairingFoldedSchemeSlash(raw)), url.host != nil { return url }
        return URL(string: defaultAPIBaseURL)!
    }

    /// Puts back the second slash of a scheme separator that was folded into one.
    ///
    /// Narrow on purpose: `scheme:/rest` becomes `scheme://rest`, and nothing else is
    /// touched. An address already written correctly has a `/` where this looks for a
    /// host, so it comes straight back.
    private static func repairingFoldedSchemeSlash(_ raw: String) -> String {
        guard let separator = raw.range(of: ":/") else { return raw }
        let scheme = raw[raw.startIndex..<separator.lowerBound]
        guard scheme.first?.isLetter == true,
              scheme.allSatisfy({ $0.isLetter || $0.isNumber || "+-.".contains($0) })
        else { return raw }
        let rest = raw[separator.upperBound...]
        guard rest.first != nil, rest.first != "/" else { return raw }
        return "\(scheme)://\(rest)"
    }

    static var apiBaseURLString: String {
        get { UserDefaults.standard.string(forKey: apiBaseURLKey) ?? defaultAPIBaseURL }
        set {
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                UserDefaults.standard.removeObject(forKey: apiBaseURLKey)
            } else {
                UserDefaults.standard.set(trimmed, forKey: apiBaseURLKey)
            }
        }
    }

    /// The live socket lives beside the REST API on the same origin.
    static var liveMobileURL: URL {
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = components.path.replacingOccurrences(of: "/api", with: "/api/live/mobile")
        components.query = nil
        components.fragment = nil
        return components.url!
    }

    /// 同一个服务器的地址，但没有 `/api` 这一段 —— 不在 API 前缀下的那些路由挂在这里。
    ///
    /// 目前只有一条：文件下载 `GET /drive/items/:itemId/download`。它在服务端注册在
    /// `@Controller()` 的绝对路径上（`drive.controller.ts`），前面加上 `/api` 只会得到
    /// 一个 404 —— 而 404 与「服务端没有这个能力」长得一模一样。所以这里按
    /// `liveMobileURL` 的做法从 `apiBaseURL` 派生出源站，拼错也只错在这一处。
    static var apiOrigin: URL {
        guard var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false) else {
            return apiBaseURL
        }
        // 逐段比对而不是 `replacingOccurrences(of: "/api", …)`：后者会把 `/apiary`
        // 这样一个只是恰好以 /api 开头的目录名一起截掉。
        let apiSegment = "/api"
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        if path.hasSuffix(apiSegment) { path.removeLast(apiSegment.count) }
        // 源站不以斜杠结尾：调用方是拿它和一条以 `/` 开头的路径相接的。
        while path.hasSuffix("/") { path.removeLast() }
        components.path = path
        components.query = nil
        components.fragment = nil
        return components.url ?? apiBaseURL
    }

    /// Kept above the phone server's 45s stale threshold; the desktop uses 20s.
    static let heartbeatInterval: TimeInterval = 20
    static let requestTimeout: TimeInterval = 20

    /// How long the live socket may hear nothing before the app treats it as gone.
    ///
    /// Sending pings is not enough to know the link is up. A half-open connection —
    /// a Wi-Fi/cellular handoff, a NAT entry that expired — does not raise an error
    /// in `receive()`: the close frame the server sends cannot reach a phone whose
    /// path is gone, so nothing surfaces and the app sits in `.connected` while the
    /// terminal freezes, with the screen still saying 已连接.
    ///
    /// The server answers every ping, so silence this long means three answers in a
    /// row did not arrive. Generous on purpose: a false positive costs a reconnect
    /// and a fresh `sync`, and this only has to beat "never".
    static let connectionSilenceTimeout: TimeInterval = 60

    /// How long a terminal view stays open without the user touching it before the
    /// app tells the desktop to let go of the write lease.
    static let terminalKeepAliveInterval: TimeInterval = 25

    /// How long the pane's measured grid has to hold still before it is sent as the
    /// size the desktop should adopt.
    ///
    /// A rotation settles over several layout passes and each one is a candidate
    /// size. Sending them all would be a burst of `SIGWINCH` while the user is still
    /// turning the phone, and a full-screen program redraws for every one.
    static let terminalGridDebounce: TimeInterval = 0.3

    /// How long the terminal screen sits idle before its three bars take themselves
    /// away and leave the canvas the whole screen.
    ///
    /// A property rather than a constant, and the only one of these that reads an
    /// override: the UI tests spend fifteen to ninety seconds waiting for a terminal
    /// to fill in before they touch a button on one of those bars. At three seconds
    /// the buttons are gone by the time they arrive, and the failure would read as a
    /// missing toolbar rather than as a timer. What they pass instead is a duration
    /// they will never reach — the mechanism itself is unchanged, only the clock is.
    /// The real three seconds is covered by `ChromeAutoHideUITests`, which passes a
    /// short one.
    static var terminalChromeIdleSeconds: TimeInterval {
        let override = UserDefaults.standard.double(forKey: "SynapseChromeIdleSeconds")
        return override > 0 ? override : 3
    }

    // MARK: - Git

    /// 一个 Git 动作等电脑回答的上限。
    ///
    /// 两档，因为电脑那一侧本来就有两档：本地命令 60 秒，远端命令 120 秒
    /// （`TERMINAL_GIT_REMOTE_TIMEOUT_MS`）。手机这一档总比它长一点 —— 先到点的那一方
    /// 说的话才算数，而**电脑**才拿得到 git 的原文；手机先放弃，只会把一次其实还在跑的
    /// 推送说成「电脑没有回答」。
    static let gitLocalTimeout: TimeInterval = 65
    static let gitRemoteTimeout: TimeInterval = 130

    // MARK: - File hand-off

    /// Mirrors `MOBILE_FRAME_LIMITS.maxRelayedFileBytes` in
    /// `shared/src/mobile-live.ts`. The server refuses a larger upload and the
    /// desktop refuses a larger download, so refusing here as well is what lets the
    /// user be told why while they are still picking, instead of after a long
    /// upload that was never going to be accepted.
    static let relayMaxFileBytes = 100 * 1024 * 1024

    /// How long the camera lets a recording run before it stops on its own.
    ///
    /// Derived from `relayMaxFileBytes` rather than chosen, because the two are the
    /// same limit seen from two sides: recording past what the relay carries only
    /// produces a file that will be refused. The divisor is a generous H.264 1080p
    /// bitrate — real recordings land under it, so the camera stops a little short
    /// of the ceiling instead of a little past it.
    static let relayCameraVideoSeconds: TimeInterval =
        TimeInterval(relayMaxFileBytes / (2 * 1024 * 1024))

    /// One selection. The whole batch is uploaded to the same place and named in
    /// the same terminal, so a larger one is a burst of typing rather than a
    /// feature.
    static let relayMaxFileCount = 9

    /// How long an uploaded file waits for the computer before the phone gives up
    /// and removes it from the drive.
    ///
    /// The drive has no expiry of its own — nothing on the server reclaims a
    /// relayed copy — so this is the only thing that keeps an undelivered file from
    /// sitting in the user's drive forever. It is deliberately long: while the copy
    /// exists the transfer is still recoverable, and the computer coming back three
    /// days later is worth more than the storage.
    static let relayPendingExpiry: TimeInterval = 72 * 60 * 60
}
