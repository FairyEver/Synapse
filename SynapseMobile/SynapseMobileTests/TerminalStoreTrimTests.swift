import Foundation
import Testing

@testable import SynapseMobile

/// 缓冲区到顶之后的稳态。
///
/// 裁剪原来是「丢掉头部再**把剩下的全部重新折一遍**」，现在只丢头部、并且按
/// `trimBatchRows` 成批发生。两者在屏幕上必须一模一样，所以这里钉的是结果而不是做法 ——
/// 而稳态恰恰是最容易出错的地方：落在这条路上的偏移换算、`oldestIndex` 和
/// `rowsFirstLine` 只要差一格，终端就会从某一行开始整体错位，或者最老的那行永远滚不出去。
@MainActor
struct TerminalStoreTrimTests {
    private func line(_ text: String) throws -> TerminalLine {
        try JSONDecoder().decode(TerminalLine.self, from: Data("[\"\(text)\",[]]".utf8))
    }

    private func frame(lines: [TerminalLine], from: Int) -> MobileTerminalFrame {
        MobileTerminalFrame(
            sessionId: "session",
            kind: "suffix",
            from: from,
            lines: lines,
            total: from + lines.count,
            cursor: TerminalCursor(row: 0, col: 0, visible: false),
            alt: false,
            truncated: false,
            seq: 1,
            sizeRevision: 1
        )
    }

    /// 一行一帧地推过上限，头部按批移动，最新那一行必须一直在。
    ///
    /// 这里刻意**一行一帧**：批量推 6000 行只会在一次调用里裁一次，而真机上跑起来的是
    /// 这个循环 —— 输出每来一帧就裁一次，那才是这段代码真正被调用的形状。
    ///
    /// 稳态不再是「进一行丢一行」，而是「进一批丢一批」（见 `trimBatchRows`）：一批之
    /// 内头部不动、缓冲区只是长高。每一帧都要成立的约束没变 —— 最新的那行在、头部与
    /// `oldestIndex` 同步、行数不越上限。
    @Test func theHeadMovesInBatchesAndTheNewestLineStays() throws {
        let store = TerminalStore()
        store.update(columns: 80)
        let filler = try line("x")

        // 一次越过上限，进入稳态：一次推 6_002 行，头部直接落到批次水位。
        store.apply(frame(lines: Array(repeating: filler, count: 6_002), from: 0))
        #expect(store.rows.first?.lineIndex == 513)
        #expect(store.oldestIndex == 513)

        // 一批之内：头部不动，只是长高，最新的那一行一直在。
        let batchFloor = store.rows.count

        for step in 1...512 {
            let newest = 6_001 + step
            store.apply(frame(lines: [try line("line \(step)")], from: newest))

            #expect(store.oldestIndex == 513)
            #expect(store.rows.first?.lineIndex == 513)
            #expect(store.rows.last?.lineIndex == newest)
            #expect(store.rows.last?.text == "line \(step)")
            #expect(store.rows.count == batchFloor + step)
            // 上限一点没抬：长到顶就裁，和改动前触发的那一帧是同一帧。
            #expect(store.rows.count <= 6_001)
        }

        // 第 513 行把这一批走完：头部一次前移一整批，行数回到批次水位。
        store.apply(frame(lines: [try line("batch two")], from: 6_514))
        #expect(store.oldestIndex == 1_026)
        #expect(store.rows.first?.lineIndex == 1_026)
        #expect(store.rows.last?.lineIndex == 6_514)
        #expect(store.rows.last?.text == "batch two")
        #expect(store.rows.count == batchFloor)
    }

    /// 后缀语义在裁剪之后照样成立：帧说什么，尾部就是什么。
    ///
    /// 裁剪改的是头部，而 `from` 落在头部附近时两者会碰面 —— 碰错了的表现是终端下半屏
    /// 变成上一次输出的残影，看起来像渲染没刷新。
    @Test func aSuffixRewriteStillWinsOverWhatWasThere() throws {
        let store = TerminalStore()
        store.update(columns: 80)
        let filler = try line("x")
        store.apply(frame(lines: Array(repeating: filler, count: 6_002), from: 0))

        let before = store.rows.count

        // 从倒数第三行起整段改写：这一帧之后，从那行往后的内容只可能是它给的。
        let rewrite = [try line("A"), try line("B"), try line("C")]
        store.apply(frame(lines: rewrite, from: 5_999))

        #expect(store.rows.suffix(3).map(\.text) == ["A", "B", "C"])
        #expect(store.rows.last?.lineIndex == 6_001)
        // 改写落在现有的行里（没跨过上限），缓冲区不该因此变长或变短。
        #expect(store.rows.count == before)
    }
}
