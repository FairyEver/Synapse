import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createPermissionGuard,
  systemAutomationPolicy,
  systemMcpAutoRegisterPolicy,
  systemShellExecPolicy,
  userInitiatedAllowPolicy,
  type AuditSink,
  type PermissionGuard,
} from "../../runtime/security"

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

function createDefaultPermissionGuard(): PermissionGuard {
  const guard = createPermissionGuard()
  guard.registerPolicy(userInitiatedAllowPolicy)
  guard.registerPolicy(systemShellExecPolicy)
  guard.registerPolicy(systemAutomationPolicy)
  guard.registerPolicy(systemMcpAutoRegisterPolicy)
  return guard
}

describe("mcp-installer", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    rmSync(state.home, { recursive: true, force: true })
    mkdirSync(path.join(state.home, ".cursor"), { recursive: true })
    mkdirSync(path.join(state.home, ".claude"), { recursive: true })
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
        writesSecret: false,
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

  it("audits allowed JSON editor MCP config writes without static authorization headers", async () => {
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
          writesSecret: false,
        }),
      }),
    ])
    expect(readFileSync(settingsPath, "utf-8")).not.toContain("Authorization")
    expect(readFileSync(settingsPath, "utf-8")).not.toContain("Bearer")
  })

  it("backs up existing editor MCP config files before replacing them", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")
    const originalSettings = {
      mcpServers: {
        existing: {
          type: "http",
          url: "http://127.0.0.1:12345/mcp",
        },
      },
    }
    writeFileSync(settingsPath, JSON.stringify(originalSettings, null, 2), "utf8")

    const result = await registerMcp("cursor", 51234, security)

    expect(result).toEqual({ success: true })
    const backups = readdirSync(path.dirname(settingsPath))
      .filter((name) => name.startsWith("mcp.synapse-backup-") && name.endsWith(".json"))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(readFileSync(path.join(path.dirname(settingsPath), backups[0]!), "utf8"))).toEqual(originalSettings)
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).mcpServers).toMatchObject({
      existing: originalSettings.mcpServers.existing,
      "synapse-mcp": {
        type: "http",
        url: "http://127.0.0.1:51234/mcp",
      },
    })
    expect(state.logger.info).toHaveBeenCalledWith("MCP settings backup created before write.", {
      settingsPath: "[path redacted]/mcp.json",
      backupPath: expect.stringMatching(/^\[path redacted\]\/mcp\.synapse-backup-/),
    })
    expect(JSON.stringify(state.logger.info.mock.calls)).not.toContain(state.home)
  })

  it("registers and detects WorkBuddy MCP in the user configuration", async () => {
    const { getMcpServers, registerMcp } = await import("../mcp-installer")
    const { security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".workbuddy", "mcp.json")

    const result = await registerMcp("workbuddy", 51234, security)

    expect(result).toEqual({ success: true })
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
      },
    })
    expect(getMcpServers().find((server) => server.target === "workbuddy")).toMatchObject({
      target: "workbuddy",
      settingsPath,
      settingsFileExists: true,
      registered: true,
      mode: "http",
      url: "http://127.0.0.1:51234/mcp",
    })
  })

  it("preserves existing WorkBuddy MCP servers when registering Synapse", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".workbuddy", "mcp.json")
    mkdirSync(path.dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        existing: {
          command: "node",
          args: ["existing-server.js"],
        },
      },
    }), "utf8")

    const result = await registerMcp("workbuddy", 51234, security)

    expect(result).toEqual({ success: true })
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mcpServers: {
        existing: {
          command: "node",
          args: ["existing-server.js"],
        },
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
      },
    })
  })

  it("skips WorkBuddy automatic registration when its user directory is missing", async () => {
    const { autoRegisterMcp } = await import("../mcp-installer")
    const settingsPath = path.join(state.home, ".workbuddy", "mcp.json")

    await autoRegisterMcp(51234)

    expect(existsSync(settingsPath)).toBe(false)
  })

  it("registers Codex MCP without static authorization headers", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".codex", "config.toml")

    const result = await registerMcp("codex", 51234, security)

    expect(result).toEqual({ success: true })
    const raw = readFileSync(settingsPath, "utf-8")
    expect(raw).toContain("[mcp_servers.synapse-mcp]")
    expect(raw).toContain('url = "http://127.0.0.1:51234/mcp"')
    expect(raw).not.toContain("[mcp_servers.synapse-mcp.headers]")
    expect(raw).not.toContain("Authorization")
    expect(raw).not.toContain("Bearer")
  })

  it("registers Hermes MCP without static authorization headers", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".hermes", "config.yaml")

    const result = await registerMcp("hermes", 51234, security)

    expect(result).toEqual({ success: true })
    const raw = readFileSync(settingsPath, "utf-8")
    expect(raw).toContain("synapse-mcp:")
    expect(raw).toContain("url: http://127.0.0.1:51234/mcp")
    expect(raw).not.toContain("Authorization")
    expect(raw).not.toContain("Bearer")
  })

  it("rejects MCP registration when the HTTP server port is not available", async () => {
    const { registerMcp } = await import("../mcp-installer")
    const { auditEvents, permissionGuard, security } = createSecurity({ allowed: true })
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")

    const result = await registerMcp("cursor", 0, security)

    expect(result).toEqual({ success: false, error: "MCP HTTP 未运行" })
    expect(existsSync(settingsPath)).toBe(false)
    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        resource: settingsPath,
        outcome: "failed",
        metadata: expect.objectContaining({
          error: "MCP HTTP 未运行",
          operation: "register",
          target: "cursor",
        }),
      }),
    ])
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
    expect(state.logger.info).toHaveBeenCalledWith("MCP auto-registered.", expect.objectContaining({
      target: "cursor",
      settingsPath: "[path redacted]/mcp.json",
    }))
    expect(JSON.stringify([
      ...state.logger.info.mock.calls,
      ...state.logger.warn.mock.calls,
      ...state.logger.error.mock.calls,
    ])).not.toContain(state.home)
  })

  it("auto-registers Claude MCP for first-run users with the default permission guard", async () => {
    const { autoRegisterMcp } = await import("../mcp-installer")
    const settingsPath = path.join(state.home, ".claude.json")

    await autoRegisterMcp(51234, {
      actor: { kind: "system", id: "database" },
      source: "database.mcp.autoRegister",
      permissionGuard: createDefaultPermissionGuard(),
    })

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
      },
    })
  })

  it("auto-registration removes stale static authorization headers from existing MCP config", async () => {
    const { autoRegisterMcp } = await import("../mcp-installer")
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
          headers: {
            Authorization: "Bearer old-token",
          },
        },
        figma: {
          type: "http",
          url: "http://127.0.0.1:3845/mcp",
          headers: {},
        },
      },
    }), "utf8")

    await autoRegisterMcp(51234)

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
        figma: {
          type: "http",
          url: "http://127.0.0.1:3845/mcp",
          headers: {},
        },
      },
    })
  })

  it("migrates legacy stdio registration to token-free HTTP MCP", async () => {
    const { autoRegisterMcp } = await import("../mcp-installer")
    const settingsPath = path.join(state.home, ".cursor", "mcp.json")
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        "synapse-mcp": {
          command: "node",
          args: ["/Applications/Synapse.app/Contents/Resources/database/mcp/index.js"],
          env: { SYNAPSE_TOKEN: "stale-token" },
        },
      },
    }), "utf8")

    await autoRegisterMcp(51234)

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
      },
    })
  })

  it("detects Claude Code registration from ~/.claude.json", async () => {
    mkdirSync(state.home, { recursive: true })
    writeFileSync(path.join(state.home, ".claude.json"), JSON.stringify({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
      },
    }), "utf8")

    const { getMcpServers } = await import("../mcp-installer")

    expect(getMcpServers().find((server) => server.target === "claude")).toMatchObject({
      target: "claude",
      settingsPath: path.join(state.home, ".claude.json"),
      settingsFileExists: true,
      registered: true,
      mode: "http",
      url: "http://127.0.0.1:51234/mcp",
    })
  })

  it("removes legacy Claude MCP entries and allowlist permissions without adding new allowlist entries", async () => {
    const { autoRegisterMcp } = await import("../mcp-installer")
    const settingsPath = path.join(state.home, ".claude.json")
    const localSettingsPath = path.join(state.home, ".claude", "settings.local.json")
    const userSettingsPath = path.join(state.home, ".claude", "settings.json")
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        "synapse-data": { type: "http", url: "http://127.0.0.1:11111/mcp" },
        "synapse-mcp": { type: "http", url: "http://127.0.0.1:51234/mcp" },
      },
    }), "utf8")
    writeFileSync(localSettingsPath, JSON.stringify({
      permissions: {
        allow: [
          "mcp__synapse-data__database_table_list",
          "mcp__synapse-database__database_row_list",
          "mcp__synapse-services__database_log_list",
          "mcp__other-server__tool",
          "Bash(ls:*)",
        ],
      },
    }), "utf8")
    writeFileSync(userSettingsPath, JSON.stringify({
      permissions: {
        allow: [
          "mcp__synapse-data__database_table_create",
        ],
      },
    }), "utf8")

    await autoRegisterMcp(51234)

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mcpServers: {
        "synapse-mcp": {
          type: "http",
          url: "http://127.0.0.1:51234/mcp",
        },
      },
    })
    expect(JSON.parse(readFileSync(localSettingsPath, "utf8")).permissions.allow).toEqual([
      "mcp__other-server__tool",
      "Bash(ls:*)",
    ])
    expect(JSON.parse(readFileSync(userSettingsPath, "utf8")).permissions.allow).toEqual([])
    expect(readFileSync(localSettingsPath, "utf8")).not.toContain("mcp__synapse-mcp__")
  })
})
