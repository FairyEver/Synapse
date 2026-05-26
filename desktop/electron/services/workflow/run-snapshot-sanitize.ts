import type { NodeRunResult } from "../../../src/types/workflow"
import { sanitizeError } from "../error-sanitize"

export function sanitizeNodeResultsForSnapshot(
  nodeResults: Record<string, NodeRunResult>,
): Record<string, NodeRunResult> {
  const sanitized: Record<string, NodeRunResult> = {}
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    sanitized[nodeId] = result.input
      ? {
          ...result,
          input: {
            variables: Object.fromEntries(
              Object.entries(result.input.variables).map(([key, value]) => [key, sanitizeError(value)]),
            ),
            ...(result.input.prompt !== undefined ? { prompt: sanitizeError(result.input.prompt) } : {}),
          },
        }
      : result
  }
  return sanitized
}
