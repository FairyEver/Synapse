import SwiftUI

/// 录音页。
///
/// 整屏只回答两个问题：**是不是在录**、**麦克风到底听没听见**。所以只有名字、计时、
/// 一条波形、取消 / 完成——没有暂停，没有上传进度，没有任何和存储位置有关的字。
///
/// 它可以下滑收起，收起之后录音继续（决策四）。一场四十分钟的会里不该把人锁在这一屏。
struct MeetingRecordingView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 20) {
            title
            timer
            waveform
            hintLine
            Spacer(minLength: 0)
            footer
        }
        .padding(.horizontal, 24)
        .padding(.top, 36)
        .padding(.bottom, 24)
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
            .font(.system(size: 46, weight: .light))
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

    /// 提示行。**高度固定**：字换来换去，但这一行不许把下面的东西顶下去。
    private var hintLine: some View {
        Text(hintText)
            .font(.footnote)
            .foregroundStyle(hintIsFailure ? Theme.failure : Color.secondary)
            .lineLimit(1)
            .frame(height: 20)
    }

    private var footer: some View {
        VStack(spacing: 16) {
            Text("录音会保存，用于转写")
                .font(.footnote)
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                // 两个按钮都**立刻回列表**，不等任何网络往返：点「完成」之后要发生的事
                // （补尾片、提交、清理本机文件）全在后台跑，界面不显示等待。
                action("取消", isPrimary: false) {
                    Haptics.warning()
                    model.recording.cancel()
                    dismiss()
                }
                .accessibilityIdentifier("recording-cancel")

                action("完成", isPrimary: true) {
                    Haptics.commit()
                    model.recording.finish()
                    dismiss()
                }
                .accessibilityIdentifier("recording-finish")
            }
        }
    }

    /// 实心那一种是 `Theme.ink` 作填充、`Theme.paper` 作文字——与 App 里其他「确定的
    /// 那一个」按钮同一套。`.opacity(1)` 不是多余的：`Theme.ink` 就是 `Color.primary`，
    /// 当填充用的时候按「主要前景」那一档算，不带上它就落不成实色。
    private func action(_ label: String, isPrimary: Bool, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(isPrimary ? Theme.paper : Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(minHeight: Metrics.minimumTapTarget)
                .background(
                    isPrimary
                        ? AnyShapeStyle(Theme.ink.opacity(1))
                        : AnyShapeStyle(Color(uiColor: .secondarySystemBackground)),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }

    private var hintText: String {
        switch model.recording.hint {
        case .none: return ""
        case .silent: return "没有听到声音"
        case .microphoneDenied: return "未取得麦克风权限，波形为示意"
        case .interrupted: return "录音已暂停，麦克风被其他应用占用"
        case .uploadFailed(let reason): return reason
        }
    }

    private var hintIsFailure: Bool {
        if case .uploadFailed = model.recording.hint { return true }
        return false
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

/// 收起录音页之后，App 顶部那一枚玻璃胶囊：计时 + 完成。
///
/// 它要说的是「还在录，而且随时能停」——没有它，用户收起这一屏之后就再也找不到自己在
/// 录的那条了。
struct RecordingCapsule: View {
    @Environment(SynapseAppModel.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(Theme.ink)
                .frame(width: 7, height: 7)
            Text(MeetingText.clock(model.recording.elapsedMs))
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
            Button {
                Haptics.commit()
                model.recording.finish()
            } label: {
                Text(model.recording.phase == .paused ? "已暂停" : "完成")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink)
            }
            .buttonStyle(.plain)
            .disabled(model.recording.phase == .paused)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: Capsule())
        .accessibilityIdentifier("recording-capsule")
    }
}
