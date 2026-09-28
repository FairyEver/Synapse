import SwiftUI

func mailDate(_ value: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
    return date.formatted(date: .abbreviated, time: .shortened)
}

struct MailBulkSelection {
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
                    if let error = store.error { Text(error).foregroundStyle(.red) }
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
                        Button("写信", systemImage: "square.and.pencil") { compose = MailComposeStart() }.labelStyle(.iconOnly)
                    }
                }
            }
        } detail: { id in
            MailDetailView(messageId: id, message: store.detail, context: store.context, hasMoreContext: store.nextContextCursor != nil, contextError: store.contextError, error: store.error, onReply: reply, onOpenContext: { selection = $0 }, onLoadMoreContext: { Task { await store.loadMoreContext(id: id, using: model) } }, onRead: { read in Task { await store.setRead(id: id, read: read, using: model) } }, onDelete: { selection = nil; Task { await store.delete(id: id, using: model) } })
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
                pendingDelete = nil
                Task {
                    let success: Bool
                    switch scope {
                    case .selected(let ids): success = await store.deleteBatch(ids: ids, using: model)
                    case .all(let box): success = await store.deleteAll(box: box, using: model)
                    case nil: return
                    }
                    bulkSelection.finishDeletion(success: success)
                    if success { selection = nil }
                }
            }
        } message: {
            Text(pendingDelete?.explanation ?? "")
        }
    }

    private func messageRow(_ message: MailSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(store.box == .inbox ? message.sender.name : message.recipients.map(\.name).joined(separator: "、"))
                    .fontWeight(message.readAt == nil ? .semibold : .regular)
                Spacer()
                Text(mailDate(message.sentAt)).font(.caption).foregroundStyle(.secondary)
            }
            Text(message.subject).font(.subheadline)
            if let kind = message.relationKind { Text(kind == "forward" ? "转发" : "回复").font(.caption2).foregroundStyle(.secondary) }
            Text(message.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    private func symbol(for box: MailStore.Box) -> String {
        switch box { case .inbox: "tray"; case .sent: "paperplane" }
    }

    private func reply(_ kind: MailDetailView.ReplyKind, _ message: MailMessage) {
        let ids: [String]
        switch kind {
        case .reply:
            ids = message.sender.userId == message.viewerId ? message.toRecipients.map(\.userId) : [message.sender.userId]
        case .replyAll:
            ids = [message.sender.userId] + message.toRecipients.map(\.userId)
        case .forward:
            ids = []
        }
        var seen = Set<String>()
        let toIds = ids.filter { $0 != message.viewerId && seen.insert($0).inserted }
        let ccIds = kind == .replyAll ? message.ccRecipients.map(\.userId).filter { $0 != message.viewerId && seen.insert($0).inserted } : []
        compose = MailComposeStart(toIds: toIds, ccIds: ccIds, subject: kind == .forward ? "转发：\(message.subject)" : "回复：\(message.subject)", relation: MailRelation(kind: kind == .forward ? "forward" : "reply", messageId: message.messageId), source: message)
    }
}

private struct MailDetailView: View {
    enum ReplyKind { case reply, replyAll, forward }
    @Environment(SynapseAppModel.self) private var model
    let messageId: String
    let message: MailMessage?
    let context: [MailSummary]
    let hasMoreContext: Bool
    let contextError: String?
    let error: String?
    let onReply: (ReplyKind, MailMessage) -> Void
    let onOpenContext: (String) -> Void
    let onLoadMoreContext: () -> Void
    let onRead: (Bool) -> Void
    let onDelete: () -> Void
    @State private var downloaded: [String: URL] = [:]
    @State private var downloadError: String?

    var body: some View {
        Group {
            if let message, message.messageId == messageId {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(message.subject).font(.title2).fontWeight(.semibold)
                        if let kind = message.relationKind { Text(kind == "forward" ? "转发" : "回复").font(.caption).foregroundStyle(.secondary) }
                        Text("发件人：\(message.sender.name)").font(.subheadline)
                        Text("收件人：\(message.toRecipients.map(\.name).joined(separator: "、"))").font(.subheadline)
                        if !message.ccRecipients.isEmpty { Text("抄送：\(message.ccRecipients.map(\.name).joined(separator: "、"))").font(.subheadline) }
                        Text(mailDate(message.sentAt)).font(.caption).foregroundStyle(.secondary)
                        Text(message.body).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top)
                        if let quote = message.quote {
                            DisclosureGroup(message.relationKind == "forward" ? "转发原文" : "回复原文") {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("发件人：\(quote.sender.name)")
                                    Text("收件人：\(quote.toRecipients.map(\.name).joined(separator: "、"))")
                                    if !quote.ccRecipients.isEmpty { Text("抄送：\(quote.ccRecipients.map(\.name).joined(separator: "、"))") }
                                    Text("时间：\(mailDate(quote.sentAt))")
                                    Text("主题：\(quote.subject)")
                                    Text(quote.body).textSelection(.enabled)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        if !message.attachments.isEmpty {
                            Divider()
                            Text("附件").font(.headline)
                            ForEach(message.attachments) { attachment in
                                HStack {
                                    Button(attachment.fileName, systemImage: "paperclip") { Task { await download(attachment) } }
                                    Spacer()
                                    if let url = downloaded[attachment.id] { ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("分享 \(attachment.fileName)") }
                                }
                            }
                        }
                        if let downloadError { Text(downloadError).foregroundStyle(.red) }
                        if context.count > 1 || hasMoreContext || contextError != nil {
                            Divider()
                            Text("关联往来").font(.headline)
                            if let contextError { Text(contextError).foregroundStyle(.red) }
                            ForEach(context.filter { $0.messageId != messageId }) { item in
                                Button { onOpenContext(item.messageId) } label: {
                                    HStack {
                                        Text("\(item.sender.name) · \(item.subject)").lineLimit(1)
                                        Spacer()
                                        Text(mailDate(item.sentAt)).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            if hasMoreContext { Button("加载更早往来", action: onLoadMoreContext) }
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
                            Button("回复", systemImage: "arrowshape.turn.up.left") { onReply(.reply, message) }
                            Button("回复全部", systemImage: "arrowshape.turn.up.left.2") { onReply(.replyAll, message) }
                            Button("转发", systemImage: "arrowshape.turn.up.right") { onReply(.forward, message) }
                            if message.sender.userId != message.viewerId { Button(message.readAt == nil ? "设为已读" : "设为未读") { onRead(message.readAt == nil) } }
                            Button("删除", systemImage: "trash", role: .destructive, action: onDelete)
                        } label: { Image(systemName: "ellipsis.circle") }
                    }
                }
            } else if let error { ContentUnavailableView(error, systemImage: "exclamationmark.triangle") }
            else { ProgressView() }
        }
    }

    private func download(_ attachment: MailAttachment) async {
        do { downloaded[attachment.id] = try await model.mailDownloadAttachment(messageId: messageId, attachment: attachment) }
        catch { downloadError = error.localizedDescription }
    }
}
