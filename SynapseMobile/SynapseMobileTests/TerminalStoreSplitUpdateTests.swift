import Foundation
import Testing

@testable import SynapseMobile

/// 一次更新装不下一个帧时，电脑把它切成好几条发下来。每条都带同一个 `total` ——
/// 那是**整次更新**的结尾；而每条自己的 `from + lines.count` 只是**这一块**的结尾。
///
/// 作废边界取块尾会怎样：第一块单独落地时，它把上面所有还没到的行整片删掉，缓冲区
/// 当场塌成第一块那么大。贴底的读者被甩回几百行之前，后面几块再一块块把他带回来 ——
/// 那就是"终端自己上下狂滚"。缓冲区里还会留下一个洞（`appendWrapped` 遇到缺口就停），
/// 洞后面的行即使收到了也画不出来。
///
/// 所以这三条钉的是同一件事的两面：分块期间**不许**删，而电脑说这次更新真的只到这么
/// 远时**必须**删。
@MainActor
struct TerminalStoreSplitUpdateTests {
    private func line(_ text: String) throws -> TerminalLine {
        try JSONDecoder().decode(TerminalLine.self, from: Data("[\"\(text)\",[]]".utf8))
    }

    private func frame(
        kind: String = "suffix",
        from: Int,
        lines: [TerminalLine],
        total: Int
    ) -> MobileTerminalFrame {
        MobileTerminalFrame(
            sessionId: "session",
            kind: kind,
            from: from,
            lines: lines,
            total: total,
            cursor: TerminalCursor(row: 0, col: 0, visible: false),
            alt: false,
            truncated: false,
            seq: 1,
            sizeRevision: 1
        )
    }

    private func store(holding count: Int) throws -> (TerminalStore, [TerminalLine]) {
        let store = TerminalStore()
        store.update(columns: 80)
        let lines = try (0..<count).map { try line("line-\($0)") }
        store.apply(frame(kind: "reset", from: 0, lines: lines, total: count))
        return (store, lines)
    }

    @Test func keepsTheLinesALaterChunkStillOwes() throws {
        let (store, lines) = try store(holding: 500)
        #expect(store.rows.count == 500)

        // 同一次更新的第一块：只到 177，而这次更新到 500。
        store.apply(frame(from: 100, lines: Array(lines[100..<177]), total: 500))

        // 按块尾作废的话，178 往后当场就没了 —— 而它们正是第二块要补上来的。
        #expect(store.rows.count == 500)
        #expect(store.rows.map(\.lineIndex) == Array(0..<500))
    }

    @Test func convergesOnceEveryChunkHasLanded() throws {
        let (store, lines) = try store(holding: 500)

        store.apply(frame(from: 100, lines: Array(lines[100..<177]), total: 500))
        store.apply(frame(from: 177, lines: Array(lines[177..<500]), total: 500))

        // 逐块收敛到与"整块一次到"完全一样的状态。
        #expect(store.rows.count == 500)
        #expect(store.rows.map(\.lineIndex) == Array(0..<500))
        #expect(store.rows.last?.text == "line-499")
    }

    @Test func stillTrimsWhenTheUpdateReallyEndsEarlier() throws {
        let (store, lines) = try store(holding: 500)

        // 电脑说这次更新只到 80，而且没有后续的块。那是终端真的短了 —— 该删的必须删，
        // 不然读者会一直看着电脑已经不再持有的行。
        store.apply(frame(from: 0, lines: Array(lines[0..<80]), total: 80))

        #expect(store.rows.count == 80)
    }
}
