import SwiftUI

struct TodosView: View {
    @Environment(SynapseAppModel.self) private var model
    let navigation: TodoNavigation
    let onRetryTarget: () -> Void
    @State private var deleting: TodoItemDto?

    var body: some View {
        List {
            Section {
                Picker("状态", selection: filterSelection) {
                    ForEach(TodoFilter.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            if navigation.isResolving { ProgressView("读取事项") }
            if let error = navigation.errorMessage ?? model.todos.errorMessage {
                Section {
                    Text(error)
                    Button("重试") {
                        if navigation.errorMessage != nil { onRetryTarget() }
                        else { Task { await model.reloadTodos() } }
                    }
                }
            }
            if let completed = model.todos.undoItem {
                Section {
                    Text("已完成「\(completed.title)」")
                    Button("撤销完成") { Task { await model.undoTodoCompletion() } }
                        .disabled(model.todos.writingIDs.contains(completed.id))
                }
            }
            Section {
                if model.todos.isLoading && model.todos.items.isEmpty { ProgressView() }
                else if model.todos.items.isEmpty && model.todos.errorMessage == nil {
                    ContentUnavailableView(model.todos.filter == .pending ? "没有未完成事项" : "没有待办事项", systemImage: "checklist")
                }
                ForEach(model.todos.items) { item in
                    TodoRow(item: item, busy: model.todos.writingIDs.contains(item.id),
                        onComplete: { Task { await model.completeTodo(item, completed: !item.isCompleted) } },
                        onEdit: { navigation.cancel(); model.todos.openEditor(item) },
                        onDelete: { navigation.cancel(); deleting = item },
                        onCopy: { Clipboard.copy("synapse://todos/\(item.id)", saying: "已复制引用", on: model) })
                }
                if model.todos.nextOffset != nil {
                    Button("加载更多") { Task { await model.loadMoreTodos() } }
                        .disabled(model.todos.isLoadingMore || model.todos.isLoading)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("待办事项")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("新建", systemImage: "plus") { navigation.cancel(); model.todos.openEditor() }
                    .disabled(model.todos.isSaving)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("刷新", systemImage: "arrow.clockwise") { Task { await model.reloadTodos() } }
            }
        }
        .task(id: model.todos.filter) { await model.reloadTodos() }
        .confirmationDialog("删除「\(deleting?.title ?? "")」？", isPresented: deletionPresented, titleVisibility: .visible) {
            Button("删除", role: .destructive) {
                if let item = deleting { Task { await model.removeTodo(item) } }
            }
            Button("取消", role: .cancel) { deleting = nil }
        }
        .onChange(of: model.accountIdentityGeneration) { _, _ in deleting = nil }
    }

    private var filterSelection: Binding<TodoFilter> {
        Binding(get: { model.todos.filter }, set: { filter in
            navigation.cancel()
            model.todos.selectFilter(filter)
        })
    }
    private var deletionPresented: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
    }
}
