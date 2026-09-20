import Foundation

/// 录音这条链路上那些「算错了不报错，只是听错或看错」的纯逻辑：分片怎么切、振幅怎么
/// 攒、波形怎么编码、文件放哪。
///
/// 单独一个文件是为了能单测：它不认识界面，也不认识 `AVFoundation`。
///
/// `nonisolated`：这里全是常量，没有任何一件和主 actor 有关，而它们要被重算波形那条
/// 路（在主线程之外跑）读到。不标就等于给每个读者都加一道没有意义的隔离要求。
nonisolated enum MeetingAudio {
    /// AAC / m4a 单声道 64 kbps。
    ///
    /// **48 kHz 不是随手选的。** iOS 的 AAC 编码器在 16 kHz 单声道下直接拒绝 64 kbps
    /// （`-11861 编码参数不支持`，48 kbps 才收）。64 kbps 是两边要一致的那个档位，所以
    /// 让采样率跟着它走：体积仍是设计文档写的约 28 MB/小时。
    static let sampleRate: Double = 48_000
    static let bitRate = 64_000
    static let channels = 1

    /// 一次上传的单位。也是对象存储分块上传的最小分片。
    static let partBytes = 1_048_576

    /// 波形取样的间隔。和电脑端同一个数：一个采样永远占同样宽的槽位。
    static let peakMs = 28
    /// 录音页只回看最近 5 秒。
    static let liveWindowMs = 5_000
    /// 开头这么久没听到声音，就把结论写出来。听到过一次就永不再提。
    static let silenceHintMs = 4_000

    /// 单条上限，与电脑端一致。到顶就自动收尾。
    static let maxDurationMs = 5 * 60 * 60 * 1000
    /// 对象存储对分片数的上限。
    static let maxUploadParts = 10_000

    /// 包络用的三个数：下降比上升慢，看起来才像人声而不是一根抖动的刺；静音留一个极小
    /// 的底，否则柱子会缩成一条看不见的线。
    static let amplitudeDecay = 0.82
    static let amplitudeFloor = 0.02

    /// 超过它就算「听到过声音」。在这个刻度上是约 -43 dBFS，也就是比房间底噪高一点就
    /// 算——只有真的没听到东西时才会提示「没有听到声音」。
    static let loudAmplitude = 0.1

    /// 这条波形铺开的动态范围。0 dBFS 是满刻度，留到真顶满才用得上；-48 以下是静音。
    ///
    /// 两端都是 dBFS 而不是线性振幅，是这个刻度唯一要紧的地方：见
    /// `amplitude(fromDecibels:)`。
    static let meterFloorDecibels = -48.0
    static let meterCeilingDecibels = 0.0

    /// 录音页那条滚动波形的柱宽与间距，与电脑端同一组数。
    ///
    /// **不与实时活动共用**：锁屏和灵动岛上那条已经改成语音备忘录那种圆点（见
    /// `RecordingActivityLimits` 的 `dotWidth` / `dotGap`）。两处是两种画法，不该再
    /// 互相引用——共用会让改一边就动到另一边，而它们本来就要长得不一样。
    static let barWidth = 1.5
    static let barGap = 1.1

    /// 电平 → 包络上的振幅。**在对数域上摊开，不是换回线性再乘一个增益。**
    ///
    /// 比值刻度上只有很窄的一段能用：`linear × 6` 意味着 -15.6 dBFS 就把柱子顶满，而正常
    /// 说话本身就有 30 dB 以上的起伏。于是稍微开口波形就贴顶，说到多大声都一样高——波形
    /// 上区分不出音量，那它就没有用了。这里把 -48…0 dBFS 均匀铺到 0…1，说多大声就多高。
    ///
    /// 两条路必须都走这里，否则同一条录音在录音页和异常退出重算出来不一样高。
    static func amplitude(fromDecibels decibels: Double) -> Double {
        guard decibels.isFinite else { return 0 }
        let clamped = min(meterCeilingDecibels, max(meterFloorDecibels, decibels))
        return (clamped - meterFloorDecibels) / (meterCeilingDecibels - meterFloorDecibels)
    }

    /// 录音器报的电平 → 包络上的振幅。`averagePower` 就是 dBFS。
    static func amplitude(fromAveragePower decibels: Double) -> Double {
        amplitude(fromDecibels: decibels)
    }

    /// 从采样算出来的 RMS → 包络上的振幅。异常退出之后重算波形走的是这一条。
    static func amplitude(fromRMS rms: Double) -> Double {
        guard rms > 0 else { return 0 }
        return amplitude(fromDecibels: 20 * log10(rms))
    }
}

/// 攒够一片就切出去。
///
/// 编码器每 2 秒给一批字节，和 1 MB 对不齐，所以字节必须先攒着。切出去的时刻只有
/// 两个：攒满一片，或者收尾时把尾巴一起交出去。
struct MeetingPartBuffer {
    private var pending = Data()

    var pendingBytes: Int { pending.count }
    var hasPendingTail: Bool { !pending.isEmpty }

    mutating func append(_ bytes: Data) {
        pending.append(bytes)
    }

    /// 看一眼下一片，**不动内部状态**。
    ///
    /// 分开的「看一眼」和「丢掉」是「已确认写入的区间不重传」的全部实现：只有服务端
    /// 收了才丢掉，失败的那一片原样留在缓冲里，下一次接着重传。
    func peekPart() -> Data? {
        guard pending.count >= MeetingAudio.partBytes else { return nil }
        return Data(pending.prefix(MeetingAudio.partBytes))
    }

    /// 这一片服务端收下了，丢掉它。
    mutating func dropPart() {
        guard pending.count >= MeetingAudio.partBytes else { return }
        pending.removeFirst(MeetingAudio.partBytes)
    }

    /// 收尾时把不足一片的尾巴作为最后一片取走。没有尾巴返回 nil。
    mutating func takeTail() -> Data? {
        guard !pending.isEmpty, pending.count < MeetingAudio.partBytes else { return nil }
        let tail = pending
        pending = Data()
        return tail
    }
}

/// 一路攒下来的振幅包络。
///
/// 存的是**平滑之后**的值，和电脑端一样：包络下降比上升慢，波形看起来才像人声。
/// 它就是随 `complete` 上报的那份 `peaks`。
///
/// `nonisolated`：纯值类型，重算波形那条路（主线程之外）要能就地用它。
nonisolated struct MeetingPeakStore {
    private(set) var values: [Double] = []
    private var previous: Double = 0
    /// 这一次录音里有没有出现过像样的声音。提示行靠它决定要不要说「没有听到声音」。
    private(set) var sawSound = false

    /// 收一个 0–1 的振幅进来，返回平滑之后存下去的那个值。
    @discardableResult
    mutating func push(_ amplitude: Double) -> Double {
        let clamped = max(0, amplitude)
        if clamped > MeetingAudio.loudAmplitude { sawSound = true }
        let smoothed = min(1, max(MeetingAudio.amplitudeFloor, max(clamped, previous * MeetingAudio.amplitudeDecay)))
        previous = smoothed
        values.append(smoothed)
        return smoothed
    }

    /// 上报给服务端的那一串。没有采样时是空串，服务端据此存 null。
    func encode() -> String {
        MeetingPeaks.encode(values)
    }
}

/// 波形数据的编解码。两端必须用同一套，否则详情页画出来的东西对不上。
enum MeetingPeaks {
    /// 0–1 的振幅压成「一个采样一个字节」，再 base64。
    static func encode(_ values: [Double]) -> String {
        guard !values.isEmpty else { return "" }
        var bytes = [UInt8](repeating: 0, count: values.count)
        for (index, value) in values.enumerated() {
            bytes[index] = UInt8(min(255, max(0, (value * 255).rounded())))
        }
        return Data(bytes).base64EncodedString()
    }

    /// 服务端存的是 0–255 的字节，这里还原成 0–1 的振幅。
    ///
    /// **少这一步不会报任何错，只会把整条波形画成一个实心方块。** 画布上的柱子半高
    /// 是 `振幅 × 半高 × 0.9`，字节只要 ≥ 2，算出来的半高就已经超过半高本身，每根
    /// 柱子都被裁到满高。电脑端在这个坑里摔过一次（提交 02797ce7a），手机端不重犯。
    static func decode(_ encoded: String?) -> [Double] {
        guard let encoded, !encoded.isEmpty else { return [] }
        // 先按格式挡住，再解码。Base64 解码器很宽松：喂它一段非 base64 的文字，它不
        // 报错，而是把碰巧合法的字符挑出来凑成几个字节，画出来是一排没有意义的柱子。
        guard encoded.count % 4 == 0,
              let data = Data(base64Encoded: encoded) else { return [] }
        return data.map { Double($0) / 255 }
    }
}

/// 录音页那条滚动波形的排布。
///
/// 三条口径都在这里：**槽位宽度固定**（录得越久不会把整段压进同一个框），**贴右边缘
/// 从右往左长**（最新的在右边，没装满时左边的槽位空着），**只回看最近 5 秒**（槽位数
/// 同时受时间窗口和画布宽度限制，取小的那个）。
struct MeetingLiveWaveLayout: Equatable {
    /// 画布上总共有几个槽位。
    let slots: Int
    /// 其中要画几个柱子。
    let visibleCount: Int
    /// 柱子落在哪几个槽位（从 0 数）。
    let startSlot: Int

    /// 取 `peaks` 的哪一段来画：末尾 `visibleCount` 个。
    func firstIndex(totalPeaks: Int) -> Int {
        max(0, totalPeaks - visibleCount)
    }
}

/// 把一条滚动波形算出来。宽度和采样数都是入参，方便单测。
func meetingLiveWaveLayout(
    peakCount: Int,
    canvasWidth: Double,
    barWidth: Double = MeetingAudio.barWidth,
    gap: Double = MeetingAudio.barGap
) -> MeetingLiveWaveLayout {
    let column = barWidth + gap
    let windowSlots = max(1, Int((Double(MeetingAudio.liveWindowMs) / Double(MeetingAudio.peakMs)).rounded()))
    let widthSlots = max(1, Int(floor(canvasWidth / column)))
    let slots = max(1, min(windowSlots, widthSlots))
    let visible = min(max(0, peakCount), slots)
    return MeetingLiveWaveLayout(slots: slots, visibleCount: visible, startSlot: slots - visible)
}

/// 回放那条波形的排布：**整段铺满宽度**。
///
/// 与录音页那条滚动窗口不同，这是有意的：它的作用是一眼看完整个录音，而不是盯着最近
/// 几秒。所以它按画布宽度分桶，每条柱子代表一段时间里的最大振幅。
struct MeetingPlaybackWaveLayout: Equatable {
    /// 画布上分几段。
    let columns: Int
    /// 每根柱子的宽度。采样远少于列数时槽位会被拉得很宽，所以有一个上限。
    let barWidth: Double
}

/// 把整段振幅按列数重新分桶，每桶取**最大值**。
///
/// 取最大值而不是平均：平均会把一段话中间那个最响的音节抹平，回放出来的波形看着比
/// 实际安静，而波形在这里唯一的作用就是让人认出「刚才那句在哪儿」。
func resamplePlaybackPeaks(_ peaks: [Double], columns: Int) -> [Double] {
    guard columns > 0, !peaks.isEmpty else { return [] }
    guard peaks.count > columns else { return peaks }
    let step = Double(peaks.count) / Double(columns)
    return (0..<columns).map { column in
        let start = Int(Double(column) * step)
        let end = min(peaks.count, max(start + 1, Int(Double(column + 1) * step)))
        return peaks[start..<end].max() ?? 0
    }
}

func meetingPlaybackWaveLayout(peakCount: Int, canvasWidth: Double) -> MeetingPlaybackWaveLayout {
    let column = MeetingAudio.barWidth + MeetingAudio.barGap
    let columns = max(1, Int(floor(canvasWidth / column)))
    // 采样比列数还少时槽位会被拉得很宽，超过这个值柱子就不再长胖——一排胖方块读不出
    // 「哪一段更响」。
    let slack = max(1, peakCount)
    let slot = min(column, canvasWidth / Double(slack))
    let barWidth = min(max(slot * 0.58, MeetingAudio.barWidth), 6)
    return MeetingPlaybackWaveLayout(columns: columns, barWidth: barWidth)
}

/// 收尾之前只知道收到了多少字节，按码率折算一个时长出来。
///
/// 只用在异常退出那条路上：正常收尾用的是一路记下来的真实时长。
enum MeetingDurationEstimate {
    static func fromBytes(_ bytes: Int) -> Int {
        let bytesPerSecond = Double(MeetingAudio.bitRate) / 8
        guard bytesPerSecond > 0, bytes > 0 else { return 0 }
        return Int((Double(bytes) / bytesPerSecond * 1000).rounded())
    }
}

/// 一次录音在本机留下的东西。
///
/// 音频是中间产物：服务端已有副本，不该占用户的 iCloud 备份，所以整个目录排除在备份
/// 之外。收尾成功后删，取消后也删；只有异常退出时才留着，下次启动靠它把这条收干净。
enum MeetingRecordingFiles {
    static func directory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("MeetingRecordings", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutable = directory
            try? mutable.setResourceValues(values)
        }
        return directory
    }

    static func audioURL(recordingId: String) throws -> URL {
        try directory().appendingPathComponent("\(sanitized(recordingId)).m4a")
    }

    static func pendingURL(recordingId: String) throws -> URL {
        try directory().appendingPathComponent("\(sanitized(recordingId)).pending.json")
    }

    /// 落盘的名字必须是单独一个路径段。recordingId 由服务端给，本来就可信，但拼路径
    /// 之前过一道手比事后解释便宜。
    private static func sanitized(_ value: String) -> String {
        String(value.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" })
    }
}

/// 还没收尾的那次录音。
///
/// 录音一开始就落盘，收尾成功就删。进程被杀、强退、更新重启之后，下次启动读到它，
/// 把已经录到的部分当成一次正常录音收干净——界面上不出现任何询问。
struct PendingMeetingRecording: Codable, Hashable {
    let meetingId: String
    let recordingId: String
    let title: String
    let startedAt: Date
    /// 已经传上去的分片数。异常退出后从这里接着传，不重传确认过的区间。
    var uploadedParts: Int

    init(meetingId: String, recordingId: String, title: String, startedAt: Date, uploadedParts: Int = 0) {
        self.meetingId = meetingId
        self.recordingId = recordingId
        self.title = title
        self.startedAt = startedAt
        self.uploadedParts = uploadedParts
    }
}

/// 本机那几份待收尾记录的读写。
enum PendingMeetingRecordingStore {
    static func save(_ pending: PendingMeetingRecording) {
        guard let url = try? MeetingRecordingFiles.pendingURL(recordingId: pending.recordingId) else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(pending) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func remove(recordingId: String) {
        guard let url = try? MeetingRecordingFiles.pendingURL(recordingId: recordingId) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    /// 还留着的待收尾记录，**且本机确实还有那次的音频**。
    ///
    /// 这个「确实还有音频」是跨端收尾归属的判据：只有本机还留着残片的那一端才有权
    /// 收尾它。没有音频的条目只能丢掉——本机已经帮不上忙了。
    static func loadAll() -> [PendingMeetingRecording] {
        guard let directory = try? MeetingRecordingFiles.directory(),
              let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else {
            return []
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var result: [PendingMeetingRecording] = []
        for name in names where name.hasSuffix(".pending.json") {
            let url = directory.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: url),
                  let pending = try? decoder.decode(PendingMeetingRecording.self, from: data) else {
                // 读不出来的记录没有用处，留着只会在每次启动时再失败一次。
                try? FileManager.default.removeItem(at: url)
                continue
            }
            guard let audio = try? MeetingRecordingFiles.audioURL(recordingId: pending.recordingId),
                  FileManager.default.fileExists(atPath: audio.path) else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            result.append(pending)
        }
        return result
    }
}
