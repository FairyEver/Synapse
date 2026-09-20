import Foundation
import Testing

@testable import SynapseMobile

/// 终端内容采集的那道防线。
///
/// 这是整套机制里唯一**改变隐私姿态**的一块：在此之前 `DiagnosticValue` 里根本没有
/// 能装未脱敏文本的 case，"把终端正文顺手记下来"是编译不过的。那道防线让出去之后，
/// 换回来的是这里验的几样东西 —— 一个入口、一个开关、一个采样闸、三重限长，
/// 以及一条源码级的守卫。
///
/// 诚实地说清楚**它挡不住什么**：脱敏规则只认 `key=value` 形状与已知的 token 前缀
/// （`ghp_` / `sk-` / `glpat-` / `Bearer`）。**在密码提示符下敲进去的密码、
/// `cat ~/.ssh/id_rsa` 的输出，都会原样进包。** 这是用户明确接受过的代价
/// （导出时会再问一句），不是这里的疏漏 —— 写在这儿是为了下一个读这片测试的人
/// 不会以为它兜住了那些。
struct DiagnosticContentCaptureTests {
    private func makeDirectory() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("diag-capture-\(UUID().uuidString)", isDirectory: true)
    }

    private func written(in directory: URL) -> String {
        let children = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []
        return children.compactMap { url -> String? in
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                return written(in: url)
            }
            guard url.pathExtension == "log" else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }
        .joined()
    }

    // MARK: - 开关

    /// 开关默认是**开**的。
    ///
    /// 与主开关默认开同一个理由：用户复现一次不容易，"忘了先打开开关"是最没必要的一种
    /// 浪费。代价靠另外三道抵，而导出时会再问一句。
    @Test func contentCaptureIsOnByDefault() {
        let defaults = UserDefaults(suiteName: "diag-capture-\(UUID().uuidString)")!
        #expect(DiagnosticLogSettings(defaults: defaults).capturesContent)
    }

    /// 关掉之后，屏幕上一个字都不进文件。
    @Test func turningItOffKeepsTheScreenOutOfTheFile() throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        let original = DiagnosticLog.capturesContent
        defer {
            DiagnosticLog.capturesContent = original
            DiagnosticLog.useSinkForTesting(nil)
        }

        DiagnosticLog.capturesContent = false
        DiagnosticLog.captureScreen(kind: .suffix, session: "s-1") {
            ["a line that must not land"]
        }
        sink.flushForTesting()
        #expect(!written(in: directory).contains("a line that must not land"))

        // 打开就有 —— 少了这一半，上面那句可能只是因为采集整个没接上才为真。
        DiagnosticLog.capturesContent = true
        DiagnosticLog.captureScreen(kind: .suffix, session: "s-1") {
            ["a line that must land"]
        }
        sink.flushForTesting()
        #expect(written(in: directory).contains("a line that must land"))
    }

    /// 关着的时候**连那些行都不会被拼出来**。
    ///
    /// 这是调用点闸门存在的理由：缓冲区那层的采样拦在字符串拼好之后，而这里一次是
    /// 12 行。闭包没被调用就是最直接的证据。
    @Test func theRowsAreNotEvenBuiltWhileItIsOff() {
        let original = DiagnosticLog.capturesContent
        defer { DiagnosticLog.capturesContent = original }

        DiagnosticLog.capturesContent = false
        var built = false
        DiagnosticLog.captureScreen(kind: .suffix, session: "s-1") {
            built = true
            return ["never"]
        }
        #expect(!built, "关着开关却还是把屏幕上的行拼了一遍")
    }

    // MARK: - 采样闸

    /// 同一件事一秒只放行一条。
    @Test func theGateAdmitsOncePerSecond() {
        let gate = DiagnosticLog.CaptureGate()
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        #expect(gate.admits(.frameContent, at: start))
        #expect(!gate.admits(.frameContent, at: start.addingTimeInterval(0.2)))
        #expect(!gate.admits(.frameContent, at: start.addingTimeInterval(0.99)))
        #expect(gate.admits(.frameContent, at: start.addingTimeInterval(1.01)))
    }

    /// 两个方向各自计时，互不挤占。
    ///
    /// 屏幕上那份与发出去那份是相反方向的两件事，用同一个闸的话，一直在输出的终端会把
    /// "我刚敲了什么"永远挤掉。
    @Test func theTwoDirectionsDoNotStarveEachOther() {
        let gate = DiagnosticLog.CaptureGate()
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        #expect(gate.admits(.frameContent, at: start))
        #expect(gate.admits(.terminalInput, at: start), "屏幕那条把输入那条挤掉了")
        #expect(!gate.admits(.frameContent, at: start.addingTimeInterval(0.1)))
        #expect(!gate.admits(.terminalInput, at: start.addingTimeInterval(0.1)))
    }

    // MARK: - 限长

    /// 三重限长各自生效，而且**总上限那一格不是死代码**。
    ///
    /// 最后半句是重点：总上限如果大于「行数 × 每行上限」，先按行截完之后就永远到不了它。
    @Test func capturedTextIsBounded() {
        #expect(CapturedText.maxBytes < CapturedText.maxRows * CapturedText.maxBytesPerRow)

        let longRow = String(repeating: "x", count: 4_000)
        let cut = CapturedText(redacting: [longRow])
        #expect(cut.text.utf8.count <= CapturedText.maxBytesPerRow + DiagnosticTruncation.marker.utf8.count)

        let manyRows = (0..<50).map { "line \($0)" }
        let capped = CapturedText(redacting: manyRows)
        #expect(capped.text.contains("line 0"))
        #expect(capped.text.contains("line \(CapturedText.maxRows - 1)"))
        #expect(!capped.text.contains("line \(CapturedText.maxRows)"), "超出 12 行的部分没有截掉")

        let wideRows = (0..<CapturedText.maxRows).map { _ in String(repeating: "y", count: 900) }
        let total = CapturedText(redacting: wideRows)
        #expect(total.text.utf8.count <= CapturedText.maxBytes + DiagnosticTruncation.marker.utf8.count)
        #expect(total.text.count < wideRows.joined().count, "总上限没有生效")
    }

    /// 屏幕内容也要过脱敏 —— 它是唯一一条装裸字符串进来、必须跑规则的路。
    ///
    /// **只验规则认得出来的那种。** 裸密码认得出来才怪，见本文件开头那段说明。
    @Test func screenContentGoesThroughTheRedactor() {
        let captured = CapturedText(redacting: [
            "$ curl -H 'Authorization: Bearer canary-screen-4b71' https://example.com",
            "GITHUB_TOKEN=ghp_canaryscreen4b71",
        ])
        #expect(!captured.text.contains("canary-screen-4b71"))
        #expect(captured.text.contains(DiagnosticRedactor.redactedValue))
    }

    /// 落盘与进包两步之后，canary 仍然不出现。
    @Test func screenCanariesNeverReachTheFileOrTheArchive() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let canary = "canary-screen-must-not-ship-9e12"
        let sink = try #require(DiagnosticFileSink(directory: directory))
        sink.start()
        DiagnosticLog.useSinkForTesting(sink)
        let original = DiagnosticLog.capturesContent
        defer {
            DiagnosticLog.capturesContent = original
            DiagnosticLog.useSinkForTesting(nil)
        }

        DiagnosticLog.capturesContent = true
        DiagnosticLog.captureScreen(kind: .suffix, session: "s-1") {
            ["$ export TOKEN=\(canary)"]
        }
        sink.flushForTesting()
        #expect(!written(in: directory).contains(canary))

        let url = try #require(await sink.export(
            header: "# 头部\n",
            manifest: DiagnosticExportManifest(
                exportedAt: "2026-09-20T21:00:00Z",
                timeZone: "Asia/Shanghai",
                app: .init(version: "1", build: "1"),
                device: .init(model: "test", name: "test"),
                os: "26.0",
                includesTerminalContent: true,
                counters: .init(written: 1, dropped: 0, overwritten: 0),
                redaction: .init(markers: ["[redacted]"], note: "test")
            )
        ))
        defer { try? FileManager.default.removeItem(at: url) }
        let read = try ZipReader(try Data(contentsOf: url))
        for item in read.items {
            #expect(!String(decoding: item.data, as: UTF8.self).contains(canary))
        }
    }

    // MARK: - 源码守卫

    /// `CapturedText` 只许在两个文件里被构造。
    ///
    /// 类型系统那道防线让出去之后，这条测试是替代它的东西：它读仓库源码，任何新加的
    /// 构造点都会让它红。比 review 可靠 —— review 会漏，而这条不会。
    @Test func capturedTextIsOnlyConstructedInTwoPlaces() throws {
        let appTarget = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // SynapseMobileTests
            .deletingLastPathComponent()   // SynapseMobile
            .appendingPathComponent("SynapseMobile")
        let allowed: Set<String> = [
            "Core/Diagnostics/DiagnosticValue.swift",   // 定义本身
            "Core/Diagnostics/DiagnosticLog.swift",     // 两个构造点
        ]

        var offenders: [String] = []
        var scanned = 0
        let root = appTarget
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else {
            Issue.record("遍历不了 \(root.path)")
            return
        }
        for case let url as URL in walker where url.pathExtension == "swift" {
            scanned += 1
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            guard text.contains("CapturedText(") else { continue }
            let relative = url.path.replacingOccurrences(of: root.path + "/", with: "")
            if !allowed.contains(relative) { offenders.append(relative) }
        }

        // 前提检查：真的扫到了东西。扫不到文件时这条会"什么违规都没有"地绿掉。
        #expect(scanned > 50, "只扫到 \(scanned) 个文件，遍历大概没生效")
        #expect(offenders.isEmpty, "这些文件在构造 CapturedText：\(offenders)")
    }
}
