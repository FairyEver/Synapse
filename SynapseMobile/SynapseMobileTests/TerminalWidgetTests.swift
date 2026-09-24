import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalWidgetTests {
    @Test func linkRoundTripsSessionIdentifiers() {
        let link = TerminalWidgetLink.url(desktopId: "desktop/中文", sessionId: "session?2&3")

        #expect(link != nil)
        #expect(link.flatMap(TerminalWidgetLink.target(from:)) == .init(
            desktopId: "desktop/中文",
            sessionId: "session?2&3"
        ))
    }

    @Test func linkRejectsSessionWithoutDesktopAndOtherHosts() {
        #expect(TerminalWidgetLink.target(from: URL(string: "synapse://terminal?session=one")!) == nil)
        #expect(TerminalWidgetLink.target(from: URL(string: "synapse://recording")!) == nil)
        #expect(TerminalWidgetLink.target(from: URL(string: "https://terminal")!) == nil)
    }

    @Test func configuredSessionBelongsToItsDesktop() {
        let session = TerminalWidgetSession(
            id: "one", title: "Build", status: "running", attentionState: "none",
            attentionKind: "none", cwd: "/repo", lastLine: "ready"
        )
        let snapshot = TerminalWidgetSnapshot(
            capturedAt: .now, desktopId: "desktop-a", desktopName: "Mac",
            isOnline: true, sessions: [session]
        )
        let selected = TerminalWidgetSessionEntity(
            id: TerminalWidgetSessionEntity.id(desktopId: "desktop-a", sessionId: "one"),
            title: "Build"
        )
        let otherDesktop = TerminalWidgetSessionEntity(
            id: TerminalWidgetSessionEntity.id(desktopId: "desktop-b", sessionId: "one"),
            title: "Build"
        )

        #expect(snapshot.session(for: selected) == session)
        #expect(snapshot.session(for: otherDesktop) == nil)
    }
}
