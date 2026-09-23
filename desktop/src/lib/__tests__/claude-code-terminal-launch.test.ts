// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { launchClaudeCodeTerminal } from "../claude-code-terminal-launch"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ProviderModelSelection } from "@/types/provider-model"

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const bridge = {
  listAllProviders: vi.fn(),
  createClaudeCodeTerminal: vi.fn(),
  configGet: vi.fn(),
}

function provider(overrides: Partial<SynapseAgentProvider> = {}): SynapseAgentProvider {
  return {
    id: "anthropic",
    name: "Anthropic",
    category: "official",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  }
}

function configWithDefault(
  defaultProviderModel: { providerId: string; modelTier: ProviderModelSelection["modelTier"] } | null,
): { agent: { defaultProviderModel: typeof defaultProviderModel } } {
  return { agent: { defaultProviderModel } }
}

const ownSelection: ProviderModelSelection = {
  providerId: "anthropic",
  providerName: "Anthropic",
  modelTier: "sonnet",
  modelName: "claude-sonnet-4-5",
}

beforeEach(() => {
  bridge.listAllProviders.mockReset()
  bridge.listAllProviders.mockResolvedValue([])
  bridge.createClaudeCodeTerminal.mockReset()
  bridge.createClaudeCodeTerminal.mockResolvedValue({ sessionId: "session-1" })
  bridge.configGet.mockReset()
  bridge.configGet.mockResolvedValue(configWithDefault(null))
  loggerWarn.mockClear()
  window.synapse = {
    agent: {
      listAllProviders: bridge.listAllProviders,
      createClaudeCodeTerminal: bridge.createClaudeCodeTerminal,
    },
    config: { get: bridge.configGet },
  } as unknown as typeof window.synapse
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("launchClaudeCodeTerminal", () => {
  it("launches with the caller's own selection without resolving a default", async () => {
    const result = await launchClaudeCodeTerminal({ projectId: "project-1", selection: ownSelection })

    expect(result).toEqual({ ok: true, sessionId: "session-1" })
    expect(bridge.createClaudeCodeTerminal).toHaveBeenCalledWith({
      projectId: "project-1",
      providerId: "anthropic",
      modelTier: "sonnet",
    })
    expect(bridge.listAllProviders).not.toHaveBeenCalled()
    expect(bridge.configGet).not.toHaveBeenCalled()
  })

  it("resolves the configured default provider and tier when the caller names none", async () => {
    bridge.listAllProviders.mockResolvedValue([
      provider({ sonnetModel: "claude-sonnet-4-5" }),
      provider({ id: "openrouter", name: "OpenRouter", active: true, opusModel: "claude-opus-4-1" }),
    ])
    bridge.configGet.mockResolvedValue(configWithDefault({ providerId: "anthropic", modelTier: "sonnet" }))

    await launchClaudeCodeTerminal({ projectId: "project-2" })

    expect(bridge.createClaudeCodeTerminal).toHaveBeenCalledWith({
      projectId: "project-2",
      providerId: "anthropic",
      modelTier: "sonnet",
    })
  })

  it("falls back to the active provider's own tier when the configured default is gone", async () => {
    bridge.listAllProviders.mockResolvedValue([
      provider({ sonnetModel: "claude-sonnet-4-5" }),
      provider({ id: "openrouter", name: "OpenRouter", active: true, opusModel: "claude-opus-4-1" }),
    ])
    bridge.configGet.mockResolvedValue(configWithDefault({ providerId: "removed", modelTier: "sonnet" }))

    await launchClaudeCodeTerminal({ projectId: "project-3" })

    expect(bridge.createClaudeCodeTerminal).toHaveBeenCalledWith({
      projectId: "project-3",
      providerId: "openrouter",
      modelTier: "opus",
    })
  })

  it("reports the missing model without creating anything", async () => {
    const result = await launchClaudeCodeTerminal({ projectId: "project-4" })

    expect(result).toEqual({
      ok: false,
      code: "no-model",
      message: "没有可用的供应商模型，请先配置供应商。",
    })
    expect(bridge.createClaudeCodeTerminal).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith(
      "Claude Code terminal launch found no selectable model.",
      expect.objectContaining({ projectId: "project-4", code: "no-model" }),
    )
  })

  it("keeps the runtime's own sentence when the bundled Claude Code is missing", async () => {
    bridge.listAllProviders.mockResolvedValue([provider({ sonnetModel: "claude-sonnet-4-5" })])
    bridge.createClaudeCodeTerminal.mockRejectedValue(
      new Error("内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。"),
    )

    const result = await launchClaudeCodeTerminal({ projectId: "project-5" })

    expect(result).toEqual({
      ok: false,
      code: "runtime-missing",
      message: "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。",
    })
  })

  it("answers any other failure generically and logs no error text", async () => {
    bridge.listAllProviders.mockResolvedValue([provider({ sonnetModel: "claude-sonnet-4-5" })])
    bridge.createClaudeCodeTerminal.mockRejectedValue(new Error("credentials for sk-live-secret are missing"))

    const result = await launchClaudeCodeTerminal({ projectId: "project-6" })

    expect(result).toEqual({
      ok: false,
      code: "failed",
      message: "无法在终端中启动 Claude Code。",
    })
    const logged = JSON.stringify(loggerWarn.mock.calls)
    expect(logged).not.toContain("sk-live-secret")
    expect(loggerWarn).toHaveBeenCalledWith(
      "Claude Code terminal launch failed.",
      expect.objectContaining({
        projectId: "project-6",
        code: "failed",
        errorName: "Error",
        errorLength: "credentials for sk-live-secret are missing".length,
      }),
    )
  })
})
