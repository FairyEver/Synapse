// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentConfigForm } from "../config.renderer"
import type { AgentActionConfig } from "../schema"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("AgentConfigForm", () => {
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
      providerName: "ClaudeCode/Synapse",
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

    expect(document.body.textContent).toContain("ClaudeCode/Synapse Claude Code 默认")
    expect(document.body.textContent).not.toContain("ClaudeCode/Synapse 主模型")
  })
})

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
