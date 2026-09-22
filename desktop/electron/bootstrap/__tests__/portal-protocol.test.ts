import { describe, expect, it, vi } from "vitest"
import { createProtocolUrlRouter } from "../protocol-router"
import { createConnectorProtocolHandlers } from "../connector-protocol-handlers"
import { parseDeclaredAppDeepLink } from "../app-deep-link"
import { CAPABILITY_DOMAINS } from "../../../synapse-capabilities/shared/registry"
const token = "synthetic-callback-token"
const raw = `synapse://portal-headless-test/callback?status=success&state=${"s".repeat(43)}&token=${token}&tenantId=2&portalUserId=42`
function harness(error?: Error) {
  const handleCallback = vi.fn(async () => { if (error) throw error })
  const registry = { get: vi.fn(() => ({ handleCallback })) }
  const deps = { focusMainWindow: vi.fn(), handleAuthCallback: vi.fn(), logger: { warn: vi.fn() },
    openSkillRepositoryInstallWindow: vi.fn(), publishUpdateOpenRequest: vi.fn(), verifyUpdateIntent: vi.fn(),
    dispatchAppAction: vi.fn(), showAppDeepLinkError: vi.fn(), privateProtocolHandlers: createConnectorProtocolHandlers(registry as never) }
  return { deps, handleCallback }
}
describe("private Portal protocol dispatch", () => {
  it("routes only to the connector, never account auth or public capability dispatch", async () => {
    const h = harness(); await createProtocolUrlRouter(h.deps, [raw]).start()
    expect(h.handleCallback).toHaveBeenCalledWith("portal-headless-test", raw)
    expect(h.deps.dispatchAppAction).not.toHaveBeenCalled()
    expect(h.deps.handleAuthCallback).not.toHaveBeenCalled()
    expect(parseDeclaredAppDeepLink(raw)).not.toHaveProperty("capabilityId")
    expect(CAPABILITY_DOMAINS.flatMap((domain) => domain.capabilities.map((capability) => capability.id)).filter((id) => id.includes("portal") || id.includes("connectors"))).toEqual([])
    expect(h.deps.logger.warn).not.toHaveBeenCalled()
  })
  it("sanitizes failures before dialogs and logs, rejects undeclared/public aliases", async () => {
    const h = harness(Object.assign(new Error(token), { code: token }))
    await createProtocolUrlRouter(h.deps, [raw, raw + "&token=duplicate", "synapse://app/connectors/callback?token=" + token]).start()
    expect(h.handleCallback).toHaveBeenCalledTimes(1)
    expect(JSON.stringify([h.deps.logger.warn.mock.calls, h.deps.showAppDeepLinkError.mock.calls])).not.toContain(token)
    expect(h.deps.dispatchAppAction).not.toHaveBeenCalled()
  })
})
