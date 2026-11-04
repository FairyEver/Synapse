import { expect, it, vi } from "vitest"
import { createSkillHubCapabilityDispatcher } from "../dispatcher"

it("preserves the authenticated transport caller and never dispatches governance tools", async () => {
  const prepare = vi.fn().mockResolvedValue({ preparedSourceId: "ready" })
  const dispatcher = createSkillHubCapabilityDispatcher({ service: { prepare } as never })
  const actor = { kind: "agent" as const, id: "agent-1" }
  const signal = new AbortController().signal
  const context = { source: "mcp-http" as const, actor, clientId: "transport", abortSignal: signal }
  await expect(dispatcher.dispatch("app.skill_hub.package.prepare", { sourcePath: "/skill", teamId: "team" }, context))
    .resolves.toMatchObject({ ok: true })
  expect(prepare).toHaveBeenCalledWith({ sourcePath: "/skill", teamId: "team" }, { actor, clientId: "transport", signal })
  await expect(dispatcher.dispatch("app.skill_hub.skill.restore", { skillId: "asset" }, context)).resolves.toMatchObject({ ok: false })
  await expect(dispatcher.dispatch("app.skill_hub.package.prepare", { sourcePath: "/skill", token: "do-not-pass" }, context))
    .resolves.toMatchObject({ ok: false, code: "HUB_INVALID_INPUT" })
  expect(prepare).toHaveBeenCalledOnce()
})
