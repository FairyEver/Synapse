// 这个工程默认每个类型都归主 actor 管，而 AVFoundation 那套类型没有并发标注。
// `@preconcurrency` 让「在主 actor 上用它」这件事不需要额外解释。
@preconcurrency import AVFoundation
import Foundation

/// 采集这一头：麦克风 → 本机一份 m4a，顺手把振幅和新增的字节交给调用方。
///
/// 同一个 `AVAudioRecorder` 干三件事：落文件、每 28 毫秒报一次电平、让调用方把新增的
/// 字节送去上传。没有第二条采集链路要维护，也就没有第二处中断处理。
///
/// 电平用录音器自己的 metering，不另起一个 `AVAudioEngine` 的分析节点：它读的是同一
/// 条流里的真数据，而多一路采集就多一处要和录音抢 `AVAudioSession` 的地方。
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

    private var recorder: AVAudioRecorder?
    private var ticker: Task<Void, Never>?
    private var handle: FileHandle?
    private var readOffset: UInt64 = 0
    private var lastFileRead = Date.distantPast
    private var observers: [NSObjectProtocol] = []

    /// 录了多久。取录音器自己的钟——**暂停的那几分钟不计入**，这样异常退出之后按字节
    /// 估出来的时长和它才对得上。
    var durationMs: Int {
        guard let recorder else { return 0 }
        return Int((recorder.currentTime * 1000).rounded())
    }

    // MARK: - 开始与结束

    func start(recordingId: String) throws {
        try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try AVAudioSession.sharedInstance().setActive(true)

        let url = try MeetingRecordingFiles.audioURL(recordingId: recordingId)
        // 同一个 id 不该再录第二次；有残留就先清掉，免得新录音接在旧字节后面。
        try? FileManager.default.removeItem(at: url)

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: MeetingAudio.sampleRate,
            AVNumberOfChannelsKey: MeetingAudio.channels,
            AVEncoderBitRateKey: MeetingAudio.bitRate,
        ]
        guard let recorder = try? AVAudioRecorder(url: url, settings: settings) else {
            throw Failure.cannotOpenFile
        }
        recorder.isMeteringEnabled = true
        guard recorder.record() else { throw Failure.cannotStart }

        self.recorder = recorder
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
    func stop() {
        ticker?.cancel()
        ticker = nil
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        recorder?.stop()
        recorder = nil
        try? handle?.close()
        handle = nil
        isRecording = false
        isPaused = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// 停录之后剩下的那些字节。
    ///
    /// 编码器直到 `stop()` 才把最后的头部和尾帧写完，所以这一段只有在停下来之后才
    /// 读得到，而要读它就得另开一个句柄——`stop()` 已经把原来那个关掉了。
    func remainingBytesAfterStop() -> Data? {
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
            recorder?.pause()
            isPaused = true
            onInterrupted?()
        case .ended:
            guard isRecording, isPaused else { return }
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            guard options.contains(.shouldResume) else { return }
            // 会话被系统摘走过，接着录之前要重新激活。
            try? AVAudioSession.sharedInstance().setActive(true)
            guard recorder?.record() == true else { return }
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
        guard let recorder, isRecording, !isPaused else { return }
        recorder.updateMeters()
        // `averagePower` 是 dBFS 的平均功率（也就是 RMS）。换算回线性振幅之后，乘的
        // 那个增益和电脑端是同一个数，两端画出来的波形高度才一致。
        let db = Double(recorder.averagePower(forChannel: 0))
        onLevel?(db.isFinite ? pow(10, db / 20) : 0)

        // 文件不必每 28 毫秒看一次：编码器 2 秒才吐一批，1 秒看一次足够，省下的是每秒
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
            if let data = try handle.readToEnd(), !data.isEmpty {
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
