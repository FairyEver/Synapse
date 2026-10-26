/** @vitest-environment jsdom */
import { mount, summary } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { MailList } from "../message-list"

afterEach(() => vi.useRealTimers())

function renderMail(date: string | null, onSelect = vi.fn()) {
  mount(<MailList items={[{ ...summary, date }]} drafts={[]} loading={false} more={false} onSelect={onSelect} onDraft={vi.fn()} onMore={vi.fn()} onBatch={vi.fn()} folders={[]} onMove={vi.fn()} />)
}

it("shows a compact mail date and the exact timestamp in a hover tooltip", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 27, 12))
  const onSelect = vi.fn()
  renderMail("2026-10-26T23:45:12", onSelect)
  const time = document.querySelector("time")!
  expect(time?.textContent).toBe("昨天")
  expect(time?.getAttribute("aria-label")).toBe("2026-10-26 23:45:12")
  expect(time?.getAttribute("dateTime")).toBe(new Date(2026, 9, 26, 23, 45, 12).toISOString())

  const hover = new MouseEvent("pointermove", { bubbles: true })
  Object.defineProperty(hover, "pointerType", { value: "mouse" })
  await act(async () => {
    time.dispatchEvent(hover)
    vi.advanceTimersByTime(1000)
  })
  expect(document.querySelector('[data-slot="tooltip-content"]')?.firstChild?.textContent).toBe("2026-10-26 23:45:12")
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("2026-10-26 23:45:12")
  expect(onSelect).not.toHaveBeenCalled()
  act(() => time.click())
  expect(onSelect).toHaveBeenCalledWith(summary.id)
})

it("updates relative minutes and rolls over at local midnight without reloading mail", () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 27, 23, 58, 30))
  renderMail("2026-10-27T23:57:00")
  expect(document.querySelector("time")?.textContent).toBe("1 分钟前")
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.querySelector("time")?.textContent).toBe("2 分钟前")
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.querySelector("time")?.textContent).toBe("昨天")

  vi.setSystemTime(new Date(2026, 9, 29, 12))
  act(() => window.dispatchEvent(new Event("focus")))
  expect(document.querySelector("time")?.textContent).toBe("前天")
  vi.setSystemTime(new Date(2026, 9, 30, 12))
  act(() => window.dispatchEvent(new Event("focus")))
  expect(document.querySelector("time")?.textContent).toBe("10.27")
})

it.each([null, "invalid-date"])("keeps a missing or invalid mail date blank", date => {
  renderMail(date)
  expect(document.querySelector("time")).toBeNull()
  expect(document.body.textContent).not.toContain("Invalid Date")
})
