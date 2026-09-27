import SwiftUI

struct MailView: View {
    @Environment(SynapseAppModel.self) private var model
    @Binding var selection: String?
    let onExit: () -> Void

    @State private var store = MailStore()
    @State private var search = ""
    @State private var compose: MailComposeStart?

    var body: some View {
        AdaptiveFeatureNavigation(selection: $selection, emptyTitle: "选择信件", emptySymbol: "envelope") {
            List(selection: $selection) {
                Section {
                    ForEach(MailStore.Box.allCases) { box in
                        Button {
                            store.box = box
                            selection = nil
                            store.detail = nil
                            Task { await store.load(using: model) }
                        } label: {
                            Label(box.title, systemImage: symbol(for: box))
                                .fontWeight(store.box == box ? .semibold : .regular)
                        }
                    }
                }

                Section(store.box.title) {
                    if let error = store.error { Text(error).foregroundStyle(.red) }
                    if store.loading && store.messages.isEmpty && store.drafts.isEmpty { ProgressView() }
                    if store.box == .drafts {
                        ForEach(store.drafts) { draft in
                            Button { compose = MailComposeStart(draft: draft) } label: {
                                VStack(alignment: .leading) {
                                    Text(draft.subject.isEmpty ? "无主题" : draft.subject).font(.headline)
                                    Text(draft.body).lineLimit(1).foregroundStyle(.secondary)
                                }
                            }
                            .swipeActions { Button("删除", role: .destructive) { Task { await deleteDraft(draft) } } }
                        }
                    } else {
                        ForEach(store.messages) { message in
                            NavigationLink(value: message.messageId) {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(store.box == .inbox ? message.sender.name : message.recipients.map(\.name).joined(separator: "、"))
                                            .fontWeight(message.readAt == nil ? .semibold : .regular)
                                        Spacer()
                                        Text(message.sentAt.prefix(10)).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text(message.subject).font(.subheadline)
                                    Text(message.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .tag(message.messageId)
                            .onAppear {
                                if store.messages.last?.messageId == message.messageId { Task { await store.loadMore(using: model, query: search) } }
                            }
                        }
                    }
                    if !store.loading && store.box == .drafts && store.drafts.isEmpty { ContentUnavailableView("没有草稿", systemImage: "square.and.pencil") }
                    if !store.loading && store.box != .drafts && store.messages.isEmpty { ContentUnavailableView("没有信件", systemImage: "envelope") }
                }
            }
            .navigationTitle("站内信")
            .searchable(text: $search, prompt: "搜索主题或正文")
            .refreshable { await store.load(using: model, query: search) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("主页", systemImage: "chevron.left", action: onExit).labelStyle(.iconOnly) }
                ToolbarItem(placement: .topBarTrailing) { Button("写信", systemImage: "square.and.pencil") { compose = MailComposeStart() }.labelStyle(.iconOnly) }
            }
        } detail: { id in
            MailDetailView(messageId: id, message: store.detail, error: store.error, onReply: reply, onRead: { read in Task { await store.setRead(id: id, read: read, using: model); await store.open(id: id, using: model) } }, onDelete: { selection = nil; Task { await store.delete(id: id, using: model) } })
                .task(id: id) { await store.open(id: id, using: model) }
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
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await store.load(using: model, query: search)
        }
        .sheet(item: $compose) { start in
            MailComposeView(start: start) { Task { await store.load(using: model, query: search) } }
        }
    }

    private func symbol(for box: MailStore.Box) -> String {
        switch box { case .inbox: "tray"; case .sent: "paperplane"; case .drafts: "doc" }
    }

    private func reply(_ kind: MailDetailView.ReplyKind, _ message: MailMessage) {
        let ids: [String]
        switch kind {
        case .reply:
            ids = message.sender.userId == message.viewerId ? message.recipients.map(\.userId) : [message.sender.userId]
        case .replyAll:
            ids = [message.sender.userId] + message.recipients.map(\.userId)
        case .forward:
            ids = []
        }
        var seen = Set<String>()
        let recipientIds = ids.filter { $0 != message.viewerId && seen.insert($0).inserted }
        compose = MailComposeStart(recipientIds: recipientIds, subject: kind == .forward ? "转发：\(message.subject)" : "回复：\(message.subject)", body: kind == .forward ? "\n\n\(message.body)" : "", replyToId: message.messageId)
    }

    private func deleteDraft(_ draft: MailDraft) async {
        do { try await model.mailDeleteDraft(id: draft.draftId); await store.load(using: model) }
        catch { store.error = error.localizedDescription }
    }
}

private struct MailDetailView: View {
    enum ReplyKind { case reply, replyAll, forward }
    @Environment(SynapseAppModel.self) private var model
    let messageId: String
    let message: MailMessage?
    let error: String?
    let onReply: (ReplyKind, MailMessage) -> Void
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
                        Text("\(message.sender.name) → \(message.recipients.map(\.name).joined(separator: "、"))").font(.subheadline)
                        Text(message.sentAt).font(.caption).foregroundStyle(.secondary)
                        Text(message.body).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top)
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
