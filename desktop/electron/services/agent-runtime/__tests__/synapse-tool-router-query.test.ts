import { describe, expect, it, vi } from "vitest"
import type { McpServerStatus, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"

import {
  assertCompatibleSettings,
  createRoutedQuery,
  rebuildMcpServers,
} from "../synapse-tool-router-query"

describe("Synapse tool router strict MCP reconstruction", () => {
  it("removes Synapse MCP and preserves serializable non-Synapse servers", () => {
    const servers = rebuildMcpServers([
      status("synapse-mcp", { type: "http", url: "http://127.0.0.1/mcp" }),
      status("github", {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer secret" },
      }),
      status("local", { command: "node", args: ["server.js"], env: { TOKEN: "secret" } }),
      statusWithState("pending", "pending", { type: "http", url: "https://example.com/pending" }),
      { name: "disabled", status: "disabled" },
    ])

    expect(servers).toEqual({
      github: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer secret" },
      },
      local: { command: "node", args: ["server.js"], env: { TOKEN: "secret" } },
    })
  })

  it("falls back for conflicts, unsupported configs, and Synapse server tool policies", () => {
    expect(() => rebuildMcpServers([
      status("duplicate", { command: "one" }),
      status("duplicate", { command: "two" }),
    ])).toThrow("duplicate-server")
    expect(() => rebuildMcpServers([
      status("proxy", { type: "claudeai-proxy", url: "https://example.com", id: "x" }),
    ])).toThrow("unsupported-server-config")
    expect(() => rebuildMcpServers([
      status("synapse-mcp", {
        type: "http",
        url: "http://127.0.0.1/mcp",
        tools: [{ name: "app_database_table_list", permission_policy: "always_deny" }],
      }),
    ])).toThrow("synapse-server-tool-policy")
  })

  it("falls back when effective Claude permissions explicitly reference Synapse MCP", () => {
    expect(() => assertCompatibleSettings({
      permissions: { deny: ["mcp__synapse-mcp__*"] },
    })).toThrow("explicit-permission-rule")
    expect(() => assertCompatibleSettings({
      policyHelper: { path: "/managed/helper" },
    })).toThrow("policy-helper")
    expect(() => assertCompatibleSettings({ permissions: { deny: ["Bash"] } })).not.toThrow()
  })

  it("discovers without consuming prompt input and starts the final query with strict rebuilt MCP", async () => {
    const discovery = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [
        status("synapse-mcp", { type: "http", url: "http://127.0.0.1/mcp" }),
        status("github", { type: "http", url: "https://example.com/mcp" }),
      ]),
      close: vi.fn(),
    }
    const final = { close: vi.fn() }
    const query = vi.fn()
      .mockReturnValueOnce(discovery)
      .mockReturnValueOnce(final)
    const sdk = {
      resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })),
      query,
      tool: vi.fn((name, description, inputSchema, handler, extras) => ({
        name, description, inputSchema, handler, ...extras,
      })),
      createSdkMcpServer: vi.fn((options) => ({ type: "sdk", name: options.name, instance: {} })),
    }
    const prompt = promptThatMustNotBeRead()

    const result = await createRoutedQuery(sdk as never, {
      prompt,
      options: { settingSources: ["user", "project", "local"] },
      router: {
        cwd: "/tmp/project",
        settingSources: ["user", "project", "local"],
        executeTool: vi.fn(),
      },
    })

    expect(result).toBe(final)
    expect(discovery.initializationResult).toHaveBeenCalledOnce()
    expect(discovery.mcpServerStatus).toHaveBeenCalledOnce()
    expect(discovery.close).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1]?.[0]).toMatchObject({
      prompt,
      options: {
        strictMcpConfig: true,
        mcpServers: {
          github: { type: "http", url: "https://example.com/mcp" },
          "synapse-tool-router": { type: "sdk", name: "synapse-tool-router" },
        },
      },
    })
  })

  it("starts the unmodified final query when discovery cannot preserve permissions", async () => {
    const query = vi.fn(() => ({ close: vi.fn() }))
    const onFallback = vi.fn()
    const logger = { warn: vi.fn() }
    const sdk = {
      resolveSettings: vi.fn(async () => ({
        effective: {
          permissions: { deny: ["mcp__synapse-mcp__*"] },
          env: { PRIVATE_TOKEN: "secret-discovery-canary" },
        },
        provenance: {},
        sources: [],
      })),
      query,
    }
    const prompt = promptThatMustNotBeRead()

    await createRoutedQuery(sdk as never, {
      prompt,
      options: { settingSources: ["user", "project", "local"] },
      router: {
        cwd: "/tmp/project",
        settingSources: ["user", "project", "local"],
        executeTool: vi.fn(),
        onFallback,
      },
      logger,
    })

    expect(onFallback).toHaveBeenCalledWith("explicit-permission-rule")
    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith({
      prompt,
      options: { settingSources: ["user", "project", "local"] },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      { boundary: "claude-sdk.synapse-tool-router.fallback", reason: "explicit-permission-rule" },
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-discovery-canary")
  })
})

function status(
  name: string,
  config: NonNullable<McpServerStatus["config"]>,
): McpServerStatus {
  return { name, status: "connected", config }
}

function statusWithState(
  name: string,
  state: McpServerStatus["status"],
  config: NonNullable<McpServerStatus["config"]>,
): McpServerStatus {
  return { name, status: state, config }
}

function promptThatMustNotBeRead(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]() {
      throw new Error("discovery consumed the model prompt")
    },
  }
}
