import Foundation
import Testing

@testable import SynapseMobile

@MainActor
struct TerminalResourcesTests {
    /// A share id is only recognised as one on **the configured server**
    /// (`SynapseWebLink.isTrusted`), and that base URL is a value in the shared
    /// `UserDefaults`: another suite swaps it for an unreachable address, and a run that
    /// does not get to put it back leaves the value in the container. A test about share
    /// links pins it for the length of a few calls and puts it back at once, so the
    /// window never lands on what another suite is doing.
    private func withHostedOrigin<T>(_ body: () throws -> T) rethrows -> T {
        let previous = AppConfiguration.apiBaseURLString
        defer { AppConfiguration.apiBaseURLString = previous }
        AppConfiguration.apiBaseURLString = AppConfiguration.defaultAPIBaseURL
        return try body()
    }

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

    @Test func removesAProvisionalLinkWhenItsTerminalRowIsRewritten() throws {
        let store = TerminalStore()
        store.apply(frame([try line("https://example.org/draft")], kind: "reset"))
        store.apply(frame([try line("https://example.org/final")]))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/final"])

        store.apply(frame([try line("已提交")]))
        #expect(store.resources.isEmpty)
    }

    @Test func keepsALinkSeenElsewhereWhenOneCopyIsRewritten() throws {
        let store = TerminalStore()
        let link = try line("https://example.org/shared")
        store.apply(frame([link, link], kind: "reset"))
        store.apply(frame([try line("已处理")], from: 1, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/shared"])
    }

    @Test func stopsBeforeChineseProseAfterALink() throws {
        let store = TerminalStore()
        let url = "https://synapse.d2.pub/share/shr_XEHW8REMAG3QR4SYFATZ3CW0JEBAGTZV"
        store.apply(frame([try line("站内信网页方案（\(url)），原分享链接不变。")], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == [url])
    }

    @Test func stopsBeforeChineseProseAfterAWrappedLink() throws {
        let store = TerminalStore()
        let url = "https://synapse.d2.pub/share/shr_XEHW8REMAG3QR4SYFATZ3CW0JEBAGTZV"
        store.apply(frame([
            try line("站内信网页方案（https://synapse.d2.pub/share/shr_XEHW8REMAG3QR4SYF", wrapFlags: 2),
            try line("ATZ3CW0JEBAGTZV），原分享链接不变。", wrapFlags: 1),
        ], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == [url])
        #expect(store.resources.first?.needsConfirmation == false)
    }

    @Test func keepsChineseCharactersInsideARealURLPath() throws {
        let store = TerminalStore()
        store.apply(frame([try line("文档 https://example.org/路径），继续说明")], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/%E8%B7%AF%E5%BE%84"])
    }

    @Test func keepsBalancedParenthesesInAURLPath() throws {
        let store = TerminalStore()
        store.apply(frame([try line("见 https://en.wikipedia.org/wiki/Function_(mathematics) 详情")], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://en.wikipedia.org/wiki/Function_(mathematics)",
        ])
    }

    @Test func removesOnlyTheOuterClosingParenthesis() throws {
        let store = TerminalStore()
        store.apply(frame([try line("见 (https://example.org/a_(b)) 详情")], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/a_(b)"])
    }

    @Test func waitsForSoftWrappedContinuationAcrossFrames() throws {
        let store = TerminalStore()
        store.apply(frame([try line("https://example.org/very/", wrapFlags: 2)], kind: "reset", total: 2))
        #expect(store.resources.isEmpty)
        store.apply(frame([try line("long-path?x=1#part", wrapFlags: 1)], from: 1, total: 2))
        #expect(store.resources.map(\.url.absoluteString) == ["https://example.org/very/long-path?x=1#part"])
        #expect(store.resources.first?.needsConfirmation == false)
    }

    // MARK: - Hard wraps (Claude Code's own wrapping, which the desktop cannot flag)

    /// The TUI wraps its own text and indents the continuation, so the row it cuts a
    /// long URL in is an ordinary line as far as the terminal is concerned. It is
    /// recognised by shape instead: the cut row is filled to the grid's last column,
    /// and the row below opens with the hanging indent and the rest of the URL.
    @Test func joinsAURLTheTUIBrokeMidToken() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        try withHostedOrigin {
            store.apply(frame([try line("  https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqR")], kind: "reset", total: 2))
        }
        // Half a URL is not a link. It waits rather than offering one that 404s.
        #expect(store.resources.isEmpty)

        try withHostedOrigin {
            store.apply(frame([try line("  ZedD2W6_c33jYd")], from: 1, total: 2))
        }
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqRZedD2W6_c33jYd",
        ])
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [
            "https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqRZedD2W6_c33jYd",
        ])
        #expect(store.resources.first?.needsConfirmation == true)
    }

    @Test func replacesAnEarlierTruncatedShareWithTheCompleteLink() throws {
        let store = TerminalStore()
        let prefix = "https://synapse.d2.pub/share/shr_ZYTGDZKX1C4Q9SYS7F"
        let complete = prefix + "BW4YQ1403XWEVT"
        try withHostedOrigin {
            store.apply(frame([try line(prefix)], kind: "reset"))
        }
        #expect(store.resources.map(\.url.absoluteString) == [prefix])

        try withHostedOrigin {
            store.apply(frame([try line(complete)], from: 1))
        }
        #expect(store.resources.map(\.url.absoluteString) == [complete])

        try withHostedOrigin {
            store.apply(frame([try line(prefix)], from: 2))
        }
        #expect(store.resources.map(\.url.absoluteString) == [complete])
    }

    @Test func hardWrappedLinkDoesNotIncludeFollowingChineseProse() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        store.apply(frame([
            try line("  https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqR"),
            try line("  ZedD2W6_c33jYd），原分享链接不变。"),
        ], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqRZedD2W6_c33jYd",
        ])
    }

    @Test func marksAnEnglishSentenceAfterAFullURLAsAmbiguous() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        let url = "https://example.org/" + String(repeating: "a", count: 31)
        store.apply(frame([
            try line("  \(url)"),
            try line("  README updated"),
        ], kind: "reset"))
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [url + "README", url])
        #expect(store.resources.first?.needsConfirmation == true)
    }

    @Test func marksAUnicodeContinuationAsAmbiguous() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        let prefix = "https://example.org/" + String(repeating: "a", count: 31)
        store.apply(frame([
            try line("  \(prefix)"),
            try line("  路径"),
        ], kind: "reset"))
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [
            prefix + "%E8%B7%AF%E5%BE%84", prefix,
        ])
    }

    @Test func requiresConfirmationEvenWhenOnlyTheJoinedURLIsUsable() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        let prefix = "http://127.0.0.1"
        let joined = "http://127.0.0.1example.org"
        store.apply(frame([
            try line(String(repeating: "x", count: 36) + " " + prefix),
            try line("  example.org"),
        ], kind: "reset"))
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [joined])
        #expect(store.resources.first?.needsConfirmation == true)
    }

    @Test func aURLAtTheGridEdgeNeedsConfirmationWithoutARecognizedContinuation() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        let url = "https://example.org/" + String(repeating: "a", count: 31)
        store.apply(frame([
            try line("  \(url)"),
            try line("下一行没有悬挂缩进"),
        ], kind: "reset"))
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [url])
        #expect(store.resources.first?.needsConfirmation == true)
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

    /// A full row followed by Chinese prose looks the same as a Unicode URL tail.
    /// Neither interpretation may be opened as certain.
    @Test func marksAFullURLFollowedByChineseProseAsAmbiguous() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        let prefix = "https://example.org/" + String(repeating: "a", count: 31)
        store.apply(frame([try line("  \(prefix)")], kind: "reset", total: 2))
        #expect(store.resources.isEmpty)

        store.apply(frame([try line("  后续说明继续写下去")], from: 1, total: 2))
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [
            prefix + "后续说明继续写下去".addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!,
            prefix,
        ])
        #expect(store.resources.first?.needsConfirmation == true)
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
        #expect(store.resources.first?.candidateURLs.map(\.absoluteString) == [
            "https://example.org/" + String(repeating: "a", count: 31) + String(repeating: "b", count: 51) + "cccc",
            "https://example.org/" + String(repeating: "a", count: 31),
            "https://example.org/" + String(repeating: "a", count: 31) + String(repeating: "b", count: 51),
        ])
    }

    // MARK: - Addresses only the desktop can reach

    /// A dev server announces itself as `http://localhost:5173` and the API beside it as
    /// `http://127.0.0.1:3000`. On the phone those are the phone: the row would look
    /// exactly like a resource and never open, so it is not offered at all.
    @Test func leavesOutHostsOnlyTheDesktopCanReach() throws {
        let store = TerminalStore()
        store.apply(frame([
            try line("本地 http://127.0.0.1:8787/__reset"),
            try line("开发 http://localhost:5173/ 和 http://0.0.0.0:3000/"),
            try line("回环 http://127.0.0.2:8080/x http://[::1]:9090/y"),
        ], kind: "reset"))
        #expect(store.resources.isEmpty)
    }

    /// The same addresses in the spellings Foundation hands back for a bracketed host,
    /// and the subdomain form people use to keep several local sites apart.
    @Test func leavesOutLocalHostsInTheirOtherSpellings() throws {
        let store = TerminalStore()
        store.apply(frame([
            try line("http://[::ffff:127.0.0.1]:8787/__reset http://app.localhost:3000/x"),
        ], kind: "reset"))
        #expect(store.resources.isEmpty)
    }

    /// Skipping them must not cost a real link on the same screen.
    @Test func stillCollectsTheReachableLinkBesideALocalOne() throws {
        let store = TerminalStore()
        store.apply(frame([
            try line("本地 http://127.0.0.1:8787/__reset"),
            try line("分享 https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqR"),
            try line("本地 http://localhost:8787/__reset"),
        ], kind: "reset"))
        #expect(store.resources.map(\.url.absoluteString) == [
            "https://synapse.d2.pub/share/shr_xXoqbu0wbONgYNvuqR",
        ])
    }

    /// A local address the TUI cut in half is put back together before it is judged, so
    /// neither half reaches the list as a broken link of its own.
    @Test func joinsALocalAddressBeforeLeavingItOut() throws {
        let store = TerminalStore()
        store.update(columns: 53)
        store.apply(frame([try line("  http://127.0.0.1:8787/" + String(repeating: "a", count: 29))], kind: "reset", total: 2))
        #expect(store.resources.isEmpty)
        store.apply(frame([try line("  bbbbcccc")], from: 1, total: 2))
        #expect(store.resources.isEmpty)
    }

    @Test func historyAndSessionsStaySeparate() throws {
        let first = TerminalStore()
        let second = TerminalStore()
        first.apply(frame([try line("https://history.example.org/x")], kind: "history"))
        #expect(first.resources.count == 1)
        #expect(second.resources.isEmpty)
    }

}
