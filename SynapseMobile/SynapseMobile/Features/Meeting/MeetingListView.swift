import SwiftUI

/// 录音列表。
///
/// 行内容只有三样：标题、时间 · 时长、状态徽标。**不加搜索、不加筛选**——这是一份
/// 流水账，看得见就够，和电脑端的左栏一致。
struct MeetingListView: View {
    @Environment(SynapseAppModel.self) private var model
    @State private var renameTarget: MeetingSummary?
    @State private var deleteTarget: MeetingSummary?
    /// 转写轮询。收尾完成时要重新起一轮，所以它是个能取消、能重起的任务，不是一条
    /// 一次性的循环。
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        @Bindable var model = model
        return List {
            if model.meetings.meetings.isEmpty {
                emptySection
            } else {
                Section {
                    ForEach(model.meetings.meetings) { meeting in
                        NavigationLink(value: Route.meeting(meeting.id)) {
                            row(meeting)
                        }
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
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deleteTarget = meeting
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
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
        .navigationTitle("录音")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    model.isRecordingPresented = true
                } label: {
                    Image(systemName: "plus")
                }
                // 和终端那个加号长得一样，但**没有 `disabled`**：终端依赖一台电脑在线，
                // 录音不依赖任何一台电脑——采在手机上，转写在服务端。照抄那个条件会把
                // 这个按钮在离线时就置灰，而那时候它恰恰是唯一还能用的东西。
                .accessibilityIdentifier("new-recording")
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
            // 录音页收起（点完成或取消）之后立刻把列表捞回来：那条录音在服务端从按下加号
            // 那一刻就存在了，不收尾也要看得见它，否则用户点完「完成」回到列表是一片没变
            // 的样子，会以为没录上。
            if !presented { Task { await model.reloadMeetings() } }
        }
        .onChange(of: model.recording.phase) { _, phase in
            // 收尾跑完就是这条录音变成「转写中」的时候，轮询要从这里重新起一轮——进屏时
            // 若一条都不在转写，它早就退出了。
            if phase == .idle {
                Task { await model.reloadMeetings() }
                startPolling()
            }
            if model.recording.didHitDurationLimit {
                model.notice("录音已到 5 小时上限，已自动保存。")
            }
        }
        .sheet(item: $renameTarget) { meeting in
            RenameRecordingSheet(title: meeting.title) { newTitle in
                Task { await model.renameMeeting(meeting.id, to: newTitle) }
            }
        }
        .alert("删除这条录音？", isPresented: Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        ), presenting: deleteTarget) { meeting in
            Button("删除", role: .destructive) {
                Haptics.warning()
                Task { await model.deleteMeeting(meeting.id) }
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
            startPolling()
        }
        .onDisappear {
            // `pollTask` 是在 `.task` 的闭包里就地起的，不是它的子任务 —— SwiftUI
            // 在视图消失时的自动取消够不着它。不显式收掉，用户切走之后它还会每 5 秒
            // 发一次请求，而这条任务已经没人拿得住、也没人能再取消它了。
            pollTask?.cancel()
            pollTask = nil
        }
    }

    /// 正在转写的那几场要自己变成结果，用户不用下拉。没有在转的就退出循环，免得在后台
    /// 白跑一路请求。
    ///
    /// **这件事得能被重新点着。** 写成一条 `while hasTranscribing` 的自走循环的话，进屏
    /// 那一刻一条都不在转就再也不会自动刷新了——而刚录完的那条恰恰是在那之后才变成
    /// 「转写中」的。所以它是个可以再叫一次的入口，收尾完成时叫它。
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled, model.meetings.hasTranscribing {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { return }
                await model.reloadMeetings()
            }
        }
    }

    /// 进录音页的四个入口共用这一条：露出录音页的同时开始录，没有「先起名字」这一步。
    private func startIfRequested() {
        guard model.isRecordingPresented, !model.recording.isRecording else { return }
        Haptics.record()
        Task { await model.startRecording() }
    }

    private var emptySection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text(model.meetings.isLoading ? "正在读取…" : "还没有录音")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if !model.meetings.isLoading {
                    Button("开始录音") {
                        model.isRecordingPresented = true
                    }
                    .font(.subheadline)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func row(_ meeting: MeetingSummary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(meeting.title)
                .font(.subheadline)
                .lineLimit(1)
            Text(MeetingText.secondary(meeting))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 2)
        .badge(MeetingText.statusLabel(meeting.status))
    }

    private func copyTranscript(_ meeting: MeetingSummary) {
        Task {
            guard let text = await model.meetingTranscript(meeting.id) else { return }
            UIPasteboard.general.string = text
            Haptics.success()
            model.notice("已复制全文")
        }
    }
}

/// 重命名。跟终端会话那一个同一个形状：只改名字，不碰别的。
private struct RenameRecordingSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let onCommit: (String) -> Void
    @State private var text: String

    init(title: String, onCommit: @escaping (String) -> Void) {
        self.title = title
        self.onCommit = onCommit
        _text = State(initialValue: title)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("名称", text: $text)
                    .accessibilityIdentifier("recording-rename-field")
            }
            .navigationTitle("重命名")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        onCommit(text)
                        dismiss()
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
