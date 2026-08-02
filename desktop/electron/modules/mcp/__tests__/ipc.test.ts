import { beforeEach, describe, expect, it, vi } from "vitest"

import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { mcpIpcModule } from "../ipc"

const mocks = vi.hoisted(() => ({
  getMcpServerPort: vi.fn(() => 23578),
  getMcpServerUrl: vi.fn(() => "http://127.0.0.1:23578/mcp"),
  getMcpServers: vi.fn(),
  isMcpServerRunning: vi.fn(() => true),
  openMcpSettings: vi.fn(),
  registerMcp: vi.fn(),
}))

vi.mock("../../../database/mcp-installer", () => ({
  getMcpServers: mocks.getMcpServers,
  openMcpSettings: mocks.openMcpSettings,
  registerMcp: mocks.registerMcp,
}))

vi.mock("../../../database/mcp-server", () => ({
  getMcpServerPort: mocks.getMcpServerPort,
  getMcpServerUrl: mocks.getMcpServerUrl,
  isMcpServerRunning: mocks.isMcpServerRunning,
}))

describe("mcpIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMcpServers.mockResolvedValue([])
    mocks.openMcpSettings.mockResolvedValue({ success: true })
    mocks.registerMcp.mockResolvedValue({ success: true })
  })

  it("declares the four canonical MCP operations", () => {
    expect(mcpIpcModule.id).toBe("mcp")
    expect(Object.values(mcpIpcModule.methods).map((method) => method.operationId)).toEqual([
      "app.mcp.server.get",
      "app.mcp.registration.list",
      "app.mcp.registration.open_settings",
      "app.mcp.registration.register",
    ])
  })

  it("returns the global MCP server status and client registrations", async () => {
    const registration = {
      target: "codex",
      settingsPath: "/Users/test/.codex/config.toml",
      settingsFileExists: true,
      registered: true,
      mode: "http" as const,
      url: "http://127.0.0.1:23578/mcp",
    }
    mocks.getMcpServers.mockResolvedValue([registration])

    await expect(mcpIpcModule.methods.serverGet.handler(context(), undefined)).resolves.toEqual({
      running: true,
      port: 23578,
      url: "http://127.0.0.1:23578/mcp",
    })
    await expect(mcpIpcModule.methods.registrationList.handler(context(), undefined))
      .resolves.toEqual([registration])
  })

  it("opens client settings and registers through the existing secured registrar", async () => {
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = context({ permissionGuard, auditSink })

    await expect(mcpIpcModule.methods.registrationOpenSettings.handler(ctx, "codex"))
      .resolves.toEqual({ success: true })
    await expect(mcpIpcModule.methods.registrationRegister.handler(ctx, "codex"))
      .resolves.toEqual({ success: true })

    expect(mocks.openMcpSettings).toHaveBeenCalledWith("codex")
    expect(mocks.registerMcp).toHaveBeenCalledWith("codex", 23578, {
      actor: { kind: "user", id: "renderer:7", display: "MCP App" },
      source: "mcp.registration.register",
      permissionGuard,
      auditSink,
    })
  })

  it("validates registration targets and response shapes", () => {
    expect(mcpIpcModule.methods.registrationRegister.request.safeParse("").success).toBe(false)
    expect(mcpIpcModule.methods.registrationRegister.request.safeParse("codex").success).toBe(true)
    expect(mcpIpcModule.methods.registrationList.response?.safeParse([{
      target: "codex",
      settingsPath: "/tmp/config.toml",
      settingsFileExists: false,
      registered: false,
      mode: null,
      url: null,
    }]).success).toBe(true)
  })
})

function context(services?: { permissionGuard: unknown; auditSink: unknown }): IpcHandlerContext {
  return {
    moduleId: "mcp",
    sender: {
      id: 7,
      isDestroyed: () => false,
      onDestroyed: () => () => undefined,
    },
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.permission-guard" && services) return services.permissionGuard as T
      if (serviceId === "core.audit-sink" && services) return services.auditSink as T
      throw new Error(`Unexpected service id: ${serviceId}`)
    },
  }
}
