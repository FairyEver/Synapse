import Testing
@testable import SynapseMobile

/// A row is three lines tall whether or not its terminal has anything to say.
/// These pin both halves of that: a line the terminal did produce arrives
/// unchanged, and a session with nothing readable still gets the line's height.
struct SessionRowLineTests {

    @Test func showsTheTerminalsLastLineUnchanged() {
        let line = "Tab to switch questions · Esc to cancel"

        #expect(session(lastLine: line).rowLastLine == line)
    }

    /// Not an empty string: the row would fall back to two lines, and the list
    /// would jump by a line every time a session's screen goes quiet — which is
    /// exactly what the line is there to stop.
    @Test func reservesTheLineWhenTheTerminalHasNothingReadable() {
        #expect(!session(lastLine: "").rowLastLine.isEmpty)
    }

    private func session(lastLine: String) -> MobileSummarySession {
        MobileSummarySession(
            id: "s1",
            groupId: "g1",
            title: "终端",
            status: "running",
            attention: MobileSummaryAttention(state: "not_waiting", kind: "unknown"),
            cwd: "/tmp",
            cols: 80,
            rows: 24,
            startedAt: "2026-01-01T00:00:00.000Z",
            lastLine: lastLine,
            lastOutputSeq: 0,
            gridOwnerId: nil,
        )
    }
}
