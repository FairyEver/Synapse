import SwiftUI

/// 会议详情：逐字稿与纪要。
///
/// 手机上看的是**结果**，不是录音：这一屏不做播放、不做编辑，也不显示任何上传或存储
/// 位置。逐字稿按发言人分段，时间戳只读——这里的用处是快速读一遍，不是精确定位。
struct MeetingDetailView: View {
    @Environment(SynapseAppModel.self) private var model
    let meetingId: String

    @State private var tab: Tab = .minutes
    @State private var searchText = ""

    private enum Tab: Hashable { case minutes, transcript }

    var body: some View {
        Group {
            if let detail = model.meetings.detail(for: meetingId) {
                content(detail)
            } else {
                ProgressView()
                    .task { await model.loadMeetingDetail(meetingId) }
            }
        }
        .navigationTitle(model.meetings.detail(for: meetingId)?.title ?? "会议")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadMeetingDetail(meetingId) }
    }

    private func content(_ detail: MeetingDetail) -> some View {
        List {
            Section {
                LabeledContent("时长", value: MeetingText.duration(detail.durationMs))
                if detail.speakerCount > 0 {
                    LabeledContent("发言人", value: "\(detail.speakerCount) 位")
                }
                LabeledContent("状态", value: MeetingText.statusLabel(detail.status))
                if detail.recording.isDeleted {
                    Text("录音已删除 · 逐字稿和纪要保留")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if detail.status == "failed", let reason = detail.failureReason {
                Section {
                    Text(reason)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }

            Section {
                Picker("", selection: $tab) {
                    Text("纪要").tag(Tab.minutes)
                    Text("逐字稿").tag(Tab.transcript)
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
            }

            switch tab {
            case .minutes:
                minutesSections(detail)
            case .transcript:
                transcriptSections(detail)
            }
        }
    }

    @ViewBuilder
    private func minutesSections(_ detail: MeetingDetail) -> some View {
        if let minutes = detail.minutes {
            if !minutes.topics.isEmpty {
                Section("议题") {
                    ForEach(Array(minutes.topics.enumerated()), id: \.offset) { _, topic in
                        Text(topic).font(.subheadline)
                    }
                }
            }
            if !minutes.conclusions.isEmpty {
                Section("结论") {
                    ForEach(Array(minutes.conclusions.enumerated()), id: \.offset) { _, conclusion in
                        Text(conclusion).font(.subheadline)
                    }
                }
            }
            if !minutes.todos.isEmpty {
                Section("待办") {
                    ForEach(minutes.todos) { todo in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(todo.text).font(.subheadline)
                            let meta = [todo.owner, todo.due].compactMap { $0 }.filter { !$0.isEmpty }
                            if !meta.isEmpty {
                                Text(meta.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            if minutes.topics.isEmpty && minutes.conclusions.isEmpty && minutes.todos.isEmpty {
                Section {
                    Text("还没有纪要").font(.footnote).foregroundStyle(.secondary)
                }
            }
        } else {
            Section {
                Text(detail.segments.isEmpty ? "转写完成后才能生成纪要。" : "还没有纪要")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func transcriptSections(_ detail: MeetingDetail) -> some View {
        if detail.segments.isEmpty {
            Section {
                Text(detail.status == "transcribing" ? "转写还在进行。" : "这段录音里没有识别到语音。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } else {
            Section {
                TextField("搜索逐字稿", text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Section {
                ForEach(filtered(detail)) { segment in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(MeetingText.speakerLabel(detail.speakers, segment.speakerId))
                                .font(.caption)
                                .fontWeight(.medium)
                            Text(MeetingText.clock(segment.startMs))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        Text(segment.text).font(.subheadline)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func filtered(_ detail: MeetingDetail) -> [MeetingTranscriptSegment] {
        let keyword = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !keyword.isEmpty else { return detail.segments }
        return detail.segments.filter { $0.text.lowercased().contains(keyword) }
    }
}
