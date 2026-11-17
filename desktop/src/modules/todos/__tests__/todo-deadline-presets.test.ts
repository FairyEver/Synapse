import { describe, expect, it } from "vitest"
import { buildTodoDeadlinePresets, getTodoCustomDueDefault } from "../todo-deadline-presets"

describe("todo deadline presets", () => {
  it("builds six local deadline options from the current minute", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 10, 17, 9, 12, 45))
    expect(result.map(({ key, label, localValue, disabled }) => ({ key, label, localValue, disabled }))).toEqual([
      { key: "in-1-hour", label: "1 小时后", localValue: "2026-11-17T10:12", disabled: false },
      { key: "today-noon", label: "今天中午", localValue: "2026-11-17T12:00", disabled: false },
      { key: "today-17", label: "今天 17:00", localValue: "2026-11-17T17:00", disabled: false },
      { key: "tomorrow-noon", label: "明天中午", localValue: "2026-11-18T12:00", disabled: false },
      { key: "in-1-day", label: "1 天后", localValue: "2026-11-18T09:12", disabled: false },
      { key: "in-2-days", label: "2 天后", localValue: "2026-11-19T09:12", disabled: false },
    ])
  })

  it("disables absolute presets that are not after the current instant", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 10, 17, 17, 0))
    expect(result.map(({ key, disabled }) => [key, disabled])).toEqual([
      ["in-1-hour", false],
      ["today-noon", true],
      ["today-17", true],
      ["tomorrow-noon", false],
      ["in-1-day", false],
      ["in-2-days", false],
    ])
  })

  it("keeps noon available immediately before noon", () => {
    const noon = buildTodoDeadlinePresets(new Date(2026, 10, 17, 11, 59, 30))
      .find(({ key }) => key === "today-noon")
    expect(noon).toMatchObject({ localValue: "2026-11-17T12:00", disabled: false })
  })

  it("crosses month boundaries for relative and next-day presets", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 11, 31, 23, 20))
    expect(result.filter(({ key }) => ["tomorrow-noon", "in-1-day", "in-2-days"].includes(key)))
      .toMatchObject([
        { localValue: "2027-01-01T12:00" },
        { localValue: "2027-01-01T23:20" },
        { localValue: "2027-01-02T23:20" },
      ])
    expect(getTodoCustomDueDefault(new Date(2026, 11, 31, 23, 20))).toMatchObject({
      date: new Date(2027, 0, 1, 0, 0),
      time: "00:00",
    })
  })
})
