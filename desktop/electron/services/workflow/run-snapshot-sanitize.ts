import type { NodeRunResult } from "../../../src/types/workflow"
import { sanitizeError } from "../error-sanitize"

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
    ...(result.outputs ? { outputs: sanitizeNodeOutputs(result.outputs) } : {}),
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
  if (!isRecord(agentConversation)) return outputs

  const sanitizedAgentConversation: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(agentConversation)) {
    if (key !== "sessionKey") {
      sanitizedAgentConversation[key] = value
    }
  }

  return {
    ...outputs,
    agentConversation: sanitizedAgentConversation,
  } as unknown as NodeRunResult["outputs"]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
