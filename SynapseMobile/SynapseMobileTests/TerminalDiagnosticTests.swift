import CoreGraphics
import Foundation
import Testing
import UIKit

@testable import SynapseMobile

/// 终端那组埋点到底会不会产出记录。
///
/// 前面几个套件验的是日志机制本身，这个验的是**它们接上了没有**。埋点最典型的
/// 失效方式不是写错，是根本没被调用到 —— 而那在编译期、在其它测试里都看不出来，
/// 要等到你拿到一份干净得像刚格式化的日志才发现。
@MainActor
struct TerminalDiagnosticTests {
    private func makeDirectory() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("term-diag-\(UUID().uuidString)", isDirectory: true)
    }

    /// 目录下写进去的全部内容，**递归**。
    ///
    /// 分域之后每路是根目录下的一个子目录，浅列举会一条都读不到 —— 而那会让下面每一条
    /// 断言都以「日志是空的」的名义红掉，看起来像埋点没接上，其实是读取方式陈旧了。
    private func written(in directory: URL) -> String {
        let children = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []
        return children.compactMap { url -> String? in
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            if isDirectory { return written(in: url) }
            guard url.pathExtension == "log" else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }
        .joined()
    }

    private func lines(_ count: Int) -> [DisplayRow] {
        (0..<count).map { index in
            DisplayRow(id: "line\(index)", text: "line \(index)", runs: [], lineIndex: index, isContinuation: false)
        }
    }

    private func collectionView(in view: UIView) -> UICollectionView? {
        if let found = view as? UICollectionView { return found }
        for sub in view.subviews {
            if let found = collectionView(in: sub) { return found }
        }
        return nil
    }

    /// 铺一屏行、滚一次，日志里应当既有行数也有滚动几何。
    @Test func rowsAndScrollProduceRecords() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        defer { DiagnosticLog.useSinkForTesting(nil) }

        let view = TerminalCollectionView(frame: CGRect(x: 0, y: 0, width: 393, height: 566))
        view.applyLayout(displayMode: .phoneDriven, desktopGrid: nil, fontSize: TerminalDensity.normal.fontSize)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        view.setNeedsLayout()
        view.layoutIfNeeded()

        let list = try #require(collectionView(in: view))
        list.delegate?.scrollViewDidScroll?(list)
        sink.flushForTesting()

        let text = written(in: directory)
        #expect(text.contains("term.rows"), "铺行没有产出记录")
        #expect(text.contains("term.scrollTick"), "滚动没有产出记录")
        #expect(text.contains("isScrollEnabled=T"), "滚动几何里没有滚动开关这一项")
    }

    /// 一次拖动结束时的结论里，必须有"内容到底动没动"。
    ///
    /// 这是整份日志里最值钱的一个布尔：一次既没缩放也没选字的拖动，如果它是 F，
    /// 那内容没动就只剩"手势被别的东西抢走了"这一种解释。
    @Test func aDragEndsWithWhetherTheContentMoved() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        defer { DiagnosticLog.useSinkForTesting(nil) }

        let view = TerminalCollectionView(frame: CGRect(x: 0, y: 0, width: 393, height: 566))
        view.applyLayout(displayMode: .phoneDriven, desktopGrid: nil, fontSize: TerminalDensity.normal.fontSize)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        view.setNeedsLayout()
        view.layoutIfNeeded()

        let list = try #require(collectionView(in: view))
        list.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        list.delegate?.scrollViewWillBeginDragging?(list)
        list.setContentOffset(CGPoint(x: 0, y: 300), animated: false)
        list.delegate?.scrollViewDidEndDragging?(list, willDecelerate: false)
        sink.flushForTesting()

        let text = written(in: directory)
        #expect(text.contains("gesture.outcome"))
        #expect(text.contains("didMoveScrollOffset=T"), "挪了 200 点却被记成没动")
    }

    /// 拉回最新一行要记下**是谁触发的**。
    ///
    /// 滚不动那类报告里，"用户自己拖的"和"我们把视口拽回去的"在屏幕上一模一样，
    /// 而这两件事的修法完全不同。
    @Test func followingTheTailRecordsItsTrigger() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        defer { DiagnosticLog.useSinkForTesting(nil) }

        let view = TerminalCollectionView(frame: CGRect(x: 0, y: 0, width: 393, height: 566))
        view.applyLayout(displayMode: .phoneDriven, desktopGrid: nil, fontSize: TerminalDensity.normal.fontSize)
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)
        view.setNeedsLayout()
        view.layoutIfNeeded()

        // 站到顶部，再送一批新行进来 —— 视图会跟着最新输出落回底部。
        let list = try #require(collectionView(in: view))
        list.setContentOffset(.zero, animated: false)
        list.delegate?.scrollViewDidScroll?(list)
        view.apply(rows: lines(240), atHistoryFloor: false, cursor: nil)
        list.setNeedsLayout()
        list.layoutIfNeeded()
        sink.flushForTesting()

        let text = written(in: directory)
        #expect(text.contains("followGrab"), "跟随最新输出没有留下痕迹")
    }

    /// 一次没能进去的打开请求必须留下记录，连同**是谁在问**。
    ///
    /// 这条记录为一个具体的坑而存在：手机上有五条路能进终端页，而只有会话列表那一行是
    /// 当场取会话号的，另外四条带的都是某一刻记下来的号。它们的请求被拒绝时，那句
    /// 「这个会话已经结束了。」会被画在**另一个**会话的画布上 —— 而「是哪条路在问」
    /// 当时在手机上完全没有记录，排查只能推到「不是正在看着的那个会话」，再往前就没了。
    @Test func aRefusedOpenRecordsWhichEntryAsked() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        defer { DiagnosticLog.useSinkForTesting(nil) }

        let fields = try #require(SynapseAppModel.terminalOpenRecordFields(
            sessionId: "11111111-2222-3333-4444-555555555555",
            decision: .ended,
            origin: .inboxRecord
        ))
        DiagnosticLog.record(.terminalLifecycle, fields)
        sink.flushForTesting()

        let text = written(in: directory)
        #expect(text.contains("term.lifecycle"), "拒绝打开没有留下记录")
        #expect(text.contains("outcome=rejected"))
        #expect(text.contains("entry=inboxRecord"), "记录里没有说清是哪条路在问")
        #expect(text.contains("session=s"), "记录里没有那个被点名的会话")
    }

    /// 正常打开不记。
    ///
    /// 每一次点行都留一条的话，它要回答的那一格就淹在噪声里了 —— 这条记录值的只有
    /// 「为什么没进去」。
    @Test func aNormalOpenIsNotRecorded() {
        #expect(SynapseAppModel.terminalOpenRecordFields(
            sessionId: "s",
            decision: .openable,
            origin: .sessionList
        ) == nil)
    }

    /// 五个入口各有自己的词。
    ///
    /// 混成一个就分不出「会话列表这条路自己出了问题」（判据或列表有缺陷）与「一条旧记录
    /// 在问一个已经结束的会话」（上一版设计里预料到的事）—— 而这两件事的修法完全不同。
    @Test func everyEntryHasItsOwnWord() {
        let origins: [TerminalOpenOrigin] = [
            .sessionList, .pushNotification, .inboxRecord, .homeWidget, .queuedRequest,
        ]
        let words = Set(origins.map(\.diagnosticFlag.rawValue))

        #expect(words.count == origins.count, "有两个入口在日志里是同一个词")
        #expect(origins.map(\.diagnosticFlag).contains(.sessionList), "列表这个入口没有自己的词")
    }

    /// 滑行那条路也要留下痕迹。
    ///
    /// 上面那条走的是「插不了值」的回落路径（视图没有窗口），而生产上走的是滑行：
    /// 埋点最典型的失效方式不是写错，是接上了却没人走它。
    @Test func theGlideRecordsItsTriggerToo() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        defer { DiagnosticLog.useSinkForTesting(nil) }

        let pane = CGRect(x: 0, y: 0, width: 393, height: 566)
        let view = TerminalCollectionView(frame: pane)
        view.applyLayout(
            displayMode: .phoneDriven,
            desktopGrid: nil,
            fontSize: TerminalDensity.normal.fontSize
        )
        view.apply(rows: lines(200), atHistoryFloor: false, cursor: nil)

        // 有窗口才有滑行 —— 没有窗口时视图会有意退回一步落位。
        //
        // `animatesFollow` 也要摁成 true：它默认跟着系统的「减弱动态效果」走，而那是一个
        // 跟着目标机走的环境量。开了它的模拟器上 `followNewestLine()` 整条走回落路径，
        // 这条用例就会红在一个跟被测代码毫无关系的地方 —— 而它红得对，因为那时它验的
        // 确实不是「滑行留下了痕迹」。
        view.animatesFollow = true
        let window = UIWindow(frame: pane)
        window.addSubview(view)
        window.isHidden = false
        view.setNeedsLayout()
        view.layoutIfNeeded()
        defer {
            view.removeFromSuperview()
            window.isHidden = true
        }

        view.apply(rows: lines(240), atHistoryFloor: false, cursor: nil)
        #expect(view.isFollowingPerFrame, "没有滑行，这条测试验的就不是那条路")

        // 记录写在落定那一刻。
        let deadline = Date().addingTimeInterval(1.5)
        while Date() < deadline, view.isFollowingPerFrame {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        sink.flushForTesting()

        #expect(written(in: directory).contains("followGrab"), "滑行没有留下痕迹")
    }
}
