import SwiftUI

struct TodoRow: View {
    let item: TodoItemDto
    let busy: Bool
    let onComplete: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onCopy: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            Button(action: onComplete) {
                Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("\(item.isCompleted ? "恢复" : "完成")「\(item.title)」")
            .accessibilityIdentifier("todo-completion-\(item.id)")

            Button(action: onEdit) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).strikethrough(item.isCompleted).foregroundStyle(.primary)
                    if let note = item.note { Text(note).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                    if let due = TodoTime.display(item.dueAt) { Label(due, systemImage: "calendar").font(.caption).foregroundStyle(.secondary) }
                    if let status = item.reminderStatus.label {
                        Label([TodoTime.display(item.remindAt), status].compactMap { $0 }.joined(separator: " · "), systemImage: "bell")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: Metrics.minimumTapTarget, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("编辑「\(item.title)」")
            .accessibilityValue(item.isCompleted ? "已完成" : "未完成")
            .accessibilityIdentifier("todo-edit-\(item.id)")

            Menu {
                Button("编辑", systemImage: "pencil", action: onEdit)
                Button(item.isCompleted ? "恢复" : "完成", systemImage: item.isCompleted ? "arrow.uturn.backward" : "checkmark", action: onComplete)
                Button("复制引用", systemImage: "doc.on.doc", action: onCopy)
                Button("删除", systemImage: "trash", role: .destructive, action: onDelete)
            } label: {
                Image(systemName: "ellipsis")
                    .frame(minWidth: Metrics.minimumTapTarget, minHeight: Metrics.minimumTapTarget)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("「\(item.title)」的更多操作")
        }
        .disabled(busy)
    }
}
