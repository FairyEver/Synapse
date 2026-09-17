import SwiftUI

/// The session list.
///
/// Rows answer "what is this terminal doing right now" without opening anything,
/// which is the whole point of the phone: the common visit ends here, not in a
/// terminal. That is why the last output line is on the row despite costing
/// visual tidiness.
struct SessionListView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Binding var path: [Route]
    @State private var showingNewSession = false
    @State private var renameTarget: MobileSummarySession?
    @State private var renameTitle = ""
    @State private var deleteTarget: MobileSummarySession?
    /// Tabs the user has closed. Absent means open, so the default needs no state.
    @State private var collapsedTabs: Set<String> = []

    var body: some View {
        List {
            deviceSection
            if model.onlineDesktops.isEmpty {
                offlineSection
            } else if model.sessions.isEmpty {
                emptySection
            } else {
                ForEach(model.summary?.groups ?? []) { group in
                    let blocks = sessionListBlocks(
                        sessions: model.sessions(inGroup: group.id),
                        workspaces: model.splitTabs(inGroup: group.id),
                    )
                    if !blocks.isEmpty {
                        Section(group.name) {
                            blockRows(blocks)
                        }
                    }
                }
                // A session whose group is missing from the advertised list would
                // otherwise never be rendered: it would simply not exist on the
                // phone, with nothing to indicate why. Listing it ungrouped is
                // strictly better than dropping it silently.
                if !ungroupedSessions.isEmpty {
                    Section("其它") {
                        blockRows(sessionListBlocks(
                            sessions: ungroupedSessions,
                            // Every workspace, not just the ungrouped ones: these
                            // sessions only belong to groups that are missing from
                            // the advertised list, so nothing else can match them.
                            workspaces: model.summary?.workspaces ?? [],
                        ))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .noticeOverlay(model)
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
                        // The terminal was born at this phone's shape — the desktop's
                        // own fit is suppressed from the moment it exists — so the
                        // phone shows it the way it made it. Shrinking the computer's
                        // grid down to fit would be the other mode's answer to a
                        // question the reader never asked.
                        display.setMode(.phoneDriven, for: created)
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
            Text("会先停止终端，未完成的任务会中断。")
        }
    }

    /// Draws one group's terminals, collapsing a split tab into one block.
    ///
    /// `DisclosureGroup` rather than a nested `Section`: inside an `insetGrouped`
    /// list a nested section is simply another card, and what this has to express is
    /// ownership — not more chrome around it. The group indents its children
    /// itself, which is the platform's own way of saying "these belong to the row
    /// above".
    @ViewBuilder
    private func blockRows(_ blocks: [SessionListBlock]) -> some View {
        ForEach(blocks) { block in
            switch block {
            case .session(let id):
                if let session = model.session(id) {
                    sessionRow(session)
                }
            case .tab(let id, let title, let sessionIds):
                DisclosureGroup(isExpanded: expansion(of: id)) {
                    ForEach(sessionIds, id: \.self) { sessionId in
                        if let session = model.session(sessionId) {
                            sessionRow(session)
                        }
                    }
                } label: {
                    Text(title)
                }
            }
        }
    }

    /// Tabs start open. The relationship between the terminals is the thing this
    /// screen is meant to show, so it must not need a tap to see; collapsing is
    /// only there for someone who wants a long list out of the way.
    private func expansion(of tabId: String) -> Binding<Bool> {
        Binding(
            get: { !collapsedTabs.contains(tabId) },
            set: { isExpanded in
                if isExpanded {
                    collapsedTabs.remove(tabId)
                } else {
                    collapsedTabs.insert(tabId)
                }
            }
        )
    }

    /// A row plus the two actions a swipe reveals.
    ///
    /// `swipeActions` rather than a hand-rolled gesture: the platform already
    /// implements the physics, the full-swipe, the VoiceOver actions, and the
    /// rule that only one row stays open.
    private func sessionRow(_ session: MobileSummarySession) -> some View {
        SessionRow(session: session)
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
                    // Green only when a computer is actually reachable. A list that is
                    // empty because it could not be fetched is not a computer that is
                    // online, and the dot must not claim otherwise.
                    .fill(model.connectivity == .online ? Theme.running : Color.secondary)
                    .frame(width: 7, height: 7)
                Text(model.summary?.desktopName ?? model.selectedDesktopClientInstanceId ?? "未连接电脑")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(model.connectivity.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var offlineSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                // Names the actual problem, and the actual next step. This said "电脑
                // 不在线" whatever the reason, which sent anyone whose phone simply had
                // no network off to look at a computer that was already running.
                Text(model.connectivity.label)
                    .font(.subheadline.weight(.semibold))
                if let guidance = model.connectivity.guidance {
                    Text(guidance)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
    }

    /// Title only: the sentence that used to sit here restated it, and "a session
    /// may have just ended" is not something the reader can act on.
    private var emptySection: some View {
        Section {
            Text("没有正在运行的终端")
                .font(.subheadline.weight(.semibold))
        }
    }
}

struct SessionRow: View {
    let session: MobileSummarySession

    /// `NavigationLink` rather than a `Button` that appends to the path itself: it
    /// is what draws the disclosure indicator this row owes the reader, and it
    /// supplies the system's press highlight for free. A `.plain` button draws
    /// neither, so the row looked like static text even though it opened something.
    var body: some View {
        NavigationLink(value: Route.terminal(session.id)) {
            HStack(alignment: .top, spacing: 11) {
                Circle()
                    .fill(Theme.statusColor(isWaiting: session.attention.isWaiting, isRunning: session.isRunning))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(session.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(relativeTime)
                            .font(.caption2)
                            // `.secondary`, not `.tertiary`: at this size tertiary
                            // measured 2.11:1 on the light background, well under the
                            // 4.5:1 the text needs to be legible at all.
                            .foregroundStyle(.secondary)
                    }
                    Text(session.cwd)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                    if !session.lastLine.isEmpty {
                        Text(session.lastLine)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if session.attention.isWaiting {
                        Text(session.attention.kind == "approval" ? "等待确认" : "等待输入")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.attention)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            // An opaque wash, not `attention.opacity(0.12)`: the
                            // translucent version let the page show through, so the
                            // amber text sat on something close to its own colour.
                            .background(Theme.attentionFill, in: Capsule())
                            .padding(.top, 1)
                    }
                }
            }
            .padding(.vertical, 3)
        }
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
                            // The group name is the whole choice; the subtitle only
                            // restated the sheet's own title.
                            Text(group.name)
                                .font(.subheadline)
                        }
                    }
                }
                if (model.summary?.groups ?? []).isEmpty {
                    Text("电脑上还没有分组，请先在电脑端创建。")
                        .font(.footnote)
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
