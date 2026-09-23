import SwiftUI

struct InboxView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var path: [Route]
    @State private var filter = "pending"

    var body: some View {
        List {
            if let error = model.notifications.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
            }
            Picker("筛选", selection: $filter) {
                Text("待处理").tag("pending")
                Text("全部").tag("all")
                Text("未读").tag("unread")
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)

            if filter == "pending" {
                ForEach(model.waitingSessions) { session in
                    NavigationLink(value: Route.terminal(session.id)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.title).font(.subheadline.weight(.semibold))
                            Text(session.attention.kind == "approval" ? "请求执行一个命令" : "正在等待你的回答")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                ForEach(model.notifications.items.filter { filter != "unread" || $0.readAt == nil }) { item in
                    Button { open(item) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(item.title)
                                    .font(.subheadline.weight(item.readAt == nil ? .semibold : .regular))
                                if let group = item.group { Text(group).font(.caption2).foregroundStyle(.secondary) }
                                Spacer()
                                if item.readAt == nil { Image(systemName: "circle.fill").font(.caption2) }
                            }
                            Text(item.body).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            Text(timestamp(item.createdAt)).font(.caption2).foregroundStyle(.secondary)
                        }
                        .foregroundStyle(.primary)
                    }
                    .swipeActions {
                        Button("删除", role: .destructive) {
                            Task { await model.deleteNotification(item.id) }
                        }
                    }
                }
                if model.notifications.nextCursor != nil {
                    Button("加载更多") { Task { await model.loadMoreNotifications() } }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if filter == "pending" && model.waitingSessions.isEmpty {
                ContentUnavailableView("暂无待处理事项", systemImage: "checkmark.circle")
            } else if filter != "pending" && model.notifications.error == nil && model.notifications.items.filter({ filter != "unread" || $0.readAt == nil }).isEmpty && !model.notifications.loading {
                ContentUnavailableView(filter == "unread" ? "暂无未读消息" : "暂无消息", systemImage: "bell")
            }
        }
        .navigationTitle("消息")
        .toolbar {
            if filter != "pending" {
                Button("全部已读") { Task { await model.readAllNotifications() } }
                    .disabled(model.notifications.unreadCount == 0)
            }
        }
        .refreshable {
            if filter == "pending" { await model.refreshDesktops() }
            else { await model.reloadNotifications(filter: filter) }
        }
        .onChange(of: filter) { _, selected in
            if selected != "pending" { Task { await model.reloadNotifications(filter: selected) } }
        }
        .noticeOverlay(model)
    }

    private func open(_ item: SynapseNotification) {
        path.append(.message(item.id))
    }

    private func timestamp(_ raw: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

struct NotificationDetailView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var loading = true
    let id: String

    var body: some View {
        Group {
            if let item = model.notifications.items.first(where: { $0.id == id }) {
                List {
                    Section {
                        Text(item.title).font(.headline)
                        if let group = item.group { Text(group).font(.caption).foregroundStyle(.secondary) }
                        Text(item.body)
                    }
                    if (item.source == "terminal-attention" || item.source == "terminal-complete"), let target = item.targetId {
                        Button("打开终端") {
                            if let device = item.deviceId { model.selectDesktop(device) }
                            NotificationRouter.shared.route(to: .terminal(sessionId: target, desktopClientInstanceId: item.deviceId ?? ""))
                        }
                    } else if item.source == "meeting-transcription", let target = item.targetId {
                        Button("打开录音") { NotificationRouter.shared.route(to: .meeting(meetingId: target)) }
                    } else if let raw = item.url, let url = URL(string: raw), url.scheme == "https" {
                        Button("打开链接") { openURL(url) }
                    }
                }
            } else if loading {
                ProgressView()
            } else {
                ContentUnavailableView("消息已失效", systemImage: "bell.slash")
            }
        }
        .navigationTitle("消息")
        .task {
            await model.readNotification(id)
            loading = false
        }
    }
}
