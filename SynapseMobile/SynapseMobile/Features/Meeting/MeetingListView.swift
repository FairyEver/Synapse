import SwiftUI

/// 录音列表。整行可点，点进去看那一段转写文字。
struct MeetingListView: View {
    @Environment(SynapseAppModel.self) private var model

    var body: some View {
        List {
            if model.meetings.meetings.isEmpty {
                Section {
                    Text(model.meetings.isLoading ? "正在读取…" : "还没有录音")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section {
                    ForEach(model.meetings.meetings) { meeting in
                        NavigationLink(value: Route.meeting(meeting.id)) {
                            row(meeting)
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
        .navigationTitle("录音")
        .refreshable { await model.reloadMeetings() }
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
}
