import Foundation
import UIKit

/// 导出包里那份 `manifest.json`。
///
/// 它要能被工具读（不必去猜一行的格式），所以是 JSON，而不是再写一段给人看的文本。
///
/// **字段全是标量，而且刻意不把 `DiagnosticValue` 投影成 JSON。** 那件事要给十几个 case
/// 各写一遍序列化，还要重新论证"这次投影不会绕过脱敏"—— 而这里要回答的问题只有
/// "这份包里有什么、什么时候、从哪台机器上取的、哪一路被截断了"，那是 sink 与环境自己
/// 就知道的事实。别名到真实标识符的映射不在这里（也不在任何地方：它只在内存里）。
///
/// `nonisolated`：它由 sink 在后台队列上填 `lanes` 与 `previousSession`，不能跟着
/// `DiagnosticEnvironment` 的 `@MainActor` 走。
nonisolated struct DiagnosticExportManifest: Encodable, Sendable {
    struct App: Encodable, Sendable {
        let version: String
        let build: String
    }

    struct Device: Encodable, Sendable {
        let model: String
        let name: String
    }

    /// 一路取了多少、有没有被截断。**截断了就写在这里** —— 一份"看起来完整"的包比一份
    /// 明说自己缺了多少的包危险得多。
    struct Lane: Encodable, Sendable {
        let lane: String
        let files: Int
        let bytes: Int
        let truncated: Bool
    }

    struct Counters: Encodable, Sendable {
        let written: Int
        let dropped: Int
        let overwritten: Int
    }

    /// 上一次会话有没有收尾。收尾了的就不是崩溃 —— 这一条也顺带告诉读包的人
    /// "这份日志是从一次正常启动里取的"。
    struct PreviousSession: Encodable, Sendable {
        let lastEvent: String
        let lastAt: String
        let closedCleanly: Bool
    }

    struct Redaction: Encodable, Sendable {
        let markers: [String]
        let note: String
    }

    /// 格式版本。字段有增删就加一，读包的人据此决定怎么解释。
    let schema = 1
    let exportedAt: String
    let timeZone: String
    let app: App
    let device: Device
    let os: String
    /// 这份包里**有没有**终端屏幕内容。这是界面、README 与它自己三处必须一致的那一件事。
    let includesTerminalContent: Bool
    var lanes: [Lane] = []
    let counters: Counters
    var previousSession: PreviousSession? = nil
    let redaction: Redaction

    static func encode(_ manifest: DiagnosticExportManifest) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(manifest),
              let text = String(data: data, encoding: .utf8) else {
            // 编不出来只会是因为这里加了什么编不了的东西 —— 那是本文件的性质，
            // 不是输入的性质。留一个能读的降级而不是让导出整个失败。
            return #"{"schema":1,"error":"manifest could not be encoded"}"#
        }
        return text + "\n"
    }
}

/// 设备与运行环境的快照。
///
/// 单独一个文件、并且标 `@MainActor`：`UIDevice`、`UIScreen`、窗口安全区都只能在
/// 主线程读，而日志其余部分刻意不在主线程。把这条边界画在一个文件上，比在每个
/// 取值处记得"这个要主线程"要可靠。
///
/// 这里记的是**用来排除环境因素**的那些量：机型与系统版本排"是不是某代硬件"，
/// 字号与 Reduce Motion 排"是不是辅助功能设置"，温度与低电量排"是不是降频"——
/// 最后两条是"滚动手感突然变了"最常见的解释，而它们都不会在任何崩溃日志里出现。
@MainActor
enum DiagnosticEnvironment {
    /// 低电量与热状态用系统给的枚举名，不自己造词。
    static func snapshot() -> [DiagnosticEntry] {
        var entries: [DiagnosticEntry] = [
            .init(.appVersion, .message(RedactedMessage(alreadyRedacted: AppVersion.number))),
            .init(.buildNumber, .message(RedactedMessage(alreadyRedacted: AppVersion.build))),
            .init(.osVersion, .message(RedactedMessage(alreadyRedacted: UIDevice.current.systemVersion))),
            .init(.deviceModel, .message(RedactedMessage(alreadyRedacted: machineIdentifier()))),
            // 设备名是用户自己起的，常常就是"某某的 iPhone"。用户已同意记录 ——
            // 它是"哪台手机"最直接的答案，而这个机制存在的意义就是替你问清这件事。
            .init(.deviceName, .name(DeviceName(UIDevice.current.name))),
            .init(.locale, .message(RedactedMessage(alreadyRedacted: Locale.current.identifier))),
            .init(.timeZone, .message(RedactedMessage(alreadyRedacted: TimeZone.current.identifier))),
            .init(.isSimulator, .bool(isSimulator)),
            .init(.diskFreeBucket, .flag(diskFreeBucket())),
            .init(.systemUptimeMs, .durationMs(Int(ProcessInfo.processInfo.systemUptime * 1000))),
            .init(.thermalState, .message(RedactedMessage(alreadyRedacted: thermalStateName))),
            .init(.lowPowerMode, .bool(ProcessInfo.processInfo.isLowPowerModeEnabled)),
        ]

        if let bounds = windowBounds() {
            entries.append(.init(.boundsWidth, .scalar(bounds.width)))
            entries.append(.init(.boundsHeight, .scalar(bounds.height)))
        }
        if let insets = windowSafeArea() {
            entries.append(.init(.safeAreaTop, .scalar(insets.top)))
            entries.append(.init(.safeAreaBottom, .scalar(insets.bottom)))
        }
        return entries
    }

    /// 把快照写成一条记录。启动时一次。
    static func recordSnapshot() {
        DiagnosticLog.record(.environmentSnapshot, snapshot())
    }

    /// 导出包里的 `README.txt`。**不含任何标识符** —— 它连同日志一起发出去。
    static func exportHeader(
        counters: DiagnosticFileSink.Snapshot,
        includesTerminalContent: Bool
    ) -> String {
        var lines: [String] = []
        lines.append("# Synapse 手机端诊断日志")
        lines.append("# 导出时间: \(DiagnosticLineRenderer.timestamp(Date()))")
        lines.append("# 版本: \(AppVersion.label)")
        lines.append("# 系统: \(UIDevice.current.systemVersion) / \(machineIdentifier())")
        lines.append("# 时区: \(TimeZone.current.identifier)")
        lines.append("# 目录: app/ term/ net/ env/ crash/ log/ —— 每一路一个目录，")
        lines.append("#       事件名的前缀就是它所属的那一路。")
        lines.append("# 说明: 一行一条。开头是本地时间、级别字母(D/I/W/E)、事件名与序号。")
        lines.append("#       哪一份文件、哪一路、有没有被截断，见 manifest.json。")
        lines.append("# 脱敏: 会话与电脑用 s1/d1 这类别名；凭据按 [redacted] / [key] 替换。")
        lines.append(includesTerminalContent
            ? "# 终端内容: **本次导出包含终端屏幕内容与发给电脑的输入**，见 term/ 路。"
            : "# 终端内容: 本次导出不含终端屏幕内容与任何输入。")
        lines.append("# 本次共记录 \(counters.totalWritten) 条；被限流丢弃 \(counters.dropped) 条；"
            + "因缓冲写满被覆盖 \(counters.overwritten) 条。")
        lines.append("#")
        return lines.joined(separator: "\n") + "\n"
    }

    /// 与环境有关的那部分 manifest。`lanes` 与 `previousSession` 由 sink 在裁剪之后填 ——
    /// 只有它知道每一路实际取了多少、有没有截断。
    static func exportManifest(
        includesTerminalContent: Bool,
        snapshot: DiagnosticFileSink.Snapshot
    ) -> DiagnosticExportManifest {
        DiagnosticExportManifest(
            exportedAt: ISO8601DateFormatter().string(from: Date()),
            timeZone: TimeZone.current.identifier,
            app: .init(version: AppVersion.number, build: AppVersion.build),
            device: .init(model: machineIdentifier(), name: UIDevice.current.name),
            os: UIDevice.current.systemVersion,
            includesTerminalContent: includesTerminalContent,
            counters: .init(
                written: snapshot.totalWritten,
                dropped: snapshot.dropped,
                overwritten: snapshot.overwritten
            ),
            redaction: .init(
                markers: [DiagnosticRedactor.redactedValue, DiagnosticRedactor.redactedKey],
                note: "与 desktop/electron/services/log-store.ts 的规则对齐"
            )
        )
    }

    // MARK: - 取值

    private static func machineIdentifier() -> String {
        // 模拟器上 `uname` 给的是**宿主机的架构**（`arm64`），不是机型号。
        // 真机才是 `iPhone15,4` 这种。模拟器里读环境变量才是那个真值。
        if isSimulator, let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated
        }
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        let identifier = mirror.children.reduce(into: "") { result, element in
            guard let value = element.value as? Int8, value != 0 else { return }
            result.append(Character(UnicodeScalar(UInt8(bitPattern: value))))
        }
        return identifier.isEmpty ? "unknown" : identifier
    }

    private static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    /// 磁盘余量分档而不是记精确值：精确到字节对诊断没有增量，却是一条没必要的指纹。
    private static func diskFreeBucket() -> DiagnosticFlag {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        guard let bytes = values?.volumeAvailableCapacityForImportantUsage else { return .unknown }
        switch bytes {
        case ..<(256 << 20): return .diskLow
        case ..<(1 << 30): return .diskTight
        default: return .diskPlenty
        }
    }

    private static var thermalStateName: String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: "nominal"
        case .fair: "fair"
        case .serious: "serious"
        case .critical: "critical"
        @unknown default: "unknown"
        }
    }

    private static func windowBounds() -> CGRect? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .windows.first { $0.isKeyWindow }?
            .bounds
    }

    private static func windowSafeArea() -> UIEdgeInsets? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .windows.first { $0.isKeyWindow }?
            .safeAreaInsets
    }
}
