import AVFoundation
import Foundation
import Observation
import os

/// 语音视图：一条播放器。
///
/// 一整段铺满宽度的波形、播放头、播放键、前后 15 秒、当前 / 总时长。点波形任意位置
/// 跳到那儿。**没有**时间刻度尺、缩略图、倍速、字幕跟随——那是电脑端明确去掉的东西。
///
/// 播放走本机缓存（`MeetingAudioCache`）：本机有那份音频就直接播本机文件，一个字都不用
/// 联网；没有才去云端下，下完再播本机那份。**界面上看不见缓存的存在**——没有「已缓存」
/// 「离线」这类字样，快慢用户自己感觉得到。
///
/// 它与录音共用 `AVAudioSession`：这里**一个字都不设**。录音那条路设的是
/// `.playAndRecord`，在那个类别下播放和录音可以同时在；而这里若为了「播放」把它改成
/// `.playback`，正在录的那条就会被掐掉——从录音页进语音视图再出来，录音就没了。
@MainActor
@Observable
final class MeetingPlayback {
    /// 前后 15 秒。一条录音动辄四十分钟以上，回退重听是刚需。
    static let skipSeconds: Double = 15

    /// 下载没成之后隔多久再试。起手短一点，退到 15 秒就不再退：网回来几秒内就能自己接上，
    /// 而真没网的时候每 15 秒一个请求也不算什么。
    private static let initialRetryDelay: TimeInterval = 3
    private static let maxRetryDelay: TimeInterval = 15

    private(set) var isPlaying = false
    private(set) var currentSeconds: Double = 0
    private(set) var durationSeconds: Double = 0
    /// 0–1 的振幅，**已经除以 255**。
    private(set) var peaks: [Double] = []
    /// 本机还没有这份音频，正在下。界面据此进载入态：波形压暗、播放键禁用、下面一行转圈
    /// 加「正在下载」。**它不是失败态**——网回来自会接着下完（见 `scheduleRetry`）。
    private(set) var isLoading = false
    /// 录音没了。历史数据里有，别的端也可能删过。
    private(set) var isUnavailable = false
    /// 这一屏载入过几次。界面靠它决定「10 秒那个计时」要不要重新起算：按下「重试」也让它
    /// 加一，用户才看得见那一下的反应。
    private(set) var loadAttempt = 0

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var loadedMeetingId: String?
    /// 服务端报的这条音频有多大。命中判据三件套里有一件是它，所以每次载入都要带着。
    private var serverSize = 0
    /// 本机那份缓存在哪、索引里怎么记。
    private let cache: MeetingAudioCache
    private var retryTask: Task<Void, Never>?
    private var retryDelay = MeetingPlayback.initialRetryDelay
    /// 正在试一次（下载在路上）。离开这一屏又回来时靠它判断要不要接着试。
    private var isAttempting = false

    init(cache: MeetingAudioCache = .shared) {
        self.cache = cache
    }

    var progress: Double {
        guard durationSeconds > 0 else { return 0 }
        return min(1, max(0, currentSeconds / durationSeconds))
    }

    /// 打开一条录音。
    ///
    /// 本机有就直接播本机那份；没有就先下、下完再播。`serverSize` 是服务端详情里的
    /// `recording.size`——命中判据三件套里的一件就是它。
    func load(meetingId: String, serverSize: Int, using client: APIClient) async {
        if loadedMeetingId != meetingId {
            loadedMeetingId = meetingId
            self.serverSize = serverSize
            teardownPlayer()
            peaks = []
            isUnavailable = false
            isLoading = true
            loadAttempt += 1
            retryDelay = Self.initialRetryDelay
            retryTask?.cancel()
            retryTask = nil
            await attempt(meetingId: meetingId, using: client)
            return
        }
        // 还是这一条：播放器早就挂好了，重进这一屏什么都不用做。
        //
        // 例外是上一次还没下完就离开了这一屏——那时候重试那一路已经停掉（见 `stop`），
        // 这里要把它接上，不然回来只剩一圈转到天荒地老的「正在下载」。
        if isLoading, !isAttempting, retryTask == nil {
            retryDelay = Self.initialRetryDelay
            await attempt(meetingId: meetingId, using: client)
        }
    }

    /// 载入态里那个「重试」：手动催一下。
    ///
    /// **不取代自动恢复**——后台那一路照旧在试，网回来自己就好，用户不动手也能好。这一下
    /// 只是给等急了的人一个出口，顺手让「10 秒」那个计时重新起算，按下去看得见反应。
    func retry(using client: APIClient) async {
        guard let meetingId = loadedMeetingId, isLoading else { return }
        retryTask?.cancel()
        retryTask = nil
        retryDelay = Self.initialRetryDelay
        loadAttempt += 1
        await attempt(meetingId: meetingId, using: client)
    }

    /// 试一次：先看本机有没有，没有才去云端下。
    ///
    /// 失败**不改变任何界面状态**，只安排下一次自动尝试：没网不是错误，是一个会自己好的
    /// 状态。原因落进日志，界面上仍然只是「正在下载」——所以这里没有失败字段可读，界面也
    /// 不该有：文案表里根本没有「播放失败」这一条。
    private func attempt(meetingId: String, using client: APIClient) async {
        isAttempting = true
        defer { isAttempting = false }

        // 命中判据三件套过了：播本机那份，一个字都不用联网。
        if let cached = cache.cachedAudio(meetingId: meetingId, serverSize: serverSize) {
            peaks = MeetingPeaks.decode(cache.peaks(meetingId: meetingId, serverSize: serverSize))
            // 每次播放开始更新这条的「最后播放时间」，LRU 淘汰按它从早到晚删。
            cache.markPlayed(meetingId: meetingId)
            attachPlayer(cached)
            isLoading = false
            return
        }

        do {
            async let encodedPeaks = peaksFor(meetingId, using: client)
            async let address = client.meetingAudioURL(meetingId)
            // 波形先到就先画：下载那几秒里那条真实形状已经能看了，只是压暗着。
            let encoded = await encodedPeaks
            peaks = MeetingPeaks.decode(encoded)
            guard let url = try await address, let remote = URL(string: url) else {
                // 地址是 nil 代表录音已经不在服务端了。这不是错误，是一个要说明的状态。
                isUnavailable = true
                isLoading = false
                return
            }
            let destination = cache.audioURL(meetingId: meetingId)
            try await client.downloadMeetingAudio(from: remote, to: destination)
            cache.store(meetingId: meetingId, size: byteCount(destination), peaks: encoded ?? "")
            attachPlayer(destination)
            isLoading = false
        } catch {
            let message = (error as? APIError)?.message ?? "读不到这段录音的音频。"
            AppLog.recording.warning("meeting audio load failed, retrying: \(message, privacy: .public)")
            scheduleRetry(meetingId: meetingId, using: client)
        }
    }

    /// 网回来自愈那一路：失败之后隔一会儿再试，直到下下来、拿到「录音没了」的答复，或者
    /// 用户看的那条换了为止。
    ///
    /// 界面上这段时间仍然只是「正在下载」——它真的还在下，只是这会儿下不动。
    private func scheduleRetry(meetingId: String, using client: APIClient) {
        retryTask?.cancel()
        let delay = retryDelay
        retryDelay = min(Self.maxRetryDelay, retryDelay * 2)
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self, self.loadedMeetingId == meetingId else { return }
            await self.attempt(meetingId: meetingId, using: client)
        }
    }

    /// 波形拿不到不算这条录音读不到：它是配角，失败了照旧画一条空波形。
    private func peaksFor(_ meetingId: String, using client: APIClient) async -> String? {
        do {
            return try await client.meetingPeaks(meetingId)
        } catch {
            return nil
        }
    }

    /// 下下来的那份到底是几字节。取不到就退回服务端报的数——命中判据要的就是这两个相等。
    private func byteCount(_ url: URL) -> Int {
        ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int) ?? serverSize
    }

    func togglePlay() {
        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            // 播之前先激活会话：不激活的话第一次点播放要等音频系统就位，那一下的静默
            // 会被当成「点了没反应」。
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
            isPlaying = true
        }
    }

    /// 点波形任意位置跳到对应时间。
    func seek(toFraction fraction: Double) {
        guard durationSeconds > 0 else { return }
        seek(toSeconds: Double(min(1, max(0, fraction))) * durationSeconds)
    }

    func seek(toSeconds seconds: Double) {
        guard let player, durationSeconds > 0 else { return }
        let clamped = min(durationSeconds, max(0, seconds))
        player.seek(to: CMTime(seconds: clamped, preferredTimescale: 600))
        currentSeconds = clamped
    }

    func skip(by seconds: Double) {
        seek(toSeconds: currentSeconds + seconds)
    }

    /// 离开这一屏就停：音频不该在用户看不到的地方继续。
    func stop() {
        player?.pause()
        isPlaying = false
        // 还没下完的那条也就此打住，不在这时候发请求。回来时 `load` 会把它接上，见那里
        // 的注释。
        retryTask?.cancel()
        retryTask = nil
    }

    /// 那一条被删掉之后，播放器要跟着消失——留着一个播放一条不存在的音频的界面，比
    /// 说清楚它没了更糟。
    func forget(meetingId: String) {
        guard loadedMeetingId == meetingId else { return }
        loadedMeetingId = nil
        retryTask?.cancel()
        retryTask = nil
        teardownPlayer()
        peaks = []
        isUnavailable = false
        isLoading = false
    }

    private func attachPlayer(_ url: URL) {
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.currentSeconds = time.seconds.isFinite ? time.seconds : 0
                if let duration = player.currentItem?.duration.seconds, duration.isFinite, duration > 0 {
                    self.durationSeconds = duration
                }
            }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.isPlaying = false
                // 播完回到开头：再点一次播放是从头听，而不是停在一个已经结束的位置。
                self.seek(toSeconds: 0)
            }
        }

        // 时长要等资源就绪才有，先把播放头压到 0，免得进度条先闪一下再跳。
        currentSeconds = 0
        durationSeconds = 0
    }

    private func teardownPlayer() {
        if let player, let timeObserver {
            player.removeTimeObserver(timeObserver)
        }
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        timeObserver = nil
        endObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
        currentSeconds = 0
        durationSeconds = 0
    }
}
