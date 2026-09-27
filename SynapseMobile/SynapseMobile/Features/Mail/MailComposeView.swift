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
    @State private var search = ""
    @State private var candidates: [MailRecipientCandidate] = []
    @State private var subject: String
    @State private var messageBody: String
    @State private var attachments: [MailAttachment]
    @State private var draft: MailDraft?
    @State private var importing = false
    @State private var drivePicker = false
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
                    TextField("搜索姓名或 handle", text: $search)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    ForEach(candidates) { person in
                        Button {
                            if !recipients.contains(where: { $0.userId == person.userId }) { recipients.append(person.person) }
                            search = ""
                            candidates = []
                        } label: {
                            HStack { Text(person.name); if let handle = person.handle { Spacer(); Text(handle).foregroundStyle(.secondary) } }
                        }
                    }
                    ForEach(recipients) { person in
                        HStack { Text(person.name); Spacer(); Button("移除", systemImage: "minus.circle") { recipients.removeAll { $0.userId == person.userId } }.labelStyle(.iconOnly) }
                    }
                }
                Section("主题") { TextField("主题", text: $subject) }
                Section("正文") { TextEditor(text: $messageBody).frame(minHeight: 180) }
                Section("附件") {
                    Button("选取文件", systemImage: "paperclip") { importing = true }
                    Button("从云盘选择", systemImage: "internaldrive") { drivePicker = true }
                    ForEach(attachments) { attachment in
                        HStack { Text(attachment.fileName); Spacer(); Button("移除", systemImage: "minus.circle") { attachments.removeAll { $0.id == attachment.id } }.labelStyle(.iconOnly) }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("写信")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { Button("存草稿") { Task { await saveDraft() } }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button("发送") { Task { await send() } }.disabled(busy || recipients.isEmpty || subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
            .task { await restoreRecipients() }
            .task(id: search) { await findRecipients() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { Task { await addFiles(urls) } }
                if case .failure(let failure) = result { error = failure.localizedDescription }
            }
            .sheet(isPresented: $drivePicker) { MailDrivePicker { item in Task { await addDrive(item) } } }
        }
    }

    private func content(includeReply: Bool = true) -> MailContent {
        MailContent(recipientIds: recipients.map(\.userId), subject: subject, body: messageBody, attachmentIds: attachments.map(\.attachmentId), replyToId: includeReply ? (start.replyToId ?? start.draft?.replyToId) : nil)
    }

    private func restoreRecipients() async {
        let ids = start.draft?.recipientIds ?? start.recipientIds
        for id in ids {
            do {
                let page = try await model.mailRecipients(query: id)
                if let person = page.items.first(where: { $0.userId == id }), !recipients.contains(where: { $0.userId == id }) { recipients.append(person.person) }
            } catch { self.error = error.localizedDescription }
        }
    }

    private func findRecipients() async {
        guard !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { candidates = []; return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        do { candidates = try await model.mailRecipients(query: search).items }
        catch { self.error = error.localizedDescription }
    }

    private func addFiles(_ urls: [URL]) async {
        busy = true
        defer { busy = false }
        for url in urls {
            do { attachments.append(try await model.mailPrepareLocalAttachment(url: url).attachment) }
            catch { self.error = error.localizedDescription }
        }
    }

    private func addDrive(_ item: DriveBrowserItem) async {
        busy = true
        defer { busy = false }
        do { attachments.append(try await model.mailPrepareDriveAttachment(itemId: item.id).attachment); drivePicker = false }
        catch { self.error = error.localizedDescription }
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

private struct MailDrivePicker: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let onSelect: (DriveBrowserItem) -> Void
    @State private var folders: [DriveBrowserItem] = []
    @State private var items: [DriveBrowserItem] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if !folders.isEmpty { Button("返回上一级", systemImage: "chevron.left") { folders.removeLast() } }
                ForEach(items) { item in
                    Button {
                        if item.isFolder { folders.append(item) }
                        else { onSelect(item); dismiss() }
                    } label: { Label(item.name, systemImage: item.isFolder ? "folder" : "doc") }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("云盘文件")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
            .task(id: folders.last?.id) {
                do { items = try await model.mailDriveSnapshot(folderId: folders.last?.id).children }
                catch { self.error = error.localizedDescription }
            }
        }
    }
}
