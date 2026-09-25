import SwiftUI

/// 主页里可以推入的东西。
///
/// 只有一项，而且**应该一直很少**：功能清单上的每一项都推一屏出去，主页本身
/// 就退化成了目录套目录。见 `docs/agents/mobile-adaptive-layout.md`。
enum HomeRoute: Hashable {
    case meetings
}

/// 主页。
///
/// 底栏的第一个位置，也是**功能的唯一入口**：底栏不再为单个功能开格子，新增能力一律
/// 进这一页的清单。这条是硬规则，写在 `docs/agents/mobile-adaptive-layout.md` 里。
///
/// 这一页还承担两件不属于任何业务的事：
/// - **通知**：右上角常驻铃铛，点开是通知面板。它不占底栏位置，因为它是覆盖层而不是
///   目的地 —— 点一条就直接去往目标，比「进一个 tab、找到那一条、再跳」少两步。
/// - **待处理**：真有会话卡住时才出现的一张卡。没有内容就不占位置，数据与终端会话行上的
///   琥珀徽章同源，不引第二套状态。
struct HomeView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display

    @Binding var path: [HomeRoute]
    @Binding var meetingSelection: String?
    /// 打开一个终端。主页的待处理卡走这条。
    let onOpenTerminal: (String) -> Void
    /// 打开一个**手机刚让电脑建出来**的终端。功能清单里的「新建会话」走这条。
    let onOpenCreated: (String) -> Void
    /// 打开通知面板。面板由根视图承载：「我的 → 通知」要打开的是同一个。
    let onOpenNotifications: () -> Void

    @State private var showingNewSession = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let session = model.waitingSessions.first {
                    Section {
                        pendingCard(session, count: model.waitingSessions.count)
                    }
                }

                Section("功能") {
                    Button {
                        Haptics.select()
                        path.append(.meetings)
                    } label: {
                        featureLabel(symbol: "waveform", title: "录音")
                    }

                    Button {
                        Haptics.select()
                        showingNewSession = true
                    } label: {
                        featureLabel(symbol: "plus", title: "新建会话")
                    }
                    // 和终端那一页的加号同一个判据：没有电脑在下边，这张表单打开的是
                    // 一份已经不在了的清单，它建出来的东西也会被一台没听说过它的电脑拒绝。
                    .disabled(model.selectedDesktopClientInstanceId == nil || model.viewedDesktopIsOffline)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("主页")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { bellButton }
            }
            .navigationDestination(for: HomeRoute.self) { route in
                switch route {
                case .meetings: meetings
                }
            }
            .noticeOverlay(model)
        }
        .sheet(isPresented: $showingNewSession) {
            newSessionSheet
        }
    }

    /// 通知的入口。
    ///
    /// 常驻，没有未读也画 —— 它是这一屏的一个固定位置，不是「有消息时才出现的东西」。
    /// 未读角标用 `Theme.attention`：全应用只有这一个「有人需要你」的颜色，
    /// 会话行上的「等待输入」和这里是同一件事的两种呈现。
    private var bellButton: some View {
        Button {
            Haptics.select()
            onOpenNotifications()
        } label: {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if model.notifications.unreadCount > 0 {
                        unreadBadge
                    }
                }
        }
        .accessibilityLabel("通知")
        .accessibilityValue(
            model.notifications.unreadCount > 0 ? "\(model.notifications.unreadCount) 条未读" : "没有未读"
        )
        .accessibilityIdentifier("home-notifications")
    }

    private var unreadBadge: some View {
        Text(badgeText)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.paper)
            .padding(.horizontal, 4.5)
            .padding(.vertical, 1)
            .background(Theme.attention, in: Capsule())
            // 压在铃铛本体的右上方：铃铛画在导航栏那一条里，角标要探出去一点才不遮住它。
            .offset(x: 9, y: -7)
            .accessibilityHidden(true)
    }

    /// 超过两位数就不再涨了 —— 角标是「有多少事」的信号，不是计数器，而三位数会把
    /// 铃铛整个盖住。
    private var badgeText: String {
        let count = model.notifications.unreadCount
        return count > 99 ? "99+" : "\(count)"
    }

    /// 待处理卡。
    ///
    /// 只有真有会话卡住时才在，而且点它就进那一屏 —— 这一行存在的全部意义是
    /// 「有人需要你，从这里去」，所以它读的是实时会话列表，不是消息记录。
    private func pendingCard(_ session: MobileSummarySession, count: Int) -> some View {
        Button {
            Haptics.select()
            onOpenTerminal(session.id)
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(Theme.attention)
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(count == 1 ? "1 个会话在等你" : "\(count) 个会话在等你")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.attention)
                    Text(session.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home-pending")
    }

    /// 功能清单里的一行。
    ///
    /// 箭头自己画：这一页的行有的是 `Button`（打开一张表），有的是推入下一屏，而系统只为
    /// 后者画箭头 —— 混在一起会长出两种形状的行。
    private func featureLabel(symbol: String, title: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .frame(width: 24)
            Text(title)
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    /// 录音列表与详情。
    ///
    /// 直接复用终端和录音两层本来就在用的那一套：宽窗并排、紧凑窗下钻，录音详情不新写。
    /// 主页这一层是 `NavigationStack`，再往里那层列表详情仍归 `AdaptiveFeatureNavigation`
    /// —— iPad 上**不要**为了这一屏再叠一个 `NavigationSplitView`。
    private var meetings: some View {
        AdaptiveFeatureNavigation(
            selection: $meetingSelection,
            emptyTitle: "选择录音",
            emptySymbol: "waveform"
        ) {
            MeetingListView(selection: $meetingSelection)
        } detail: { meetingId in
            MeetingDetailView(meetingId: meetingId) { meetingSelection = nil }
        }
    }

    private var newSessionSheet: some View {
        NewSessionSheet(
            onCreated: { groupId in
                Task {
                    if let created = await model.createSession(groupId: groupId) {
                        openNewlyCreated(created)
                    }
                }
            },
            onCommandLaunched: { groupId, commandId in
                Task {
                    if let created = await model.launchCommand(groupId: groupId, commandId: commandId) {
                        openNewlyCreated(created)
                    }
                }
            },
            onConversationStarted: { sessionId in
                openNewlyCreated(sessionId)
            }
        )
    }

    /// 落在一个刚刚建出来的终端上。
    ///
    /// 与终端那一页同一个姿势：这条终端是**照着这部手机的形状生出来的**，所以手机按自己
    /// 量到的格数显示它。见 `SessionListView.openNewlyCreated`。
    private func openNewlyCreated(_ sessionId: String) {
        display.setMode(.phoneDriven, for: sessionId)
        onOpenCreated(sessionId)
    }
}
