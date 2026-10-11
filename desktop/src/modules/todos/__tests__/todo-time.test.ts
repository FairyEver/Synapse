import { describe, expect, it } from "vitest"
import { todoLocalToUtc, formatTodoInstant } from "../todo-time"
describe("Todo instants", () => {
  it("uses local calendar conversion at minute precision", () => {
    const local = "2030-06-01T14:25"
    expect(todoLocalToUtc(local)).toBe(new Date(local).toISOString())
    expect(todoLocalToUtc("")).toBeNull()
    expect(() => todoLocalToUtc("2030-02-30T10:00")).toThrow()
  })
  it("formats the same instant in system time zones", () => {
    const utc = "2030-06-01T06:25:00.000Z"
    expect(formatTodoInstant(utc, "Asia/Shanghai")).toContain("14:25")
    expect(formatTodoInstant(utc, "America/Los_Angeles")).toContain("23:25")
  })
})
