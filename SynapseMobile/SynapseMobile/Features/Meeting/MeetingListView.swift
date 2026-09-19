import SwiftUI

/// 录音列表。
///
/// 行内容只有三样：标题、时间 · 时长、状态徽标。**不加搜索、不加筛选**——这是一份
/// 流水账，看得见就够，和电脑端的左栏一致。
struct MeetingListView: View {
    @Environment(SynapseAppModel.self) private var model
    @State private var showingRecording = false
    @State private var renameTarget: MeetingSummary?
    @State private var deleteTarget: MeetingSummary?

    var body: some View {
        List {
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
                    Haptics.record()
                    showingRecording = true
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
        .sheet(isPresented: $showingRecording) {
            MeetingRecordingView()
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
            await model.reloadMeetings()
            // 正在转写的那几场要自己变成结果，用户不用下拉。没有在转的就不轮询，
            // 免得在后台白跑一路请求。
            while !Task.isCancelled, model.meetings.hasTranscribing {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { return }
                await model.reloadMeetings()
            }
        }
    }

    private var emptySection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text(model.meetings.isLoading ? "正在读取…" : "还没有录音")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if !model.meetings.isLoading {
                    Button("开始录音") {
                        Haptics.record()
                        showingRecording = true
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
