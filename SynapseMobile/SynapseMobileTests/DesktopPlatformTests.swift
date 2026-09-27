import Foundation
import Testing

@testable import SynapseMobile

/// 键帽照哪台电脑印（`DesktopPlatform`）。
///
/// 这一条钉的是**用户读到的东西**：终端里那行提示写着 `⌥ + ↑`，面板上那颗键就得印着
/// `⌥`，否则那颗键在他眼里不存在。所以这里测的不是「枚举有几个 case」，而是那张表
/// 本身 —— 哪台电脑的四颗修饰键各印什么。
///
/// `@MainActor` 是因为应用目标的默认隔离就是它（`SWIFT_DEFAULT_ACTOR_ISOLATION`），
/// 这两个类型跟着是主线程隔离的；同目录下别的用例也是这么标的。
@MainActor
struct DesktopPlatformTests {
    // MARK: - 电脑报上来的是什么

    /// 桌面端报的是 `process.platform` 加架构（`live-connection-service.ts`），所以
    /// 只看前缀：后面那截换一台机器就会变，与键帽无关。
    @Test func theReportedPlatformIsReadFromItsPrefix() {
        #expect(DesktopPlatform(reported: "darwin-arm64") == .macOS)
        #expect(DesktopPlatform(reported: "darwin-x64") == .macOS)
        #expect(DesktopPlatform(reported: "win32-x64") == .windows)
        #expect(DesktopPlatform(reported: "win32-arm64") == .windows)
    }

    @Test func thePrefixIsReadCaseInsensitively() {
        #expect(DesktopPlatform(reported: "Darwin-arm64") == .macOS)
        #expect(DesktopPlatform(reported: "WIN32-x64") == .windows)
    }

    /// 说不出来的时候算 `.unknown`，而它画的是 Mac 那一套 —— 这块面板一直就是一块
    /// Mac 键盘。旧服务端（不带 `platform` 的那一个）走的就是这一条，所以它必须与
    /// `.macOS` 画出同一块板子，否则升级顺序一错，用户看到的就是两种键帽。
    @Test func anUnknownComputerDrawsTheBoardThisPanelAlwaysDrew() {
        #expect(DesktopPlatform(reported: nil) == .unknown)
        #expect(DesktopPlatform(reported: "") == .unknown)
        #expect(DesktopPlatform(reported: "linux-x64") == .unknown)
        #expect(DesktopPlatform(reported: "海豚") == .unknown)

        for modifier in KeyboardPanelModifier.allCases {
            #expect(
                modifier.keycap(on: .unknown).symbol == modifier.keycap(on: .macOS).symbol,
                "\(modifier.rawValue) 在说不出来的电脑上画的符号与 Mac 上不一样"
            )
            #expect(modifier.keycap(on: .unknown).name == modifier.keycap(on: .macOS).name)
        }
    }

    // MARK: - 四颗键各印什么

    /// Mac：符号加名字，两个都印 —— 这是这次改动的全部理由。第四颗键在 Mac 上叫
    /// `Cmd`，因为它印的是 `⌘`。
    @Test func aMacPrintsTheSymbolBesideTheName() {
        #expect(KeyboardPanelModifier.control.keycap(on: .macOS) == (symbol: "⌃", name: "Ctrl"))
        #expect(KeyboardPanelModifier.shift.keycap(on: .macOS) == (symbol: "⇧", name: "Shift"))
        #expect(KeyboardPanelModifier.alt.keycap(on: .macOS) == (symbol: "⌥", name: "Alt"))
        #expect(KeyboardPanelModifier.command.keycap(on: .macOS) == (symbol: "⌘", name: "Cmd"))
    }

    /// PC：只印名字。`⌥` `⌃` `⇧` 在 PC 键盘上根本不存在，印上去就是凭空多一颗键；
    /// 第四颗键在那个位置上是 `Win`，不是 `Cmd`。
    @Test func aPCPrintsTheNameAlone() {
        #expect(KeyboardPanelModifier.control.keycap(on: .windows) == (symbol: nil, name: "Ctrl"))
        #expect(KeyboardPanelModifier.shift.keycap(on: .windows) == (symbol: nil, name: "Shift"))
        #expect(KeyboardPanelModifier.alt.keycap(on: .windows) == (symbol: nil, name: "Alt"))
        #expect(KeyboardPanelModifier.command.keycap(on: .windows) == (symbol: nil, name: "Win"))
    }

    /// 名字永远在场：读不出符号的人也读得出来这颗键叫什么。第四颗键是唯一的例外
    /// 来源（`⌘ Cmd` / `Win`），但它两头都发不出去，一直是压暗的。
    @Test func everyKeycapCarriesAName() {
        for platform in [DesktopPlatform.macOS, .windows, .unknown] {
            for modifier in KeyboardPanelModifier.allCases {
                #expect(!modifier.keycap(on: platform).name.isEmpty)
            }
        }
    }

    /// 只有 PC 不印符号。这一句是上面两张表的前提，单独钉住，免得以后加平台时只改
    /// 了表、忘了这个开关。
    @Test func onlyThePCGoesWithoutSymbols() {
        #expect(DesktopPlatform.macOS.printsModifierSymbols)
        #expect(DesktopPlatform.unknown.printsModifierSymbols)
        #expect(!DesktopPlatform.windows.printsModifierSymbols)
    }

    /// 面板上那颗键的**身份**不随电脑变：UI 测试用一个 id 找它，跨平台找的是同一颗键。
    @Test func theIdentityOfAKeyDoesNotFollowTheComputer() {
        #expect(KeyboardPanelModifier.allCases.map(\.rawValue) == ["Ctrl", "Shift", "Alt", "⌘"])
        #expect(KeyboardPanelModifier.command.id == "⌘")
        #expect(KeyboardPanelModifier.command.isDead)
    }
}
