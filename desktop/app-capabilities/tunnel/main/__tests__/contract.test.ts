import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { CAPABILITY_DOMAINS, MCP_TOOL_ACTIONS, buildAllMcpTools } from "../../../../synapse-capabilities/shared/registry"
import { unwrapTunnelResult } from "../../shared/bridge"
describe("tunnel integration contract", () => {
  it("keeps background restoration after window startup and preserves failures", () => {
    const ready = readFileSync("electron/bootstrap/app-ready.ts", "utf8")
    expect(ready.indexOf("startBackground()")).toBeGreaterThan(ready.indexOf("createMainWindow"))
    const source = readFileSync("electron/bootstrap/descriptors.ts", "utf8")
    expect(source).toContain('id: "app.tunnel.background", criticality: "degraded", startupPhase: "background"')
    expect(() => unwrapTunnelResult({ ok: false, failure: { status: 409, code: "TUNNEL_REVISION_CONFLICT", message: "刷新后重试" } })).toThrow("刷新后重试")
  })
  it("has matching tool counts", () => {
    expect(buildAllMcpTools()).toHaveLength(Object.keys(MCP_TOOL_ACTIONS).length)
    process.stdout.write(JSON.stringify({ capabilities: CAPABILITY_DOMAINS.reduce((sum, d) => sum + d.capabilities.length, 0), tools: buildAllMcpTools().length }) + "\n")
  })
})
