import SwiftUI

struct TodoEditorSheet: View {
    @Environment(SynapseAppModel.self) private var model
    @State private var confirmingDiscard = false

    var body: some View {
        NavigationStack {
            if let draft = model.todos.draft {
                Form {
                    Section {
                        TextField("标题", text: field(\.title, fallback: ""))
                        TextField("备注", text: field(\.note, fallback: ""), axis: .vertical).lineLimit(3...8)
                    }
                    Section {
                        Toggle("截止时间", isOn: dueEnabled)
                        if draft.dueAt != nil {
                            DatePicker("日期和时间", selection: dateField(\.dueAt), displayedComponents: [.date, .hourAndMinute])
                        }
                        Picker("提醒", selection: reminderSelection) {
                            ForEach(TodoReminderKind.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.menu)
                        if draft.reminder == .beforeDue {
                            Picker("提前", selection: field(\.offsetMinutes, fallback: 10)) {
                                Text("10 分钟").tag(10)
                                Text("1 小时").tag(60)
                                Text("1 天").tag(1440)
                            }
                            .pickerStyle(.menu)
                        }
                        if draft.reminder == .custom {
                            DatePicker("提醒时间", selection: dateField(\.customRemindAt), displayedComponents: [.date, .hourAndMinute])
                        }
                    }
                    if let message = model.todos.editorError ?? visibleValidation(draft) {
                        Section { Text(message) }
                    }
                    if model.todos.editorConflict {
                        Section { Button("重新读取") { Task { await model.reloadTodoEditor() } } }
                    }
                }
                .disabled(model.todos.isSaving)
                .navigationTitle(draft.id == nil ? "新建待办" : "编辑待办")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消", action: cancel).disabled(model.todos.isSaving).keyboardShortcut(.cancelAction)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(draft.id == nil ? "添加" : "保存") { Task { await model.submitTodoEditor() } }
                            .disabled(model.todos.isSaving || draft.validationMessage() != nil)
                            .keyboardShortcut(.defaultAction)
                    }
                }
                .interactiveDismissDisabled(model.todos.isSaving || draft.hasChanges)
                .background {
                    SheetDismissAttemptObserver(blocked: model.todos.isSaving || draft.hasChanges) {
                        if !model.todos.isSaving && draft.hasChanges { confirmingDiscard = true }
                    }
                }
                .confirmationDialog("放弃修改？", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                    Button("放弃", role: .destructive) { model.todos.closeEditor() }
                    Button("继续编辑", role: .cancel) { confirmingDiscard = false }
                }
            }
        }
    }

    private func cancel() {
        guard !model.todos.isSaving else { return }
        if model.todos.draft?.hasChanges == true { confirmingDiscard = true }
        else { model.todos.closeEditor() }
    }
    private func visibleValidation(_ draft: TodoDraft) -> String? {
        draft.trimmedTitle.isEmpty ? nil : draft.validationMessage()
    }
    private func field<Value>(_ key: WritableKeyPath<TodoDraft, Value>, fallback: Value) -> Binding<Value> {
        Binding(get: { model.todos.draft?[keyPath: key] ?? fallback }, set: { model.todos.draft?[keyPath: key] = $0 })
    }
    private func dateField(_ key: WritableKeyPath<TodoDraft, Date?>) -> Binding<Date> {
        Binding(get: { model.todos.draft?[keyPath: key] ?? defaultDate }, set: { model.todos.draft?[keyPath: key] = TodoTime.minute($0) })
    }
    private var defaultDate: Date { TodoTime.minute(Date().addingTimeInterval(3600)) }
    private var dueEnabled: Binding<Bool> {
        Binding(get: { model.todos.draft?.dueAt != nil }, set: { model.todos.draft?.dueAt = $0 ? defaultDate : nil })
    }
    private var reminderSelection: Binding<TodoReminderKind> {
        Binding(get: { model.todos.draft?.reminder ?? .none }, set: { reminder in
            model.todos.draft?.reminder = reminder
            if reminder == .custom && model.todos.draft?.customRemindAt == nil { model.todos.draft?.customRemindAt = defaultDate }
        })
    }
}
