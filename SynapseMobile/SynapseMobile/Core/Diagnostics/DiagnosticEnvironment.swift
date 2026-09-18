import Foundation
import UIKit

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
            .init(.processUptimeMs, .durationMs(Int(ProcessInfo.processInfo.systemUptime * 1000))),
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

    /// 导出文件的头部。**不含任何标识符** —— 它连同上方的日志一起发出去。
    static func exportHeader(counters: DiagnosticFileSink.Snapshot) -> String {
        var lines: [String] = []
        lines.append("# Synapse 手机端诊断日志")
        lines.append("# 导出时间: \(DiagnosticLineRenderer.timestamp(Date()))")
        lines.append("# 版本: \(AppVersion.label)")
        lines.append("# 系统: \(UIDevice.current.systemVersion) / \(machineIdentifier())")
        lines.append("# 时区: \(TimeZone.current.identifier)")
        lines.append("# 说明: 一行一条。开头是本地时间、级别字母(D/I/W/E)、事件名与序号。")
        lines.append("# 不含终端正文、命令、转写与任何凭据；会话与电脑用 s1/d1 这类别名。")
        lines.append("# 本次共记录 \(counters.totalWritten) 条；被限流丢弃 \(counters.dropped) 条；"
            + "因缓冲写满被覆盖 \(counters.overwritten) 条。")
        lines.append("#")
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: - 取值

    private static func machineIdentifier() -> String {
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
        case ..<(256 << 20): return .unavailable
        case ..<(1 << 30): return .compact
        case ..<(5 << 30): return .normal
        default: return .ok
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
