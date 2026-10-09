import SwiftUI

/// 通知页。它是底栏的一个顶层分区。
///
/// 每条通知整行只提供一个打开动作：有目标的行直接去目标，无目标的行打开 Markdown 正文。
struct NotificationView: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var openedWebLink: WebLink?
    @State private var readingNotification: SynapseNotification?
    @State private var readingFromDeepLink = false
    @Binding private var notificationToRead: SynapseNotification?
    @Binding private var filter: String
    private let refreshRequest: UUID
    private let onOpenExternal: ((URL) -> Void)?

    private struct LoadRequest: Equatable {
        let filter: String
        let refreshRequest: UUID
    }

    /// 「待处理」段里的行打开一个终端会话。
    let onOpenTerminal: (String) -> Void

    init(
        initialNotification: SynapseNotification? = nil,
        onOpenTerminal: @escaping (String) -> Void,
        refreshRequest: UUID = UUID()
    ) {
        self.onOpenTerminal = onOpenTerminal
        self.onOpenExternal = nil
        self.refreshRequest = refreshRequest
        _notificationToRead = .constant(initialNotification)
        _filter = .constant("pending")
        _readingNotification = State(initialValue: initialNotification)
        _readingFromDeepLink = State(initialValue: initialNotification != nil)
    }

    init(
        notificationToRead: Binding<SynapseNotification?>,
        onOpenTerminal: @escaping (String) -> Void,
        onOpenExternal: @escaping (URL) -> Void,
        filter: Binding<String>,
        refreshRequest: UUID = UUID()
    ) {
        self.onOpenTerminal = onOpenTerminal
        self.onOpenExternal = onOpenExternal
        self.refreshRequest = refreshRequest
        _notificationToRead = notificationToRead
        _filter = filter
        _readingNotification = State(initialValue: notificationToRead.wrappedValue)
        _readingFromDeepLink = State(initialValue: notificationToRead.wrappedValue != nil)
    }

    init(
        readingNotification: Binding<SynapseNotification?>,
        onOpenTerminal: @escaping (String) -> Void,
        onOpenExternal: @escaping (URL) -> Void,
        filter: Binding<String>,
        refreshRequest: UUID = UUID()
    ) {
        self.init(
            notificationToRead: readingNotification,
            onOpenTerminal: onOpenTerminal,
            onOpenExternal: onOpenExternal,
            filter: filter,
            refreshRequest: refreshRequest
        )
    }

    var body: some View {
        NavigationStack {
            InboxView(
                onOpenTerminal: openTerminal,
                onOpen: open,
                filter: $filter
            )
            .navigationTitle("通知")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: Binding(
                get: { readingNotification != nil },
                set: {
                    if !$0 {
                        readingNotification = nil
                        readingFromDeepLink = false
                        notificationToRead = nil
                    }
                }
            )) {
                if let item = readingNotification {
                    NotificationFullTextView(item: item)
                }
            }
        }
        .onChange(of: notificationToRead?.id) { _, _ in
            if let notificationToRead {
                readingNotification = notificationToRead
                readingFromDeepLink = true
            } else if readingFromDeepLink {
                readingNotification = nil
                readingFromDeepLink = false
            }
        }
        .task(id: LoadRequest(filter: filter, refreshRequest: refreshRequest)) {
            guard filter != "pending" else { return }
            await model.reloadNotifications(filter: filter)
        }
        .noticeOverlay(model)
        .fullScreenCover(item: $openedWebLink) { target in
            LinkBrowser(url: target.url) {
                openedWebLink = nil
            }
        }
    }

    /// 点一条通知：先标已读，再按它自己的去向往外走。
    ///
    private func open(_ item: SynapseNotification) {
        Task { await model.readNotification(item.id) }
        notificationToRead = nil
        switch NotificationDestination.resolve(item) {
        case .route(let destination):
            NotificationRouter.shared.route(to: destination)
        case .externalURL(let url):
            if let onOpenExternal {
                onOpenExternal(url)
            } else if SynapseWebLink.isTrusted(url) {
                openedWebLink = WebLink(url: url)
            } else {
                openURL(url)
            }
        case .none:
            readingFromDeepLink = false
            readingNotification = item
        }
    }

    private func openTerminal(_ sessionId: String) {
        onOpenTerminal(sessionId)
    }
}

private struct NotificationFullTextView: View {
    let item: SynapseNotification

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(NotificationText.displayTitle(item)).font(.title2).fontWeight(.semibold)
                Text(NotificationText.detailMeta(item))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                MarkdownContent(item.body)
            }
            .padding()
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
    }
}
