/**
 * @vitest-environment jsdom
 */
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

    const wrapper = document.createElement("div")
    wrapper.innerHTML = html
    const spinnerCell = wrapper.querySelector<HTMLElement>("[aria-label='正在输出']")

    expect(spinnerCell?.className).toContain("size-6")
    expect(spinnerCell?.className).toContain("place-items-center")
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

    const wrapper = document.createElement("div")
    wrapper.innerHTML = html
    const unreadCell = wrapper.querySelector<HTMLElement>("[aria-label='未读']")

    expect(unreadCell?.className).toContain("size-6")
    expect(unreadCell?.className).toContain("place-items-center")
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

  it("uses a fixed icon button cell for delete actions", () => {
    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={0}
        running={false}
        canDelete
        onDelete={vi.fn()}
      />,
    )

    const wrapper = document.createElement("div")
    wrapper.innerHTML = html
    const button = wrapper.querySelector<HTMLButtonElement>("button[title='删除会话']")
    const actionCell = button?.parentElement

    expect(actionCell?.className).toContain("size-6")
    expect(actionCell?.className).toContain("place-items-center")
    expect(button?.getAttribute("data-variant")).toBe("ghost")
    expect(button?.getAttribute("data-size")).toBe("icon-xs")
  })
})
