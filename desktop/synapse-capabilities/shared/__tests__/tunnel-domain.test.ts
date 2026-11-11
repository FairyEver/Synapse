import { describe, expect, it } from "vitest"
import { buildTunnelTools } from "../tunnel-domain"
import { MCP_TOOL_ACTIONS } from "../registry"
import { isCanonicalCapabilityId } from "../naming"
describe("tunnel MCP contract", () => {
  it("exposes six canonical tools without transport credentials", () => {
    const tools = buildTunnelTools()
    expect(tools).toHaveLength(6)
    for (const t of tools) expect(isCanonicalCapabilityId(MCP_TOOL_ACTIONS[t.name]!)).toBe(true)
    expect(MCP_TOOL_ACTIONS.app_tunnel_mapping_create).toBe("app.tunnel.mapping.create")
    expect(JSON.stringify(tools)).not.toMatch(/deviceKey|ticket/u)
    expect(tools.find(t => t.name.endsWith("_create"))!.inputSchema.required).toContain("requestId")
  })
})
