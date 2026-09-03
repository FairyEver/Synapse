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
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

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

  it("hides the legacy active provider action from provider rows", async () => {
    const setActiveProvider = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          setActiveProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    expect(document.body.textContent).not.toContain("设为默认")
    expect(setActiveProvider).not.toHaveBeenCalled()
  })
})

describe("ProviderPanel dialog editor", () => {
  it("copies provider model ids from model rows", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider({
            haikuModel: "claude-haiku-4-5",
            sonnetModel: "claude-sonnet-4-5",
            opusModel: "claude-opus-4-5",
          })]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    expect([...document.body.querySelectorAll<HTMLButtonElement>('[aria-label^="复制"]')]
      .map((button) => button.getAttribute("aria-label"))).toEqual([
        "复制 #1 模型 ID（主模型）",
        "复制 #2 模型 ID（Opus）",
        "复制 #3 模型 ID（Sonnet）",
        "复制 #4 模型 ID（Haiku）",
      ])

    const copyButton = document.body.querySelector<HTMLButtonElement>('[aria-label="复制 #3 模型 ID（Sonnet）"]')
    expect(copyButton?.textContent).toBe("")

    await act(async () => {
      copyButton?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith("synapse-provider-model://custom-provider/sonnet")
    expect(toast).toHaveBeenCalledWith("模型 ID 已复制")
  })

  it("keeps row actions in a dedicated non-wrapping column", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    const actionHead = Array.from(document.body.querySelectorAll("th"))
      .find((cell) => cell.textContent === "操作")
    const actionCell = buttonByText(document.body, "编辑").closest("td")

    expect(actionHead?.className).toContain("w-64")
    expect(actionCell?.className).toContain("whitespace-nowrap")
    expect(buttonByText(document.body, "编辑").className).toContain("whitespace-nowrap")
    expect(document.body.textContent).not.toContain("设为默认")
  })

  it("keeps the provider table outside and renders the cc-switch-like form only in the dialog", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([packyPreset()]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    expect(document.body.textContent).toContain("模型供应商")
    expect(document.body.textContent).toContain("Custom Provider")
    expect(document.body.textContent).toContain("名称")
    expect(document.body.textContent).toContain("模型")
    expect(document.body.textContent).not.toContain("Key 字段")
    expect(document.body.textContent).toContain("操作")
    expect(document.body.textContent).not.toContain("供应商名称")
    expect(document.body.textContent).not.toContain("配置 JSON")

    await act(async () => {
      clickByText(document.body, "Custom Provider")
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Company account")
    expect(textareaByLabel("Provider 配置 JSON").value).toContain("ENABLE_TOOL_SEARCH")
    expect(textareaByLabel("Provider 配置 JSON").value).toContain("claude-sonnet-4-5")

    await act(async () => {
      buttonByText(document.body, "关闭").click()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText(document.body, "编辑").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("编辑模型供应商")
    expect(document.body.textContent).toContain("供应商名称")
    expect(document.body.textContent).toContain("备注")
    expect(document.body.textContent).toContain("官网链接")
    expect(document.body.textContent).toContain("请求地址")
    expect(document.body.textContent).toContain("API Key")
    expect(document.body.textContent).not.toContain("高级选项")
    expect(document.body.textContent).toContain("API 格式")
    expect(document.body.textContent).toContain("Anthropic Messages (原生)")
    expect(document.body.textContent).toContain("认证字段")
    expect(document.body.textContent).toContain("模型映射")
    expect(document.body.textContent).toContain("如果供应商原生提供 Claude 系列模型，通常无需配置。仅在需要将请求映射到不同模型名称时填写。")
    expect(document.body.textContent).toContain("#1")
    expect(document.body.textContent).toContain("#2")
    expect(document.body.textContent).toContain("#3")
    expect(document.body.textContent).toContain("#4")
    expect(document.body.textContent).not.toContain("Opus 默认模型")
    expect(document.body.textContent).not.toContain("Sonnet 默认模型")
    expect(document.body.textContent).not.toContain("Haiku 默认模型")
    expect(document.body.textContent).toContain("配置 JSON")
    expect(textareaByLabel("配置 JSON").value).toContain("ENABLE_TOOL_SEARCH")
    expect(document.body.querySelector("#provider-id")).toBeNull()
    expect(document.body.querySelector("#provider-category")).toBeNull()
    expect(document.body.querySelector("#provider-sort-index")).toBeNull()
    expect(document.body.textContent).not.toContain("完整 URL")
    expect(document.body.textContent).not.toContain("管理与测速")
    expect(document.body.textContent).not.toContain("一键设置")
    expect(document.body.textContent).not.toContain("获取模型列表")
    expect(document.body.textContent).not.toContain("模型测试配置")
    expect(document.body.textContent).not.toContain("计费配置")
  })

  it("redacts secrets in provider detail config", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider({
            env: {
              ANTHROPIC_API_KEY: "sk-secret",
              ENABLE_TOOL_SEARCH: "true",
            },
            settingsConfig: {
              headers: { Authorization: "Bearer secret-token" },
              hooks: {},
              permissions: { allow: ["WebFetch"], deny: [] },
            },
          })]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      clickByText(document.body, "Custom Provider")
      await Promise.resolve()
    })

    const detailConfig = textareaByLabel("Provider 配置 JSON").value
    expect(detailConfig).toContain("[redacted]")
    expect(detailConfig).toContain("ENABLE_TOOL_SEARCH")
    expect(detailConfig).toContain("WebFetch")
    expect(detailConfig).not.toContain("sk-secret")
    expect(detailConfig).not.toContain("Bearer secret-token")
  })

  it("applies a selected preset to the create form and saves through createProvider", async () => {
    const createProvider = vi.fn().mockResolvedValue(customProvider({ id: "packycode", name: "PackyCode" }))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([packyPreset()]),
          createProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "新建").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("供应商预设")
    expect(document.body.textContent).not.toContain("PackyCode")

    await act(async () => {
      buttonByText(document.body, "自定义").click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("选择提供商预设")

    await act(async () => {
      clickByText(document.body, "PackyCode")
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText(document.body, "确认").click()
      await Promise.resolve()
    })

    expect(inputById("provider-name").value).toBe("PackyCode")
    expect(inputById("provider-website-url").value).toBe("https://www.packyapi.com")
    expect(inputById("provider-base-url").value).toBe("https://www.packyapi.com")
    expect(JSON.parse(textareaByLabel("配置 JSON").value)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: "https://www.packyapi.com",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "claude-sonnet-4-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-5",
      },
      hooks: {},
      permissions: {
        allow: [],
        deny: [],
      },
    })

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
        websiteUrl: "https://www.packyapi.com",
        category: "third_party",
        baseUrl: "https://www.packyapi.com",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        apiKey: "sk-packy",
        model: "claude-sonnet-4-5",
        haikuModel: "claude-haiku-4-5",
        sonnetModel: "claude-sonnet-4-5",
        opusModel: "claude-opus-4-5",
        env: {},
        settingsConfig: {
          hooks: {},
          permissions: {
            allow: [],
            deny: [],
          },
        },
      }),
    })
    expect(toast).toHaveBeenCalledWith("Provider 已保存")
  })

  it("creates a custom provider without an explicit ID and defaults to auth token", async () => {
    const createProvider = vi.fn().mockResolvedValue(customProvider({ id: "my-provider", name: "My Provider" }))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          createProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "新建").click()
      await Promise.resolve()
    })

    expect(document.body.querySelector("#provider-id")).toBeNull()
    expect(document.body.textContent).toContain("ANTHROPIC_AUTH_TOKEN")

    await act(async () => {
      setInputValue(inputById("provider-name"), "My Provider")
      inputById("provider-name").dispatchEvent(new Event("input", { bubbles: true }))
      setInputValue(inputById("provider-base-url"), "https://api.example.com")
      inputById("provider-base-url").dispatchEvent(new Event("input", { bubbles: true }))
      setInputValue(inputById("provider-api-key"), "sk-custom")
      inputById("provider-api-key").dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      buttonByText(document.body, "保存").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createProvider).toHaveBeenCalledWith({
      provider: expect.objectContaining({
        id: "my-provider",
        name: "My Provider",
        category: "custom",
        baseUrl: "https://api.example.com",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        apiKey: "sk-custom",
        env: {},
      }),
    })
  })

  it("keeps config JSON in sync when provider form fields change", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "新建").click()
      await Promise.resolve()
    })

    await act(async () => {
      setInputValue(inputById("provider-base-url"), "https://api.example.com")
      inputById("provider-base-url").dispatchEvent(new Event("input", { bubbles: true }))
      setInputValue(inputById("provider-api-key"), "sk-custom")
      inputById("provider-api-key").dispatchEvent(new Event("input", { bubbles: true }))
      setInputValue(inputById("provider-model"), "claude-custom")
      inputById("provider-model").dispatchEvent(new Event("input", { bubbles: true }))
    })

    const config = JSON.parse(textareaByLabel("配置 JSON").value) as { env: Record<string, string> }
    expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.example.com")
    expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-custom")
    expect(config.env.ANTHROPIC_MODEL).toBe("claude-custom")
  })

  it("updates provider form fields from pasted config JSON", async () => {
    const createProvider = vi.fn().mockResolvedValue(customProvider())
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          createProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "新建").click()
      await Promise.resolve()
    })

    const editor = textareaByLabel("配置 JSON")
    await act(async () => {
      setInputValue(inputById("provider-name"), "Pasted Provider")
      inputById("provider-name").dispatchEvent(new Event("input", { bubbles: true }))
      setTextareaValue(editor, JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://pasted.example.com",
          ANTHROPIC_API_KEY: "sk-pasted",
          ANTHROPIC_MODEL: "claude-pasted",
          ENABLE_TOOL_SEARCH: "true",
          OPENAI_API_KEY: "sk-openai",
          GITHUB_TOKEN: "ghp-secret",
        },
        hooks: {},
        permissions: { allow: [], deny: [] },
      }, null, 2))
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(inputById("provider-base-url").value).toBe("https://pasted.example.com")
    expect(inputById("provider-api-key").value).toBe("sk-pasted")
    expect(inputById("provider-model").value).toBe("claude-pasted")

    await act(async () => {
      buttonByText(document.body, "保存").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createProvider).toHaveBeenCalledWith({
      provider: expect.objectContaining({
        name: "Pasted Provider",
        baseUrl: "https://pasted.example.com",
        apiKeyField: "ANTHROPIC_API_KEY",
        apiKey: "sk-pasted",
        model: "claude-pasted",
        env: {
          ENABLE_TOOL_SEARCH: "true",
        },
        secretEnv: {
          OPENAI_API_KEY: "sk-openai",
          GITHUB_TOKEN: "ghp-secret",
        },
        settingsConfig: {
          env: {
            ENABLE_TOOL_SEARCH: "true",
          },
          hooks: {},
          permissions: {
            allow: [],
            deny: [],
          },
        },
      }),
    })
  })

  it("updates preset-derived fields when template parameters change", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([templatedPreset()]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "新建").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText(document.body, "自定义").click()
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

  it("saves extra env from provider config JSON", async () => {
    const updateProvider = vi.fn().mockResolvedValue(customProvider())
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider({
            env: { ENABLE_TOOL_SEARCH: "true" },
          })]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          updateProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "编辑").click()
      await Promise.resolve()
    })

    const editor = textareaByLabel("配置 JSON")
    await act(async () => {
      setTextareaValue(editor, JSON.stringify({
        env: {
          ENABLE_TOOL_SEARCH: "false",
          CLAUDE_CODE_EFFORT_LEVEL: "max",
          CUSTOM_SECRET: "secret-value",
        },
        hooks: {},
        permissions: { allow: [], deny: [] },
      }, null, 2))
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      buttonByText(document.body, "保存").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateProvider).toHaveBeenCalledWith({
      providerId: "custom-provider",
      patch: expect.objectContaining({
        env: {
          ENABLE_TOOL_SEARCH: "false",
          CLAUDE_CODE_EFFORT_LEVEL: "max",
        },
        secretEnv: {
          CUSTOM_SECRET: "secret-value",
        },
        settingsConfig: expect.objectContaining({
          env: {
            ENABLE_TOOL_SEARCH: "false",
            CLAUDE_CODE_EFFORT_LEVEL: "max",
          },
        }),
      }),
    })
  })

  it("blocks save when provider config JSON is invalid", async () => {
    const updateProvider = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          updateProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "编辑").click()
      await Promise.resolve()
    })

    const editor = textareaByLabel("配置 JSON")
    await act(async () => {
      setTextareaValue(editor, "{")
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      buttonByText(document.body, "保存").click()
      await Promise.resolve()
    })

    expect(updateProvider).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith("配置 JSON 格式错误")
  })

  it("keeps readonly local provider values visible in the table and hides row actions", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([readonlyProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    expect(document.body.textContent).toContain("Local Claude")
    expect(document.body.textContent).toContain("claude-sonnet-4-5")
    expect(document.body.textContent).not.toContain("编辑")
    expect(document.body.textContent).not.toContain("设为默认")
    expect(document.body.textContent).not.toContain("归档")
    expect(document.body.textContent).not.toContain("供应商名称")
  })

  it("imports selected CC Switch Claude providers from the dialog", async () => {
    const listProviders = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customProvider({ id: "deepseek", name: "DeepSeek" })])
    const previewCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      source: { kind: "sqlite", path: "/Users/test/.cc-switch/cc-switch.db" },
      items: [{
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        haikuModel: "deepseek-haiku",
        sonnetModel: "deepseek-sonnet",
        opusModel: "deepseek-opus",
        status: "ready",
        selectedByDefault: true,
      }],
    })
    const importCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      imported: [customProvider({ id: "deepseek", name: "DeepSeek" })],
      skipped: [],
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets: vi.fn().mockResolvedValue([]),
          previewCcSwitchClaudeProviders,
          importCcSwitchClaudeProviders,
          chooseCcSwitchClaudeImportSource: vi.fn().mockResolvedValue({}),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "从 CCS 导入").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("从 CCS 导入")
    expect(document.body.textContent).toContain("DeepSeek")
    expect(document.body.textContent).toContain("Key 字段")
    expect(document.body.textContent).toContain("ANTHROPIC_AUTH_TOKEN")
    expect(document.body.textContent).toContain("#1")
    expect(document.body.textContent).toContain("deepseek-chat")
    expect(document.body.textContent).toContain("#4")
    expect(document.body.textContent).toContain("deepseek-haiku")
    expect(document.body.textContent).toContain("#3")
    expect(document.body.textContent).toContain("deepseek-sonnet")
    expect(document.body.textContent).toContain("#2")
    expect(document.body.textContent).toContain("deepseek-opus")

    await act(async () => {
      buttonByText(document.body, "导入 1 个").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(importCcSwitchClaudeProviders).toHaveBeenCalledWith({
      source: { kind: "sqlite", path: "/Users/test/.cc-switch/cc-switch.db" },
      providerIds: ["deepseek"],
    })
    expect(toast).toHaveBeenCalledWith("已导入 1 个 Provider")
    expect(document.body.textContent).toContain("DeepSeek")
  })

  it("keeps the selected CC Switch source when scanning again", async () => {
    const customSource = { kind: "json" as const, path: "/Users/test/custom-cc-switch.json" }
    const previewCcSwitchClaudeProviders = vi.fn()
      .mockResolvedValueOnce({ source: null, items: [] })
      .mockResolvedValue({
        source: customSource,
        items: [{
          id: "custom",
          name: "Custom",
          category: "custom",
          baseUrl: "https://api.example.com",
          apiKeyField: "ANTHROPIC_AUTH_TOKEN",
          model: "claude",
          haikuModel: "claude-haiku",
          sonnetModel: "claude-sonnet",
          opusModel: "claude-opus",
          status: "ready",
          selectedByDefault: true,
        }],
      })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          previewCcSwitchClaudeProviders,
          importCcSwitchClaudeProviders: vi.fn(),
          chooseCcSwitchClaudeImportSource: vi.fn().mockResolvedValue({ source: customSource }),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "从 CCS 导入").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText(document.body, "选择配置").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText(document.body, "扫描").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(previewCcSwitchClaudeProviders).toHaveBeenNthCalledWith(1, { source: undefined })
    expect(previewCcSwitchClaudeProviders).toHaveBeenNthCalledWith(2, { source: customSource })
    expect(previewCcSwitchClaudeProviders).toHaveBeenNthCalledWith(3, { source: customSource })
  })

  it("logs CC Switch preview failures without raw secret messages", async () => {
    const previewCcSwitchClaudeProviders = vi.fn()
      .mockRejectedValue(new Error("sqlite read failed token=sk-secret"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          previewCcSwitchClaudeProviders,
          importCcSwitchClaudeProviders: vi.fn(),
          chooseCcSwitchClaudeImportSource: vi.fn().mockResolvedValue({}),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "从 CCS 导入").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("CC Switch preview failed.", {
      action: "previewCcSwitchClaudeProviders",
      boundary: "settings.providers.cc-switch.preview",
      errorLength: 34,
      errorName: "Error",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(document.body.textContent).toContain("读取失败")
  })

  it("logs CC Switch import failures without raw secret messages", async () => {
    const previewCcSwitchClaudeProviders = vi.fn().mockResolvedValue({
      source: { kind: "json", path: "/Users/test/cc-switch.json" },
      items: [{
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        haikuModel: "deepseek-haiku",
        sonnetModel: "deepseek-sonnet",
        opusModel: "deepseek-opus",
        status: "ready",
        selectedByDefault: true,
      }],
    })
    const importCcSwitchClaudeProviders = vi.fn()
      .mockRejectedValue(new Error("import failed apiKey=sk-secret"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          previewCcSwitchClaudeProviders,
          importCcSwitchClaudeProviders,
          chooseCcSwitchClaudeImportSource: vi.fn().mockResolvedValue({}),
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "从 CCS 导入").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText(document.body, "导入 1 个").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("CC Switch import failed.", {
      action: "importCcSwitchClaudeProviders",
      boundary: "settings.providers.cc-switch.import",
      errorLength: 30,
      errorName: "Error",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(toast).toHaveBeenCalledWith("导入失败")
  })

  it("confirms before exporting a provider package with secrets", async () => {
    const chooseProviderPackageExportTarget = vi.fn().mockResolvedValue({
      targetPath: "/Users/test/Custom Provider.synapse-provider.json",
    })
    const exportProviderPackage = vi.fn().mockResolvedValue({
      filePath: "/Users/test/Custom Provider.synapse-provider.json",
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          chooseProviderPackageExportTarget,
          exportProviderPackage,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "导出密钥包").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("文件会包含")
    expect(document.body.textContent).toContain("API Key")
    expect(chooseProviderPackageExportTarget).not.toHaveBeenCalled()

    await act(async () => {
      buttonByText(document.body, "导出含密钥文件").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(chooseProviderPackageExportTarget).toHaveBeenCalledWith({ providerName: "Custom Provider" })
    expect(exportProviderPackage).toHaveBeenCalledWith({
      providerId: "custom-provider",
      targetPath: "/Users/test/Custom Provider.synapse-provider.json",
    })
    expect(toast).toHaveBeenCalledWith("已导出含密钥的供应商配置")
  })

  it("does not show package export for the built-in provider", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([readonlyProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    renderProviderPanel()
    await flush()

    expect(document.body.textContent).not.toContain("导出密钥包")
  })

  it("previews and imports a provider package", async () => {
    const listProviders = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customProvider({ id: "deepseek-2", name: "DeepSeek" })])
    const chooseProviderPackageImportSource = vi.fn().mockResolvedValue({
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
    })
    const previewProviderPackageImport = vi.fn().mockResolvedValue({
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
      contentSha256: "a".repeat(64),
      packageVersion: 1,
      sourceProviderId: "deepseek",
      targetProviderId: "deepseek-2",
      name: "DeepSeek",
      category: "cn_official",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      model: "deepseek-chat",
    })
    const importProviderPackage = vi.fn().mockResolvedValue({
      provider: customProvider({ id: "deepseek-2", name: "DeepSeek" }),
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets: vi.fn().mockResolvedValue([]),
          chooseProviderPackageImportSource,
          previewProviderPackageImport,
          importProviderPackage,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "导入文件").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(previewProviderPackageImport).toHaveBeenCalledWith({
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
    })
    expect(document.body.textContent).toContain("导入供应商")
    expect(document.body.textContent).toContain("DeepSeek")
    expect(document.body.textContent).toContain("https://api.deepseek.com/anthropic")
    expect(document.body.textContent).toContain("deepseek-chat")
    expect(document.body.textContent).toContain("ANTHROPIC_AUTH_TOKEN")
    expect(document.body.textContent).toContain("deepseek -> deepseek-2")
    expect(document.body.textContent).toContain("#1")

    await act(async () => {
      buttonByText(document.body, "导入").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(importProviderPackage).toHaveBeenCalledWith({
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
      contentSha256: "a".repeat(64),
    })
    expect(toast).toHaveBeenCalledWith("已导入供应商配置")
    expect(listProviders).toHaveBeenCalledTimes(2)
  })

  it("disables direct provider deletion when workflow references exist", async () => {
    const deleteProvider = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          scanProviderReferences: vi.fn().mockResolvedValue({
            providerId: "custom-provider",
            references: [
              { kind: "workflow-node", entityId: "workflow-1", entityName: "日报", nodeId: "node-1", nodeName: "总结", providerId: "custom-provider", modelTier: "default" },
            ],
            workflowNodeCount: 1,
            conversationCount: 0,
            agentPersonaCount: 0,
          }),
          deleteProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const directDelete = buttonByText(document.body, "先迁移引用")
    expect(directDelete.disabled).toBe(true)
    expect(document.body.textContent).toContain("迁移到其他供应商")
    await act(async () => {
      directDelete.click()
      await Promise.resolve()
    })
    expect(deleteProvider).not.toHaveBeenCalled()
  })

  it("blocks deletion and lists agent personas using the provider", async () => {
    const deleteProvider = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          scanProviderReferences: vi.fn().mockResolvedValue({
            providerId: "custom-provider",
            references: [
              { kind: "agent-persona", entityId: "persona-1", entityName: "翻译助手", providerId: "custom-provider", modelTier: "sonnet" },
            ],
            workflowNodeCount: 0,
            conversationCount: 0,
            agentPersonaCount: 1,
          }),
          deleteProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("智能体 (1)")
    expect(document.body.textContent).toContain("翻译助手")
    expect(document.body.textContent).toContain("重新指定模型，或恢复为跟随对话")
    expect(buttonByText(document.body, "先处理引用").disabled).toBe(true)
    expect(deleteProvider).not.toHaveBeenCalled()
  })

  it("deletes related Agent conversations from the provider deletion dialog", async () => {
    const deleteSession = vi.fn().mockResolvedValue({ ok: true })
    const scanProviderReferences = vi.fn()
      .mockResolvedValueOnce({
        providerId: "custom-provider",
        references: [
          { kind: "conversation", entityId: "conversation-1", entityName: "旧会话", projectId: "project-1", providerId: "custom-provider", modelTier: "" },
        ],
        workflowNodeCount: 0,
        conversationCount: 1,
        agentPersonaCount: 0,
      })
      .mockResolvedValueOnce({
        providerId: "custom-provider",
        references: [],
        workflowNodeCount: 0,
        conversationCount: 0,
        agentPersonaCount: 0,
      })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          scanProviderReferences,
          deleteSession,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("删除后无法恢复")
    await act(async () => {
      buttonByText(document.body, "删除 1 个会话").click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(deleteSession).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
    })
    expect(scanProviderReferences).toHaveBeenCalledTimes(2)
    expect(toast).toHaveBeenCalledWith("已删除 1 个相关会话")
    expect(document.body.textContent).toContain("该供应商未被任何内容引用，可以安全删除")
    expect(buttonByText(document.body, "确认删除").disabled).toBe(false)
  })

  it("keeps failed conversation references visible after bulk deletion", async () => {
    const deleteSession = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false })
    const remainingReference = {
      kind: "conversation",
      entityId: "conversation-2",
      entityName: "保留会话",
      projectId: "project-2",
      providerId: "custom-provider",
      modelTier: "",
    }
    const scanProviderReferences = vi.fn()
      .mockResolvedValueOnce({
        providerId: "custom-provider",
        references: [
          { ...remainingReference, entityId: "conversation-1", entityName: "已删会话", projectId: "project-1" },
          remainingReference,
        ],
        workflowNodeCount: 0,
        conversationCount: 2,
        agentPersonaCount: 0,
      })
      .mockResolvedValueOnce({
        providerId: "custom-provider",
        references: [remainingReference],
        workflowNodeCount: 0,
        conversationCount: 1,
        agentPersonaCount: 0,
      })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([customProvider()]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          scanProviderReferences,
          deleteSession,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText(document.body, "删除 2 个会话").click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toast).toHaveBeenCalledWith("已删除 1 个会话，1 个删除失败")
    expect(rendererLogger.error).toHaveBeenCalledWith("Provider conversation reference deletion partially failed.", {
      boundary: "settings.providers.delete-conversations",
      providerId: "custom-provider",
      deletedCount: 1,
      failedCount: 1,
    })
    expect(document.body.textContent).toContain("Agent 会话 (1)")
    expect(buttonByText(document.body, "删除 1 个会话").disabled).toBe(false)
  })

  it("stops provider deletion when reference migration returns item errors", async () => {
    const sourceProvider = customProvider({ active: true })
    const targetProvider = customProvider({
      id: "target-provider",
      name: "Target Provider",
      readonly: true,
    })
    const deleteProvider = vi.fn().mockResolvedValue(undefined)
    const migrateProviderReferences = vi.fn().mockResolvedValue({
      migratedWorkflowNodes: 0,
      errors: [{ entityId: "workflow-1", error: "write failed" }],
    })
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([sourceProvider, targetProvider]),
          listProviderPresets: vi.fn().mockResolvedValue([]),
          scanProviderReferences: vi.fn().mockResolvedValue({
            providerId: "custom-provider",
            references: [
              { kind: "workflow-node", entityId: "workflow-1", entityName: "日报", nodeId: "node-1", nodeName: "总结", providerId: "custom-provider", modelTier: "default" },
            ],
            workflowNodeCount: 1,
            conversationCount: 0,
            agentPersonaCount: 0,
          }),
          migrateProviderReferences,
          deleteProvider,
        },
      },
    })

    renderProviderPanel()
    await flush()

    await act(async () => {
      buttonByText(document.body, "删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText(document.body, "迁移到其他供应商").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText(document.body, "确认").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(migrateProviderReferences).toHaveBeenCalledWith({
      sourceProviderId: "custom-provider",
      targetProviderId: "target-provider",
      targetModelTier: "default",
      scope: ["workflow-node"],
    })
    expect(deleteProvider).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith("迁移失败 1 项，已停止删除")
    expect(toast).not.toHaveBeenCalledWith("引用已迁移")
    expect(rendererLogger.error).toHaveBeenCalledWith("Provider reference migration returned errors.", {
      boundary: "settings.providers.migrate",
      providerId: "custom-provider",
      errorCount: 1,
      migratedWorkflowNodes: 0,
    })
  })
})

function renderProviderPanel(): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<ProviderPanel />)
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

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

function customProvider(overrides: Partial<SynapseAgentProvider> = {}): SynapseAgentProvider {
  return {
    id: "custom-provider",
    name: "Custom Provider",
    note: "Company account",
    websiteUrl: "https://example.com",
    category: "custom",
    source: "user",
    readonly: false,
    configured: true,
    configPath: undefined,
    apiKeyField: "ANTHROPIC_API_KEY",
    active: false,
    baseUrl: "https://api.example.com",
    createdAt: "",
    updatedAt: "",
    model: "claude-sonnet-4-5",
    env: {
      ENABLE_TOOL_SEARCH: "true",
    },
    ...overrides,
  } as SynapseAgentProvider
}

function readonlyProvider(): SynapseAgentProvider {
  return {
    id: "local-claude",
    name: "Local Claude",
    category: "official",
    source: "local",
    readonly: true,
    configured: true,
    configPath: "/Users/liyang/.claude/settings.json",
    baseUrl: "https://api.anthropic.com",
    apiKeyField: "ANTHROPIC_API_KEY",
    active: true,
    archived: false,
    sortIndex: 10,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    model: "claude-sonnet-4-5",
    haikuModel: "claude-haiku-4-5",
    sonnetModel: "claude-sonnet-4-5",
    opusModel: "claude-opus-4-5",
    env: {},
  } as SynapseAgentProvider
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
    .find((candidate) => candidate.textContent?.includes(text))
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

function textareaByLabel(label: string): HTMLTextAreaElement {
  const textareas = Array.from(document.body.querySelectorAll<HTMLTextAreaElement>("textarea"))
  const match = textareas.find((candidate) => candidate.getAttribute("aria-label") === label)
  if (!match) throw new Error(`Textarea not found: ${label}`)
  return match
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  if (!setter) throw new Error("Textarea value setter not found")
  setter.call(textarea, value)
}
