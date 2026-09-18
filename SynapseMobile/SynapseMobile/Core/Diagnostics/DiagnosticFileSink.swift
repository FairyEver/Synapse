import Foundation

/// 真正碰磁盘的那一层。
///
/// 全部 I/O 都在一条 `utility` 串行队列上，主线程只把记录塞进 `DiagnosticBuffer`
/// 就返回。这不是"尽量"——是这套机制能不能上线的分界线：日志一旦在打日志的线程上
/// 写文件，滚动就会掉帧，而掉帧恰恰是最难被归因到日志头上的那种伤。
///
/// 这一层**没有任何一条路径会把错误写进日志**。写盘失败就关掉 fd、把状态置成
/// `.paused`，此后静默丢弃。子系统自己出错时再去写日志，正是"日志把 App 写死"
/// 的标准剧本。
nonisolated final class DiagnosticFileSink: @unchecked Sendable {
    /// 放 Caches 而不是 Documents：日志是可重建的诊断产物，放 Documents 会跟着
    /// iCloud 备份离开设备 —— 一份带会话标题的文件不该在用户没点"分享"的时候先走一步。
    static let directoryName = "SynapseLogs"

    enum Status: String, Sendable {
        case running = "记录中"
        case paused = "已暂停"
        case disabled = "已关闭"
    }

    struct Snapshot: Sendable {
        var status: Status = .running
        var totalBytes = 0
        var fileCount = 0
        var oldest: Date?
        var newest: Date?
        var dropped = 0
        var overwritten = 0
        var pendingCount = 0
        var totalWritten = 0
        var directory: String = ""
    }

    private let queue = DispatchQueue(label: "com.liy.SynapseMobile.diagnostics", qos: .utility)
    private let directory: URL
    private let limits: DiagnosticRotation.Limits
    private let buffer: DiagnosticBuffer
    private let launchStamp: String

    /// 打开着写活动文件的 fd。崩溃处理器要直接写它，所以它得在队列之外也读得到；
    /// 代价是崩溃线程可能读到刚被换掉的旧 fd —— 那只会返回 EBADF，我们本来也不看返回值。
    private var activeFD: Int32 = -1
    private var activeName = ""
    private var activeBytes = 0
    private var rotationIndex = 0

    private var timer: DispatchSourceTimer?
    private var paused = false
    private var started = false

    init?(
        directory base: URL? = nil,
        limits: DiagnosticRotation.Limits = DiagnosticRotation.Limits(),
        buffer: DiagnosticBuffer = DiagnosticBuffer()
    ) {
        let root = base ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent(Self.directoryName, isDirectory: true)
        guard let root else { return nil }
        self.directory = root
        self.limits = limits
        self.buffer = buffer
        self.launchStamp = Self.makeLaunchStamp()
        guard createDirectoryIfNeeded() else { return nil }
    }

    // MARK: - 生命周期

    func start() {
        queue.async { [weak self] in
            guard let self, !self.started else { return }
            self.started = true
            _ = self.openActiveFileIfNeeded()
            self.startTimer()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.timer?.cancel()
            self.timer = nil
            self.flushNow()
            self.closeActiveFile()
        }
    }

    /// 收下一条记录。返回 true 表示积压够了，调用方该催一次落盘。
    ///
    /// 门面直接转调这里，中间不再有第二层判断 —— 热路径上每多一层都是主线程多一次
    /// 可能的排队。
    @discardableResult
    func append(
        event: DiagnosticEvent,
        level: DiagnosticLevel,
        fields: [DiagnosticEntry]
    ) -> Bool {
        buffer.append(event: event, level: level, fields: fields)
    }

    /// 收下一批记录。`flushNow` 由门面在积压超阈值时置位。
    func submit(flushNow: Bool) {
        guard flushNow else { return }
        queue.async { [weak self] in self?.flushNow() }
    }

    /// 上一条记录的时间与事件名，**以及它有没有正常收尾**。
    ///
    /// 这是判断"上次是不是被系统杀掉了"的唯一线索：jetsam、看门狗、Swift 运行时陷阱
    /// 都不会留下任何别的痕迹，它们只是让进程消失 —— 而消失意味着文件末尾没有
    /// `app.sessionClose`。行尾若是半行（写了一半就被杀），按"没收尾"算，不去解析它。
    func previousSessionTail() -> (event: String, timestamp: String)? {
        let files = listFiles().sorted { $0.modified > $1.modified }
        guard let newest = files.first,
              let data = try? Data(contentsOf: directory.appendingPathComponent(newest.name)),
              let text = String(data: data.suffix(8 << 10), encoding: .utf8) else { return nil }

        let lines = text.split(separator: "\n").filter { !$0.hasPrefix("#") }
        guard let last = lines.last(where: { !$0.isEmpty }) else { return nil }
        if last.contains("app.sessionClose") { return nil }

        let parts = last.split(separator: " ", maxSplits: 3).map(String.init)
        guard parts.count >= 3 else { return nil }
        return (event: parts[2], timestamp: "\(parts[0]) \(parts[1])")
    }

    /// 用户按下开关。
    func setEnabled(_ enabled: Bool) {
        queue.async { [weak self] in
            guard let self else { return }
            self.paused = !enabled
            if enabled {
                _ = self.openActiveFileIfNeeded()
                self.startTimer()
            } else {
                self.timer?.cancel()
                self.timer = nil
                self.flushNow()
                self.closeActiveFile()
            }
        }
    }

    // MARK: - 落盘

    private func startTimer() {
        guard timer == nil else { return }
        let source = DispatchSource.makeTimerSource(queue: queue)
        // 一秒一次。它不只是省 I/O —— 崩溃处理器抓不到的崩溃（Swift 陷阱、OOM、
        // watchdog）能留下的最后一段，就是这一秒。
        source.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(250))
        source.setEventHandler { [weak self] in self?.flushNow() }
        source.resume()
        timer = source
    }

    private func flushNow() {
        guard !paused else { return }
        let records = buffer.drain()
        guard !records.isEmpty else { return }
        write(DiagnosticLineRenderer.renderAll(DiagnosticMerge.coalesce(records)))
    }

    /// 崩溃路径：同步、短、失败即弃。由 `DiagnosticCrashHandler` 在崩溃线程上调用。
    ///
    /// 它**只读不改**：不开文件、不轮转、不动 `activeBytes`。这些动作都要动状态，
    /// 而崩溃的那个线程可能正好把写盘的队列卡在半路 —— 改状态只会把损坏的面扩大。
    /// 拿到一个已经失效的 fd 也无妨，`write` 返回 EBADF，我们不看不重试。
    func writeCrashRecordsSynchronously() {
        // 这里对 `activeFD` 的读是**故意不加同步**的：崩溃线程不该等队列上的锁。
        // 读到一个刚被换掉的旧 fd 只会拿到 EBADF，而那一刻我们本来也只能尽力而为。
        let descriptor = activeFD
        guard descriptor >= 0 else { return }
        let records = buffer.tryDrainForCrash()
        guard !records.isEmpty else { return }
        let text = DiagnosticLineRenderer.renderAll(DiagnosticMerge.coalesce(records))
        Self.writeRaw(text, to: descriptor)
    }

    /// 崩溃处理器专用的最后一行。与 `writeCrashRecordsSynchronously` 一样只读不改。
    func appendCrashLine(_ line: String) {
        let descriptor = activeFD
        guard descriptor >= 0 else { return }
        Self.writeRaw(line + "\n", to: descriptor)
    }

    /// 只做 `write(2)`，不碰任何成员状态。返回实际写出去的字节数。
    @discardableResult
    private static func writeRaw(_ text: String, to descriptor: Int32) -> Int {
        let bytes = Array(text.utf8)
        var written = 0
        while written < bytes.count {
            let result = bytes.withUnsafeBytes { buffer -> Int in
                guard let base = buffer.baseAddress else { return -1 }
                return Darwin.write(descriptor, base.advanced(by: written), bytes.count - written)
            }
            guard result > 0 else { return written }
            written += result
        }
        return written
    }

    private func write(_ text: String) {
        guard !text.isEmpty else { return }
        guard let descriptor = openActiveFileIfNeeded() else {
            pause()
            return
        }
        let written = Self.writeRaw(text, to: descriptor)
        // 没写全（磁盘满、权限变了）就停在这里。继续写的每一条都会失败，而失败
        // 是要被看见的 —— 状态行会显示「已暂停」，但绝不为此再写一条日志。
        guard written == text.utf8.count else {
            pause()
            return
        }
        activeBytes += written
        applyRotationIfNeeded()
    }

    private func openActiveFileIfNeeded() -> Int32? {
        guard !paused else { return nil }
        if activeFD >= 0 { return activeFD }
        if activeName.isEmpty {
            activeName = "synapse-\(launchStamp)-\(ProcessInfo.processInfo.processIdentifier).log"
        }
        // 目录可能已经不在了：用户按下"删除全部日志"时整个目录一起删掉了。
        // 少了这一句，删除之后这份日志就永远停在那里 —— 而失败的样子是静默的，
        // 他要到下一次复现完、点导出，才会发现拿到的是个空文件。
        guard createDirectoryIfNeeded() else { return nil }
        let url = directory.appendingPathComponent(activeName)
        let descriptor = Darwin.open(url.path, O_WRONLY | O_CREAT | O_APPEND, 0o600)
        guard descriptor >= 0 else { return nil }
        activeFD = descriptor
        activeBytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int)
            .flatMap { $0 } ?? 0
        if activeBytes == 0 {
            // 版本号不在这里写：它在每份日志开头的 `env.snapshot` 里已经有了，
            // 而那个值只读得主线程（`AppVersion` 读 bundle），这一层在后台队列上。
            let header = "# 诊断日志 \(DiagnosticLineRenderer.timestamp(Date())) 一行一条\n"
            _ = header.withCString { Darwin.write(descriptor, $0, strlen($0)) }
        }
        return descriptor
    }

    private func closeActiveFile() {
        guard activeFD >= 0 else { return }
        Darwin.close(activeFD)
        activeFD = -1
    }

    /// 换文件：把活动文件改名，再开一个新的。
    ///
    /// 改的是**已经写出去的那个**，所以正在写的文件永远叫同一个名字，删除候选里
    /// 也就永远不会有它。
    private func applyRotationIfNeeded() {
        let files = listFiles()
        let plan = DiagnosticRotation.plan(
            activeName: activeName,
            files: files,
            incomingBytes: 0,
            limits: limits
        )
        guard plan.shouldRotate else {
            remove(plan.removals)
            return
        }
        closeActiveFile()
        rotationIndex += 1
        let rotated = "synapse-\(launchStamp)-\(ProcessInfo.processInfo.processIdentifier)"
            + "-\(rotationIndex).log"
        let from = directory.appendingPathComponent(activeName)
        let to = directory.appendingPathComponent(rotated)
        try? FileManager.default.moveItem(at: from, to: to)
        activeBytes = 0
        _ = openActiveFileIfNeeded()
        remove(plan.removals)
    }

    private func remove(_ names: [String]) {
        for name in names where name != activeName {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    private func pause() {
        closeActiveFile()
        paused = true
    }

    /// 只给测试用：立刻落盘，不等那一秒的定时器。
    func flushForTesting() {
        queue.sync { flushNow() }
    }

    // MARK: - 查询与导出

    func snapshot() -> Snapshot {
        queue.sync {
            var snapshot = Snapshot()
            snapshot.status = paused ? .paused : .running
            snapshot.directory = directory.path
            let files = listFiles()
            snapshot.fileCount = files.count
            snapshot.totalBytes = files.reduce(0) { $0 + $1.sizeBytes }
            snapshot.oldest = files.map(\.modified).min()
            snapshot.newest = files.map(\.modified).max()
            let counters = buffer.counters
            snapshot.dropped = counters.dropped
            snapshot.overwritten = counters.overwritten
            snapshot.pendingCount = counters.pendingCount
            snapshot.totalWritten = counters.totalWritten
            return snapshot
        }
    }

    /// 导出一个可以直接发出去的文件。
    ///
    /// 只取最近 3 MiB：整份可以到 10 MiB，而一次复现需要的窗口只有几分钟。
    /// 截断了就在头部写明，不让人以为自己拿到的是全部。
    func export(header: String, maxBytes: Int = 3 << 20) -> URL? {
        queue.sync {
            let files = listFiles().sorted { $0.modified < $1.modified }
            var body = Data()
            var included = 0
            var truncated = false
            for file in files.reversed() {
                guard let data = try? Data(contentsOf: directory.appendingPathComponent(file.name))
                else { continue }
                if body.count + data.count > maxBytes {
                    let room = max(0, maxBytes - body.count)
                    body.insert(contentsOf: data.suffix(room), at: 0)
                    truncated = true
                    break
                }
                body.insert(contentsOf: data, at: 0)
                included += 1
            }
            guard !body.isEmpty else { return nil }

            let stamp = DiagnosticLineRenderer.timestamp(Date())
                .replacingOccurrences(of: ":", with: "-")
                .replacingOccurrences(of: " ", with: "_")
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("synapse-diagnostics-\(stamp).txt")
            var text = header
            if truncated || included < files.count {
                text += "# 只包含最近的日志，更早的没有包含在内\n"
            }
            var payload = Data(text.utf8)
            payload.append(body)
            guard (try? payload.write(to: url)) != nil else { return nil }
            return url
        }
    }

    /// 连目录一起删掉，下次写入时惰性重建。
    func deleteAll() {
        queue.sync {
            closeActiveFile()
            timer?.cancel()
            timer = nil
            try? FileManager.default.removeItem(at: directory)
            activeName = ""
            activeBytes = 0
            rotationIndex = 0
        }
    }

    // MARK: - 杂项

    private func listFiles() -> [DiagnosticFileInfo] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys
        ) else { return [] }
        return urls.compactMap { url in
            guard url.pathExtension == "log",
                  let values = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
            return DiagnosticFileInfo(
                name: url.lastPathComponent,
                sizeBytes: values.fileSize ?? 0,
                modified: values.contentModificationDate ?? .distantPast
            )
        }
    }

    private func createDirectoryIfNeeded() -> Bool {
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory) {
            return isDirectory.boolValue
        }
        // `completeUntilFirstUserAuthentication` 而不是默认档：冷启动还没解锁时
        // 也要能写，否则开机头几秒的日志会整段丢掉。
        return (try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )) != nil
    }

    private static func makeLaunchStamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}
