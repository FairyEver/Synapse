import Foundation
import Testing
@testable import SynapseMobile

/// Being unable to reach the server is not the same as being signed out.
///
/// The refresh token lives in the Keychain and survives restarts. When a refresh
/// fails because the server could not be reached, the session has to be kept and
/// the failure has to read as a network problem. Collapsing that into "not signed
/// in" shows the login screen to someone whose credentials are perfectly good, and
/// hides the only thing that explains it — which is how a server restarting looks
/// like a lost account.
final class SessionRestoreTests {

    @Test func keepsTheSessionWhenTheRefreshCannotReachTheServer() async {
        // A service of its own: Swift Testing runs tests in parallel, and sharing
        // one would let the other test's cleanup delete this test's token.
        let store = TokenStore(service: "com.liy.SynapseMobile.tests.restore.unreachable")
        store.clearCredentials()
        store.refreshToken = "stored-refresh-token"

        let previousBaseURL = AppConfiguration.apiBaseURLString
        // A port nothing listens on. Loopback is always routable, so the connection
        // is refused rather than queued behind `waitsForConnectivity`.
        AppConfiguration.apiBaseURLString = "http://127.0.0.1:9/api"
        defer {
            AppConfiguration.apiBaseURLString = previousBaseURL
            store.clearCredentials()
        }

        let client = APIClient(tokens: store, onCredentialsChanged: {})
        let outcome = await client.restoreSession()

        #expect(outcome == .unreachable, "an unreachable server must not read as a lost session")
        #expect(store.refreshToken != nil, "the stored credential must survive a refresh that could not run")
    }

    @Test func reportsNoCredentialsWhenNothingIsStored() async {
        let store = TokenStore(service: "com.liy.SynapseMobile.tests.restore.empty")
        store.clearCredentials()

        let client = APIClient(tokens: store, onCredentialsChanged: {})
        let outcome = await client.restoreSession()

        #expect(outcome == .noCredentials, "an empty keychain is the one case that really is signed out")
    }
}
