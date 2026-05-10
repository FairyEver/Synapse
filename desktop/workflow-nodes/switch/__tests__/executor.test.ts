import { describe, expect, it, vi } from "vitest"
import { switchNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }
const config = {
  agent: "claude-code", variables: [], prompt: "Which?",
  branches: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
}

describe("switchNodeExecutor", () => {
  it("sets activeBranch when response matches branch id (trims + lowercases)", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "  YES  ", durationMs: 5 }) },
    })
    expect(r.activeBranch).toBe("yes")
  })
  it("uses defaultBranch on mismatch if configured", async () => {
    const r = await switchNodeExecutor.execute({
      config: { ...config, defaultBranch: "no" }, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "maybe", durationMs: 5 }) },
    })
    expect(r.status).toBe("success"); expect(r.activeBranch).toBe("no")
  })
  it("returns failed on mismatch with no defaultBranch", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "maybe", durationMs: 5 }) },
    })
    expect(r.status).toBe("failed"); expect(r.error).toContain("maybe")
  })
  it("appends branch list constraint to prompt", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 })
    await switchNodeExecutor.execute({ config, resolvedVariables: {}, context: ctx, agentDeps: { sendToAgent } })
    const sent = (sendToAgent.mock.calls[0][0] as { prompt: string }).prompt
    expect(sent).toContain("- yes"); expect(sent).toContain("- no")
  })
})
