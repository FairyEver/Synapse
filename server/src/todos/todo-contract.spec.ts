import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { TodoItem } from "@prisma/client"
import type { TodoPageDto } from "@synapse/shared/todo-contracts"
import { describe, expect, it } from "vitest"
import { todoDto } from "./todos.service"

const page: TodoPageDto = JSON.parse(readFileSync(resolve("../shared/fixtures/todo-page.json"), "utf8"))

describe("shared Todo wire fixture", () => {
  it("serializes actual database dates and excludes private persistence fields", () => {
    const items = page.items.map((item) => {
      const row: TodoItem = { ...item, userId: "private-owner", createRequestId: "private-request", createRequestHash: "private-hash", deletedAt: null,
        dueAt: item.dueAt ? new Date(item.dueAt) : null, remindAt: item.remindAt ? new Date(item.remindAt) : null,
        completedAt: item.completedAt ? new Date(item.completedAt) : null, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }
      return todoDto(row)
    })
    expect({ items, nextOffset: null }).toEqual(page)
    expect(JSON.stringify(items)).not.toContain("private-")
  })
})
