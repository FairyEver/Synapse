import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { SwitchNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { agentErrorDiagnostic, sanitizeAgentError, agentFailureMessage, agentProviderFailureFromResponse } from "../../electron/services/workflow/workflow-utils"
import { createMainLogger } from "../../electron/services/log-store"
import { resolveAgentTimeoutMins } from "../agent-timeout"
import { workflowNodeLogContext } from "../log-context"

const logger = createMainLogger("workflow.node.switch-executor")

/**
 * Normalize an agent response string for branch matching.
 * Strips common LLM formatting artifacts: list prefixes ("- ", "* ", "1. "),
 * surrounding quotes/backticks, trailing punctuation, and takes only the first
 * non-empty line (LLMs often add explanations on subsequent lines).
 */
function normalizeResponse(raw: string): string {
  // Take first non-empty line only
  const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? ""
  // Strip list-item prefixes: "- ", "* ", "1. ", "1) "
  const stripped = firstLine.replace(/^(?:[-*]\s+|\d+[.)]\s+)/, "")
  // Strip surrounding quotes and backticks
  const unquoted = stripped.replace(/^[`'"]+|[`'"]+$/g, "")
  // Strip trailing punctuation (period, comma, semicolon, colon)
  return unquoted.replace(/[.,;:!?]+$/, "").trim().toLowerCase()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function containsCjkCharacter(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(value)
}

function branchIdAppearsInResponse(normalizedResponse: string, branchId: string): boolean {
  const normalizedBranchId = branchId.toLowerCase()
  if (containsCjkCharacter(normalizedBranchId)) {
    return normalizedResponse.includes(normalizedBranchId)
  }
  return new RegExp(`\\b${escapeRegex(normalizedBranchId)}\\b`).test(normalizedResponse)
}

/**
 * Multi-strategy branch matching. Tries in order:
 * 1. Exact match on full trimmed+lowercased response vs lowercased branch IDs
 * 2. Exact match on normalized first-line response vs lowercased branch IDs
 * 3. Search for branch IDs within the normalized response (longest match wins)
 *
 * All comparisons are case-insensitive: the response is lowercased by
 * normalizeResponse / trim().toLowerCase(), and branch IDs are lowercased at
 * comparison time. The original branch ID is returned (preserving user casing).
 */
function matchBranch(response: string, branchIds: string[]): string | null {
  const trimmed = response.trim().toLowerCase()

  // Strategy 1: exact match on full response (case-insensitive)
  const exact = branchIds.find((id) => id.toLowerCase() === trimmed)
  if (exact) return exact

  // Strategy 2: exact match on normalized first line (case-insensitive)
  const normalized = normalizeResponse(response)
  const normalizedMatch = branchIds.find((id) => id.toLowerCase() === normalized)
  if (normalizedMatch) return normalizedMatch

  // Strategy 3: search for branch IDs in the normalized response (case-insensitive).
  // ASCII branch IDs keep word-boundary matching; CJK IDs use contains because JS \b is ASCII-centric.
  // Sort by length descending to prefer longest match (avoids substring false positives)
  const sorted = [...branchIds].sort((a, b) => b.length - a.length)
  const found = sorted.find((id) => branchIdAppearsInResponse(normalized, id))
  if (found) return found

  return null
}

export const switchNodeExecutor: NodeExecutor<SwitchNodeConfig> = {
  async execute(input: NodeExecutionInput<SwitchNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, agentDeps, context } = input
    const logContext = workflowNodeLogContext(context)
    const ids = config.branches.map((b) => b.id)
    input.onProgress?.("resolving_variables", "解析变量…")
    let basePrompt: string
    try {
      basePrompt = interpolatePrompt(config.prompt, resolvedVariables)
    } catch (err) {
      return { status: "failed", output: "", error: `模板变量解析失败：${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
    }
    // Include branch labels in the prompt so the LLM understands the semantic
    // meaning of each branch ID (e.g. "- branch1（正面）" instead of "- branch1").
    // This bridges the gap between user-configured labels (used in the human's
    // judgement prompt) and machine IDs (used by the matcher), improving matching
    // accuracy for non-trivial branch names.
    const prompt = `${basePrompt}\n\n---\n你必须只回复以下选项之一（不要包含任何其他文字）：\n${config.branches.map((b) => `- ${b.id}（${b.label}）`).join("\n")}`

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("switch node executing", {
      ...logContext, providerId: config.providerId, modelTier: config.modelTier,
      branchIds: ids,
      branchCount: config.branches.length,
      branchLabelLengths: config.branches.map((b) => b.label.length),
      defaultBranch: config.defaultBranch ?? null,
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    let agentConversation: NodeExecutionResult["agentConversation"]
    const agentResult = await agentDeps.sendToAgent({
      providerId: config.providerId ?? "",
      modelTier: config.modelTier ?? "default",
      prompt,
      projectId: context.projectId ?? "",
      abortSignal: context.abortSignal,
      timeoutMins: resolveAgentTimeoutMins(config.timeoutMins),
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      workflowRunId: context.runId,
      workflowNodeId: context.nodeId,
      workflowNodeName: context.nodeName,
      onConversationCreated: (target) => {
        agentConversation = target
        input.onAgentConversation?.(target)
      },
      onResponseStarted: () => input.onProgress?.("processing_response", "处理中…"),
    })
    const durationMs = Date.now() - start

    if (agentResult.status === "failed") {
      const diagnostic = agentErrorDiagnostic(agentResult.error)
      const sanitizedError = sanitizeAgentError(agentResult.error)
      logger.warn("switch node agent call failed", {
        ...logContext, ...diagnostic, sanitizedError, durationMs,
      })
      return { status: "failed", output: "", error: agentFailureMessage(agentResult.error), durationMs, usage: agentResult.usage, modelName: agentResult.modelName, costUsd: agentResult.costUsd, costCny: agentResult.costCny, costBreakdownCny: agentResult.costBreakdownCny, costCurrency: agentResult.costCurrency, agentConversation: agentConversation ?? agentResult.agentConversation }
    }

    const providerFailure = agentProviderFailureFromResponse(agentResult.response)
    if (providerFailure) {
      const diagnostic = agentErrorDiagnostic(providerFailure)
      const sanitizedError = sanitizeAgentError(providerFailure)
      logger.warn("switch node agent call failed", {
        ...logContext, ...diagnostic, sanitizedError, durationMs,
      })
      return { status: "failed", output: "", error: agentFailureMessage(providerFailure), durationMs, usage: agentResult.usage, modelName: agentResult.modelName, costUsd: agentResult.costUsd, costCny: agentResult.costCny, costBreakdownCny: agentResult.costBreakdownCny, costCurrency: agentResult.costCurrency, agentConversation: agentConversation ?? agentResult.agentConversation }
    }

    const rawResponse = agentResult.response.trim()
    const normalizedResponse = normalizeResponse(rawResponse)
    input.onProgress?.("matching_branch", "匹配分支…")
    const matched = matchBranch(rawResponse, ids)

    if (matched) {
      logger.info("switch node branch matched", {
        ...logContext, activeBranch: matched,
        responseLength: rawResponse.length, normalizedResponseLength: normalizedResponse.length, durationMs,
      })
      return { status: "success", output: matched, activeBranch: matched, durationMs, usage: agentResult.usage, modelName: agentResult.modelName, costUsd: agentResult.costUsd, costCny: agentResult.costCny, costBreakdownCny: agentResult.costBreakdownCny, costCurrency: agentResult.costCurrency, agentConversation: agentConversation ?? agentResult.agentConversation }
    }

    if (config.defaultBranch) {
      logger.info("switch node using default branch (no match)", {
        ...logContext, activeBranch: config.defaultBranch,
        responseLength: rawResponse.length, normalizedResponseLength: normalizedResponse.length, durationMs,
      })
      return { status: "success", output: config.defaultBranch, activeBranch: config.defaultBranch, durationMs, usage: agentResult.usage, modelName: agentResult.modelName, costUsd: agentResult.costUsd, costCny: agentResult.costCny, costBreakdownCny: agentResult.costBreakdownCny, costCurrency: agentResult.costCurrency, agentConversation: agentConversation ?? agentResult.agentConversation }
    }

    logger.warn("switch node branch match failed — no match and no default", {
      ...logContext, responseLength: rawResponse.length, normalizedResponseLength: normalizedResponse.length,
      branchIds: ids, durationMs,
    })
    return {
      status: "failed", output: "", durationMs,
      error: `Agent 响应不匹配任何分支 [${ids.join(", ")}]`,
      usage: agentResult.usage,
      modelName: agentResult.modelName,
      costUsd: agentResult.costUsd,
      costCny: agentResult.costCny,
      costBreakdownCny: agentResult.costBreakdownCny,
      costCurrency: agentResult.costCurrency,
      agentConversation: agentConversation ?? agentResult.agentConversation,
    }
  },
}
