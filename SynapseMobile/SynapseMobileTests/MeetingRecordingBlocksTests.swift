import Foundation
import Testing
@testable import SynapseMobile

/// 分片切分、波形编码、那条滚动窗口的排布。
///
/// 这几样算错了都不会报错，只会让人听错或看错：分片切错拼出来的音频是坏的，波形编码
/// 少一步就画成实心方块，窗口算错最新的柱子会被挤出右边缘。所以值得钉住。
struct MeetingRecordingBlocksTests {
    // MARK: - 分片

    private func bytes(_ count: Int) -> Data {
        Data((0..<count).map { UInt8($0 % 251) })
    }

    @Test func bufferHoldsUntilAFullPartIsThere() {
        var buffer = MeetingPartBuffer()
        buffer.append(bytes(MeetingAudio.partBytes - 1))
        // 差一个字节也不算一片：分片边界必须是它该在的地方。
        #expect(buffer.peekPart() == nil)
        #expect(buffer.hasPendingTail)

        buffer.append(bytes(1))
        #expect(buffer.peekPart()?.count == MeetingAudio.partBytes)
    }

    @Test func peekDoesNotConsumeUntilThePartIsAcknowledged() {
        var buffer = MeetingPartBuffer()
        buffer.append(bytes(MeetingAudio.partBytes))
        let first = buffer.peekPart()
        // 看一百次也不动它：只有服务端收下了才丢，这是「不重传已确认区间」的全部实现。
        #expect(buffer.peekPart() == first)
        #expect(buffer.pendingBytes == MeetingAudio.partBytes)

        buffer.dropPart()
        #expect(buffer.pendingBytes == 0)
        #expect(buffer.peekPart() == nil)
    }

    @Test func bufferSplitsExactlyOnTheBoundary() {
        var buffer = MeetingPartBuffer()
        buffer.append(bytes(MeetingAudio.partBytes * 2 + 7))
        #expect(buffer.peekPart()?.count == MeetingAudio.partBytes)
        buffer.dropPart()
        #expect(buffer.peekPart()?.count == MeetingAudio.partBytes)
        buffer.dropPart()
        // 剩下的是尾巴，不到一片。
        #expect(buffer.peekPart() == nil)
        #expect(buffer.takeTail()?.count == 7)
        #expect(buffer.pendingBytes == 0)
    }

    @Test func tailIsTheRemainderNotAnExtraFullPart() {
        var buffer = MeetingPartBuffer()
        // 正好两片：没有尾巴，收尾时不该凭空多出一片空的分片。
        buffer.append(bytes(MeetingAudio.partBytes * 2))
        buffer.dropPart()
        buffer.dropPart()
        #expect(buffer.takeTail() == nil)
    }

    @Test func emptyBufferHasNothing() {
        var buffer = MeetingPartBuffer()
        #expect(buffer.peekPart() == nil)
        #expect(buffer.takeTail() == nil)
        #expect(buffer.pendingBytes == 0)
    }

    // MARK: - 波形编码

    @Test func peaksRoundTripThroughTheWireFormat() {
        let values: [Double] = [0, 0.25, 0.5, 1]
        let decoded = MeetingPeaks.decode(MeetingPeaks.encode(values))
        #expect(decoded.count == values.count)
        #expect(decoded[0] == 0)
        #expect(abs(decoded[3] - 1) < 0.001)
        #expect(abs(decoded[1] - 0.25) < 0.01)
    }

    @Test func peaksSurviveTheThreeExtremes() {
        // 空、全 0、全 255。第三种是电脑端踩过的那个坑的另一边：字节当振幅画，整条被
        // 裁成实心方块。
        #expect(MeetingPeaks.decode(MeetingPeaks.encode([])).isEmpty)

        let silence = MeetingPeaks.decode(MeetingPeaks.encode([Double](repeating: 0, count: 8)))
        #expect(silence == [Double](repeating: 0, count: 8))

        let full = MeetingPeaks.decode(MeetingPeaks.encode([Double](repeating: 1, count: 8)))
        #expect(full == [Double](repeating: 1, count: 8))
    }

    @Test func peaksAreNormalisedNotBytes() {
        // 服务端存的是一个字节一个采样。画之前必须除以 255——不除的话字节 200 会变成
        // 「振幅 200」，每一根柱子都被裁到满高，而且没有任何地方会报错。
        let decoded = MeetingPeaks.decode(MeetingPeaks.encode([0.8]))
        #expect(decoded.first.map { $0 <= 1 } == true)
        #expect(decoded.first.map { $0 > 0.79 && $0 < 0.81 } == true)
    }

    @Test func garbagePeaksDecodeToNothingInsteadOfNoise() {
        // Base64 解码器很宽松：喂它一段普通文字，它会把碰巧合法的字符挑出来凑成几个
        // 字节。那不报错，画出来是一排没有意义的柱子。
        #expect(MeetingPeaks.decode("这不是 base64").isEmpty)
        #expect(MeetingPeaks.decode("abc").isEmpty)  // 长度不是 4 的倍数
        #expect(MeetingPeaks.decode(nil).isEmpty)
        #expect(MeetingPeaks.decode("").isEmpty)
    }

    // MARK: - 振幅包络

    @Test func peakStoreFloorsSilenceSoBarsStayVisible() {
        var store = MeetingPeakStore()
        let value = store.push(0)
        // 静音也有一个极小的底，否则柱子会缩成一条看不见的线。
        #expect(value == MeetingAudio.amplitudeFloor)
        #expect(!store.sawSound)
    }

    @Test func peakStoreDecaysSlowerThanItRises() {
        var store = MeetingPeakStore()
        let loud = store.push(1)
        #expect(loud == 1)
        // 一下子掉到 0 的话波形看起来像一根抖动的刺；0.82 的衰减让它像人声。
        let next = store.push(0)
        #expect(abs(next - MeetingAudio.amplitudeDecay) < 0.0001)
    }

    @Test func peakStoreRemembersThatSoundWasEverHeard() {
        var store = MeetingPeakStore()
        store.push(0.5)
        #expect(store.sawSound)
        // 听到过一次之后，即使又安静下来也不再提示「没有听到声音」——开会中途不打扰。
        for _ in 0..<50 { store.push(0) }
        #expect(store.sawSound)
    }

    @Test func peakStoreNeverExceedsOne() {
        var store = MeetingPeakStore()
        for _ in 0..<10 { #expect(store.push(50) <= 1) }
    }

    // MARK: - 电平换算

    @Test func levelMappingAppliesTheGainTheDesktopUses() {
        // 正常说话在 -30 dBFS 上下。换算之后必须越过「听到了声音」的阈值——不乘那个增
        // 益的话这里只有 0.03，一场会录完提示行会一直挂着「没有听到声音」，而且波形
        // 只有应有高度的六分之一。
        #expect(MeetingAudio.amplitude(fromAveragePower: -30) > MeetingAudio.loudAmplitude)
        #expect(MeetingAudio.amplitude(fromAveragePower: -20) > MeetingAudio.loudAmplitude)
        // 和电脑端同一条线：RMS 大于约 -35 dBFS 才算听到。
        #expect(MeetingAudio.amplitude(fromAveragePower: -40) < MeetingAudio.loudAmplitude)
    }

    @Test func levelMappingClampsTheSilenceFloor() {
        // -160 dBFS 是录音器报的下限。它要落到地板以下，由 push 抬到地板。
        #expect(MeetingAudio.amplitude(fromAveragePower: -160) < MeetingAudio.amplitudeFloor)
        // 不是有限数（没有输入设备时会得到 -inf 或 nan）按没有声音处理，不是崩。
        #expect(MeetingAudio.amplitude(fromAveragePower: -.infinity) == 0)
        #expect(MeetingAudio.amplitude(fromAveragePower: .nan) == 0)
    }

    @Test func liveAndRecoveredWaveformsUseTheSameScale() {
        // 实时那条路和异常退出重算那条路必须画成一样高。重算那条乘了增益，所以实时这条
        // 也要乘，而且是同一个数。
        var store = MeetingPeakStore()
        let live = store.push(MeetingAudio.amplitude(fromAveragePower: -30))

        var recovered = MeetingPeakStore()
        let rms = pow(10.0, -30.0 / 20)
        let fromFile = recovered.push(rms * MeetingAudio.amplitudeGain)

        #expect(abs(live - fromFile) < 1e-9)
    }

    // MARK: - 滚动波形

    @Test func waveSlotWidthIsFixedNoMatterHowLongTheRecordingIs() {
        // 录 1 分钟和录 5 秒，柱子的宽度和间距一样：槽位数由宽度和 5 秒窗口定死，
        // 不由已经录了多久决定。
        let short = meetingLiveWaveLayout(peakCount: 10, canvasWidth: 390)
        let long = meetingLiveWaveLayout(peakCount: 20_000, canvasWidth: 390)
        #expect(short.slots == long.slots)
    }

    @Test func waveKeepsTheNewestSamplesAtTheRightEdge() {
        // 装满之后，取的是末尾那几个采样——最新的贴在右边缘，旧的从左边的槽位滚出去。
        let layout = meetingLiveWaveLayout(peakCount: 20_000, canvasWidth: 390)
        #expect(layout.visibleCount == layout.slots)
        #expect(layout.startSlot == 0)
        #expect(layout.firstIndex(totalPeaks: 20_000) == 20_000 - layout.slots)
    }

    @Test func waveLeavesLeftSlotsEmptyUntilItFillsUp() {
        // 没装满时左边的槽位空着，柱子从右边开始长。
        let layout = meetingLiveWaveLayout(peakCount: 3, canvasWidth: 390)
        #expect(layout.visibleCount == 3)
        #expect(layout.startSlot == layout.slots - 3)
        #expect(layout.firstIndex(totalPeaks: 3) == 0)
    }

    @Test func waveWindowIsCappedByTheFiveSecondWindow() {
        // 画布很宽的时候，限制槽位数的应该是 5 秒窗口，不是宽度：不能因为屏幕宽就把
        // 五分钟的录音全塞进来。
        let wide = meetingLiveWaveLayout(peakCount: 100_000, canvasWidth: 5_000)
        let windowSlots = Int((Double(MeetingAudio.liveWindowMs) / Double(MeetingAudio.peakMs)).rounded())
        #expect(wide.slots == windowSlots)
    }

    @Test func waveHandlesAnEmptyRecording() {
        let layout = meetingLiveWaveLayout(peakCount: 0, canvasWidth: 390)
        #expect(layout.visibleCount == 0)
        #expect(layout.slots > 0)
    }

    // MARK: - 回放波形

    @Test func playbackResamplingTakesThePeakOfEachBucket() {
        // 取最大值而不是平均：平均会把一段话里最响的那个音节抹平，回放出来比实际安静，
        // 而这条波形唯一的作用就是让人认出「刚才那句在哪儿」。
        let peaks: [Double] = [0.1, 0.9, 0.2, 0.3, 0.8, 0.05]
        let columns = resamplePlaybackPeaks(peaks, columns: 3)
        #expect(columns.count == 3)
        #expect(abs(columns[0] - 0.9) < 0.0001)
        #expect(abs(columns[1] - 0.3) < 0.0001)
        #expect(abs(columns[2] - 0.8) < 0.0001)
    }

    @Test func playbackResamplingKeepsEverySampleWhenThereIsRoom() {
        // 采样比列数少的时候不该被抹掉，否则短录音的波形会变得没有细节。
        let peaks: [Double] = [0.1, 0.5, 0.9]
        #expect(resamplePlaybackPeaks(peaks, columns: 10) == peaks)
    }

    @Test func playbackResamplingHandlesNothing() {
        #expect(resamplePlaybackPeaks([], columns: 10).isEmpty)
        #expect(resamplePlaybackPeaks([0.5], columns: 0).isEmpty)
    }

    @Test func playbackLayoutFillsTheWidth() {
        // 回放那条是**整段铺满宽度**的，与录音页那条滚动窗口不同——这是有意的。
        let layout = meetingPlaybackWaveLayout(peakCount: 10_000, canvasWidth: 390)
        #expect(layout.columns > 100)
        #expect(layout.barWidth > 0)
        // 柱子再胖也有上限：一排胖方块读不出「哪一段更响」。
        #expect(layout.barWidth <= 6)
    }

    @Test func playbackLayoutDoesNotFatBarsWhenSamplesAreFew() {
        let few = meetingPlaybackWaveLayout(peakCount: 4, canvasWidth: 390)
        #expect(few.barWidth <= 6)
    }

    // MARK: - 时长估算

    @Test func durationEstimateFollowsTheBitRate() {
        // 64 kbps 单声道 = 8 KB/s，所以 1 MB 约 128 秒。异常退出时只有字节数可依，
        // 这个换算就是那条录音显示的时长。
        #expect(MeetingDurationEstimate.fromBytes(8_000) == 1_000)
        #expect(MeetingDurationEstimate.fromBytes(0) == 0)
        let megabyte = MeetingDurationEstimate.fromBytes(MeetingAudio.partBytes)
        #expect(megabyte > 125_000 && megabyte < 132_000)
    }
}
