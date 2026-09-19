import os

/// The one place loggers are created.
///
/// Subsystem and category are what Console.app and `log stream` filter on, so a
/// logger built at a call site would make its own messages hard to find again.
/// Categories name a concern rather than a type, because a message is looked up
/// by what it is about, not by which type happened to emit it.
enum AppLog {
    private static let subsystem = "com.liy.SynapseMobile"

    /// The phone's socket to the cloud relay.
    static let realtime = Logger(subsystem: subsystem, category: "realtime")
    /// Credentials and REST traffic.
    static let network = Logger(subsystem: subsystem, category: "network")
    /// 语音输入：签名、连接、识别失败。
    static let voice = Logger(subsystem: subsystem, category: "voice")
    /// 录音：采集、分片上传、异常退出后的收尾。
    static let recording = Logger(subsystem: subsystem, category: "recording")
}
