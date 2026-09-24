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

    @Test func historyAndSessionsStaySeparate() throws {
        let first = TerminalStore()
        let second = TerminalStore()
        first.apply(frame([try line("https://history.example.org/x")], kind: "history"))
        #expect(first.resources.count == 1)
        #expect(second.resources.isEmpty)
    }

    @Test func responseUsesHeadersRatherThanURLSuffix() {
        let decide = TerminalResourceResponsePolicy.decide
        #expect(decide("text/html", nil, true) == .show(.webpage))
        #expect(decide("image/png", "inline; filename=a.png", true) == .show(.image))
        #expect(decide("image/png", "attachment; filename=a", true) == .download(.image))
        #expect(decide("application/pdf", nil, true) == .show(.file))
        #expect(decide("application/octet-stream", nil, false) == .download(.file))
    }
}
