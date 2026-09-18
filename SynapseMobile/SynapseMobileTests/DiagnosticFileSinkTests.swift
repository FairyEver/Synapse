import Foundation
import Testing

@testable import SynapseMobile

/// 真的落盘、真的读回来。
///
/// 上面几个套件验的是纯算术，而这一套验的是那份算术有没有真的变成文件里的字节。
/// 中间隔着一层文件系统，而"日志写不进去"恰恰是这套机制最安静的失效方式 ——
/// 它不会报错、不会崩，只是你事后拿到一个空文件。
struct DiagnosticFileSinkTests {
    private func makeDirectory() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("diag-test-\(UUID().uuidString)", isDirectory: true)
    }

    private func files(in directory: URL) -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil))?
            .filter { $0.pathExtension == "log" } ?? []
    }

    private func text(of directory: URL) -> String {
        files(in: directory)
            .compactMap { try? String(contentsOf: $0, encoding: .utf8) }
            .joined()
    }

    /// 记的东西要真的到文件里。
    @Test func recordsReachTheFile() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .terminalEnter, level: .info, fields: [
            .init(.rowCount, .int(42)),
            .init(.displayMode, .flag(.desktopDriven)),
        ])
        sink.flushForTesting()

        let written = text(of: directory)
        #expect(written.contains("term.enter"))
        #expect(written.contains("rowCount=42"))
        #expect(written.contains("displayMode=desktopDriven"))
    }

    /// **最要紧的一条**：带 canary 的内容一个字都不许落到文件里。
    ///
    /// 前面那个套件验的是脱敏函数本身；这一条验的是"它有没有被真的用上"——
    /// 一条绕过脱敏的路径在这里会露出来。
    @Test func canariesNeverReachTheFile() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let canary = "canary-must-not-land-7d3f"
        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .networkError, level: .error, fields: [
            .init(.reason, .message(RedactedMessage(redacting: "Bearer \(canary)"))),
            .init(.stack, .stack(RedactedStack(redacting: "token=\(canary)"))),
        ])
        sink.flushForTesting()

        let written = text(of: directory)
        #expect(!written.contains(canary))
        #expect(written.contains("[redacted]"))
    }

    /// 换文件时，旧的那个被改名留下，新的接着写 —— 两个文件都在，内容不重不漏。
    @Test func rotationKeepsBothFiles() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        var limits = DiagnosticRotation.Limits()
        // 单文件卡小到几十字节会在 10 个文件之内就把最早那几条回收掉 —— 那是它该
        // 做的，但会让"第一条还在不在"这个问题失去意义。这个尺寸换来 3-4 次轮转。
        limits.maxFileBytes = 1_200
        let sink = try #require(DiagnosticFileSink(directory: directory, limits: limits))
        sink.start()
        // 用 `.action` 而不是 `.terminalRows`：那一档有采样，同毫秒里连着发 40 条
        // 只会放行一条（采样本来就是这么设计的），而这一条用例要验的是轮转。
        for index in 0..<40 {
            sink.append(event: .action, level: .info, fields: [
                .init(.rowCount, .int(index)),
                .init(.cellHeight, .scalar(19)),
                .init(.boundsHeight, .scalar(566)),
            ])
            sink.flushForTesting()
        }
        let written = text(of: directory)
        #expect(files(in: directory).count > 1, "没有换过文件")
        // 第一条与最后一条都还在：换文件不该丢内容。
        #expect(written.contains("rowCount=0"))
        #expect(written.contains("rowCount=39"))
    }

    /// 删除之后，App 不重启也能继续记 —— 目录是下次写入时惰性重建的。
    ///
    /// 少了这条，用户按下"删除"之后这份日志就永远停在那里了，而他下一次复现
    /// 只会拿到一个空的分享文件。
    @Test func deletingEverythingStillLetsNewRecordsThrough() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .launch, level: .info, fields: [])
        sink.flushForTesting()
        #expect(!text(of: directory).isEmpty)

        sink.deleteAll()
        #expect(files(in: directory).isEmpty)

        sink.setEnabled(true)
        sink.append(event: .launch, level: .info, fields: [.init(.coldStart, .bool(false))])
        sink.flushForTesting()
        #expect(text(of: directory).contains("coldStart=F"))
    }

    /// 关掉开关只停记录，**不删已有日志**。
    @Test func turningItOffKeepsWhatIsAlreadyThere() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .launch, level: .info, fields: [])
        sink.flushForTesting()
        let before = text(of: directory)

        sink.setEnabled(false)
        sink.append(event: .action, level: .info, fields: [])
        sink.flushForTesting()

        #expect(text(of: directory) == before)
    }

    /// 上一次没收尾，才叫疑似崩溃；收过尾的不算。
    @Test func anUnclosedSessionIsReportedAsACrash() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let first = try #require(DiagnosticFileSink(directory: directory))
        first.start()
        first.append(event: .sessionOpen, level: .info, fields: [])
        first.flushForTesting()
        #expect(first.previousSessionTail() != nil, "没写 sessionClose 却没被认成疑似崩溃")

        let second = try #require(DiagnosticFileSink(directory: directory))
        second.start()
        second.append(event: .sessionClose, level: .info, fields: [])
        second.flushForTesting()
        #expect(second.previousSessionTail() == nil, "正常收尾的会话被误判成了崩溃")
    }

    /// 导出的文件带头部、能被读回来，并且**不因为读不到就崩**。
    @Test func exportProducesAShareableFile() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .launch, level: .info, fields: [])
        sink.flushForTesting()

        let url = try #require(sink.export(header: "# 测试头部\n"))
        defer { try? FileManager.default.removeItem(at: url) }
        let content = try String(contentsOf: url, encoding: .utf8)
        #expect(content.hasPrefix("# 测试头部"))
        #expect(content.contains("app.launch"))
    }
}
