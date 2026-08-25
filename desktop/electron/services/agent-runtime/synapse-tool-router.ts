import { z } from "zod"

import { executeMcpToolCall, type McpToolCallResult } from "../../../database/shared/mcp-rpc"
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getMcpToolCapability,
  getMcpToolDomainId,
} from "../../../synapse-capabilities/shared/registry"
import type { McpToolDefinition } from "../../../synapse-capabilities/shared/types"

export const SYNAPSE_TOOL_ROUTER_SERVER_NAME = "synapse-tool-router"
export const SYNAPSE_TOOL_ROUTER_SEARCH_TOOL = `mcp__${SYNAPSE_TOOL_ROUTER_SERVER_NAME}__search`
export const SYNAPSE_TOOL_ROUTER_INVOKE_TOOL = `mcp__${SYNAPSE_TOOL_ROUTER_SERVER_NAME}__invoke`
export const SYNAPSE_MCP_TOOL_PREFIX = "mcp__synapse-mcp__"

const DOMAIN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  app: ["应用", "终端", "通知", "模板", "文件", "密钥", "app", "terminal", "notification", "secret"],
  automation: ["自动化", "定时任务", "调度", "cron", "automation", "schedule"],
  content: ["资源", "规则", "技能", "提示词", "content", "rule", "skill", "prompt"],
  database: ["数据库", "表", "字段", "记录", "SQL", "database", "table", "field", "row"],
  drive: ["云盘", "文件", "分享", "站点", "评论", "同步", "drive", "share", "site", "comment", "sync"],
  model_price: ["模型价格", "费用", "价格", "model price", "pricing", "cost"],
  repository: ["仓库", "repository", "repo"],
  skill_repository: ["技能仓库", "skill repository", "skill repo"],
  workflow: ["工作流", "节点", "workflow", "node"],
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "for",
  "in",
  "me",
  "my",
  "of",
  "on",
  "please",
  "the",
  "to",
])

const SEARCH_QUERY_ALIASES: readonly (readonly [term: string, token: string])[] = [
  ["云盘", "drive"],
  ["文件夹", "item"],
  ["文件", "item"],
  ["条目", "item"],
  ["列表", "list"],
  ["列出", "list"],
  ["清单", "list"],
]

export type SynapseToolRouterExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  abortSignal?: AbortSignal,
) => unknown | Promise<unknown>

export type SynapseToolCatalogEntry = {
  readonly name: string
  readonly actionId: string
  readonly domain: string
  readonly title: string
  readonly description: string
  readonly inputSchema: McpToolDefinition["inputSchema"]
  readonly searchableSchema: string
  readonly aliases: string
}

type SynapseToolSearchInput = {
  readonly query: string
  readonly domain?: string
  readonly limit?: number
}

type SynapseToolInvokeInput = {
  readonly toolName: string
  readonly arguments?: Record<string, unknown>
}

const catalog = buildSynapseToolCatalog()
const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]))
const availableDomains = [...new Set(catalog.map((entry) => entry.domain))].sort()
let fusePromise: Promise<{
  search(query: string): Array<{ item: SynapseToolCatalogEntry; score?: number }>
}> | undefined

export function buildSynapseToolCatalog(): readonly SynapseToolCatalogEntry[] {
  return buildAllMcpTools()
    .map((tool) => {
      const actionId = MCP_TOOL_ACTIONS[tool.name]
      const domain = getMcpToolDomainId(tool.name)
      const capability = getMcpToolCapability(tool.name)
      if (!actionId || !domain || !capability) {
        throw new Error(`Synapse MCP tool registry is incomplete for ${tool.name}`)
      }
      return {
        name: tool.name,
        actionId,
        domain,
        title: capability.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        searchableSchema: schemaSearchText(tool.inputSchema),
        aliases: (DOMAIN_ALIASES[domain] ?? []).join(" "),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function searchSynapseTools(input: SynapseToolSearchInput) {
  const query = input.query.trim()
  if (!query) throw new Error("query must not be empty")
  const limit = normalizeLimit(input.limit)
  const domain = input.domain?.trim()
  if (domain && !availableDomains.includes(domain)) {
    return { tools: [], domains: availableDomains }
  }

  const exact = catalogByName.get(query)
  const aliasTokens = queryAliasTokens(query)
  const queryTokens = [
    ...tokenizeSearchText(query).filter((token) => (
      !SEARCH_STOP_WORDS.has(token)
      && (aliasTokens.length === 0 || !containsHan(token))
    )),
    ...aliasTokens,
  ]
  const index = await fuseIndex()
  const ranked = mergeFuseResults([
    index.search(query),
    ...aliasTokens.map((token) => index.search(token)),
  ])
    .filter((result) => !domain || result.item.domain === domain)
    .map((result) => ({
      ...result,
      lexical: lexicalRelevance(result.item, queryTokens),
    }))
    .sort((left, right) => {
      const lexical = right.lexical.score - left.lexical.score
      if (lexical !== 0) return lexical
      const specificity = right.lexical.specificity - left.lexical.specificity
      if (specificity !== 0) return specificity
      const proximity = right.lexical.proximity - left.lexical.proximity
      if (proximity !== 0) return proximity
      const score = (left.score ?? 1) - (right.score ?? 1)
      return score === 0 ? left.item.name.localeCompare(right.item.name) : score
    })
    .map((result) => result.item)

  const entries = dedupeTools([
    ...(exact && (!domain || exact.domain === domain) ? [exact] : []),
    ...ranked,
  ]).slice(0, limit)

  return {
    tools: entries.map(({ name, domain: entryDomain, description, inputSchema }) => ({
      name,
      domain: entryDomain,
      description,
      inputSchema,
    })),
    domains: availableDomains,
  }
}

function queryAliasTokens(query: string): string[] {
  const normalized = query.toLowerCase()
  return [...new Set(SEARCH_QUERY_ALIASES
    .filter(([term]) => normalized.includes(term))
    .map(([, token]) => token))]
}

function mergeFuseResults(
  groups: readonly (readonly { item: SynapseToolCatalogEntry; score?: number }[])[],
): Array<{ item: SynapseToolCatalogEntry; score?: number }> {
  const bestByName = new Map<string, { item: SynapseToolCatalogEntry; score?: number }>()
  for (const group of groups) {
    for (const result of group) {
      const existing = bestByName.get(result.item.name)
      if (!existing || (result.score ?? 1) < (existing.score ?? 1)) {
        bestByName.set(result.item.name, result)
      }
    }
  }
  return [...bestByName.values()]
}

export async function invokeSynapseTool(
  input: SynapseToolInvokeInput,
  executeTool: SynapseToolRouterExecutor,
  abortSignal?: AbortSignal,
): Promise<McpToolCallResult> {
  const toolName = input.toolName.trim()
  if (!catalogByName.has(toolName)) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    }
  }
  return executeMcpToolCall(
    toolName,
    input.arguments ?? {},
    (name, args) => executeTool(name, args, abortSignal),
  )
}

export function isSynapseToolReadOnly(toolName: string): boolean {
  return getMcpToolCapability(toolName)?.mutates === false
}

export function originalSynapseSdkToolName(toolName: string): string {
  return `${SYNAPSE_MCP_TOOL_PREFIX}${toolName}`
}

export function parseSynapseToolRouterInvoke(
  input: unknown,
): { readonly toolName: string; readonly arguments: Record<string, unknown> } | null {
  if (!isRecord(input) || typeof input.toolName !== "string") return null
  const toolName = input.toolName.trim()
  if (!catalogByName.has(toolName)) return null
  if (input.arguments !== undefined && !isRecord(input.arguments)) return null
  return { toolName, arguments: input.arguments ?? {} }
}

export function createSynapseToolRouterServer(
  sdk: Pick<
    typeof import("@anthropic-ai/claude-agent-sdk", { with: { "resolution-mode": "import" } }),
    "createSdkMcpServer" | "tool"
  >,
  executeTool: SynapseToolRouterExecutor,
) {
  return sdk.createSdkMcpServer({
    name: SYNAPSE_TOOL_ROUTER_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      sdk.tool(
        "search",
        "Search the available Synapse MCP tools. Returns original tool names and complete input schemas.",
        {
          query: z.string().trim().min(1),
          domain: z.string().trim().min(1).optional(),
          limit: z.number().int().min(1).max(5).default(5),
        },
        async (args) => textResult(await searchSynapseTools(args)),
        {
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          alwaysLoad: true,
        },
      ),
      sdk.tool(
        "invoke",
        "Invoke one Synapse MCP tool by the exact original name returned by search.",
        {
          toolName: z.string().trim().min(1),
          arguments: z.record(z.string(), z.unknown()).optional(),
        },
        async (args, extra) => invokeSynapseTool(args, executeTool, abortSignalFromExtra(extra)),
        {
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
          alwaysLoad: true,
        },
      ),
    ],
  })
}

function schemaSearchText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(schemaSearchText).join(" ")
  if (!isRecord(value)) return ""
  return Object.entries(value)
    .flatMap(([key, item]) => [key, schemaSearchText(item)])
    .join(" ")
}

async function fuseIndex() {
  fusePromise ??= import("fuse.js").then(({ default: Fuse }) => new Fuse(catalog, {
    includeScore: true,
    shouldSort: true,
    threshold: 0.42,
    ignoreLocation: true,
    keys: [
      { name: "name", weight: 0.4 },
      { name: "actionId", weight: 0.2 },
      { name: "domain", weight: 0.1 },
      { name: "title", weight: 0.15 },
      { name: "description", weight: 0.15 },
      { name: "searchableSchema", weight: 0.1 },
      { name: "aliases", weight: 0.05 },
    ],
  }))
  return fusePromise
}

function lexicalRelevance(
  entry: SynapseToolCatalogEntry,
  queryTokens: readonly string[],
): { readonly score: number; readonly specificity: number; readonly proximity: number } {
  if (queryTokens.length === 0) return { score: 0, specificity: 0, proximity: 0 }
  const uniqueQueryTokens = [...new Set(queryTokens)]
  const score = (
    tokenCoverage(entry.name, uniqueQueryTokens) * 4
    + tokenCoverage(entry.actionId, uniqueQueryTokens) * 3
    + tokenCoverage(entry.title, uniqueQueryTokens) * 3
    + tokenCoverage(entry.description, uniqueQueryTokens) * 2
    + tokenCoverage(`${entry.domain} ${entry.aliases}`, uniqueQueryTokens)
    + tokenCoverage(entry.searchableSchema, uniqueQueryTokens) * 0.5
  )
  const semanticTokens = tokenizeSearchText(`${entry.title} ${entry.description}`)
  const windowSize = minimumCoveringWindow(semanticTokens, uniqueQueryTokens)

  return {
    score,
    specificity: tokenPrecision(entry.actionId, uniqueQueryTokens),
    proximity: windowSize === null ? 0 : 1 / windowSize,
  }
}

function tokenCoverage(value: string, queryTokens: readonly string[]): number {
  const tokens = new Set(tokenizeSearchText(value))
  const matches = queryTokens.filter((token) => tokens.has(token)).length
  return matches / queryTokens.length
}

function tokenPrecision(value: string, queryTokens: readonly string[]): number {
  const tokens = new Set(tokenizeSearchText(value))
  const matches = queryTokens.filter((token) => tokens.has(token)).length
  return matches / tokens.size
}

function tokenizeSearchText(value: string): string[] {
  return value
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []
}

function containsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value)
}

function minimumCoveringWindow(tokens: readonly string[], queryTokens: readonly string[]): number | null {
  const required = new Set(queryTokens)
  const counts = new Map<string, number>()
  let matched = 0
  let left = 0
  let minimum = Number.POSITIVE_INFINITY

  for (let right = 0; right < tokens.length; right += 1) {
    const token = tokens[right]
    if (required.has(token)) {
      const count = (counts.get(token) ?? 0) + 1
      counts.set(token, count)
      if (count === 1) matched += 1
    }
    while (matched === required.size && left <= right) {
      minimum = Math.min(minimum, right - left + 1)
      const leftToken = tokens[left]
      if (required.has(leftToken)) {
        const count = (counts.get(leftToken) ?? 0) - 1
        counts.set(leftToken, count)
        if (count === 0) matched -= 1
      }
      left += 1
    }
  }

  return Number.isFinite(minimum) ? minimum : null
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 5
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("limit must be an integer from 1 to 5")
  }
  return value
}

function dedupeTools(entries: readonly SynapseToolCatalogEntry[]): SynapseToolCatalogEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.name)) return false
    seen.add(entry.name)
    return true
  })
}

function textResult(value: unknown): McpToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }
}

function abortSignalFromExtra(extra: unknown): AbortSignal | undefined {
  if (!isRecord(extra)) return undefined
  return extra.signal instanceof AbortSignal ? extra.signal : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
