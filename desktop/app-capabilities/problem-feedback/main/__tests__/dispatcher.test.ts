import { PROBLEM_FEEDBACK_POLICY_FIXTURES } from "@synapse/shared"
import { describe, expect, it, vi } from "vitest"
import { PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID } from "../../shared/capability"
import { createProblemFeedbackCapabilityDispatcher } from "../dispatcher"

describe("problem feedback capability dispatcher", () => {
  it("uses the shared policy and preserves accepted content", async () => {
    const submit = vi.fn(async () => ({ ok: true as const, data: { success: true as const } }))
    const dispatcher = createProblemFeedbackCapabilityDispatcher({ service: { submit } })
    const input = PROBLEM_FEEDBACK_POLICY_FIXTURES.valid[0]!.input

    await expect(dispatcher.dispatch(
      PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
      input,
      { source: "mcp-http" },
    )).resolves.toEqual({ ok: true, data: { success: true } })
    expect(submit).toHaveBeenCalledWith(input.content, undefined)
  })

  it("rejects every deterministic privacy fixture before transport", async () => {
    const submit = vi.fn()
    const dispatcher = createProblemFeedbackCapabilityDispatcher({ service: { submit } })

    for (const fixture of PROBLEM_FEEDBACK_POLICY_FIXTURES.privacy) {
      await expect(dispatcher.dispatch(
        PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
        { content: fixture.rejected },
        { source: "mcp-stdio" },
      )).resolves.toMatchObject({
        ok: false,
        code: "PRIVACY_RISK",
        data: { category: fixture.category },
      })
    }
    expect(submit).not.toHaveBeenCalled()
  })

  it("rejects non-MCP sources", async () => {
    const dispatcher = createProblemFeedbackCapabilityDispatcher({
      service: { submit: vi.fn() },
    })
    await expect(dispatcher.dispatch(
      PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
      { content: "synthetic" },
      { source: "workflow" },
    )).rejects.toThrow("trusted MCP source")
  })
})
