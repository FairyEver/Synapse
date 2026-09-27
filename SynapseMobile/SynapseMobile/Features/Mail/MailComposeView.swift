import SwiftUI
import UniformTypeIdentifiers

struct MailComposeStart: Identifiable {
    let id = UUID()
    var recipientIds: [String] = []
    var subject = ""
    var body = ""
    var replyToId: String?
    var draft: MailDraft?
}

struct MailComposeView: View {
    private struct PendingSend {
        let content: MailContent
        let previewId: String
        let clientRequestId: String
    }
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let start: MailComposeStart
    let onDone: () -> Void

    @State private var recipients: [MailPerson] = []
    @State private var unresolvedRecipientIds: [String] = []
    @State private var showCloseConfirmation = false
    @State private var recipientPicker = false
    @State private var subject: String
    @State private var messageBody: String
    @State private var attachments: [MailAttachment]
    @State private var draft: MailDraft?
    @State private var importing = false
    @State private var busy = false
    @State private var error: String?
    @State private var pendingSend: PendingSend?

    init(start: MailComposeStart, onDone: @escaping () -> Void) {
        self.start = start
        self.onDone = onDone
        _subject = State(initialValue: start.draft?.subject ?? start.subject)
        _messageBody = State(initialValue: start.draft?.body ?? start.body)
        _attachments = State(initialValue: start.draft?.attachments ?? [])
        _draft = State(initialValue: start.draft)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("收件人") {
                    Button(recipients.isEmpty ? "选择收件人" : "添加收件人", systemImage: "person.crop.circle.badge.plus") { recipientPicker = true }
                    ForEach(recipients) { person in
                        HStack {
                            Text(person.name)
                            if let handle = person.handle, handle != person.name { Text(handle).foregroundStyle(.secondary) }
                            Spacer()
                            Button("移除 \(person.name)", systemImage: "minus.circle") { recipients.removeAll { $0.userId == person.userId } }.labelStyle(.iconOnly)
                        }
                    }
                    if !unresolvedRecipientIds.isEmpty {
                        Text("收件人无法确认，请移除或重新搜索").foregroundStyle(.red)
                        ForEach(unresolvedRecipientIds, id: \.self) { id in
                            HStack { Text(id); Spacer(); Button("移除", systemImage: "minus.circle") { unresolvedRecipientIds.removeAll { $0 == id } }.labelStyle(.iconOnly) }
                        }
                    }
                }
                Section("主题") { TextField("主题", text: $subject) }
                Section("正文") { TextEditor(text: $messageBody).frame(minHeight: 180) }
                Section("附件") {
                    Button("选取文件", systemImage: "paperclip") { importing = true }
                    ForEach(attachments) { attachment in
                        HStack { Text(attachment.fileName); Spacer(); Button("移除", systemImage: "minus.circle") { attachments.removeAll { $0.id == attachment.id } }.labelStyle(.iconOnly) }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("写信")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { requestClose() } }
                ToolbarItem(placement: .topBarTrailing) { Button("存草稿") { Task { await saveDraft() } }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button("发送") { Task { await send() } }.disabled(busy || recipients.isEmpty || !unresolvedRecipientIds.isEmpty || subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
            .interactiveDismissDisabled()
            .confirmationDialog("保存这封草稿？", isPresented: $showCloseConfirmation, titleVisibility: .visible) {
                Button("存草稿") { Task { await saveDraft() } }
                Button("不保存", role: .destructive) { dismiss() }
                Button("继续编辑", role: .cancel) { }
            }
            .task { await restoreRecipients() }
            .sheet(isPresented: $recipientPicker) {
                MailRecipientPicker(recipients: $recipients, unresolvedRecipientIds: $unresolvedRecipientIds)
                    .presentationDetents([.large])
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { Task { await addFiles(urls) } }
                if case .failure(let failure) = result { error = failure.localizedDescription }
            }
        }
    }

    private func content(includeReply: Bool = true) -> MailContent {
        MailContent(recipientIds: recipients.map(\.userId) + unresolvedRecipientIds, subject: subject, body: messageBody, attachmentIds: attachments.map(\.attachmentId), replyToId: includeReply ? (start.replyToId ?? start.draft?.replyToId) : nil)
    }

    private func requestClose() {
        if busy { return }
        if !recipients.isEmpty || !unresolvedRecipientIds.isEmpty || !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty {
            showCloseConfirmation = true
        } else { dismiss() }
    }

    private func restoreRecipients() async {
        let ids = start.draft?.recipientIds ?? start.recipientIds
        var unresolved: [String] = []
        for id in ids {
            do {
                let page = try await model.mailRecipients(query: id)
                if let person = page.items.first(where: { $0.userId == id }), !recipients.contains(where: { $0.userId == id }) { recipients.append(person.person) }
                else { unresolved.append(id) }
            } catch { unresolved.append(id); self.error = error.localizedDescription }
        }
        unresolvedRecipientIds = unresolved.filter { id in !recipients.contains(where: { $0.userId == id }) }
    }

    private func addFiles(_ urls: [URL]) async {
        busy = true
        defer { busy = false }
        for url in urls {
            do { attachments.append(try await model.mailPrepareLocalAttachment(url: url).attachment) }
            catch { self.error = error.localizedDescription }
        }
    }

    private func saveDraft() async {
        busy = true
        defer { busy = false }
        do {
            let value = content()
            if let draft {
                self.draft = try await model.mailUpdateDraft(id: draft.draftId, baseVersion: draft.version, content: value)
            } else {
                draft = try await model.mailCreateDraft(value)
            }
            onDone()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }

    private func send() async {
        guard unresolvedRecipientIds.isEmpty else { error = "请确认未识别的收件人。"; return }
        busy = true
        defer { busy = false }
        do {
            let current = content()
            if pendingSend?.content != current {
                let preview = try await model.mailPreview(current)
                pendingSend = PendingSend(content: current, previewId: preview.previewId, clientRequestId: UUID().uuidString)
            }
            guard let pendingSend else { return }
            _ = try await model.mailSend(previewId: pendingSend.previewId, clientRequestId: pendingSend.clientRequestId)
            self.pendingSend = nil
            if let draft { try? await model.mailDeleteDraft(id: draft.draftId) }
            onDone()
            dismiss()
        } catch {
            if let apiError = error as? APIError, apiError.status == 409 { pendingSend = nil }
            self.error = error.localizedDescription
        }
    }
}

private struct MailRecipientPicker: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding var recipients: [MailPerson]
    @Binding var unresolvedRecipientIds: [String]
    @State private var search = ""
    @State private var people: [MailRecipientCandidate] = []
    @State private var nextCursor: String?
    @State private var loading = false
    @State private var loadingMore = false
    @State private var selectionLimitReached = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if loading && people.isEmpty { ProgressView() }
                ForEach(people) { person in
                    Button { toggle(person) } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(person.name)
                                if let handle = person.handle, handle != person.name {
                                    Text(handle).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if recipients.contains(where: { $0.userId == person.userId }) {
                                Image(systemName: "checkmark.circle.fill")
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .foregroundStyle(.primary)
                    .accessibilityValue(recipients.contains(where: { $0.userId == person.userId }) ? "已选" : "未选")
                }
                if let nextCursor {
                    Button("加载更多") { Task { await loadMore(after: nextCursor) } }
                        .disabled(loadingMore)
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("重试") { Task { await load() } }
                }
                if !loading && error == nil && people.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "没有可选成员" : "没有匹配的成员", systemImage: "person.crop.circle")
                }
            }
            .searchable(text: $search, prompt: "搜索姓名或账号")
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .navigationTitle("选择收件人")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(recipients.isEmpty ? "完成" : "完成（\(recipients.count)）") { dismiss() }
                }
            }
            .task(id: search) { await load() }
            .alert("最多选择 50 位收件人", isPresented: $selectionLimitReached) {
                Button("知道了", role: .cancel) { }
            }
        }
    }

    private func toggle(_ person: MailRecipientCandidate) {
        if recipients.contains(where: { $0.userId == person.userId }) {
            recipients.removeAll { $0.userId == person.userId }
        } else if recipients.count + unresolvedRecipientIds.filter({ $0 != person.userId }).count < 50 {
            recipients.append(person.person)
            unresolvedRecipientIds.removeAll { $0 == person.userId }
        } else {
            selectionLimitReached = true
        }
    }

    private func load() async {
        people = []
        nextCursor = nil
        error = nil
        loading = true
        loadingMore = false
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !query.isEmpty {
            do { try await Task.sleep(for: .milliseconds(250)) }
            catch { return }
        }
        do {
            let page = try await model.mailRecipients(query: query)
            guard !Task.isCancelled, search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            people = page.items
            nextCursor = page.nextCursor
        } catch {
            guard !Task.isCancelled, search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func loadMore(after cursor: String) async {
        guard !loadingMore else { return }
        loadingMore = true
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let page = try await model.mailRecipients(query: query, cursor: cursor)
            guard search.trimmingCharacters(in: .whitespacesAndNewlines) == query, nextCursor == cursor else { return }
            people.append(contentsOf: page.items)
            nextCursor = page.nextCursor
        } catch {
            guard search.trimmingCharacters(in: .whitespacesAndNewlines) == query, nextCursor == cursor else { return }
            self.error = error.localizedDescription
        }
        loadingMore = false
    }
}
