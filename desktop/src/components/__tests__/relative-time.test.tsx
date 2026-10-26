/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RelativeTime, formatExactDateTime } from "@/components/relative-time"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.useRealTimers()
})

async function renderRelativeTime(element: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(element)
  })
  return container
}

describe("RelativeTime", () => {
  it("renders a past timestamp as relative text with exact date metadata", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-27T12:00:00.000Z"))

    const container = await renderRelativeTime(
      <RelativeTime value="2026-06-27T11:58:00.000Z" />
    )

    const time = container.querySelector("time")
    expect(time?.textContent).toBe("2 分钟前")
    expect(time?.getAttribute("dateTime")).toBe("2026-06-27T11:58:00.000Z")
    expect(time?.getAttribute("aria-label")).toBe(
      formatExactDateTime(new Date("2026-06-27T11:58:00.000Z")),
    )
  })

  it("uses fallback text for missing or invalid timestamps", async () => {
    const missing = await renderRelativeTime(<RelativeTime value={null} />)
    expect(missing.textContent).toBe("-")

    const invalid = await renderRelativeTime(<RelativeTime value="bad-date" fallback="未知" />)
    expect(invalid.textContent).toBe("未知")
  })

  it.each([
    ["2026-10-27T11:59:30", "刚刚"],
    ["2026-10-27T11:58:00", "2 分钟前"],
    ["2026-10-27T11:00:01", "59 分钟前"],
    ["2026-10-27T11:00:00", "1 小时前"],
    ["2026-10-27T10:00:01", "1 小时前"],
    ["2026-10-27T09:00:00", "3 小时前"],
    ["2026-10-26T23:59:00", "昨天"],
    ["2026-10-25T23:59:00", "前天"],
    ["2026-10-24T23:59:00", "10.24"],
    ["2026-01-05T12:00:00", "01.05"],
    ["2025-10-27T12:00:00", "10.27"],
    ["2026-10-27T13:00:00", "10.27"],
  ])("renders calendar time for %s as %s", async (value, expected) => {
    const container = await renderRelativeTime(
      <RelativeTime value={value} mode="calendar" now={new Date(2026, 9, 27, 12)} />
    )
    expect(container.querySelector("time")?.textContent).toBe(expected)
  })

  it.each([
    ["2026-01-01T00:05:00", "2025-12-31T23:59:00", "昨天"],
    ["2026-01-01T00:05:00", "2025-12-30T23:59:00", "前天"],
    ["2026-01-01T00:05:00", "2025-12-29T23:59:00", "12.29"],
    ["2026-03-01T00:05:00", "2026-02-28T23:59:00", "昨天"],
  ])("uses local calendar days across month and year boundaries", async (now, value, expected) => {
    const container = await renderRelativeTime(
      <RelativeTime value={value} mode="calendar" now={new Date(now)} />
    )
    expect(container.querySelector("time")?.textContent).toBe(expected)
  })

  it("can render exact date metadata without a tooltip trigger", async () => {
    const container = await renderRelativeTime(
      <RelativeTime value="2026-06-27T11:58:00.000Z" showTooltip={false} />
    )

    const time = container.querySelector("time")
    expect(time?.getAttribute("aria-label")).toBe(
      formatExactDateTime(new Date("2026-06-27T11:58:00.000Z")),
    )
    expect(time?.getAttribute("data-slot")).toBeNull()
  })
})
