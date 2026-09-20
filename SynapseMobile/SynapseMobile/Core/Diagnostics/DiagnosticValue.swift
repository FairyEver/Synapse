import Foundation

/// 一条诊断记录里一个字段能取的值。
///
/// 值只能经这几条路进来 —— 数字、布尔、闭合枚举的标签、脱敏后的消息、别名、
/// 用户明确同意记录的两个名字（设备名、会话标题），以及**唯一**一个能装未脱敏内容的
/// `case captured`。于是调用点上想顺手写 `["text": row.text]` 是**编译不过**的，
/// 而不是等人去 review 时发现。
///
/// `case captured` 是一个被推翻的决定的产物：这里原先没有能装正文的 case，
/// 于是"把终端正文当普通字段记下来"根本写不出来。用户后来要求正文进日志（好让导出包
/// 能自查），那道防线让了出去 —— 换回来的是 `DiagnosticLog.captureScreen`
/// **一个入口**、一个默认姿势明确的开关、一个调用点采样闸，以及一条源码级的守卫测试。
/// **再加第二个这样的 case 属于改变这条边界**，见设计文档与 `agent-runtime-security.md`。
///
/// 刻意用枚举而不是 `[String: Any]`：字典对值不设防，而错一次就是把别人的
/// 密码贴进一个要发微信的文件里。
nonisolated enum DiagnosticValue: Equatable, Sendable {
    /// 整数：行数、列数、条数、序号。
    case int(Int)
    /// 带小数的量：偏移、高度、坐标。渲染时保留一位。
    case scalar(Double)
    case bool(Bool)
    /// 毫秒。单独一档是为了在日志里一眼看出它是时长而不是某个计数。
    case durationMs(Int)
    /// 闭合枚举里的一个标签。取值只能是 `DiagnosticFlag` 里列出的那些。
    case flag(DiagnosticFlag)
    /// 本地别名（`s1` / `d1` / `p1`）。真实的会话 id、电脑 id、项目 id 不进日志。
    case alias(DiagnosticAlias)
    /// 固定占位符，如 `<redacted>`。
    case redacted(RedactionPlaceholder)
    /// 已经过脱敏的文本。构造它的唯一入口就是那个会跑脱敏规则的初始化器。
    case message(RedactedMessage)
    /// 调用栈。单独一档，因为它该有的上限比一条错误文案大得多。
    case stack(RedactedStack)
    /// 设备名。用户已同意记录 —— 它是"哪台手机"最直接的答案。
    case name(DeviceName)
    /// 会话标题。用户已同意记录 —— 缺了它没法把日志和录屏里的那个终端对上号。
    case title(SessionTitle)
    /// 一次 REST 请求打在哪一族接口上。闭合枚举，不是自由字符串。
    case route(DiagnosticRoute)
    /// 手机发给电脑的 intent 的种类。闭合枚举。
    case intent(DiagnosticIntent)
    /// 屏幕上当时可见的内容，**被明确取下来的**一份有界样本。
    ///
    /// 这是整个值类型里唯一能承载未脱敏用户内容的一格。它的存在是一个被推翻的决定：
    /// 原先这里没有能装正文的 case，于是"把终端正文顺手当普通字段记下来"是**编译不过**
    /// 的。用户后来要求把正文记进来（导出包变得可自查），那道防线于是让了 ——
    /// 换来的是一个入口、一个开关、一个采样闸，以及一条源码级的守卫测试，
    /// 见 `DiagnosticLog.captureScreen`。
    case captured(CapturedText)
}

/// 日志里用作标签的闭合取值集。
///
/// 按用途分段，不按类型分段。加一个新标签就在这里加一个 case —— 多出来的
/// 一行是这套机制收的税，换来的是"标签不可能是用户数据"。
nonisolated enum DiagnosticFlag: String, Sendable {
    // MARK: 显示与版面
    case phoneDriven
    case desktopDriven
    case compact
    case normal
    case spacious
    case portrait
    case landscape

    // MARK: 磁盘余量（分档，不记精确值）
    case diskLow
    case diskTight
    case diskPlenty

    // MARK: 输入栏与键盘
    case keyboard
    case voice
    case panel
    case systemKeyboard

    // MARK: 手势
    case scroll
    case pinch
    case canvasPan
    case longPress
    case tap
    case none

    // MARK: 手势 / 任务状态
    case began
    case changed
    case ended
    case cancelled
    case failed
    case possible

    // MARK: 结果
    case ok
    case rejected
    case timeout
    case unavailable
    /// 电脑收下了，但本来就无事可做（例如重复的 attach）。它与 `ok` 分开，
    /// 因为「发了没反应」和「发了但对面说不用做」在排查时是两件事。
    case noop
    case unknown

    // MARK: 场景与连接
    case active
    case inactive
    case background
    case connecting
    case connected
    case disconnected
    case reconnecting
    case waiting

    // MARK: 内容的来源与形态
    case suffix
    case reset
    case history
    case frame
    case restore
    case login
    case logout
    case singleLine
    case multiLine

    // MARK: 出站与 HTTP
    case hello
    case ping
    case intent
    case httpGet
    case httpPost
    case httpPut
    case httpPatch
    case httpDelete
    /// 认不出的方法。HTTP 方法在 `APIClient` 里是字面量，加一个没见过的走这里。
    case other

    // MARK: 触发原因
    case contentGrew
    case insetChanged
    case landingScroll
    case layoutResize
    case zoomReset
    case userDrag
    /// 一行也没有新到，但有一块行插在视口**上方**（一页滚动历史、快照的一块），
    /// 视口离底部凭空远了一整块。贴底读者要先补偿掉这一块，再去跟随。
    case aboveInserted
    case unknownCause
}

/// 一次 REST 请求打在哪一族接口上。
///
/// **记家族，不记 path**。`/mobile/devices/<clientInstanceId>`、`/meetings/<id>/audio-url`、
/// `/drive/items/<id>/permanent` 里都嵌着真实标识符，而这条纪律对整个出口都成立。
/// 家族由 path 的第一段派生，调用点零成本。
///
/// 升级路径：如果日后「哪个 endpoint 慢」变成刚需，把它提升成每路由一个 case，
/// 并从各 typed 方法显式传 `route:` —— 那时是一处枚举 + 一处 switch 的改动。
nonisolated enum DiagnosticRoute: String, CaseIterable, Sendable {
    case auth
    case mobile
    case drive
    case meetings
    case voice
    case other

    /// 由 path 的第一段派生。前导斜杠先去掉，空段忽略。
    static func family(of path: String) -> DiagnosticRoute {
        switch path.split(separator: "/").first.map(String.init) {
        case "auth": return .auth
        case "mobile": return .mobile
        case "drive": return .drive
        case "meetings": return .meetings
        case "voice": return .voice
        default: return .other
        }
    }
}

/// 手机发给电脑的 intent 的种类。
///
/// 和事件目录一样是闭合的：加一种 intent 要在这里加一个 case。这样「日志里出现过哪些
/// 意图」是个可枚举的事实，而不是一堆自由文本。
nonisolated enum DiagnosticIntent: String, CaseIterable, Sendable {
    case attach, detach, sync, history
    case command, keys, unlock
    case stop, delete, rename, create
    case createAgentConversation, launchCommand
    case resize, releaseGrid
    case fileUpload, ping
    case other

    /// 由 `MobileIntentRequest.kind` 的字面量转过来。认不出的走 `.other` ——
    /// 协议加了一种新 intent 而这里忘了跟，日志会显示 `other`，不会丢记录也不会崩。
    static func named(_ raw: String) -> DiagnosticIntent {
        DiagnosticIntent(rawValue: raw) ?? .other
    }
}

extension DiagnosticFlag {
    /// 一帧终端的语义 → 日志标签。协议加一种新的 kind 时走 `.other`，
    /// 记录不丢，只是看不出来是哪一种。
    static func frameKind(_ kind: String) -> DiagnosticFlag {
        switch kind {
        case "reset": return .reset
        case "suffix": return .suffix
        case "history": return .history
        default: return .other
        }
    }
}

/// 屏幕上（或输入里）的内容，**被明确取下来的**一份有界样本。
///
/// 三重限长：行数、每行字节、总字节。上限不是随手取的 —— 它要保证一条记录撑不爆
/// `DiagnosticLineRenderer` 的单条上限，也要让"每秒至多一条"乘出来落在一路的磁盘配额之内。
///
/// **唯一的构造入口是复数行。** `CapturedText(redacting: row.text)` 写不出来，因为
/// 那是个 `String`：想误用，手上得正好有一组行文本。这和 `RedactedMessage` 挡住的是
/// 同一类失误（顺手把某个字符串塞进日志），而它正是类型系统那道防线让出去之后唯一
/// 还留在构造点上的东西。
nonisolated struct CapturedText: Equatable, Sendable {
    /// 一屏的可见行数上限。终端面板在手机上也就三四十行，取前 12 行就够回答
    /// "当时屏幕上是什么"，而再多会把别的记录挤出配额。
    static let maxRows = 12
    static let maxBytesPerRow = 256
    /// 总上限。**必须严格小于 `maxRows * maxBytesPerRow`** —— 否则先按行截完之后
    /// 永远到不了它，那一格就成了死代码，而"写着一道上限却从不生效"比没有上限更坏。
    /// `DiagnosticContentCaptureTests` 把这条关系钉住。
    static let maxBytes = 2 * 1024

    let text: String

    /// 先按行截、再按字节截、最后整体上限 —— 顺序不能反：先整体截的话，一屏超长行
    /// 会把后面所有行都吃掉，留下的反而全是同一行的碎片。
    init(redacting rows: [String], using redactor: DiagnosticRedactor = .shared) {
        let bounded = rows.prefix(Self.maxRows).map {
            DiagnosticText.clamp($0, to: Self.maxBytesPerRow)
        }
        text = DiagnosticText.clamp(redactor.redact(bounded.joined(separator: "\n")), to: Self.maxBytes)
    }

    /// 只给测试：已知结果直接构造，不跑截断与脱敏。
    init(alreadyCaptured text: String) {
        self.text = text
    }
}

/// 形态与来源都合法的文本，且**已经过脱敏**。
///
/// 唯一接受裸字符串的初始化器会先跑脱敏规则再存下来 —— 这正是仓库安全规则要求的
/// "先结构化脱敏再序列化"。日志里出现的错误文案走这条路。
nonisolated struct RedactedMessage: Equatable, Sendable {
    /// 单条消息的上限。错误文案可能很长，但一条日志不该被一段栈带跑。
    static let maxBytes = 256

    let text: String

    init(redacting raw: String, using redactor: DiagnosticRedactor = .shared) {
        text = DiagnosticText.clamp(redactor.redact(raw), to: Self.maxBytes)
    }

    /// 给测试用：已知结果直接构造，不跑规则。
    init(alreadyRedacted text: String) {
        self.text = DiagnosticText.clamp(text, to: Self.maxBytes)
    }
}

/// 调用栈。上限比一条错误文案大，因为栈的价值全在那一串帧里。
nonisolated struct RedactedStack: Equatable, Sendable {
    static let maxBytes = 8 * 1024
    /// 三十来帧足够看清从哪来、崩在哪；再往下是系统框架的公共尾巴。
    static let maxFrames = 32

    let text: String

    init(redacting raw: String, using redactor: DiagnosticRedactor = .shared) {
        text = DiagnosticText.clamp(redactor.redact(raw), to: Self.maxBytes)
    }

    /// 先按帧数截，再按字节截 —— 顺序反过来的话，一个超长的帧名会把整份栈吃掉。
    static func frames(_ symbols: [String], using redactor: DiagnosticRedactor = .shared) -> RedactedStack {
        let head = symbols.prefix(maxFrames).joined(separator: " | ")
        return RedactedStack(redacting: head, using: redactor)
    }
}

/// 设备名。用户已同意记录，但它是用户自己起的字符串，所以仍然限长。
nonisolated struct DeviceName: Equatable, Sendable {
    static let maxBytes = 64

    let text: String

    init(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        text = trimmed.isEmpty
            ? RedactionPlaceholder.device.rawValue
            : DiagnosticText.clamp(trimmed, to: Self.maxBytes)
    }
}

/// 会话标题。用户已同意记录，同样限长。
nonisolated struct SessionTitle: Equatable, Sendable {
    static let maxBytes = 96

    let text: String

    init(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        text = trimmed.isEmpty
            ? RedactionPlaceholder.redacted.rawValue
            : DiagnosticText.clamp(trimmed, to: Self.maxBytes)
    }
}

/// 真实标识符在日志里的替身，形如 `s1`。
///
/// 不用哈希：会话 id、电脑 id 这些空间很小，哈希等于一份可字典反推的密文，
/// 反而给人"已经匿名了"的错觉。别名只在一个日志文件内有意义，映射表不落盘。
nonisolated struct DiagnosticAlias: Equatable, Sendable {
    nonisolated enum Kind: String, Sendable {
        case session = "s"
        case desktop = "d"
        case project = "p"
        case request = "r"
    }

    let kind: Kind
    let number: Int

    var text: String { "\(kind.rawValue)\(number)" }
}

/// ADR 0114 定下的固定占位符集合。
///
/// 复用而不是新造一套：桌面端、服务端、手机端三处对同一个东西用同一个记号，
/// 收到哪一端的日志都能直接读。
nonisolated enum RedactionPlaceholder: String, Sendable {
    case secret = "<secret>"
    case token = "<token>"
    case credential = "<credential>"
    case home = "<home>"
    case project = "<project>"
    case module = "<module>"
    case file = "<file>"
    case user = "<user>"
    case organization = "<organization>"
    case customer = "<customer>"
    case device = "<device>"
    case session = "<session>"
    case requestID = "<request-id>"
    case timestamp = "<timestamp>"
    case url = "<url>"
    case value = "<value>"
    case redacted = "<redacted>"
}

nonisolated enum DiagnosticTruncation {
    static let marker = "…<truncated>"
}

nonisolated enum DiagnosticText {
    /// 按**字节**截断，不是按字符。
    ///
    /// 限制的是文件里的体积，而一个中文字符占三个字节 —— 按字符截会让中文日志
    /// 比英文大三倍，上限也就不成其为上限了。
    static func clamp(_ value: String, to maxBytes: Int) -> String {
        guard value.utf8.count > maxBytes else { return value }
        var out = ""
        var used = 0
        for character in value {
            let size = String(character).utf8.count
            if used + size > maxBytes { break }
            out.append(character)
            used += size
        }
        return out + DiagnosticTruncation.marker
    }
}
