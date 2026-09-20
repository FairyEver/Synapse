// 这个工程默认每个类型都归主 actor 管，而 AVFoundation 那套类型没有并发标注。
// `@preconcurrency` 让「在主 actor 上用它」这件事不需要额外解释。
@preconcurrency import AVFoundation
import Foundation

/// 采集这一头：麦克风 → 本机一份 m4a，顺手把振幅和新增的字节交给调用方。
///
/// **写出来的是分片 m4a（fMP4），不是普通 m4a。** 这一条是整条链路的地基，不是实现细节：
///
/// m4a 的索引（`moov`）是尾部结构，普通写法要等收尾那一刻才补进去。进程在录音中途没了
/// （被系统回收、被强杀、崩溃），文件就永远没有索引，谁也读不出来。实测撞过一次：一条
/// 12 秒的录音，本机文件只剩 `ftyp` 加一大段零占位，恢复路径把这份字节原样传上去，服务
/// 端只能判「音频文件不完整」，用户的整段录音丢掉——而设计文档 6.4 恰恰把这份本机文件
/// 当作「异常退出之后唯一的依据」，这个前提在普通 m4a 上根本不成立。
///
/// `AVAssetWriter` 配上 `movieFragmentInterval` 之后，录音期间磁盘上一直是「开头的初始化
/// 段 + 每 2 秒一个 `moof` 分片」。进程被杀，丢的只是最后那一个没写完的分片，前面全部完
/// 整（实测截断到 60% 的文件仍能解出完整的那部分时长）。收尾时 `finishWriting` 会把它重
/// 排成普通的 `ftyp + mdat + moov`，那是正常结束，无所谓——重排只改第 1 片和最后一片，
/// 中间的分片字节原样不动，所以上传器收尾要重传的还是两片，与录音长度无关。
///
/// 电平不再取录音器自己的 metering，而是从采集到的采样算 RMS：换算走的是
/// `MeetingAudio.amplitude(fromRMS:)`，**和异常退出之后从文件重算波形是同一条**，两条路
/// 的刻度因此必然一致（这正是那两处注释反复强调的事）。
///
/// 中断处理与字节上报的口径都照旧：被抢走就暂停、抢回来接着录同一条；新增字节按读取位置
/// 增量交给调用方，边录边传还是同一份字节。
@MainActor
final class MeetingRecorder {
    enum Failure: Error {
        /// 文件建不出来。这一条会直接挡住录音，因为本机那份音频是异常退出之后唯一的
        /// 依据（见设计文档 6.4）。
        case cannotOpenFile
        case cannotStart
    }

    /// 每 28 毫秒一次，交上来的是 0–1 的线性振幅。
    var onLevel: ((Double) -> Void)?
    /// 本机文件又长出来的那些字节。
    var onAudioBytes: ((Data) -> Void)?
    /// 被别的 App 抢走了麦克风。
    var onInterrupted: (() -> Void)?
    /// 抢回来了，已经在录同一条。
    var onResumed: (() -> Void)?

    private(set) var isRecording = false
    private(set) var isPaused = false
    private(set) var fileURL: URL?

    private var engine: AVAudioEngine?
    /// 收尾动作。`finishWriting` 是异步的，尾片必须等它落地之后才读得到。
    private var finalizing: Task<Void, Never>?
    private var sink: Sink?
    private var ticker: Task<Void, Never>?
    private var handle: FileHandle?
    private var readOffset: UInt64 = 0
    private var lastFileRead = Date.distantPast
    private var observers: [NSObjectProtocol] = []

    /// 录了多久。取**已经写进文件的采样数**——暂停的那几分钟不计入，这一点与原先一致，
    /// 异常退出之后按字节估出来的时长才对得上。
    var durationMs: Int {
        guard let sink else { return 0 }
        let frames = sink.writtenFrames
        return Int((Double(frames) / MeetingAudio.sampleRate * 1000).rounded())
    }

    // MARK: - 开始与结束

    func start(recordingId: String) throws {
        try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try AVAudioSession.sharedInstance().setActive(true)

        let url = try MeetingRecordingFiles.audioURL(recordingId: recordingId)
        // 同一个 id 不该再录第二次；有残留就先清掉，免得新录音接在旧字节后面。
        try? FileManager.default.removeItem(at: url)

        let engine = AVAudioEngine()
        // **不把麦克风接到扬声器。** `AVAudioEngine` 默认把输入接进主混音器，而会话是
        // `playAndRecord`，不掐掉这一路就会自己听自己。
        engine.mainMixerNode.outputVolume = 0
        let source = engine.inputNode
        let sourceFormat = source.outputFormat(forBus: 0)
        guard sourceFormat.sampleRate > 0 else { throw Failure.cannotStart }

        let sink: Sink
        do {
            sink = try Sink(url: url, sourceFormat: sourceFormat)
        } catch {
            throw Failure.cannotOpenFile
        }

        source.installTap(onBus: 0, bufferSize: AVAudioFrameCount(MeetingAudio.tapFrames), format: sourceFormat) { buffer, _ in
            // 实时音频线程：只碰 `sink`，不碰主 actor 上的任何东西。
            sink.accept(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            source.removeTap(onBus: 0)
            throw Failure.cannotStart
        }

        self.engine = engine
        self.sink = sink
        self.fileURL = url
        self.handle = try? FileHandle(forReadingFrom: url)
        self.readOffset = 0
        self.lastFileRead = .distantPast
        self.isRecording = true
        self.isPaused = false

        observeInterruptions()
        startTicker()
    }

    /// 停。文件留着，收尾成功之后由调用方删。
    ///
    /// `finishWriting` 是异步的，这里不等——等它落地的责任交给 `remainingBytesAfterStop`，
    /// 那边本来就要读文件。主 actor 不该为了一个磁盘动作停住。
    func stop() {
        ticker?.cancel()
        ticker = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        if let sink {
            finalizing = sink.finish()
        }
        sink = nil
        try? handle?.close()
        handle = nil
        isRecording = false
        isPaused = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 等编码器收工。
    ///
    /// 取消那条路要在删本机文件之前等它——它可能还在往同一个路径上写最后几个分片，删早了
    /// 会留下一个写到一半的文件没人收。
    func awaitFinalize() async {
        await finalizing?.value
    }

    /// 停录之后剩下的那些字节。
    ///
    /// 两件事在这里合流：编码器是收尾之后才把最后那几个分片和索引写出来的，所以要等
    /// `finishWriting` 落地；读完还得另开一个句柄——`stop()` 已经把原来那个关掉了。
    func remainingBytesAfterStop() async -> Data? {
        await finalizing?.value
        guard let fileURL, let handle = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: readOffset)) != nil else { return nil }
        guard let data = try? handle.readToEnd(), !data.isEmpty else { return nil }
        readOffset += UInt64(data.count)
        return data
    }

    // MARK: - 中断

    /// 被抢走就暂停、抢回来就接着录**同一条**，界面上不出现任何询问。
    ///
    /// 不做成「直接结束这条」：一场四十分钟的会，一个电话就断了而且不能续。也不静默
    /// 录进一段空白：转写结果里会多出一段不存在的静音，费用照算。
    private func observeInterruptions() {
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            MainActor.assumeIsolated { self?.handleInterruption(note) }
        })
    }

    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            guard isRecording, !isPaused else { return }
            engine?.pause()
            isPaused = true
            onInterrupted?()
        case .ended:
            guard isRecording, isPaused else { return }
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            guard options.contains(.shouldResume) else { return }
            // 会话被系统摘走过，接着录之前要重新激活。
            try? AVAudioSession.sharedInstance().setActive(true)
            guard let engine, (try? engine.start()) != nil else { return }
            isPaused = false
            onResumed?()
        @unknown default:
            return
        }
    }

    // MARK: - 采样

    private func startTicker() {
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.tick()
                // 28 毫秒是波形采样口径，与电脑端同一个数。
                try? await Task.sleep(for: .milliseconds(MeetingAudio.peakMs))
            }
        }
    }

    private func tick() {
        guard isRecording, !isPaused, let sink else { return }
        // 这一拍里采集到的采样算一个 RMS。换算与「异常退出之后从文件重算波形」共用
        // `amplitude(fromRMS:)`，两条路的刻度因此一致。
        onLevel?(MeetingAudio.amplitude(fromRMS: sink.drainRMS()))

        // 文件不必每 28 毫秒看一次：分片 2 秒才落一批，1 秒看一次足够，省下的是每秒
        // 三十几次 stat。
        let now = Date()
        if now.timeIntervalSince(lastFileRead) >= 1 {
            lastFileRead = now
            readNewBytes()
        }
    }

    /// 把本机文件自上次以来新长出来的那段读出来。
    ///
    /// 边录边传就是从这儿来的：传上去的字节和本地文件是同一份，收尾时只需补齐尾片。
    private func readNewBytes() {
        guard let handle else { return }
        guard let size = try? handle.seekToEnd() , size > readOffset else {
            // 文件没有新的内容。回到原来的位置，免得下一次从错的地方读。
            try? handle.seek(toOffset: readOffset)
            return
        }
        do {
            try handle.seek(toOffset: readOffset)
            if let data = try? handle.readToEnd(), !data.isEmpty {
                readOffset += UInt64(data.count)
                onAudioBytes?(data)
            }
            try handle.seek(toOffset: readOffset)
        } catch {
            // 读不到就下一轮再试。这不是错误：文件正被录音器持有，偶发的读失败不代表
            // 录音出了问题。
            try? handle.seek(toOffset: readOffset)
        }
    }
}

/// 音频线程那一侧的全部状态。
///
/// 采集回调跑在实时音频线程上，碰不得主 actor 的东西，所以编码器、转换器和电平累加器都
/// 收在这个盒子里，用一把锁护住。临界区里只有几个加法和一次 append，不会把实时线程卡住。
/// 标 `@unchecked Sendable` 是因为「谁在什么线程碰它」由这里自己用锁讲清楚，编译器看不
/// 出来。
private final class Sink: @unchecked Sendable {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    /// 麦克风格式与目标格式不一致时才需要；一致时为 nil，少一次转换。
    private let converter: AVAudioConverter?
    private let targetFormat: AVAudioFormat
    private let lock = NSLock()

    private var energy = 0.0
    private var levelFrames = 0
    private var failed = false

    /// 已经写进编码器的采样数。时长由它算，暂停期间不增加。
    private var framesWritten: AVAudioFramePosition = 0

    init(url: URL, sourceFormat: AVAudioFormat) throws {
        // 目标格式就是引擎要的那一档：单声道、48 kHz。与 `MeetingAudio` 里的口径一致。
        guard let target = AVAudioFormat(
            standardFormatWithSampleRate: MeetingAudio.sampleRate,
            channels: AVAudioChannelCount(MeetingAudio.channels)
        ) else { throw MeetingRecorder.Failure.cannotOpenFile }
        targetFormat = target

        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        // **这一行就是「进程被杀只丢两秒」的全部来源。** 不设它，索引就留到收尾才写。
        writer.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: MeetingAudio.sampleRate,
            AVNumberOfChannelsKey: MeetingAudio.channels,
            AVEncoderBitRateKey: MeetingAudio.bitRate,
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw MeetingRecorder.Failure.cannotOpenFile }
        writer.add(input)
        guard writer.startWriting() else { throw MeetingRecorder.Failure.cannotOpenFile }
        writer.startSession(atSourceTime: .zero)

        let needsConversion = sourceFormat.sampleRate != MeetingAudio.sampleRate
            || sourceFormat.channelCount != AVAudioChannelCount(MeetingAudio.channels)
        converter = needsConversion ? AVAudioConverter(from: sourceFormat, to: target) : nil
        if needsConversion, converter == nil { throw MeetingRecorder.Failure.cannotOpenFile }
    }

    var writtenFrames: AVAudioFramePosition {
        lock.lock(); defer { lock.unlock() }
        return framesWritten
    }

    /// 收一块采样：进编码器，同时把电平累加起来。
    func accept(_ buffer: AVAudioPCMBuffer) {
        accumulateLevel(buffer)
        guard !failed, let converted = convert(buffer) else { return }
        guard input.isReadyForMoreMediaData else { return }
        guard let sample = Self.sampleBuffer(converted, at: framesWritten) else { return }
        if input.append(sample) {
            lock.lock(); framesWritten += AVAudioFramePosition(converted.frameLength); lock.unlock()
        } else {
            lock.lock(); failed = true; lock.unlock()
        }
    }

    /// 取走这一拍累积的电平，换算成 RMS，并清空累加器。
    func drainRMS() -> Double {
        lock.lock(); defer { lock.unlock() }
        let frames = levelFrames
        let total = energy
        energy = 0
        levelFrames = 0
        guard frames > 0 else { return 0 }
        return (total / Double(frames)).squareRoot()
    }

    /// 收尾：写完最后几个分片和索引。异步，等它落地才能读尾片。
    func finish() -> Task<Void, Never> {
        let writer = self.writer
        let input = self.input
        return Task {
            input.markAsFinished()
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                writer.finishWriting { continuation.resume() }
            }
        }
    }

    // MARK: - 内部

    private func accumulateLevel(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return }
        let frames = Int(buffer.frameLength)
        let samples = channels[0]
        var sum = 0.0
        for index in 0..<frames {
            let value = Double(samples[index])
            sum += value * value
        }
        lock.lock()
        energy += sum
        levelFrames += frames
        lock.unlock()
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter else { return buffer }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return nil }
        var consumed = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, output.frameLength > 0 else { return nil }
        return output
    }

    /// 把一块 PCM 包成编码器要的 `CMSampleBuffer`。时间戳必须给真值——`presentationTimeStamp`
    /// 留成 `.invalid` 的话写出来的时间轴是空的，时长和时间戳都会对不上。
    private static func sampleBuffer(_ pcm: AVAudioPCMBuffer, at framePosition: AVAudioFramePosition) -> CMSampleBuffer? {
        var asbd = pcm.format.streamDescription.pointee
        var description: CMFormatDescription?
        guard CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: &asbd,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &description
        ) == noErr, let description else { return nil }

        let timescale = CMTimeScale(pcm.format.sampleRate)
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: timescale),
            presentationTimeStamp: CMTime(value: framePosition, timescale: timescale),
            decodeTimeStamp: .invalid
        )
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: description,
            sampleCount: CMItemCount(pcm.frameLength),
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 0,
            sampleSizeArray: nil,
            sampleBufferOut: &sample
        ) == noErr, let sample else { return nil }

        guard CMSampleBufferSetDataBufferFromAudioBufferList(
            sample,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: pcm.audioBufferList
        ) == noErr else { return nil }
        return sample
    }
}
