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

import { ConnectorsModule, FIGMA_DOCUMENTATION_URL } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

const figmaItem = {
  id: "figma",
  providerKey: "figma",
  name: "Figma",
  description: "连接 Figma Desktop MCP",
  endpoint: "http://127.0.0.1:3845/mcp",
  authType: "none" as const,
  status: "available" as const,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
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
  it("replaces the setup hint with a documentation link", async () => {
    renderModule()

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Figma Desktop")
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

    expect(mocks.openExternal).toHaveBeenCalledWith(FIGMA_DOCUMENTATION_URL)
  })
})

function renderModule() {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(<ConnectorsModule />))
}
