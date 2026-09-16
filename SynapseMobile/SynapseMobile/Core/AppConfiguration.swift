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
}
