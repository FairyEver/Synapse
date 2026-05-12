import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { SwitchNodeConfig } from "./schema"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.switch-executor")

function interpolate(t: string, v: Record<string, string>): string {
  // Supports both {{varName}} and {{$varName}} syntax (design spec uses $-prefix)
  return t.replace(/\{\{\$?([a-zA-Z0-9_一-鿿]+)\}\}/g, (match, n) => v[n] ?? match)
}

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

/**
 * Multi-strategy branch matching. Tries in order:
 * 1. Exact match on full trimmed+lowercased response vs lowercased branch IDs
 * 2. Exact match on normalized first-line response vs lowercased branch IDs
 * 3. Search for lowercased branch IDs within the normalized response (longest match wins)
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

  // Strategy 3: search for branch IDs within normalized response (case-insensitive)
  // Sort by length descending to prefer longest match (avoids substring false positives)
  const sorted = [...branchIds].sort((a, b) => b.length - a.length)
  const found = sorted.find((id) => normalized.includes(id.toLowerCase()))
  if (found) return found

  return null
}

export const switchNodeExecutor: NodeExecutor<SwitchNodeConfig> = {
  async execute(input: NodeExecutionInput<SwitchNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, agentDeps, context } = input
    const ids = config.branches.map((b) => b.id)
    input.onProgress?.("resolving_variables", "解析变量…")
    const basePrompt = interpolate(config.prompt, resolvedVariables)
    // Include branch labels in the prompt so the LLM understands the semantic
    // meaning of each branch ID (e.g. "- branch1（正面）" instead of "- branch1").
    // This bridges the gap between user-configured labels (used in the human's
    // judgement prompt) and machine IDs (used by the matcher), improving matching
    // accuracy for non-trivial branch names.
    const prompt = `${basePrompt}\n\n---\n你必须只回复以下选项之一（不要包含任何其他文字）：\n${config.branches.map((b) => `- ${b.id}（${b.label}）`).join("\n")}`

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("switch node executing", {
      runId: context.runId, agent: config.agent,
      branchIds: ids, branchLabels: config.branches.map((b) => b.label),
      defaultBranch: config.defaultBranch ?? null,
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    const agentResult = await agentDeps.sendToAgent({ agent: config.agent, prompt, abortSignal: context.abortSignal })
    const durationMs = Date.now() - start

    if (agentResult.status === "failed") {
      logger.warn("switch node agent call failed", {
        runId: context.runId, error: agentResult.error, durationMs,
      })
      return { status: "failed", output: "", error: agentResult.error, durationMs }
    }

    const rawResponse = agentResult.response.trim()
    input.onProgress?.("matching_branch", "匹配分支…")
    const matched = matchBranch(rawResponse, ids)

    if (matched) {
      logger.info("switch node branch matched", {
        runId: context.runId, activeBranch: matched,
        rawResponse: rawResponse.slice(0, 200), durationMs,
        normalizedResponse: normalizeResponse(rawResponse).slice(0, 100),
      })
      return { status: "success", output: matched, activeBranch: matched, durationMs }
    }

    if (config.defaultBranch) {
      logger.info("switch node using default branch (no match)", {
        runId: context.runId, activeBranch: config.defaultBranch,
        rawResponse: rawResponse.slice(0, 200), durationMs,
      })
      return { status: "success", output: config.defaultBranch, activeBranch: config.defaultBranch, durationMs }
    }

    logger.warn("switch node branch match failed — no match and no default", {
      runId: context.runId, rawResponse: rawResponse.slice(0, 500),
      branchIds: ids, durationMs,
    })
    return {
      status: "failed", output: "", durationMs,
      error: `Agent 响应 "${rawResponse.slice(0, 100)}" 不匹配任何分支 [${ids.join(", ")}]`,
    }
  },
}
