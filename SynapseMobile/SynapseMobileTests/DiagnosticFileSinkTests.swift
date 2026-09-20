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

    /// 目录下的日志文件，**递归**。
    ///
    /// 分域之后每路是根目录下的一个子目录，所以「这个 sink 写了什么」不再是一次
    /// 浅列举能答的问题。给一个具体域时只看那一路。
    private func files(in directory: URL, lane: DiagnosticLane? = nil) -> [URL] {
        if let lane {
            let laneDirectory = directory.appendingPathComponent(lane.directoryName, isDirectory: true)
            return ((try? FileManager.default.contentsOfDirectory(
                at: laneDirectory,
                includingPropertiesForKeys: nil
            )) ?? []).filter { $0.pathExtension == "log" }
        }
        let children = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []
        return children.flatMap { url -> [URL] in
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                return url.pathExtension == "log" ? [url] : []
            }
            return files(in: url)
        }
    }

    private func text(of directory: URL, lane: DiagnosticLane? = nil) -> String {
        files(in: directory, lane: lane)
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
        let sink = try #require(
            DiagnosticFileSink(directory: directory, quotas: DiagnosticRotation.Limits.uniform(limits))
        )
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

    private func manifest(includesTerminalContent: Bool = false) -> DiagnosticExportManifest {
        DiagnosticExportManifest(
            exportedAt: "2026-09-20T21:00:00Z",
            timeZone: "Asia/Shanghai",
            app: .init(version: "1.0.8", build: "23"),
            device: .init(model: "iPhone17,1", name: "测试机"),
            os: "26.0",
            includesTerminalContent: includesTerminalContent,
            counters: .init(written: 1, dropped: 0, overwritten: 0),
            redaction: .init(markers: ["[redacted]", "[key]"], note: "测试")
        )
    }

    /// 导出是一个能解开的压缩包：结构、README、manifest 都在，内容对得上。
    @Test func exportProducesAShareableArchive() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .launch, level: .info, fields: [])
        sink.append(event: .frame, level: .info, fields: [.init(.bytes, .int(1_200))])
        sink.flushForTesting()

        let url = try #require(await sink.export(header: "# 测试头部\n", manifest: manifest()))
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(url.pathExtension == "zip")

        let read = try ZipReader(try Data(contentsOf: url))
        #expect(read.corrupt.isEmpty, "包里有 CRC 对不上的条目：\(read.corrupt)")

        // 解压出来再套一层同名目录：不会把一堆 .log 直接撒进解压的人那层目录里。
        let root = try #require(read.items.first?.name.split(separator: "/").first.map(String.init))
        #expect(root.hasPrefix("synapse-diagnostics-"))

        let names = Set(read.items.map(\.name))
        #expect(names.contains("\(root)/README.txt"))
        #expect(names.contains("\(root)/manifest.json"))
        #expect(names.contains { $0.hasPrefix("\(root)/app/") && $0.hasSuffix(".log") })
        #expect(names.contains { $0.hasPrefix("\(root)/net/") && $0.hasSuffix(".log") })

        let readme = try #require(read.items.first { $0.name.hasSuffix("README.txt") })
        #expect(String(decoding: readme.data, as: UTF8.self).hasPrefix("# 测试头部"))

        let manifestItem = try #require(read.items.first { $0.name.hasSuffix("manifest.json") })
        let json = try #require(
            try JSONSerialization.jsonObject(with: manifestItem.data) as? [String: Any]
        )
        #expect(json["schema"] as? Int == 1)
        #expect(json["includesTerminalContent"] as? Bool == false)
        let lanes = try #require(json["lanes"] as? [[String: Any]])
        #expect(lanes.contains { $0["lane"] as? String == "app" && $0["truncated"] as? Bool == false })
        #expect(lanes.contains { $0["lane"] as? String == "net" })

        // 内容真的在包里，不是只有一个空壳。
        let appFile = try #require(read.items.first { $0.name.hasPrefix("\(root)/app/") })
        #expect(String(decoding: appFile.data, as: UTF8.self).contains("app.launch"))
    }

    /// **最要紧的那条不变量的另一半**：canary 也不许出现在压缩包里。
    ///
    /// 必须在**解压之后**搜。压缩字节里碰巧出现 canary 子串的概率极低，但极低不等于零 ——
    /// 而这条断言要的是"交出去的东西里没有它"，那就得看交给别人的那副样子。
    @Test func canariesNeverReachTheArchive() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let canary = "canary-must-not-ship-3c9a"
        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .networkError, level: .error, fields: [
            .init(.reason, .message(RedactedMessage(redacting: "Bearer \(canary)"))),
        ])
        sink.flushForTesting()

        let url = try #require(await sink.export(header: "# 头部\n", manifest: manifest()))
        defer { try? FileManager.default.removeItem(at: url) }
        let read = try ZipReader(try Data(contentsOf: url))

        for item in read.items {
            let text = String(decoding: item.data, as: UTF8.self)
            #expect(!text.contains(canary), "\(item.name) 里带着 canary")
        }
    }

    /// 上一次导出的产物会被下一次删掉。
    ///
    /// 导出会重复发生（发一次不够就再发一次），不清理的话 tmp 里每导一次多留一份。
    @Test func exportingAgainReplacesThePreviousArtifact() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .launch, level: .info, fields: [])
        sink.flushForTesting()

        let first = try #require(await sink.export(header: "# 一\n", manifest: manifest()))
        // 时间戳按秒，同一秒内两次导出会撞成同一个文件名 —— 那就换个戳再导，
        // 否则这条用例验的是"同名没被删"（那本来也不该删）。
        try await Task.sleep(for: .milliseconds(1_100))
        let second = try #require(await sink.export(header: "# 二\n", manifest: manifest()))

        #expect(first != second)
        #expect(!FileManager.default.fileExists(atPath: first.path), "上一次的产物还在")
        #expect(FileManager.default.fileExists(atPath: second.path))
        try? FileManager.default.removeItem(at: second)
    }

    /// 没有内容可导时返回 nil，而不是一个空包。
    @Test func nothingToExportYieldsNoArchive() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        // 刻意不 start()：一个字节也没写过。
        let url = await sink.export(header: "# 头部\n", manifest: manifest())
        #expect(url == nil, "什么都没有却导出了一个包")
    }

    /// 每一路写进自己的文件，互不串门。
    ///
    /// 分域这件事的**唯一**承重断言：串门的话，分不分文件在屏幕上看不出来（记录都在，
    /// 只是都堆进了一个文件），而那正是分域要解决的那个问题。
    @Test func eachLaneWritesIntoItsOwnFile() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .frame, level: .info, fields: [.init(.bytes, .int(1_200))])
        sink.append(event: .terminalRows, level: .info, fields: [.init(.rowCount, .int(7))])
        sink.append(event: .launch, level: .info, fields: [])
        sink.flushForTesting()

        let net = text(of: directory, lane: .net)
        let term = text(of: directory, lane: .term)
        let app = text(of: directory, lane: .app)

        #expect(net.contains("net.frame"))
        #expect(!net.contains("term.rows"), "term 的记录跑进了 net 路")
        #expect(term.contains("term.rows"))
        #expect(!term.contains("net.frame"), "net 的记录跑进了 term 路")
        #expect(app.contains("app.launch"))

        // 一条记录都没写过的域不该凭空多出一个空文件 —— 那会让读日志的人以为
        // "这个域什么都没发生"，而事实是它根本没被接上。两者在屏幕上长得一样。
        #expect(files(in: directory, lane: .crash).isEmpty)
        #expect(files(in: directory, lane: .env).isEmpty)
    }

    /// 每一路各占多少字节要报得出来。
    ///
    /// 「某一路永远是空的」是这套机制最安静的失效方式：不报错、不崩，只是那条线索
    /// 永远不在。有了每路的字节数，界面上一眼就能看出是"没发生"还是"没接上"。
    @Test func snapshotReportsBytesPerLane() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .frame, level: .info, fields: [.init(.bytes, .int(1_200))])
        sink.append(event: .terminalRows, level: .info, fields: [.init(.rowCount, .int(7))])
        sink.flushForTesting()

        let snapshot = sink.snapshot()
        #expect(snapshot.bytes(in: .net) > 0)
        #expect(snapshot.bytes(in: .term) > 0)
        #expect(snapshot.bytes(in: .crash) == 0)
        #expect(snapshot.totalBytes == snapshot.laneBytes.values.reduce(0, +))
        #expect(snapshot.fileCount >= 2)
    }

    /// 分域之前留在根目录下的日志要被收编进 `app/`。
    ///
    /// 不收编的后果不是"看不到旧日志"，而是 `previousSessionTail()` 从此读不到东西 ——
    /// 它只认 app 路 —— 于是升级之后再也报不出「疑似崩溃」，而且没有任何报错。
    @Test func legacyLogsAtTheRootAreAdoptedIntoTheAppLane() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let legacyName = "synapse-20260919-120000-4242.log"
        try "# 诊断日志\n2026-09-19 12:00:00.000 I app.sessionOpen\n"
            .write(to: directory.appendingPathComponent(legacyName), atomically: true, encoding: .utf8)

        // 刻意**不调 `start()`**：收编发生在 `init` 里，而 `start()` 会异步建出一个
        // 新的空活动文件 —— 那个文件更新，`previousSessionTail()` 读到它就只有 nil，
        // 这条用例也就验不到"收编救了崩溃判据"这件事了。
        let sink = try #require(DiagnosticFileSink(directory: directory))

        #expect(
            files(in: directory, lane: .app).contains { $0.lastPathComponent == legacyName },
            "旧文件没有被收编进 app 路"
        )
        let stillAtRoot = ((try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        )) ?? []).filter { $0.pathExtension == "log" }
        #expect(stillAtRoot.isEmpty, "根目录下还留着 .log，收编没做完")
        #expect(sink.previousSessionTail() != nil, "收编之后仍然要认得上次没收尾")
    }

    /// 上一次会话收过尾了，就不能因为别的域更新而被判成疑似崩溃。
    ///
    /// **分域顺手修掉的一个真 bug**：从前这里按修改时间取全局最新的那个文件，而
    /// net 路几乎总比 app 路新 —— 读它就永远看不到 `app.sessionClose`，于是每一次
    /// 正常退出都会被记成 `app.crashSuspected`。
    @Test func aBusierLaneDoesNotShadowTheSessionClose() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        sink.append(event: .sessionOpen, level: .info, fields: [])
        sink.flushForTesting()
        sink.append(event: .sessionClose, level: .info, fields: [])
        sink.flushForTesting()

        // 之后网络路写了更多，文件也比 app 路新。
        for index in 0..<5 {
            sink.append(event: .intent, level: .info, fields: [.init(.attempt, .int(index))])
        }
        sink.flushForTesting()

        #expect(sink.previousSessionTail() == nil, "app 路已收尾，却因为别的域更新而被判成崩溃")
    }
}
