import { describe, expect, it } from "vitest"
import { todoCreateSchema, todoUpdateSchema, todoListSchema, normalizeTodoFields } from "./todo.schemas"

const key = "00000000-0000-4000-8000-000000000001"
const now = new Date("2026-10-11T00:00:00Z")
const create = (extra: Record<string, unknown> = {}) => ({ title: " 测试事项 ", clientRequestId: key, ...extra })

describe("todo strict input and candidate validation", () => {
  it("accepts 200 code points and rejects 201, rather than counting UTF-16", () => {
    expect(todoCreateSchema.safeParse(create({ title: "😀".repeat(200) })).success).toBe(true)
    expect(todoCreateSchema.safeParse(create({ title: "😀".repeat(201) })).success).toBe(false)
    expect(todoCreateSchema.safeParse(create({ note: "😀".repeat(10000) })).success).toBe(true)
    expect(todoCreateSchema.safeParse(create({ note: "😀".repeat(10001) })).success).toBe(false)
  })
  it("applies the title limit after trimming surrounding whitespace", () => {
    expect(todoCreateSchema.safeParse(create({ title: " " + "😀".repeat(200) + " " })).success).toBe(true)
  })
  it.each(["", "  ", "\ud800", "a\0b"])("rejects empty or invalid titles: %j", (title) => {
    expect(todoCreateSchema.safeParse(create({ title })).success).toBe(false)
  })
  it("normalizes title, blank note, and UTC timestamps", () => {
    expect(todoCreateSchema.parse(create({ note: " ", dueAt: "2026-10-12T09:00:00+08:00" }))).toMatchObject({
      title: "测试事项", note: null, dueAt: "2026-10-12T01:00:00.000Z",
    })
  })
  it.each([{ userId: "other" }, { completedAt: now.toISOString() }, { offsetMinutes: 15 }, { dueAt: "2026-02-30T09:00:00Z" }, { remindAt: "2026-10-12T01:00:01Z" }])("rejects undeclared or invalid fields: %j", (extra) => {
    expect(todoCreateSchema.safeParse(create(extra)).success).toBe(false)
  })
  it("distinguishes retaining a patch field from clearing it", () => {
    const input = todoUpdateSchema.parse({ note: null, expectedVersion: 1, clientRequestId: key })
    expect(Object.hasOwn(input, "dueAt")).toBe(false)
    expect(input.note).toBeNull()
    expect(todoUpdateSchema.safeParse({ title: null, expectedVersion: 1, clientRequestId: key }).success).toBe(false)
  })
  it("validates pagination and literal query limits", () => {
    expect(todoListSchema.parse({})).toEqual({ filter: "pending", offset: 0, limit: 50 })
    expect(todoListSchema.safeParse({ limit: "101" }).success).toBe(false)
    expect(todoListSchema.safeParse({ offset: "-1" }).success).toBe(false)
    expect(todoListSchema.safeParse({ query: "😀".repeat(201) }).success).toBe(false)
  })
  it("requires due time for relative reminders and future reminder instants", () => {
    expect(() => normalizeTodoFields({ title: "事项", reminder: "at_due" }, null, now)).toThrow()
    expect(() => normalizeTodoFields({ title: "事项", reminder: "custom", remindAt: "2026-10-10T01:00:00Z" }, null, now)).toThrow()
    expect(normalizeTodoFields({ title: "事项", reminder: "custom", remindAt: "2026-10-12T01:00:00Z" }, null, now).dueAt).toBeNull()
  })
  it("computes exact relative offsets and rejects clearing the required due time", () => {
    const fields = normalizeTodoFields({ title: "事项", dueAt: "2026-10-12T01:00:00Z", reminder: "before_due", offsetMinutes: 60 }, null, now)
    expect(fields.remindAt?.toISOString()).toBe("2026-10-12T00:00:00.000Z")
    expect(() => normalizeTodoFields({ dueAt: null }, fields, now)).toThrow()
  })
  it("allows past due time and keeps a previously sent reminder when only editing text", () => {
    const current = normalizeTodoFields({ title: "事项", dueAt: "2026-10-12T01:00:00Z", reminder: "at_due" }, null, now)
    expect(normalizeTodoFields({ title: "修改" }, current, new Date("2026-10-13T00:00:00Z")).remindAt?.toISOString()).toBe("2026-10-12T01:00:00.000Z")
    expect(normalizeTodoFields({ title: "事项", dueAt: "2026-10-10T01:00:00Z" }, null, now).reminder).toBe("none")
  })
})
