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

const MCP_DISCOVERY_CONTROL_TIMEOUT_MS = 5_000
// Concurrent npx startup can outlive the control-RPC budget even with working DNS.
const MCP_DISCOVERY_STARTUP_TIMEOUT_MS = 10_000
const MCP_DISCOVERY_POLL_INTERVAL_MS = 50

interface RoutedQueryInput {
  readonly startupSignal?: AbortSignal
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

class McpStartupCancelledError extends Error {
  constructor() { super("MCP startup cancelled"); this.name = "McpStartupCancelledError" }
}

function assertStartupActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new McpStartupCancelledError()
}

export class SynapseToolRouterQuery implements QueryLike {
  private readonly query: Promise<Query>
  private readonly startupController = new AbortController()
  private queryReady = false
  private failed = false
  private failure: unknown

  constructor(input: RoutedQueryInput) {
    this.query = import("@anthropic-ai/claude-agent-sdk")
      .then((sdk) => createRoutedQuery(sdk, { ...input, startupSignal: this.startupController.signal }))
      .then(query => { this.queryReady = true; return query })
      .catch((error) => {
        this.failed = true
        this.failure = error
        throw error
      })
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    try {
      this.throwIfFailed()
      return (await this.query).next()
    } catch (error) {
      if (error instanceof McpStartupCancelledError) return { done: true, value: undefined }
      throw error
    }
  }

  async interrupt(): Promise<void> {
    if (!this.queryReady) this.startupController.abort()
    try { await (await this.query).interrupt() }
    catch (error) { if (!(error instanceof McpStartupCancelledError)) throw error }
  }

  async close(): Promise<void> {
    if (!this.queryReady) this.startupController.abort()
    try { await (await this.query).close() }
    catch (error) { if (!(error instanceof McpStartupCancelledError)) throw error }
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
  const signal = input.startupSignal
  assertStartupActive(signal)
  const deniedMcpServers = asRecord(input.options.settings)?.deniedMcpServers
  const disabledNames = new Set(Array.isArray(deniedMcpServers)
    ? deniedMcpServers.map(rule => asRecord(rule)?.serverName).filter((name): name is string => typeof name === "string")
    : [])
  const expectedServerNames = [...new Set(
    input.expectedMcpServerNames ?? configuredMcpServerNames(input.options),
  )].filter(name => !disabledNames.has(name))
  input.logger?.info?.("Starting MCP discovery for Synapse tool router.", {
    boundary: "claude-sdk.synapse-tool-router.discovery",
    expectedServerNames,
  })
  try {
    const resolved = await withDiscoveryDeadline(sdk.resolveSettings({
      cwd: input.router.cwd,
      settingSources: [...input.router.settingSources],
    }), MCP_DISCOVERY_CONTROL_TIMEOUT_MS, signal)
    assertStartupActive(signal)
    assertCompatibleSettings(resolved.effective as Record<string, unknown>)
    const discovery = sdk.query({
      prompt: pendingPrompt(),
      options: input.options as Options,
    })
    let statuses: McpServerStatus[]
    try {
      await withDiscoveryDeadline(discovery.initializationResult(), MCP_DISCOVERY_CONTROL_TIMEOUT_MS, signal)
      statuses = await waitForMcpServerStatuses(discovery, signal)
    } finally {
      await withDiscoveryDeadline(Promise.resolve(discovery.close()))
    }
    assertStartupActive(signal)
    if (hasUnavailableExpectedServers(statuses, expectedServerNames)) {
      input.logger?.warn("Optional MCP servers unavailable; retaining the tool router.", {
        boundary: "claude-sdk.synapse-tool-router.discovery",
        reason: "expected-server-unavailable",
        serverStatuses: summarizeMcpServerStatuses(statuses),
      })
    }
    input.logger?.info?.("MCP discovery completed for Synapse tool router.", {
      boundary: "claude-sdk.synapse-tool-router.discovery",
      expectedServerNames,
      serverStatuses: summarizeMcpServerStatuses(statuses),
    })
    const mcpServers = rebuildMcpServers(statuses, (name, reason) => {
      input.logger?.warn("Optional MCP configuration omitted from routed session.", {
        boundary: "claude-sdk.synapse-tool-router.discovery", serverName: name, reason,
      })
    })
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
    // Cancellation must never create a formal query, including the strict fallback.
    // A failed discovery close still propagates so the stop barrier cannot claim success.
    if (signal?.aborted || error instanceof McpStartupCancelledError) throw error
    const reason = fallbackReason(error)
    input.router.onFallback?.(reason)
    input.logger?.warn("Synapse tool router unavailable; using a minimal strict MCP configuration.", {
      boundary: "claude-sdk.synapse-tool-router.fallback",
      reason,
    })
    // Never restore ambient MCPs here: a permission/configuration failure must
    // neither inflate context nor bypass rules referring to the original server.
    return sdk.query({
      prompt: input.prompt,
      options: { ...input.options, strictMcpConfig: true, mcpServers: {} } as Options,
    })
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
  signal?: AbortSignal,
): Promise<McpServerStatus[]> {
  const deadline = Date.now() + MCP_DISCOVERY_STARTUP_TIMEOUT_MS
  let statuses = await withDiscoveryDeadline(query.mcpServerStatus(), MCP_DISCOVERY_CONTROL_TIMEOUT_MS, signal)
  while (statuses.some((status) => status.status === "pending")) {
    assertStartupActive(signal)
    if (Date.now() >= deadline) {
      return statuses
    }
    await new Promise((resolve) => setTimeout(resolve, MCP_DISCOVERY_POLL_INTERVAL_MS))
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return statuses
    assertStartupActive(signal)
    try {
      statuses = await withDiscoveryDeadline(query.mcpServerStatus(), Math.min(MCP_DISCOVERY_CONTROL_TIMEOUT_MS, remainingMs), signal)
    } catch (error) {
      assertStartupActive(signal)
      if (Date.now() >= deadline && error instanceof ToolRouterFallbackError) return statuses
      throw error
    }
  }
  return statuses
}

async function withDiscoveryDeadline<T>(operation: Promise<T>, timeoutMs = MCP_DISCOVERY_CONTROL_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new McpStartupCancelledError())
        if (signal?.aborted) onAbort()
        else signal?.addEventListener("abort", onAbort, { once: true })
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolRouterFallbackError("discovery-failed")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener("abort", onAbort)
  }
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

function summarizeMcpServerStatuses(
  statuses: readonly McpServerStatus[],
): readonly { readonly name: string, readonly status: McpServerStatus["status"] }[] {
  return statuses.map((status) => ({ name: status.name, status: status.status }))
}

export function rebuildMcpServers(
  statuses: readonly McpServerStatus[],
  onUnavailable?: (name: string, reason: SynapseToolRouterFallbackReason) => void,
): Record<string, McpServerConfig> {
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
    if (!status.config) {
      if (!onUnavailable) throw new ToolRouterFallbackError("missing-server-config")
      onUnavailable(status.name, "missing-server-config")
      continue
    }
    if (status.config.type === "claudeai-proxy" || status.config.type === "sdk") {
      if (!onUnavailable) throw new ToolRouterFallbackError("unsupported-server-config")
      onUnavailable(status.name, "unsupported-server-config")
      continue
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
