import SwiftUI

/// 通知页。
///
/// 点一条通知就按它自己的目标去（会话、录音、外链），正文摘要进到行里，全文由通知页的
/// 导航栈呈现。
///
/// 筛选栏是列表里**自己一段**：这一行清了底色，于是它不成卡片，只在页面底色上占一条
/// 带子，和下面那张卡片之间只隔着这条带子自己的下边距。分段控件切换的是这一屏的**子视图**
/// （HIG：closely related subviews），它和它切换的内容在视觉上必须看得出是两件事。
///
/// 它一度是列表让出来的顶边安全区（`.safeAreaInset(edge: .top)`）。带子是钉住了，代价
/// 是这一屏的**大标题跟着没了**：导航栏照旧给标题留着那一段高度，标题却一个字都不画，
/// 左上角整片空白。顶在滚动视图上的那条 inset 被系统算进了滚动距离，大标题按「已经滚
/// 上去了」淡到全透明，而栏本身还没到该收起的阈值，于是连内联标题也不出现。终端和录音
/// 那两屏没有这条带子，标题都好好的——标题比钉住重要，带子回到列表里。
struct InboxView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// 「待处理」段里的行打开一个终端会话。那一段读的不是通知记录，是实时会话列表。
    let onOpenTerminal: (String) -> Void
    /// 一条通知被点了。去向由调用方决定 —— 列表自己不做路由。
    let onOpen: (SynapseNotification) -> Void
    @Binding var filter: String
    @State private var confirmingClear = false

    var body: some View {
        List {
            // 筛选带子自己占一段。
            //
            // 它不能排在消息那一段里。`insetGrouped` 的卡片背景是**逐行**画的：一段的
            // 第一行承载上面两个圆角、最后一行承载下面两个圆角，中间行是直角。而这一
            // 行的底色是清的——它占着第一行的位置却不画背景，顶部圆角就没有承载它的
            // 行，紧跟着的第一条消息算「中间行」，卡片顶上于是是一条直角边，看上去像
            // 被截断。
            //
            // 相邻两段都设为 0：只设在这一段时，下一段仍会贡献一半默认间距。
            Section {
                filterBar
            }
            .listSectionSpacing(.custom(0))

            if filter != "pending", let error = model.notifications.error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
                .listSectionSpacing(.custom(0))
            }

            if filter == "pending" {
                Section {
                    ForEach(model.waitingSessions) { session in
                        Button {
                            onOpenTerminal(session.id)
                        } label: {
                            HStack {
                                WaitingSessionRow(session: session)
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    if let desktopId = model.selectedDesktopClientInstanceId {
                        Text("当前电脑 · \(model.desktopName(desktopId))")
                    }
                }
                .listSectionSpacing(.custom(0))
            } else if model.notifications.filter == filter {
                ForEach(NotificationText.dayGroups(visibleItems)) { group in
                    Section(group.title) {
                        ForEach(group.items) { item in
                            notificationRow(item)
                        }
                    }
                    .listSectionSpacing(.custom(0))
                }
            }

            emptyState
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            // 「加载更多」自己占一段。留在消息那一段里的话，它清掉底色会在卡片上戳出
            // 一个洞——最后一行下面的圆角是画在这一行身上的，而这一行是透明的。
            if filter != "pending", model.notifications.filter == filter,
               model.notifications.nextCursor != nil {
                Section { loadMoreRow }
            }
        }
        .listStyle(.insetGrouped)
        .contentMargins(.top, 0, for: .scrollContent)
        .refreshable {
            if filter == "pending" { await model.refreshDesktops() }
            else { await model.reloadNotifications(filter: filter) }
        }
        // 标题由独立通知页宿主提供，这一屏只负责列表内容。
        .toolbar {
            if filter != "pending" {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("将所有通知标为已读") { Task { await model.readAllNotifications() } }
                            .disabled(model.notifications.unreadCount == 0)
                        if filter == "all" {
                            Button("清空全部通知", role: .destructive) { confirmingClear = true }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .accessibilityLabel("通知操作")
                    }
                }
            }
        }
        .confirmationDialog("清空所有通知？", isPresented: $confirmingClear, titleVisibility: .visible) {
            Button("全部清空", role: .destructive) { Task { await model.deleteAllNotifications() } }
        }
        .onChange(of: filter) { _, selected in
            guard selected != "pending" else { return }
            Task { await model.reloadNotifications(filter: selected) }
        }
        .noticeOverlay(model)
    }

    /// 分段控件占列表的一行，行的底色清掉。这一行必须**自己占一段**：排在消息那一段
    /// 里的话它就是那一段的第一行，而第一行的职责是给卡片画上面两个圆角，底色一清，
    /// 圆角就没有承载它的行，卡片顶上会是一条直角边。
    ///
    /// 清了底色它就不是卡片，只是一条页面底色的带子；左右不另留边距，控件因此和下面
    /// 那张卡片同宽。上下各 8 是这条带子自己的留白，也是它和卡片之间全部的间距。行下
    /// 的那条分隔线也去掉：带子不是一条内容行，不该在结尾处横一道。
    private var filterBar: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                Menu {
                    filterOption("待处理", value: "pending")
                    filterOption("全部通知", value: "all")
                    filterOption("未读通知", value: "unread")
                } label: {
                    HStack {
                        Text(filterTitle)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityLabel("筛选：\(filterTitle)")
            } else {
                filterPicker.pickerStyle(.segmented)
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private var filterPicker: some View {
        Picker("筛选", selection: $filter) {
            Text("待处理").tag("pending")
            Text("全部通知").tag("all")
            Text("未读通知").tag("unread")
        }
    }

    private func filterOption(_ title: String, value: String) -> some View {
        Button { filter = value } label: {
            if filter == value {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private var filterTitle: String {
        switch filter {
        case "all": "全部通知"
        case "unread": "未读通知"
        default: "待处理"
        }
    }

    /// 分页由服务端按筛选条件返回；这一层让刚标记已读的行立即从未读列表消失，
    /// 并在切换筛选的请求完成前隐藏上一档的记录。
    private var visibleItems: [SynapseNotification] {
        guard model.notifications.filter == filter else { return [] }
        guard filter == "unread" else { return model.notifications.items }
        return model.notifications.items.filter { $0.readAt == nil }
    }

    private func notificationRow(_ item: SynapseNotification) -> some View {
        Button {
            onOpen(item)
        } label: {
            NotificationRow(item: item, desktopName: notificationDesktopName(item))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(NotificationDestination.actionLabel(for: item))
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Haptics.warning()
                Task { await model.deleteNotification(item.id) }
            } label: {
                Label("删除", systemImage: "trash")
            }
            // 左滑动作是全局 tint 唯一被当成**填充**用的地方：它用 tint 涂满按钮，
            // 再把图标和文字也用同一个颜色画上去。而全局 tint 是 `Color.primary`，
            // 于是白字压在黑底上——截图里那块没有颜色、圆角的黑方块。取系统红，
            // 明暗两套外观都对。终端列表和录音列表都已指定，这一处漏了。
            .tint(Color(uiColor: .systemRed))
        }
    }

    private func notificationDesktopName(_ item: SynapseNotification) -> String? {
        guard let id = item.deviceId else { return nil }
        let name = model.desktopName(id)
        return name == id ? nil : name
    }

    /// 触底之前不自动取下一页，留着这颗按钮。
    ///
    /// 居中的次要色文字，不是一条会长成整行的大按钮——它做的是「还有更多」，
    /// 不该比它上面任何一条消息更显眼。
    private var loadMoreRow: some View {
        Button {
            Task { await model.loadMoreNotifications() }
        } label: {
            Group {
                if model.notifications.loading { ProgressView("加载中") }
                else { Text("加载更多") }
            }
            .frame(maxWidth: .infinity)
        }
        .disabled(model.notifications.loading)
        .font(.subheadline)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    /// 空态和加载状态参与列表布局，避开筛选栏与当前电脑标题，并随内容滚动。
    @ViewBuilder
    private var emptyState: some View {
        if filter == "pending" {
            if model.waitingSessions.isEmpty {
                ContentUnavailableView("暂无待处理事项", systemImage: "checkmark.circle")
            }
        } else if model.notifications.error == nil && visibleItems.isEmpty {
            if model.notifications.loading || model.notifications.filter != filter {
                ProgressView()
            } else {
                ContentUnavailableView(
                    filter == "unread" ? "暂无未读通知" : "暂无通知",
                    systemImage: "bell"
                )
            }
        }
    }
}

/// 一条消息。
///
/// 标题、时刻和正文摘要承担扫读；底行交代来源、历史状态和整行点按的去向。
///
/// 时间不再单占一行。原来它是第三行，和标题、正文一起挤在 `spacing: 4` 里，三行字
/// 号各不相同又挨得极近，读起来是一团。
private struct NotificationRow: View {
    let item: SynapseNotification
    let desktopName: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var isUnread: Bool { item.readAt == nil }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // 已读也画，只画成透明的。一颗只属于未读的点会让未读行的标题比已读行
            // 往左多 16pt，于是一屏之内两种左边距。终端列表的状态点是同一个做法。
            Circle()
                .fill(Color(uiColor: .systemBlue))
                .frame(width: 8, height: 8)
                .padding(.top, 5)
                .opacity(isUnread ? 1 : 0)
                .accessibilityLabel("未读")
                .accessibilityHidden(!isUnread)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(NotificationText.displayTitle(item))
                        // 字重变、字号不变：换字号会让未读和已读的行高不一样，一屏
                        // 读下来就会跳。`.headline` 本身已经是 semibold。
                        .font(.headline.weight(isUnread ? .semibold : .regular))
                        .lineLimit(1)
                    // 外部接口发来的消息可以自带一个分组名，这是它和别的消息唯一的
                    // 区别，所以留着——但它比标题次要，标题先被截断。
                    if let group = item.group {
                        Text(group)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(NotificationText.timeOfDay(item.createdAt))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                MarkdownContent(item.body, mode: .preview(lines: 2))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 2) {
                        if let contextLabel { Text(contextLabel) }
                        Text(NotificationDestination.actionLabel(for: item))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 8) {
                        if let contextLabel {
                            Text(contextLabel).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Text(NotificationDestination.actionLabel(for: item))
                            .lineLimit(1)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var contextLabel: String? {
        let parts = [desktopName, NotificationText.status(item)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// 「待处理」里的一行。
///
/// 它是一条**会话**，不是一条消息：待处理由终端状态决定（账号消息中心设计文档：
/// 「会话不再等待时解除待处理」），所以这一屏读的是实时会话列表，而不是消息记录。
/// 行因此和终端列表里那种行是同一套，连点的颜色都一样——`Theme.attention` 是这个
/// App 里「需要一个人」的唯一颜色。
private struct WaitingSessionRow: View {
    let session: MobileSummarySession

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(Theme.attention)
                .frame(width: 8, height: 8)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(.headline)
                    .lineLimit(1)
                Text(waitingReason)
                    .font(.subheadline)
                    .foregroundStyle(Theme.attention)
                    .lineLimit(2)
            }
        }
    }

    /// 这一行为什么在「待处理」里。
    ///
    /// 「已经跑完、空闲着等你」和「真的举着一个问题等你」都是等待，但对着前一种用户
    /// 没有任何可回答的东西。写成同一句，用户点进去会发现自己被喊来看一个并没有在问什么
    /// 的终端——两种都要说清楚自己是哪一种。
    private var waitingReason: String {
        switch session.attention.kind {
        case "approval": return "请求执行一个命令"
        case "agent_idle": return "已经跑完，在等你"
        default: return "正在等待你的回答"
        }
    }
}
