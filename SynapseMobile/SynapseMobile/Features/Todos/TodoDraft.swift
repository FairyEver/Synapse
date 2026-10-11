import Foundation

nonisolated struct TodoDraft {
    let id: String?
    let expectedVersion: Int?
    let presentationID = UUID()
    private let original: TodoItemDto?
    private var submittedPayload: Data?
    private var firstSubmissionAt: Date?
    var clientRequestId = UUID()
    var title: String { didSet { if title != oldValue { clientRequestId = UUID() } } }
    var note: String { didSet { if note != oldValue { clientRequestId = UUID() } } }
    var dueAt: Date? { didSet { if dueAt != oldValue { clientRequestId = UUID() } } }
    var reminder: TodoReminderKind { didSet { if reminder != oldValue { clientRequestId = UUID() } } }
    var offsetMinutes: Int { didSet { if offsetMinutes != oldValue { clientRequestId = UUID() } } }
    var customRemindAt: Date? { didSet { if customRemindAt != oldValue { clientRequestId = UUID() } } }

    init(item: TodoItemDto? = nil) {
        original = item
        id = item?.id
        expectedVersion = item?.version
        title = item?.title ?? ""
        note = item?.note ?? ""
        dueAt = TodoTime.parse(item?.dueAt)
        reminder = item?.reminder ?? .none
        offsetMinutes = item?.offsetMinutes ?? 10
        customRemindAt = item?.reminder == .custom ? TodoTime.parse(item?.remindAt) : nil
    }

    var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    var normalizedNote: String? { note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note }
    var hasChanges: Bool {
        guard let original else { return !trimmedTitle.isEmpty || normalizedNote != nil || dueAt != nil || reminder != .none }
        return trimmedTitle != original.title || normalizedNote != original.note
            || dueAt.map(TodoTime.minute) != TodoTime.parse(original.dueAt) || changesReminder
    }
    var effectiveRemindAt: Date? {
        switch reminder {
        case .none: nil
        case .atDue: dueAt.map(TodoTime.minute)
        case .beforeDue: dueAt.map { TodoTime.minute($0).addingTimeInterval(-Double(offsetMinutes) * 60) }
        case .custom: customRemindAt.map(TodoTime.minute)
        }
    }
    private var changesReminder: Bool {
        guard let original else { return reminder != .none }
        return reminder != original.reminder
            || (reminder == .beforeDue ? offsetMinutes : nil) != original.offsetMinutes
            || effectiveRemindAt != TodoTime.parse(original.remindAt)
    }

    func validationMessage(now: Date = Date()) -> String? {
        if trimmedTitle.isEmpty || trimmedTitle.unicodeScalars.count > 200 || trimmedTitle.unicodeScalars.contains(where: { $0.value == 0 }) {
            return "标题需为 1 至 200 个字符"
        }
        if note.unicodeScalars.count > 10_000 || note.unicodeScalars.contains(where: { $0.value == 0 }) { return "备注最多 10000 个字符" }
        if (reminder == .atDue || reminder == .beforeDue) && dueAt == nil { return "请选择截止时间" }
        if reminder == .beforeDue && ![10, 60, 1440].contains(offsetMinutes) { return "请选择提前时间" }
        if reminder == .custom && customRemindAt == nil { return "请选择提醒时间" }
        if changesReminder, let remindAt = effectiveRemindAt, remindAt <= now, !isReceiptRetry(now: now) { return "提醒时间必须晚于现在" }
        return nil
    }

    mutating func recordSubmission(now: Date) {
        let payload = mutationPayload
        if payload != submittedPayload || firstSubmissionAt == nil {
            submittedPayload = payload; firstSubmissionAt = now
        }
    }
    private func isReceiptRetry(now: Date) -> Bool {
        guard let submittedPayload, let firstSubmissionAt else { return false }
        return now >= firstSubmissionAt && now.timeIntervalSince(firstSubmissionAt) < 86_400
            && mutationPayload == submittedPayload
    }
    private var mutationPayload: Data? {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        if let input = updateInput() { return try? encoder.encode(input) }
        return try? encoder.encode(createInput())
    }

    func createInput() -> TodoCreateInput {
        TodoCreateInput(clientRequestId: clientRequestId, title: trimmedTitle, note: normalizedNote,
            dueAt: dueAt.map(TodoTime.wire), reminder: reminder,
            offsetMinutes: reminder == .beforeDue ? offsetMinutes : nil,
            remindAt: reminder == .custom ? customRemindAt.map(TodoTime.wire) : nil)
    }
    func updateInput() -> TodoUpdateInput? {
        guard let expectedVersion else { return nil }
        return TodoUpdateInput(expectedVersion: expectedVersion, clientRequestId: clientRequestId, title: trimmedTitle,
            note: normalizedNote.map { .value($0) } ?? .null,
            dueAt: dueAt.map { .value(TodoTime.wire($0)) } ?? .null, reminder: reminder,
            offsetMinutes: reminder == .beforeDue ? .value(offsetMinutes) : .null,
            remindAt: reminder == .custom ? customRemindAt.map { .value(TodoTime.wire($0)) } ?? .null : .null)
    }
}
