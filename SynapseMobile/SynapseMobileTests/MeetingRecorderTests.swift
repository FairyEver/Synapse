import AVFoundation
import Foundation
import Testing
@testable import SynapseMobile

/// 采集这一头的两条不变量。
///
/// 第一条是「录出来的文件读得出来」，第二条是**「录音还没停的时候，磁盘上就已经有一份
/// 能读的文件」**——后者正是普通 m4a 做不到的那件事，也是这个类型从 `AVAudioRecorder`
/// 换成 `AVAssetWriter` 分片写入的**全部理由**。它错了不会当场报错：只有进程在录音中途
/// 没了才会暴露，而那时候用户丢的是整段录音。
///
/// 这两条必须真录一段：容器形态、编码器、采样率、采集回调没有一样能靠纯逻辑代替。模拟器
/// 上跑得起来（麦克风接的是这台 Mac），真机跑同一套也一样。
///
/// **必须串行。** 每一条都要开自己的 `AVAudioEngine` 抢同一个麦克风，并行跑的时候谁先抢到
/// 谁就吞掉一大口缓冲——实测四条并行时会看到两条各自「录」到一模一样的 4200 毫秒、文件
/// 停在同样的字节数上不再增长，而节拍器仍在正常走。那是仪器串扰，不是录音的问题。
@Suite(.serialized)
@MainActor
struct MeetingRecorderTests {
    /// 录 `seconds` 秒，返回采集器、这一条的 id 和真实经过的墙钟毫秒。调用方负责 `stop()`。
    private func startRecording(seconds: Double) async throws -> (MeetingRecorder, String, Int) {
        let recordingId = UUID().uuidString
        let recorder = MeetingRecorder()
        try recorder.start(recordingId: recordingId)
        let began = Date()
        try await Task.sleep(for: .seconds(seconds))
        return (recorder, recordingId, Int(Date().timeIntervalSince(began) * 1000))
    }

    private func audioURL(_ recordingId: String) throws -> URL {
        try MeetingRecordingFiles.audioURL(recordingId: recordingId)
    }

    private func cleanUp(_ recordingId: String) {
        if let url = try? MeetingRecordingFiles.audioURL(recordingId: recordingId) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// **这条就是整次改动的理由。** 普通 m4a 把索引留到收尾才写，进程在录音中途被杀就什么
    /// 都不剩；分片写入让磁盘上随时有一份带索引、带已完成分片的文件。
    @Test func aFileOnDiskIsAlreadyReadableWhileTheRecordingIsStillRunning() async throws {
        let (recorder, recordingId, _) = try await startRecording(seconds: 6)
        let live = try Data(contentsOf: try audioURL(recordingId))
        recorder.stop()
        _ = await recorder.remainingBytesAfterStop()
        defer { cleanUp(recordingId) }

        #expect(live.count > 0)
        // 初始化段（`moov`）在开头，分片（`moof`）每两秒落一个。两者都在，才说明「此刻
        // 被杀」丢的只是最后那个没写完的分片。
        #expect(live.range(of: Data("moov".utf8)) != nil, "录音期间磁盘上就该有索引，否则被杀就什么都剩不下")
        #expect(live.range(of: Data("moof".utf8)) != nil, "录了 6 秒应该已经落下至少一个分片")
    }

    /// 现场撞到过一条 6 秒的录音上报 0 秒。时长改成从**已经写进编码器的采样数**算，不再问
    /// 录音器要当前时间。
    @Test func durationComesFromWhatWasActuallyWritten() async throws {
        let (recorder, recordingId, elapsedMs) = try await startRecording(seconds: 2)
        let reported = recorder.durationMs
        recorder.stop()
        let tail = await recorder.remainingBytesAfterStop()
        defer { cleanUp(recordingId) }

        // 录了多久就报多久：它跟着墙钟走，而不是恒为 0（现场那次）或者恒为某个缓冲长度
        // （并行抢麦克风那次每一条都报同一个数）。
        #expect(reported > 1_500, "录了两秒，报出来的时长不该是 0")
        #expect(abs(reported - elapsedMs) < 1_500, "报出来的 \(reported)ms 与实际录的 \(elapsedMs)ms 差了太多")
        #expect(tail != nil, "收尾那几个字节里带着索引，读不到就等于丢了一段")

        // 收尾之后必须是一份能被系统解出时长的完整文件。
        let asset = AVURLAsset(url: try audioURL(recordingId))
        let duration = try await asset.load(.duration)
        #expect(duration.seconds > 1.5)
    }

    /// 电平走的是采集回调 + 28 毫秒节拍这条路。这条断了不会报错，只是录音页上那条波形
    /// 永远是一条平线、静音提示也永远不出现。
    @Test func theLevelKeepsComingWhileRecording() async throws {
        let recorder = MeetingRecorder()
        var samples = 0
        recorder.onLevel = { _ in samples += 1 }
        let recordingId = UUID().uuidString
        try recorder.start(recordingId: recordingId)
        let began = Date()
        try await Task.sleep(for: .seconds(2))
        recorder.stop()
        _ = await recorder.remainingBytesAfterStop()
        let elapsedMs = Int(Date().timeIntervalSince(began) * 1000)
        defer { cleanUp(recordingId) }

        // 一拍的标称是 28 毫秒，实测约 34——`Task.sleep` 至少睡够 28 再加一圈循环的开销，
        // 老代码同一套节拍也是这样。门槛只卡在 10 Hz：节拍真断了（比如采集回调没接上）会掉到
        // 个位数，而这点余量足够吸收模拟器的调度抖动。
        #expect(samples > elapsedMs / 100, "两秒只来了 \(samples) 个电平，节拍断了")
    }
}
