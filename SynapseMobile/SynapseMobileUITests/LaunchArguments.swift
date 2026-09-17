import XCTest

extension XCUIApplication {
    /// Points the app at `baseURL` before it launches.
    ///
    /// One `-key=value` argument rather than the `-key value` pair the rest of the
    /// world uses, and that is the whole point of this helper. `XCUIApplication` puts
    /// its launch arguments through a path normalisation that collapses `//`, so a
    /// `http://host` sent as an argument of its own arrives as `http:/host`. The REST
    /// calls still resolve — Foundation reads the authority out of the path — which is
    /// what makes this so hard to spot: sign-in works, the session list fills, the
    /// toolbar mirrors the computer. Only the WebSocket fails, with a `bad URL` deep
    /// in the CFNetwork log, so the terminal is blank and every walkthrough here reads
    /// as a rendering bug rather than as a misconfigured address. The joined form is
    /// left alone by that pass.
    func pointAtServer(_ baseURL: String) {
        launchArguments = ["-SynapseAPIBaseURL=\(baseURL)"]
    }
}
