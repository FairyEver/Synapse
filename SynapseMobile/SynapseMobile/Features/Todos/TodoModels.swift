import Foundation

nonisolated enum TodoFilter: String, Codable, CaseIterable, Sendable {
    case pending, all
    var label: String { self == .pending ? "未完成" : "全部" }
}

nonisolated enum TodoReminderKind: String, Codable, CaseIterable, Sendable {
    case none
    case atDue = "at_due"
    case beforeDue = "before_due"
    case custom
    var label: String {
        switch self {
        case .none: "不提醒"
        case .atDue: "截止时提醒"
        case .beforeDue: "提前提醒"
        case .custom: "自定时间"
        }
    }
}

nonisolated enum TodoReminderStatus: String, Codable, Sendable {
    case none, pending, sent, cancelled, expired
    var label: String? {
        switch self {
        case .none: nil
        case .pending: "待提醒"
        case .sent: "已提醒"
        case .cancelled: "已取消提醒"
        case .expired: "提醒已过期"
        }
    }
}

nonisolated struct TodoItemDto: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let note: String?
    let dueAt: String?
    let reminder: TodoReminderKind
    let offsetMinutes: Int?
    let remindAt: String?
    let reminderGeneration: Int
    let reminderStatus: TodoReminderStatus
    let completedAt: String?
    let version: Int
    let createdAt: String
    let updatedAt: String
    var isCompleted: Bool { completedAt != nil }
}

nonisolated struct TodoPageDto: Codable, Sendable {
    let items: [TodoItemDto]
    let nextOffset: Int?
}

nonisolated struct TodoListInput: Sendable {
    var filter: TodoFilter = .pending
    var query: String? = nil
    var offset: Int = 0
    var limit: Int = 50
}

nonisolated struct TodoCreateInput: Codable, Sendable {
    let clientRequestId: UUID
    let title: String
    var note: String? = nil
    var dueAt: String? = nil
    var reminder: TodoReminderKind = .none
    var offsetMinutes: Int? = nil
    var remindAt: String? = nil
}

/// PATCH 的缺省保持原值，null 清空；不能用 encodeIfPresent 合并这两种意图。
nonisolated enum TodoPatchField<Value: Codable & Sendable>: Codable, Sendable {
    case absent, null, value(Value)
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = container.decodeNil() ? .null : .value(try container.decode(Value.self))
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .absent:
            throw EncodingError.invalidValue(self, .init(codingPath: encoder.codingPath, debugDescription: "Absent fields must be omitted by the parent object"))
        case .null: try container.encodeNil()
        case .value(let value): try container.encode(value)
        }
    }
    static func read<Key: CodingKey>(_ container: KeyedDecodingContainer<Key>, key: Key) throws -> Self {
        guard container.contains(key) else { return .absent }
        return try container.decodeNil(forKey: key) ? .null : .value(container.decode(Value.self, forKey: key))
    }
    func write<Key: CodingKey>(to container: inout KeyedEncodingContainer<Key>, key: Key) throws {
        switch self {
        case .absent: break
        case .null: try container.encodeNil(forKey: key)
        case .value(let value): try container.encode(value, forKey: key)
        }
    }
}

nonisolated struct TodoUpdateInput: Codable, Sendable {
    let expectedVersion: Int
    let clientRequestId: UUID
    var title: String? = nil
    var note: TodoPatchField<String> = .absent
    var dueAt: TodoPatchField<String> = .absent
    var reminder: TodoReminderKind? = nil
    var offsetMinutes: TodoPatchField<Int> = .absent
    var remindAt: TodoPatchField<String> = .absent

    enum CodingKeys: String, CodingKey { case expectedVersion, clientRequestId, title, note, dueAt, reminder, offsetMinutes, remindAt }
    init(expectedVersion: Int, clientRequestId: UUID, title: String? = nil, note: TodoPatchField<String> = .absent,
         dueAt: TodoPatchField<String> = .absent, reminder: TodoReminderKind? = nil,
         offsetMinutes: TodoPatchField<Int> = .absent, remindAt: TodoPatchField<String> = .absent) {
        self.expectedVersion = expectedVersion
        self.clientRequestId = clientRequestId
        self.title = title
        self.note = note
        self.dueAt = dueAt
        self.reminder = reminder
        self.offsetMinutes = offsetMinutes
        self.remindAt = remindAt
    }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        expectedVersion = try container.decode(Int.self, forKey: .expectedVersion)
        clientRequestId = try container.decode(UUID.self, forKey: .clientRequestId)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        reminder = try container.decodeIfPresent(TodoReminderKind.self, forKey: .reminder)
        note = try .read(container, key: .note)
        dueAt = try .read(container, key: .dueAt)
        offsetMinutes = try .read(container, key: .offsetMinutes)
        remindAt = try .read(container, key: .remindAt)
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        try container.encode(clientRequestId, forKey: .clientRequestId)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(reminder, forKey: .reminder)
        try note.write(to: &container, key: .note)
        try dueAt.write(to: &container, key: .dueAt)
        try offsetMinutes.write(to: &container, key: .offsetMinutes)
        try remindAt.write(to: &container, key: .remindAt)
    }
}

nonisolated struct TodoCompletionInput: Codable, Sendable {
    let completed: Bool
    let expectedVersion: Int
    let clientRequestId: UUID
}

nonisolated struct TodoDeleteInput: Codable, Sendable {
    let expectedVersion: Int
    let clientRequestId: UUID
}

nonisolated struct TodoDeleteResult: Codable, Sendable {
    let id: String
    let version: Int
    let deleted: Bool
}

nonisolated struct TodoChangedPayload: Codable, Sendable {
    let id: String
    let version: Int
}

nonisolated enum TodoText {
    static func errorMessage(_ error: Error, listing: Bool = false) -> String {
        guard let error = error as? APIError else { return "连接失败，请重试" }
        if error.status == 404 { return listing ? "服务器暂不支持待办事项，请升级服务器。" : "事项已删除或无法访问" }
        if error.code == "TODO_VERSION_CONFLICT" { return "事项已被其他设备修改，请重新读取" }
        if error.code == "TODO_REQUEST_CONFLICT" { return "请求已改变，请重新读取后再保存" }
        if error.code == "credential_changed" { return "账号已改变，请重试" }
        if error.status == 401 || error.status == 403 { return "请登录后使用待办事项" }
        if error.status == 0 { return "连接失败，请重试" }
        return error.status == 400 ? error.message : "操作失败，请重试"
    }
}
