import { describe, expect, it, vi } from "vitest"
import { todosIpcModule } from "../ipc"
import { unwrapTodoResult } from "../../shared/ipc-result"
import { todoFixture } from "./fixtures"

describe("Todo typed IPC", () => {
  it("wires only six canonical operations", () => {
    expect(Object.values(todosIpcModule.methods).map((method) => method.operationId)).toEqual([
      "app.todos.item.list", "app.todos.item.get", "app.todos.item.create", "app.todos.item.update", "app.todos.item.set_completed", "app.todos.item.delete",
    ])
    expect(todosIpcModule.methods.create!.request.safeParse({ title: "t", userId: "forged" }).success).toBe(false)
  })
  it("keeps status and code through the IPC response envelope", async () => {
    const service = { get: vi.fn(async () => { throw Object.assign(new Error("事项已被修改，请重新载入"), { status: 409, code: "TODO_VERSION_CONFLICT" }) }) }
    const ctx = { moduleId: "todos", resolve: <T>(id: string): T => (id === "app.todos.cloud" ? service : undefined) as T }
    const result = await todosIpcModule.methods.get!.handler(ctx, { id: "todo-1" })
    expect(() => unwrapTodoResult(result as never)).toThrow()
    try { unwrapTodoResult(result as never) } catch (error) { expect(error).toMatchObject({ status: 409, code: "TODO_VERSION_CONFLICT" }) }
  })
})
