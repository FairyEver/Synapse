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
    // extend.* 能力由扩展经 ExtensionPoint 注册：仅允许 MCP 来源、不派生 IPC，也不进入
    // 应用深链声明（见 .claude/rules/api.md），拿不到 `capabilityId`。所以这条守的是
    // 「Portal 连接器不走公开能力派发」，只看可经应用深链公开派发的域。
    const publiclyDispatchableCapabilityIds = CAPABILITY_DOMAINS
      .filter((domain) => domain.id !== "extend")
      .flatMap((domain) => domain.capabilities.map((capability) => capability.id))
    expect(publiclyDispatchableCapabilityIds.filter((id) => id.includes("portal") || id.includes("connectors"))).toEqual([])
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
