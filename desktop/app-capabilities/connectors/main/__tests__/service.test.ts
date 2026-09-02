import { describe, expect, it, vi } from "vitest"
import { createConnectorsService } from "../service"

function createHarness() {
  const store = new Map<string, Record<string, unknown>>()
  const items = {
    get: vi.fn(async (id: string) => store.get(id)),
    list: vi.fn(async () => [...store.values()]),
    upsert: vi.fn(async (entry: Record<string, unknown>) => { store.set(String(entry.id), entry) }),
  }
  const credentials = {
    get: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    upsert: vi.fn(async () => undefined),
  }
  const service = createConnectorsService({
    items: items as never,
    credentials: credentials as never,
    logger: { warn: vi.fn() },
    probeDesktopServer: vi.fn(async () => true),
  })
  return { service, items, credentials }
}

describe("connectors service", () => {
  it("connects Figma Desktop MCP without OAuth or bearer token storage", async () => {
    const { service, items, credentials } = createHarness()

    await service.initialize()
    const connected = await service.connect("figma")
    expect(connected.status).toBe("connected")
    expect(credentials.upsert).not.toHaveBeenCalled()

    await expect(service.getMcpServers()).resolves.toEqual({
      figma: { type: "http", url: "http://127.0.0.1:3845/mcp" },
    })
    expect(items.upsert).toHaveBeenCalled()
  })

  it("migrates an older remote connector row to Desktop MCP", async () => {
    const { service, items } = createHarness()
    await items.upsert({
      id: "figma",
      schemaVersion: 1,
      providerKey: "figma",
      name: "Figma",
      description: "在 Claude 会话中使用 Figma MCP",
      endpoint: "https://mcp.figma.com/mcp",
      authType: "oauth2",
      status: "connecting",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await service.initialize()
    await expect(service.getMcpServers()).resolves.toEqual({})
    expect(items.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "figma",
      endpoint: "http://127.0.0.1:3845/mcp",
      authType: "none",
      status: "available",
    }))
  })

  it("surfaces a clear setup error when Figma Desktop MCP is not running", async () => {
    const { items } = createHarness()
    const probe = vi.fn(async () => false)
    const unavailableService = createConnectorsService({
      items: items as never,
      credentials: { remove: vi.fn(async () => undefined) } as never,
      logger: { warn: vi.fn() },
      probeDesktopServer: probe,
    })

    await unavailableService.initialize()
    await expect(unavailableService.connect("figma")).rejects.toThrow("未检测到 Figma Desktop MCP")
    expect(probe).toHaveBeenCalledOnce()
    await expect(unavailableService.getMcpServers()).resolves.toEqual({})
  })
})
