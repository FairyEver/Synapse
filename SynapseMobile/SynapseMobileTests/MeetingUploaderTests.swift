import Foundation
import Testing
@testable import SynapseMobile

/// 分片上传的三条不变量，以及收尾时的核对。
///
/// 这几条错了都不会当场报错：乱序会拼出一段中间缺了一截的音频，并发会拼出重复的段落，
/// 取消走错路会在桶里留下按量计费的碎片。所以它们必须被钉住。
@MainActor
struct MeetingUploaderTests {
    /// 假装的服务端。
    @MainActor
    final class FakeSender {
        var sent: [(partNumber: Int, count: Int)] = []
        /// 每一次调用都记一笔，包括失败的那几次。只看 `sent` 分不清「重试过」和
        /// 「根本没失败」。
        var attempts: [Int] = []
        /// 这些分片编号第一次发的时候失败一次。
        var failOnce: Set<Int> = []
        /// 这些分片编号永远失败。
        var failAlways: Set<Int> = []
        /// 同一时刻有几个在传。
        var inFlight = 0
        var maxInFlight = 0
        var aborted = false
        private var failedAlready: Set<Int> = []

        func send(_ partNumber: Int, _ bytes: Data) async throws {
            attempts.append(partNumber)
            inFlight += 1
            maxInFlight = max(maxInFlight, inFlight)
            defer { inFlight -= 1 }
            // 让出一次，好让「同一时刻只有一次在传」这件事有机会被违反。
            try? await Task.sleep(for: .milliseconds(1))
            if failAlways.contains(partNumber) {
                throw APIError(status: 500, code: nil, message: "服务器出错了。")
            }
            if failOnce.contains(partNumber), !failedAlready.contains(partNumber) {
                failedAlready.insert(partNumber)
                throw APIError(status: 0, code: "network", message: "网络不可用。")
            }
            sent.append((partNumber, bytes.count))
        }

        func abort() async { aborted = true }
    }

    private func payload(_ bytes: Int) -> Data {
        Data((0..<bytes).map { UInt8($0 % 251) })
    }

    private func uploader(_ sender: FakeSender, retries: Int = 3) -> MeetingUploader {
        MeetingUploader(
            send: { try await sender.send($0, $1) },
            abort: { await sender.abort() },
            retries: retries
        )
    }

    @Test func partsGoOutInOrderAndOneAtATime() async {
        let sender = FakeSender()
        let uploader = uploader(sender)
        // 两片半：正好 1 MB、1 MB + 1 字节、和中间的 1 MB 都覆盖到了。
        uploader.enqueue(payload(MeetingAudio.partBytes * 2 + 1))

        #expect(await uploader.finish(audioFile: nil))

        #expect(sender.sent.map(\.partNumber) == [1, 2, 3])
        #expect(sender.sent.map(\.count) == [MeetingAudio.partBytes, MeetingAudio.partBytes, 1])
        // 同一时刻只有一次在传：服务端对顺序是强约束，并发的发送者没有顺序可言。
        #expect(sender.maxInFlight == 1)
    }

    @Test func anEmptyRecordingSendsNothing() async {
        let sender = FakeSender()
        let uploader = uploader(sender)
        #expect(await uploader.finish(audioFile: nil))
        #expect(sender.sent.isEmpty)
    }

    @Test func aFailedPartIsRetriedAndEarlierPartsAreNotResent() async {
        let sender = FakeSender()
        // 第二片第一次发失败。重连之后要接着断点发，而不是从头再来。
        sender.failOnce = [2]
        let uploader = uploader(sender)
        uploader.enqueue(payload(MeetingAudio.partBytes * 3))

        #expect(await uploader.finish(audioFile: nil))

        // 第二片试了两次——**还是第二片**，不是接着往下发第三片。断点续传说的是这个：
        // 重连之后从断掉的那一片继续，中间不会留一个洞。
        #expect(sender.attempts == [1, 2, 2, 3])
        #expect(sender.sent.map(\.partNumber) == [1, 2, 3])
        // 第一片只试过一次：已经确认写入的区间不重传。
        #expect(sender.attempts.filter { $0 == 1 }.count == 1)
    }

    @Test func aPartThatKeepsFailingStopsTheUploadAndSaysWhy() async {
        let sender = FakeSender()
        sender.failAlways = [2]
        let uploader = uploader(sender, retries: 0)
        uploader.enqueue(payload(MeetingAudio.partBytes * 3))

        #expect(await uploader.finish(audioFile: nil) == false)
        #expect(uploader.lastError != nil)
        // 第二片卡住之后不该继续往下发第三片：那会在中间留一个洞。
        #expect(sender.sent.map(\.partNumber) == [1])
    }

    @Test func cancelGoesThroughTheAbortPathAndStopsSending() async {
        let sender = FakeSender()
        let uploader = uploader(sender)
        uploader.enqueue(payload(MeetingAudio.partBytes * 3))
        await uploader.cancel()

        // 取消走的是**中止**，不是删除：未完成的分块上传留在桶里的碎片，删对象删不掉，
        // 会一直按量计费。
        #expect(sender.aborted)
        let afterCancel = sender.sent.count
        uploader.enqueue(payload(MeetingAudio.partBytes))
        _ = await uploader.finish(audioFile: nil)
        #expect(sender.sent.count == afterCancel)
    }

    @Test func reconcileResendsOnlyThePartsThatChanged() async throws {
        let sender = FakeSender()
        let uploader = uploader(sender)
        let uploaded = payload(MeetingAudio.partBytes * 2)
        uploader.enqueue(uploaded)
        // 先把两片发出去，再改本机文件——模拟编码器录完之后回头改写了开头。
        #expect(await uploader.finish(audioFile: nil))
        #expect(sender.sent.map(\.partNumber) == [1, 2])

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("reconcile-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        var changed = uploaded
        changed[0] = changed[0] &+ 1
        try changed.write(to: url)

        sender.sent.removeAll()
        #expect(await uploader.finish(audioFile: url))

        // 只有变过的那一片被重发；上一片没变，最后一片是刚发的，都不动。
        #expect(sender.sent.map(\.partNumber) == [1])
    }

    @Test func reconcileLeavesUntouchedPartsAlone() async throws {
        let sender = FakeSender()
        let uploader = uploader(sender)
        let uploaded = payload(MeetingAudio.partBytes * 2)
        uploader.enqueue(uploaded)
        #expect(await uploader.finish(audioFile: nil))

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("reconcile-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        try uploaded.write(to: url)

        sender.sent.removeAll()
        #expect(await uploader.finish(audioFile: url))
        // 文件一个字节都没变：一片都不重发，「完成」的耗时因此与录音长度无关。
        #expect(sender.sent.isEmpty)
    }
}
