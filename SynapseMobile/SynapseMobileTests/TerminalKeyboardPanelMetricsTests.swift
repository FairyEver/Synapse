import Foundation
import Testing

@testable import SynapseMobile

/// 键盘面板的几何（设计文档 `2026-09-20-terminal-keyboard-high-frequency-design.md` §5）。
///
/// 这一条钉的是**面板只有一个高度**，以及它和键、行距之间的关系。它一度是两档（第一页
/// 306、第二页 390，随页走），2026-09-19 面板上面那三行 —— 分页器、工具栏、输入栏 ——
/// 一起去掉之后回到一档，代价是第一页底下空着两行。
///
/// **2026-09-20 那两行不再是空的**：方向键与回车搬进第一页之后两页都铺满，一档高度不再
/// 由「白扔两行」换，但翻页时终端依旧一动不动 —— 下面那条测的就是这件事。
///
/// 这里**只能**钉住算术。真正出过一次的那个 bug —— 每颗键的点击盒比键高高出一截，那截
/// 又成了布局高度，纵向的缝于是变成横向的两倍（12 对 6）—— 是 SwiftUI 的布局事实，
/// 单值算不出来，由 `SynapseMobileUITests/TerminalFlowUITests.swift` 在真界面上量。
struct TerminalKeyboardPanelMetricsTests {
    /// 两页各有多少行：数字加三行字母加方向键行与动作行是一页，符号加编辑块加功能键是
    /// 另一页。**两页都是六行** —— 板子多高，两页就都用满多高。
    private let computerRows = 6
    private let functionRows = 6

    /// 一档高度，就是行数最多的那一页所需要的。
    @Test func thePanelIsAsTallAsItsTallestPage() {
        // 8 + (42 + 8) + 板 + (8 + 14) + 14
        #expect(KeyboardPanelMetrics.panelHeight == 346)
        #expect(KeyboardPanelMetrics.maximumRows == functionRows)
        #expect(KeyboardPanelMetrics.boardHeight == KeyboardPanelMetrics.rowPitch * CGFloat(functionRows))
    }

    /// 两页都把板子铺满：两页一样高，翻页时终端一动不动，而这一次没有哪一页底下
    /// 需要空着。
    ///
    /// 2026-09-20 之前这里钉的是「第一页比板子矮两行、正好 84pt」—— 那 84pt 是买
    /// 「一档高度」付的钱。方向键与动作行搬进第一页之后不用付了，但**要买的东西没变**，
    /// 所以这条从断言「差两行」改成断言「两页都不差」，而不是删掉。
    ///
    /// 两边都对着**产品里的那个数**比，不是拿两个测试本地常量互比 —— 后者恒真。
    @Test func bothPagesFillTheBoard() {
        #expect(KeyboardPanelMetrics.maximumRows == computerRows)
        #expect(KeyboardPanelMetrics.maximumRows == functionRows)
        #expect(KeyboardPanelMetrics.boardHeight == KeyboardPanelMetrics.rowPitch * CGFloat(computerRows))
        #expect(KeyboardPanelMetrics.boardHeight == KeyboardPanelMetrics.rowPitch * CGFloat(functionRows))
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
