import SwiftUI

/// 消息。
///
/// 筛选栏是列表里**自己一段**：这一行清了底色，于是它不成卡片，只在页面底色上占一条
/// 带子，和下面那张卡片之间隔着这条带子自己的留白。分段控件切换的是这一屏的**子视图**
/// （HIG：closely related subviews），它和它切换的内容在视觉上必须看得出是两件事。
///
/// 它一度是列表让出来的顶边安全区（`.safeAreaInset(edge: .top)`）。带子是钉住了，代价
/// 是这一屏的**大标题跟着没了**：导航栏照旧给标题留着那一段高度，标题却一个字都不画，
/// 左上角整片空白。顶在滚动视图上的那条 inset 被系统算进了滚动距离，大标题按「已经滚
/// 上去了」淡到全透明，而栏本身还没到该收起的阈值，于是连内联标题也不出现。终端和录音
/// 那两屏没有这条带子，标题都好好的——标题比钉住重要，带子回到列表里。
struct InboxView: View {
    @Environment(SynapseAppModel.self) private var model
    @State private var filter = "pending"

    var body: some View {
        List {
            if let error = model.notifications.error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }

            // 筛选带子自己占一段。
            //
            // 它不能排在消息那一段里。`insetGrouped` 的卡片背景是**逐行**画的：一段的
            // 第一行承载上面两个圆角、最后一行承载下面两个圆角，中间行是直角。而这一
            // 行的底色是清的——它占着第一行的位置却不画背景，顶部圆角就没有承载它的
            // 行，紧跟着的第一条消息算「中间行」，卡片顶上于是是一条直角边，看上去像
            // 被截断。
            //
            // 段间距压成 0：控件和卡片之间就只剩这一行自己的下边距，和把它排在消息那
            // 一段里时的数一样。
            Section {
                filterBar
            }
            .listSectionSpacing(.custom(0))

            Section {
                if filter == "pending" {
                    ForEach(model.waitingSessions) { session in
                        NavigationLink(value: Route.terminal(session.id)) {
                            WaitingSessionRow(session: session)
                        }
                    }
                } else {
                    ForEach(visibleItems) { item in
                        notificationRow(item)
                    }
                }
            }

            // 「加载更多」自己占一段。留在消息那一段里的话，它清掉底色会在卡片上戳出
            // 一个洞——最后一行下面的圆角是画在这一行身上的，而这一行是透明的。
            if filter != "pending" && model.notifications.nextCursor != nil {
                Section { loadMoreRow }
            }
        }
        .listStyle(.insetGrouped)
        // 空态铺在列表上，铺的是 `List` 本身，不铺那条筛选带子——带子在这一屏的
        // 哪一档下都在，它不是内容，是控制。
        .overlay { emptyState }
        .refreshable {
            if filter == "pending" { await model.refreshDesktops() }
            else { await model.reloadNotifications(filter: filter) }
        }
        .navigationTitle("消息")
        .toolbar {
            if filter != "pending" {
                Button("全部已读") { Task { await model.readAllNotifications() } }
                    .disabled(model.notifications.unreadCount == 0)
            }
        }
        .onChange(of: filter) { _, selected in
            if selected != "pending" { Task { await model.reloadNotifications(filter: selected) } }
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
        Picker("筛选", selection: $filter) {
            Text("待处理").tag("pending")
            Text("全部").tag("all")
            Text("未读").tag("unread")
        }
        .pickerStyle(.segmented)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    /// 「未读」是这一屏唯一的客户端筛选。服务端也认 `filter=unread`，而列表里拿到的
    /// 这批已经可以就地筛，不必为切一个分段再问一次。
    private var visibleItems: [SynapseNotification] {
        guard filter == "unread" else { return model.notifications.items }
        return model.notifications.items.filter { $0.readAt == nil }
    }

    private func notificationRow(_ item: SynapseNotification) -> some View {
        // `NavigationLink` 而不是 `Button`：它才是系统画披露指示、给按压高亮的那一个。
        // 用 `.plain` 的按钮画不出这两样，于是开得进去的行看起来和一段静态文字一样
        // ——「待处理」那一屏用的是链接、这一屏用的是按钮，一屏之内两种表现。
        NavigationLink(value: Route.message(item.id)) {
            NotificationRow(item: item)
        }
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

    /// 触底之前不自动取下一页，留着这颗按钮。
    ///
    /// 居中的次要色文字，不是一条会长成整行的大按钮——它做的是「还有更多」，
    /// 不该比它上面任何一条消息更显眼。
    private var loadMoreRow: some View {
        Button {
            Task { await model.loadMoreNotifications() }
        } label: {
            Text("加载更多").frame(maxWidth: .infinity)
        }
        .font(.subheadline)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    /// 空态铺在列表上而不是列表里的一行：`ContentUnavailableView` 要的是整块内容区。
    /// 它铺的是 `List`，不铺那条筛选带子——带子是这一屏的控制，任何一档下都在。
    @ViewBuilder
    private var emptyState: some View {
        if filter == "pending" {
            if model.waitingSessions.isEmpty {
                ContentUnavailableView("暂无待处理事项", systemImage: "checkmark.circle")
            }
        } else if model.notifications.error == nil && visibleItems.isEmpty {
            if model.notifications.loading {
                ProgressView()
            } else {
                ContentUnavailableView(
                    filter == "unread" ? "暂无未读消息" : "暂无消息",
                    systemImage: "bell"
                )
            }
        }
    }
}

/// 一条消息。
///
/// 三样东西，按它们对读的人的重要程度分三个位置：标题说「这是什么」，时间说「什么时候」
/// 并因此落在标题那一行的末尾，正文说细节。
///
/// 时间不再单占一行。原来它是第三行，和标题、正文一起挤在 `spacing: 4` 里，三行字
/// 号各不相同又挨得极近，读起来是一团。
private struct NotificationRow: View {
    let item: SynapseNotification

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
                    Text(item.title)
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
                    Text(NotificationText.timestamp(item.createdAt))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(item.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
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
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(session.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(session.elapsedLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(session.attention.kind == "approval" ? "请求执行一个命令" : "正在等待你的回答")
                    .font(.subheadline)
                    .foregroundStyle(Theme.attention)
                    .lineLimit(2)
            }
        }
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
