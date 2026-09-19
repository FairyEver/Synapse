import Foundation
import Testing

@testable import SynapseMobile

/// 键盘面板的几何（设计文档 `2026-09-19-terminal-keyboard-todesk-design.md` §5）。
///
/// 这一条钉的是**面板的高度会随页走**，以及它和键、行距之间的关系。起因是一次真机截图：
/// 第一页四行、第二页六行，面板却只有一个高度，于是第一页底下空出 84pt 什么也没有。
///
/// 这里**只能**钉住算术。真正出过一次的那个 bug —— 每颗键的点击盒比键高高出一截，那截
/// 又成了布局高度，纵向的缝于是变成横向的两倍（12 对 6）—— 是 SwiftUI 的布局事实，
/// 单值算不出来，由 `SynapseMobileUITests/TerminalFlowUITests.swift` 在真界面上量。
struct TerminalKeyboardPanelMetricsTests {
    /// 两页各有多少行：数字加三行字母是一页，符号行加功能键与导航块是另一页。
    private let computerRows = 4
    private let functionRows = 6

    @Test func aPageGetsExactlyTheHeightItsRowsNeed() {
        // 8 + (32 + 12) + (42 + 8) + 板 + (8 + 14) + 14
        #expect(KeyboardPanelMetrics.height(rows: computerRows) == 306)
        #expect(KeyboardPanelMetrics.height(rows: functionRows) == 390)
    }

    /// 翻页时动的就是这两行键的高度，不多不少 —— 多一点就是面板在空白上留了余量，
    /// 少一点就是板子被压进面板里、要靠滚动才够得着。
    @Test func aPageIsTallerThanTheOtherByExactlyItsExtraRows() {
        let extra = KeyboardPanelMetrics.height(rows: functionRows)
            - KeyboardPanelMetrics.height(rows: computerRows)
        let twoRows = KeyboardPanelMetrics.rowPitch * CGFloat(functionRows - computerRows)
        #expect(extra == twoRows)
    }

    /// 行距就是键高加键距，而键距和键距是同一个数 —— 板子读成一个网格的全部依据。
    /// 板子自己不再另加行距（`TerminalKeyboardPanel.boardPage`），所以这里多出来的任何
    /// 一档都不会被第二个地方补上或抵消。
    @Test func theRowPitchIsTheKeyPlusOneGap() {
        #expect(KeyboardPanelMetrics.rowPitch == KeyboardPanelMetrics.keyHeight + KeyboardPanelMetrics.rowGap)
    }

    /// 六行仍然装得进一屏竖屏的高度：面板一页最多也就这么高。
    @Test func theTallerPageStillFitsAPortraitScreen() {
        let portrait = KeyboardPanelMetrics.height(rows: functionRows)
        #expect(KeyboardPanelMetrics.height(rows: functionRows, fitting: 781) == portrait)
        // 横屏：屏幕只有 360 上下，两页都封在同一个比例上，所以翻页仍然不动。
        let short = KeyboardPanelMetrics.height(rows: functionRows, fitting: 360)
        #expect(short == KeyboardPanelMetrics.height(rows: computerRows, fitting: 360))
        #expect(short < KeyboardPanelMetrics.height(rows: computerRows))
    }

    /// 还没量到高度的那一帧（第一次布局）给整页的高度，不给零点几的比例 —— 否则面板
    /// 会以一帧的塌陷开场。
    @Test func anUnmeasuredScreenGetsTheFullHeight() {
        #expect(KeyboardPanelMetrics.height(rows: functionRows, fitting: 0)
            == KeyboardPanelMetrics.height(rows: functionRows))
        #expect(KeyboardPanelMetrics.height(rows: computerRows, fitting: -1)
            == KeyboardPanelMetrics.height(rows: computerRows))
    }
}
