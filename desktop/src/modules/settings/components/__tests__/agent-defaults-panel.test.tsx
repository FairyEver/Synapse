/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "@/lib/config"
import { AgentDefaultsPanel } from "../agent-defaults-panel"

const mocks = vi.hoisted(() => ({
  config: undefined as unknown,
  error: vi.fn(),
  info: vi.fn(),
  listProviders: vi.fn().mockResolvedValue([]),
  promise: vi.fn(async <T,>(fn: () => Promise<T>) => fn()),
  updateConfig: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.config,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: mocks.error,
    info: mocks.info,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: mocks.promise,
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    agent: {
      listProviders: mocks.listProviders,
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.config = createDefaultConfig()
  mocks.error.mockReset()
  mocks.info.mockReset()
  mocks.promise.mockClear()
  mocks.updateConfig.mockReset()
  mocks.updateConfig.mockResolvedValue(createDefaultConfig())
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

describe("AgentDefaultsPanel", () => {
  it("saves selected default permission mode from dropdown", async () => {
    renderPanel()

    openPermissionMenu()
    await clickPermissionMode("plan")

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { defaultPermissionMode: "plan" },
    })
  })

  it("confirms before using bypassPermissions as the default permission mode", async () => {
    renderPanel()

    openPermissionMenu()
    await clickPermissionMode("bypassPermissions")

    expect(document.body.textContent).toContain("启用默认跳过权限")
    expect(mocks.updateConfig).not.toHaveBeenCalled()

    await clickButton("启用")

    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { defaultPermissionMode: "bypassPermissions" },
    })
  })

  it("changes away from bypassPermissions without confirmation", async () => {
    mocks.config = {
      ...createDefaultConfig(),
      agent: { defaultPermissionMode: "bypassPermissions", defaultProviderModel: null },
    }

    renderPanel()

    openPermissionMenu()
    await clickPermissionMode("default")

    expect(document.body.textContent).not.toContain("启用默认跳过权限")
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { defaultPermissionMode: "default" },
    })
  })
})

describe("AgentDefaultsPanel provider model", () => {
  it("renders provider model button with placeholder when no default is set", () => {
    renderPanel()
    const button = document.querySelector('button[aria-label="默认供应商"]')
    expect(button).toBeTruthy()
    expect(button?.textContent).toContain("选择供应商 + 模型")
  })

  it("opens provider model dialog on button click", () => {
    renderPanel()
    const button = document.querySelector('button[aria-label="默认供应商"]')
    if (!(button instanceof HTMLElement)) throw new Error("Button not rendered")
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("选择供应商 + 模型")
  })

  it("shows clear button when default is set", () => {
    mocks.config = {
      ...createDefaultConfig(),
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "p1", modelTier: "sonnet" } },
    }
    renderPanel()
    const clearButton = document.querySelector('button[aria-label="清除默认供应商"]')
    expect(clearButton).toBeTruthy()
  })

  it("clears default on clear button click", async () => {
    mocks.config = {
      ...createDefaultConfig(),
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "p1", modelTier: "sonnet" } },
    }
    renderPanel()
    const clearButton = document.querySelector('button[aria-label="清除默认供应商"]')
    if (!(clearButton instanceof HTMLElement)) throw new Error("Clear button not rendered")
    await act(async () => {
      clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { defaultProviderModel: null },
    })
  })

  it("logs provider model save failures without rethrowing from event handlers", async () => {
    mocks.config = {
      ...createDefaultConfig(),
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "p1", modelTier: "sonnet" } },
    }
    mocks.updateConfig.mockRejectedValueOnce(new Error("save failed"))

    renderPanel()
    const clearButton = document.querySelector('button[aria-label="清除默认供应商"]')
    if (!(clearButton instanceof HTMLElement)) throw new Error("Clear button not rendered")

    await act(async () => {
      clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.error).toHaveBeenCalledWith(
      "Agent default provider model save failed.",
      expect.any(Error),
    )
  })
})

function renderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<AgentDefaultsPanel />)
  })
}

function openPermissionMenu(): void {
  const trigger = document.querySelector('button[aria-label="默认权限"]')
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Default permission trigger was not rendered")
  }
  act(() => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

async function clickPermissionMode(mode: string): Promise<void> {
  const item = document.querySelector(`[data-mode="${mode}"]`)
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Permission mode "${mode}" was not rendered`)
  }
  await act(async () => {
    item.click()
  })
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent === label)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button "${label}" was not rendered`)
  }
  await act(async () => {
    button.click()
  })
}
