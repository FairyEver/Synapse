import SwiftUI
import UIKit

/// 录音页。
///
/// 整屏只回答两个问题：**是不是在录**、**麦克风到底听没听见**。所以只有名字、计时、
/// 一条波形、取消 / 完成——没有暂停，没有上传进度，没有任何和存储位置有关的字。
///
/// 它可以下滑收起，收起之后录音继续（决策四）。一场四十分钟的会里不该把人锁在这一屏。
struct MeetingRecordingView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .footnote) private var hintLineHeight: CGFloat = 20
    @ScaledMetric(relativeTo: .largeTitle) private var timerFontSize: CGFloat = 46

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                title
                timer
                waveform
                hintLine
            }
            .padding(.horizontal, 24)
            .padding(.top, 36)
            .padding(.bottom, 20)
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            footer
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
        }
        .presentationDragIndicator(.visible)
        // 收起不等于停下：这一屏只是个观察窗，录音在 App 模型上跑。
        .interactiveDismissDisabled(false)
    }

    private var title: some View {
        Text(model.recording.title.isEmpty ? "新录音" : model.recording.title)
            .font(.headline)
            .foregroundStyle(Theme.ink)
            .lineLimit(1)
    }

    private var timer: some View {
        Text(MeetingText.clock(model.recording.elapsedMs))
            .font(.system(size: timerFontSize, weight: .light))
            .monospacedDigit()
            .foregroundStyle(Theme.ink)
            .accessibilityLabel("已录 \(MeetingText.clock(model.recording.elapsedMs))")
    }

    private var waveform: some View {
        RecordingWaveform(session: model.recording)
            .frame(height: 64)
            .padding(.horizontal, 12)
            .surfaceCard()
    }

    /// 保留一行的最小高度，错误原因与辅助字号仍可完整换行。
    private var hintLine: some View {
        Text(hintText)
            .font(.footnote)
            .foregroundStyle(hintIsFailure ? Theme.failure : Color.secondary)
            .multilineTextAlignment(.center)
            .frame(minHeight: hintLineHeight)
    }

    private var footer: some View {
        VStack(spacing: 16) {
            if model.recording.isRecording && model.recording.meetingId != nil {
                Text("录音会保存，用于转写")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if model.recording.hint == .microphoneDenied,
               let settings = URL(string: UIApplication.openSettingsURLString) {
                Button("去设置") { openURL(settings) }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .accessibilityIdentifier("recording-open-settings")
            }
            HStack(spacing: 12) {
                // 两个按钮都**立刻回列表**，不等任何网络往返：点「完成」之后要发生的事
                // （补尾片、提交、清理本机文件）全在后台跑，界面不显示等待。
                Button {
                    Haptics.warning()
                    model.recording.cancel()
                    dismiss()
                } label: {
                    Text("取消").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityIdentifier("recording-cancel")

                Button {
                    Haptics.commit()
                    model.recording.finish()
                    dismiss()
                } label: {
                    Text("完成").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!model.recording.isRecording)
                .accessibilityIdentifier("recording-finish")
            }
        }
    }

    private var hintText: String {
        if model.recording.isStarting { return "正在开始录音…" }
        switch model.recording.hint {
        case .none: return ""
        case .silent: return "没有听到声音"
        case .microphoneDenied: return "未取得麦克风权限"
        case .interrupted: return "录音已暂停，麦克风被其他应用占用"
        case .uploadFailed(let reason): return reason
        case .recordingFailed(let reason): return reason
        }
    }

    private var hintIsFailure: Bool {
        switch model.recording.hint {
        case .uploadFailed, .recordingFailed: return true
        default: return false
        }
    }
}

/// 录音中那条滚动波形。
///
/// 与电脑端同一套口径：**真数据**、**槽位宽度固定**、**贴右边缘从右往左长**、**只回看
/// 最近 5 秒**、**主题前景色**。排布算法在 `meetingLiveWaveLayout` 里，这里只管画。
///
/// 它在自己的 `body` 里读 `session.levels`，所以每 28 毫秒重画的只有这一块——计时和
/// 按钮不跟着一起重排。
private struct RecordingWaveform: View {
    let session: MeetingRecordingSession

    var body: some View {
        let levels = session.levels
        Canvas { context, size in
            let layout = meetingLiveWaveLayout(peakCount: levels.count, canvasWidth: size.width)
            guard layout.visibleCount > 0 else { return }
            let column = MeetingAudio.barWidth + MeetingAudio.barGap
            let mid = size.height / 2
            let first = layout.firstIndex(totalPeaks: levels.count)

            for slot in 0..<layout.visibleCount {
                let level = levels[first + slot]
                // 半高最多到画布的一半，再留一成边距，柱子不会顶到框上。
                let half = max(1, level * mid * 0.9)
                let x = Double(layout.startSlot + slot) * column + column / 2
                let bar = CGRect(
                    x: x - MeetingAudio.barWidth / 2,
                    y: mid - half,
                    width: MeetingAudio.barWidth,
                    height: half * 2
                )
                context.fill(
                    Path(roundedRect: bar, cornerRadius: MeetingAudio.barWidth / 2),
                    with: .color(Theme.ink)
                )
            }
        }
        .accessibilityHidden(true)
    }
}
