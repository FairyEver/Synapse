import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { formatExactDateTime } from "@/components/relative-time"

import { SessionTrailing } from "../session-trailing"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("SessionTrailing", () => {
  it("omits malformed Agent session timestamps instead of rendering NaN", () => {
    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="not-a-date"
        unread={0}
        running={false}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).not.toContain("NaN")
  })

  it("shows a running spinner before unread state or relative time", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-04T06:00:00.000Z").getTime())

    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={3}
        running
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("animate-spin")
    expect(html).toContain("正在输出")
    expect(html).not.toContain("未读")
    expect(html).not.toContain(">3<")
    expect(html).not.toContain("2 分钟前")
  })

  it("shows an unread dot without a numeric badge after completion", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-04T06:00:00.000Z").getTime())

    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={3}
        running={false}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("bg-blue-500")
    expect(html).toContain("未读")
    expect(html).not.toContain(">3<")
    expect(html).not.toContain("2 分钟前")
  })

  it("shows relative time when completed and read", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-04T06:00:00.000Z").getTime())

    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={0}
        running={false}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("2 分钟前")
    expect(html).toContain(
      `aria-label="${formatExactDateTime(new Date("2026-06-04T05:58:00.000Z"))}"`,
    )
    expect(html).not.toContain("animate-spin")
    expect(html).not.toContain("未读")
  })
})
