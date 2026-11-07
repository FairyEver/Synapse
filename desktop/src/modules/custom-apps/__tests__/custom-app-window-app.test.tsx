/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ComponentProps, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/modules/apps/components/system-app-top-bar", () => ({
  SystemAppTopBarActionButton: ({
    children,
    iconOnly: _iconOnly,
    tooltip,
    ...props
  }: ComponentProps<"button"> & {
    readonly iconOnly?: boolean
    readonly tooltip?: ReactNode
  }) => <button data-tooltip={tooltip ? String(tooltip) : ""} {...props}>{children}</button>,
}))

import { WebAppToolbarActions } from "../web-app-toolbar-actions"

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("WebAppToolbarActions", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("renders only back, forward, reload and open-in-browser actions", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(
      <WebAppToolbarActions
        state={{
          canGoBack: true,
          canGoForward: false,
          isLoading: false,
          currentUrl: "https://example.com/read",
          error: "none",
        }}
        onAction={onAction}
      />,
    ))

    expect(document.querySelector('[aria-label="后退"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="前进"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="刷新"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="在浏览器打开"]')).not.toBeNull()
    expect(document.querySelector('[role="textbox"]')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[aria-label="前进"]')?.disabled).toBe(true)
  })

  it("omits text tooltips for dedicated web app windows", async () => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(
      <WebAppToolbarActions
        showTooltips={false}
        state={{
          canGoBack: false,
          canGoForward: false,
          isLoading: false,
          currentUrl: "https://example.com/read",
          error: "none",
        }}
      />,
    ))

    expect([...document.querySelectorAll<HTMLButtonElement>("button")]
      .map((button) => button.dataset.tooltip)).toEqual(["", "", "", ""])
  })
})
