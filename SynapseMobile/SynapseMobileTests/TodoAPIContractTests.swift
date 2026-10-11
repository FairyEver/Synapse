import Foundation
import Testing
@testable import SynapseMobile

struct TodoAPIContractTests {
    @Test func sharedWireFixtureDecodesWithoutChangingFields() async throws {
        // BEGIN SHARED TODO JSON
        let json = #"""
        {"items":[{"id":"todo_contract-1","title":"提交报告 🧩","note":"  第一行\n第二行  ","dueAt":"2026-10-12T01:00:00.000Z","reminder":"before_due","offsetMinutes":10,"remindAt":"2026-10-12T00:50:00.000Z","reminderGeneration":3,"reminderStatus":"pending","completedAt":null,"version":7,"createdAt":"2026-10-11T00:00:00.000Z","updatedAt":"2026-10-11T12:00:00.000Z"},{"id":"todo_contract-2","title":"完成 é","note":null,"dueAt":null,"reminder":"custom","offsetMinutes":null,"remindAt":"2026-10-12T02:00:00.000Z","reminderGeneration":4,"reminderStatus":"cancelled","completedAt":"2026-10-11T12:05:01.123Z","version":8,"createdAt":"2026-10-11T00:00:00.000Z","updatedAt":"2026-10-11T12:05:01.123Z"}],"nextOffset":null}
        """#
        // END SHARED TODO JSON
        let fixture = TodoTestFixture()
        defer { fixture.clear() }
        fixture.transport.enqueue(.json(200, json))
        let page = try await fixture.api.listTodos(TodoListInput(filter: .all))
        #expect(page.items == [
            TodoItemDto(id: "todo_contract-1", title: "提交报告 🧩", note: "  第一行\n第二行  ", dueAt: "2026-10-12T01:00:00.000Z", reminder: .beforeDue, offsetMinutes: 10,
                remindAt: "2026-10-12T00:50:00.000Z", reminderGeneration: 3, reminderStatus: .pending, completedAt: nil, version: 7,
                createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T12:00:00.000Z"),
            TodoItemDto(id: "todo_contract-2", title: "完成 é", note: nil, dueAt: nil, reminder: .custom, offsetMinutes: nil,
                remindAt: "2026-10-12T02:00:00.000Z", reminderGeneration: 4, reminderStatus: .cancelled, completedAt: "2026-10-11T12:05:01.123Z", version: 8,
                createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T12:05:01.123Z")
        ])
        #expect(page.nextOffset == nil)
    }

    @Test func wireNullPatchAndRetryUUID() async throws {
        let fixture = TodoTestFixture()
        defer { fixture.clear() }
        fixture.transport.enqueue(.json(401, #"{"message":"expired"}"#), .json(200, TodoTestFixture.itemJSON(version: 2)))
        let requestID = UUID()
        let patch = TodoUpdateInput(expectedVersion: 1, clientRequestId: requestID, note: .null)
        _ = try await fixture.api.updateTodo(id: "todo_1", input: patch)
        let requests = fixture.transport.requests
        try #require(requests.count == 2)
        #expect(requests.map(\.method) == ["PATCH", "PATCH"])
        #expect(requests[0].url.path == "/api/todos/todo_1")
        #expect(requests[0].body == requests[1].body)
        let data = try #require(requests[0].body)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["note"] is NSNull)
        #expect(body["dueAt"] == nil && body["title"] == nil && body["reminder"] == nil)
        #expect(body["clientRequestId"] as? String == requestID.uuidString)
        #expect(body["expectedVersion"] as? Int == 1)
    }

    @Test func sixRequestsMatchTheServerContract() async throws {
        let fixture = TodoTestFixture()
        defer { fixture.clear() }
        fixture.transport.enqueue(.json(200, TodoTestFixture.pageJSON([])), .json(200, TodoTestFixture.itemJSON()),
            .json(201, TodoTestFixture.itemJSON()), .json(200, TodoTestFixture.itemJSON(version: 2)),
            .json(200, TodoTestFixture.itemJSON(version: 3, completed: true)), .json(200, #"{"id":"todo_1","version":4,"deleted":true}"#))
        _ = try await fixture.api.listTodos(TodoListInput(filter: .all, query: "报告 &%", offset: 50, limit: 50))
        _ = try await fixture.api.getTodo(id: "todo_1")
        _ = try await fixture.api.createTodo(TodoCreateInput(clientRequestId: UUID(), title: "报告"))
        _ = try await fixture.api.updateTodo(id: "todo_1", input: TodoUpdateInput(expectedVersion: 1, clientRequestId: UUID(), title: "修改"))
        _ = try await fixture.api.setTodoCompleted(id: "todo_1", input: TodoCompletionInput(completed: true, expectedVersion: 2, clientRequestId: UUID()))
        let deleted = try await fixture.api.deleteTodo(id: "todo_1", input: TodoDeleteInput(expectedVersion: 3, clientRequestId: UUID()))
        #expect(deleted.deleted && deleted.version == 4)
        let requests = fixture.transport.requests
        try #require(requests.count == 6)
        #expect(requests.map(\.method) == ["GET", "GET", "POST", "PATCH", "PATCH", "DELETE"])
        #expect(requests.map { $0.url.path } == ["/api/todos", "/api/todos/todo_1", "/api/todos", "/api/todos/todo_1", "/api/todos/todo_1/completion", "/api/todos/todo_1"])
        let query = URLComponents(url: requests[0].url, resolvingAgainstBaseURL: false)?.queryItems
        #expect(query?.first { $0.name == "query" }?.value == "报告 &%")
    }

    @Test func unsupportedServerAndMissingItemAreDifferent() async throws {
        let fixture = TodoTestFixture()
        defer { fixture.clear() }
        fixture.transport.enqueue(.json(404, #"{"message":"Not Found"}"#), .json(404, #"{"code":"TODO_NOT_FOUND","message":"missing"}"#))
        do { _ = try await fixture.api.listTodos(TodoListInput()); Issue.record("list 404 must fail") }
        catch { #expect(TodoText.errorMessage(error, listing: true) == "服务器暂不支持待办事项，请升级服务器。") }
        do { _ = try await fixture.api.getTodo(id: "missing"); Issue.record("get 404 must fail") }
        catch { #expect(TodoText.errorMessage(error) == "事项已删除或无法访问") }
    }
}
