import { describe, expect, it, vi } from "vitest"
import { SkillHubCloudClient } from "../cloud-client"

describe("Skill Hub desktop cloud transport", () => {
  it("does not return an old account's response after identity invalidation", async () => {
    let change = () => {}
    let resolveFetch!: (value: Response) => void
    const fetchAuthenticated = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const scope = { accountId: "old", authRevision: 1 }
    const cloud = new SkillHubCloudClient({
      captureAccountRequestScope: () => scope,
      onBeforeIdentityChange: (listener) => { change = listener; return () => {} },
      fetchAuthenticated,
    })
    const operation = cloud.capture()
    const result = cloud.teams(operation, { limit: 1 })
    change()
    resolveFetch(Response.json({ items: [], nextCursor: null, selectionState: "none", defaultTeamId: null }))
    await expect(result).rejects.toMatchObject({ code: "HUB_ACCOUNT_CHANGED" })
    expect(fetchAuthenticated.mock.calls).toHaveLength(1)
    expect(fetchAuthenticated).toHaveBeenCalledWith("/skill-hub/teams?limit=1", expect.any(Object), expect.any(String), scope)
    cloud.dispose()
  })
})
