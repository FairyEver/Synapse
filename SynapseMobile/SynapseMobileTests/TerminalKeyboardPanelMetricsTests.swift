import Foundation
import Testing

@testable import SynapseMobile

/// 键盘面板的几何（设计文档 `2026-09-19-terminal-keyboard-todesk-design.md` §5）。
///
/// 这一条钉的是**面板只有一个高度**，以及它和键、行距之间的关系。它一度是两档（第一页
/// 306、第二页 390，随页走），2026-09-19 面板上面那三行 —— 分页器、工具栏、输入栏 ——
/// 一起去掉之后回到一档：腾出来的地方正好装得下第一页多出来的那两行空白，翻页于是既
/// 不欠高度、也不动终端。
///
/// 这里**只能**钉住算术。真正出过一次的那个 bug —— 每颗键的点击盒比键高高出一截，那截
/// 又成了布局高度，纵向的缝于是变成横向的两倍（12 对 6）—— 是 SwiftUI 的布局事实，
/// 单值算不出来，由 `SynapseMobileUITests/TerminalFlowUITests.swift` 在真界面上量。
struct TerminalKeyboardPanelMetricsTests {
    /// 两页各有多少行：数字加三行字母是一页，符号行加功能键与导航块是另一页。
    private let computerRows = 4
    private let functionRows = 6

    /// 一档高度，就是行数最多的那一页所需要的。
    @Test func thePanelIsAsTallAsItsTallestPage() {
        // 8 + (42 + 8) + 板 + (8 + 14) + 14
        #expect(KeyboardPanelMetrics.panelHeight == 346)
        #expect(KeyboardPanelMetrics.maximumRows == functionRows)
        #expect(KeyboardPanelMetrics.boardHeight == KeyboardPanelMetrics.rowPitch * CGFloat(functionRows))
    }

    /// 板子给的是最多行数的那一页，所以第一页底下空出来的就是差的那两行 ——
    /// 这是**有意的**：翻页时终端一动不动，代价画在第一页下面。
    @Test func theShorterPageIsShorterThanTheBoardByExactlyItsMissingRows() {
        let missing = KeyboardPanelMetrics.boardHeight
            - KeyboardPanelMetrics.rowPitch * CGFloat(computerRows)
        #expect(missing == 84)
    }

    /// 行距就是键高加键距，而键距和键距是同一个数 —— 板子读成一个网格的全部依据。
    /// 板子自己不再另加行距（`TerminalKeyboardPanel.boardPage`），所以这里多出来的任何
    /// 一档都不会被第二个地方补上或抵消。
    @Test func theRowPitchIsTheKeyPlusOneGap() {
        #expect(KeyboardPanelMetrics.rowPitch == KeyboardPanelMetrics.keyHeight + KeyboardPanelMetrics.rowGap)
    }

    /// 竖屏装得下整块面板；横屏装不下，于是按可用高度压下来并让板子在面板里滚。
    @Test func thePanelFitsAPortraitScreenAndIsCappedOnAShortOne() {
        #expect(KeyboardPanelMetrics.height(fitting: 781) == KeyboardPanelMetrics.panelHeight)
        // 横屏：屏幕只有 360 上下，压到可用高度的 55%。
        #expect(KeyboardPanelMetrics.height(fitting: 360) < KeyboardPanelMetrics.panelHeight)
    }

    /// 还没量到高度的那一帧（第一次布局）给整页的高度，不给零点几的比例 —— 否则面板
    /// 会以一帧的塌陷开场。
    @Test func anUnmeasuredScreenGetsTheFullHeight() {
        #expect(KeyboardPanelMetrics.height(fitting: 0) == KeyboardPanelMetrics.panelHeight)
        #expect(KeyboardPanelMetrics.height(fitting: -1) == KeyboardPanelMetrics.panelHeight)
    }
}
