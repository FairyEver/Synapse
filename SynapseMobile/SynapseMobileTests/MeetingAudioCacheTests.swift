import Foundation
import Testing
@testable import SynapseMobile

/// 录音音频的本机缓存：命中判据、LRU 淘汰、列表刷新之后的清理、索引的读写。
///
/// 这几样算错了都不会报错，只会让人多下几遍、听不了，或者**把不该删的删掉**：
/// 命中判据松一格会播到一份截断的音频，列表那条清理松一格会把还没返回的录音误删。
/// 所以值得逐条钉住。
///
/// 每条用例一个自己的临时目录，互不干扰。
struct MeetingAudioCacheTests {
    // MARK: - 命中判据

    private func makeCache() throws -> MeetingAudioCache {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("MeetingAudioCacheTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return MeetingAudioCache(directory: directory)
    }

    /// 造一份「音频」并记进索引。
    ///
    /// `size` 是**记进索引的那个字节数**，正常与文件实际大小一致；测 LRU 时可以只写几
    /// 字节的文件、记一个几百 MB 的数——命中判据保证了这两个数在真实链路上永远相等，而
    /// 总不可能在单测里真写 2 GB 出来。
    @discardableResult
    private func put(
        _ cache: MeetingAudioCache,
        meetingId: String,
        bytes: Int,
        size: Int? = nil,
        peaks: String = "",
        at date: Date = Date()
    ) throws -> URL {
        let url = cache.audioURL(meetingId: meetingId)
        try Data(repeating: 0x41, count: bytes).write(to: url)
        cache.store(meetingId: meetingId, size: size ?? bytes, peaks: peaks, at: date)
        return url
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    @Test func fileAndIndexAndServerHaveToAgree() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "m-1", bytes: 128, peaks: "AAAA")

        // 三件都对上：命中，播的就是本机这份。
        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 128) == url)
        // 波形跟音频一起缓存：离线时不该因为拉不到它画一条平线。
        #expect(cache.peaks(meetingId: "m-1", serverSize: 128) == "AAAA")
    }

    @Test func aMissingFileIsNotAHit() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "m-1", bytes: 128)
        try FileManager.default.removeItem(at: url)

        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 128) == nil)
        // 索引里那条也没了：下一次判还是未命中，留着只会一直骗人。
        #expect(cache.entry("m-1") == nil)
    }

    @Test func aTruncatedFileIsNotAHitAndIsThrownAway() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "m-1", bytes: 128)

        // 手工把文件截去一半——上次下载中断、或者被人改坏，长这样。
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: 64)
        try handle.close()

        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 128) == nil)
        // 坏的那份顺手删掉：重下之前不该留着它。
        #expect(!exists(url))
        #expect(cache.entry("m-1") == nil)
    }

    @Test func aServerSizeThatDisagreesIsNotAHit() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "m-1", bytes: 128)

        // 服务端那份的大小变了（重新上传过）：本机这份已经不作数。
        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 256) == nil)
        #expect(!exists(url))
        #expect(cache.entry("m-1") == nil)
    }

    @Test func anUnknownServerSizeFallsBackToTheLocalIndex() throws {
        // 拿不到服务端大小（详情还没回来、服务端没报）时退化成「文件在、大小对得上」就当
        // 命中。少了这一条，这种时候会把本机这份判成坏的删掉——而那正好是「没网也想听
        // 听过的那条」最需要它的时候。电脑端同一条件同样处理，两端规则要一致。
        let cache = try makeCache()
        let url = try put(cache, meetingId: "m-1", bytes: 128)

        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 0) == url)
        #expect(exists(url))
        #expect(cache.entry("m-1") != nil)
    }

    // MARK: - 播放时间与 LRU

    @Test func playingSomethingMovesItToTheBackOfTheLine() throws {
        let cache = try makeCache()
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let half = MeetingAudioCache.maxBytes / 2

        try put(cache, meetingId: "a", bytes: 8, size: half, at: base)
        try put(cache, meetingId: "b", bytes: 8, size: half, at: base.addingTimeInterval(10))
        // 再听一次 a：它本来是最久没听的那条。这条记录不进总量，只改先后。
        cache.markPlayed(meetingId: "a", at: base.addingTimeInterval(20))

        // 放进第三条之后总量过线，这次该轮到 b 走。
        try put(cache, meetingId: "c", bytes: 8, size: half, at: base.addingTimeInterval(30))

        #expect(cache.entry("a") != nil)
        #expect(cache.entry("b") == nil)
        #expect(cache.entry("c") != nil)
        #expect(!exists(cache.audioURL(meetingId: "b")))
    }

    @Test func growingPastTheLimitEvictsTheOldestUntilItIsBackUnderIt() throws {
        let cache = try makeCache()
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        // 每条 600 MB，五条 3 GB。
        let size = 600 * 1024 * 1024

        for (index, id) in ["a", "b", "c", "d", "e"].enumerated() {
            try put(cache, meetingId: id, bytes: 8, size: size, at: base.addingTimeInterval(Double(index)))
        }
        // 每加一条就回落一次（上限是安全阀，不是攒到头才看一眼）：a、b 先后被清掉，
        // 剩下三条 1.8 GB。
        #expect(cache.entry("a") == nil)
        #expect(cache.entry("b") == nil)
        #expect(cache.entry("c") != nil)
        #expect(cache.entry("d") != nil)
        #expect(cache.entry("e") != nil)
        // 清掉的连文件一起清，没轮到的原样留着。
        #expect(!exists(cache.audioURL(meetingId: "a")))
        #expect(exists(cache.audioURL(meetingId: "c")))
    }

    @Test func aSingleEntryBiggerThanTheLimitIsEvictedToo() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "big", bytes: 8)
        // 一条就超过上限：不删它的话，缓存永远回不到上限以内。
        cache.saveIndex([
            MeetingAudioCache.Entry(
                meetingId: "big",
                size: MeetingAudioCache.maxBytes + 1,
                lastPlayedAt: Date(),
                peaks: ""
            )
        ])
        cache.pruneToLimit()

        #expect(cache.loadIndex().isEmpty)
        #expect(!exists(url))
    }

    // MARK: - 列表刷新之后的清理

    @Test func listRefreshOnlyPrunesWhenTheServerReturnedEverything() throws {
        let cache = try makeCache()
        for id in ["a", "b", "c"] {
            try put(cache, meetingId: id, bytes: 8)
        }

        // 返回条数**正好等于上限**：说明还有更早的没返回，不在列表里的不是被删了，
        // 只是没轮到——一个都不能清。
        let full = (1...MeetingAudioCache.listLimit).map { "id-\($0)" }
        cache.pruneAgainstList(full, limit: MeetingAudioCache.listLimit)
        #expect(cache.entry("a") != nil)
        #expect(cache.entry("b") != nil)
        #expect(cache.entry("c") != nil)

        // 返回条数少于上限：服务端给全了，不在里面的那两条就是被删掉的。
        cache.pruneAgainstList(["a"], limit: MeetingAudioCache.listLimit)
        #expect(cache.entry("a") != nil)
        #expect(cache.entry("b") == nil)
        #expect(cache.entry("c") == nil)
        #expect(!exists(cache.audioURL(meetingId: "b")))
    }

    @Test func signingOutTakesEveryCachedRecordingButLeavesTheRecordingInProgressAlone() throws {
        // 退出登录时整个清掉：缓存里每一条都是某个账号的录音，换个人登进来不该还在盘上。
        // 但同一个目录里还躺着录音中途那份按 recordingId 命名的音频——那是异常退出之后
        // 唯一的依据，由收尾那条路管，**不归这里删**。清成整个目录就把它一起毁了。
        let cache = try makeCache()
        let first = try put(cache, meetingId: "m-1", bytes: 16)
        let second = try put(cache, meetingId: "m-2", bytes: 16)
        let recordingInProgress = cache.directory.appendingPathComponent("rec-not-in-index.m4a")
        try Data(repeating: 0x42, count: 16).write(to: recordingInProgress)

        cache.clearAll()

        #expect(!exists(first))
        #expect(!exists(second))
        #expect(cache.loadIndex().isEmpty)
        #expect(exists(recordingInProgress))
    }

    @Test func anEmptyListStillCountsAsFewerThanTheLimit() throws {
        let cache = try makeCache()
        try put(cache, meetingId: "a", bytes: 8)
        // 一条录音都不剩了（用户把服务端清空了）：本机那份也该走。
        cache.pruneAgainstList([], limit: MeetingAudioCache.listLimit)
        #expect(cache.entry("a") == nil)
    }

    // MARK: - 索引

    @Test func aCorruptIndexCountsAsAnEmptyCacheAndNeverThrows() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "a", bytes: 8)

        // 写到一半被杀，留下的就是这种半份 JSON。
        try Data("[{\"version\":1,\"entries\":[{\"meetingId\":\"a\"".utf8).write(to: cache.indexURL)

        #expect(cache.loadIndex().isEmpty)
        #expect(cache.entry("a") == nil)
        #expect(cache.cachedAudio(meetingId: "a", serverSize: 8) == nil)
        // 读不出来只当空缓存，不该把那份音频也顺手删了——没有依据说明它坏了。
        #expect(exists(url))

        // 而且下一次照常写得进去。
        try put(cache, meetingId: "b", bytes: 4)
        #expect(cache.entry("b")?.size == 4)
    }

    @Test func indexWritesAreAtomic() throws {
        let cache = try makeCache()
        try put(cache, meetingId: "a", bytes: 8)
        let before = try inode(cache.indexURL)
        try put(cache, meetingId: "b", bytes: 8)
        let after = try inode(cache.indexURL)

        // 换了 inode 说明新版是**临时文件 rename 上去的**。原地截断重写会留着同一个
        // inode，而那样写一半被杀就留下一份读不出来的索引——整份缓存跟着废掉。
        #expect(before != after)
        // 临时文件不留在目录里。
        let leftovers = try FileManager.default
            .contentsOfDirectory(atPath: cache.directory.path)
            .filter { $0.hasSuffix(".tmp") }
        #expect(leftovers.isEmpty)
    }

    private func inode(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes[.systemFileNumber] as? Int) ?? -1
    }

    // MARK: - 刚录完那条

    @Test func aFinishedRecordingIsAdoptedInsteadOfDownloadedAgain() throws {
        let cache = try makeCache()
        // 录音期间那份按 recordingId 命名，跟缓存同一个目录。
        let source = cache.directory.appendingPathComponent("rec-1.m4a")
        try Data(repeating: 0x41, count: 64).write(to: source)

        cache.adopt(source, meetingId: "m-1", peaks: "AAAA", at: Date())

        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 64) != nil)
        #expect(cache.peaks(meetingId: "m-1", serverSize: 64) == "AAAA")
        // 改名归入，不是复制：本机不多留一份。
        #expect(!exists(source))
    }

    @Test func adoptingWithoutAnAudioFileAddsNothing() throws {
        let cache = try makeCache()
        // 收尾失败、音频已经没了的时候：不凭空造一条没有文件的缓存记录。
        cache.adopt(
            cache.directory.appendingPathComponent("rec-missing.m4a"),
            meetingId: "m-1",
            peaks: ""
        )
        #expect(cache.entry("m-1") == nil)
    }

    // MARK: - 删录音

    @Test func deletingARecordingTakesItsCachedAudioWithIt() throws {
        let cache = try makeCache()
        let url = try put(cache, meetingId: "m-1", bytes: 64)
        cache.markPlayed(meetingId: "m-1")

        cache.remove(meetingId: "m-1")

        #expect(!exists(url))
        #expect(cache.entry("m-1") == nil)
        #expect(cache.cachedAudio(meetingId: "m-1", serverSize: 64) == nil)
    }
}
