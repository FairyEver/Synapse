import { z } from "zod"
import { MODEL_TIERS } from "../../../src/types/provider-model"

const targetIdentifierSchema = z.string().trim().min(1).max(4096)
const deepLinkSchema = z.string().min(1).max(16 * 1024)
  .describe("Complete Synapse Agent deep link copied from the user message. Pass it unchanged; do not parse or rewrite it.")

const agentConversationTargetShape = {
  deepLink: deepLinkSchema.optional(),
  projectId: targetIdentifierSchema.describe("Project identifier. Required with conversationId or conversationRef.").optional(),
  conversationId: targetIdentifierSchema.describe("Legacy internal conversation identifier. Prefer deepLink or conversationRef.").optional(),
  conversationRef: targetIdentifierSchema.describe("Short stable reference returned by inspect. Prefer it for follow-up calls.").optional(),
}

export const agentConversationProtocolRouteParamsSchema = z.object({
  deepLink: deepLinkSchema.refine((value) => {
    try {
      parseAgentConversationDeepLink(value)
      return true
    } catch {
      return false
    }
  }),
}).strict()

const idempotencyKeySchema = z.string().uuid()
const boundedContentSchema = z.string().superRefine((value, ctx) => {
  if (!value.trim()) {
    ctx.addIssue({ code: "custom", message: "content is required" })
  } else if (new TextEncoder().encode(value).byteLength > 64 * 1024) {
    ctx.addIssue({ code: "custom", message: "content exceeds 64 KiB" })
  }
})

function validateConversationTarget(
  value: {
    readonly deepLink?: string
    readonly projectId?: string
    readonly conversationId?: string
    readonly conversationRef?: string
  },
  ctx: z.RefinementCtx,
): void {
  const hasDeepLink = value.deepLink !== undefined
  const hasProjectId = value.projectId !== undefined
  const locatorCount = Number(value.conversationId !== undefined) + Number(value.conversationRef !== undefined)
  const validDeepLinkTarget = hasDeepLink && !hasProjectId && locatorCount === 0
  const validIdentifierTarget = !hasDeepLink && hasProjectId && locatorCount === 1
  if (!validDeepLinkTarget && !validIdentifierTarget) {
    ctx.addIssue({
      code: "custom",
      path: ["deepLink"],
      message: "provide deepLink or projectId with exactly one conversation identifier",
    })
  }
}

export const agentConversationOpenInputSchema = z.object(agentConversationTargetShape)
  .strict()
  .superRefine(validateConversationTarget)

export const agentGroupListInputSchema = z.object({
  query: z.string().trim().min(1).max(256).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(100).default(50),
}).strict()

export const agentProviderListInputSchema = agentGroupListInputSchema.extend({
  providerId: targetIdentifierSchema.optional(),
}).strict()

export type AgentProviderListInput = z.infer<typeof agentProviderListInputSchema>

export const agentConversationCreateInputSchema = z.object({
  projectId: targetIdentifierSchema.optional(),
  projectName: z.string().trim().min(1).max(256).optional(),
  sameGroupAs: agentConversationOpenInputSchema.optional(),
  name: z.string().trim().min(1).max(256).optional(),
  providerId: targetIdentifierSchema.describe("Exact providerId returned by app_agent_provider_list; supply together with modelTier.").optional(),
  modelTier: z.enum(MODEL_TIERS).describe("Selectable tier returned by app_agent_provider_list; supply together with providerId.").optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine((value, ctx) => {
  if ((value.providerId === undefined) !== (value.modelTier === undefined)) {
    ctx.addIssue({ code: "custom", message: "provide providerId and modelTier together" })
  }
  const targets = [value.projectId, value.projectName, value.sameGroupAs]
  if (targets.filter((target) => target !== undefined).length > 1) {
    ctx.addIssue({ code: "custom", message: "use at most one of projectId, projectName, or sameGroupAs" })
  }
})

export type AgentGroupListInput = z.infer<typeof agentGroupListInputSchema>
export type AgentConversationCreateInput = z.infer<typeof agentConversationCreateInputSchema>

export const agentConversationInspectInputSchema = z.object({
  ...agentConversationTargetShape,
  beforeIndex: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(100).default(50),
}).strict().superRefine(validateConversationTarget)

export const agentConversationObserveInputSchema = z.object({
  ...agentConversationTargetShape,
  afterRevision: z.number().int().nonnegative(),
  maxWaitMs: z.number().int().min(0).max(30_000),
}).strict().superRefine(validateConversationTarget)

export const agentMessageSendInputSchema = z.object({
  ...agentConversationTargetShape,
  content: boundedContentSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine(validateConversationTarget)

export const agentTurnSteerInputSchema = z.object({
  ...agentConversationTargetShape,
  expectedTurnId: z.string().trim().min(1).max(4096),
  clientMessageId: z.string().uuid(),
  content: boundedContentSchema,
}).strict().superRefine((value, ctx) => {
  validateConversationTarget(value, ctx)
  if (value.content.trim().startsWith("/")) {
    ctx.addIssue({ code: "custom", path: ["content"], message: "commands cannot steer an active turn" })
  }
})

export const agentTurnStopInputSchema = z.object({
  ...agentConversationTargetShape,
  expectedTurnId: z.string().trim().min(1).max(4096),
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine(validateConversationTarget)

const agentQuestionAnswerSchema = z.object({
  questionIndex: z.number().int().nonnegative(),
  values: z.array(z.string().trim().min(1).max(4096)).min(1).max(100),
}).strict()

export const agentPermissionRespondInputSchema = z.object({
  ...agentConversationTargetShape,
  expectedTurnId: z.string().trim().min(1).max(4096),
  requestId: z.string().trim().min(1).max(4096),
  idempotencyKey: idempotencyKeySchema,
  kind: z.enum(["tool_permission", "user_question"]),
  expectedToolName: z.string().trim().min(1).max(512).optional(),
  decision: z.enum(["allow_once", "allow_session", "deny", "answer", "skip"]),
  answers: z.array(agentQuestionAnswerSchema).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  validateConversationTarget(value, ctx)
  if (value.kind === "tool_permission") {
    if (!value.expectedToolName) {
      ctx.addIssue({ code: "custom", path: ["expectedToolName"], message: "expectedToolName is required" })
    }
    if (!(["allow_once", "allow_session", "deny"] as const).includes(value.decision as never)) {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "invalid tool permission decision" })
    }
    if (value.answers !== undefined) {
      ctx.addIssue({ code: "custom", path: ["answers"], message: "answers are not accepted for tool permissions" })
    }
    return
  }
  if (value.expectedToolName !== undefined) {
    ctx.addIssue({ code: "custom", path: ["expectedToolName"], message: "expectedToolName is not accepted for user questions" })
  }
  if (value.decision !== "answer" && value.decision !== "skip") {
    ctx.addIssue({ code: "custom", path: ["decision"], message: "invalid user question decision" })
  }
  if (value.decision === "answer" && (!value.answers || value.answers.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["answers"], message: "answers are required" })
  }
  if (value.decision === "skip" && value.answers !== undefined) {
    ctx.addIssue({ code: "custom", path: ["answers"], message: "answers are not accepted when skipping" })
  }
})

export const agentConversationOpenResultSchema = z.object({
  opened: z.literal(true),
}).strict()

export type AgentConversationOpenInput = z.infer<typeof agentConversationOpenInputSchema>
export type AgentConversationOpenResult = z.infer<typeof agentConversationOpenResultSchema>
export type AgentConversationInspectInput = z.infer<typeof agentConversationInspectInputSchema>
export type AgentConversationObserveInput = z.infer<typeof agentConversationObserveInputSchema>
export type AgentMessageSendInput = z.infer<typeof agentMessageSendInputSchema>
export type AgentTurnSteerInput = z.infer<typeof agentTurnSteerInputSchema>
export type AgentTurnStopInput = z.infer<typeof agentTurnStopInputSchema>
export type AgentPermissionRespondInput = z.infer<typeof agentPermissionRespondInputSchema>

export type AgentConversationTargetInput = Pick<
  AgentConversationOpenInput,
  "deepLink" | "projectId" | "conversationId" | "conversationRef"
>

export type ResolvedAgentConversationTarget = {
  readonly projectId: string
  readonly conversationId: string
} | {
  readonly conversationRef: string
}

export function resolveAgentConversationTargetInput(
  input: AgentConversationTargetInput,
): ResolvedAgentConversationTarget {
  if (input.deepLink !== undefined) return parseAgentConversationDeepLink(input.deepLink)
  if (input.conversationRef !== undefined && input.projectId === undefined) {
    return { conversationRef: normalizeAgentConversationLocator(input.conversationRef) }
  }
  return {
    projectId: input.projectId as string,
    conversationId: normalizeAgentConversationLocator(
      (input.conversationRef ?? input.conversationId) as string,
    ),
  }
}

export function parseAgentConversationDeepLink(rawUrl: string): ResolvedAgentConversationTarget {
  if (rawUrl.trim() !== rawUrl || rawUrl.includes("+") || /%(?![\da-f]{2})/i.test(rawUrl)) {
    throw new Error("invalid_agent_conversation_deep_link")
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("invalid_agent_conversation_deep_link")
  }
  if (
    parsed.protocol !== "synapse:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || parsed.hash !== ""
  ) throw new Error("invalid_agent_conversation_deep_link")

  if (parsed.hostname !== "threads" || parsed.search !== "") {
    throw new Error("invalid_agent_conversation_deep_link")
  }
  const rawPath = parsed.pathname.slice(1)
  if (!rawPath || parsed.pathname !== `/${rawPath}` || rawPath.includes("/")) {
    throw new Error("invalid_agent_conversation_deep_link")
  }
  let threadId: string
  try {
    threadId = decodeURIComponent(rawPath)
  } catch {
    throw new Error("invalid_agent_conversation_deep_link")
  }
  const normalizedThreadId = normalizeAgentConversationThreadId(threadId)
  if (!/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3}$/.test(normalizedThreadId)) {
    throw new Error("invalid_agent_conversation_deep_link")
  }
  return { conversationRef: `agc_${normalizedThreadId}` }
}

export function buildAgentConversationDeepLink(input: AgentConversationOpenInput): string {
  const parsed = agentConversationOpenInputSchema.parse(input)
  if (parsed.conversationRef !== undefined) {
    const normalized = normalizeAgentConversationLocator(parsed.conversationRef)
    const match = /^agc_([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3})$/.exec(normalized)
    if (!match) throw new Error("invalid_agent_conversation_reference")
    return `synapse://threads/${encodeDeepLinkValue(match[1] as string)}`
  }
  const target = resolveAgentConversationTargetInput(parsed)
  if ("conversationRef" in target) {
    const match = /^agc_([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3})$/.exec(target.conversationRef)
    if (!match) throw new Error("invalid_agent_conversation_reference")
    return `synapse://threads/${encodeDeepLinkValue(match[1] as string)}`
  }
  throw new Error("agent_conversation_reference_required")
}

function normalizeAgentConversationLocator(value: string): string {
  return /^agc\\_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3}$/.test(value)
    ? value.replace(/^agc\\_/, "agc_")
    : value
}

function normalizeAgentConversationThreadId(value: string): string {
  const normalized = value.replace(/\\([_.-])/g, "$1")
  return /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3}$/.test(normalized) ? normalized : value
}

function encodeDeepLinkValue(value: string): string {
  return encodeURIComponent(value).replaceAll("_", "%5F").replaceAll(".", "%2E").replaceAll("-", "%2D")
}
