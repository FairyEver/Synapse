import SwiftUI

/// Sessions that are blocked on a person.
///
/// This is the tab that earns push notifications: an Agent that stopped to ask
/// a question is the one case where nothing progresses until someone looks.
struct InboxView: View {
    @Environment(SynapseAppModel.self) private var model

    var body: some View {
        List {
            if model.waitingSessions.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("暂无待处理事项")
                            .font(.subheadline.weight(.semibold))
                        Text("Claude Code 或 Codex 请求确认或提问时，会推送通知。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Section("等待中") {
                    ForEach(model.waitingSessions) { session in
                        // NavigationLink, not Button: the plain button style was
                        // suppressing the chevron that marks this row as pushing
                        // one level deeper. NavigationLink draws it for free and
                        // appends to the NavigationStack path on its own.
                        NavigationLink(value: Route.terminal(session.id)) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(session.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(model.groupName(session.groupId))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Text(session.attention.kind == "approval"
                                     ? "请求执行一个命令"
                                     : "正在等待你的回答")
                                    .font(.caption)
                                    .foregroundStyle(Theme.attention)
                                if !session.lastLine.isEmpty {
                                    Text(session.lastLine)
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 3)
                        }
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
