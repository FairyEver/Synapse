import AVFoundation
import Foundation
import Observation
import os

/// 语音视图：一条播放器。
///
/// 一整段铺满宽度的波形、播放头、播放键、前后 15 秒、当前 / 总时长。点波形任意位置
/// 跳到那儿。**没有**时间刻度尺、缩略图、倍速、字幕跟随——那是电脑端明确去掉的东西。
///
/// 它与录音共用 `AVAudioSession`：这里**一个字都不设**。录音那条路设的是
/// `.playAndRecord`，在那个类别下播放和录音可以同时在；而这里若为了「播放」把它改成
/// `.playback`，正在录的那条就会被掐掉——从录音页进语音视图再出来，录音就没了。
@MainActor
@Observable
final class MeetingPlayback {
    /// 前后 15 秒。一条录音动辄四十分钟以上，回退重听是刚需。
    static let skipSeconds: Double = 15

    private(set) var isPlaying = false
    private(set) var currentSeconds: Double = 0
    private(set) var durationSeconds: Double = 0
    /// 0–1 的振幅，**已经除以 255**。
    private(set) var peaks: [Double] = []
    private(set) var isLoading = false
    /// 录音没了。历史数据里有，别的端也可能删过。
    private(set) var isUnavailable = false
    private(set) var failureMessage: String?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var loadedMeetingId: String?

    var progress: Double {
        guard durationSeconds > 0 else { return 0 }
        return min(1, max(0, currentSeconds / durationSeconds))
    }

    func load(meetingId: String, using client: APIClient) async {
        guard loadedMeetingId != meetingId else { return }
        loadedMeetingId = meetingId
        teardownPlayer()
        peaks = []
        isUnavailable = false
        failureMessage = nil
        isLoading = true
        defer { isLoading = false }

        do {
            async let audioURL = client.meetingAudioURL(meetingId)
            async let encodedPeaks = client.meetingPeaks(meetingId)
            let (url, encoded) = try await (audioURL, encodedPeaks)
            peaks = MeetingPeaks.decode(encoded)
            guard let url, let playerURL = URL(string: url) else {
                // 地址是 nil 代表录音已经不在服务端了。这不是错误，是一个要说明的状态。
                isUnavailable = true
                return
            }
            attachPlayer(playerURL)
        } catch let error as APIError {
            failureMessage = error.message
        } catch {
            failureMessage = "读不到这段录音的音频。"
        }
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
    }

    /// 那一条被删掉之后，播放器要跟着消失——留着一个播放一条不存在的音频的界面，比
    /// 说清楚它没了更糟。
    func forget(meetingId: String) {
        guard loadedMeetingId == meetingId else { return }
        loadedMeetingId = nil
        teardownPlayer()
        peaks = []
        isUnavailable = false
        failureMessage = nil
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
