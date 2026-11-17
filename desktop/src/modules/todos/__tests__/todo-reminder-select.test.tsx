/** @vitest-environment jsdom */
import { act, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { flush, mount } from "./harness"
import { TodoReminderSelect } from "../todo-reminder-select"
import type { TodoReminderKind, TodoReminderOffset } from "@synapse/shared/todo-contracts"

function ReminderHarness({
  initialReminder = "none",
  initialOffset = null,
  onChange,
}: {
  initialReminder?: TodoReminderKind
  initialOffset?: TodoReminderOffset | null
  onChange?: (reminder: TodoReminderKind, offsetMinutes: TodoReminderOffset | null) => void
}) {
  const [reminder, setReminder] = useState(initialReminder)
  const [offsetMinutes, setOffsetMinutes] = useState(initialOffset)
  return (
    <>
      <TodoReminderSelect
        reminder={reminder}
        offsetMinutes={offsetMinutes}
        disabled={false}
        onChange={(nextReminder, nextOffset) => {
          setReminder(nextReminder)
          setOffsetMinutes(nextOffset)
          onChange?.(nextReminder, nextOffset)
        }}
      />
      <output>{reminder}:{offsetMinutes ?? "null"}</output>
    </>
  )
}

function reminderSelect() {
  return document.querySelector<HTMLSelectElement>('select[aria-label="提醒"]')!
}

function options() {
  return [...reminderSelect().options].map((option) => ({
    value: option.value,
    label: option.textContent,
    disabled: option.disabled,
  }))
}

describe("TodoReminderSelect", () => {
  it("offers the four supported reminder choices", async () => {
    mount(<ReminderHarness />)
    await flush()

    expect(options()).toEqual([
      { value: "none", label: "不提醒", disabled: false },
      { value: "before_due:10", label: "提前 10 分钟", disabled: false },
      { value: "before_due:30", label: "提前 30 分钟", disabled: false },
      { value: "at_due", label: "截止时提醒", disabled: false },
    ])
  })

  it("selects a 30-minute relative reminder with its offset", async () => {
    const onChange = vi.fn()
    mount(<ReminderHarness onChange={onChange} />)
    await flush()

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(reminderSelect(), "before_due:30")
      reminderSelect().dispatchEvent(new Event("change", { bubbles: true }))
    })
    await flush()

    expect(onChange).toHaveBeenLastCalledWith("before_due", 30)
    expect(document.querySelector("output")?.textContent).toBe("before_due:30")
  })

  it("keeps an existing custom reminder visible but not selectable", async () => {
    mount(<ReminderHarness initialReminder="custom" />)
    await flush()

    expect(reminderSelect().value).toBe("custom")
    expect(options()).toContainEqual({ value: "custom", label: "自定义时间（已有）", disabled: true })
  })

  it.each([
    [60, "提前 1 小时（已有）"],
    [1440, "提前 1 天（已有）"],
  ] as const)("keeps legacy %s-minute offsets visible but not selectable", async (offsetMinutes, label) => {
    mount(<ReminderHarness initialReminder="before_due" initialOffset={offsetMinutes} />)
    await flush()

    expect(options()).toContainEqual({ value: `before_due:${offsetMinutes}`, label, disabled: true })
  })
})
