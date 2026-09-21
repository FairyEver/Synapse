import { z } from "zod"

import {
  executeMcpToolCall,
  unknownToolResult,
  type McpToolCallResult,
  type McpToolSurface,
} from "../../../database/shared/mcp-rpc"
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getMcpToolCapability,
  getMcpToolDomainId,
} from "../../../synapse-capabilities/shared/registry"
import type { McpToolDefinition } from "../../../synapse-capabilities/shared/types"
import { lexiconTokens } from "./synapse-tool-router-lexicon"

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
  readonly query?: string
  readonly domain?: string
  readonly limit?: number
}

type SynapseToolInvokeInput = {
  readonly toolName: string
  readonly arguments?: Record<string, unknown>
}

/**
 * 两种模式返回两种形状，用 `mode` 区分：搜索给完整 schema，索引给一行一条。
 * 判别字段让调用方（和测试）能窄化，而不是对着联合类型猜。
 */
export type SynapseToolSearchMatchResult = {
  readonly mode: "search"
  readonly tools: ReadonlyArray<{
    readonly name: string
    readonly domain: string
    readonly description: string
    readonly inputSchema: McpToolDefinition["inputSchema"]
  }>
  readonly domains: readonly string[]
  readonly guidance?: string
}

export type SynapseToolSearchIndexResult = {
  readonly mode: "index"
  readonly tools: ReadonlyArray<{
    readonly name: string
    readonly domain: string
    readonly summary: string
  }>
  readonly total: number
  readonly domains: readonly string[]
  readonly guidance: string
}

export type SynapseToolSearchResult = SynapseToolSearchMatchResult | SynapseToolSearchIndexResult

const SEARCH_TOOL_DESCRIPTION =
  "Look up the available Synapse MCP tools. With `query`: matching tools and their complete input schemas, at most 5 per call. "
  + "Without `query`: a compact index of a `domain` (or of every domain), one line per tool and no schemas, up to `limit` entries plus `total` — "
  + "read this before searching word by word, and narrow by `domain` or raise `limit` to see more."

// Full schemas are large, so the searched mode stays capped at a handful; the index
// is one line per tool, which is what makes a broad read affordable.
const SEARCH_MODE_LIMIT_MAX = 5
const INDEX_MODE_LIMIT_DEFAULT = 100
const INDEX_MODE_LIMIT_MAX = 200
// Long enough for the first sentence of most descriptions, short enough that a
// whole domain still fits in one response.
const INDEX_SUMMARY_MAX = 150

const INVOKE_TOOL_DESCRIPTION =
  "Invoke one Synapse MCP tool by the exact original name returned by search."

// Returned alongside matches that take a `limit`, because models otherwise ask
// for 100-500 items at once and pay for it in result size and round trips.
const PAGE_SIZE_GUIDANCE =
  "One or more matches accept a `limit`. Request a small page (for example limit 20) and continue with the returned nextOffset or nextCursor instead of fetching everything at once."

// Single source of truth for the router's two tools. The SDK path consumes these
// zod shapes directly; the HTTP path derives its JSON Schema from the same shapes,
// so the two surfaces cannot drift apart.
const SEARCH_TOOL_INPUT_SHAPE = {
  query: z.string().trim().min(1).optional(),
  domain: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(INDEX_MODE_LIMIT_MAX).optional(),
}

const INVOKE_TOOL_INPUT_SHAPE = {
  toolName: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
}

type SynapseToolRouterInputShape = NonNullable<Parameters<typeof z.object>[0]>

type SynapseToolRouterToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputShape: SynapseToolRouterInputShape
  readonly annotations: {
    readonly readOnlyHint: boolean
    readonly destructiveHint: boolean
    readonly openWorldHint: boolean
  }
}

export const SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS: readonly SynapseToolRouterToolDefinition[] = [
  {
    name: "search",
    description: SEARCH_TOOL_DESCRIPTION,
    inputShape: SEARCH_TOOL_INPUT_SHAPE,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "invoke",
    description: INVOKE_TOOL_DESCRIPTION,
    inputShape: INVOKE_TOOL_INPUT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
]

// Shipped from `initialize` on both surfaces. Keep well under the 2 KB truncation
// limit clients apply, and keep the worked example: the nested `invoke` argument
// shape is what non-Claude models get wrong most often.
export const SYNAPSE_TOOL_ROUTER_INSTRUCTIONS = [
  "Synapse is the local desktop app this MCP server belongs to. It manages Database, Drive,",
  "Workflow, Automation, Content (Rules/Skills/Prompts), Skill Repository, model price rules,",
  "local secrets and repositories, Terminal sessions, and App capabilities.",
  "",
  "This server publishes exactly two tools. Every Synapse capability is reached in two steps:",
  "",
  "1. `search` - call it first with the user's intent in natural language (Chinese or English)",
  "   or with an exact `app_*` tool name. It returns matching tools with their full",
  "   `inputSchema`. Optional `domain` narrows it; `limit` is 1-5 per search.",
  "2. `invoke` - call it with `toolName` set to the exact `app_*` name that `search` returned,",
  "   and `arguments` matching that tool's returned `inputSchema`.",
  "",
  "Example: search {\"query\":\"list drive files\"} returns app_drive_item_list with its",
  "inputSchema; then call invoke {\"toolName\":\"app_drive_item_list\",\"arguments\":{\"limit\":20}}.",
  "",
  "Rules:",
  "- Never call an `app_*` name that `search` did not return, and never guess arguments.",
  "- Calling `search` with no `query` returns a one-line index of a `domain`; read it before",
  "  searching word by word. `domains` are top-level namespaces: Terminal's tools are `app_*`.",
  "- Prefer a small `limit` (for example 20) and continue with the returned `nextOffset` or",
  "  `nextCursor` rather than asking for one large page; big results are slow and costly.",
  "- Retired `database_*`, `drive_*`, `workflow_*`, `content_*`, `automation_*`,",
  "  `model_price_*`, `repository_*` names are not supported.",
  "- `invoke` runs with the original tool's permissions, permission prompts, and audit. A",
  "  high-risk tool can still ask the user for approval, and a denial is not an error to retry.",
  "- When `invoke` returns an error result, read the error text before retrying.",
  "",
  "Before destructive or high-risk operations, read the Synapse Skill domain guide that matches",
  "the task.",
].join("\n")

export function buildSynapseToolRouterTools(): McpToolDefinition[] {
  return SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS.map(({ name, description, inputShape }) => ({
    name,
    description,
    inputSchema: toMcpInputSchema(inputShape),
  }))
}

function toMcpInputSchema(shape: SynapseToolRouterInputShape): McpToolDefinition["inputSchema"] {
  const { $schema: _schema, ...derived } = z.toJSONSchema(
    z.object(shape),
    { io: "input" },
  ) as Record<string, unknown>
  return { ...derived, additionalProperties: false } as McpToolDefinition["inputSchema"]
}

export function createSynapseToolRouterSurface(
  executeTool: SynapseToolRouterExecutor,
): McpToolSurface {
  return {
    instructions: SYNAPSE_TOOL_ROUTER_INSTRUCTIONS,
    listTools: buildSynapseToolRouterTools,
    callTool: (name, args) => {
      if (name === "search") return searchSynapseToolsSurfaceResult(args)
      if (name === "invoke") return invokeSynapseToolSurfaceResult(args, executeTool)
      return Promise.resolve(unknownToolResult(name))
    },
  }
}

async function searchSynapseToolsSurfaceResult(
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  try {
    return textResult(await searchSynapseTools({
      query: typeof args.query === "string" ? args.query : "",
      ...(typeof args.domain === "string" ? { domain: args.domain } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    }))
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${errorMessage(error)}` }], isError: true }
  }
}

async function invokeSynapseToolSurfaceResult(
  args: Record<string, unknown>,
  executeTool: SynapseToolRouterExecutor,
): Promise<McpToolCallResult> {
  if (typeof args.toolName !== "string") {
    return {
      content: [{ type: "text", text: "Error: toolName must be a string" }],
      isError: true,
    }
  }
  return invokeSynapseTool({
    toolName: args.toolName,
    ...(isRecord(args.arguments) ? { arguments: args.arguments } : {}),
  }, executeTool)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

export async function searchSynapseTools(input: SynapseToolSearchInput): Promise<SynapseToolSearchResult> {
  const query = (input.query ?? "").trim()
  const domain = input.domain?.trim()
  if (domain && !availableDomains.includes(domain)) {
    return { mode: "search", tools: [], domains: availableDomains }
  }
  // No query is not a mistake: it is the caller saying "I do not know the names yet".
  if (!query) return toolIndex(domain, normalizeIndexLimit(input.limit))
  const limit = normalizeLimit(input.limit)

  const exact = catalogByName.get(query)
  const aliasTokens = lexiconTokens(query)
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

  const paginated = entries.some((entry) => (
    Object.prototype.hasOwnProperty.call(entry.inputSchema.properties ?? {}, "limit")
  ))

  return {
    mode: "search",
    tools: entries.map(({ name, domain: entryDomain, description, inputSchema }) => ({
      name,
      domain: entryDomain,
      description,
      inputSchema,
    })),
    domains: availableDomains,
    ...(paginated ? { guidance: PAGE_SIZE_GUIDANCE } : {}),
  }
}

const INDEX_GUIDANCE =
  "This is an index, not the schemas. Search again with a `query` naming the tools you want to get their complete input schemas. "
  + "Narrow by `domain` or raise `limit` to see more of it."

/**
 * 一个域（或全部域）的工具索引：名字 + 一句话，不带 input schema。
 *
 * 这是为「我还不知道有哪些工具」这个阶段准备的。缺了它，调用方只能一次猜一个词去搜，
 * 每次拿回几个工具的完整 schema——真机上一次「在终端里打开 codex」为此连搜七次才开始动手。
 */
function toolIndex(domain: string | undefined, limit: number): SynapseToolSearchIndexResult {
  const entries = catalog.filter((entry) => !domain || entry.domain === domain)
  return {
    mode: "index",
    tools: entries.slice(0, limit).map((entry) => ({
      name: entry.name,
      domain: entry.domain,
      summary: indexSummary(entry.description),
    })),
    total: entries.length,
    domains: availableDomains,
    guidance: INDEX_GUIDANCE,
  }
}

/**
 * 索引里一句话就够判断要不要看它。描述的后半截是自动附加的 `Permissions:` / `risk:` 尾巴，
 * 在索引里是噪声，去掉。
 */
function indexSummary(description: string): string {
  const head = description.split(" Permissions: ")[0] ?? description
  const firstSentence = head.split(". ")[0] ?? head
  const sentence = firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`
  return sentence.length <= INDEX_SUMMARY_MAX
    ? sentence
    : `${sentence.slice(0, INDEX_SUMMARY_MAX - 1).trimEnd()}…`
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
    return unknownToolResult(toolName)
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
  const [searchDefinition, invokeDefinition] = SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS
  return sdk.createSdkMcpServer({
    name: SYNAPSE_TOOL_ROUTER_SERVER_NAME,
    version: "1.0.0",
    alwaysLoad: true,
    instructions: SYNAPSE_TOOL_ROUTER_INSTRUCTIONS,
    tools: [
      sdk.tool(
        searchDefinition.name,
        searchDefinition.description,
        SEARCH_TOOL_INPUT_SHAPE,
        async (args) => textResult(await searchSynapseTools(args)),
        {
          annotations: searchDefinition.annotations,
          alwaysLoad: true,
        },
      ),
      sdk.tool(
        invokeDefinition.name,
        invokeDefinition.description,
        INVOKE_TOOL_INPUT_SHAPE,
        async (args, extra) => invokeSynapseTool(args, executeTool, abortSignalFromExtra(extra)),
        {
          annotations: invokeDefinition.annotations,
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
  if (value === undefined) return SEARCH_MODE_LIMIT_MAX
  if (!Number.isInteger(value) || value < 1 || value > SEARCH_MODE_LIMIT_MAX) {
    throw new Error(`limit must be an integer from 1 to ${SEARCH_MODE_LIMIT_MAX}`)
  }
  return value
}

function normalizeIndexLimit(value: number | undefined): number {
  if (value === undefined) return INDEX_MODE_LIMIT_DEFAULT
  if (!Number.isInteger(value) || value < 1 || value > INDEX_MODE_LIMIT_MAX) {
    throw new Error(`limit must be an integer from 1 to ${INDEX_MODE_LIMIT_MAX} when reading the index`)
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
