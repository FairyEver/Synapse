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
  // Storage-policy failure must never enter the MCP fallback, which also starts a query.
  await assertPrivateStorageSettings(sdk, input)
  const expectedServerNames = [...new Set(
    input.expectedMcpServerNames ?? configuredMcpServerNames(input.options),
  )]
  input.logger?.info?.("Starting MCP discovery for Synapse tool router.", {
    boundary: "claude-sdk.synapse-tool-router.discovery",
    expectedServerNames,
  })
  try {
    const resolved = await withDiscoveryDeadline(sdk.resolveSettings({
      cwd: input.router.cwd,
      settingSources: [...input.router.settingSources],
    }))
    assertCompatibleSettings(resolved.effective as Record<string, unknown>)
    const discovery = sdk.query({
      prompt: pendingPrompt(),
      options: input.options as Options,
    })
    let statuses: McpServerStatus[]
    try {
      await withDiscoveryDeadline(discovery.initializationResult())
      statuses = await waitForMcpServerStatuses(discovery)
    } finally {
      await withDiscoveryDeadline(Promise.resolve(discovery.close()))
    }
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
  await assertPrivateStorageSettings(sdk, input)
  return sdk.query({ prompt: input.prompt, options: input.options as Options })
}

async function assertPrivateStorageSettings(sdk: AgentSdkModule, input: DirectQueryInput): Promise<void> {
  const managed = asRecord(input.options.managedSettings)
  const expectedSandbox = asRecord(managed?.sandbox)
  const expectedFs = asRecord(expectedSandbox?.filesystem)
  const roots = expectedFs?.denyRead
  if (!Array.isArray(roots) || roots.length === 0) return
  const failure = "无法确认 Agent 私有存储保护，请检查 SDK 沙箱与受管设置；本轮已停止，不能无保护继续。"
  try {
    const resolved = await withDiscoveryDeadline(sdk.resolveSettings({
      cwd: typeof input.options.cwd === "string" ? input.options.cwd : undefined,
      settingSources: input.options.settingSources as Options["settingSources"],
      managedSettings: managed as Options["managedSettings"],
    }))
    const effective = resolved.effective as Record<string, unknown>
    const sandbox = asRecord(effective.sandbox), filesystem = asRecord(sandbox?.filesystem)
    const permissions = asRecord(effective.permissions)
    const expectedDenies = asRecord(managed?.permissions)?.deny
    const containsAll = (actual: unknown, expected: unknown): boolean =>
      Array.isArray(actual) && Array.isArray(expected) && expected.every(item => actual.includes(item))
    const hasEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0
    if (sandbox?.enabled !== true || sandbox.failIfUnavailable !== true || sandbox.allowUnsandboxedCommands !== false
      || hasEntries(sandbox.excludedCommands) || filesystem?.disabled !== false || filesystem.allowManagedReadPathsOnly !== true
      || hasEntries(filesystem.allowRead) || !containsAll(filesystem.denyRead, roots)
      || !containsAll(filesystem.denyWrite, expectedFs?.denyWrite) || !containsAll(permissions?.deny, expectedDenies)) {
      throw new Error(failure)
    }
  } catch {
    // resolveSettings can drop parent policy under an IT-controlled managed tier. Fail closed.
    throw new Error(failure)
  }
}

async function waitForMcpServerStatuses(
  query: Pick<Query, "mcpServerStatus">,
): Promise<McpServerStatus[]> {
  const deadline = Date.now() + MCP_DISCOVERY_PENDING_TIMEOUT_MS
  let statuses = await withDiscoveryDeadline(query.mcpServerStatus())
  while (statuses.some((status) => status.status === "pending")) {
    if (Date.now() >= deadline) {
      return statuses
    }
    await new Promise((resolve) => setTimeout(resolve, MCP_DISCOVERY_POLL_INTERVAL_MS))
    statuses = await withDiscoveryDeadline(query.mcpServerStatus(), Math.max(1, deadline - Date.now()))
  }
  return statuses
}

async function withDiscoveryDeadline<T>(operation: Promise<T>, timeoutMs = MCP_DISCOVERY_PENDING_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolRouterFallbackError("discovery-failed")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
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
