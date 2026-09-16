import Foundation
import Testing
@testable import SynapseMobile

/// The websocket hands its token straight to a handshake that cannot retry it, so
/// reading `exp` correctly is what decides whether the socket can recover from an
/// expired session on its own.
struct TokenExpiryTests {

    @Test func readsTheExpiryClaim() {
        let expiry = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(APIClient.expiry(of: makeToken(exp: 1_800_000_000)) == expiry)
    }

    @Test func keepsSubSecondPrecision() {
        #expect(APIClient.expiry(of: makeToken(exp: 1_800_000_000.5))
            == Date(timeIntervalSince1970: 1_800_000_000.5))
    }

    /// JWT segments are base64url and unpadded, which `Data` rejects as-is. Picking
    /// a payload length that is not a multiple of three forces real padding work
    /// rather than accidentally decoding only because the length happened to fit.
    @Test func decodesUnpaddedBase64URLSegments() {
        let token = makeToken(exp: 1_800_000_000)
        #expect(token.split(separator: ".")[1].contains("=") == false)
        #expect(APIClient.expiry(of: token) != nil)
    }

    /// Anything unreadable must report "unknown" rather than "expired": guessing
    /// expired would refresh on every reconnect, and guessing valid would leave the
    /// socket stuck with a token the server rejects.
    @Test func reportsUnknownForTokensItCannotRead() {
        #expect(APIClient.expiry(of: "not-a-jwt") == nil)
        #expect(APIClient.expiry(of: "header.payload") == nil)
        #expect(APIClient.expiry(of: "!!!!.!!!!.!!!!") == nil)
        #expect(APIClient.expiry(of: "\(segment(#"{"alg":"HS256"}"#)).\(segment(#"{"sub":"u1"}"#)).sig") == nil)
    }

    private func makeToken(exp: Double) -> String {
        "\(segment(#"{"alg":"HS256","typ":"JWT"}"#)).\(segment(#"{"sub":"u1","exp":\#(exp)}"#)).signature"
    }

    private func segment(_ json: String) -> String {
        Data(json.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
