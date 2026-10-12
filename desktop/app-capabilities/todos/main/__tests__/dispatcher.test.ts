import { describe, expect, it, vi } from "vitest"
import { createTodoCapabilityDispatcher } from "../dispatcher"
import { todoFixture } from "./fixtures"

describe("Todo dispatcher", () => {
  it("denies network access before the operation and audits no content", async () => {
    const service = { create: vi.fn() }
    const record = vi.fn()
    const dispatcher = createTodoCapabilityDispatcher({ service: service as never, permissionGuard: { check: async () => ({ allowed: false, reason: "denied" }) } as never, auditSink: { record } as never })
    await expect(dispatcher.dispatch("app.todos.item.create", { title: "private-title", note: "private-note", clientRequestId: "32a7370b-3b19-4bd3-b3a5-99016bb2fc37" }, { source: "mcp-http" })).rejects.toThrow("denied")
    expect(service.create).not.toHaveBeenCalled()
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/private-title|private-note/u)
  })
  it("passes a unique reference to the same service and keeps conflict codes", async () => {
    const get = vi.fn(async () => todoFixture)
    const record = vi.fn()
    const dispatcher = createTodoCapabilityDispatcher({ service: { get } as never, auditSink: { record } as never })
    await expect(dispatcher.dispatch("app.todos.item.get", { reference: "synapse://todos/todo-1" }, {})).resolves.toEqual({ ok: true, data: todoFixture })
    expect(get).toHaveBeenCalledWith({ reference: "synapse://todos/todo-1" })
    await expect(dispatcher.dispatch("app.todos.item.get", { id: "todo-1", reference: "synapse://todos/todo-1" }, {})).rejects.toThrow()
  })
})
