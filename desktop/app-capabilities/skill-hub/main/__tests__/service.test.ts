import { describe, expect, it, vi } from "vitest"
import { DesktopSkillHubService } from "../service"

describe("Skill Hub desktop preparation", () => {
  it("does not read a source when the current account has no team", async () => {
    const prepare = vi.fn()
    const service = new DesktopSkillHubService({
      cloud: {
        capture: () => ({ scope: { accountId: "caller", authRevision: 1 }, signal: new AbortController().signal }),
        teams: async () => ({ items: [], nextCursor: null, selectionState: "none", defaultTeamId: null }),
      },
      packages: { prepare },
      guard: { check: vi.fn().mockResolvedValue({ allowed: true }) },
      audit: { record: vi.fn() },
    } as never)
    await expect(service.prepare({ sourcePath: "/fixture/skill" }, { actor: { kind: "user" }, clientId: "client" }))
      .rejects.toMatchObject({ code: "HUB_NO_TEAM" })
    expect(prepare).not.toHaveBeenCalled()
  })
})

it("preserves the original write key after a lost response and checks the receipt across restarts", async () => {
  const { SkillHubDesktopError } = await import("../error.js")
  const records = new Map()
  const namespace = { get: async (id: string) => records.get(id) ?? null }
  const repository = {
    namespace: () => namespace,
    commitBatch: vi.fn(async ({ operations }) => {
      records.set(operations[0].id, operations[0].value)
      return { committed: true }
    }),
  }
  let accountId = "original"
  const receipt = vi.fn(async (_op, key) => ({ ...key, status: "committed", resultAccessible: false }))
  const remove = vi.fn().mockRejectedValue(new SkillHubDesktopError("HUB_CONNECTION_ERROR", "fixture connection reset"))
  const deps = {
    cloud: {
      capture: () => ({ scope: { accountId, authRevision: 1 }, signal: new AbortController().signal }),
      assertActive: vi.fn(), delete: remove, receipt,
    },
    repository, guard: { check: vi.fn().mockResolvedValue({ allowed: true }) }, audit: { record: vi.fn() },
  }
  const caller = { actor: { kind: "user" as const }, clientId: "client" }
  const input = { skillId: "asset", requestId: "stable", expectedRevision: 1 }
  await expect(new DesktopSkillHubService(deps as never).delete(input, caller)).rejects.toMatchObject({
    code: "HUB_WRITE_UNKNOWN", data: { action: "app.skill_hub.skill.delete", requestId: "stable" },
  })
  const restarted = new DesktopSkillHubService(deps as never)
  await expect(restarted.delete(input, caller)).resolves.toMatchObject({ replayed: true, receipt: { status: "committed", requestId: "stable" } })
  expect(remove).toHaveBeenCalledOnce()
  accountId = "other"
  await expect(restarted.getReceipt({ action: "app.skill_hub.skill.delete", requestId: "stable" }, caller))
    .rejects.toMatchObject({ code: "HUB_ACCOUNT_CHANGED" })
  expect(receipt).toHaveBeenCalledOnce()
})
