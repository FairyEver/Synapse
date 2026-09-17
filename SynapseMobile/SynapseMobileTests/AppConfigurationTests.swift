import Foundation
import Testing

@testable import SynapseMobile

/// What address the app ends up talking to.
///
/// The override is normally a launch argument, and whatever hands it over can fold
/// the separator: `XCUIApplication` normalises the paths in its launch arguments, so
/// `http://host` arrives as `http:/host`. `URL` accepts that, so the app kept going —
/// but with no host, which every request but the live socket tolerates. These pin
/// both halves: the folded form is read as the address it was meant to be, and
/// anything already correct comes back untouched.
@MainActor
struct AppConfigurationTests {
    /// Runs `body` with the override set, and puts the real one back afterwards —
    /// this is the app's own defaults, so a test that leaked would point every later
    /// one at a server that is not there.
    private func withBaseURL<T>(_ value: String, _ body: () throws -> T) rethrows -> T {
        let previous = AppConfiguration.apiBaseURLString
        defer { AppConfiguration.apiBaseURLString = previous }
        AppConfiguration.apiBaseURLString = value
        return try body()
    }

    @Test func readsAnAddressThatWasWrittenOutInFull() {
        withBaseURL("http://127.0.0.1:3001/api") {
            #expect(AppConfiguration.apiBaseURL.absoluteString == "http://127.0.0.1:3001/api")
            #expect(AppConfiguration.liveMobileURL.absoluteString == "ws://127.0.0.1:3001/api/live/mobile")
        }
    }

    /// The one that was costing a blank terminal: same address, separator folded.
    @Test func readsAnAddressWhoseSeparatorWasFoldedIntoOneSlash() {
        withBaseURL("http:/127.0.0.1:3001/api") {
            #expect(AppConfiguration.apiBaseURL.absoluteString == "http://127.0.0.1:3001/api")
            // The socket is where it showed: a URL with no host is refused here and
            // only here, which is why the symptom was a terminal and not a failure to
            // sign in.
            #expect(AppConfiguration.liveMobileURL.absoluteString == "ws://127.0.0.1:3001/api/live/mobile")
        }
    }

    /// A secured server, so the repair cannot be a plain string splice that ignores
    /// the scheme — `wss` is what an `https` address has to become.
    @Test func keepsTheSchemeWhenRepairing() {
        withBaseURL("https:/synapse.example.com/api") {
            #expect(AppConfiguration.apiBaseURL.absoluteString == "https://synapse.example.com/api")
            #expect(AppConfiguration.liveMobileURL.absoluteString == "wss://synapse.example.com/api/live/mobile")
        }
    }

    /// Nothing usable is still not an address, and the default is what an unusable
    /// override has always fallen back to.
    @Test func fallsBackToTheHostedServerForSomethingUnusable() {
        for unusable in ["", "not a url at all", "/just/a/path"] {
            withBaseURL(unusable) {
                #expect(
                    AppConfiguration.apiBaseURL.absoluteString == AppConfiguration.defaultAPIBaseURL,
                    "\(unusable.isEmpty ? "(empty)" : unusable) was accepted as an address"
                )
            }
        }
    }

    /// No override at all, which is every installed build.
    @Test func usesTheHostedServerWhenNothingWasSet() {
        withBaseURL("") {
            #expect(AppConfiguration.apiBaseURL.absoluteString == AppConfiguration.defaultAPIBaseURL)
        }
    }
}
