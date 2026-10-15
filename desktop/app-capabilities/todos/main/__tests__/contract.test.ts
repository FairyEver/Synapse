import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { todosIpcModule } from "../ipc"
import { TODOS_CAPABILITY_IDS as capabilityActions } from "../../shared/capability"
import { todoPageSchema } from "../../shared/schema"
import { buildTodoTools } from "../../../../synapse-capabilities/shared/todos-domain"
import { MCP_TOOL_ACTIONS } from "../../../../synapse-capabilities/shared/registry"
import { validateSystemNotificationInput } from "../../../system-notifier/shared/schema"

const page: unknown = JSON.parse(readFileSync(new URL("../../../../../shared/fixtures/todo-page.json", import.meta.url), "utf8"))

describe("Todo cross-layer contract", () => {
  it("preserves the same DTO through strict desktop decoding and the UI result envelope", () => {
    expect(todoPageSchema.parse(page)).toEqual(page)
    expect(todosIpcModule.methods.list!.response.parse({ ok: true, data: page })).toEqual({ ok: true, data: page })
  })
  it("maps the same six capabilities to the UI bridge and the MCP index", () => {
    expect(capabilityActions).toHaveLength(6)
    expect(Object.values(todosIpcModule.methods).map((method) => method.operationId)).toEqual(capabilityActions)
    expect(buildTodoTools().map((tool) => MCP_TOOL_ACTIONS[tool.name])).toEqual(capabilityActions)
  })
  it("does not widen the public System Notifier request to allow Todo-owned metadata", () => {
    expect(validateSystemNotificationInput({ title: "待办提醒", body: "事项" }).ok).toBe(true)
    for (const metadata of [{ source: "todo-reminder" }, { sourceKey: "todo:id:1" }, { target: { id: "todo" } }]) {
      expect(validateSystemNotificationInput({ title: "待办提醒", body: "事项", ...metadata })).toMatchObject({ ok: false, data: { field: "request", reason: "unknown_field" } })
    }
    // `url` 不再是这一类：它已经成了通知的合法字段（只收 https）。但 Todo 的深链照样进不去，
    // 只是理由换成了它自己的那一个 —— 这条断言守的是同一件事。
    expect(validateSystemNotificationInput({ title: "待办提醒", body: "事项", url: "synapse://todos/todo" }))
      .toMatchObject({ ok: false, data: { field: "url", reason: "not_https" } })
  })
})
