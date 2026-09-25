import SwiftUI

/// The session list.
///
/// Rows answer "what is this terminal doing right now" without opening anything,
/// which is the whole point of the phone: the common visit ends here, not in a
/// terminal. That is why the last output line is on the row — and why the row
/// gives it a line of its own even when it has nothing to put there.
struct SessionListView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var selection: String?
    /// 打开一个手机刚刚让电脑建出来的终端。
    ///
    /// 与 `selection` 分开，是因为它与 `selection` 是两件事：写 `selection` 是「用户挑了
    /// 哪一行」，一行一行都要先问过那道闸门（那条会话还开不开得开）；而这里的 id 是电脑刚
    /// 亲口回给我们的，它一定存在，闸门问不出任何有用的东西 —— 问出来的只有「列表还没跟上」。
    let onOpenCreated: (String) -> Void
    @State private var showingNewSession = false
    @State private var renameTarget: MobileSummarySession?
    @State private var deleteTarget: MobileSummarySession?
    /// Tabs the user has closed. Absent means open, so the default needs no state.
    @State private var collapsedTabs: Set<String> = []
    @State private var searchText = ""

    var body: some View {
        List(selection: $selection) {
            // 设备行只在真的有一台电脑时才画。它要说的是「你在看哪一台」，没有电脑
            // 的时候它无话可说，却会把下面那句「电脑不在线」再重复一遍 —— 同一屏里
            // 同一句话出现两次，读起来像是这个应用坏了。
            if !model.onlineDesktops.isEmpty {
                deviceSection
            }
            if model.connectivity == .viewedComputerOffline {
                unavailableSection
            } else if model.onlineDesktops.isEmpty {
                offlineSection
            } else if model.sessions.isEmpty {
                emptySection
            } else if isSearching, searchMatches.isEmpty {
                searchEmptySection
            } else {
                ForEach(model.summary?.groups ?? []) { group in
                    let blocks = sessionListBlocks(
                        sessions: matching(search: model.sessions(inGroup: group.id)),
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
                if !matching(search: ungroupedSessions).isEmpty {
                    Section("其它") {
                        blockRows(sessionListBlocks(
                            sessions: matching(search: ungroupedSessions),
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
        // 位置和外观都交给系统：导航栏下拉露出搜索框（`.automatic`，苹果自己的
        // 「邮件」「备忘录」就是这个行为），输入时标题自动让位，不用自己画。
        .searchable(text: $searchText, prompt: "搜索会话")
        .noticeOverlay(model)
        .navigationTitle("终端")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingNewSession = true
                } label: {
                    Image(systemName: "plus")
                }
                // Not on a computer that is not there: the sheet would open onto the
                // groups of a list that is gone, and whatever it built would be
                // refused by a computer that never heard of it.
                .disabled(model.selectedDesktopClientInstanceId == nil || model.viewedDesktopIsOffline)
                .accessibilityIdentifier("new-session")
            }
        }
        .refreshable { await model.refreshDesktops() }
        // 装配在 `NewSessionPresentation` 里：主页的功能清单打开的是同一个界面、同一套回调
        // —— 包括那个容易漏的 `setMode(.phoneDriven)`。
        .newSessionSheet(isPresented: $showingNewSession, onOpenCreated: onOpenCreated)
        .sheet(item: $renameTarget) { session in
            RenameSessionSheet(title: session.title) { newName in
                Haptics.commit()
                model.rename(session.id, to: newName)
            }
        }
        .alert("删除这个会话？", isPresented: isDeleting, presenting: deleteTarget) { session in
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                // The row it belonged to is behind the dialog, so nothing on screen
                // marks the moment the choice is made.
                Haptics.warning()
                model.delete(session.id)
                if selection == session.id { selection = nil }
            }
        } message: { _ in
            Text("会先停止会话，未完成的任务会中断。")
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
                renameTarget = session
            } label: {
                Label("重命名", systemImage: "pencil")
            }
            .tint(Color(uiColor: .systemGray))
        }
        // **这一行的选中值就是它的会话号**，显式写死。
        //
        // 不写这一条，`List(selection:)` 会退回它自己的行标识 —— 而这里那个标识是
        // `SessionListBlock.id`，一个**复合串**（`"session:<uuid>"` / `"tab:<uuid>"`，
        // 前缀是为了让「一个终端」和「一个标签页」不撞号）。于是点一次会发出**两个**
        // 打开请求：一个带着那个复合串，一个带着 `NavigationLink` 的真会话号。前者谁都不认识，
        // 判据只能答「这个会话已经结束了。」—— 而它说的是**你刚点进去的那个会话**，因为那个
        // 串就是从它身上拼出来的。手机上表现为：震一下、底部多一条红提示，然后照常进去。
        //
        // 加判据之前，同一个假串被直接拿去开终端，于是打开一个不存在的会话 —— 那正是上一轮
        // 那个「从列表点进去纯黑、从通知点进去正常」。判据把黑屏换成了一句错话，根没动。
        //
        // 对照：`InboxView` 那条列表从来不出这个问题，因为它的 `ForEach` 标识（`item.id`）与
        // 行的 `NavigationLink(value:)` 恰好是同一个值，退回也退到对的地方去。
        .tag(session.id)
    }

    /// The alert dismisses by resetting its target, so clearing it is what closes
    /// the dialog — the presenting value drives both.
    private var isDeleting: Binding<Bool> {
        Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })
    }

    private var ungroupedSessions: [MobileSummarySession] {
        let known = Set((model.summary?.groups ?? []).map(\.id))
        return model.sessions.filter { !known.contains($0.groupId) }
    }

    // MARK: - 搜索

    /// 输入框里那串字，去掉首尾空白。空串就是没在搜。
    private var searchQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearching: Bool { !searchQuery.isEmpty }

    /// 只筛会话。设备行和「电脑不在线」那几句不跟着筛——它们说的是这台手机连没连上
    /// 电脑，跟「我要找的是哪个会话」无关，被搜没了反而像是电脑掉了。
    ///
    /// 匹配标题、路径、最后一行：会话行上就这三样东西，读者看得见什么就搜得到什么。
    /// 一个标签页里只有部分窗格命中时，标签页照常画出，但只展开命中的那几个窗格——
    /// `sessionListBlocks` 本来就是按「这批会话里还有谁在」算的。
    private func matching(search sessions: [MobileSummarySession]) -> [MobileSummarySession] {
        guard isSearching else { return sessions }
        return sessions.filter { session in
            session.title.localizedCaseInsensitiveContains(searchQuery)
                || session.cwd.localizedCaseInsensitiveContains(searchQuery)
                || session.lastLine.localizedCaseInsensitiveContains(searchQuery)
        }
    }

    private var searchMatches: [MobileSummarySession] { matching(search: model.sessions) }

    /// 搜不到。标题交给系统的 `ContentUnavailableView.search` 去写（它会把这几个字
    /// 带进「找不到"xxx"」里），不自己拼一句话。
    private var searchEmptySection: some View {
        Section {
            ContentUnavailableView.search(text: searchQuery)
                .listRowBackground(Color.clear)
        }
    }

    /// The computer being viewed — and, when there is anywhere to go, the switch.
    ///
    /// A `Menu` rather than a screen: choosing between two or three computers does not
    /// deserve a navigation stack. It is only a control when there is something to
    /// switch to, so the chevron and the tap target appear exactly when they mean
    /// something — including the case they exist for, a phone left on a computer that
    /// has gone away, where the one other computer is the only way out.
    ///
    /// 剪贴板按钮本来在这一行的另一端，现在它和另外两件不绑定会话的事一起在主页的
    /// 功能清单里 —— 那一页回答的是「我能做什么」，而这一行只是「我现在在哪一台上」。
    private var deviceSection: some View {
        Section {
            HStack(spacing: 8) {
                if model.desktopSwitchTargets.isEmpty {
                    deviceIdentity
                } else {
                    Menu {
                        ForEach(model.desktopSwitchTargets) { desktop in
                            Button {
                                Haptics.select()
                                selection = nil
                                model.selectDesktop(desktop.clientInstanceId)
                            } label: {
                                Text(model.desktopName(desktop.clientInstanceId))
                            }
                            .accessibilityIdentifier("switch-computer-option-\(desktop.clientInstanceId)")
                        }
                    } label: {
                        deviceIdentity
                    }
                    .tint(.primary)
                    .accessibilityIdentifier("switch-computer")
                    .accessibilityHint("切换到其它电脑")
                }
                Spacer(minLength: 8)
                Text(model.connectivity.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Which computer is being viewed, and — when there is anywhere to go — the switch.
    private var deviceIdentity: some View {
        HStack(spacing: 8) {
            Circle()
                // Green only when a computer is actually reachable. A list that is
                // empty because it could not be fetched is not a computer that is
                // online, and the dot must not claim otherwise.
                .fill(model.connectivity == .online ? Theme.running : Color.secondary)
                .frame(width: 7, height: 7)
            // The name comes from the model rather than from `summary` alone: a
            // computer that has gone away no longer sends the list its name rode on,
            // and that is exactly when the reader most needs to know which one it was.
            Text(model.selectedDesktopClientInstanceId.map(model.desktopName) ?? "未连接电脑")
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
            if !model.desktopSwitchTargets.isEmpty {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }

    /// The computer being viewed is not reachable and at least one other is.
    ///
    /// Only the next step, with no headline: the device row directly above already
    /// says "这台电脑不在线", and saying it twice on one screen is the defect this file
    /// already warns about below.
    private var unavailableSection: some View {
        Section {
            if let guidance = model.connectivity.guidance {
                Text(guidance)
                    .font(.footnote)
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
    ///
    /// Drawn **inside** the list rather than over it, unlike the other empty states:
    /// it is not the whole screen that is empty. The computer is right there above,
    /// with its own row and its clipboard button, and a full-height empty state would
    /// paint over the one control this state still leaves the reader.
    private var emptySection: some View {
        Section {
            ContentUnavailableView("没有正在运行的会话", systemImage: "terminal")
                .listRowBackground(Color.clear)
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
        NavigationLink(value: session.id) {
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
                        Text(session.elapsedLabel)
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
                    // Drawn whether or not there is anything to say, so that every
                    // row is the same height.
                    Text(session.rowLastLine)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
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

}

extension MobileSummarySession {
    /// 这条会话已经跑了多久，粗到「多久」这一档就够。
    ///
    /// 放在这里而不是留在 `SessionRow` 里：「消息」那一屏的待处理行说的是同一件事
    /// （那是一条会话，不是一条消息），两处各写一遍的话，改了一处另一处就不会跟着改。
    var elapsedLabel: String {
        guard let started = startedAtDate else { return "" }
        let seconds = Int(Date().timeIntervalSince(started))
        if seconds < 60 { return "\(seconds) 秒" }
        if seconds < 3600 { return "\(seconds / 60) 分" }
        if seconds < 86_400 { return "\(seconds / 3600) 小时" }
        return "\(seconds / 86_400) 天"
    }

    /// The row's third line: the terminal's last readable output, or a space when
    /// it has nothing readable on screen.
    ///
    /// A space rather than an empty string: this line exists to hold its height,
    /// and a space is something to lay out where `""` is not. It is a space rather
    /// than a frame height because a fixed point value would be wrong at every
    /// Dynamic Type size but one, and it is drawn rather than skipped because a row
    /// that comes and goes by a line makes the list jump every time a summary lands.
    var rowLastLine: String {
        lastLine.isEmpty ? " " : lastLine
    }
}
