import SwiftUI

/// 录音列表。
///
/// 行内容只有三样：标题、时间 · 时长、状态徽标。**不加搜索、不加筛选**——这是一份
/// 流水账，看得见就够，和电脑端的左栏一致。
struct MeetingListView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var selection: String?
    @State private var renameTarget: MeetingSummary?
    @State private var deleteTarget: MeetingSummary?

    var body: some View {
        @Bindable var model = model
        return List(selection: $selection) {
            if !model.meetings.meetings.isEmpty {
                Section {
                    ForEach(model.meetings.meetings) { meeting in
                        NavigationLink(value: meeting.id) {
                            row(meeting)
                        }
                        .badge(dynamicTypeSize.isAccessibilitySize ? nil : MeetingText.statusLabel(meeting.status))
                        // 长按是 iOS 的上下文菜单：整行抬起来、其余模糊、玻璃按钮浮在
                        // 下方。**不是底部动作表**，那需要用户先把手指移开。
                        .contextMenu {
                            Button {
                                renameTarget = meeting
                            } label: {
                                Label("重命名", systemImage: "pencil")
                            }
                            Button {
                                copyTranscript(meeting)
                            } label: {
                                Label("复制全文", systemImage: "doc.on.doc")
                            }
                            Button(role: .destructive) {
                                deleteTarget = meeting
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                        // 左滑露出删除。
                        //
                        // 这颗按钮要自己指定底色：左滑动作是全局 tint 唯一被当成**填充**
                        // 用的地方——它用 tint 涂满按钮，再把图标和文字也用同一个颜色画上去。
                        // 而主题色是 `Color.primary`，深色外观下就是白色，于是白底白图标，
                        // 只剩一块没有图案的白方块（2026-09-19 真机截图）。取系统红，
                        // 明暗两套外观都对，也不用自造颜色。终端会话列表那一处同理。
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deleteTarget = meeting
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                            .tint(Color(uiColor: .systemRed))
                        }
                    }
                }
            }

            if let error = model.meetings.errorMessage {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }
        }
        .listStyle(.insetGrouped)
        .tint(Color(uiColor: .systemBlue))
        // 空态铺在列表上，而不是列表里的一行：`ContentUnavailableView` 要的是整块内容
        // 区。留在 `List` 上也让下拉刷新在空态下照旧能用。
        //
        // 「读失败」的时候这里一个字都不画：失败本身已经由列表里的那条红字交代了，
        // 再叠一句「还没有录音」就是自相矛盾——一边说读不出来，一边说没有。这时候
        // 唯一诚实的说法是失败加一条重试，而不是一个空态。
        .overlay {
            if model.meetings.meetings.isEmpty && !model.recording.isRecording {
                if model.meetings.isLoading {
                    ProgressView()
                } else if model.meetings.errorMessage == nil {
                    ContentUnavailableView {
                        Label("还没有录音", systemImage: "waveform")
                    } actions: {
                        Button("开始录音") {
                            model.isRecordingPresented = true
                        }
                    }
                }
            }
        }
        .navigationTitle("录音")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    model.isRecordingPresented = true
                } label: {
                    if model.recording.isRecording {
                        Text("返回录音")
                    } else {
                        Image(systemName: "plus")
                    }
                }
                // 和终端那个加号长得一样，但**没有 `disabled`**：终端依赖一台电脑在线，
                // 录音不依赖任何一台电脑——采在手机上，转写在服务端。照抄那个条件会把
                // 这个按钮在离线时就置灰，而那时候它恰恰是唯一还能用的东西。
                .accessibilityLabel(model.recording.isRecording ? "返回录音" : "开始录音")
                .accessibilityIdentifier(model.recording.isRecording ? "resume-recording" : "new-recording")
            }
        }
        .refreshable { await model.reloadMeetings() }
        // 录音页挂在这个标志上而不是本地的 @State 上：控制中心那枚控件、主屏长按图标
        // 的快捷操作都不经过这个视图，它们只能把「要录音了」挂在这里等它来接。
        .sheet(isPresented: $model.isRecordingPresented) {
            MeetingRecordingView()
        }
        .onChange(of: model.isRecordingPresented) { _, presented in
            startIfRequested()
            // 收起只隐藏面板；完成/取消后的结果由收尾完成时的 phase 变化刷新。
            if !presented { Task { await model.reloadMeetings() } }
        }
        .onChange(of: model.recording.phase) { _, phase in
            // 收尾结束后刷新列表；是否继续轮询由列表里的转写状态决定。
            if phase == .idle {
                Task { await model.reloadMeetings() }
            }
            if model.recording.didHitDurationLimit {
                model.notice("录音已到 5 小时上限，已自动保存。")
            }
        }
        .sheet(item: $renameTarget) { meeting in
            RenameRecordingSheet(title: meeting.title) { newTitle in
                await model.renameMeeting(meeting.id, to: newTitle)
            }
        }
        .alert("删除这条录音？", isPresented: Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        ), presenting: deleteTarget) { meeting in
            Button("删除", role: .destructive) {
                Haptics.warning()
                Task {
                    guard await model.deleteMeeting(meeting.id) else { return }
                    if selection == meeting.id { selection = nil }
                }
            }
            Button("取消", role: .cancel) {}
        } message: { meeting in
            Text("「\(meeting.title)」的录音和文字会一起删除，无法恢复。")
        }
        .task {
            // 也可能是带着「要录音」进来的：主屏快捷操作或控制中心唤起 App 时，这一屏
            // 还没存在，`.onChange` 不会为一个它没见过的初值触发。
            startIfRequested()
            await model.reloadMeetings()
        }
        .task(id: model.meetings.hasTranscribing) {
            await pollWhileTranscribing()
        }
    }

    /// 正在转写的那几场要自己变成结果，用户不用下拉。没有在转的就退出循环，免得在后台
    /// 白跑一路请求。
    ///
    /// 状态变回转写中时由 SwiftUI 重启，离屏或不再转写时由 SwiftUI 取消。
    private func pollWhileTranscribing() async {
        while !Task.isCancelled, model.meetings.hasTranscribing {
            try? await Task.sleep(for: .seconds(5))
            if Task.isCancelled { return }
            await model.reloadMeetings()
        }
    }

    /// 进录音页的四个入口共用这一条：露出录音页的同时开始录，没有「先起名字」这一步。
    private func startIfRequested() {
        guard model.isRecordingPresented, !model.recording.isRecording else { return }
        Haptics.record()
        Task { await model.startRecording() }
    }


    private func row(_ meeting: MeetingSummary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(meeting.title)
                .font(.subheadline)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            Text(MeetingText.secondary(meeting))
                .font(.caption)
                .foregroundStyle(selection == meeting.id ? .primary : .secondary)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            if dynamicTypeSize.isAccessibilitySize {
                Text(MeetingText.statusLabel(meeting.status))
                    .font(.caption)
                    .foregroundStyle(selection == meeting.id ? .primary : .secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func copyTranscript(_ meeting: MeetingSummary) {
        Task {
            guard let text = await model.meetingTranscript(meeting.id) else {
                let message = model.meetings.detailError(for: meeting.id) ?? "这条录音还没有可复制的文字。"
                model.notice(message, tone: model.meetings.detailError(for: meeting.id) == nil ? .info : .failure)
                return
            }
            Clipboard.copy(text, saying: "已复制全文", on: model)
        }
    }
}

/// 重命名。跟终端会话那一个同一个形状：只改名字，不碰别的。
struct RenameRecordingSheet: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let title: String
    let onCommit: (String) async -> Bool
    @State private var text: String
    @State private var saving = false
    @State private var errorMessage: String?

    init(title: String, onCommit: @escaping (String) async -> Bool) {
        self.title = title
        self.onCommit = onCommit
        _text = State(initialValue: title)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("名称", text: $text)
                    .submitLabel(.done)
                    .onSubmit(commit)
                    .disabled(saving)
                    .accessibilityIdentifier("recording-rename-field")
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Theme.failure)
                }
            }
            .navigationTitle("重命名")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: commit) {
                        if saving {
                            ProgressView().accessibilityLabel("正在保存")
                        } else {
                            Text("保存")
                        }
                    }
                    .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        // 跟会话重命名那一个同一个形状——都是「改一个名字、一个输入框、取消加保存」。
        // 那个是 `.medium` 加拖条，这个原来是一张全高的弹窗、没有拖条，两行字的表单
        // 浮在整屏中间。同一件事在两处两种样子是错的，这是这一处错在哪。
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(saving)
    }

    private func commit() {
        let name = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !saving, !name.isEmpty else { return }
        saving = true
        errorMessage = nil
        Task {
            let saved = await onCommit(name)
            saving = false
            if saved {
                dismiss()
            } else {
                errorMessage = model.meetings.errorMessage ?? "改名失败，请重试。"
            }
        }
    }
}
