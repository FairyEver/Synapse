import Foundation

/// 一次问题反馈提交的结果，以及要对用户说的那句话。
///
/// 五句从桌面端 dispatcher 抄来（`desktop/app-capabilities/problem-feedback/main/
/// dispatcher.ts`）：同一个后端、同一种失败，两端说同一句话，人才不必分别学。
/// 第六句（`.unknown`）只在手机上出现 —— 桌面端在进程里提交，断网是一种失败；手机在
/// 移动网络里提交，请求发出去而响应没回来是**完全正常**的一种处境，那句话必须说清
/// 「可能已经提交」，否则用户会重发，而后端会把它当第二条。
enum ProblemFeedbackOutcome: Equatable {
    case submitted
    /// 400：内容不符合提交要求（空、首尾空白、含控制字符、超 256 KiB……）。
    case rejected
    /// 422：命中了隐私校验。`category` 是服务端给的稳定类别名。
    case privacyRisk(category: String?)
    /// 429：按 IP 限流（桶容量 3 / 10 分钟）。
    case rateLimited
    /// 503：服务端没写成。
    case notSubmitted
    /// 连接断了、超时、或响应读不懂 —— 请求可能已经到了。
    case unknown
}

extension ProblemFeedbackOutcome {
    var message: String {
        switch self {
        case .submitted:
            "问题反馈已提交"
        case .rejected:
            "问题反馈内容不符合提交要求。"
        case .privacyRisk(let category):
            Self.privacyMessage(category: category)
        case .rateLimited:
            "问题反馈提交过于频繁。"
        case .notSubmitted:
            "问题反馈未提交。"
        case .unknown:
            "问题反馈提交结果未知，内容可能已经提交。"
        }
    }

    /// 说得出是哪一类风险，但**不复述命中的内容**。
    ///
    /// 这一行字会出现在屏幕上，而它旁边就是用户刚粘进来的那段东西 —— 把命中的原文
    /// 抄进提示里，等于把刚刚拒绝上传的内容又显示了一遍。
    private static func privacyMessage(category: String?) -> String {
        let base = "问题反馈包含不允许提交的隐私风险"
        let hint: String?
        switch category {
        case "authentication_secret": hint = "看起来是密钥或密码。"
        case "local_path": hint = "看起来是本机文件路径。"
        case "identity": hint = "看起来是邮箱、IP 或设备标识。"
        case "user_content": hint = "看起来是对话或代码内容。"
        case "unsafe_url": hint = "看起来是一个不安全的链接。"
        case "correlation_identifier": hint = "看起来是精确时间或请求标识。"
        default: hint = nil
        }
        guard let hint else { return base + "。" }
        return base + "：" + hint
    }
}
