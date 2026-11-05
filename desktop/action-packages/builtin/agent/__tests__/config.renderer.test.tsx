// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentConfigForm } from "../config.renderer"
import type { AgentActionConfig } from "../schema"

const bridgeMocks = vi.hoisted(() => ({ listProviders: vi.fn().mockResolvedValue([]) }))
vi.mock("../../../../src/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({ agent: { listProviders: bridgeMocks.listProviders } }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("AgentConfigForm", () => {
  it("resolves provider and model labels for MCP configurations without display snapshots", async () => {
    bridgeMocks.listProviders.mockResolvedValue([{
      id: "provider-1", name: "测试供应商", category: "custom", source: "user", active: true,
      archived: false, apiKeyField: "ANTHROPIC_AUTH_TOKEN", createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z",
      model: "test-model", haikuModel: "test-haiku", sonnetModel: "test-sonnet", opusModel: "test-opus",
    }])
    const value: AgentActionConfig = {
      projectId: "project-1", agentType: "claude-code", providerId: "provider-1", modelTier: "haiku",
      mode: "dontAsk", prompt: "Reply OK", sessionPolicy: "fresh",
    }
    const onChange = vi.fn()
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<AgentConfigForm value={value} onChange={onChange} />) })

    expect(document.querySelector("#task-action-agent-provider")?.textContent).toBe("测试供应商 test-haiku")
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
  })

  it("keeps timeout minutes nullable and numeric", async () => {
    const value: AgentActionConfig = {
      projectId: "project-1",
      agentType: "claude-code",
      providerId: "provider-1",
      modelTier: "sonnet",
      mode: "default",
      prompt: "Reply OK",
      sessionPolicy: "fresh",
      timeoutMins: 60,
    }
    const onChange = vi.fn()
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AgentConfigForm value={value} onChange={onChange} />)
    })

    const timeoutInput = document.querySelector<HTMLInputElement>("#task-action-agent-timeout")
    expect(timeoutInput).not.toBeNull()

    await act(async () => {
      if (!timeoutInput) return
      changeInput(timeoutInput, "")
    })
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      timeoutMins: null,
    })

    await act(async () => {
      if (!timeoutInput) return
      changeInput(timeoutInput, "5")
    })
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      timeoutMins: 5,
    })
  })

  it("labels local Claude Code default model without storing a fake model name", async () => {
    const value: AgentActionConfig = {
      projectId: "project-1",
      agentType: "claude-code",
      providerId: "local-claude-code",
      modelTier: "default",
      providerName: "CC/Synapse",
      mode: "default",
      prompt: "Reply OK",
      sessionPolicy: "fresh",
      timeoutMins: 60,
    }
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AgentConfigForm value={value} onChange={vi.fn()} />)
    })

    expect(document.body.textContent).toContain("CC/Synapse Claude Code 默认")
    expect(document.body.textContent).not.toContain("CC/Synapse 主模型")
  })
})

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
