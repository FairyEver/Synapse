import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

const state = vi.hoisted(() => ({
  home: `${process.cwd()}/.tmp-mcp-installer-test`,
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("node:os", () => ({
  homedir: () => state.home,
}))

vi.mock("electron", () => ({
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock("../mcp-server", () => ({
  getMcpServerToken: () => "test-token",
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => state.logger,
}))

function createSecurity(decision: { allowed: true } | { allowed: false; reason: string; policyId?: string }) {
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => decision),
  }
  const auditSink: AuditSink = {
    record: (event) => {
      auditEvents.push(event)
    },
    list: () => [],
    clearForTests: () => {},
  }

  return {
    auditEvents,
    security: {
      actor: { kind: "user" as const },
      source: "test.mcp.register",
      permissionGuard,
      auditSink,
    },
    permissionGuard,
  }
}

describe("mcp-installer", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    rmSync(state.home, { recursive: true, force: true })
    mkdirSync(path.join(state.home, ".cursor"), { recursive: true })
  })

  afterEach(() => {
    rmSync(state.home, { recursive: true, force: true })
  })

  it("preserves damaged settings read state instead of reporting unregistered", async () => {
    writeFileSync(path.join(state.home, ".claude.json"), "{", "utf8")

    const { getMcpServers } = await import("../mcp-installer")

    const claude = getMcpServers().find((server) => server.target === "claude")
    expect(claude).toMatchObject({
      target: "claude",
      settingsFileExists: true,
      registered: false,
      mode: null,
      readError: "配置读取失败",
    })
    expect(state.logger.warn).toHaveBeenCalledWith("MCP settings read failed.", {
      target: "claude",
      errorName: "Error",
      errorLength: expect.any(Number),
    })
  })

  it("blocks editor MCP config writes when permission is denied", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { auditEvents, permissionGuard, security } = createSecurity({
      allowed: false,
      reason: "blocked by policy",
      policyId: "deny-mcp",
    })
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")

    const result = await registerMcp("cursor", 51234, security)

    expect(result).toEqual({ success: false, error: "blocked by policy" })
    expect(existsSync(settingsPath)).toBe(false)
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: settingsPath,
      context: expect.objectContaining({
        operation: "register",
        settingsPath,
        source: "test.mcp.register",
        target: "cursor",
        writesSecret: true,
      }),
    }))
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        resource: settingsPath,
        outcome: "denied",
        metadata: expect.objectContaining({
          policyId: "deny-mcp",
          reason: "blocked by policy",
          target: "cursor",
        }),
      }),
    ])
  })

  it("audits allowed editor MCP config writes without leaking bearer tokens", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { auditEvents, security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")

    const result = await registerMcp("cursor", 51234, security)

    expect(result).toEqual({ success: true })
    expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
          headers: {
            Authorization: "Bearer test-token",
          },
        },
      },
    })
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "fs.write",
        outcome: "allowed",
        resource: settingsPath,
        metadata: expect.objectContaining({
          operation: "register",
          target: "cursor",
          writesSecret: true,
        }),
      }),
    ])
    expect(JSON.stringify(auditEvents)).not.toContain("test-token")
  })

  it("uses system actor for automatic MCP registration", async () => {
    const { autoRegisterMcp } = await import("../mcp-installer")
    const { permissionGuard } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")

    await autoRegisterMcp(51234, {
      actor: { kind: "system", id: "database" },
      source: "database.mcp.autoRegister",
      permissionGuard,
    })

    expect(existsSync(settingsPath)).toBe(true)
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "system", id: "database" },
      resource: settingsPath,
      context: expect.objectContaining({
        source: "database.mcp.autoRegister",
        target: "cursor",
      }),
    }))
  })
})
