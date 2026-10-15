/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { SystemNotifierNodePanel } from "../panel"
import type { SystemNotifierNodeConfig } from "../schema"

vi.mock("@/lib/ui-tracking", () => ({ track: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const COPY_ON_TAP_ID = "#system-notifier-node-copy-on-tap"

function renderPanel(config: SystemNotifierNodeConfig, onChange: (config: SystemNotifierNodeConfig) => void) {
  const container = document.createElement("div")
  const root = createRoot(container)
  act(() => {
    root.render(
      <SystemNotifierNodePanel
        config={config}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )
  })
  return { container, root }
}

describe("SystemNotifierNodePanel", () => {
  it("turns copy-on-tap on without disturbing the rest of the config", () => {
    const onChange = vi.fn()
    const { container, root } = renderPanel(
      { title: "标题", body: "正文", variables: [], copyOnTap: false },
      onChange,
    )

    const control = container.querySelector<HTMLButtonElement>(COPY_ON_TAP_ID)
    expect(control).not.toBeNull()
    expect(container.textContent).toContain("点按复制正文")
    expect(control?.getAttribute("data-state")).toBe("unchecked")

    act(() => {
      control?.click()
    })

    expect(onChange).toHaveBeenCalledWith({
      title: "标题",
      body: "正文",
      variables: [],
      copyOnTap: true,
    })
    act(() => root.unmount())
  })

  it("shows an existing copy-on-tap config as on, and turns it back off", () => {
    const onChange = vi.fn()
    const { container, root } = renderPanel(
      { title: "标题", body: "正文", variables: [], copyOnTap: true },
      onChange,
    )

    const control = container.querySelector<HTMLButtonElement>(COPY_ON_TAP_ID)
    expect(control?.getAttribute("data-state")).toBe("checked")

    act(() => {
      control?.click()
    })

    expect(onChange).toHaveBeenCalledWith({
      title: "标题",
      body: "正文",
      variables: [],
      copyOnTap: false,
    })
    act(() => root.unmount())
  })
})
