import SwiftUI
import QuickLook

@MainActor
private enum MailDateFormatters {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    static let standard = ISO8601DateFormatter()
}

@MainActor
func mailDate(_ value: String) -> String {
    guard let date = MailDateFormatters.fractional.date(from: value)
        ?? MailDateFormatters.standard.date(from: value) else { return value }
    return date.formatted(date: .abbreviated, time: .shortened)
}

struct MailBulkSelection: Equatable {
    private(set) var isActive = false
    private(set) var ids: Set<String> = []

    mutating func begin() { isActive = true }
    mutating func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) }
        else { ids.insert(id) }
    }
    mutating func reset() { isActive = false; ids.removeAll() }
    mutating func finishDeletion(success: Bool) { if success { reset() } }
}

enum MailDeleteScope: Equatable {
    case selected([String])
    case all(String)

    private var boxTitle: String {
        guard case .all(let box) = self else { return "" }
        return box == "inbox" ? "收件箱" : "已发送"
    }
    var title: String {
        switch self {
        case .selected(let ids): "删除选中的 \(ids.count) 封信件？"
        case .all: "清空\(boxTitle)？"
        }
    }
    var explanation: String {
        switch self {
        case .selected: "只从你的信箱隐藏选中的信件。"
        case .all: "将清空整个\(boxTitle)，包括搜索结果和未加载的信件。"
        }
    }
}

struct MailView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var selection: String?
    let onExit: () -> Void

    @State private var store = MailStore()
    @State private var search = ""
    @State private var compose: MailComposeStart?
    @State private var bulkSelection = MailBulkSelection()
    @State private var pendingDelete: MailDeleteScope?

    var body: some View {
        AdaptiveFeatureNavigation(selection: $selection, emptyTitle: "选择信件", emptySymbol: "envelope") {
            List(selection: $selection) {
                Section {
                    ForEach(MailStore.Box.allCases) { box in
                        Button {
                            store.box = box
                            store.unreadOnly = false
                            bulkSelection.reset()
                            selection = nil
                            store.detail = nil
                            Task { await store.load(using: model, query: search) }
                        } label: {
                            Label(box.title, systemImage: symbol(for: box))
                                .fontWeight(store.box == box ? .semibold : .regular)
                        }
                    }
                }

                Section(store.box.title) {
                    if let error = store.error { Text(error).foregroundStyle(Theme.failure) }
                    if store.loading && store.messages.isEmpty { ProgressView() }
                    ForEach(store.messages) { message in
                        Group {
                            if bulkSelection.isActive {
                                Button {
                                    bulkSelection.toggle(message.messageId)
                                } label: {
                                    HStack {
                                        Image(systemName: bulkSelection.ids.contains(message.messageId) ? "checkmark.circle.fill" : "circle")
                                        messageRow(message)
                                    }
                                }
                                .accessibilityAddTraits(bulkSelection.ids.contains(message.messageId) ? [.isSelected] : [])
                            } else {
                                NavigationLink(value: message.messageId) { messageRow(message) }
                                    .tag(message.messageId)
                            }
                        }
                        .onAppear {
                            if store.messages.last?.messageId == message.messageId { Task { await store.loadMore(using: model, query: search) } }
                        }
                    }
                    if store.nextCursor != nil {
                        Button {
                            Task { await store.loadMore(using: model, query: search) }
                        } label: {
                            if store.loading { ProgressView("加载中") }
                            else { Text("加载更多") }
                        }
                        .disabled(store.loading)
                    }
                    if !store.loading && store.messages.isEmpty { ContentUnavailableView("没有信件", systemImage: "envelope") }
                }
            }
            .navigationTitle("站内信")
            .searchable(text: $search, prompt: "搜索主题或正文")
            .refreshable { await store.load(using: model, query: search) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("主页", systemImage: "chevron.left", action: onExit).labelStyle(.iconOnly) }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if bulkSelection.isActive {
                        Button("删除选中（\(bulkSelection.ids.count)）", role: .destructive) { pendingDelete = .selected(Array(bulkSelection.ids)) }.disabled(bulkSelection.ids.isEmpty)
                        Button("完成") { bulkSelection.reset() }
                    } else {
                        Menu {
                            Button("选择信件", systemImage: "checkmark.circle") { bulkSelection.begin(); selection = nil }
                            if store.box == .inbox {
                                Button(store.unreadOnly ? "显示全部" : "只看未读") { store.unreadOnly.toggle(); bulkSelection.reset(); Task { await store.load(using: model, query: search) } }
                                Button("全部设已读") { Task { await store.readAll(using: model) } }.disabled(store.counts?.unread == 0)
                            }
                            Button("清空\(store.box.title)", systemImage: "trash", role: .destructive) { pendingDelete = .all(store.box.rawValue) }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("信箱操作")
                        Button("写信", systemImage: "square.and.pencil") { compose = MailComposeStart() }.labelStyle(.iconOnly)
                    }
                }
            }
        } detail: { id in
            MailDetailView(messageId: id, message: store.detail, context: store.context, hasMoreContext: store.nextContextCursor != nil, contextError: store.contextError, loadingContext: store.loadingContext, error: store.error, onReply: reply, onOpenContext: { selection = $0 }, onLoadMoreContext: { Task { await store.loadMoreContext(id: id, using: model) } }, onRead: { read in Task { await store.setRead(id: id, read: read, using: model) } }, onDelete: { deleteMessage(id) })
                .task(id: id) {
                    if !(await store.open(id: id, using: model)), selection == id {
                        selection = nil
                        await store.load(using: model, query: search)
                    }
                }
        }
        .task { await store.load(using: model) }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                await store.load(using: model, query: search)
            }
        }
        .task(id: search) {
            bulkSelection.reset()
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await store.load(using: model, query: search)
        }
        .sheet(item: $compose) { start in
            MailComposeView(start: start) { Task { await store.load(using: model, query: search) } }
                .presentationDetents([.large])
        }
        .confirmationDialog(pendingDelete?.title ?? "删除信件？", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible) {
            Button("删除", role: .destructive) {
                let scope = pendingDelete
                let requestedBox = store.box
                let requestedSelection = selection
                let requestedBulkSelection = bulkSelection
                pendingDelete = nil
                Task {
                    let success: Bool
                    switch scope {
                    case .selected(let ids): success = await store.deleteBatch(ids: ids, using: model)
                    case .all(let box): success = await store.deleteAll(box: box, using: model)
                    case nil: return
                    }
                    guard store.box == requestedBox else { return }
                    if bulkSelection == requestedBulkSelection { bulkSelection.finishDeletion(success: success) }
                    guard success, selection == requestedSelection, store.detail == nil, let requestedSelection else { return }
                    switch scope {
                    case .selected(let ids) where ids.contains(requestedSelection): selection = nil
                    case .all: selection = nil
                    default: break
                    }
                }
            }
        } message: {
            Text(pendingDelete?.explanation ?? "")
        }
    }

    private func deleteMessage(_ id: String) {
        Task {
            guard await store.delete(id: id, using: model), selection == id else { return }
            selection = nil
        }
    }

    private func messageRow(_ message: MailSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(store.box == .inbox ? message.sender.name : (message.toAddresses?.map(\.name).joined(separator: "、") ?? message.toRecipients.map(\.name).joined(separator: "、")))
                    .fontWeight(message.readAt == nil ? .semibold : .regular)
                Spacer()
                Text(mailDate(message.sentAt)).font(.caption).foregroundStyle(.secondary)
            }
            Text(message.subject).font(.subheadline)
            if let kind = message.relationKind { Text(kind == "forward" ? "转发" : "回复").font(.caption2).foregroundStyle(.secondary) }
            MarkdownContent(message.snippet, mode: .preview(lines: 1))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func symbol(for box: MailStore.Box) -> String {
        switch box { case .inbox: "tray"; case .sent: "paperplane" }
    }

    private func reply(_ kind: MailDetailView.ReplyKind, _ message: MailMessage) {
        guard message.kind != "platform_broadcast" else { return }
        let ids: [String]
        switch kind {
        case .reply:
            ids = message.sender.userId == message.viewerId ? message.toRecipients.map(\.userId) : [message.sender.userId]
        case .forward:
            ids = []
        }
        var seen = Set<String>()
        let toIds = ids.filter { $0 != message.viewerId && seen.insert($0).inserted }
        let ccIds: [String] = []
        compose = MailComposeStart(toIds: toIds, ccIds: ccIds, subject: kind == .forward ? "转发：\(message.subject)" : "回复：\(message.subject)", relation: MailRelation(kind: kind == .forward ? "forward" : "reply", messageId: message.messageId), source: message)
    }
}

private struct MailDetailView: View {
    enum ReplyKind { case reply, forward }
    @Environment(SynapseAppModel.self) private var model
    let messageId: String
    let message: MailMessage?
    let context: [MailSummary]
    let hasMoreContext: Bool
    let contextError: String?
    let loadingContext: Bool
    let error: String?
    let onReply: (ReplyKind, MailMessage) -> Void
    let onOpenContext: (String) -> Void
    let onLoadMoreContext: () -> Void
    let onRead: (Bool) -> Void
    let onDelete: () -> Void
    @State private var attachmentStore = MailAttachmentStore()

    var body: some View {
        Group {
            if let message, message.messageId == messageId {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if let error { Text(error).foregroundStyle(Theme.failure) }
                        Text(message.subject).font(.title2).fontWeight(.semibold)
                        if let kind = message.relationKind { Text(kind == "forward" ? "转发" : "回复").font(.caption).foregroundStyle(.secondary) }
                        Text("发件人：\(message.sender.name)").font(.subheadline)
                        Text("收件人：\(message.toAddresses?.map(\.name).joined(separator: "、") ?? message.toRecipients.map(\.name).joined(separator: "、"))").font(.subheadline)
                        if !(message.ccAddresses?.isEmpty ?? message.ccRecipients.isEmpty) { Text("抄送：\(message.ccAddresses?.map(\.name).joined(separator: "、") ?? message.ccRecipients.map(\.name).joined(separator: "、"))").font(.subheadline) }
                        Text(mailDate(message.sentAt)).font(.caption).foregroundStyle(.secondary)
                        MarkdownContent(message.body).padding(.top)
                        if let quote = message.quote {
                            DisclosureGroup(message.relationKind == "forward" ? "转发原文" : "回复原文") {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("发件人：\(quote.sender.name)")
                                    Text("收件人：\(quote.toAddresses?.map(\.name).joined(separator: "、") ?? quote.toRecipients.map(\.name).joined(separator: "、"))")
                                    if !(quote.ccAddresses?.isEmpty ?? quote.ccRecipients.isEmpty) { Text("抄送：\(quote.ccAddresses?.map(\.name).joined(separator: "、") ?? quote.ccRecipients.map(\.name).joined(separator: "、"))") }
                                    Text("时间：\(mailDate(quote.sentAt))")
                                    Text("主题：\(quote.subject)")
                                    MarkdownContent(quote.body)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        if !message.attachments.isEmpty {
                            Divider()
                            Text("附件").font(.headline)
                            ForEach(message.attachments) { attachment in
                                HStack {
                                    Button {
                                        Task { await attachmentStore.open(attachment, messageId: messageId, using: model) }
                                    } label: {
                                        Label(attachment.fileName, systemImage: "paperclip")
                                            .frame(minHeight: Metrics.minimumTapTarget, alignment: .leading)
                                    }
                                    .disabled(attachmentStore.loading.contains(attachment.id))
                                    .accessibilityHint("打开附件")
                                    Spacer()
                                    if attachmentStore.loading.contains(attachment.id) {
                                        ProgressView().accessibilityLabel("正在下载 \(attachment.fileName)")
                                    } else if let url = attachmentStore.downloaded[attachment.id] {
                                        ShareLink(item: url) {
                                            Image(systemName: "square.and.arrow.up")
                                                .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                                        }
                                        .accessibilityLabel("分享 \(attachment.fileName)")
                                    }
                                }
                            }
                        }
                        if let error = attachmentStore.error { Text(error).foregroundStyle(Theme.failure) }
                        if context.count > 1 || hasMoreContext || contextError != nil {
                            Divider()
                            Text("关联往来").font(.headline)
                            if let contextError { Text(contextError).foregroundStyle(Theme.failure) }
                            ForEach(context.filter { $0.messageId != messageId }) { item in
                                Button { onOpenContext(item.messageId) } label: {
                                    HStack {
                                        Text("\(item.sender.name) · \(item.subject)").lineLimit(1)
                                        Spacer()
                                        Text(mailDate(item.sentAt)).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            if hasMoreContext { Button("加载更早往来", action: onLoadMoreContext).disabled(loadingContext) }
                        }
                    }
                    .padding()
                    .frame(maxWidth: 720, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .navigationTitle("信件")
                .toolbar {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Menu {
                            if message.kind != "platform_broadcast" {
                                Button("回复", systemImage: "arrowshape.turn.up.left") { onReply(.reply, message) }
                                Button("转发", systemImage: "arrowshape.turn.up.right") { onReply(.forward, message) }
                            }
                            if message.sender.userId != message.viewerId { Button(message.readAt == nil ? "设为已读" : "设为未读") { onRead(message.readAt == nil) } }
                            Button("删除", systemImage: "trash", role: .destructive, action: onDelete)
                        } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("信件操作")
                    }
                }
            } else if let error { ContentUnavailableView(error, systemImage: "exclamationmark.triangle") }
            else { ProgressView() }
        }
        .task(id: messageId) { attachmentStore.reset(for: messageId) }
        .quickLookPreview(Binding(
            get: { attachmentStore.previewURL },
            set: { if $0 == nil { attachmentStore.dismissPreview() } }
        ))
    }
}
