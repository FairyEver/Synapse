import { describe, expect, it, vi } from "vitest"
import { SkillHubDesktopError } from "../error"
import { skillHubIpcModule } from "../ipc"
import { SKILL_HUB_SERVICE_ID } from "../service"

vi.mock("../../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

function catalogContext(allowed: boolean) {
  const openSkillInstaller = vi.fn().mockResolvedValue(undefined)
  const get = vi.fn().mockResolvedValue({ id: "fixture" })
  const onDestroyed = vi.fn(() => vi.fn())
  return {
    openSkillInstaller, get,
    context: {
      moduleId: "skillHub",
      sender: { id: 17, isDestroyed: () => false, onDestroyed },
      resolve: <T>(id: string) => (id === SKILL_HUB_SERVICE_ID ? { get } : {
        isSkillHubCatalogSender: () => allowed, openSkillInstaller,
      }) as T,
    },
  }
}

describe("SkillHub catalog installation entry", () => {
  const method = skillHubIpcModule.methods.catalogOpenInstaller

  it("rejects extra install options and callers outside the catalog windows", async () => {
    const fixture = catalogContext(false)
    expect(method.request.safeParse({ skillId: "fixture", overwrite: true }).success).toBe(false)
    await expect(method.handler(fixture.context, { skillId: "fixture" })).resolves.toMatchObject({ ok: false, code: "HUB_FORBIDDEN" })
    expect(fixture.get).not.toHaveBeenCalled()
    expect(fixture.openSkillInstaller).not.toHaveBeenCalled()
  })

  it("opens the existing installer with only an ID after the signed-in account can read it", async () => {
    const fixture = catalogContext(true)
    fixture.get.mockRejectedValueOnce(new SkillHubDesktopError("HUB_NOT_AVAILABLE", "无权访问"))
    await expect(method.handler(fixture.context, { skillId: "fixture" })).resolves.toMatchObject({ ok: false, code: "HUB_NOT_AVAILABLE" })
    expect(fixture.openSkillInstaller).not.toHaveBeenCalled()

    await expect(method.handler(fixture.context, { skillId: "fixture" })).resolves.toEqual({ ok: true, value: null })
    expect(fixture.openSkillInstaller).toHaveBeenCalledExactlyOnceWith({ requestId: expect.any(String), skillId: "fixture" })
  })
})
