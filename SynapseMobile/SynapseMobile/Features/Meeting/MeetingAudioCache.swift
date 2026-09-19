import Foundation

/// 录音音频的本机缓存。
///
/// 音频在云端，播放时每次现签一个地址去流式拉。听过的留在本机，再听不走网络；没网也能
/// 听听过的；一台设备上删掉的，别的设备上不再留可播的副本。
///
/// **界面上不出现它的任何痕迹**：没有「已下载」「已缓存」「离线」这类字样，列表行一个字
/// 都不加——它是实现细节，不是用户的心智模型。
///
/// 纯逻辑，不认识 `AVFoundation`、也不认识界面，所以能单测。音频本体放在录音落盘那个目录
/// 里（`MeetingRecordingFiles.directory()`，Application Support/MeetingRecordings，已排除
/// iCloud 备份），索引是它旁边的 `audio-cache.json`。
struct MeetingAudioCache {
    /// 本机上限 2 GB：40 分钟的会约 19 MB，大约能装 100 场。
    ///
    /// 它是一道防跑飞的安全阀，不是日常会碰到的边界。超了按「最后播放时间」从最早的开始
    /// 删，直到降回上限。不设时间过期：听过就留着，下次想听就还在。
    static let maxBytes = 2 * 1024 * 1024 * 1024

    /// 服务端一次最多返回多少条录音（`MeetingService.list` 的 `take: 200`）。
    ///
    /// 「本机有、这次列表里没有的那几条就是被删掉的」这个判断**只在返回条数少于上限时**
    /// 成立：正好等于上限说明还有更早的没返回，照着判会把它们误删。服务端改了这个数，
    /// 这里要跟着改。
    static let listLimit = 200

    /// 缓存目录。生产路径就是录音落盘那个目录（见 `shared`）。
    let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    /// 生产路径用的那个。
    ///
    /// 目录建不出来（系统盘满之类）时退到一个写不进去的地方：缓存整体退化成「每次都未
    /// 命中」，播放照旧走网络——**缓存永远不该让功能挂掉**。
    static var shared: MeetingAudioCache {
        let directory = (try? MeetingRecordingFiles.directory())
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
                .appendingPathComponent("MeetingRecordings", isDirectory: true)
        return MeetingAudioCache(directory: directory)
    }

    /// 索引里的一条。
    struct Entry: Codable, Equatable {
        let meetingId: String
        /// 这份音频的字节数。命中判据要拿它跟文件和跟服务端各对一次。
        var size: Int
        /// 最后一次播放的时刻。LRU 淘汰按它从早到晚删。
        var lastPlayedAt: Date
        /// 波形（0–255 字节的 base64）。**跟音频一起缓存**：离线时不该因为拉不到它而画
        /// 一条平线。没有采样时是空串。
        var peaks: String
    }

    private struct Index: Codable {
        var version = 1
        var entries: [Entry] = []
    }

    private static let indexFileName = "audio-cache.json"

    var indexURL: URL {
        directory.appendingPathComponent(Self.indexFileName)
    }

    /// 这一条音频在本机放哪儿。命名按 meetingId——录音期间那份是按 recordingId 命名的，
    /// 收尾成功后改名归入这里（见 `adopt`）。
    func audioURL(meetingId: String) -> URL {
        directory.appendingPathComponent("\(Self.sanitized(meetingId)).m4a")
    }

    // MARK: - 索引

    /// 索引。**读不出来、格式不对，一律当作空缓存**，不抛错：缓存永远不该让功能挂掉。
    func loadIndex() -> [Entry] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: indexURL),
              let index = try? decoder.decode(Index.self, from: data) else {
            return []
        }
        return index.entries
    }

    /// 写索引。**原子**：`.atomic` 就是「先写临时文件再 rename」，进程被杀也不会留下半份
    /// JSON 把整份缓存读废。写不进去（盘满）就当作这次没记住，不报错。
    func saveIndex(_ entries: [Entry]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(Index(entries: entries)) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    func entry(_ meetingId: String) -> Entry? {
        loadIndex().first { $0.meetingId == meetingId }
    }

    /// 缓存命中的话，这一条缓存的波形。没命中就是 nil，跟音频同一套判据。
    func peaks(meetingId: String, serverSize: Int) -> String? {
        guard cachedAudio(meetingId: meetingId, serverSize: serverSize) != nil else { return nil }
        return entry(meetingId)?.peaks
    }

    // MARK: - 命中判据

    /// 命中判据三件套：**文件在、文件大小等于索引里记的 `size`、服务端这次的 `size`
    /// 与它一致**。任一不符都算未命中。
    ///
    /// 不符时顺手把本机这份收拾掉（删文件、删索引条目）：坏的那份留着没有用，下一次判还是
    /// 未命中——「重下前先删掉坏文件」说的就是这里。清不掉也不报错，下一次再试。
    func cachedAudio(meetingId: String, serverSize: Int) -> URL? {
        let entries = loadIndex()
        guard let entry = entries.first(where: { $0.meetingId == meetingId }) else { return nil }
        guard entry.size == serverSize else {
            // 服务端那份的大小变了（重新上传过），本机这份已经不作数。
            remove(meetingId: meetingId)
            return nil
        }
        let url = audioURL(meetingId: meetingId)
        guard let size = fileSize(url), size == entry.size else {
            // 文件没了，或者被手工改坏了（截断一半）。
            remove(meetingId: meetingId)
            return nil
        }
        return url
    }

    // MARK: - 写入

    /// 音频下完了，记进索引。**播放就是从这一刻开始的**，所以最后播放时间就是现在。
    func store(meetingId: String, size: Int, peaks: String, at date: Date = Date()) {
        var entries = loadIndex().filter { $0.meetingId != meetingId }
        entries.append(Entry(meetingId: meetingId, size: size, lastPlayedAt: date, peaks: peaks))
        saveIndex(entries)
        pruneToLimit()
    }

    /// 刚录完那条的音频归入缓存。
    ///
    /// 录音期间音频本来就落在本机（`<recordingId>.m4a`），收尾成功后删掉再从云端下回来纯属
    /// 浪费——用户想马上回听刚录的那条，正是要秒开的那一下。缓存按 meetingId 命名，所以
    /// 这里只是**同一个目录里改个名**（`moveItem`），零成本。
    ///
    /// 源文件不在了就什么都不做：没有音频就没有缓存条目，不凭空造一条。
    func adopt(_ source: URL, meetingId: String, peaks: String, at date: Date = Date()) {
        let destination = audioURL(meetingId: meetingId)
        guard FileManager.default.fileExists(atPath: source.path) else { return }
        // 同名的旧副本先清掉：`moveItem` 撞上已经存在的目标会失败。
        try? FileManager.default.removeItem(at: destination)
        guard (try? FileManager.default.moveItem(at: source, to: destination)) != nil,
              let size = fileSize(destination) else { return }
        store(meetingId: meetingId, size: size, peaks: peaks, at: date)
    }

    /// 每次播放开始更新这一条的「最后播放时间」。
    ///
    /// 它只影响 LRU 的先后，不影响命中——所以索引里没有这一条时什么都不做，不凭空造一条
    /// 没有文件的记录出来。
    func markPlayed(meetingId: String, at date: Date = Date()) {
        var entries = loadIndex()
        guard let position = entries.firstIndex(where: { $0.meetingId == meetingId }) else { return }
        entries[position].lastPlayedAt = date
        saveIndex(entries)
    }

    // MARK: - 清理

    /// 删掉这一条的本机副本：文件和索引条目一起。
    ///
    /// 「删除」必须真的删干净，本机缓存不能成为例外——一台设备上删掉的，别的设备上不该还
    /// 留着一份能播的副本。删不掉（文件被占用等）不报错，下一次清理再试。
    func remove(meetingId: String) {
        try? FileManager.default.removeItem(at: audioURL(meetingId: meetingId))
        saveIndex(loadIndex().filter { $0.meetingId != meetingId })
    }

    /// 列表刷新之后清掉「本机有、这次列表里没有」的那些。
    ///
    /// **只在返回条数少于上限时才判**：条数正好等于上限说明服务端还有更早的没返回，不在
    /// 这份列表里的那些不是被删了，只是没轮到——照判会把它们误删。
    func pruneAgainstList(_ listedIds: [String], limit: Int) {
        guard listedIds.count < limit else { return }
        let alive = Set(listedIds)
        let entries = loadIndex()
        let stale = entries.filter { !alive.contains($0.meetingId) }
        guard !stale.isEmpty else { return }
        for entry in stale {
            try? FileManager.default.removeItem(at: audioURL(meetingId: entry.meetingId))
        }
        saveIndex(entries.filter { alive.contains($0.meetingId) })
    }

    /// 总量超过上限就按「最后播放时间」从早到晚删，直到降回上限。
    ///
    /// 计量用的是索引里记的 `size`——命中判据保证了它就是那份文件的字节数。
    func pruneToLimit() {
        let entries = loadIndex()
        var total = entries.reduce(0) { $0 + $1.size }
        guard total > Self.maxBytes else { return }

        var survivors = entries
        for candidate in orderedForEviction(entries) {
            if total <= Self.maxBytes { break }
            total -= candidate.size
            survivors.removeAll { $0.meetingId == candidate.meetingId }
            try? FileManager.default.removeItem(at: audioURL(meetingId: candidate.meetingId))
        }
        saveIndex(survivors)
    }

    /// 最久没听的排前面。同一个时间戳（索引里的时刻只到秒）按写进索引的先后排，顺序才是
    /// 确定的——LRU 淘汰的先后不该随排序算法摆动。
    private func orderedForEviction(_ entries: [Entry]) -> [Entry] {
        entries.enumerated()
            .sorted { ($0.element.lastPlayedAt, $0.offset) < ($1.element.lastPlayedAt, $1.offset) }
            .map(\.element)
    }

    // MARK: - 杂项

    private func fileSize(_ url: URL) -> Int? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.size] as? Int
    }

    /// 落盘的名字必须是单独一个路径段。meetingId 由服务端给，本来就可信，但拼路径之前过
    /// 一道手比事后解释便宜（与录音那条路同一个口径）。
    private static func sanitized(_ value: String) -> String {
        String(value.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }
}
