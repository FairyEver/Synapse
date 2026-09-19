// 这个工程默认每个类型都归主 actor 管，而 AVFoundation 那套类型没有并发标注。
@preconcurrency import AVFoundation
import Foundation
import Observation
import os

/// 一次录音从头到尾的那条线：开一条录像、边录边传、收尾或取消、以及异常退出之后的
/// 收尾。
///
/// 它不归录音页所有。**录音中允许离开录音页**（决策四）：录音页收起了录音还在继续，
/// App 内顶部那枚胶囊、锁屏上的实时活动、控制中心的「完成」都要能摸到同一个对象，
/// 所以它挂在 App 模型上。
@MainActor
@Observable
final class MeetingRecordingSession {
    /// 录音页此刻是什么状态。
    enum Phase: Equatable {
        case idle
        case recording
        /// 麦克风被别的 App 抢走了，自动暂停中。**没有手动暂停**。
        case paused
        /// 已经在收尾，界面通常已经回列表了。
        case saving
    }

    /// 提示行。高度固定，内容只在这些之间换；文案在视图里。
    enum Hint: Equatable {
        case none
        /// 开头一直没听到声音。听到过一次就永不再出现。
        case silent
        /// 没拿到麦克风权限。**不阻断录音**，只是波形不作数。
        case microphoneDenied
        /// 麦克风被其他应用占用。
        case interrupted
        /// 分片发不出去，带上下文原因。
        case uploadFailed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var hint: Hint = .none
    private(set) var elapsedMs = 0
    /// 最近的振幅，最新的在最后。给录音页那条滚动波形用。
    private(set) var levels: [Double] = []
    private(set) var title = ""
    /// 这一条录音在服务端的编号。收尾用它。
    private(set) var meetingId: String?

    private var recorder: MeetingRecorder?
    private var uploader: MeetingUploader?
    private var peakStore = MeetingPeakStore()
    private var pending: PendingMeetingRecording?
    private var client: APIClient?
    private var ticker: Task<Void, Never>?
    private var persistedParts = 0
    /// 正在起一条新的。
    ///
    /// `phase` 要等服务端回来才变成 `.recording`，而进录音页的入口不止一个（列表的加号
    /// 和意图那两条路径会在同一瞬间各叫一次）。只看 `phase` 的话，两边都会在 await 窗口
    /// 里看到「没在录」，于是各发一次 `POST /meetings/recordings`——服务端多一条孤儿记录，
    /// 本机多一个采集器。
    private var isStarting = false

    var isRecording: Bool { phase == .recording || phase == .paused }

    /// 到了 5 小时上限被自动收尾了。列表据此说一声——那条录音会照常产生转写费用，用户
    /// 该知道它为什么自己停了。
    private(set) var didHitDurationLimit = false

    /// 同时最多回看的振幅个数。5 秒 ÷ 28 毫秒，和电脑端同一个窗口。
    private var windowSlots: Int {
        max(1, Int((Double(MeetingAudio.liveWindowMs) / Double(MeetingAudio.peakMs)).rounded()))
    }

    // MARK: - 开始

    /// 点加号就直接进这一条：**不先起名字**，名字事后在详情页改。
    func start(using client: APIClient) async {
        // 收尾（`.saving`）期间也允许开新的一条：两条各自抓着自己那套采集器和上传器，
        // 互不干扰。拦住的话，用户点完「完成」马上再点加号会什么也没发生。
        guard !isRecording, !isStarting else { return }
        isStarting = true
        didHitDurationLimit = false
        defer { isStarting = false }
        self.client = client
        levels = []
        elapsedMs = 0
        peakStore = MeetingPeakStore()
        hint = .none

        // **先问权限，再建录音。** 反过来做的话，没有权限时会先在服务端建出一条永远不
        // 会有音频的记录，而用户这边连个解释都看不到。
        if MeetingPermission.microphone != .granted {
            let granted = await MeetingPermission.requestMicrophone()
            guard granted else {
                // **不阻断**：录音页照常留着，只是明说这一条波形不作数。iOS 在没有权限
                // 时一点音频都不给，画一条平线并把原因写出来，比拿假波形冒充真的诚实。
                hint = .microphoneDenied
                return
            }
        }

        do {
            let started = try await client.startMeetingRecording(title: nil, startedAt: Date())
            title = started.title
            meetingId = started.meetingId
            let record = PendingMeetingRecording(
                meetingId: started.meetingId,
                recordingId: started.recordingId,
                title: started.title,
                startedAt: Date()
            )
            pending = record
            persistedParts = 0
            PendingMeetingRecordingStore.save(record)

            let recorder = try makeRecorder(recordingId: started.recordingId)
            let uploader = MeetingUploader(
                send: { [weak client] partNumber, bytes in
                    guard let client else { return }
                    try await client.uploadMeetingPart(
                        recordingId: started.recordingId,
                        partNumber: partNumber,
                        bytes: bytes
                    )
                },
                abort: {
                    // 取消走的是中止：未完成的分块上传留在桶里的碎片，删对象删不掉。
                    try? await client.cancelMeetingRecording(recordingId: started.recordingId)
                }
            )
            recorder.onAudioBytes = { [weak uploader] bytes in uploader?.enqueue(bytes) }
            self.recorder = recorder
            self.uploader = uploader

            phase = .recording
            startTicker()
        } catch let error as APIError {
            hint = .uploadFailed(error.message)
            abandonFailedStart()
        } catch {
            hint = .uploadFailed("录音没能开始，请稍后再试。")
            abandonFailedStart()
        }
    }

    /// 起不来的那一次留下的痕迹收拾干净。
    ///
    /// 重点是本机那条待收尾记录：它建在 `makeRecorder` 之前，而采集器起不来时本机连音
    /// 频都没有——留着它，下次启动会去收一条没有音频的录音。
    private func abandonFailedStart() {
        if let record = pending {
            PendingMeetingRecordingStore.remove(recordingId: record.recordingId)
        }
        pending = nil
        recorder = nil
        uploader = nil
        ticker?.cancel()
        ticker = nil
        phase = .idle
    }

    /// 造采集器并起录。走到这里的时候权限已经拿到手了（见 `start`）。
    private func makeRecorder(recordingId: String) throws -> MeetingRecorder {
        let recorder = MeetingRecorder()
        recorder.onLevel = { [weak self] amplitude in self?.handleLevel(amplitude) }
        recorder.onInterrupted = { [weak self] in
            guard let self else { return }
            self.phase = .paused
            self.hint = .interrupted
        }
        recorder.onResumed = { [weak self] in
            guard let self else { return }
            self.phase = .recording
            self.hint = .none
        }
        try recorder.start(recordingId: recordingId)
        return recorder
    }

    // MARK: - 收尾

    /// 完成。
    ///
    /// **界面不等它**：录音页在按下的那一刻就回列表了，剩下的（补尾片、提交、清理本机
    /// 文件）在后台跑。录制长于 5 秒之后，这一步的耗时与录音长度无关——字节早就在路
    /// 上了，这里只补最后那一片。
    func finish() {
        guard phase == .recording || phase == .paused else { return }
        // **把这一条的东西就地抓下来**，不是收尾时再去读实例属性：收尾要跑一会儿，而
        // 用户完全可以在这段时间里再点一次加号。再读 self 的话，收的是新那条的尾、走
        // 的却是旧那条的单。
        let recorder = self.recorder
        let uploader = self.uploader
        let record = pending
        let durationMs = recorder?.durationMs ?? 0
        let peaks = peakStore.encode()
        stopCapture()
        phase = .saving
        self.recorder = nil
        self.uploader = nil

        Task { [weak self] in
            await self?.complete(
                record: record,
                recorder: recorder,
                uploader: uploader,
                durationMs: durationMs,
                peaks: peaks
            )
        }
    }

    private func complete(
        record: PendingMeetingRecording?,
        recorder: MeetingRecorder?,
        uploader: MeetingUploader?,
        durationMs: Int,
        peaks: String
    ) async {
        guard let record, let client else {
            finishSaving(recordingId: record?.recordingId)
            return
        }
        // 编码器是停下来之后才写最后那几个字节的，这一批就是「结束只补尾片」里的
        // 那片尾巴。补上它，服务端拼出来的才是一条完整的音频。
        if let tail = recorder?.remainingBytesAfterStop() {
            uploader?.enqueue(tail)
        }
        let fileURL = try? MeetingRecordingFiles.audioURL(recordingId: record.recordingId)
        // 尾片没送出去就**不要提交**。m4a 的 `moov` 就在那一片里，服务端拼出来的会是一段
        // 谁也打不开的音频，而它照样会计费转写；更糟的是接着那句 `keepRecordedAudio` 会把
        // 本机这份**完好的**文件归入缓存，`MeetingAudioCache` 再按大小对不上把它删掉——
        // 唯一一份好副本就这么没了。
        //
        // 留着本机文件和待收尾记录，下次启动 `resolvePendingRecordings` 会把尾片补齐再提交。
        // 界面上不出现询问，和下面那条 `catch` 同一个口径。断点续录那条路（`finalize`）一直
        // 是这么做的，实时这条漏了。
        guard await uploader?.finish(audioFile: fileURL) != false else {
            AppLog.recording.warning(
                "the recording's tail did not upload, leaving it for the next launch."
            )
            finishSaving(recordingId: record.recordingId)
            return
        }

        do {
            try await client.completeMeetingRecording(
                recordingId: record.recordingId,
                durationMs: durationMs,
                peaks: peaks
            )
            // 收尾成功才动本机那份：在那之前，它是异常退出之后唯一的依据。这时候它不是被
            // 删掉，是归入缓存——刚录完的这条回听要秒开。
            keepRecordedAudio(record, peaks: peaks)
        } catch {
            // 音频已经在服务端了，这一步失败只是晚一点开始。留好本机文件，下次启动
            // 自动收尾，界面上不出现任何询问。
            AppLog.recording.warning(
                "recording complete failed, leaving it for the next launch: \(error.localizedDescription, privacy: .public)"
            )
        }
        finishSaving(recordingId: record.recordingId)
    }

    /// 取消：服务端中止分块上传并丢弃已传分片，本机这一份也删掉。
    func cancel() {
        guard phase == .recording || phase == .paused else { return }
        let record = pending
        let uploader = self.uploader
        stopCapture()
        phase = .saving
        self.recorder = nil
        self.uploader = nil

        Task { [weak self] in
            guard let self else { return }
            await uploader?.cancel()
            if let record {
                self.discardLocalFiles(record.recordingId)
            }
            self.finishSaving(recordingId: record?.recordingId)
        }
    }

    /// 收尾跑完了，把这一条留下来的状态清掉。
    ///
    /// **只在还是这一条的时候清**：收尾期间用户可能已经开了新的录音，那时候 `pending`
    /// 指向的是新那条，把界面状态清掉等于把刚开始的录音抹了。
    private func finishSaving(recordingId: String?) {
        guard pending?.recordingId == recordingId else { return }
        pending = nil
        phase = .idle
        hint = .none
        levels = []
        elapsedMs = 0
        title = ""
        meetingId = nil
    }

    private func stopCapture() {
        ticker?.cancel()
        ticker = nil
        recorder?.stop()
    }

    /// 收尾成功：音频**留下**并归入本机缓存，只删掉待收尾记录。
    ///
    /// 录音期间音频本来就落在本机（决策三），收尾后删掉再从云端下回来纯属浪费——用户想马上
    /// 回听刚录的那条，正是要秒开的那一下。归入缓存就是同一个目录里改个名（`moveItem`），
    /// 零成本。
    ///
    /// `pending.json` 要照常删掉：`PendingMeetingRecordingStore.loadAll` 认的是「本机还有没有
    /// 音频」，而这一份已经改名归入缓存了——记录留着只会让下次启动去收一条已经收完的录音。
    private func keepRecordedAudio(_ record: PendingMeetingRecording, peaks: String) {
        PendingMeetingRecordingStore.remove(recordingId: record.recordingId)
        guard let source = try? MeetingRecordingFiles.audioURL(recordingId: record.recordingId) else { return }
        MeetingAudioCache.shared.adopt(source, meetingId: record.meetingId, peaks: peaks)
    }

    /// 取消：本机这一份全部删掉，**不留缓存条目**。
    ///
    /// 与收尾成功那条路的区别是有意的：用户按的是取消，这条录音就不该在本机留下任何东西。
    private func discardLocalFiles(_ recordingId: String) {
        PendingMeetingRecordingStore.remove(recordingId: recordingId)
        if let url = try? MeetingRecordingFiles.audioURL(recordingId: recordingId) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - 采样

    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.refresh()
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
    }

    private func refresh() {
        guard let recorder, isRecording else { return }
        elapsedMs = recorder.durationMs

        // 分片上到哪儿了，落一次盘。异常退出之后从这里接着传，不重传确认过的区间。
        if let uploader, let record = pending, uploader.uploadedParts != persistedParts {
            persistedParts = uploader.uploadedParts
            var updated = record
            updated.uploadedParts = persistedParts
            pending = updated
            PendingMeetingRecordingStore.save(updated)
        }

        updateHint()

        // 到上限自动收尾，不无限录下去。这是一次用户没按的结束，列表要替它说一声。
        if elapsedMs >= MeetingAudio.maxDurationMs, isRecording {
            didHitDurationLimit = true
            finish()
        }
    }

    /// 提示行只有一个位置，四件事按重要性排一个先后。
    ///
    /// 高度固定，内容在这些之间换，所以这里不做「追加」，每次算出唯一的那一条。
    private func updateHint() {
        // 发不出去是唯一需要用户看见并且可能有动作的一条，排在前面。
        if let message = uploader?.lastError {
            hint = .uploadFailed(message)
            return
        }
        if phase == .paused {
            hint = .interrupted
            return
        }
        // 听到过一次就永不再提：开会中途不打扰。
        if !peakStore.sawSound, elapsedMs >= MeetingAudio.silenceHintMs {
            hint = .silent
            return
        }
        hint = .none
    }

    private func handleLevel(_ amplitude: Double) {
        guard isRecording else { return }
        let smoothed = peakStore.push(amplitude)
        levels.append(smoothed)
        if levels.count > windowSlots {
            levels.removeFirst(levels.count - windowSlots)
        }
    }

    // MARK: - 异常退出后的收尾

    /// 上次没收完的那些，现在收干净。
    ///
    /// **只收本机还留着音频的那条**（决策七）：残片只在本机，所以只有本机续得上。别的
    /// 设备录的那条，本机既没有字节也没有波形，抢过来收尾只会用一个估算的时长和一条
    /// 平线把人家正在录的东西毁掉。
    ///
    /// 界面上不出现任何询问：用户不需要知道发生过异常退出。
    func resolvePendingRecordings(using client: APIClient) async {
        guard phase == .idle else { return }
        for record in PendingMeetingRecordingStore.loadAll() {
            await finalize(record, using: client)
        }
    }

    private func finalize(_ record: PendingMeetingRecording, using client: APIClient) async {
        guard let fileURL = try? MeetingRecordingFiles.audioURL(recordingId: record.recordingId) else {
            PendingMeetingRecordingStore.remove(recordingId: record.recordingId)
            return
        }
        // 本机那份音频是完整的，波形可以从它重算——这正是手机端比电脑端强的地方
        // （设计文档 6.4）。
        let peaks = MeetingAudioFilePeaks.compute(from: fileURL)
        let durationMs = MeetingDurationEstimate.fromBytes(byteCount(fileURL))

        let uploader = MeetingUploader(
            startAtPart: record.uploadedParts,
            send: { partNumber, bytes in
                try await client.uploadMeetingPart(
                    recordingId: record.recordingId,
                    partNumber: partNumber,
                    bytes: bytes
                )
            },
            abort: { try? await client.cancelMeetingRecording(recordingId: record.recordingId) }
        )
        await uploadFromFile(fileURL, skipping: record.uploadedParts, into: uploader)
        // **不能只从断点往后补，第 1 片也要过一遍。** 接着传的那些分片（第 2 片起）的字节
        // 确实不会再变，但第 1 片不是：m4a 编码器把开头那 60 KB 留成占位区，`stop()` 时才
        // 把 `moov` 和几个盒子的头补进去。上一个进程里发出去的第 1 片拿到的是**占位状态的
        // 开头**，不重发的话收上去的是一段没有 `moov`、谁也打不开的音频。
        //
        // 传 `audioFile` 就是让它走收尾那套核对：本进程里没有摘要的分片会被当成「变过」重发
        // （第 1 片正属此类），有摘要且对得上的不重传。收尾路径上那些已经传过的分片因此只多
        // 出一次读盘，不会重传。
        guard await uploader.finish(audioFile: fileURL) else { return }

        do {
            let encodedPeaks = MeetingPeaks.encode(peaks)
            try await client.completeMeetingRecording(
                recordingId: record.recordingId,
                durationMs: durationMs,
                peaks: encodedPeaks
            )
            // 同样归入缓存：这条也是刚录完的，回听要秒开。
            keepRecordedAudio(record, peaks: encodedPeaks)
        } catch {
            AppLog.recording.warning(
                "recovering a recording failed, it stays pending: \(error.localizedDescription, privacy: .public)"
            )
        }
    }

    /// 把本机文件里还没传过的那一段交给上传器。
    private func uploadFromFile(_ url: URL, skipping parts: Int, into uploader: MeetingUploader) async {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }
        let offset = UInt64(max(0, parts)) * UInt64(MeetingAudio.partBytes)
        try? handle.seek(toOffset: offset)
        while let data = try? handle.read(upToCount: MeetingAudio.partBytes), !data.isEmpty {
            uploader.enqueue(data)
        }
    }

    private func byteCount(_ url: URL) -> Int {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
    }
}

/// 从本机那份音频重算一遍波形。
///
/// 只用在异常退出那条路上：正常收尾时振幅是一路记在内存里的。手机端比电脑端强的地方
/// 就在这里——音频落了盘，波形就永远算得回来，不必接受一条平线。
enum MeetingAudioFilePeaks {
    static func compute(from url: URL) -> [Double] {
        guard let file = try? AVAudioFile(forReading: url) else { return [] }
        let format = file.processingFormat
        guard format.sampleRate > 0, format.channelCount > 0 else { return [] }
        // 一个采样窗口的帧数：和录音时 28 毫秒取一次是同一个口径。
        let framesPerWindow = AVAudioFrameCount(max(1, Int(format.sampleRate * Double(MeetingAudio.peakMs) / 1000)))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: framesPerWindow) else { return [] }

        var store = MeetingPeakStore()
        while true {
            do {
                try file.read(into: buffer, frameCount: framesPerWindow)
            } catch {
                break
            }
            guard buffer.frameLength > 0, let channels = buffer.floatChannelData else { break }
            let frames = Int(buffer.frameLength)
            let samples = channels[0]
            var sum = 0.0
            for index in 0..<frames {
                let value = Double(samples[index])
                sum += value * value
            }
            let rms = (sum / Double(frames)).squareRoot()
            store.push(MeetingAudio.amplitude(fromRMS: rms))
            if file.framePosition >= file.length { break }
        }
        return store.values
    }
}
