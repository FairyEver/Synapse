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
        if let url = URL(string: raw) { return url }
        return URL(string: defaultAPIBaseURL)!
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

    /// Kept above the phone server's 45s stale threshold; the desktop uses 20s.
    static let heartbeatInterval: TimeInterval = 20
    static let requestTimeout: TimeInterval = 20

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

    // MARK: - File hand-off

    /// Mirrors `MOBILE_FRAME_LIMITS.maxRelayedFileBytes` in
    /// `shared/src/mobile-live.ts`. The server refuses a larger upload and the
    /// desktop refuses a larger download, so refusing here as well is what lets the
    /// user be told why while they are still picking, instead of after a long
    /// upload that was never going to be accepted.
    static let relayMaxFileBytes = 100 * 1024 * 1024

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
