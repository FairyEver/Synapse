import { describe, expect, it, vi } from "vitest"
import { figmaConnector } from "../definitions"
import { ConnectorDriverRegistry } from "../driver-registry"
import { createConnectorsService } from "../service"
import type { BuiltinConnectorDefinition, ConnectorDriver, ProbeResult } from "../types"

function createHarness(options: {
  readonly probe?: ProbeResult
  readonly legacy?: Record<string, unknown>
  readonly initialState?: Record<string, unknown>
  readonly definitions?: readonly BuiltinConnectorDefinition[]
} = {}) {
  let state: Record<string, unknown> | null = options.initialState ?? null
  const legacy = new Map<string, Record<string, unknown>>()
  if (options.legacy) legacy.set(String(options.legacy.id), options.legacy)
  const stateNamespace = {
    getSingleton: vi.fn(async () => state),
    setSingleton: vi.fn(async (value: Record<string, unknown>) => { state = value }),
  }
  const legacyItems = {
    get: vi.fn(async (id: string) => legacy.get(id) ?? null),
    remove: vi.fn(async (id: string) => { legacy.delete(id) }),
  }
  const driver: ConnectorDriver = {
    probe: vi.fn(async () => options.probe ?? { ok: true, toolCount: 2 }),
    createAgentContribution: vi.fn((definition) => ({
      mcpServers: [{ name: definition.id, config: { type: "http", url: definition.integration.endpoint } }],
      skillPackageIds: [definition.skillPackageId],
    })),
  }
  const drivers = new ConnectorDriverRegistry()
  drivers.register("mcp-streamable-http", driver)
  const logger = { warn: vi.fn() }
  const service = createConnectorsService({
    state: stateNamespace as never,
    legacyItems: legacyItems as never,
    drivers,
    definitions: options.definitions,
    logger,
    now: () => new Date("2026-09-03T08:00:00.000Z"),
  })
  return { service, stateNamespace, legacyItems, driver, logger, readState: () => state }
}

describe("connectors service", () => {
  it("lists builtin definitions and enables a connector only after a successful probe", async () => {
    const { service, driver, readState } = createHarness()

    await service.initialize()
    await expect(service.list()).resolves.toEqual({
      items: [{
        id: "figma",
        name: "Figma",
        description: "连接 Figma Desktop MCP",
        documentationUrl: "https://synapse.d2.pub/document/connectors/figma",
        enabled: false,
        probeStatus: "idle",
      }],
    })

    await expect(service.connect("figma")).resolves.toMatchObject({
      id: "figma",
      enabled: true,
      probeStatus: "ready",
    })
    expect(driver.probe).toHaveBeenCalledWith(figmaConnector)
    expect(readState()).toEqual({
      schemaVersion: 1,
      connectors: {
        figma: {
          enabled: true,
          lastProbe: { at: "2026-09-03T08:00:00.000Z", status: "success" },
        },
      },
    })
  })

  it("persists a stable failure code without enabling the connector", async () => {
    const { service, logger, readState } = createHarness({
      probe: { ok: false, errorCode: "required_tools_missing" },
    })

    await service.initialize()
    await expect(service.connect("figma")).rejects.toThrow("缺少必要工具")
    await expect(service.getEnabledConnectorIds()).resolves.toEqual([])
    await expect(service.list()).resolves.toMatchObject({
      items: [{ enabled: false, probeStatus: "error", errorMessage: expect.stringContaining("缺少必要工具") }],
    })
    expect(readState()).toEqual({
      schemaVersion: 1,
      connectors: {
        figma: {
          enabled: false,
          lastProbe: {
            at: "2026-09-03T08:00:00.000Z",
            status: "failed",
            errorCode: "required_tools_missing",
          },
        },
      },
    })
    expect(logger.warn).toHaveBeenCalledWith("Connector probe failed.", expect.objectContaining({
      connectorId: "figma",
      errorCode: "required_tools_missing",
    }))
  })

  it("migrates a connected local Figma row and removes the legacy source", async () => {
    const timestamp = "2026-09-02T08:00:00.000Z"
    const { service, legacyItems, readState } = createHarness({
      legacy: {
        id: "figma",
        schemaVersion: 1,
        providerKey: "figma",
        name: "Figma",
        endpoint: "http://127.0.0.1:3845/mcp",
        authType: "none",
        status: "connected",
        lastConnectedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    })

    await service.initialize()

    expect(readState()).toEqual({
      schemaVersion: 1,
      connectors: {
        figma: { enabled: true, lastProbe: { at: timestamp, status: "success" } },
      },
    })
    expect(legacyItems.remove).toHaveBeenCalledWith("figma")
  })

  it("does not enable an older remote or OAuth Figma row", async () => {
    const timestamp = "2026-09-02T08:00:00.000Z"
    const { service, readState } = createHarness({
      legacy: {
        id: "figma",
        schemaVersion: 1,
        providerKey: "figma",
        name: "Figma",
        endpoint: "https://mcp.figma.com/mcp",
        authType: "oauth2",
        status: "connected",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    })

    await service.initialize()

    expect(readState()).toEqual({
      schemaVersion: 1,
      connectors: { figma: { enabled: false } },
    })
  })

  it("does not re-import legacy state after the new state store exists", async () => {
    const timestamp = "2026-09-02T08:00:00.000Z"
    const initialState = { schemaVersion: 1, connectors: { figma: { enabled: false } } }
    const { service, readState } = createHarness({
      initialState,
      legacy: {
        id: "figma",
        endpoint: "http://127.0.0.1:3845/mcp",
        authType: "none",
        status: "connected",
        lastConnectedAt: timestamp,
        updatedAt: timestamp,
      },
    })

    await service.initialize()

    expect(readState()).toBe(initialState)
  })

  it("creates contributions from the conversation snapshot after the connector is disabled", async () => {
    const { service } = createHarness()
    await service.initialize()
    await service.connect("figma")
    await service.disconnect("figma")

    await expect(service.getEnabledConnectorIds()).resolves.toEqual([])
    expect(service.createAgentContribution(["figma", "figma"])).toEqual({
      mcpServers: [{
        name: "figma",
        config: { type: "http", url: "http://127.0.0.1:3845/mcp" },
      }],
      skillPackageIds: ["figma-skill"],
    })
  })

  it("merges multiple connector definitions without connector-specific service branches", async () => {
    const secondDefinition: BuiltinConnectorDefinition = {
      id: "design-tool",
      name: "Design Tool",
      skillPackageId: "design-tool-skill",
      integration: { kind: "mcp-streamable-http", endpoint: "http://127.0.0.1:3900/mcp" },
    }
    const { service } = createHarness({ definitions: [figmaConnector, secondDefinition] })
    await service.initialize()

    expect(service.createAgentContribution(["figma", "design-tool"])).toEqual({
      mcpServers: [
        { name: "figma", config: { type: "http", url: "http://127.0.0.1:3845/mcp" } },
        { name: "design-tool", config: { type: "http", url: "http://127.0.0.1:3900/mcp" } },
      ],
      skillPackageIds: ["figma-skill", "design-tool-skill"],
    })
  })

  it("rejects unknown connector ids", async () => {
    const { service } = createHarness()
    await service.initialize()

    await expect(service.connect("unknown")).rejects.toThrow("连接器不存在")
    expect(() => service.createAgentContribution(["unknown"])).toThrow("连接器不存在")
  })
})
