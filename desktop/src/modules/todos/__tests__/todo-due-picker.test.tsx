/** @vitest-environment jsdom */
import { useState } from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { flush, mount } from "./harness"
import { TodoDuePicker } from "../todo-due-picker"

vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect(new Date(2026, 10, 18))}>
      选择 11 月 18 日
    </button>
  ),
}))

function PickerHarness({
  initialValue = "",
  onOpenChange,
  onChange,
}: {
  initialValue?: string
  onOpenChange?: (open: boolean) => void
  onChange?: (value: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState(initialValue)
  return (
    <>
      <TodoDuePicker
        open={open}
        value={value}
        onOpenChange={(next) => {
          setOpen(next)
          onOpenChange?.(next)
        }}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
      />
      <output data-testid="due-value">{value}</output>
    </>
  )
}

function buttonByText(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === text)
}

function click(element: HTMLElement) {
  act(() => element.click())
}

afterEach(() => {
  vi.useRealTimers()
})

describe("TodoDuePicker", () => {
  it("keeps passed absolute options visible but disabled and applies a quick option immediately", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 17, 18, 10))
    const onOpenChange = vi.fn()
    const onChange = vi.fn()
    mount(<PickerHarness onOpenChange={onOpenChange} onChange={onChange} />)
    await flush()

    const noon = document.querySelector<HTMLButtonElement>('[data-preset-key="today-noon"]')!
    const evening = document.querySelector<HTMLButtonElement>('[data-preset-key="today-17"]')!
    expect(noon.disabled).toBe(true)
    expect(evening.disabled).toBe(true)
    expect(noon.textContent).toContain("已过")
    expect(evening.textContent).toContain("已过")
    expect(document.querySelector<HTMLButtonElement>('[data-preset-key="in-1-hour"]')!.disabled).toBe(false)

    click(document.querySelector<HTMLButtonElement>('[data-preset-key="in-1-hour"]')!)
    await flush()

    expect(onChange).toHaveBeenLastCalledWith("2026-11-17T19:10")
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it("applies the custom default only after completion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 17, 9, 12))
    const onChange = vi.fn()
    const onOpenChange = vi.fn()
    mount(<PickerHarness onOpenChange={onOpenChange} onChange={onChange} />)
    await flush()

    const customTab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "自定义")
    act(() => customTab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
    await flush()
    expect(document.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe("10:00")
    expect(onChange).not.toHaveBeenCalled()

    click(buttonByText("完成")!)
    await flush()

    expect(onChange).toHaveBeenLastCalledWith("2026-11-17T10:00")
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it("clears an existing deadline without changing other fields", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 17, 9, 12))
    const onChange = vi.fn()
    const onOpenChange = vi.fn()
    mount(<PickerHarness initialValue="2026-11-18T12:00" onOpenChange={onOpenChange} onChange={onChange} />)
    await flush()

    const customTab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "自定义")
    act(() => customTab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
    await flush()
    expect(document.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe("12:00")
    click(buttonByText("清除截止时间")!)
    await flush()

    expect(onChange).toHaveBeenLastCalledWith("")
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})
