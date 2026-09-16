import SwiftUI

/// The session list.
///
/// Rows answer "what is this terminal doing right now" without opening anything,
/// which is the whole point of the phone: the common visit ends here, not in a
/// terminal. That is why the last output line is on the row despite costing
/// visual tidiness.
struct SessionListView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var path: [Route]
    @State private var showingNewSession = false
    @State private var renameTarget: MobileSummarySession?
    @State private var renameTitle = ""
    @State private var deleteTarget: MobileSummarySession?

    var body: some View {
        List {
            deviceSection
            if model.onlineDesktops.isEmpty {
                offlineSection
            } else if model.sessions.isEmpty {
                emptySection
            } else {
                ForEach(model.summary?.groups ?? []) { group in
                    let sessions = model.sessions(inGroup: group.id)
                    if !sessions.isEmpty {
                        Section(group.name) {
                            ForEach(sessions) { session in
                                sessionRow(session)
                            }
                        }
                    }
                }
                // A session whose group is missing from the advertised list would
                // otherwise never be rendered: it would simply not exist on the
                // phone, with nothing to indicate why. Listing it ungrouped is
                // strictly better than dropping it silently.
                if !ungroupedSessions.isEmpty {
                    Section("其它") {
                        ForEach(ungroupedSessions) { session in
                            sessionRow(session)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("终端")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingNewSession = true
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(model.selectedDesktopClientInstanceId == nil)
            }
        }
        .refreshable { await model.refreshDesktops() }
        .sheet(isPresented: $showingNewSession) {
            NewSessionSheet { groupId in
                Task {
                    if let created = await model.createSession(groupId: groupId) {
                        path.append(.terminal(created))
                    }
                }
            }
        }
        .alert("重命名终端", isPresented: isRenaming, presenting: renameTarget) { session in
            TextField("名称", text: $renameTitle)
            Button("取消", role: .cancel) {}
            Button("保存") { model.rename(session.id, to: renameTitle) }
        }
        .alert("删除这个终端？", isPresented: isDeleting, presenting: deleteTarget) { session in
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) { model.delete(session.id) }
        } message: { _ in
            Text("会先停止它，正在跑的任务会中断。")
        }
    }

    /// A row plus the two actions a swipe reveals.
    ///
    /// `swipeActions` rather than a hand-rolled gesture: the platform already
    /// implements the physics, the full-swipe, the VoiceOver actions, and the
    /// rule that only one row stays open.
    private func sessionRow(_ session: MobileSummarySession) -> some View {
        SessionRow(session: session) {
            path.append(.terminal(session.id))
        }
        // Swipe actions are the one place the app's tint is a *fill* rather than
        // an accent: the button paints its background with it and then draws the
        // icon and text on top in that same colour. The app-wide tint is
        // `Color.primary`, which is right for a glyph on a neutral background and
        // invisible here — it painted white-on-white in dark mode. These two take
        // the system's own fills instead, so both appearances are correct without
        // inventing a colour.
        .swipeActions(edge: .trailing) {
            // Declared first, so it is the one a full swipe commits to.
            Button(role: .destructive) {
                deleteTarget = session
            } label: {
                Label("删除", systemImage: "trash")
            }
            .tint(Color(uiColor: .systemRed))

            Button {
                renameTitle = session.title
                renameTarget = session
            } label: {
                Label("重命名", systemImage: "pencil")
            }
            .tint(Color(uiColor: .systemGray))
        }
    }

    /// The alert dismisses by resetting its target, so clearing it is what closes
    /// the sheet — the presenting value drives both.
    private var isRenaming: Binding<Bool> {
        Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })
    }

    private var isDeleting: Binding<Bool> {
        Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })
    }

    private var ungroupedSessions: [MobileSummarySession] {
        let known = Set((model.summary?.groups ?? []).map(\.id))
        return model.sessions.filter { !known.contains($0.groupId) }
    }

    private var deviceSection: some View {
        Section {
            HStack(spacing: 8) {
                Circle()
                    .fill(model.onlineDesktops.isEmpty ? Color.secondary : Theme.running)
                    .frame(width: 7, height: 7)
                Text(model.summary?.desktopName ?? model.selectedDesktopClientInstanceId ?? "未连接电脑")
                    .font(.system(size: 14, weight: .medium))
                Spacer()
                Text(model.summaryConnectivityLabel())
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var offlineSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("电脑不在线")
                    .font(.system(size: 15, weight: .semibold))
                Text("终端运行在电脑上。打开电脑上的 Synapse，并保持账号登录，这里就会显示出正在运行的终端。")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }

    private var emptySection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("没有正在运行的终端")
                    .font(.system(size: 15, weight: .semibold))
                Text("电脑上没有活着的会话，或者会话刚刚结束。")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }
}

struct SessionRow: View {
    let session: MobileSummarySession
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 11) {
                Circle()
                    .fill(Theme.statusColor(isWaiting: session.attention.isWaiting, isRunning: session.isRunning))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(session.title)
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(relativeTime)
                            .font(.system(size: 11))
                            .foregroundStyle(.tertiary)
                    }
                    Text(session.cwd)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                    if !session.lastLine.isEmpty {
                        Text(session.lastLine)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if session.attention.isWaiting {
                        Text(session.attention.kind == "approval" ? "等待确认" : "等待输入")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.attention)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Theme.attention.opacity(0.12), in: Capsule())
                            .padding(.top, 1)
                    }
                }
            }
            .padding(.vertical, 3)
        }
        .buttonStyle(.plain)
    }

    private var relativeTime: String {
        guard let started = session.startedAtDate else { return "" }
        let seconds = Int(Date().timeIntervalSince(started))
        if seconds < 60 { return "\(seconds) 秒" }
        if seconds < 3600 { return "\(seconds / 60) 分" }
        if seconds < 86_400 { return "\(seconds / 3600) 小时" }
        return "\(seconds / 86_400) 天"
    }
}

/// Creating a terminal or running a saved command.
///
/// A saved command is delivered by creating a terminal and typing into it, so
/// both paths end the same way: a new session the caller can navigate to.
struct NewSessionSheet: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let onCreated: (String) -> Void
    @State private var selectedGroupId: String?

    var body: some View {
        NavigationStack {
            List {
                Section("新建终端") {
                    ForEach(model.summary?.groups ?? []) { group in
                        Button {
                            dismiss()
                            onCreated(group.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(group.name)
                                    .font(.system(size: 15))
                                    .foregroundStyle(.primary)
                                Text("在该分组下新建终端")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if (model.summary?.groups ?? []).isEmpty {
                    Text("电脑上还没有分组。先在桌面上创建一个分组。")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("新建")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }
}
