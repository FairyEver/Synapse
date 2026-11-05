import { describe, expect, it } from "vitest"
import { rendererActionRegistry } from "../builtin-actions"

describe("renderer action registry", () => {
  it.each([
    ["default", "按需询问"],
    ["acceptEdits", "自动接受编辑"],
    ["plan", "只读计划"],
    ["auto", "自动判定"],
    ["dontAsk", "不询问并拒绝"],
    ["bypassPermissions", "跳过权限确认"],
  ])("shows the user-facing permission name for %s", (mode, label) => {
    const config = { ...rendererActionRegistry.getDefaultConfig("builtin.agent"), projectId: "project-1", providerId: "provider-1", prompt: "Reply OK", mode }
    expect(rendererActionRegistry.summarize("builtin.agent", config)).toBe(`CC/Synapse · ${label}`)
    expect(config.mode).toBe(mode)
  })

  it("continues to reject an unknown permission mode without a display fallback", () => {
    const config = { ...rendererActionRegistry.getDefaultConfig("builtin.agent"), projectId: "project-1", providerId: "provider-1", prompt: "Reply OK", mode: "unknown-permission" }
    expect(() => rendererActionRegistry.summarize("builtin.agent", config)).toThrow()
  })

  it("offers Agent and Claude Code for Automation", () => {
    expect(rendererActionRegistry.list().map(action => action.manifest.id)).toEqual(["builtin.agent", "builtin.claude-code"])
    for (const type of ["command", "script", "http-request", "workflow", "javascript-run", "nodejs-run"]) {
      expect(() => rendererActionRegistry.get(`builtin.${type}`)).toThrow(/not registered/)
    }
  })
})
