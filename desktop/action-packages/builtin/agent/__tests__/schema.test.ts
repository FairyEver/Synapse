import { describe, expect, it } from "vitest"

import { agentActionConfigSchema, validateAgentStoredConfig } from "../schema"

const baseConfig = {
  projectId: "project-1",
  agentType: "claude-code",
  providerId: "anthropic",
  modelTier: "sonnet",
  prompt: "Run scheduled work",
  sessionPolicy: "fresh",
  timeoutMins: 30,
} as const

describe("agent action config schema", () => {
  it("accepts Claude Code permission modes for scheduled Agent tasks", () => {
    for (const mode of ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"]) {
      expect(agentActionConfigSchema.safeParse({ ...baseConfig, mode }).success).toBe(true)
    }
  })

  it("rejects unknown Claude Code permission modes", () => {
    expect(agentActionConfigSchema.safeParse({ ...baseConfig, mode: "free-for-all" }).success).toBe(false)
  })

  it("reports missing provider and model for legacy scheduled Agent configs", () => {
    const result = validateAgentStoredConfig({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "Run scheduled work",
      sessionPolicy: "fresh",
      timeoutMins: 30,
    })

    expect(result).toEqual({
      status: "needs_update",
      issues: [
        { field: "action.config.providerId", message: "选择供应商" },
        { field: "action.config.modelTier", message: "选择模型" },
      ],
    })
  })

  it("reports unsupported legacy agent type and permission mode", () => {
    const result = validateAgentStoredConfig({
      projectId: "project-1",
      agentType: "codex",
      mode: "yolo",
      prompt: "Run scheduled work",
      sessionPolicy: "fresh",
    })

    expect(result).toEqual({
      status: "needs_update",
      issues: [
        { field: "action.config.agentType", message: "选择当前支持的 Agent" },
        { field: "action.config.providerId", message: "选择供应商" },
        { field: "action.config.modelTier", message: "选择模型" },
        { field: "action.config.mode", message: "选择权限模式" },
      ],
    })
  })
})
