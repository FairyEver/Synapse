import Foundation
import Testing

@testable import SynapseMobile

/// 这份日志是要发出去的，所以"哪些东西绝对不能出现在文件里"必须有测试守着。
///
/// 用假 canary 而不是真凭据：用例自己也不该带着任何真实秘密。canary 的取值刻意
/// 带 `canary` 字样，万一哪条断言失败，日志里一眼能看出是测试洒的数据而不是真的泄漏。
///
/// 规则来自 `desktop/electron/services/log-store.ts` 的 `redactLogText`，两边必须
/// 逐条对齐 —— 脱敏规则散成几套是这类机制最常见的失效方式。
struct DiagnosticRedactionTests {
    private let redactor = DiagnosticRedactor()

    // MARK: - 逐条规则

    @Test func anAuthorizationHeaderLosesItsValue() {
        let out = redactor.redact("authorization: Bearer canary-token-abc123")
        #expect(!out.contains("canary-token-abc123"))
        #expect(out.contains("[redacted]"))
    }

    @Test func aliveBearerTokenIsReplacedWhereverItStands() {
        let out = redactor.redact("sent with Bearer canary-bearer-xyz")
        #expect(out == "sent with Bearer [redacted]")
    }

    @Test func anAssignedSecretLosesItsValue() {
        for line in [
            "token=canary-assigned-1",
            "api_key: canary-assigned-2",
            "password=\"canary-assigned-3\"",
            "secret='canary-assigned-4'",
            "credential: canary-assigned-5",
        ] {
            let out = redactor.redact(line)
            #expect(!out.contains("canary-assigned"), "「\(line)」里的值没被吃掉")
            #expect(out.contains("[redacted]"))
        }
    }

    @Test func platformTokensAreReplaced() {
        for token in ["ghp_canarycanary", "github_pat_canarycanary", "glpat-canarycanary", "sk-canarycanary"] {
            let out = redactor.redact("used \(token) here")
            #expect(!out.contains(token), "\(token) 没被吃掉")
        }
    }

    /// 反例：普通路径**必须保留**。
    ///
    /// 排障要看的正是"哪个目录、哪个文件"。把路径一起脱掉，这份日志就只剩下
    /// "出过事"这三个字，而 ADR 0114 那套禁止路径的规则管的是问题反馈，不是日志。
    @Test func ordinaryPathsAreLeftAlone() {
        let path = "/Users/someone/projects/app/Sources/main.swift"
        #expect(redactor.redact(path) == path)
    }

    // MARK: - 整条记录上的 canary 回归

    /// 一条到处都塞了 canary 的记录，渲染出来不许有一个字漏出来。
    ///
    /// 这条比上面那些逐规则的更接近真实失效方式：真正的泄漏往往不是某条规则写错，
    /// 而是**某个字段绕过了脱敏**。
    @Test func aRecordFullOfCanariesRendersClean() {
        let canary = "canary-leak-4f9a2b"
        let record = DiagnosticRecord(
            seq: 7,
            time: Date(timeIntervalSince1970: 0),
            level: .error,
            event: .networkError,
            fields: [
                .init(.reason, .message(RedactedMessage(redacting: "GET /x Bearer \(canary)"))),
                .init(.status, .int(401)),
                .init(.stack, .stack(RedactedStack(redacting: "frame Authorization: Bearer \(canary)"))),
                .init(
                    .lastEvent,
                    .message(RedactedMessage(redacting: "token=\(canary)"))
                ),
            ]
        )
        let line = DiagnosticLineRenderer.render(record)
        #expect(!line.contains(canary))
        #expect(line.contains("[redacted]"))
    }

    /// 上限是按字节卡的，不是按字符。
    ///
    /// 一个汉字三字节：按字符截会让中文日志比英文大三倍，"上限"也就不成其为上限。
    @Test func clampingCountsBytesNotCharacters() {
        let message = RedactedMessage(alreadyRedacted: String(repeating: "汉", count: 300))
        #expect(message.text.utf8.count <= RedactedMessage.maxBytes + DiagnosticTruncation.marker.utf8.count)
        #expect(message.text.hasSuffix(DiagnosticTruncation.marker))
    }

    // MARK: - 别名

    @Test func theSameIdentifierAlwaysGetsTheSameAlias() {
        let aliases = DiagnosticAliases()
        let first = aliases.alias(for: .session, id: "sess-abc")
        let second = aliases.alias(for: .session, id: "sess-abc")
        let other = aliases.alias(for: .session, id: "sess-def")
        #expect(first == second)
        #expect(first != other)
    }

    /// 别名不是 id 的哈希 —— 同一个 id 换个进程拿到的还是 `s1`，
    /// 而哈希式的伪匿名会让人误以为它跨文件可比。
    @Test func aliasesAreNumberedFromOnePerKind() {
        let aliases = DiagnosticAliases()
        #expect(aliases.alias(for: .session, id: "a").text == "s1")
        #expect(aliases.alias(for: .desktop, id: "a").text == "d1")
        #expect(aliases.alias(for: .session, id: "b").text == "s2")
    }

    @Test func resettingForgetsEveryAlias() {
        let aliases = DiagnosticAliases()
        _ = aliases.alias(for: .session, id: "a")
        aliases.reset()
        #expect(aliases.alias(for: .session, id: "a").text == "s1")
    }
}
