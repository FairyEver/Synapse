import SwiftUI

/// Sessions that are blocked on a person.
///
/// This is the tab that earns push notifications: an Agent that stopped to ask
/// a question is the one case where nothing progresses until someone looks.
struct InboxView: View {
    @Environment(SynapseAppModel.self) private var model

    var body: some View {
        List {
            if !model.waitingSessions.isEmpty {
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
        // 铺在列表上而不是当列表里的一行：这是一个独立的「这里空了」状态，不是一个
        // 单元格。留在 `List` 上也是为了让下拉刷新在空态下照旧能用——换成直接替换
        // 整个 `List`，那根下拉手势就跟着没了。
        .overlay {
            if model.waitingSessions.isEmpty {
                ContentUnavailableView(
                    "暂无待处理事项",
                    systemImage: "checkmark.circle",
                    description: Text("Claude Code 或 Codex 请求确认或提问时，会推送通知。")
                )
            }
        }
        .noticeOverlay(model)
        .navigationTitle("需要我")
        .refreshable { await model.refreshDesktops() }
    }
}
