import { describe, expect, it, vi } from "vitest"
import { figmaConnector } from "../definitions"
import { ConnectorDriverRegistry } from "../driver-registry"
import type { ConnectorDriver } from "../types"

const driver: ConnectorDriver = {
  probe: vi.fn(async () => ({ ok: true, toolCount: 0 })),
  createAgentContribution: vi.fn(() => ({ mcpServers: [], skillPackageIds: [] })),
}

describe("ConnectorDriverRegistry", () => {
  it("resolves a driver by integration kind", () => {
    const registry = new ConnectorDriverRegistry()
    registry.register("mcp-streamable-http", driver)

    expect(registry.resolve(figmaConnector)).toBe(driver)
  })

  it("rejects duplicate registration and missing drivers", () => {
    const registry = new ConnectorDriverRegistry()
    registry.register("mcp-streamable-http", driver)

    expect(() => registry.register("mcp-streamable-http", driver)).toThrow("already registered")
    expect(() => new ConnectorDriverRegistry().resolve(figmaConnector)).toThrow("Unsupported connector integration")
  })
})
