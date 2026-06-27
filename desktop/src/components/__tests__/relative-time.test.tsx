/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RelativeTime } from "@/components/relative-time"

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
    expect(time?.getAttribute("aria-label")).toBe("2026-06-27 19:58:00")
  })

  it("uses fallback text for missing or invalid timestamps", async () => {
    const missing = await renderRelativeTime(<RelativeTime value={null} />)
    expect(missing.textContent).toBe("-")

    const invalid = await renderRelativeTime(<RelativeTime value="bad-date" fallback="未知" />)
    expect(invalid.textContent).toBe("未知")
  })
})
