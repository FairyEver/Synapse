/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { McpSettingsPanel } from "../mcp-settings-panel"
import type { DatabaseMcpTarget } from "@/types/database"

const mocks = vi.hoisted(() => ({
  databaseMcpHttpStatusGet: vi.fn(),
  databaseMcpServersGet: vi.fn(),
  databaseMcpSettingsOpen: vi.fn(),
  databaseMcpRegister: vi.fn(),
  loggerError: vi.fn(),
  promise: vi.fn(async <T,>(fn: () => Promise<T>) => fn()),
  notify: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: mocks.loggerError,
    info: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    notify: mocks.notify,
    promise: mocks.promise,
  }),
}))

vi.mock("@/modules/database/hooks/use-database", () => ({
  databaseMcpHttpStatusGet: mocks.databaseMcpHttpStatusGet,
  databaseMcpServersGet: mocks.databaseMcpServersGet,
  databaseMcpSettingsOpen: mocks.databaseMcpSettingsOpen,
  databaseMcpRegister: mocks.databaseMcpRegister,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.databaseMcpHttpStatusGet.mockResolvedValue({
    running: true,
    port: 23578,
    url: "http://127.0.0.1:23578/mcp",
  })
  mocks.databaseMcpServersGet.mockResolvedValue([])
  mocks.databaseMcpSettingsOpen.mockResolvedValue({ success: true })
  mocks.databaseMcpRegister.mockResolvedValue({ success: true })
  mocks.databaseMcpHttpStatusGet.mockClear()
  mocks.databaseMcpServersGet.mockClear()
  mocks.databaseMcpSettingsOpen.mockClear()
  mocks.databaseMcpRegister.mockClear()
  mocks.loggerError.mockClear()
  mocks.promise.mockClear()
  mocks.notify.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("McpSettingsPanel", () => {
  it("leaves server loading state after a post-register refresh failure", async () => {
    mocks.databaseMcpServersGet
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("refresh failed"))

    renderPanel()
    await flush()

    const registerButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "注册")
    expect(registerButton).toBeDefined()

    await act(async () => {
      registerButton?.click()
    })
    await flush()

    expect(mocks.databaseMcpRegister).toHaveBeenCalled()
    expect(mocks.databaseMcpServersGet).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain("检测中...")
  })

  it("shows a read failure instead of unregistered for damaged MCP settings", async () => {
    mocks.databaseMcpServersGet.mockResolvedValue([{
      target: "claude" as DatabaseMcpTarget,
      settingsPath: "/Users/test/.claude.json",
      settingsFileExists: true,
      registered: false,
      mode: null,
      url: null,
      readError: "配置读取失败",
    }])

    renderPanel()
    await flush()

    expect(document.body.textContent).toContain("CC/Synapse")
    expect(document.body.textContent).toContain("配置读取失败")
    expect(document.body.textContent).not.toContain("CC/Synapse未注册")
    const registerButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "注册")
    expect(registerButton?.disabled).toBe(true)
  })

  it("disables MCP registration while the HTTP server is not running", async () => {
    mocks.databaseMcpHttpStatusGet.mockResolvedValue({
      running: false,
      port: 0,
      url: null,
    })
    mocks.databaseMcpServersGet.mockResolvedValue([{
      target: "claude" as DatabaseMcpTarget,
      settingsPath: "/Users/test/.claude.json",
      settingsFileExists: true,
      registered: false,
      mode: null,
      url: null,
    }])

    renderPanel()
    await flush()

    const registerButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.textContent === "注册")
    expect(registerButtons.length).toBeGreaterThan(0)
    expect(registerButtons.every((button) => button.disabled)).toBe(true)
    expect(mocks.databaseMcpRegister).not.toHaveBeenCalled()
  })
})

function renderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<McpSettingsPanel />)
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
