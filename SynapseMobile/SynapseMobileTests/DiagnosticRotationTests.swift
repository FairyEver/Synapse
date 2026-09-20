import Foundation
import Testing

@testable import SynapseMobile

/// 什么时候换文件、该删哪些。
///
/// 这一层是纯算术，所以边界情况能被穷举 —— 只剩一个文件、刚好多一字节、总量超顶。
/// 它一旦自己去删文件，这些用例就得真的动磁盘，也就没人愿意写了。
struct DiagnosticRotationTests {
    private let limits: DiagnosticRotation.Limits = {
        var limits = DiagnosticRotation.Limits()
        limits.maxFileBytes = 100
        limits.maxFiles = 3
        limits.maxTotalBytes = 250
        return limits
    }()

    /// `ageMinutes` 越大越**旧**，所以时间戳取负 —— 写成正的会把"最旧优先"
    /// 悄悄反过来，而用例仍然"过"，只是过在错的那条上。
    private func file(_ name: String, _ size: Int, ageMinutes: Int) -> DiagnosticFileInfo {
        DiagnosticFileInfo(
            name: name,
            sizeBytes: size,
            modified: Date(timeIntervalSince1970: -Double(ageMinutes) * 60)
        )
    }

    @Test func aFileWithRoomIsNotRotated() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [file("active.log", 50, ageMinutes: 0)],
            incomingBytes: 40,
            limits: limits
        )
        #expect(plan.shouldRotate == false)
    }

    /// 正好到上限不轮转 —— `>` 而不是 `>=`。差一字节就换文件的话，
    /// 一个刚过线的批次会让文件数翻倍。
    @Test func exactlyAtTheLimitIsStillFine() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [file("active.log", 60, ageMinutes: 0)],
            incomingBytes: 40,
            limits: limits
        )
        #expect(plan.shouldRotate == false)
    }

    @Test func oneByteOverRotates() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [file("active.log", 61, ageMinutes: 0)],
            incomingBytes: 40,
            limits: limits
        )
        #expect(plan.shouldRotate)
    }

    /// 空文件永远不轮转。
    ///
    /// 少了这条，一个超过单文件上限的大批次会让 App 无限换文件：新建、发现不够大、
    /// 再新建 —— 一个字节也写不进去，看起来像日志坏了。
    @Test func anEmptyFileIsNeverRotated() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [file("active.log", 0, ageMinutes: 0)],
            incomingBytes: limits.maxFileBytes * 10,
            limits: limits
        )
        #expect(plan.shouldRotate == false)
    }

    // MARK: - 删除

    /// 超出总封顶时删最旧的**非活动**文件。
    @Test func theOldestInactiveFileGoesFirst() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [
                file("active.log", 50, ageMinutes: 0),
                file("b.log", 110, ageMinutes: 5),
                file("a.log", 110, ageMinutes: 9),
            ],
            incomingBytes: 50,
            limits: limits
        )
        #expect(plan.removals == ["a.log"])
    }

    /// 活动文件**永远不在删除候选里**。
    ///
    /// 删掉它等于把当前这段日志连同还没落盘的内容一起丢掉，而"越写越少"是最难查的
    /// 那种坏法：日志看起来在正常工作，只是内容不对。
    @Test func theActiveFileIsNeverRemoved() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [file("active.log", 9_000, ageMinutes: 0)],
            incomingBytes: 10,
            limits: limits
        )
        #expect(!plan.removals.contains("active.log"))
        #expect(plan.removals.isEmpty)
    }

    /// 删到刚好合规就停手，不多删。
    @Test func removalStopsAsSoonAsItFits() {
        var tight = limits
        tight.maxFiles = 10
        tight.maxTotalBytes = 250
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [
                file("active.log", 50, ageMinutes: 0),
                file("c.log", 80, ageMinutes: 3),
                file("b.log", 80, ageMinutes: 6),
                file("a.log", 80, ageMinutes: 9),
            ],
            incomingBytes: 0,
            limits: tight
        )
        #expect(plan.removals == ["a.log"])
    }

    @Test func fileCountAlsoTriggersRemoval() {
        let plan = DiagnosticRotation.plan(
            activeName: "active.log",
            files: [
                file("active.log", 10, ageMinutes: 0),
                file("c.log", 10, ageMinutes: 3),
                file("b.log", 10, ageMinutes: 6),
                file("a.log", 10, ageMinutes: 9),
            ],
            incomingBytes: 10,
            limits: limits
        )
        #expect(plan.removals.count >= 1)
        #expect(!plan.removals.contains("active.log"))
    }

    /// 各域配额之和不能超过愿意给这套日志的总量。
    ///
    /// 分域之后「总量封顶」不再是运行时的一次驱逐，而是**各配额相加这个构造性事实**。
    /// 于是它也就成了一件很容易在加一路、或把某一路调大时忘掉的事 —— 而那时磁盘上
    /// 真的会多占那么多，没有任何运行时代码会拦。
    @Test func laneQuotasStayUnderTheDiskCeiling() {
        #expect(DiagnosticRotation.Limits.diskCeilingBytes <= 10 << 20)
        for lane in DiagnosticLane.allCases {
            let limits = DiagnosticRotation.Limits.forLane(lane)
            #expect(limits.maxFiles >= 1, "\(lane.rawValue) 一路都不留，等于没开这一路")
            #expect(
                limits.maxFiles * limits.maxFileBytes >= limits.maxTotalBytes,
                "\(lane.rawValue) 的 maxTotalBytes 比自己 maxFiles 个满文件还大，那一格是死的"
            )
        }
    }

    /// 每一路拿到的都是自己那一份配额，不是同一份。
    @Test func eachLaneGetsItsOwnQuota() {
        #expect(DiagnosticRotation.Limits.forLane(.term) != DiagnosticRotation.Limits.forLane(.env))
        #expect(DiagnosticRotation.Limits.perLane.count == DiagnosticLane.allCases.count)
        #expect(DiagnosticRotation.Limits.perLane[.term] == DiagnosticRotation.Limits.forLane(.term))
    }
}

/// 一行一条是这份文件唯一的结构保证。
///
/// 读它的是 `grep`、是 `sort`，也是我。一条记录断成两行，后面每一处解析都会错位，
/// 而错位看起来很像是"日志本身坏了"。
struct DiagnosticLineRenderTests {
    @Test func anEmbeddedNewlineDoesNotSplitTheLine() {
        let record = DiagnosticRecord(
            seq: 1,
            time: Date(timeIntervalSince1970: 0),
            level: .info,
            event: .terminalEnter,
            fields: [.init(.reason, .message(RedactedMessage(alreadyRedacted: "first\nsecond")))]
        )
        let line = DiagnosticLineRenderer.render(record)
        #expect(!line.contains("\n"))
        #expect(line.contains("first\\nsecond"))
    }

    /// 单条记录整体超限时，整行被截断。
    ///
    /// 值本身先各自被卡过一次（`RedactedMessage` 卡 256 字节），所以要撞到行的上限
    /// 得有**好几个**长字段 —— 这也正是真实情况：一条崩溃记录会带上栈和若干上下文。
    @Test func anOverlongRecordIsTruncatedWithAMarker() {
        let long = RedactedMessage(alreadyRedacted: String(repeating: "x", count: 250))
        let record = DiagnosticRecord(
            seq: 1,
            time: Date(timeIntervalSince1970: 0),
            level: .info,
            event: .terminalEnter,
            fields: (0..<12).map { _ in .init(.reason, .message(long)) }
        )
        let line = DiagnosticLineRenderer.render(record)
        #expect(line.contains(DiagnosticTruncation.marker))
        #expect(line.utf8.count <= DiagnosticLineRenderer.maxRecordBytes + DiagnosticTruncation.marker.utf8.count)
    }

    /// 带栈的那条放宽 —— 栈是崩溃现场的全部，用 2 KiB 卡它等于把最有用的部分切掉。
    @Test func aRecordCarryingAStackGetsMoreRoom() {
        let record = DiagnosticRecord(
            seq: 1,
            time: Date(timeIntervalSince1970: 0),
            level: .error,
            event: .uncaughtException,
            fields: [
                .init(.stack, .stack(RedactedStack(redacting: String(repeating: "frame ", count: 1_000)))),
            ]
        )
        let line = DiagnosticLineRenderer.render(record)
        #expect(line.utf8.count > DiagnosticLineRenderer.maxRecordBytes)
        #expect(line.utf8.count <= DiagnosticLineRenderer.maxRecordBytesWithStack + DiagnosticTruncation.marker.utf8.count)
    }

    @Test func everyValueKindRendersToSomethingReadable() {
        #expect(DiagnosticLineRenderer.render(.int(42)) == "42")
        #expect(DiagnosticLineRenderer.render(.scalar(12.34)) == "12.3")
        #expect(DiagnosticLineRenderer.render(.bool(true)) == "T")
        #expect(DiagnosticLineRenderer.render(.durationMs(180)) == "180ms")
        #expect(DiagnosticLineRenderer.render(.flag(.phoneDriven)) == "phoneDriven")
        #expect(DiagnosticLineRenderer.render(.redacted(.token)) == "<token>")
        #expect(DiagnosticLineRenderer.render(.alias(DiagnosticAlias(kind: .session, number: 3))) == "s3")
    }

    /// 时间是本地时区：读日志的人对着自己的钟找"那一下"。
    @Test func timestampsAreHumanReadable() {
        let line = DiagnosticLineRenderer.render(
            DiagnosticRecord(seq: 1, time: Date(), level: .info, event: .launch, fields: [])
        )
        #expect(line.first!.isNumber)
        #expect(line.contains(" I app.launch #1"))
    }
}
