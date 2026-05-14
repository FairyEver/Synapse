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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn()
  }
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
  it("applies a selected preset to the create form and saves through createProvider", async () => {
    const listProviders = vi.fn().mockResolvedValue([])
    const listProviderPresets = vi.fn().mockResolvedValue([packyPreset()])
    const createProvider = vi.fn().mockResolvedValue(customProvider())
    const createProviderFromPreset = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets,
          createProvider,
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
      buttonByText(container, "添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listProviderPresets).toHaveBeenCalled()
    expect(document.body.textContent).toContain("供应商预设")
    expect(document.body.textContent).not.toContain("从预设添加")

    await act(async () => {
      clickByText(document.body, "自定义")
      await Promise.resolve()
    })
    await act(async () => {
      clickByText(document.body, "PackyCode")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("重置表单")

    await act(async () => {
      buttonByText(document.body, "确认").click()
      await Promise.resolve()
    })

    expect(inputById("provider-id").value).toBe("packycode")
    expect(inputById("provider-name").value).toBe("PackyCode")
    expect(inputById("provider-base-url").value).toBe("https://www.packyapi.com")
    expect(inputById("provider-model").value).toBe("claude-sonnet-4-5")

    await act(async () => {
      setInputValue(inputById("provider-api-key"), "sk-packy")
      inputById("provider-api-key").dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      buttonByText(document.body, "保存").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createProvider).toHaveBeenCalledWith({
      provider: expect.objectContaining({
        id: "packycode",
        name: "PackyCode",
        category: "third_party",
        baseUrl: "https://www.packyapi.com",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        apiKey: "sk-packy",
        model: "claude-sonnet-4-5",
        haikuModel: "claude-haiku-4-5",
        sonnetModel: "claude-sonnet-4-5",
        opusModel: "claude-opus-4-5",
      }),
    })
    expect(createProviderFromPreset).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith("Provider 已保存")
  })

  it("updates preset-derived fields when template parameters change", async () => {
    const listProviders = vi.fn().mockResolvedValue([])
    const listProviderPresets = vi.fn().mockResolvedValue([templatedPreset()])
    const createProvider = vi.fn().mockResolvedValue(customProvider())
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets,
          createProvider,
          createProviderFromPreset: vi.fn(),
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
      buttonByText(container, "添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      clickByText(document.body, "自定义")
      await Promise.resolve()
    })
    await act(async () => {
      clickByText(document.body, "KAT-Coder")
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText(document.body, "确认").click()
      await Promise.resolve()
    })

    expect(inputById("provider-base-url").value).toBe("https://api.example.com/default-endpoint")

    await act(async () => {
      setInputValue(inputById("provider-template-ENDPOINT_ID"), "custom-endpoint")
      inputById("provider-template-ENDPOINT_ID").dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(inputById("provider-base-url").value).toBe("https://api.example.com/custom-endpoint")
  })

  it("does not show provider preset selection while editing", async () => {
    const listProviders = vi.fn().mockResolvedValue([customProvider()])
    const listProviderPresets = vi.fn().mockResolvedValue([packyPreset()])
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets,
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
      buttonByText(container, "编辑").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("编辑 Provider")
    expect(document.body.textContent).not.toContain("供应商预设")
  })

  it("leaves create form unchanged when preset reset confirmation is canceled", async () => {
    const listProviders = vi.fn().mockResolvedValue([])
    const listProviderPresets = vi.fn().mockResolvedValue([packyPreset()])
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets,
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
      buttonByText(container, "添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      setInputValue(inputById("provider-id"), "manual-provider")
      inputById("provider-id").dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      clickByText(document.body, "自定义")
      await Promise.resolve()
    })
    await act(async () => {
      clickByText(document.body, "PackyCode")
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText(document.body, "取消").click()
      await Promise.resolve()
    })

    expect(inputById("provider-id").value).toBe("manual-provider")
    expect(inputById("provider-name").value).toBe("")
  })
})

function packyPreset() {
  return {
    name: "PackyCode",
    category: "third_party",
    websiteUrl: "https://www.packyapi.com",
    apiKeyUrl: "https://www.packyapi.com/register?aff=cc-switch",
    baseUrl: "https://www.packyapi.com",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    model: "claude-sonnet-4-5",
    haikuModel: "claude-haiku-4-5",
    sonnetModel: "claude-sonnet-4-5",
    opusModel: "claude-opus-4-5",
    templateValues: [],
  } as const
}

function templatedPreset() {
  return {
    name: "KAT-Coder",
    category: "third_party",
    baseUrl: "https://api.example.com/${ENDPOINT_ID}",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    model: "claude-sonnet-4-5",
    templateValues: [{
      key: "ENDPOINT_ID",
      label: "Endpoint ID",
      placeholder: "endpoint-id",
      defaultValue: "default-endpoint",
      sensitive: false,
    }],
  } as const
}

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

function clickByText(container: HTMLElement, text: string): void {
  const element = Array.from(container.querySelectorAll<HTMLElement>("button,[role='option']"))
    .reverse()
    .find((candidate) => candidate.textContent === text)
  if (!element) {
    throw new Error(`Clickable text not found: ${text}`)
  }
  element.click()
}

function inputById(id: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`Input not found: ${id}`)
  return input
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
}
