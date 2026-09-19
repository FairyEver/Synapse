import Foundation

/// 线上传过来的时间戳怎么读。
///
/// 这套协议里的时间出自 JS 的 `new Date().toISOString()` —— **带毫秒**。而
/// `ISO8601DateFormatter` 的默认选项读不了那一截：给它 `2026-09-19T05:17:00.123Z`，
/// 它返回 nil，不抛错、不吭声。
///
/// 这个坑已经踩了两次。先是会议列表的时间，各写各的兜底躲过去了；再是会话行那个
/// 「运行多久」—— `MobileSummarySession.startedAtDate` 用的是默认 formatter，于是
/// 它**永远**是 nil，那一格永远是空的，而空着的东西没有人会去修。所以解析收在这一
/// 处，两边共用：再写第三个默认 formatter 就是第三次踩同一个坑。
extension ISO8601DateFormatter {
    /// 带毫秒的那种。
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// 发出去的那种：不带毫秒，和这套协议一直以来发出去的形状一致。
    ///
    /// 单例是必须的，不是顺手：`OutboundEnvelope.make` 每条出站消息都调它，而终端
    /// 键盘面板**每敲一个键**就发一条 intent。`ISO8601DateFormatter` 的构造成本远
    /// 大于它格式化一次，每键新建一个就是每键一次的浪费。
    static let wire: ISO8601DateFormatter = ISO8601DateFormatter()

    /// 两种都认。
    ///
    /// 兜底那一条不是多余的：不是每个时间戳都经过 JS 的 `toISOString()`（手写的
    /// fixture、别的实现、旧版本留下的数据都不带毫秒），只认一种会把它们读成 nil ——
    /// 而 nil 在这里的表现是「那一格空着」，不是一条错误。
    ///
    /// 顺序不能反：带毫秒的先试。`withFractionalSeconds` 读不带毫秒的同样能成功，
    /// 反过来则不成立。
    static func parseWireTimestamp(_ value: String) -> Date? {
        withFractionalSeconds.date(from: value) ?? wire.date(from: value)
    }
}
