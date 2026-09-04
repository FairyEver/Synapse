import type {
  McpServerConfig,
  McpServerStatus,
  Options,
  PermissionMode,
  Query,
  RewindFilesResult,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
  SettingSource,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }

import type { StructuredLogger } from "../../runtime/service-registry"
import { createSynapseToolRouterServer, type SynapseToolRouterExecutor } from "./synapse-tool-router"

export type SynapseToolRouterFallbackReason =
  | "discovery-failed"
  | "duplicate-server"
  | "explicit-permission-rule"
  | "expected-server-unavailable"
  | "missing-server-config"
  | "policy-helper"
  | "synapse-server-tool-policy"
  | "unsupported-server-config"

export interface SynapseToolRouterQueryOptions {
  readonly cwd: string
  readonly settingSources: readonly SettingSource[]
  readonly executeTool: SynapseToolRouterExecutor
  readonly onFallback?: (reason: SynapseToolRouterFallbackReason) => void
}

interface QueryLike {
  next(): Promise<IteratorResult<SDKMessage, void>>
  interrupt(): Promise<void>
  close(): void | Promise<void>
  streamInput?(stream: AsyncIterable<SDKUserMessage>): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
  grantAdditionalDirectories?(directories: readonly string[]): Promise<void>
  getContextUsage?(): Promise<SDKControlGetContextUsageResponse>
  rewindFiles?(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>
}

const MCP_DISCOVERY_PENDING_TIMEOUT_MS = 5_000
const MCP_DISCOVERY_POLL_INTERVAL_MS = 50

interface RoutedQueryInput {
  readonly prompt: AsyncIterable<SDKUserMessage>
  readonly options: Record<string, unknown>
  readonly expectedMcpServerNames?: readonly string[]
  readonly router: SynapseToolRouterQueryOptions
  readonly logger?: Pick<StructuredLogger, "warn"> & Partial<Pick<StructuredLogger, "info">>
}

interface DirectQueryInput {
  readonly prompt: AsyncIterable<SDKUserMessage>
  readonly options: Record<string, unknown>
}

type AgentSdkModule = typeof import(
  "@anthropic-ai/claude-agent-sdk",
  { with: { "resolution-mode": "import" } }
)

class ToolRouterFallbackError extends Error {
  constructor(readonly reason: SynapseToolRouterFallbackReason, message: string = reason) {
    super(message)
    this.name = "ToolRouterFallbackError"
  }
}

class ExpectedMcpServerUnavailableError extends ToolRouterFallbackError {
  constructor(
    readonly expectedServerNames: readonly string[],
    readonly serverStatuses: readonly McpServerStatus[],
  ) {
    super("expected-server-unavailable")
    this.name = "ExpectedMcpServerUnavailableError"
  }
}

export class SynapseToolRouterQuery implements QueryLike {
  private readonly query: Promise<Query>
  private failed = false
  private failure: unknown

  constructor(input: RoutedQueryInput) {
    this.query = import("@anthropic-ai/claude-agent-sdk")
      .then((sdk) => createRoutedQuery(sdk, input))
      .catch((error) => {
        this.failed = true
        this.failure = error
        throw error
      })
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    this.throwIfFailed()
    return (await this.query).next()
  }

  async interrupt(): Promise<void> {
    if (this.failed) return
    await (await this.query).interrupt()
  }

  async close(): Promise<void> {
    if (this.failed) return
    await (await this.query).close()
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    this.throwIfFailed()
    await (await this.query).streamInput(stream)
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.throwIfFailed()
    await (await this.query).setPermissionMode(mode)
  }

  async grantAdditionalDirectories(directories: readonly string[]): Promise<void> {
    this.throwIfFailed()
    await (await this.query).applyFlagSettings({
      permissions: { additionalDirectories: [...directories] },
    })
  }

  async getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    this.throwIfFailed()
    return (await this.query).getContextUsage()
  }

  async rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    this.throwIfFailed()
    return (await this.query).rewindFiles(userMessageId, options)
  }

  private throwIfFailed(): void {
    if (this.failed) throw this.failure
  }
}

export async function createRoutedQuery(sdk: AgentSdkModule, input: RoutedQueryInput): Promise<Query> {
  const expectedServerNames = [...new Set(
    input.expectedMcpServerNames ?? configuredMcpServerNames(input.options),
  )]
  input.logger?.info?.("Starting MCP discovery for Synapse tool router.", {
    boundary: "claude-sdk.synapse-tool-router.discovery",
    expectedServerNames,
  })
  try {
    const resolved = await sdk.resolveSettings({
      cwd: input.router.cwd,
      settingSources: [...input.router.settingSources],
    })
    assertCompatibleSettings(resolved.effective as Record<string, unknown>)
    const discovery = sdk.query({
      prompt: pendingPrompt(),
      options: input.options as Options,
    })
    let statuses: McpServerStatus[]
    try {
      await discovery.initializationResult()
      statuses = await waitForMcpServerStatuses(discovery, expectedServerNames)
    } finally {
      await Promise.resolve(discovery.close())
    }
    assertExpectedMcpServersConnected(statuses, expectedServerNames)
    input.logger?.info?.("MCP discovery completed for Synapse tool router.", {
      boundary: "claude-sdk.synapse-tool-router.discovery",
      expectedServerNames,
      serverStatuses: summarizeMcpServerStatuses(statuses),
    })
    const mcpServers = rebuildMcpServers(statuses)
    mcpServers["synapse-tool-router"] = createSynapseToolRouterServer(sdk, input.router.executeTool)
    input.logger?.info?.("Rebuilt MCP configuration for Synapse tool router.", {
      boundary: "claude-sdk.synapse-tool-router.rebuild",
      expectedServerNames,
      finalServerNames: Object.keys(mcpServers),
    })
    return sdk.query({
      prompt: input.prompt,
      options: {
        ...input.options,
        strictMcpConfig: true,
        mcpServers,
      } as Options,
    })
  } catch (error) {
    const reason = fallbackReason(error)
    input.router.onFallback?.(reason)
    input.logger?.warn("Synapse tool router unavailable; using the complete MCP configuration.", {
      boundary: "claude-sdk.synapse-tool-router.fallback",
      reason,
      ...(error instanceof ExpectedMcpServerUnavailableError
        ? { serverStatuses: summarizeMcpServerStatuses(error.serverStatuses) }
        : {}),
    })
    return sdk.query({ prompt: input.prompt, options: input.options as Options })
  }
}

export async function createDirectValidatedQuery(
  sdk: AgentSdkModule,
  input: DirectQueryInput,
): Promise<Query> {
  return sdk.query({ prompt: input.prompt, options: input.options as Options })
}

async function waitForMcpServerStatuses(
  query: Pick<Query, "mcpServerStatus">,
  expectedServerNames: readonly string[],
): Promise<McpServerStatus[]> {
  const deadline = Date.now() + MCP_DISCOVERY_PENDING_TIMEOUT_MS
  let statuses = await query.mcpServerStatus()
  while (statuses.some((status) => status.status === "pending")) {
    if (Date.now() >= deadline) {
      if (hasUnavailableExpectedServers(statuses, expectedServerNames)) {
        throw new ExpectedMcpServerUnavailableError(expectedServerNames, statuses)
      }
      throw new ToolRouterFallbackError("discovery-failed")
    }
    await new Promise((resolve) => setTimeout(resolve, MCP_DISCOVERY_POLL_INTERVAL_MS))
    statuses = await query.mcpServerStatus()
  }
  return statuses
}

function configuredMcpServerNames(options: Record<string, unknown>): readonly string[] {
  const configured = asRecord(options.mcpServers)
  if (!configured) return []
  return Object.keys(configured).filter((name) => name !== "synapse-mcp" && name !== "synapse-tool-router")
}

function hasUnavailableExpectedServers(
  statuses: readonly McpServerStatus[],
  expectedServerNames: readonly string[],
): boolean {
  return expectedServerNames.some((name) => {
    const status = statuses.find((candidate) => candidate.name === name)
    return !status || status.status !== "connected"
  })
}

function assertExpectedMcpServersConnected(
  statuses: readonly McpServerStatus[],
  expectedServerNames: readonly string[],
): void {
  if (hasUnavailableExpectedServers(statuses, expectedServerNames)) {
    throw new ExpectedMcpServerUnavailableError(expectedServerNames, statuses)
  }
}

function summarizeMcpServerStatuses(
  statuses: readonly McpServerStatus[],
): readonly { readonly name: string, readonly status: McpServerStatus["status"] }[] {
  return statuses.map((status) => ({ name: status.name, status: status.status }))
}

export function rebuildMcpServers(statuses: readonly McpServerStatus[]): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {}
  const names = new Set<string>()
  for (const status of statuses) {
    if (names.has(status.name)) throw new ToolRouterFallbackError("duplicate-server")
    names.add(status.name)
    if (status.name === "synapse-tool-router") {
      throw new ToolRouterFallbackError("duplicate-server")
    }
    if (status.name === "synapse-mcp") {
      if (hasToolPolicy(status.config)) {
        throw new ToolRouterFallbackError("synapse-server-tool-policy")
      }
      continue
    }
    if (status.status !== "connected") continue
    if (!status.config) throw new ToolRouterFallbackError("missing-server-config")
    if (status.config.type === "claudeai-proxy" || status.config.type === "sdk") {
      throw new ToolRouterFallbackError("unsupported-server-config")
    }
    servers[status.name] = status.config
  }
  return servers
}

export function assertCompatibleSettings(settings: Record<string, unknown>): void {
  if (settings.policyHelper !== undefined) {
    throw new ToolRouterFallbackError("policy-helper")
  }
  const permissions = asRecord(settings.permissions)
  for (const key of ["allow", "deny", "ask"] as const) {
    const rules = permissions?.[key]
    if (Array.isArray(rules) && rules.some((rule) =>
      typeof rule === "string" && rule.includes("mcp__synapse-mcp__"))) {
      throw new ToolRouterFallbackError("explicit-permission-rule")
    }
  }
}

function hasToolPolicy(config: McpServerStatus["config"]): boolean {
  if (!config || !("tools" in config)) return false
  return Array.isArray(config.tools) && config.tools.length > 0
}

function fallbackReason(error: unknown): SynapseToolRouterFallbackReason {
  return error instanceof ToolRouterFallbackError ? error.reason : "discovery-failed"
}

function pendingPrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<never>(() => undefined),
    }),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
