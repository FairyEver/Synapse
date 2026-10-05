import SwiftUI

/// 通知面板。主页右上角那枚铃铛打开的就是它。
///
/// 有目标的行直接去目标；无目标的行和独立的「全文」操作打开 Markdown 正文。
struct NotificationPanel: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var openedWebLink: WebLink?
    @State private var readingNotification: SynapseNotification?
    @State private var selectedDetent: PresentationDetent = .medium
    private let initialNotification: SynapseNotification?

    /// 「待处理」段里的行打开一个终端会话。
    let onOpenTerminal: (String) -> Void

    init(initialNotification: SynapseNotification? = nil, onOpenTerminal: @escaping (String) -> Void) {
        self.initialNotification = initialNotification
        self.onOpenTerminal = onOpenTerminal
        _readingNotification = State(initialValue: initialNotification)
        _selectedDetent = State(initialValue: initialNotification == nil ? .medium : .large)
    }

    var body: some View {
        NavigationStack {
            InboxView(
                onOpenTerminal: openTerminal,
                onOpen: open,
                onViewContent: viewContent,
                selectedDetent: $selectedDetent
            )
            .navigationTitle("通知")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: Binding(
                get: { readingNotification != nil },
                set: { if !$0 { readingNotification = nil } }
            )) {
                if let item = readingNotification {
                    NotificationFullTextView(item: item)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("关闭")
                }
            }
        }
        .presentationDetents([.medium, .large], selection: $selectedDetent)
        .presentationDragIndicator(.visible)
        .onChange(of: initialNotification?.id) { _, _ in
            guard let initialNotification else { return }
            readingNotification = initialNotification
            selectedDetent = .large
        }
        // sheet 会盖住底层屏幕挂的那条通知覆盖层，所以这一层要自己再挂一次 ——
        // 与剪贴板 sheet 同一个做法。
        .noticeOverlay(model)
        .fullScreenCover(item: $openedWebLink) { target in
            LinkBrowser(url: target.url) {
                openedWebLink = nil
                dismiss()
            }
        }
    }

    /// 点一条通知：先标已读，再按它自己的去向往外走。
    ///
    /// 走之前就收起来。留着一个盖住目标的 sheet，等于让人再点一次「关闭」才看得见
    /// 他刚刚要求去的地方。
    private func open(_ item: SynapseNotification) {
        Task { await model.readNotification(item.id) }
        switch NotificationDestination.resolve(item) {
        case .route(let destination):
            dismiss()
            NotificationRouter.shared.route(to: destination)
        case .externalURL(let url):
            if SynapseWebLink.isTrusted(url) {
                openedWebLink = WebLink(url: url)
            } else {
                dismiss()
                openURL(url)
            }
        case .none:
            readingNotification = item
        }
    }

    private func viewContent(_ item: SynapseNotification) {
        Task { await model.readNotification(item.id) }
        readingNotification = item
    }

    private func openTerminal(_ sessionId: String) {
        dismiss()
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
