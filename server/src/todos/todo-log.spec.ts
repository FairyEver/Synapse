import { describe, expect, it } from "vitest"
import { todoLogRequest } from "./todo-log"

describe("todo request privacy", () => {
  it("retains only request metadata, never query, body or headers", () => {
    const request = { id: "r1", method: "GET", originalUrl: "/api/todos?query=private-title", query: { query: "private-title" }, body: { title: "private-title", note: "private-note" }, headers: { authorization: "private-token" } }
    expect(todoLogRequest(request)).toEqual({ id: "r1", method: "GET", url: "/api/todos" })
  })
  it("does not claim unrelated routes", () => {
    expect(todoLogRequest({ url: "/api/todos-other?query=x" })).toBeNull()
  })
})
