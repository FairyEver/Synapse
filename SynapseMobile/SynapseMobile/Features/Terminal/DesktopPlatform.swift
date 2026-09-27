import Foundation

/// 终端那头是一台什么电脑，因此它的键帽上印的是什么。
///
/// 键盘面板画的是一块**电脑**键盘，所以键帽得照那台电脑印，不是照手机的。终端里
/// 写着「⌥ + ↑」的时候，用户要在面板上照着 `⌥` 找到那颗键 —— 而面板上那颗键如果
/// 只写 `Alt`，符号和名字就对不上，那颗键在他眼里等于不存在。名字因此始终跟着符号
/// 一起印（`⌥ Alt`）：符号是从终端里认回来的那一个，名字是他能念出来的那一个。
///
/// 哪种电脑由桌面端自己报：`live.hello` 里的 `platform`（`process.platform` 加架构），
/// 云端从 `/api/mobile/desktops` 原样转给手机。手机不猜，也猜不出来 —— 会话、摘要、
/// 电脑名里都没有这件事，而电脑名是用户自己起的自由文本。
enum DesktopPlatform: Equatable {
    case macOS
    case windows
    /// 云端没说这台电脑跑的是什么（服务端还没升到会带这个字段的版本），或者它不是
    /// 上面两种（Linux 桌面端）。
    ///
    /// 按 Mac 的印法画。这块面板一直就是一块 Mac 键盘 —— 修饰键行末那颗 `⌘` 画在那里
    /// 就是这个来由 —— 而名字始终在场，所以猜错也只是多印一个用不上的符号，不会让哪
    /// 一颗键变得读不出来。
    case unknown

    /// 电脑在 `live.hello` 里报上来的那个字符串，例如 `darwin-arm64`、`win32-x64`。
    ///
    /// 只看前缀：后面那截是 CPU 架构，与键帽无关，换一台机器就会变。认不出来的一律算
    /// `.unknown`，而它画的是 `.macOS` 那一套。
    init(reported: String?) {
        let value = (reported ?? "").lowercased()
        if value.hasPrefix("darwin") || value.hasPrefix("macos") {
            self = .macOS
        } else if value.hasPrefix("win") {
            self = .windows
        } else {
            self = .unknown
        }
    }

    /// 这台电脑的键盘上，修饰键印不印符号。
    ///
    /// Apple 的键帽两个都印（`⌥ option`，名字只是小一号），PC 的键帽只印名字（`Alt`）
    /// —— PC 键盘上没有 `⌥` 这个字形，印上去是凭空多一颗不存在的键。
    var printsModifierSymbols: Bool { self != .windows }
}
