import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct MailComposeStart: Identifiable {
    let id = UUID()
    var toIds: [String] = []
    var ccIds: [String] = []
    var subject = ""
    var body = ""
    var relation: MailRelation?
    var source: MailMessage?

    var initialContent: MailContent {
        MailContent(formatVersion: 3, toIds: toIds, ccIds: ccIds, toOrganizationIds: [], ccOrganizationIds: [], subject: subject, body: body, attachmentIds: [], forwardAttachmentIds: relation?.kind == "forward" ? source?.attachments.map(\.attachmentId) ?? [] : [], relation: relation)
    }
}

struct MailComposeView: View {
    private enum RecipientRole: String, Identifiable { case to, cc; var id: String { rawValue } }
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let start: MailComposeStart
    let onDone: () -> Void

    @State private var recipients: [MailPerson] = []
    @State private var ccRecipients: [MailPerson] = []
    @State private var toOrganizations: [MailOrganization] = []
    @State private var ccOrganizations: [MailOrganization] = []
    @State private var unresolvedRecipientIds: [String] = []
    @State private var unresolvedCcIds: [String] = []
    @State private var restoringRecipients: Bool
    @State private var recipientPicker: RecipientRole?
    @State private var subject: String
    @State private var messageBody: String
    @State private var attachments: [MailAttachment]
    @State private var forwardAttachmentIds: [String]
    @State private var quoteExpanded = true
    @State private var importing = false
    @State private var busy = false
    @State private var error: String?
    @State private var sendConfirmation = MailSendConfirmationState()
    @State private var confirmingDiscard = false

    private var confirmation: MailPreview? { sendConfirmation.confirmation }

    init(start: MailComposeStart, onDone: @escaping () -> Void) {
        self.start = start
        self.onDone = onDone
        _subject = State(initialValue: start.subject)
        _messageBody = State(initialValue: start.body)
        _attachments = State(initialValue: [])
        _unresolvedRecipientIds = State(initialValue: start.toIds)
        _unresolvedCcIds = State(initialValue: start.ccIds)
        _restoringRecipients = State(initialValue: !(start.toIds + start.ccIds).isEmpty)
        _forwardAttachmentIds = State(initialValue: start.relation?.kind == "forward" ? start.source?.attachments.map(\.attachmentId) ?? [] : [])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("收件人") {
                    if restoringRecipients { ProgressView("加载收件人") }
                    Button(recipients.isEmpty && toOrganizations.isEmpty ? "选择收件人" : "添加收件人", systemImage: "person.crop.circle.badge.plus") { recipientPicker = .to }
                    ForEach(recipients) { person in
                        HStack {
                            Text(person.name)
                            if let handle = person.handle, handle != person.name { Text(handle).foregroundStyle(.secondary) }
                            Spacer()
                            MailRemoveButton(name: person.name) { recipients.removeAll { $0.userId == person.userId } }
                        }
                    }
                    ForEach(toOrganizations) { organization in
                        HStack { Text(organization.name); Spacer(); MailRemoveButton(name: organization.name) { toOrganizations.removeAll { $0.id == organization.id } } }
                    }
                    if !restoringRecipients, !unresolvedRecipientIds.isEmpty {
                        Text("收件人无法确认，请移除或重新搜索").foregroundStyle(Theme.failure)
                        ForEach(unresolvedRecipientIds, id: \.self) { id in
                            HStack { Text(id); Spacer(); MailRemoveButton(name: id) { unresolvedRecipientIds.removeAll { $0 == id } } }
                        }
                    }
                }
                .disabled(restoringRecipients)
                Section("抄送") {
                    Button(ccRecipients.isEmpty ? "选择抄送" : "添加抄送", systemImage: "person.crop.circle.badge.plus") { recipientPicker = .cc }
                    ForEach(ccRecipients) { person in
                        HStack { Text(person.name); Spacer(); MailRemoveButton(name: person.name) { ccRecipients.removeAll { $0.userId == person.userId } } }
                    }
                    ForEach(ccOrganizations) { organization in
                        HStack { Text(organization.name); Spacer(); MailRemoveButton(name: organization.name) { ccOrganizations.removeAll { $0.id == organization.id } } }
                    }
                    if !restoringRecipients, !unresolvedCcIds.isEmpty {
                        Text("抄送人无法确认，请移除或重新搜索").foregroundStyle(Theme.failure)
                        ForEach(unresolvedCcIds, id: \.self) { id in
                            HStack { Text(id); Spacer(); MailRemoveButton(name: id) { unresolvedCcIds.removeAll { $0 == id } } }
                        }
                    }
                }
                .disabled(restoringRecipients)
                Section("主题") { TextField("主题", text: $subject) }
                Section("正文") { TextEditor(text: $messageBody).frame(minHeight: 180).accessibilityLabel("正文") }
                if let source = start.source {
                    Section {
                        DisclosureGroup(start.relation?.kind == "forward" ? "转发原文" : "回复原文", isExpanded: $quoteExpanded) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("发件人：\(source.sender.name)")
                                Text("收件人：\(source.toAddresses?.map(\.name).joined(separator: "、") ?? source.toRecipients.map(\.name).joined(separator: "、"))")
                                if !(source.ccAddresses?.isEmpty ?? source.ccRecipients.isEmpty) { Text("抄送：\(source.ccAddresses?.map(\.name).joined(separator: "、") ?? source.ccRecipients.map(\.name).joined(separator: "、"))") }
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
                        HStack { Text(attachment.fileName); Spacer(); MailRemoveButton(name: attachment.fileName) { attachments.removeAll { $0.id == attachment.id } } }
                    }
                    if start.relation?.kind == "forward", let source = start.source {
                        ForEach(source.attachments) { attachment in
                            HStack {
                                Text(attachment.fileName)
                                Spacer()
                                if forwardAttachmentIds.contains(attachment.id) {
                                    MailRemoveButton(name: attachment.fileName) { forwardAttachmentIds.removeAll { $0 == attachment.id } }
                                } else {
                                    Button("附上", systemImage: "plus.circle") { forwardAttachmentIds.append(attachment.id) }
                                        .labelStyle(.iconOnly)
                                        .buttonStyle(.borderless)
                                        .accessibilityLabel("附上 \(attachment.fileName)")
                                        .disabled(attachments.count + forwardAttachmentIds.count >= 10)
                                }
                            }
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.failure) } }
                if let confirmation { Section("发送确认") { Text("收件人：\(confirmation.toAddresses?.map(\.name).joined(separator: "、") ?? confirmation.toRecipients.map(\.name).joined(separator: "、"))"); if let cc = confirmation.ccAddresses, !cc.isEmpty { Text("抄送：\(cc.map(\.name).joined(separator: "、"))") }; if let count = confirmation.recipientCount { Text("当前可投递 \(count) 人") } } }
            }
            .disabled(busy)
            .navigationTitle(start.relation?.kind == "reply" ? "回复" : start.relation?.kind == "forward" ? "转发" : "写信")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消", action: cancel).disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(confirmation == nil ? "预览发送" : "确认发送") { Task { await send() } }.disabled(busy || restoringRecipients || (recipients.isEmpty && toOrganizations.isEmpty) || !unresolvedRecipientIds.isEmpty || !unresolvedCcIds.isEmpty || subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (start.relation?.kind != "forward" && messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)) }
            }
            .interactiveDismissDisabled(busy || hasChanges)
            .background {
                MailDismissAttemptObserver(blocked: busy || hasChanges) {
                    if !busy && hasChanges { confirmingDiscard = true }
                }
            }
            .confirmationDialog("放弃这封信？", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("放弃", role: .destructive) { dismiss() }
                Button("继续写信", role: .cancel) {}
            }
            .onChange(of: content()) { _, current in
                sendConfirmation.invalidateIfChanged(current)
            }
            .task { await restoreRecipients() }
            .sheet(item: $recipientPicker) { role in
                MailRecipientPicker(role: role.rawValue, toRecipients: $recipients, ccRecipients: $ccRecipients, toOrganizations: $toOrganizations, ccOrganizations: $ccOrganizations, unresolvedToIds: $unresolvedRecipientIds, unresolvedCcIds: $unresolvedCcIds)
                    .presentationDetents([.large])
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { Task { await addFiles(urls) } }
                if case .failure(let failure) = result { error = failure.localizedDescription }
            }
        }
    }

    private func content() -> MailContent {
        MailContent(formatVersion: 3, toIds: recipients.map(\.userId) + unresolvedRecipientIds, ccIds: ccRecipients.map(\.userId) + unresolvedCcIds, toOrganizationIds: toOrganizations.map(\.organizationId), ccOrganizationIds: ccOrganizations.map(\.organizationId), subject: subject, body: messageBody, attachmentIds: attachments.map(\.attachmentId), forwardAttachmentIds: forwardAttachmentIds, relation: start.relation)
    }

    private var hasChanges: Bool { !content().hasSameDraft(as: start.initialContent) }

    private func cancel() {
        guard !busy else { return }
        if hasChanges { confirmingDiscard = true }
        else { dismiss() }
    }

    private func restoreRecipients() async {
        defer { restoringRecipients = false }
        guard let result = await MailRecipientRestoration.restore(toIds: start.toIds, ccIds: start.ccIds, using: model) else { return }
        recipients = result.to
        ccRecipients = result.cc
        unresolvedRecipientIds = result.unresolvedTo
        unresolvedCcIds = result.unresolvedCc
        error = result.error
    }

    private func addFiles(_ urls: [URL]) async {
        let account = model.accountIdentityGeneration
        guard model.isCurrentAccount(account) else { return }
        busy = true
        defer { if model.isCurrentAccount(account) { busy = false } }
        await MailAttachmentImport.prepare(
            urls, availableSlots: 10 - attachments.count - forwardAttachmentIds.count, using: model,
            onAttachment: { attachments.append($0) }, onError: { error = $0 }
        )
    }

    private func send() async {
        guard !busy, !restoringRecipients else { return }
        guard unresolvedRecipientIds.isEmpty && unresolvedCcIds.isEmpty else { error = "请确认未识别的收件人。"; return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let current = content()
            if sendConfirmation.pendingSend(for: current) == nil {
                let preview = try await model.mailPreview(current)
                guard current.hasSameDraft(as: content()) else { return }
                sendConfirmation.prepare(preview, content: current)
                return
            }
            guard let pendingSend = sendConfirmation.pendingSend(for: current) else { return }
            _ = try await model.mailSend(previewId: pendingSend.previewId, clientRequestId: pendingSend.clientRequestId)
            sendConfirmation.clear()
            onDone()
            dismiss()
        } catch {
            sendConfirmation.handleFailure(error)
            self.error = error.localizedDescription
        }
    }
}

/// Preserve SwiftUI's presentation delegate while observing an attempted swipe.
private struct MailDismissAttemptObserver: UIViewControllerRepresentable {
    let blocked: Bool
    let onAttempt: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        let coordinator = context.coordinator
        coordinator.blocked = blocked
        coordinator.onAttempt = onAttempt
        controller.onAttach = { [weak controller, weak coordinator] in
            guard let controller, let coordinator else { return }
            var ancestor = controller.parent
            while let candidate = ancestor {
                if candidate.presentingViewController != nil, let presentation = candidate.presentationController {
                    if presentation.delegate !== coordinator {
                        coordinator.original = presentation.delegate
                        presentation.delegate = coordinator
                    }
                    return
                }
                ancestor = candidate.parent
            }
        }
        DispatchQueue.main.async { [weak controller] in controller?.onAttach?() }
    }

    final class Controller: UIViewController {
        var onAttach: (() -> Void)?
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            onAttach?()
        }
    }

    final class Coordinator: NSObject, UIAdaptivePresentationControllerDelegate {
        var blocked = false
        var onAttempt: (() -> Void)?
        weak var original: (any UIAdaptivePresentationControllerDelegate)?

        func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
            !blocked && (original?.presentationControllerShouldDismiss?(presentationController) ?? true)
        }
        func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
            if blocked { onAttempt?() }
            else { original?.presentationControllerDidAttemptToDismiss?(presentationController) }
        }
        func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerWillDismiss?(presentationController)
        }
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerDidDismiss?(presentationController)
        }
    }
}

private struct MailRemoveButton: View {
    let name: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "minus.circle")
                .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("移除 \(name)")
    }
}

private struct MailRecipientPicker: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let role: String
    @Binding var toRecipients: [MailPerson]
    @Binding var ccRecipients: [MailPerson]
    @Binding var toOrganizations: [MailOrganization]
    @Binding var ccOrganizations: [MailOrganization]
    @Binding var unresolvedToIds: [String]
    @Binding var unresolvedCcIds: [String]
    @State private var search = ""
    @State private var recipientStore = MailRecipientPickerStore()
    @State private var organizationMembers = MailOrganizationMemberStore()
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if recipientStore.loading && recipientStore.people.isEmpty { ProgressView() }
                ForEach(recipientStore.people) { person in
                    Button { toggle(person) } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(person.name)
                                if let handle = person.handle, handle != person.name {
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
                if !recipientStore.organizations.isEmpty {
                    Section("组织") {
                        ForEach(recipientStore.organizations) { organization in
                            HStack {
                                Button { toggleOrganization(organization) } label: {
                                    HStack { Text(organization.name); Text(organization.teamName).foregroundStyle(.secondary); Spacer(); Text("\(organization.memberCount) 人").foregroundStyle(.secondary); if selectedOrganizations.contains(where: { $0.id == organization.id }) { Image(systemName: "checkmark.circle.fill") } }
                                        .frame(minHeight: Metrics.minimumTapTarget)
                                        .contentShape(Rectangle())
                                }.foregroundStyle(.primary).buttonStyle(.plain)
                                Button { Task { await organizationMembers.load(id: organization.id, using: model) } } label: {
                                    Image(systemName: "person.2")
                                        .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("查看 \(organization.name) 成员")
                            }
                            if organizationMembers.organizationId == organization.id {
                                ForEach(organizationMembers.members) { member in Text(member.name).font(.subheadline) }
                                if organizationMembers.loading { ProgressView("加载成员") }
                                if let error = organizationMembers.error {
                                    Text(error).foregroundStyle(Theme.failure)
                                    Button("重试") { Task { await organizationMembers.load(id: organization.id, using: model) } }
                                }
                                if let cursor = organizationMembers.nextCursor {
                                    Button("加载更多成员") { Task { await organizationMembers.load(id: organization.id, cursor: cursor, using: model) } }
                                        .disabled(organizationMembers.loading)
                                }
                            }
                        }
                    }
                }
                if recipientStore.nextCursor != nil {
                    Button("加载更多") { Task { await recipientStore.loadMore(using: model) } }
                        .disabled(recipientStore.loading || recipientStore.loadingMore)
                }
                if let error { Text(error).foregroundStyle(Theme.failure) }
                if let error = recipientStore.error {
                    Text(error).foregroundStyle(Theme.failure)
                    Button("重试") { Task { await recipientStore.load(query: search, using: model) } }
                }
                if !recipientStore.loading && recipientStore.error == nil && recipientStore.people.isEmpty && recipientStore.organizations.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "没有可选成员或组织" : "没有匹配的成员或组织", systemImage: "person.crop.circle")
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
            .task(id: search) { error = nil; await recipientStore.load(query: search, using: model) }
        }
    }

    private var selected: [MailPerson] { role == "to" ? toRecipients : ccRecipients }
    private var selectedOrganizations: [MailOrganization] { role == "to" ? toOrganizations : ccOrganizations }

    private func toggle(_ person: MailRecipientCandidate) {
        if role == "to", toRecipients.contains(where: { $0.userId == person.userId }) {
            toRecipients.removeAll { $0.userId == person.userId }
        } else if role == "cc", ccRecipients.contains(where: { $0.userId == person.userId }) {
            ccRecipients.removeAll { $0.userId == person.userId }
        } else {
            toRecipients.removeAll { $0.userId == person.userId }
            ccRecipients.removeAll { $0.userId == person.userId }
            if role == "to" { toRecipients.append(person.person) }
            else { ccRecipients.append(person.person) }
            unresolvedToIds.removeAll { $0 == person.userId }
            unresolvedCcIds.removeAll { $0 == person.userId }
        }
    }

    private func toggleOrganization(_ organization: MailOrganization) {
        if selectedOrganizations.contains(where: { $0.id == organization.id }) {
            if role == "to" { toOrganizations.removeAll { $0.id == organization.id } }
            else { ccOrganizations.removeAll { $0.id == organization.id } }
            return
        }
        if (toOrganizations + ccOrganizations).contains(where: { $0.teamId != organization.teamId }) { error = "一封信只能选择同一团队的组织。"; return }
        toOrganizations.removeAll { $0.id == organization.id }
        ccOrganizations.removeAll { $0.id == organization.id }
        if role == "to" { toOrganizations.append(organization) }
        else { ccOrganizations.append(organization) }
    }

}
