import Foundation

/// 磁盘上一个日志文件的事实。刻意不含路径 —— 这一层是纯算术。
nonisolated struct DiagnosticFileInfo: Equatable, Sendable {
    let name: String
    let sizeBytes: Int
    let modified: Date
}

/// 什么时候该换文件、该删哪些。
///
/// 纯函数，不 import FileManager：轮转全是算术，而算术能被逐条钉住。
/// 一旦它自己去删文件，测试就得真的动磁盘，边界情况（只剩一个文件、刚好多一字节）
/// 也就没人愿意写了。
nonisolated enum DiagnosticRotation {
    struct Limits: Sendable, Equatable {
        /// 单文件上限。比桌面端的 10 MB 小一个数量级：这份文件是要经微信发出去的，
        /// 而滚不动这类问题只需要几分钟的窗口。
        var maxFileBytes = 1 << 20
        var maxFiles = 10
        var maxTotalBytes = 10 << 20
    }

    struct Plan: Equatable, Sendable {
        var shouldRotate: Bool
        /// 可以删掉的文件名，从旧到新。
        var removals: [String]
    }

    /// - Parameters:
    ///   - activeName: 正在写的那个文件。**永远不在删除候选里** —— 删掉它等于把
    ///     当前这段日志连同还没落盘的内容一起丢掉，而"越写越少"是最难查的那种坏法。
    ///   - files: 目录里现有的全部文件，含活动文件。
    ///   - incomingBytes: 这一批要写进去的大致字节数。
    static func plan(
        activeName: String,
        files: [DiagnosticFileInfo],
        incomingBytes: Int,
        limits: Limits
    ) -> Plan {
        let activeSize = files.first { $0.name == activeName }?.sizeBytes ?? 0
        // 空文件不轮转：刚建出来就超限的话会无限换文件，一个字节也写不进去。
        let shouldRotate = activeSize > 0 && activeSize + incomingBytes > limits.maxFileBytes

        var count = files.count + (shouldRotate ? 1 : 0)
        var total = files.reduce(0) { $0 + $1.sizeBytes } + (shouldRotate ? incomingBytes : 0)

        var candidates = files
            .filter { $0.name != activeName }
            .sorted { $0.modified < $1.modified }

        var removals: [String] = []
        while count > limits.maxFiles || total > limits.maxTotalBytes, !candidates.isEmpty {
            let victim = candidates.removeFirst()
            removals.append(victim.name)
            count -= 1
            total -= victim.sizeBytes
        }
        return Plan(shouldRotate: shouldRotate, removals: removals)
    }
}

extension DiagnosticRotation.Limits {
    /// 一路日志的配额。
    ///
    /// **不做跨域驱逐。** 跨域要从"哪些域可以让出空间"里选，那既破坏 `plan` 的纯函数
    /// 性质（一个域的决策要去读别的域的现状），又让"哪一路丢了数据"变得不确定。配额版
    /// 把「总量封顶」从一个运行时不变式变成**构造性事实**：各配额之和即上限。
    ///
    /// 顺带的收益是 crash 路天然不被 term 路的洪峰挤掉 —— 那一路的额度只归它自己。
    /// 代价写在明处：term 写满自己的 3 MiB 时回收的是 term 的旧文件，不会去动 app 的空间。
    static func forLane(_ lane: DiagnosticLane) -> Self {
        switch lane {
        case .app:
            Self(maxFileBytes: 1 << 20, maxFiles: 2, maxTotalBytes: 2 << 20)
        case .term, .net:
            Self(maxFileBytes: 1 << 20, maxFiles: 3, maxTotalBytes: 3 << 20)
        case .crash:
            Self(maxFileBytes: 1 << 20, maxFiles: 1, maxTotalBytes: 1 << 20)
        case .env, .log:
            Self(maxFileBytes: 256 << 10, maxFiles: 1, maxTotalBytes: 256 << 10)
        }
    }

    /// 每一路的配额，生产用这一份。
    static let perLane: [DiagnosticLane: Self] = Dictionary(
        uniqueKeysWithValues: DiagnosticLane.allCases.map { ($0, forLane($0)) }
    )

    /// 给测试：每路一样。构造边界（刚好多一字节、只剩一个文件）时不必逐个域去算配额。
    static func uniform(_ limits: Self) -> [DiagnosticLane: Self] {
        Dictionary(uniqueKeysWithValues: DiagnosticLane.allCases.map { ($0, limits) })
    }

    /// 全部配额之和。它必须不超过磁盘上愿意给这套日志的总量 ——
    /// `DiagnosticRotationTests` 把这条钉住，加一路或调一格配额而忘了看总量会红。
    static var diskCeilingBytes: Int {
        DiagnosticLane.allCases.reduce(0) { $0 + forLane($1).maxTotalBytes }
    }
}

/// 把记录渲染成一行。
///
/// 一行一条，因为它们要能被 `grep`、被 `sort`、也被我直接读。渲染是纯粹的字符串
/// 拼装，没有 JSON：JSON 在这里只会让文件大一倍，而读的人还是得眯着眼找字段。
nonisolated enum DiagnosticLineRenderer {
    /// 单条记录的上限。带栈的记录单独放宽 —— 栈是崩溃现场的全部。
    static let maxRecordBytes = 2 * 1024
    static let maxRecordBytesWithStack = 9 * 1024

    static func render(_ record: DiagnosticRecord) -> String {
        var line = "\(timestamp(record.time)) \(letter(record.level)) \(record.event.rawValue)"
        if record.seq > 0 {
            line += " #\(record.seq)"
        }
        var carriesStack = false
        for entry in record.fields {
            if case .stack = entry.value { carriesStack = true }
            line += " \(entry.field.rawValue)=\(render(entry.value))"
        }
        let cap = carriesStack ? maxRecordBytesWithStack : maxRecordBytes
        return DiagnosticText.clamp(line, to: cap)
    }

    static func renderAll(_ records: [DiagnosticRecord]) -> String {
        records.map(render).joined(separator: "\n") + "\n"
    }

    static func render(_ value: DiagnosticValue) -> String {
        switch value {
        case .int(let number): "\(number)"
        case .scalar(let number): String(format: "%.1f", number)
        case .bool(let flag): flag ? "T" : "F"
        case .durationMs(let ms): "\(ms)ms"
        case .flag(let flag): flag.rawValue
        case .alias(let alias): alias.text
        case .redacted(let placeholder): placeholder.rawValue
        case .message(let message): quote(message.text)
        case .stack(let stack): quote(stack.text)
        case .name(let name): quote(name.text)
        case .title(let title): quote(title.text)
        case .route(let route): route.rawValue
        case .intent(let intent): intent.rawValue
        }
    }

    private static func letter(_ level: DiagnosticLevel) -> String {
        switch level {
        case .debug: "D"
        case .info: "I"
        case .warn: "W"
        case .error: "E"
        }
    }

    /// 时间是本地时区 —— 读日志的人对着自己的钟找"那一下"，时区在文件头部写明。
    static func timestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        return formatter.string(from: date)
    }

    /// 带引号，并转义反斜杠、引号与换行 —— 换行不转义的话一条记录会变成两行，
    /// 而"一行一条"是这份文件唯一的结构保证。
    static func quote(_ value: String) -> String {
        var out = "\""
        for character in value {
            switch character {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.append(character)
            }
        }
        return out + "\""
    }
}
