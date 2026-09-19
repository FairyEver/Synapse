import SwiftUI

/// 录音详情：一段转写文字。
///
/// 手机上看的是**结果**，不是录音：这一屏不做播放、不做编辑，也不显示任何上传或存储
/// 位置。文字只有一段，与电脑端的文字视图一致——没有纪要、没有发言人、没有时间戳、
/// 没有搜索。
struct MeetingDetailView: View {
    @Environment(SynapseAppModel.self) private var model
    let meetingId: String

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
        .task { await model.loadMeetingDetail(meetingId) }
    }

    private func content(_ detail: MeetingDetail) -> some View {
        List {
            Section {
                LabeledContent("时长", value: MeetingText.duration(detail.durationMs))
                LabeledContent("状态", value: MeetingText.statusLabel(detail.status))
                if detail.recording.isDeleted {
                    Text("录音已删除 · 文字仍保留")
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

            transcriptSection(detail)
        }
    }

    @ViewBuilder
    private func transcriptSection(_ detail: MeetingDetail) -> some View {
        let paragraphs = MeetingText.paragraphs(detail.segments)
        if paragraphs.isEmpty {
            Section {
                Text(detail.status == "transcribing" ? "转写还在进行。" : "这段录音里没有识别到语音。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } else {
            Section {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(.subheadline)
                        .padding(.vertical, 2)
                }
            }
        }
    }
}
