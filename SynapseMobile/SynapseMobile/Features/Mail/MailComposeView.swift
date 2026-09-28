import SwiftUI
import UniformTypeIdentifiers

struct MailComposeStart: Identifiable {
    let id = UUID()
    var toIds: [String] = []
    var ccIds: [String] = []
    var subject = ""
    var body = ""
    var relation: MailRelation?
    var source: MailMessage?
}

struct MailComposeView: View {
    private enum RecipientRole: String, Identifiable { case to, cc; var id: String { rawValue } }
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
    @State private var ccRecipients: [MailPerson] = []
    @State private var unresolvedRecipientIds: [String] = []
    @State private var unresolvedCcIds: [String] = []
    @State private var recipientPicker: RecipientRole?
    @State private var subject: String
    @State private var messageBody: String
    @State private var attachments: [MailAttachment]
    @State private var forwardAttachmentIds: [String]
    @State private var quoteExpanded = true
    @State private var importing = false
    @State private var busy = false
    @State private var error: String?
    @State private var pendingSend: PendingSend?

    init(start: MailComposeStart, onDone: @escaping () -> Void) {
        self.start = start
        self.onDone = onDone
        _subject = State(initialValue: start.subject)
        _messageBody = State(initialValue: start.body)
        _attachments = State(initialValue: [])
        _forwardAttachmentIds = State(initialValue: start.relation?.kind == "forward" ? start.source?.attachments.map(\.attachmentId) ?? [] : [])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("收件人") {
                    Button(recipients.isEmpty ? "选择收件人" : "添加收件人", systemImage: "person.crop.circle.badge.plus") { recipientPicker = .to }
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
                Section("抄送") {
                    Button(ccRecipients.isEmpty ? "选择抄送" : "添加抄送", systemImage: "person.crop.circle.badge.plus") { recipientPicker = .cc }
                    ForEach(ccRecipients) { person in
                        HStack { Text(person.name); Spacer(); Button("移除 \(person.name)", systemImage: "minus.circle") { ccRecipients.removeAll { $0.userId == person.userId } }.labelStyle(.iconOnly) }
                    }
                    if !unresolvedCcIds.isEmpty {
                        Text("抄送人无法确认，请移除或重新搜索").foregroundStyle(.red)
                        ForEach(unresolvedCcIds, id: \.self) { id in
                            HStack { Text(id); Spacer(); Button("移除", systemImage: "minus.circle") { unresolvedCcIds.removeAll { $0 == id } }.labelStyle(.iconOnly) }
                        }
                    }
                }
                Section("主题") { TextField("主题", text: $subject) }
                Section("正文") { TextEditor(text: $messageBody).frame(minHeight: 180) }
                if let source = start.source {
                    Section {
                        DisclosureGroup(start.relation?.kind == "forward" ? "转发原文" : "回复原文", isExpanded: $quoteExpanded) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("发件人：\(source.sender.name)")
                                Text("收件人：\(source.toRecipients.map(\.name).joined(separator: "、"))")
                                if !source.ccRecipients.isEmpty { Text("抄送：\(source.ccRecipients.map(\.name).joined(separator: "、"))") }
                                Text("时间：\(mailDate(source.sentAt))")
                                Text("主题：\(source.subject)")
                                Text(source.body).textSelection(.enabled)
                            }
                        }
                    }
                }
                Section("附件") {
                    Button("选取文件", systemImage: "paperclip") { importing = true }
                        .disabled(attachments.count + forwardAttachmentIds.count >= 10)
                    ForEach(attachments) { attachment in
                        HStack { Text(attachment.fileName); Spacer(); Button("移除", systemImage: "minus.circle") { attachments.removeAll { $0.id == attachment.id } }.labelStyle(.iconOnly) }
                    }
                    if start.relation?.kind == "forward", let source = start.source {
                        ForEach(source.attachments) { attachment in
                            HStack {
                                Text(attachment.fileName)
                                Spacer()
                                if forwardAttachmentIds.contains(attachment.id) {
                                    Button("移除", systemImage: "minus.circle") { forwardAttachmentIds.removeAll { $0 == attachment.id } }.labelStyle(.iconOnly)
                                } else {
                                    Button("附上", systemImage: "plus.circle") { forwardAttachmentIds.append(attachment.id) }
                                        .labelStyle(.iconOnly)
                                        .disabled(attachments.count + forwardAttachmentIds.count >= 10)
                                }
                            }
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle(start.relation?.kind == "reply" ? "回复" : start.relation?.kind == "forward" ? "转发" : "写信")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { if !busy { dismiss() } } }
                ToolbarItem(placement: .confirmationAction) { Button("发送") { Task { await send() } }.disabled(busy || recipients.isEmpty || !unresolvedRecipientIds.isEmpty || !unresolvedCcIds.isEmpty || subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (start.relation?.kind != "forward" && messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)) }
            }
            .interactiveDismissDisabled(busy)
            .task { await restoreRecipients() }
            .sheet(item: $recipientPicker) { role in
                MailRecipientPicker(role: role.rawValue, toRecipients: $recipients, ccRecipients: $ccRecipients, unresolvedToIds: $unresolvedRecipientIds, unresolvedCcIds: $unresolvedCcIds)
                    .presentationDetents([.large])
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { Task { await addFiles(urls) } }
                if case .failure(let failure) = result { error = failure.localizedDescription }
            }
        }
    }

    private func content() -> MailContent {
        MailContent(formatVersion: 2, toIds: recipients.map(\.userId) + unresolvedRecipientIds, ccIds: ccRecipients.map(\.userId) + unresolvedCcIds, subject: subject, body: messageBody, attachmentIds: attachments.map(\.attachmentId), forwardAttachmentIds: forwardAttachmentIds, relation: start.relation)
    }

    private func restoreRecipients() async {
        for id in start.toIds + start.ccIds {
            do {
                let page = try await model.mailRecipients(query: id)
                if let person = page.items.first(where: { $0.userId == id }) {
                    if start.toIds.contains(id) { recipients.append(person.person) }
                    else { ccRecipients.append(person.person) }
                } else if start.toIds.contains(id) { unresolvedRecipientIds.append(id) }
                else { unresolvedCcIds.append(id) }
            } catch {
                if start.toIds.contains(id) { unresolvedRecipientIds.append(id) }
                else { unresolvedCcIds.append(id) }
                self.error = error.localizedDescription
            }
        }
    }

    private func addFiles(_ urls: [URL]) async {
        busy = true
        defer { busy = false }
        for url in urls {
            if attachments.count + forwardAttachmentIds.count >= 10 { error = "附件不能超过 10 个。"; break }
            do { attachments.append(try await model.mailPrepareLocalAttachment(url: url).attachment) }
            catch { self.error = error.localizedDescription }
        }
    }

    private func send() async {
        guard unresolvedRecipientIds.isEmpty && unresolvedCcIds.isEmpty else { error = "请确认未识别的收件人。"; return }
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
    let role: String
    @Binding var toRecipients: [MailPerson]
    @Binding var ccRecipients: [MailPerson]
    @Binding var unresolvedToIds: [String]
    @Binding var unresolvedCcIds: [String]
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
                                if let handle = person.handle {
                                    Text(handle).font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if selected.contains(where: { $0.userId == person.userId }) {
                                Image(systemName: "checkmark.circle.fill")
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .foregroundStyle(.primary)
                    .accessibilityValue(selected.contains(where: { $0.userId == person.userId }) ? "已选" : "未选")
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
            .navigationTitle(role == "to" ? "选择收件人" : "选择抄送")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(selected.isEmpty ? "完成" : "完成（\(selected.count)）") { dismiss() }
                }
            }
            .task(id: search) { await load() }
            .alert("最多选择 50 位收件人", isPresented: $selectionLimitReached) {
                Button("知道了", role: .cancel) { }
            }
        }
    }

    private var selected: [MailPerson] { role == "to" ? toRecipients : ccRecipients }

    private func toggle(_ person: MailRecipientCandidate) {
        if role == "to", toRecipients.contains(where: { $0.userId == person.userId }) {
            toRecipients.removeAll { $0.userId == person.userId }
        } else if role == "cc", ccRecipients.contains(where: { $0.userId == person.userId }) {
            ccRecipients.removeAll { $0.userId == person.userId }
        } else if toRecipients.count + ccRecipients.count + unresolvedToIds.count + unresolvedCcIds.count
            - toRecipients.filter({ $0.userId == person.userId }).count
            - ccRecipients.filter({ $0.userId == person.userId }).count
            - unresolvedToIds.filter({ $0 == person.userId }).count
            - unresolvedCcIds.filter({ $0 == person.userId }).count < 50 {
            toRecipients.removeAll { $0.userId == person.userId }
            ccRecipients.removeAll { $0.userId == person.userId }
            if role == "to" { toRecipients.append(person.person) }
            else { ccRecipients.append(person.person) }
            unresolvedToIds.removeAll { $0 == person.userId }
            unresolvedCcIds.removeAll { $0 == person.userId }
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
