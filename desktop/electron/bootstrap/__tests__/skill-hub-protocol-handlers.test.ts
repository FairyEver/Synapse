import { describe, expect, it } from "vitest"
import { parseDeclaredAppDeepLink } from "../app-deep-link"
import { createSkillHubProtocolHandlers } from "../skill-hub-protocol-handlers"

describe("Skill Hub install protocol", () => {
  it("passes only a validated Skill ID and a fresh request ID to the installer", async () => {
    const open = async (value: { requestId: string; skillId: string }) => { requests.push(value) }
    const requests: { requestId: string; skillId: string }[] = []
    const handlers = createSkillHubProtocolHandlers(open)
    const route = parseDeclaredAppDeepLink("synapse://skill-hub/install?skillId=skill_1")
    if (!("mainHandlerId" in route)) throw new Error("expected private handler")
    const handle = handlers[route.mainHandlerId as keyof typeof handlers]
    await handle(route.params)
    await handle(route.params)
    expect(requests.map((r) => r.skillId)).toEqual(["skill_1", "skill_1"])
    expect(requests[0].requestId).not.toBe(requests[1].requestId)
  })
  it.each(["?skillId=a&skillId=b", "?skillId=a#foo", "?skillId=a#", "?skillId=a&version=2",
    "?skillId=%2Fa", "?url=https://example.test", "?skillId=a&target=/tmp", "?skillId=a\n"])("rejects %s", (query) => {
    expect(() => parseDeclaredAppDeepLink(`synapse://skill-hub/install${query}`)).toThrow()
  })
})
