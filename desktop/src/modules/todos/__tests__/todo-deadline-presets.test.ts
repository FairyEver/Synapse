import { describe, expect, it } from "vitest"
import { buildTodoDeadlinePresets, getTodoCustomDueDefault } from "../todo-deadline-presets"

describe("todo deadline presets", () => {
  it("builds six local deadline options in calendar order", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 10, 2, 9, 12, 45))
    expect(result.map(({ key, label, localValue, disabled }) => ({ key, label, localValue, disabled }))).toEqual([
      { key: "in-1-hour", label: "1 小时后", localValue: "2026-11-02T10:12", disabled: false },
      { key: "today-afternoon", label: "今天下午", localValue: "2026-11-02T17:00", disabled: false },
      { key: "tomorrow-afternoon", label: "明天下午", localValue: "2026-11-03T17:00", disabled: false },
      { key: "this-week", label: "本周日", localValue: "2026-11-08T17:00", disabled: false },
      { key: "next-monday", label: "下周一", localValue: "2026-11-09T17:00", disabled: false },
      { key: "month-end", label: "本月末", localValue: "2026-11-30T17:00", disabled: false },
    ])
  })

  it("disables absolute presets that are not after the current instant", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 10, 17, 17, 0))
    expect(result.map(({ key, disabled }) => [key, disabled])).toEqual([
      ["in-1-hour", false],
      ["today-afternoon", true],
      ["tomorrow-afternoon", false],
      ["this-week", false],
      ["next-monday", false],
      ["month-end", false],
    ])
  })

  it("keeps the afternoon option available immediately before 17:00", () => {
    const afternoon = buildTodoDeadlinePresets(new Date(2026, 10, 17, 16, 59, 30))
      .find(({ key }) => key === "today-afternoon")
    expect(afternoon).toMatchObject({ localValue: "2026-11-17T17:00", disabled: false })
  })

  it("crosses month boundaries for tomorrow, next Monday and month-end presets", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 11, 31, 23, 20))
    expect(result.filter(({ key }) => ["tomorrow-afternoon", "this-week", "next-monday", "month-end"].includes(key)))
      .toMatchObject([
        { localValue: "2027-01-01T17:00", disabled: false },
        { localValue: "2027-01-03T17:00", disabled: false },
        { localValue: "2027-01-04T17:00", disabled: false },
        { localValue: "2026-12-31T17:00", disabled: true },
      ])
    expect(getTodoCustomDueDefault(new Date(2026, 11, 31, 23, 20))).toMatchObject({
      date: new Date(2027, 0, 1, 17, 0),
      time: "17:00",
    })
  })

  it("uses the leap-day end for a February month-end", () => {
    const monthEnd = buildTodoDeadlinePresets(new Date(2028, 1, 10, 9, 0))
      .find(({ key }) => key === "month-end")
    expect(monthEnd).toMatchObject({ localValue: "2028-02-29T17:00", disabled: false })
  })

  it("uses Sunday 17:00 for this week and disables it at that instant", () => {
    const before = buildTodoDeadlinePresets(new Date(2026, 10, 22, 16, 59, 30))
      .find(({ key }) => key === "this-week")
    expect(before).toMatchObject({ localValue: "2026-11-22T17:00", disabled: false })

    const atBoundary = buildTodoDeadlinePresets(new Date(2026, 10, 22, 17, 0))
      .find(({ key }) => key === "this-week")
    expect(atBoundary).toMatchObject({ localValue: "2026-11-22T17:00", disabled: true })
  })

  it("moves next Monday to the following week when today is Monday", () => {
    const nextMonday = buildTodoDeadlinePresets(new Date(2026, 10, 2, 9, 0))
      .find(({ key }) => key === "next-monday")
    expect(nextMonday).toMatchObject({ localValue: "2026-11-09T17:00", disabled: false })
  })

  it("uses the next 17:00 as the custom default", () => {
    expect(getTodoCustomDueDefault(new Date(2026, 10, 17, 9, 12))).toMatchObject({
      date: new Date(2026, 10, 17, 17, 0),
      time: "17:00",
    })
    expect(getTodoCustomDueDefault(new Date(2026, 10, 17, 17, 0))).toMatchObject({
      date: new Date(2026, 10, 18, 17, 0),
      time: "17:00",
    })
  })
})
