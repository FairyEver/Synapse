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
///
/// **按域分文件**：`<Logs>/<lane>/synapse-…-<pid>[-k].log`。一份混在一起的日志里，
/// 终端输出每秒几十条会把网络与生命周期那几条挤到看不见的地方——轮转按时间走，
/// 不按重要程度走。分路之后「哪个域出了事」在磁盘上就是真的。
nonisolated final class DiagnosticFileSink: @unchecked Sendable {
    /// 放 Caches 而不是 Documents：日志是可重建的诊断产物，放 Documents 会跟着
    /// iCloud 备份离开设备 —— 一份带会话标题的文件不该在用户没点"分享"的时候先走一步。
    static let directoryName = "SynapseLogs"

    /// 崩溃时从缓冲区抢出来的那一批未落盘记录，写进 crash 路之前先压一行说明。
    ///
    /// 那一批是**混合的**（缓冲区不分域），所以不能让它冒充 crash 路自己的记录。
    static let crashBatchNotice = "# 以下为崩溃时从缓冲区取出的未落盘记录，可能来自其它域\n"

    /// 导出取多少。
    ///
    /// 磁盘上最多留 10 MiB，而一次复现需要的窗口只有几分钟 —— 取少一点，包就小一点，
    /// 发出去也快一点。这些数按**原始字节**算，压缩之后通常只剩五分之一到十分之一。
    enum DiagnosticExportLimits {
        /// 单路取多少。net / term 两路最吵，额度和它们各自的磁盘配额一样大。
        static let bytesPerLane = 512 << 10
        /// 全部加起来。加上 README 与 manifest 之后仍然远小于磁盘上那份。
        static let totalRawBytes = 2_500 << 10
    }

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
        /// 每一路各占多少字节。界面拿它显示"各域占用"，也是排查
        /// 「某一路是不是根本没写进去」的第一眼 —— 那种失败是静默的。
        var laneBytes: [DiagnosticLane: Int] = [:]

        func bytes(in lane: DiagnosticLane) -> Int { laneBytes[lane] ?? 0 }
    }

    /// 一路日志在磁盘上的状态。
    private struct LaneState {
        var descriptor: Int32 = -1
        var name = ""
        var bytes = 0
        var rotationIndex = 0
    }

    private let queue = DispatchQueue(label: "com.liy.SynapseMobile.diagnostics", qos: .utility)
    /// 日志根目录。每一路是它下面的一个子目录 —— 域隔离在磁盘上就是真的，
    /// 「每路独立轮转与保留」于是不需要任何按文件名过滤的算术。
    private let directory: URL
    private let quotas: [DiagnosticLane: DiagnosticRotation.Limits]
    private let buffer: DiagnosticBuffer
    private let launchStamp: String

    private var lanes: [DiagnosticLane: LaneState] = [:]
    /// crash 路的 fd，**故意在队列之外也读得到**：崩溃处理器要在崩溃线程上直接写它。
    ///
    /// 代价是崩溃线程可能读到刚被换掉的旧 fd —— 那只会返回 EBADF，而那一刻我们本来
    /// 也只能尽力而为。用独立的一个字段而不是去 `lanes` 里取，是因为那一刻不能碰
    /// 字典（它由队列上的锁语义保护），而这个 `Int32` 的读写是原子的。
    private var crashDescriptor: Int32 = -1

    private var timer: DispatchSourceTimer?
    private var paused = false
    private var started = false
    /// 上一次导出的产物，下次导出前删掉。只在队列上读写。
    private var lastExportURL: URL?

    init?(
        directory base: URL? = nil,
        quotas: [DiagnosticLane: DiagnosticRotation.Limits] = DiagnosticRotation.Limits.perLane,
        buffer: DiagnosticBuffer = DiagnosticBuffer()
    ) {
        let root = base ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent(Self.directoryName, isDirectory: true)
        guard let root else { return nil }
        self.directory = root
        self.quotas = quotas
        self.buffer = buffer
        self.launchStamp = Self.makeLaunchStamp()
        guard Self.createDirectoryIfNeeded(root) else { return nil }
        // **在这里同步做，不能等到 `start()`。** `start()` 把开活动文件排进队列
        // （异步），而 `previousSessionTail()` 是在主线程上直接读的 —— 收编要是排在
        // 那后面，升级后的第一次启动会看到根目录里没有 app 路、app 路里又没有东西，
        // 于是把"上一个版本最后一次运行没收尾"整个漏掉。
        Self.adoptLegacyFiles(root: root)
    }

    // MARK: - 生命周期

    func start() {
        queue.async { [weak self] in
            guard let self, !self.started else { return }
            self.started = true
            // 只把 app 路先开出来：启动时的 `app.launch` 立刻就写，其余各域按需惰性建。
            // 建目录本身要动磁盘，启动路径上不该为一路还没内容的日志付这笔钱。
            _ = self.openActiveFile(in: .app)
            self.startTimer()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.timer?.cancel()
            self.timer = nil
            self.flushNow()
            self.closeAllActiveFiles()
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
    ///
    /// **只读 app 路。** 这是分域之后必须钉住的一件事：从前它按修改时间取全局最新的
    /// 那个文件，而分域之后 net 路几乎总比 app 路新 —— 读它就永远看不到
    /// `app.sessionClose`，于是每一次正常退出都会被判成疑似崩溃。
    func previousSessionTail() -> (event: String, timestamp: String)? {
        let files = listFiles(in: .app).sorted { $0.modified > $1.modified }
        guard let newest = files.first,
              let data = try? Data(contentsOf: laneDirectory(.app).appendingPathComponent(newest.name)),
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
                _ = self.openActiveFile(in: .app)
                self.startTimer()
            } else {
                self.timer?.cancel()
                self.timer = nil
                self.flushNow()
                self.closeAllActiveFiles()
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

        // 先按域分组，**再**各自折叠。`coalesce` 只看相邻记录，而缓冲区是混合的
        // （按到达顺序），直接过一遍会让 term 与 net 的记录交错落进同一个窗口 ——
        // 各自的「同一件事」被拆开，合并率凭空掉一半。
        var byLane: [DiagnosticLane: [DiagnosticRecord]] = [:]
        for record in records {
            byLane[record.event.lane, default: []].append(record)
        }
        // 固定的遍历顺序，输出与字典的内部顺序无关。
        for lane in DiagnosticLane.allCases {
            guard let laneRecords = byLane[lane], !laneRecords.isEmpty else { continue }
            write(DiagnosticLineRenderer.renderAll(DiagnosticMerge.coalesce(laneRecords)), to: lane)
        }
    }

    /// 崩溃路径：同步、短、失败即弃。由 `DiagnosticCrashHandler` 在崩溃线程上调用。
    ///
    /// 它**只读不改**：不开文件、不轮转、不动任何 `bytes`。这些动作都要动状态，
    /// 而崩溃的那个线程可能正好把写盘的队列卡在半路 —— 改状态只会把损坏的面扩大。
    /// 拿到一个已经失效的 fd 也无妨，`write` 返回 EBADF，我们不看不重试。
    ///
    /// 缓冲区是不分域的，所以这一批整体写进 **crash 路**：那一路的额度只归它自己、
    /// 不会被输出打满的 term 路轮转掉。从前它写进的是"恰好是当前活动文件"的那个文件，
    /// 而那个文件随时可能在轮转中被换掉。
    func writeCrashRecordsSynchronously() {
        let descriptor = crashDescriptor
        guard descriptor >= 0 else { return }
        let records = buffer.tryDrainForCrash()
        guard !records.isEmpty else { return }
        Self.writeRaw(Self.crashBatchNotice, to: descriptor)
        let text = DiagnosticLineRenderer.renderAll(DiagnosticMerge.coalesce(records))
        Self.writeRaw(text, to: descriptor)
    }

    /// 崩溃处理器专用的最后一行。与 `writeCrashRecordsSynchronously` 一样只读不改。
    func appendCrashLine(_ line: String) {
        let descriptor = crashDescriptor
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

    private func write(_ text: String, to lane: DiagnosticLane) {
        guard !text.isEmpty else { return }
        guard let descriptor = openActiveFile(in: lane) else {
            pause()
            return
        }
        let written = Self.writeRaw(text, to: descriptor)
        // 没写全（磁盘满、权限变了）就停在这里。继续写的每一条都会失败，而失败
        // 是要被看见的 —— 状态行会显示「已暂停」，但绝不为此再写一条日志。
        //
        // 停的是**整个 sink** 而不是这一路：写不进去的原因几乎只有磁盘满与权限，
        // 而那两样对每一路都成立。按路暂停只会让"已暂停"这三个字变得要解释。
        guard written == text.utf8.count else {
            pause()
            return
        }
        lanes[lane]?.bytes += written
        applyRotationIfNeeded(in: lane)
    }

    /// 打开这一路的活动文件（已经开着就直接返回）。目录可能在两帧之间被删掉过。
    private func openActiveFile(in lane: DiagnosticLane) -> Int32? {
        guard !paused else { return nil }
        if let state = lanes[lane], state.descriptor >= 0 { return state.descriptor }

        var state = lanes[lane] ?? LaneState()
        if state.name.isEmpty {
            state.name = "synapse-\(launchStamp)-\(ProcessInfo.processInfo.processIdentifier).log"
        }
        // 目录可能已经不在了：用户按下"删除全部日志"时整个目录一起删掉了。
        // 少了这一句，删除之后这份日志就永远停在那里 —— 而失败的样子是静默的，
        // 他要到下一次复现完、点导出，才会发现拿到的是个空文件。
        let laneDirectory = laneDirectory(lane)
        guard Self.createDirectoryIfNeeded(laneDirectory) else { return nil }
        let url = laneDirectory.appendingPathComponent(state.name)
        let descriptor = Darwin.open(url.path, O_WRONLY | O_CREAT | O_APPEND, 0o600)
        guard descriptor >= 0 else { return nil }
        state.descriptor = descriptor
        state.bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int)
            .flatMap { $0 } ?? 0
        if state.bytes == 0 {
            // 版本号不在这里写：它在每份日志开头的 `env.snapshot` 里已经有了，
            // 而那个值只读得主线程（`AppVersion` 读 bundle），这一层在后台队列上。
            let header = "# 诊断日志 \(lane.rawValue) 路 \(DiagnosticLineRenderer.timestamp(Date()))"
                + " 一行一条\n"
            _ = header.withCString { Darwin.write(descriptor, $0, strlen($0)) }
        }
        lanes[lane] = state
        if lane == .crash { crashDescriptor = descriptor }
        return descriptor
    }

    private func closeActiveFile(in lane: DiagnosticLane) {
        guard var state = lanes[lane], state.descriptor >= 0 else { return }
        Darwin.close(state.descriptor)
        state.descriptor = -1
        lanes[lane] = state
        if lane == .crash { crashDescriptor = -1 }
    }

    private func closeAllActiveFiles() {
        for lane in DiagnosticLane.allCases {
            closeActiveFile(in: lane)
        }
    }

    /// 换文件：把活动文件改名，再开一个新的。
    ///
    /// 改的是**已经写出去的那个**，所以正在写的文件永远叫同一个名字，删除候选里
    /// 也就永远不会有它。
    private func applyRotationIfNeeded(in lane: DiagnosticLane) {
        guard let state = lanes[lane], let limits = quotas[lane] else { return }
        let plan = DiagnosticRotation.plan(
            activeName: state.name,
            files: listFiles(in: lane),
            incomingBytes: 0,
            limits: limits
        )
        guard plan.shouldRotate else {
            remove(plan.removals, in: lane)
            return
        }
        closeActiveFile(in: lane)
        var rotated = lanes[lane] ?? LaneState()
        rotated.rotationIndex += 1
        let rotatedName = "synapse-\(launchStamp)-\(ProcessInfo.processInfo.processIdentifier)"
            + "-\(rotated.rotationIndex).log"
        let laneDirectory = laneDirectory(lane)
        try? FileManager.default.moveItem(
            at: laneDirectory.appendingPathComponent(state.name),
            to: laneDirectory.appendingPathComponent(rotatedName)
        )
        rotated.name = state.name
        rotated.bytes = 0
        lanes[lane] = rotated
        _ = openActiveFile(in: lane)
        remove(plan.removals, in: lane)
    }

    private func remove(_ names: [String], in lane: DiagnosticLane) {
        let activeName = lanes[lane]?.name ?? ""
        for name in names where name != activeName {
            try? FileManager.default.removeItem(at: laneDirectory(lane).appendingPathComponent(name))
        }
    }

    /// 整层停下：关掉每一路的 fd，此后静默丢弃。见 `write` 里为什么是整个 sink。
    private func pause() {
        closeAllActiveFiles()
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
            for lane in DiagnosticLane.allCases {
                let files = listFiles(in: lane)
                let bytes = files.reduce(0) { $0 + $1.sizeBytes }
                snapshot.laneBytes[lane] = bytes
                snapshot.fileCount += files.count
                snapshot.totalBytes += bytes
                for file in files {
                    snapshot.oldest = min(snapshot.oldest ?? file.modified, file.modified)
                    snapshot.newest = max(snapshot.newest ?? file.modified, file.modified)
                }
            }
            let counters = buffer.counters
            snapshot.dropped = counters.dropped
            snapshot.overwritten = counters.overwritten
            snapshot.pendingCount = counters.pendingCount
            snapshot.totalWritten = counters.totalWritten
            return snapshot
        }
    }

    /// 导出一个可以直接发出去的压缩包。
    ///
    /// **裁剪必须在压缩之前做。** 反过来（先压再按包大小裁）产物的大小就依赖可压缩性，
    /// 同一份日志在不同内容下裁掉的量完全不同 —— 一个说不清行为的上限，不如一个算得清
    /// 的。所以按原始字节裁，再由"STORED 保证条目 ≤ 原始、deflate 保证 ≤ 原始 + 0.1%"
    /// 推出包的上界；不需要"超了就再裁一轮"的循环。
    ///
    /// 每一行自己带着事件名（`net.frame` / `term.rows`），所以包里不必再加分隔标记。
    func export(
        header: String,
        manifest: DiagnosticExportManifest
    ) async -> URL? {
        await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                continuation.resume(returning: self?.exportNow(header: header, manifest: manifest))
            }
        }
    }

    private func exportNow(header: String, manifest: DiagnosticExportManifest) -> URL? {
        var remaining = DiagnosticExportLimits.totalRawBytes
        var entries: [DiagnosticZip.Entry] = []
        var manifest = manifest

        for lane in DiagnosticLane.allCases {
            guard remaining > 0 else { break }
            let files = listFiles(in: lane).sorted { $0.modified < $1.modified }
            guard !files.isEmpty else { continue }

            var budget = min(DiagnosticExportLimits.bytesPerLane, remaining)
            var laneEntries: [DiagnosticZip.Entry] = []
            var truncated = false
            // 从新到旧取，直到这一路的预算用完。最后一个文件允许只取**尾部** ——
            // 那是"最近发生的"，也正是要发出去的东西。
            for file in files.reversed() {
                guard budget > 0 else {
                    truncated = true
                    break
                }
                let url = laneDirectory(lane).appendingPathComponent(file.name)
                guard let data = try? Data(contentsOf: url), !data.isEmpty else { continue }
                let taken: Data
                if data.count <= budget {
                    taken = data
                } else {
                    taken = Data(data.suffix(budget))
                    truncated = true
                }
                budget -= taken.count
                remaining -= taken.count
                laneEntries.append(.init(
                    name: "\(lane.directoryName)/\(file.name)",
                    data: taken,
                    modified: file.modified
                ))
                if truncated { break }
            }

            guard !laneEntries.isEmpty else { continue }
            entries.append(contentsOf: laneEntries.reversed())
            manifest.lanes.append(.init(
                lane: lane.rawValue,
                files: laneEntries.count,
                bytes: laneEntries.reduce(0) { $0 + $1.data.count },
                truncated: truncated
            ))
        }

        guard !entries.isEmpty else { return nil }

        if let previous = previousSessionTail() {
            manifest.previousSession = .init(
                lastEvent: previous.event,
                lastAt: previous.timestamp,
                closedCleanly: false
            )
        }

        let stamp = DiagnosticLineRenderer.timestamp(Date())
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: " ", with: "_")
        // 包里再套一层同名目录：解压出来的人不会把一堆 .log 直接撒进他当前那层目录，
        // 而"这一包是什么"从目录名上就读得到。
        let root = "synapse-diagnostics-\(stamp)"
        var all: [DiagnosticZip.Entry] = [
            .init(name: "\(root)/README.txt", data: Data(header.utf8)),
            .init(name: "\(root)/manifest.json", data: Data(DiagnosticExportManifest.encode(manifest).utf8)),
        ]
        all.append(contentsOf: entries.map {
            DiagnosticZip.Entry(name: "\(root)/\($0.name)", data: $0.data, modified: $0.modified)
        })

        guard let archive = DiagnosticZip.archive(all) else { return nil }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(root).zip")
        // 上一次导出的产物还躺在 tmp 里。导出会重复发生（发一次不够就再发一次），
        // 不清理的话每一份都留到系统回收为止。
        if let previousExport = lastExportURL, previousExport != url {
            try? FileManager.default.removeItem(at: previousExport)
        }
        guard (try? archive.write(to: url)) != nil else { return nil }
        lastExportURL = url
        return url
    }

    /// 连目录一起删掉，下次写入时惰性重建。
    func deleteAll() {
        queue.sync {
            closeAllActiveFiles()
            timer?.cancel()
            timer = nil
            try? FileManager.default.removeItem(at: directory)
            for lane in DiagnosticLane.allCases {
                lanes[lane] = LaneState()
            }
        }
    }

    // MARK: - 路径与文件

    private func laneDirectory(_ lane: DiagnosticLane) -> URL {
        directory.appendingPathComponent(lane.directoryName, isDirectory: true)
    }

    private func listFiles(in lane: DiagnosticLane) -> [DiagnosticFileInfo] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: laneDirectory(lane),
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

    /// 把分域之前留在根目录下的日志收编进 `app/`。
    ///
    /// **不收编的话，升级后第一次启动会把"上个版本最后一次正常运行"读成 nil ——**
    /// `previousSessionTail()` 只认 app 路，而旧文件的根目录里没有这一路。后果是
    /// 从那以后再也报不出「疑似崩溃」，而这是最难被发现的那种回归：没有任何报错，
    /// 只是那条记录永远不出现了。
    ///
    /// 幂等：根目录没有 `.log` 时什么都不做，不需要任何标志位。
    private static func adoptLegacyFiles(root: URL) {
        let keys: [URLResourceKey] = [.fileSizeKey]
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: keys
        ) else { return }
        let legacy = urls.filter { $0.pathExtension == "log" }
        guard !legacy.isEmpty else { return }
        let target = root.appendingPathComponent(DiagnosticLane.app.directoryName, isDirectory: true)
        guard createDirectoryIfNeeded(target) else { return }
        for url in legacy {
            let destination = target.appendingPathComponent(url.lastPathComponent)
            // 同名就留着旧的那份不动：极少数情况下（同一个 pid、同一秒重启）会撞名，
            // 而覆盖是这里唯一不可逆的动作。
            guard !FileManager.default.fileExists(atPath: destination.path) else { continue }
            try? FileManager.default.moveItem(at: url, to: destination)
        }
    }

    private static func createDirectoryIfNeeded(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) {
            return isDirectory.boolValue
        }
        // `completeUntilFirstUserAuthentication` 而不是默认档：冷启动还没解锁时
        // 也要能写，否则开机头几秒的日志会整段丢掉。
        return (try? FileManager.default.createDirectory(
            at: url,
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
