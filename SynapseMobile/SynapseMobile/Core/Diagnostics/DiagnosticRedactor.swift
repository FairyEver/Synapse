import Foundation

/// 自由文本的脱敏规则。
///
/// 与 `desktop/electron/services/log-store.ts` 的 `redactLogText` **逐条对应、逐字同输出** ——
/// 包括 `[redacted]` / `[key]` 这两个记号。这一点是刻意的：脱敏规则散成几套是这类机制
/// 最常见的失效方式（安全规则里明确写了"不得在各处各写一套正则"），而 iOS 是 Swift、
/// 桌面是 TS，物理上没法共享代码。于是共享的是**语料**：测试读同一份
/// `shared/fixtures/redaction-corpus.json`，任何一侧改了规则但没改另一边，那一侧就红。
///
/// 因此这个文件里**不许**加只有手机端有的规则。手机端独有的敏感值（比如已签名的
/// ASR 地址）不走正则，而是在调用点直接记成 `.redacted(.url)` —— 显式、可读、不会
/// 让两边的语料对不上。
nonisolated struct DiagnosticRedactor: Sendable {
    static let shared = DiagnosticRedactor()

    /// 与桌面端一致的替换记号。
    static let redactedValue = "[redacted]"
    static let redactedKey = "[key]"

    private let rules: [Rule]

    init() {
        rules = Self.defaultRules
    }

    /// 给测试用：只跑给定规则。
    init(rules: [Rule]) {
        self.rules = rules
    }

    /// 一条正则替换。
    struct Rule: Sendable {
        let pattern: NSRegularExpression
        /// 替换模板。`$1$2` 引用捕获组，其余按字面量替换。
        let template: String
        /// 跑正则之前先做的廉价筛查。正则很贵，而绝大多数日志文本一个敏感词都没有。
        let triggers: [String]

        init(pattern: String, template: String, triggers: [String]) {
            // 规则是编译期常量，写错了就是程序错误，不该在运行时静默降级成"不脱敏"。
            self.pattern = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            self.template = template
            self.triggers = triggers
        }

        func apply(to value: String, in mutable: NSMutableString) {
            guard triggers.contains(where: { value.range(of: $0, options: .caseInsensitive) != nil })
            else { return }
            let range = NSRange(location: 0, length: mutable.length)
            pattern.replaceMatches(in: mutable, options: [], range: range, withTemplate: template)
        }
    }

    /// 按桌面端的顺序逐条跑。
    func redact(_ value: String) -> String {
        guard !value.isEmpty else { return value }
        // 快路径：一条触发词都没有的字符串不必付正则的钱。滚动日志里绝大多数是这种。
        guard rules.contains(where: { rule in
            rule.triggers.contains { value.range(of: $0, options: .caseInsensitive) != nil }
        }) else { return value }

        let mutable = NSMutableString(string: value)
        for rule in rules {
            rule.apply(to: value, in: mutable)
        }
        return mutable as String
    }

    /// 顺序与桌面端一致，**改这里必须同步改 `log-store.ts` 并更新共享语料**。
    private static let defaultRules: [Rule] = [
        // `authorization: Bearer xyz` / `authorization=xyz` —— 整段值换成记号，键留着。
        Rule(
            pattern: "\\b(authorization)(\\s*[:=]\\s*)(?:Bearer\\s+)?[^\\s,;]+",
            template: "$1$2\(redactedValue)",
            triggers: ["authorization"]
        ),
        // `token=...` / `"api_key": "..."` —— 带引号的整值也吃掉。
        Rule(
            pattern: "\\b(session[-_]?key|sourcesessionkey|targetsessionkey|session[-_]?id"
                + "|installsessionid|token|secret|api[-_]?key|authorization|cookie|password|credential)"
                + "(\\s*[:=]\\s*)(\"[^\"]*\"|'[^']*'|[^\\s,;]+)",
            template: "$1$2\(redactedValue)",
            triggers: ["token", "secret", "key", "cookie", "password", "credential", "authorization", "session"]
        ),
        // 单独出现的 bearer。
        Rule(
            pattern: "\\bBearer\\s+[A-Za-z0-9._~+/=-]+",
            template: "Bearer \(redactedValue)",
            triggers: ["bearer"]
        ),
        // 平台凭据：前缀本身就是它被识别出来的原因。
        Rule(
            pattern: "\\b(?:github_pat_[A-Za-z0-9_]{8,}|ghp_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,})\\b",
            template: redactedKey,
            triggers: ["github_pat_", "ghp_", "glpat-"]
        ),
        Rule(
            pattern: "\\bsk-[A-Za-z0-9_-]{8,}\\b",
            template: redactedKey,
            triggers: ["sk-"]
        ),
    ]
}

/// 真实标识符 → 本地别名。
///
/// 表只在内存里，随进程消失，**不落盘、不导出** —— 导出的日志里只有 `s1`、`d1`，
/// 拿到文件的人无法反推它对应哪个会话。同一个 id 在整个进程里始终映射到同一个别名，
/// 所以一份日志内部是可以前后对照的。
nonisolated final class DiagnosticAliases: @unchecked Sendable {
    static let shared = DiagnosticAliases()

    private let lock = NSLock()
    private var numbers: [String: Int] = [:]

    /// 开一个新的序号，让不同种类各自从 1 数起（`s1` 与 `d1` 互不干扰）。
    private var counters: [DiagnosticAlias.Kind: Int] = [:]

    init() {}

    func alias(for kind: DiagnosticAlias.Kind, id: String) -> DiagnosticAlias {
        guard !id.isEmpty else { return DiagnosticAlias(kind: kind, number: 0) }
        let key = "\(kind.rawValue):\(id)"
        lock.lock()
        defer { lock.unlock() }
        if let existing = numbers[key] {
            return DiagnosticAlias(kind: kind, number: existing)
        }
        let next = (counters[kind] ?? 0) + 1
        counters[kind] = next
        numbers[key] = next
        return DiagnosticAlias(kind: kind, number: next)
    }

    /// 退出登录时清掉：下一个人不该看到上一个人的会话排在 `s3`。
    func reset() {
        lock.lock()
        defer { lock.unlock() }
        numbers.removeAll()
        counters.removeAll()
    }
}
