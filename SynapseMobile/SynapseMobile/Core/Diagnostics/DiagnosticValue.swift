import Foundation

/// 一条诊断记录里一个字段能取的值。
///
/// 这里**没有**能直接装任意字符串的 case，这不是遗漏，是这套机制最要紧的一条约束：
/// 终端正文（用户敲的命令、程序的输出、语音转写、剪贴板）一个字节都不许进日志。
/// 值只能经这几条路进来 —— 数字、布尔、闭合枚举的标签、脱敏后的消息、别名，
/// 以及用户明确同意记录的两个名字（设备名、会话标题）。于是调用点上想顺手写
/// `["text": row.text]` 是**编译不过**的，而不是等人去 review 时发现。
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

    // MARK: 触发原因
    case contentGrew
    case insetChanged
    case landingScroll
    case layoutResize
    case zoomReset
    case userDrag
    case unknownCause
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
