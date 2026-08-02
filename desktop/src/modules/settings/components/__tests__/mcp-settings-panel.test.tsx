/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { McpTarget } from "@/types/mcp"
import { McpSettingsPanel } from "../mcp-settings-panel"

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  mcpRegistrationOpenSettings: vi.fn(),
  mcpRegistrationRegister: vi.fn(),
  mcpRegistrationsList: vi.fn(),
  mcpServerGet: vi.fn(),
  notify: vi.fn(),
  promise: vi.fn(async <T,>(operation: () => Promise<T>) => operation()),
  writeText: vi.fn(),
}))

vi.mock("@/definitions/generated/renderer-registry", () => ({
  mcpDefinitions: [
    { target: "claude", label: "CC/Synapse", icon: "claude.png", order: 10 },
    { target: "cursor", label: "Cursor", icon: "cursor.png", order: 20 },
  ],
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

vi.mock("../../hooks/use-mcp", () => ({
  mcpRegistrationOpenSettings: mocks.mcpRegistrationOpenSettings,
  mcpRegistrationRegister: mocks.mcpRegistrationRegister,
  mcpRegistrationsList: mocks.mcpRegistrationsList,
  mcpServerGet: mocks.mcpServerGet,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.mcpServerGet.mockReset()
  mocks.mcpServerGet.mockResolvedValue({
    running: true,
    port: 23578,
    url: "http://127.0.0.1:23578/mcp",
  })
  mocks.mcpRegistrationsList.mockReset()
  mocks.mcpRegistrationsList.mockResolvedValue([])
  mocks.mcpRegistrationOpenSettings.mockReset()
  mocks.mcpRegistrationOpenSettings.mockResolvedValue({ success: true })
  mocks.mcpRegistrationRegister.mockReset()
  mocks.mcpRegistrationRegister.mockResolvedValue({ success: true })
  mocks.loggerError.mockClear()
  mocks.promise.mockClear()
  mocks.notify.mockClear()
  mocks.writeText.mockReset()
  mocks.writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("McpSettingsPanel", () => {
  it("shows the running server, HTTP and stdio registrations, and copies the URL", async () => {
    mocks.mcpRegistrationsList.mockResolvedValue([
      registration({ target: "claude", registered: true, mode: "http" }),
      registration({ target: "cursor", registered: true, mode: "stdio" }),
    ])

    renderPanel()
    await flush()

    expect(document.body.textContent).toContain("运行中")
    expect(document.body.textContent).toContain("http://127.0.0.1:23578/mcp")
    expect(document.body.textContent).toContain("已注册")
    expect(document.body.textContent).toContain("需更新")

    await clickButton("复制")
    expect(mocks.writeText).toHaveBeenCalledWith("http://127.0.0.1:23578/mcp")
  })

  it("shows an actionable server status failure and retries", async () => {
    mocks.mcpServerGet
      .mockRejectedValueOnce(new Error("status failed"))
      .mockResolvedValueOnce({
        running: true,
        port: 23578,
        url: "http://127.0.0.1:23578/mcp",
      })

    renderPanel()
    await flush()

    expect(document.body.textContent).toContain("状态读取失败")
    await clickButton("重试")
    await flush()

    expect(mocks.mcpServerGet).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("运行中")
  })

  it("disables registration while the MCP server is not running", async () => {
    mocks.mcpServerGet.mockResolvedValue({ running: false, port: 0, url: "" })
    mocks.mcpRegistrationsList.mockResolvedValue([registration({ target: "claude" })])

    renderPanel()
    await flush()

    expect(document.body.textContent).toContain("未启动")
    expect(findButtons("注册").every((button) => button.disabled)).toBe(true)
  })

  it("shows a registration read failure instead of unregistered", async () => {
    mocks.mcpRegistrationsList.mockResolvedValue([
      registration({ target: "claude", readError: "配置读取失败" }),
    ])

    renderPanel()
    await flush()

    expect(document.body.textContent).toContain("配置读取失败")
    expect(findButton("注册")?.disabled).toBe(true)
  })

  it("opens an existing client settings file", async () => {
    mocks.mcpRegistrationsList.mockResolvedValue([
      registration({ target: "claude", settingsFileExists: true }),
    ])

    renderPanel()
    await flush()
    await clickButton("打开文件", 0)

    expect(mocks.mcpRegistrationOpenSettings).toHaveBeenCalledWith("claude")
  })

  it("registers a client and refreshes its state", async () => {
    mocks.mcpRegistrationsList
      .mockResolvedValueOnce([registration({ target: "claude" })])
      .mockResolvedValueOnce([registration({ target: "claude", registered: true, mode: "http" })])

    renderPanel()
    await flush()
    await clickButton("注册")
    await flush()

    expect(mocks.mcpRegistrationRegister).toHaveBeenCalledWith("claude")
    expect(mocks.mcpRegistrationsList).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("已注册")
  })

  it("leaves the loading state after a post-registration refresh failure", async () => {
    mocks.mcpRegistrationsList
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("refresh failed"))

    renderPanel()
    await flush()
    await clickButton("注册")
    await flush()

    expect(mocks.mcpRegistrationRegister).toHaveBeenCalled()
    expect(mocks.mcpRegistrationsList).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain("检测中...")
  })

  it("falls back to unregistered rows when the registration list fails", async () => {
    mocks.mcpRegistrationsList.mockRejectedValue(new Error("list failed"))

    renderPanel()
    await flush()

    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Failed to load MCP registrations.",
      expect.any(Error),
    )
    expect(document.body.textContent).toContain("未注册")
    expect(document.body.textContent).not.toContain("检测中...")
  })
})

function registration(overrides: {
  target: string
  settingsFileExists?: boolean
  registered?: boolean
  mode?: "http" | "stdio" | null
  readError?: string
}) {
  return {
    target: overrides.target as McpTarget,
    settingsPath: `/Users/test/.${overrides.target}.json`,
    settingsFileExists: overrides.settingsFileExists ?? true,
    registered: overrides.registered ?? false,
    mode: overrides.mode ?? null,
    url: overrides.registered ? "http://127.0.0.1:23578/mcp" : null,
    ...(overrides.readError ? { readError: overrides.readError } : {}),
  }
}

function renderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<McpSettingsPanel />)
  })
}

function findButton(label: string, index = 0): HTMLButtonElement | undefined {
  return findButtons(label)[index]
}

function findButtons(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => button.textContent === label)
}

async function clickButton(label: string, index = 0): Promise<void> {
  const button = findButton(label, index)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
