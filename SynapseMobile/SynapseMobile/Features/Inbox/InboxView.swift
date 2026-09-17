import SwiftUI

/// Sessions that are blocked on a person.
///
/// This is the tab that earns push notifications: an Agent that stopped to ask
/// a question is the one case where nothing progresses until someone looks.
struct InboxView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var path: [Route]

    var body: some View {
        List {
            if model.waitingSessions.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("暂无待处理事项")
                            .font(.system(size: 15, weight: .semibold))
                        Text("Claude Code 或 Codex 请求确认或提问时，会推送通知。")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Section("等待中") {
                    ForEach(model.waitingSessions) { session in
                        Button {
                            path.append(.terminal(session.id))
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(session.title)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(model.groupName(session.groupId))
                                        .font(.system(size: 11))
                                        .foregroundStyle(.tertiary)
                                }
                                Text(session.attention.kind == "approval"
                                     ? "请求执行一个命令"
                                     : "正在等待你的回答")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.attention)
                                if !session.lastLine.isEmpty {
                                    Text(session.lastLine)
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 3)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .noticeOverlay(model)
        .navigationTitle("需要我")
        .refreshable { await model.refreshDesktops() }
    }
}
