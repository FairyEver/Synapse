import AVFoundation
import Foundation
import UIKit

/// 采集和送包之间那段 PCM。
///
/// 写入在 `AVAudioEngine` 的 tap 回调里，也就是音频线程上；取走在主线程的 200ms
/// 定时器里。进出都过锁，音频线程不碰 `AudioCapture` 的任何属性。
final class AsrPcmBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock()
        defer { lock.unlock() }
        data.append(chunk)
    }

    /// 取出恰好一包。采样不够时补静音，绝不返回半包 —— 送出去的音频时长因此严格
    /// 等于真实时间。多的留到下一包，不丢。
    func takeChunk(_ byteCount: Int) -> Data {
        lock.lock()
        defer { lock.unlock() }
        let available = min(data.count, byteCount)
        var chunk = Data()
        chunk.reserveCapacity(byteCount)
        chunk.append(data.prefix(available))
        data.removeFirst(available)
        if chunk.count < byteCount {
            chunk.append(Data(repeating: 0, count: byteCount - chunk.count))
        }
        return chunk
    }

    /// 停止录音后把尾巴取空，最后一帧才不会被丢掉。
    func drain(_ byteCount: Int) -> [Data] {
        var chunks: [Data] = []
        while pending > 0 { chunks.append(takeChunk(byteCount)) }
        return chunks
    }

    var pending: Int {
        lock.lock()
        defer { lock.unlock() }
        return data.count
    }
}

/// 麦克风采集：把设备原生的采样格式转成腾讯云要的 16000Hz / 16bit / 单声道 PCM。
///
/// 重采样用 `AVAudioConverter`，不手写循环。设备原生是 44.1k / 48k 的浮点，插值重
/// 采样要跨批保留相位才不会有咔哒声，而这一步就在首字延迟的关键路径上。
final class AudioCapture {
    /// 引擎要的格式：16k / 16bit / 单声道。`AVAudioFormat` 的 Int16 是本机序，
    /// iOS 上就是引擎认的小端。
    static let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16_000,
        channels: 1,
        interleaved: true
    )!

    enum Failure: Error {
        /// 拿不到输入格式 —— 模拟器这类没有输入设备的场合。
        case unavailable
    }

    /// tap 往里写，送包循环按 200ms 取。
    let pcm = AsrPcmBuffer()

    /// 来电、切后台把采集打断了。不处理的话 tap 不再回调，送包循环会一直补静音：
    /// 引擎那边看起来一切正常，用户这边一个字都不会有。
    var onInterrupted: (@MainActor () -> Void)?

    private let engine = AVAudioEngine()
    private var tapInstalled = false
    private var observers: [NSObjectProtocol] = []

    /// 麦克风权限现在给着没有。读，不问。
    ///
    /// 给「进来时把上次选的语音态摆好」用：那个动作发生在用户**还没打算说话**的
    /// 时候，弹系统授权框是答非所问 —— 问的那一次留给切换键（§3.8）。
    static var isPermissionGranted: Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    /// 问一次麦克风权限。
    ///
    /// iOS 17 起麦克风权限归 `AVAudioApplication` 管，`AVAudioSession` 上那个已经
    /// 废弃；本 target 的部署版本是 18.0，所以只走新 API，不留兼容分支。
    static func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start() throws {
        do {
            try startSession()
            try startEngine()
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        if engine.isRunning { engine.stop() }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        try? AVAudioSession.sharedInstance()
            .setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Engine

    private func startSession() throws {
        // 只录不放。类别是 `.record` 而不是 `.playAndRecord`：这条链路上没有任何
        // 要播放的东西，多开的那个方向只会去改别的 app 的音频路由。
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
    }

    private func startEngine() throws {
        let input = engine.inputNode
        // 会话没激活时采样率是 0，拿它建 converter 会崩。
        let inputFormat = input.inputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0,
              let converter = AVAudioConverter(from: inputFormat, to: Self.targetFormat) else {
            throw Failure.unavailable
        }

        let target = Self.targetFormat
        let sink = pcm
        // 1024 帧在 48k 下约 21ms。重采样在回调里做，批次越小首字延迟越低。
        input.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { buffer, _ in
            AudioCapture.convert(buffer, using: converter, to: target, into: sink)
        }
        tapInstalled = true

        engine.prepare()
        try engine.start()
        observeInterruptions()
    }

    /// 转换一批采样。
    ///
    /// 回调在音频线程上，所以这里只碰传进来的东西，不碰 `self`。
    private static func convert(
        _ input: AVAudioPCMBuffer,
        using converter: AVAudioConverter,
        to format: AVAudioFormat,
        into sink: AsrPcmBuffer
    ) {
        let ratio = format.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount((Double(input.frameLength) * ratio).rounded(.up)) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }

        var handed = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, supply in
            // 一批输入只喂一次；之后的 `.noDataNow` 让转换器把内部缓冲的采样接着吐
            // 出来，重采样器跨批保持相位就是靠这个。
            if handed {
                supply.pointee = .noDataNow
                return nil
            }
            handed = true
            supply.pointee = .haveData
            return input
        }

        guard status != .error,
              output.frameLength > 0,
              let samples = output.int16ChannelData?[0] else { return }
        sink.append(Data(bytes: samples, count: Int(output.frameLength) * MemoryLayout<Int16>.size))
    }

    private func observeInterruptions() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw),
                  type == .began else { return }
            MainActor.assumeIsolated { self?.onInterrupted?() }
        })
        // 没有后台音频权限，切后台时系统会把会话摘走。这不会走中断通知，得自己看。
        observers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.onInterrupted?() }
        })
    }
}
