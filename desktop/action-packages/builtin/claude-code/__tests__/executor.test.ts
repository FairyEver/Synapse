import { describe, expect, it, vi } from "vitest"
import { createClaudeCodeAction } from "../executor.main"
import type { ActionExecutionInput } from "../../../../electron/action-runtime/action-registry"
import { claudeCodeActionConfigSchema } from "../schema"
import { claudeCodeActionManifest } from "../manifest"
vi.mock("../../../../electron/services/log-store", () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))

function input(signal = new AbortController().signal): ActionExecutionInput<{ projectId: string; prompt: string }> {
  return { config: { projectId: "p1", prompt: "Review {{trigger.name}}" }, context: {
    taskId: "a1", runId: "r1", cwd: "/tmp", triggeredBy: "schedule",
    actor: { kind: "user", id: "automation" }, abortSignal: signal,
    templateVariables: { "trigger.name": "中文\nproject" }, persistOutputs: vi.fn(async () => undefined),
  } }
}

describe("Claude Code automation action", () => {
  it("keeps legacy tasks interactive and accepts only a boolean single-run option", () => {
    expect(claudeCodeActionConfigSchema.parse({ projectId: "p1", prompt: "Review" })).toEqual({ projectId: "p1", prompt: "Review" })
    expect(claudeCodeActionManifest.defaultConfig).toMatchObject({ singleRun: false })
    expect(claudeCodeActionConfigSchema.parse({ projectId: "p1", prompt: "Review", singleRun: true }).singleRun).toBe(true)
    expect(() => claudeCodeActionConfigSchema.parse({ projectId: "p1", prompt: "Review", singleRun: "true" })).toThrow()
  })

  it.each([true, false, undefined])("passes singleRun=%s without changing submission-based completion", async singleRun => {
    const request = { ...input(), config: { ...input().config, singleRun } }
    const launch = vi.fn(async options => {
      expect(options.singleRun).toBe(singleRun)
      await options.onCreated("s1")
      return { id: "s1" }
    })
    const result = await createClaudeCodeAction({ launch }).execute(request)
    expect(result).toMatchObject({ status: "success", summary: "已启动 Claude Code 并提交提示词" })
  })
  it("saves the association before launch and succeeds only after submission confirmation", async () => {
    let confirm!: () => void
    const confirmation = new Promise<void>(resolve => { confirm = resolve })
    const request = input()
    const action = createClaudeCodeAction({ launch: async launch => {
      expect(launch.initialPrompt).toBe("Review 中文\nproject")
      expect(launch).not.toHaveProperty("providerId")
      expect(launch).not.toHaveProperty("modelTier")
      expect(launch.actor).toEqual(request.context.actor)
      await launch.onCreated?.("s1")
      await confirmation
      return { id: "s1" }
    } })
    let completed = false
    const running = action.execute(request).then(result => { completed = true; return result })
    await vi.waitFor(() => expect(request.context.persistOutputs).toHaveBeenCalledWith({ projectId: "p1", sessionId: "s1" }))
    expect(completed).toBe(false)
    confirm()
    expect(await running).toMatchObject({ status: "success", outputs: { projectId: "p1", sessionId: "s1" } })
  })

  it("keeps a created terminal on cancelled confirmation without relaunching", async () => {
    const controller = new AbortController()
    const launch = vi.fn(async (options) => {
      await options.onCreated("s1")
      controller.abort()
      throw controller.signal.reason
    })
    const result = await createClaudeCodeAction({ launch }).execute(input(controller.signal))
    expect(result).toMatchObject({ status: "cancelled", outputs: { sessionId: "s1" } })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it("does not launch an empty expanded prompt or expose raw launch errors", async () => {
    const launch = vi.fn(async () => { throw new Error("secret provider credential") })
    const request = input()
    request.config.prompt = "{{missing}}"
    const action = createClaudeCodeAction({ launch })
    expect((await action.execute(request)).status).toBe("failed")
    expect(launch).not.toHaveBeenCalled()
    request.config.prompt = "review"
    const result = await action.execute(request)
    expect(result.status).toBe("failed")
    expect(result.error).not.toContain("secret")
  })

  it("ends an unconfirmed launch as timeout while retaining its terminal and never resending", async () => {
    const timeout = new AbortController()
    const timer = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal)
    const launch = vi.fn(async options => {
      await options.onCreated("s1")
      timeout.abort(new DOMException("confirmation deadline", "TimeoutError"))
      throw options.abortSignal.reason
    })
    try {
      const result = await createClaudeCodeAction({ launch }).execute(input())
      expect(result).toMatchObject({ status: "timeout", outputs: { projectId: "p1", sessionId: "s1" } })
      expect(launch).toHaveBeenCalledTimes(1)
    } finally { timer.mockRestore() }
  })
})
