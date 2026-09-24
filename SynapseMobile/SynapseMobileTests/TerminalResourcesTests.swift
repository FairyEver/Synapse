import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalResourcesTests {
    private func line(_ text: String, wrapFlags: Int = 0) throws -> TerminalLine {
        let value: [Any] = wrapFlags == 0 ? [text, []] : [text, [], wrapFlags]
        return try JSONDecoder().decode(TerminalLine.self, from: JSONSerialization.data(withJSONObject: value))
    }

    private func frame(
        _ lines: [TerminalLine],
        kind: String = "suffix",
        from: Int = 0,
        total: Int? = nil
    ) -> MobileTerminalFrame {
        MobileTerminalFrame(
            sessionId: "session",
            kind: kind,
            from: from,
            lines: lines,
            total: total ?? from + lines.count,
            cursor: .hidden,
            alt: false,
            truncated: false,
            seq: 1,
            sizeRevision: 1
        )
    }

    @Test func detectsHTTPAndHTTPSOnceDespiteRewrite() throws {
        let store = TerminalStore()
        let output = try line("文档 https://example.org/a?x=1#part。 旧站 http://old.example.org/b,")
        store.apply(frame([output], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == [
            "http://old.example.org/b", "https://example.org/a?x=1#part",
        ])
        store.apply(frame([output]))
        #expect(store.resources.count == 2)
        store.apply(frame([try line("已清屏")], kind: "reset"))
        #expect(store.resources.count == 2)
    }

    @Test func waitsForSoftWrappedContinuationAcrossFrames() throws {
        let store = TerminalStore()
        store.apply(frame([try line("https://example.org/very/", wrapFlags: 2)], kind: "reset", total: 2))
        #expect(store.resources.isEmpty)
        store.apply(frame([try line("long-path?x=1#part", wrapFlags: 1)], from: 1, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/very/long-path?x=1#part"])
    }

    // MARK: - Hard wraps (Claude Code's own wrapping, which the desktop cannot flag)

    /// The TUI wraps its own text and indents the continuation, so the row it cuts a
    /// long URL in is an ordinary line as far as the terminal is concerned. It is
    /// recognised by shape instead: the cut row is filled to the grid's last column,
    /// and the row below opens with the hanging indent and the rest of the URL.
    @Test func joinsAURLTheTUIBrokeMidToken() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        store.apply(frame([try line("  https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqR")], kind: "reset", total: 2))
        // Half a URL is not a link. It waits rather than offering one that 404s.
        #expect(store.resources.isEmpty)

        store.apply(frame([try line("  ZedD2W6_c33jYd")], from: 1, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqRZedD2W6_c33jYd",
        ])
    }

    /// The same pair in the other order. The second row is what arrives second in
    /// practice, and finding the first one from it is the same walk backwards.
    @Test func joinsAURLWhoseHeadArrivesAfterItsTail() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        store.apply(frame([try line("  ZedD2W6_c33jYd")], kind: "reset", from: 1, total: 2))
        #expect(store.resources.isEmpty)

        store.apply(frame([try line("  https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqR")], from: 0, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqRZedD2W6_c33jYd",
        ])
    }

    /// A URL the TUI broke at a space rather than inside the token is complete where it
    /// stands. The row is ragged, which is what tells the two apart.
    @Test func leavesAURLTheTUIEndedAtASpaceAlone() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        store.apply(frame([try line("  说明 https://example.org/a")], kind: "reset", total: 2))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/a"])

        store.apply(frame([try line("  第二行接着写")], from: 1, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/a"])
    }

    /// A URL at the end of a row that happens to be full is the one ambiguous case.
    /// Waiting for the row below must not lose it when that row turns out not to
    /// continue it: prose is not a URL tail, so the link is collected on its own.
    @Test func stillCollectsAURLThatRunsToTheEndOfAFullRow() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        store.apply(frame([try line("  https://example.org/" + String(repeating: "a", count: 31))], kind: "reset", total: 2))
        #expect(store.resources.isEmpty)

        store.apply(frame([try line("  后续说明继续写下去")], from: 1, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://example.org/" + String(repeating: "a", count: 31),
        ])
    }

    /// A cut that spans more than two rows. The middle row is URL text with no scheme
    /// in it, so nothing on that row looks like a URL — only the shape carries.
    @Test func joinsAHardWrapThatSpansThreeRows() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        let head = try line("  https://example.org/" + String(repeating: "a", count: 31))
        let middle = try line("  " + String(repeating: "b", count: 51))
        store.apply(frame([head], kind: "reset", total: 3))
        store.apply(frame([middle], from: 1, total: 3))
        #expect(store.resources.isEmpty)

        store.apply(frame([try line("  cccc")], from: 2, total: 3))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://example.org/" + String(repeating: "a", count: 31) + String(repeating: "b", count: 51) + "cccc",
        ])
    }

    @Test func historyAndSessionsStaySeparate() throws {
        let first = TerminalStore()
        let second = TerminalStore()
        first.apply(frame([try line("https://history.example.org/x")], kind: "history"))
        #expect(first.resources.count == 1)
        #expect(second.resources.isEmpty)
    }

}
