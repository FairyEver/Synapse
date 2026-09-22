import { describe, expect, it } from "vitest"
import { parsePortalCallback } from "../portal-contract"
const target = "synapse://portal-headless-test/callback"
const state = "s".repeat(43)
const valid = `${target}?${new URLSearchParams({ status: "success", state, token: "a+b%&=", tenantId: "20000000000000001", portalUserId: "42" })}`
describe("Portal callback contract", () => {
  it("decodes once without numeric ID truncation", () => {
    expect(parsePortalCallback(valid, target)).toMatchObject({ token: "a+b%&=", tenantId: "20000000000000001" })
  })
  it.each([
    valid.replace("/callback?", "/other?"), valid.replace("portal-headless-test", "portal-headless"),
    valid.replace("synapse:", "https:"), valid.replace("//portal", "//user:password@portal"),
    valid.replace("/callback?", ":9000/callback?"), `${valid}#fragment`, `${valid}&state=${state}`,
    `${valid}&baseUrl=https://attacker.example`, `${valid}&tenant=2`, valid.replace("tenantId=", "tenant="),
    `${target}?status=success&state=${state}`, `${target}?status=cancelled&state=${state}&token=forbidden`,
    `${target}?status=error&state=${state}&errorCode=unknown`,
    `${target}?status=success&state=${state}&token=a%0Ab&tenantId=2&portalUserId=42`,
    `${target}?status=success&state=${state}&token=${"x".repeat(16385)}&tenantId=2&portalUserId=42`,
  ])("rejects invalid callback #%# without echoing input", (raw) => {
    expect(() => parsePortalCallback(raw, target)).toThrow("Portal 回调无效，请重新连接。")
  })
  it("accepts cancellation and defined errors only without credentials", () => {
    expect(parsePortalCallback(`${target}?status=cancelled&state=${state}`, target).status).toBe("cancelled")
    expect(parsePortalCallback(`${target}?status=error&state=${state}&errorCode=login_failed`, target).status).toBe("error")
  })
})
