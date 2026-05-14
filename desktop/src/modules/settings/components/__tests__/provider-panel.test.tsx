/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

const toast = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("sonner", () => ({
  toast,
}))

import { ProviderPanel } from "@/modules/settings/components/provider-panel"
import type { SynapseAgentProvider } from "@/types/bridge"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  toast.mockClear()
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

describe("ProviderPanel diagnostics", () => {
  it("logs provider list failures with sanitized Agent runtime context", async () => {
    const listProviders = vi.fn().mockRejectedValue(new Error("secret provider token detail"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<ProviderPanel />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("Provider list failed.", {
      action: "listProviders",
      boundary: "settings.providers.list",
      errorLength: 28,
      errorName: "Error",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret provider token detail")
    expect(document.body.textContent).toContain("读取 Provider 失败")
    expect(document.body.textContent).not.toContain("secret provider token detail")
  })

  it("logs active provider failures with provider correlation and sanitized toast copy", async () => {
    const listProviders = vi.fn().mockResolvedValue([customProvider()])
    const setActiveProvider = vi.fn().mockRejectedValue(new Error("secret activation token detail"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          setActiveProvider,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<ProviderPanel />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const setActiveButton = buttonByText(container, "设为默认")

    await act(async () => {
      setActiveButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("Provider activate failed.", {
      action: "setActiveProvider",
      boundary: "settings.providers.activate",
      errorLength: 30,
      errorName: "Error",
      providerId: "custom-provider",
    })
    expect(toast).toHaveBeenCalledWith("切换失败")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret activation token detail")
    expect(JSON.stringify(toast.mock.calls)).not.toContain("secret activation token detail")
  })
})

describe("ProviderPanel presets", () => {
  it("opens provider presets and creates from a selected preset", async () => {
    const listProviders = vi.fn().mockResolvedValue([])
    const listProviderPresets = vi.fn().mockResolvedValue([{
      name: "PackyCode",
      category: "third_party",
      websiteUrl: "https://www.packyapi.com",
      apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      templateValues: [],
    }])
    const createProviderFromPreset = vi.fn().mockResolvedValue(customProvider())
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets,
          createProviderFromPreset,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<ProviderPanel />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText(container, "从预设添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listProviderPresets).toHaveBeenCalled()
    expect(document.body.textContent).toContain("PackyCode")

    const apiKeyInput = document.body.querySelector<HTMLInputElement>("#provider-preset-api-key")
    if (!apiKeyInput) throw new Error("API key input not found")
    expect(apiKeyInput.disabled).toBe(false)
    await act(async () => {
      setInputValue(apiKeyInput, "sk-packy")
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      buttonByText(document.body, "添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createProviderFromPreset).toHaveBeenCalledWith({
      presetName: "PackyCode",
      apiKey: "sk-packy",
      templateValues: {},
    })
    expect(toast).toHaveBeenCalledWith("Provider 已保存")
  })
})

function customProvider(): SynapseAgentProvider {
  return {
    id: "custom-provider",
    name: "Custom Provider",
    category: "custom",
    source: "user",
    readonly: false,
    configured: true,
    configPath: null,
    apiKeyField: "ANTHROPIC_API_KEY",
    active: false,
    createdAt: "",
    updatedAt: "",
    model: "claude-sonnet-4-5",
  } as unknown as SynapseAgentProvider
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .reverse()
    .find((candidate) => candidate.textContent === text)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
}
