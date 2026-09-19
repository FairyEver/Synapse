import CryptoKit
import Foundation

/// 把一片字节交给服务端。抽成闭包是为了能在单测里换掉，不必真的起一个服务端。
typealias MeetingPartSender = @Sendable (_ partNumber: Int, _ bytes: Data) async throws -> Void

/// 中止这次分块上传。
///
/// 取消走的是这一条，不是「删掉对象」：未完成的分块上传留在桶里的碎片，删对象删不掉，
/// 会一直按量计费。
typealias MeetingUploadAborter = @Sendable () async -> Void

/// 分片上传。
///
/// 三条不变量：**按编号顺序传**、**同一时刻只有一次在传**、**取消走中止而不是删除**。
///
/// 前两条由「只有一条泵在跑，而且它在真的把一片发出去之前会 await」保证——没有并发的
/// 发送者，也就没有乱了序的可能。
///
/// 第三条的另一半是「已确认写入的区间不重传」：字节攒在 `buffer` 里，**服务端收下了才
/// 丢掉**，失败的那一片原样留着等下一次。所以一条长录音中途断网，重连之后接着发的是
/// 断点，不是从头。
@MainActor
final class MeetingUploader {
    private let send: MeetingPartSender
    private let abort: MeetingUploadAborter
    private let retries: Int

    private var buffer = MeetingPartBuffer()
    private var pump: Task<Void, Never>?
    private var isCancelled = false
    /// 发不出去的那一片就停在这里，不再往下吞字节。
    private(set) var lastError: String?

    /// 已经服务端收下的分片数。异常退出后从这里接着传。
    private(set) var uploadedParts = 0
    /// 每一片发出去时的摘要，收尾核对本地文件用。
    private var digests: [Int: SHA256Digest] = [:]

    private var isFinishing = false

    /// - Parameter startAtPart: 本机已经传上去的分片数。异常退出之后从这里接着传：
    ///   分片是按字节流上 1 MB 的整数倍切的，所以第 N 片之后的内容从 `N × 1 MB` 开始，
    ///   接着传的字节和当初会切出来的完全一致。
    init(
        startAtPart: Int = 0,
        send: @escaping MeetingPartSender,
        abort: @escaping MeetingUploadAborter,
        retries: Int = 3
    ) {
        self.send = send
        self.abort = abort
        self.retries = retries
        self.uploadedParts = max(0, startAtPart)
    }

    /// 已经确认丢掉的分片之后，不再需要重传的起点。
    var hasFailed: Bool { lastError != nil }

    /// 交字节进来。攒满一片就自己发出去，界面不需要知道。
    func enqueue(_ bytes: Data) {
        guard !isCancelled, bytes.count > 0 else { return }
        buffer.append(bytes)
        startPumpIfNeeded()
    }

    /// 收尾：把剩下的都发完，再拿本地音频核对一遍已经发过的片。
    ///
    /// 核对这一步是为了挡住编码器「录完回头改前面几个字节」这种情况——那样传上去的
    /// 分片和本地文件对不上，拼出来的音频是坏的，而且不会有任何地方报错。核对之后只
    /// 重传真的变过的那几片，所以「完成」的耗时仍然和录音长度无关。
    ///
    /// - Parameter audioFile: 本机那份音频。没有就只发尾片，不核对。
    /// - Returns: 是否全部发完。
    func finish(audioFile: URL?) async -> Bool {
        isFinishing = true
        // 起泵之前可能已经有一条在跑，而它是在 `isFinishing` 还是 false 的时候起的，
        // 会在「暂时没东西可发」那一刻收工。所以这里要一直等到缓冲真的空了为止。
        while true {
            startPumpIfNeeded()
            guard let task = pump else { break }
            await task.value
            if isCancelled || lastError != nil { break }
            if buffer.pendingBytes == 0 { break }
        }
        guard !isCancelled else { return false }

        if let audioFile, lastError == nil {
            await reconcile(with: audioFile)
        }
        return lastError == nil
    }

    /// 丢掉这一段：中止这次上传，已传的分片一并作废。
    func cancel() async {
        isCancelled = true
        pump?.cancel()
        await pump?.value
        buffer = MeetingPartBuffer()
        digests.removeAll()
        await abort()
    }

    // MARK: - 泵

    private func startPumpIfNeeded() {
        guard pump == nil, !isCancelled else { return }
        pump = Task { [weak self] in await self?.runPump() }
    }

    /// 只要还有整片就发；收尾时把尾巴也当成一片发出去。
    private func runPump() async {
        while !isCancelled {
            if let part = buffer.peekPart() {
                guard await deliver(part) else { break }
                buffer.dropPart()
                continue
            }
            if isFinishing, let tail = buffer.takeTail() {
                guard await deliver(tail) else {
                    // 尾巴发不出去，放回缓冲，下一次收尾再试。
                    buffer.append(tail)
                    break
                }
                continue
            }
            break
        }
        pump = nil
    }

    /// 发一片，带重试。成功记下摘要，失败记下原因。
    private func deliver(_ part: Data) async -> Bool {
        let partNumber = uploadedParts + 1
        for attempt in 0...retries {
            // 取消之后不该再重试：那不是网络抖动，是用户明确不要这一段了。
            if isCancelled || Task.isCancelled { return false }
            do {
                try await send(partNumber, part)
                uploadedParts = partNumber
                digests[partNumber] = SHA256.hash(data: part)
                lastError = nil
                return true
            } catch {
                if attempt == retries {
                    lastError = (error as? APIError)?.message ?? "录音未能保存，稍后会再试。"
                    return false
                }
                // 退一步再试。网络抖动是这条链路上最常见的中断，不是异常。
                try? await Task.sleep(for: .milliseconds(300 * (attempt + 1)))
            }
        }
        return false
    }

    // MARK: - 收尾核对

    /// 拿本机文件逐片比对：只重传真的变过的那几片。
    private func reconcile(with audioFile: URL) async {
        guard uploadedParts > 1, let handle = try? FileHandle(forReadingFrom: audioFile) else { return }
        defer { try? handle.close() }
        // 最后一片在收尾时刚发过，不必再核对；前面那些才是可能被编码器回头改写的。
        for partNumber in 1...(uploadedParts - 1) {
            guard !isCancelled else { return }
            guard let data = try? handle.read(upToCount: MeetingAudio.partBytes), !data.isEmpty else { break }
            // 只核对「当时是按整片发出去」的那些；尾巴在收尾时已经单独发过。
            guard data.count == MeetingAudio.partBytes else { break }
            guard digests[partNumber] != SHA256.hash(data: data) else { continue }
            do {
                try await send(partNumber, data)
                digests[partNumber] = SHA256.hash(data: data)
                lastError = nil
            } catch {
                lastError = (error as? APIError)?.message ?? "录音未能保存，稍后会再试。"
                return
            }
        }
    }
}
