/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connectors: {
    item: {
      list: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      retry: vi.fn(),
      onChanged: vi.fn(() => vi.fn()),
    },
  },
  openExternal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "connectors") return mocks.connectors
    if (domain === "shell") return { openExternal: mocks.openExternal }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("sonner", () => ({ toast: mocks.toast }))

vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { ConnectorsModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

const figmaItem = {
  id: "figma",
  name: "Figma",
  description: "连接 Figma Desktop MCP",
  documentationUrl: "https://synapse.d2.pub/document/connectors/figma",
  enabled: false,
  probeStatus: "idle" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connectors.item.list.mockResolvedValue({ items: [figmaItem] })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots.length = 0
  document.body.innerHTML = ""
})

describe("ConnectorsModule", () => {

  it("does not claim connection success when opening the browser and allows cancellation", async () => {
    const item = { id: "portal-headless-test", name: "Portal Headless Test", enabled: false, probeStatus: "idle", connectionStatus: "disconnected" }
    mocks.connectors.item.list.mockResolvedValue({ items: [item] })
    mocks.connectors.item.connect.mockImplementation(async () => {
      const pending = { ...item, enabled: true, probeStatus: "checking", connectionStatus: "connecting" }
      mocks.connectors.item.list.mockResolvedValue({ items: [pending] })
      return pending
    })
    renderModule()
    await act(async () => { await Promise.resolve() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[role="switch"]')?.click() })
    expect(document.body.textContent).toContain("连接中")
    expect(document.body.textContent).not.toContain("已连接")
    expect(mocks.toast.success).not.toHaveBeenCalled()
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(toggle.disabled).toBe(false)
    await act(async () => { toggle.click() })
    expect(mocks.connectors.item.disconnect).toHaveBeenCalledWith({ id: item.id })
  })

  it("shows only the verified summary and offers retry/reconnection", async () => {
    const item = { id: "portal-headless-test", name: "Portal Headless Test", enabled: true, probeStatus: "ready", connectionStatus: "connected",
      account: { portalUserId: "42", tenantId: "2", displayName: "测试账号", tenantName: "测试企业", connectedAt: "now", lastValidatedAt: "now" } }
    mocks.connectors.item.list.mockResolvedValue({ items: [item] })
    renderModule()
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain("已连接")
    expect(document.body.textContent).toContain("测试账号 · 测试企业")
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "重新连接")?.click() })
    expect(mocks.connectors.item.connect).toHaveBeenCalledWith({ id: item.id })
  })

  it("replaces the setup hint with a documentation link", async () => {
    renderModule()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Figma")
    expect(document.body.textContent).not.toContain("连接 Figma Desktop MCP")
    expect(document.body.textContent).toContain("更多信息")
    expect(document.body.textContent).not.toContain("查看 Figma 连接器文档")
    expect(document.body.textContent).not.toContain("请先在 Figma Desktop 的 Dev Mode 中开启 MCP Server")

    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent?.includes("更多信息"))
    expect(button).toBeDefined()

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(mocks.openExternal).toHaveBeenCalledWith(figmaItem.documentationUrl)
  })

  it("keeps the documentation link visible after activation", async () => {
    mocks.connectors.item.list.mockResolvedValue({ items: [{ ...figmaItem, enabled: true, probeStatus: "ready" }] })
    renderModule()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("更多信息")
    expect(document.body.textContent).not.toContain("仅对新建对话生效")
  })

  it("uses connector definition fields for activation", async () => {
    const item = {
      ...figmaItem,
      id: "design-tool",
      name: "Design Tool",
      documentationUrl: "https://example.test/design-tool",
    }
    mocks.connectors.item.list.mockResolvedValue({ items: [item] })
    mocks.connectors.item.connect.mockResolvedValue({ ...item, enabled: true, probeStatus: "ready" })
    renderModule()

    await act(async () => {
      await Promise.resolve()
    })
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')
    await act(async () => {
      toggle?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Design Tool")
    expect(mocks.connectors.item.connect).toHaveBeenCalledWith({ id: "design-tool" })
    expect(mocks.toast.success).toHaveBeenCalledWith("Design Tool MCP 已激活")
  })
})

function renderModule() {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(<ConnectorsModule />))
}
