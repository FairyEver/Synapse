import Foundation
import Testing

@testable import SynapseMobile

/// How the live socket reacts to a token it could not get.
///
/// The two failures must not share an outcome. A server that cannot be reached
/// leaves a signed-in account perfectly valid — the email is still shown, the
/// refresh token is still on disk — so the socket has to keep trying. Only a
/// refused credential is terminal. Treating the first as the second is what left
/// the app reporting an offline computer until it was relaunched by hand.
@MainActor
struct RealtimeAuthTests {
    private func makeClient(_ outcome: APIClient.LiveTokenOutcome) -> RealtimeClient {
        RealtimeClient(
            clientInstanceId: "mobile-test",
            deviceName: "test-device",
            appVersion: "0",
            tokenProvider: { outcome }
        )
    }

    private func waitUntil(
        _ predicate: () -> Bool,
        timeout: TimeInterval = 3
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate() { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return predicate()
    }

    /// Unreachable is not a verdict on the credential, so the socket waits and
    /// keeps its intent to reconnect instead of stopping.
    @Test func keepsRetryingWhenTheServerCannotBeReached() async {
        let client = makeClient(.unreachable)
        client.connect()

        let enteredWaiting = await waitUntil {
            if case .waiting = client.state { return true }
            return false
        }

        #expect(enteredWaiting, "state was \(client.state)")
        client.disconnect()
    }

    /// A refused credential is terminal: retrying would only repeat the refusal.
    @Test func stopsWhenTheCredentialIsGone() async {
        let client = makeClient(.unauthenticated)
        client.connect()

        let stopped = await waitUntil { client.state == .unauthenticated }

        #expect(stopped, "state was \(client.state)")
        client.disconnect()
    }
}
