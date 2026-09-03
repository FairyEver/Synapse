import { describe, expect, it, vi } from "vitest"
import type { McpServerStatus, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"

import {
  assertCompatibleSettings,
  createDirectValidatedQuery,
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

  it("waits for pending MCP servers before rebuilding the strict configuration", async () => {
    const discovery = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn()
        .mockResolvedValueOnce([
          statusWithState("figma", "pending", { type: "http", url: "http://127.0.0.1:3845/mcp" }),
        ])
        .mockResolvedValueOnce([
          status("figma", { type: "http", url: "http://127.0.0.1:3845/mcp" }),
        ]),
      close: vi.fn(),
    }
    const final = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [
        status("figma", { type: "http", url: "http://127.0.0.1:3845/mcp" }),
        status("synapse-tool-router", { command: "in-process" }),
      ]),
      close: vi.fn(),
    }
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

    await createRoutedQuery(sdk as never, {
      prompt: promptThatMustNotBeRead(),
      expectedMcpServerNames: ["figma"],
      options: {
        settingSources: ["user", "project", "local"],
        mcpServers: { figma: { type: "http", url: "http://127.0.0.1:3845/mcp" } },
      },
      router: {
        cwd: "/tmp/project",
        settingSources: ["user", "project", "local"],
        executeTool: vi.fn(),
      },
    })

    expect(discovery.mcpServerStatus).toHaveBeenCalledTimes(2)
    expect(final.initializationResult).toHaveBeenCalledOnce()
    expect(final.mcpServerStatus).toHaveBeenCalledOnce()
    expect(query.mock.calls[1]?.[0]).toMatchObject({
      options: {
        mcpServers: {
          figma: { type: "http", url: "http://127.0.0.1:3845/mcp" },
        },
      },
    })
  })

  it.each(["failed", "needs-auth"] as const)(
    "falls back to the complete MCP config when an expected server is %s during discovery",
    async (unavailableStatus) => {
      const discovery = {
        initializationResult: vi.fn(async () => ({})),
        mcpServerStatus: vi.fn(async () => [
          statusWithState("figma", unavailableStatus, { type: "http", url: "http://127.0.0.1:3845/mcp" }),
        ]),
        close: vi.fn(),
      }
      const fallback = {
        initializationResult: vi.fn(async () => ({})),
        mcpServerStatus: vi.fn(async () => [
          status("figma", { type: "http", url: "http://127.0.0.1:3845/mcp" }),
        ]),
        close: vi.fn(),
      }
      const query = vi.fn()
        .mockReturnValueOnce(discovery)
        .mockReturnValueOnce(fallback)
      const onFallback = vi.fn()
      const logger = { info: vi.fn(), warn: vi.fn() }
      const sdk = {
        resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })),
        query,
      }
      const options = {
        settingSources: ["user", "project", "local"],
        mcpServers: {
          figma: {
            type: "http",
            url: "http://127.0.0.1:3845/mcp",
            headers: { Authorization: "Bearer secret-discovery-canary" },
          },
        },
      }

      const result = await createRoutedQuery(sdk as never, {
        prompt: promptThatMustNotBeRead(),
        options,
        router: {
          cwd: "/tmp/project",
          settingSources: ["user", "project", "local"],
          executeTool: vi.fn(),
          onFallback,
        },
        logger,
      })

      expect(result).toBe(fallback)
      expect(onFallback).toHaveBeenCalledWith("expected-server-unavailable")
      expect(query).toHaveBeenLastCalledWith({ prompt: expect.anything(), options })
      expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain("secret-discovery-canary")
    },
  )

  it.each([
    ["missing", []],
    ["pending", [statusWithState(
      "figma",
      "pending",
      { type: "http", url: "http://127.0.0.1:3845/mcp" },
    )]],
  ] as const)("falls back when an expected server remains %s until discovery times out", async (_state, statuses) => {
    vi.useFakeTimers()
    try {
      const discovery = {
        initializationResult: vi.fn(async () => ({})),
        mcpServerStatus: vi.fn(async () => [...statuses]),
        close: vi.fn(),
      }
      const fallback = {
        initializationResult: vi.fn(async () => ({})),
        mcpServerStatus: vi.fn(async () => [
          status("figma", { type: "http", url: "http://127.0.0.1:3845/mcp" }),
        ]),
        close: vi.fn(),
      }
      const query = vi.fn()
        .mockReturnValueOnce(discovery)
        .mockReturnValueOnce(fallback)
      const onFallback = vi.fn()
      const sdk = {
        resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })),
        query,
      }
      const resultPromise = createRoutedQuery(sdk as never, {
        prompt: promptThatMustNotBeRead(),
        options: {
          mcpServers: { figma: { type: "http", url: "http://127.0.0.1:3845/mcp" } },
        },
        router: {
          cwd: "/tmp/project",
          settingSources: ["user", "project", "local"],
          executeTool: vi.fn(),
          onFallback,
        },
      })

      await vi.advanceTimersByTimeAsync(5_100)

      await expect(resultPromise).resolves.toBe(fallback)
      expect(onFallback).toHaveBeenCalledWith("expected-server-unavailable")
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not consume the user prompt before the final MCP set passes readiness validation", async () => {
    const figmaConfig = { type: "http" as const, url: "http://127.0.0.1:3845/mcp" }
    const discovery = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [status("figma", figmaConfig)]),
      close: vi.fn(),
    }
    const unavailableFinal = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [statusWithState("figma", "failed", figmaConfig)]),
      close: vi.fn(),
    }
    const fallback = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [status("figma", figmaConfig)]),
      close: vi.fn(),
    }
    const promptValue = { type: "user", message: { role: "user", content: "run" } } as unknown as SDKUserMessage
    const sourceRead = vi.fn(async () => ({ done: false as const, value: promptValue }))
    const prompt: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({ next: sourceRead }),
    }
    const gatedReads: Array<Promise<IteratorResult<SDKUserMessage>>> = []
    const query = vi.fn()
      .mockReturnValueOnce(discovery)
      .mockImplementationOnce(({ prompt: gatedPrompt }) => {
        gatedReads.push(gatedPrompt[Symbol.asyncIterator]().next())
        return unavailableFinal
      })
      .mockImplementationOnce(({ prompt: gatedPrompt }) => {
        gatedReads.push(gatedPrompt[Symbol.asyncIterator]().next())
        return fallback
      })
    const sdk = {
      resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })),
      query,
      tool: vi.fn((name, description, inputSchema, handler, extras) => ({
        name, description, inputSchema, handler, ...extras,
      })),
      createSdkMcpServer: vi.fn((options) => ({ type: "sdk", name: options.name, instance: {} })),
    }

    const result = await createRoutedQuery(sdk as never, {
      prompt,
      options: { mcpServers: { figma: figmaConfig } },
      router: {
        cwd: "/tmp/project",
        settingSources: ["user", "project", "local"],
        executeTool: vi.fn(),
      },
    })

    expect(result).toBe(fallback)
    await expect(gatedReads[0]).resolves.toEqual({ done: true, value: undefined })
    await expect(gatedReads[1]).resolves.toEqual({ done: false, value: promptValue })
    expect(sourceRead).toHaveBeenCalledOnce()
  })

  it("rejects the session when an expected MCP server is still unavailable after fallback", async () => {
    const failedStatus = statusWithState(
      "figma",
      "failed",
      { type: "http", url: "http://127.0.0.1:3845/mcp" },
    )
    const discovery = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [failedStatus]),
      close: vi.fn(),
    }
    const fallback = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [failedStatus]),
      close: vi.fn(),
    }
    const query = vi.fn()
      .mockReturnValueOnce(discovery)
      .mockReturnValueOnce(fallback)
    const sdk = {
      resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })),
      query,
    }

    await expect(createRoutedQuery(sdk as never, {
      prompt: promptThatMustNotBeRead(),
      options: {
        mcpServers: { figma: { type: "http", url: "http://127.0.0.1:3845/mcp" } },
      },
      router: {
        cwd: "/tmp/project",
        settingSources: ["user", "project", "local"],
        executeTool: vi.fn(),
      },
    })).rejects.toThrow("Figma MCP 未进入本次会话")
    expect(fallback.close).toHaveBeenCalledOnce()
  })

  it("retries a direct full-config query before exposing the user prompt", async () => {
    const figmaConfig = { type: "http" as const, url: "http://127.0.0.1:3845/mcp" }
    const unavailable = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [statusWithState("figma", "failed", figmaConfig)]),
      close: vi.fn(),
    }
    const connected = {
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [status("figma", figmaConfig)]),
      close: vi.fn(),
    }
    const promptValue = { type: "user", message: { role: "user", content: "run" } } as unknown as SDKUserMessage
    const sourceRead = vi.fn(async () => ({ done: false as const, value: promptValue }))
    const prompt: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({ next: sourceRead }),
    }
    const gatedReads: Array<Promise<IteratorResult<SDKUserMessage>>> = []
    const query = vi.fn()
      .mockImplementationOnce(({ prompt: gatedPrompt }) => {
        gatedReads.push(gatedPrompt[Symbol.asyncIterator]().next())
        return unavailable
      })
      .mockImplementationOnce(({ prompt: gatedPrompt }) => {
        gatedReads.push(gatedPrompt[Symbol.asyncIterator]().next())
        return connected
      })

    const result = await createDirectValidatedQuery({ query } as never, {
      prompt,
      options: { mcpServers: { figma: figmaConfig } },
      expectedMcpServerNames: ["figma"],
    })

    expect(result).toBe(connected)
    await expect(gatedReads[0]).resolves.toEqual({ done: true, value: undefined })
    await expect(gatedReads[1]).resolves.toEqual({ done: false, value: promptValue })
    expect(sourceRead).toHaveBeenCalledOnce()
    expect(unavailable.close).toHaveBeenCalledOnce()
  })

  it("rejects a direct query when the expected MCP set is still unavailable after retry", async () => {
    const figmaConfig = { type: "http" as const, url: "http://127.0.0.1:3845/mcp" }
    const failedQuery = () => ({
      initializationResult: vi.fn(async () => ({})),
      mcpServerStatus: vi.fn(async () => [statusWithState("figma", "needs-auth", figmaConfig)]),
      close: vi.fn(),
    })
    const first = failedQuery()
    const second = failedQuery()
    const query = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)

    await expect(createDirectValidatedQuery({ query } as never, {
      prompt: promptThatMustNotBeRead(),
      options: { mcpServers: { figma: figmaConfig } },
      expectedMcpServerNames: ["figma"],
    })).rejects.toThrow("Figma MCP 未进入本次会话")
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
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
