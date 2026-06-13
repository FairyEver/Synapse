import type { NodeRunResult } from "../../../src/types/workflow"
import { sanitizeError } from "../error-sanitize"

const SENSITIVE_OUTPUT_KEY_PATTERN = /^(authorization|cookie|set-cookie|.*(?:secret|token|password|credential|api[-_]?key|session[-_]?key).*)$/i
const CODEX_DEBUG_PATH_KEYS = new Set(["cwd", "stdoutPath", "stderrPath", "promptPath", "lastMessagePath"])

export function sanitizeNodeResultsForSnapshot(
  nodeResults: Record<string, NodeRunResult>,
): Record<string, NodeRunResult> {
  const sanitized: Record<string, NodeRunResult> = {}
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    sanitized[nodeId] = sanitizeNodeResultForSnapshot(result)
  }
  return sanitized
}

function sanitizeNodeResultForSnapshot(result: NodeRunResult): NodeRunResult {
  return {
    ...result,
    ...(result.input ? { input: sanitizeNodeInput(result.input) } : {}),
    ...(result.output !== undefined ? { output: sanitizeError(result.output) } : {}),
    ...(result.outputs ? { outputs: sanitizeNodeOutputs(result.outputs) } : {}),
    ...(result.error !== undefined ? { error: sanitizeError(result.error) } : {}),
  }
}

function sanitizeNodeInput(input: NodeRunResult["input"]): NodeRunResult["input"] {
  return {
    variables: Object.fromEntries(
      Object.entries(input.variables).map(([key, value]) => [key, sanitizeError(value)]),
    ),
    ...(input.prompt !== undefined ? { prompt: sanitizeError(input.prompt) } : {}),
  }
}

function sanitizeNodeOutputs(outputs: NonNullable<NodeRunResult["outputs"]>): NodeRunResult["outputs"] {
  const agentConversation = outputs.agentConversation
  const sanitizedOutputs = sanitizeSnapshotValue(outputs)
  if (!isRecord(sanitizedOutputs)) return sanitizedOutputs as NodeRunResult["outputs"]
  if (!isRecord(agentConversation)) return sanitizedOutputs as NodeRunResult["outputs"]

  sanitizedOutputs.agentConversation = sanitizeAgentConversationOutput(agentConversation)
  return sanitizedOutputs as NodeRunResult["outputs"]
}

function sanitizeSnapshotValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
  key = "",
): unknown {
  if (typeof value === "string") {
    if (isSensitiveSnapshotKey(key) && value) return "[redacted]"
    if (CODEX_DEBUG_PATH_KEYS.has(key)) return value
    return sanitizeError(value)
  }
  if (typeof value === "bigint" || value === null || value === undefined) return value
  if (typeof value !== "object") return value

  const cached = seen.get(value)
  if (cached) return cached
  if (Array.isArray(value)) {
    const sanitizedArray: unknown[] = []
    seen.set(value, sanitizedArray)
    for (const item of value) {
      sanitizedArray.push(sanitizeSnapshotValue(item, seen, key))
    }
    return sanitizedArray
  }

  const sanitizedRecord: Record<string, unknown> = {}
  seen.set(value, sanitizedRecord)
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitizedRecord[entryKey] = sanitizeSnapshotValue(entryValue, seen, entryKey)
  }
  return sanitizedRecord
}

function sanitizeAgentConversationOutput(agentConversation: Record<string, unknown>): Record<string, unknown> {
  const sanitizedAgentConversation: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(agentConversation)) {
    if (key !== "sessionKey") {
      sanitizedAgentConversation[key] = sanitizeSnapshotValue(value, new WeakMap(), key)
    }
  }
  return sanitizedAgentConversation
}

function isSensitiveSnapshotKey(key: string): boolean {
  return SENSITIVE_OUTPUT_KEY_PATTERN.test(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
