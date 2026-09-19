import SwiftUI

/// 录音详情：**语音**和**文字**两个平级视图。
///
/// 音频有自己的位置，不是文字的附庸——所以是分段控件切换，不是把播放器挤在文字上面。
///
/// 没有纪要、没有发言人、没有时间戳、没有搜索、没有逐字稿分栏：用户的原话是「不需要
/// 什么纪要和逐字稿，它就是直接就是显示一段文字」。
struct MeetingDetailView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let meetingId: String

    @State private var isRenaming = false
    @State private var draftTitle = ""
    @State private var showingDeleteConfirm = false
    /// 手上这帧进度是什么时候拿到的。秒表在两次刷新之间从它往下走。
    @State private var progressReceivedAt = Date()

    var body: some View {
        Group {
            if let detail = model.meetings.detail(for: meetingId) {
                content(detail)
            } else {
                ProgressView()
                    .task { await model.loadMeetingDetail(meetingId) }
            }
        }
        .navigationTitle(model.meetings.detail(for: meetingId)?.title ?? "录音")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarMenu }
        .task {
            await refreshDetail()
            await pollWhileTranscribing()
        }
        .onDisappear { model.playback.stop() }
        .alert("删除这条录音？", isPresented: $showingDeleteConfirm) {
            Button("删除", role: .destructive) {
                Haptics.warning()
                Task {
                    await model.deleteMeeting(meetingId)
                    model.playback.forget(meetingId: meetingId)
                    // 行已经没了，这一屏也就没有可返回的地方——自己退出去。
                    dismiss()
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("「\(model.meetings.detail(for: meetingId)?.title ?? "")」的录音和文字会一起删除，无法恢复。")
        }
    }

    /// 拉一次详情，并记下这一帧是什么时候到的——进度条那条秒表要从这里往下走。
    private func refreshDetail() async {
        await model.loadMeetingDetail(meetingId)
        progressReceivedAt = Date()
    }

    /// 转写还在跑的时候，这一屏要自己变过来。
    ///
    /// 列表的轮询更新的是列表那份数据，**不会**把详情缓存一起刷新，所以光有列表轮询不够：
    /// 停在详情页上看进度，条会冻在进这一屏时的那一刻；转完了文字也不会自己出现，得退出
    /// 去再进来一次才看得见。
    ///
    /// 走的是同一套「没有在转的就退出循环」：不转的时候不留一路白跑的请求。`.task` 会在
    /// 这一屏消失时取消它，不需要另外收尾。
    private func pollWhileTranscribing() async {
        while !Task.isCancelled,
              model.meetings.detail(for: meetingId)?.status == "transcribing" {
            try? await Task.sleep(for: .seconds(5))
            if Task.isCancelled { return }
            await refreshDetail()
        }
    }

    private var toolbarMenu: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button {
                    draftTitle = model.meetings.detail(for: meetingId)?.title ?? ""
                    isRenaming = true
                } label: {
                    Label("重命名", systemImage: "pencil")
                }
                Button(role: .destructive) {
                    showingDeleteConfirm = true
                } label: {
                    Label("删除", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityIdentifier("recording-menu")
        }
    }

    @ViewBuilder
    private func content(_ detail: MeetingDetail) -> some View {
        VStack(spacing: 0) {
            header(detail)
            Picker("", selection: viewModeBinding(detail)) {
                Text("语音").tag(MeetingStore.ViewMode.audio)
                Text("文字").tag(MeetingStore.ViewMode.text)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            switch model.meetings.viewMode {
            case .audio:
                MeetingAudioPane(detail: detail)
            case .text:
                MeetingTextPane(detail: detail, progressReceivedAt: progressReceivedAt)
            }
        }
    }

    /// 切视图是**粘性**的：切到别的录音仍保持当前视图。唯一的例外是转写失败，那一条
    /// 默认落在文字视图（用户在语音里找不到失败原因）。
    private func viewModeBinding(_ detail: MeetingDetail) -> Binding<MeetingStore.ViewMode> {
        Binding(
            get: {
                if detail.status == "failed", !model.meetings.hasChosenView {
                    return .text
                }
                return model.meetings.viewMode
            },
            set: { model.meetings.select(viewMode: $0) }
        )
    }

    private func header(_ detail: MeetingDetail) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if isRenaming {
                TextField("名称", text: $draftTitle)
                    .font(.title3)
                    .textFieldStyle(.plain)
                    .submitLabel(.done)
                    .onSubmit { commitRename() }
                    .focused($renamingFocus)
                    .accessibilityIdentifier("recording-title-field")
            } else {
                Button {
                    draftTitle = detail.title
                    isRenaming = true
                } label: {
                    Text(detail.title)
                        .font(.title3)
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }
            Text(MeetingText.secondaryLine(detail))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .onChange(of: isRenaming) { _, renaming in
            if renaming { renamingFocus = true }
        }
    }

    @FocusState private var renamingFocus: Bool

    private func commitRename() {
        let newTitle = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        isRenaming = false
        guard !newTitle.isEmpty, newTitle != model.meetings.detail(for: meetingId)?.title else { return }
        Task { await model.renameMeeting(meetingId, to: newTitle) }
    }
}

/// 语音视图。
///
/// 四种状态：就绪（本机已有这份音频）、载入中（正在下）、载入超时（满 10 秒给一个
/// 「重试」）、不可用（服务端说这条录音没了）。
private struct MeetingAudioPane: View {
    @Environment(SynapseAppModel.self) private var model
    let detail: MeetingDetail
    /// 载入满 10 秒才给出的那个出口。
    @State private var showRetry = false

    var body: some View {
        VStack(spacing: 20) {
            if model.playback.isUnavailable || detail.recording.isDeleted {
                // 录音没了。说清楚文字还在、在哪，而不是给一个点不动的按钮。
                unavailable
            } else {
                waveformCard
                if model.playback.isLoading {
                    loadingRow
                }
                controls
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
        .task { await model.loadMeetingAudio(detail) }
        // 计时挂在一个会变的 key 上：换一条录音、或者按下「重试」，都从这个数重新起算。
        // `.task` 在这一屏消失时取消它，不需要另外收尾。
        .task(id: model.playback.loadAttempt) { await armRetryAfterTenSeconds() }
    }

    /// 载入中：转圈 + 「正在下载」。
    ///
    /// **不说失败**：没网时它会一直转，因为网一回来它确实会自己下完。转满 10 秒补一个
    /// 「重试」——那个是手动催一下，不取代自动恢复。
    private var loadingRow: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                ProgressView()
                Text("正在下载")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if showRetry {
                Button("重试") {
                    Haptics.commit()
                    Task { await model.retryMeetingAudio() }
                }
                .font(.subheadline)
                .accessibilityIdentifier("meeting-audio-retry")
            }
        }
    }

    /// 载入满了 10 秒就把「重试」露出来。后台那一路照旧在试，用户不动手也能好——这个按钮
    /// 只是给等急了的人一个出口，不是「不点就永远好不了」。
    private func armRetryAfterTenSeconds() async {
        showRetry = false
        try? await Task.sleep(for: .seconds(10))
        guard !Task.isCancelled else { return }
        showRetry = model.playback.isLoading
    }

    private var unavailable: some View {
        VStack(spacing: 6) {
            Text("录音已删除")
                .font(.subheadline)
            Text("文字仍保留，切到「文字」查看。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .surfaceCard()
    }

    /// 整段铺满宽度的一条：它的作用是一眼看完整个录音。点它任意位置跳到那儿。
    ///
    /// 载入中整条压暗：形状是真的（波形跟音频同时在取），但这时候它还播不了。
    private var waveformCard: some View {
        PlaybackWaveform(playback: model.playback)
            .frame(height: 128)
            .padding(.horizontal, 12)
            .surfaceCard()
            .opacity(model.playback.isLoading ? 0.4 : 1)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        // 宽度在 gesture 里拿不到，所以用整条卡片的宽度折算。拖到哪儿
                        // 播到哪儿，松手不回弹。
                        let width = UIScreen.main.bounds.width - 56
                        guard width > 0 else { return }
                        model.playback.seek(toFraction: Double(value.location.x / width))
                    }
            )
            .accessibilityIdentifier("playback-waveform")
    }

    private var controls: some View {
        HStack(spacing: 20) {
            Button {
                Haptics.select()
                model.playback.skip(by: -MeetingPlayback.skipSeconds)
            } label: {
                Image(systemName: "gobackward.15")
                    .font(.title2)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("后退 15 秒")

            Button {
                Haptics.commit()
                model.playback.togglePlay()
            } label: {
                Image(systemName: model.playback.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.ink)
                    // 载入中置灰：这会儿点它什么都不会发生。
                    .opacity(model.playback.isLoading ? 0.35 : 1)
            }
            .buttonStyle(.plain)
            .disabled(model.playback.isLoading)
            .accessibilityLabel(model.playback.isPlaying ? "暂停" : "播放")

            Button {
                Haptics.select()
                model.playback.skip(by: MeetingPlayback.skipSeconds)
            } label: {
                Image(systemName: "goforward.15")
                    .font(.title2)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("前进 15 秒")

            Spacer(minLength: 8)

            Text("\(MeetingText.clock(Int(model.playback.currentSeconds * 1000))) / \(MeetingText.clock(Int(model.playback.durationSeconds * 1000)))")
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }
}

/// 回放的那条波形：整段铺满，已播的用前景色，没播的用次要色。
private struct PlaybackWaveform: View {
    let playback: MeetingPlayback

    var body: some View {
        let peaks = playback.peaks
        let progress = playback.progress
        Canvas { context, size in
            let layout = meetingPlaybackWaveLayout(peakCount: peaks.count, canvasWidth: size.width)
            let columns = resamplePlaybackPeaks(peaks, columns: layout.columns)
            guard !columns.isEmpty else { return }
            let slot = size.width / Double(columns.count)
            let mid = size.height / 2
            let played = Int((Double(columns.count) * progress).rounded())
            for (index, level) in columns.enumerated() {
                // 半高最多到画布一半再留一成边距，柱子不顶到框上。
                let half = max(1, level * mid * 0.9)
                let x = Double(index) * slot + slot / 2
                let bar = CGRect(
                    x: x - layout.barWidth / 2,
                    y: mid - half,
                    width: layout.barWidth,
                    height: half * 2
                )
                context.fill(
                    Path(roundedRect: bar, cornerRadius: layout.barWidth / 2),
                    with: .color(index < played ? Theme.ink : Color.secondary)
                )
            }
            // 播放头。
            let head = CGRect(x: size.width * progress - 0.5, y: 0, width: 1, height: size.height)
            context.fill(Path(head), with: .color(Theme.ink))
        }
        .accessibilityHidden(true)
    }
}

/// 文字视图。一张卡片 + 自然段。
private struct MeetingTextPane: View {
    @Environment(SynapseAppModel.self) private var model
    let detail: MeetingDetail
    /// 这帧进度是什么时候拿到的。秒表在两次刷新之间从它往下走（见 `transcriptionProgress`）。
    let progressReceivedAt: Date

    private var paragraphs: [String] { MeetingText.paragraphs(detail.segments) }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    statusBanner
                    if paragraphs.isEmpty {
                        emptyState
                    } else {
                        // 有文字才套这张卡片：提示块自己就是一张卡，套起来就是卡片套
                        // 卡片；而语音那边本来就有这层卡，切过去内容宽度才不跳。
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                                Text(paragraph)
                                    .font(.subheadline)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(16)
                        .surfaceCard()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 96)
            }
            copyCapsule
        }
    }

    @ViewBuilder
    private var statusBanner: some View {
        switch detail.status {
        case "transcribing":
            // 还没投出去（或服务端还没升级到带进度的那版）时给不出任何时长，用那条不确定
            // 的条表示「马上开始」，不编一个数出来。
            if let progress = detail.transcription, progress.isRunning {
                transcriptionProgress(progress)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView()
                        .progressViewStyle(.linear)
                    Text("转写还在进行，完成后文字会自动补全。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        case "failed":
            VStack(alignment: .leading, spacing: 8) {
                Text("转写失败")
                    .font(.subheadline)
                    .foregroundStyle(Theme.failure)
                if let reason = detail.failureReason {
                    Text(reason)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("重试") {
                    Haptics.commit()
                    // 重试**不需要重新上传音频**：音频已经在服务端了。
                    Task { await model.retryMeetingTranscription(detail.id) }
                }
                .font(.subheadline)
                .accessibilityIdentifier("transcription-retry")
            }
        default:
            EmptyView()
        }
    }

    /// 转写中那一条会往前走的进度。
    ///
    /// 服务端给的是「已经等了多久」和一个按音频时长估出来的总时长，不是真实比例——腾讯云
    /// 根本没有百分比（见 `MeetingTranscriptionProgressMath`）。秒表在两次刷新之间自己走：
    /// `TimelineView` 每秒给一帧，不必自己养一个 `Timer`，也就没有要记得关掉的东西。
    @ViewBuilder
    private func transcriptionProgress(_ progress: MeetingTranscriptionProgress) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let elapsedMs = MeetingTranscriptionProgressMath.elapsedMs(
                reported: progress.elapsedMs,
                receivedAt: progressReceivedAt,
                now: context.date
            )
            VStack(alignment: .leading, spacing: 8) {
                ProgressView(value: MeetingTranscriptionProgressMath.fraction(
                    elapsedMs: elapsedMs,
                    expectedMs: progress.expectedMs
                ))
                .progressViewStyle(.linear)
                Text("\(MeetingText.transcriptionStage(progress.stage)) · 已用 \(MeetingText.clock(elapsedMs))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Text("\(MeetingText.duration(detail.durationMs))的录音，预计 \(MeetingText.duration(progress.expectedMs))左右完成")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("还没有文字")
                .font(.subheadline)
            // 转写还没跑完的时候不说「没有识别到语音」——那是一个结论，现在还不知道。
            if detail.status != "transcribing" {
                Text("这段录音里没有识别到语音。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .surfaceCard()
    }

    /// 复制全文。**没有文字时置灰，不是隐藏**——旁边的东西跟着跳位比一个灰色的按钮更糟。
    /// 悬浮在底部：一场会四十分钟，跟着内容滚就找不到了。
    private var copyCapsule: some View {
        Button {
            Haptics.success()
            UIPasteboard.general.string = paragraphs.joined(separator: "\n\n")
            model.notice("已复制全文")
        } label: {
            Text("复制全文")
                .font(.subheadline)
                .foregroundStyle(paragraphs.isEmpty ? Color.secondary : Theme.ink)
                .padding(.horizontal, 18)
                .frame(minHeight: Metrics.minimumTapTarget)
        }
        .buttonStyle(.plain)
        .background(.regularMaterial, in: Capsule())
        .disabled(paragraphs.isEmpty)
        .padding(.bottom, 20)
        .accessibilityIdentifier("copy-transcript")
    }
}
