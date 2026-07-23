import type { NodeRunResult, WorkflowDefinition, WorkflowEvent, WorkflowNode, WorkflowRunResult, WorkflowRunSnapshot, WorkflowRunStatus } from "../../../src/types/workflow"
import { sanitizeError } from "../error-sanitize"

const SENSITIVE_OUTPUT_KEY_PATTERN = /^(authorization|cookie|set-cookie|.*(?:secret|token|password|credential|api[-_]?key|session[-_]?key).*)$/i
const DEBUG_PATH_KEYS = new Set(["cwd", "stdoutPath", "stderrPath", "promptPath", "lastMessagePath"])
const PRESERVED_STRUCTURED_PATH_KEYS = new Set(["path", ...DEBUG_PATH_KEYS])
const WORKFLOW_HISTORY_OUTPUT_MAX_BYTES = 10_000
const WORKFLOW_HISTORY_OUTPUT_MAX_COLLECTION_ITEMS = 200
const WORKFLOW_HISTORY_OUTPUT_MAX_DEPTH = 12
const TRUNCATED_OUTPUT_MARKER = "[truncated]"

export function sanitizeNodeResultsForSnapshot(
  nodeResults: Record<string, NodeRunResult>,
): Record<string, NodeRunResult> {
  const sanitized: Record<string, NodeRunResult> = {}
  for (const [nodeId, result] of Object.entries(nodeResults)) {
    sanitized[nodeId] = sanitizeNodeResultForSnapshot(result)
  }
  return sanitized
}

export function sanitizeWorkflowRunSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  return {
    ...snapshot,
    params: sanitizeWorkflowOutputForHistory(snapshot.params),
    nodeResults: sanitizeNodeResultsForSnapshot(snapshot.nodeResults),
    ...(snapshot.definition ? { definition: sanitizeWorkflowDefinitionForSnapshot(snapshot.definition) } : {}),
    ...(snapshot.error !== undefined ? { error: sanitizeError(snapshot.error) } : {}),
  }
}

export function sanitizeWorkflowRunStatus(status: WorkflowRunStatus): WorkflowRunStatus {
  return {
    ...status,
    nodeResults: sanitizeNodeResultsForSnapshot(status.nodeResults),
    ...(status.error !== undefined ? { error: sanitizeError(status.error) } : {}),
    ...(status.params !== undefined ? { params: sanitizeWorkflowOutputForHistory(status.params) } : {}),
    ...(status.definition ? { definition: sanitizeWorkflowDefinitionForSnapshot(status.definition) } : {}),
  }
}

export function sanitizeWorkflowEventForRenderer(event: WorkflowEvent): WorkflowEvent {
  switch (event.type) {
    case "node:started":
    case "node:skipped":
      return event.result ? { ...event, result: sanitizeNodeRunResultForRenderer(event.result) } : event
    case "node:completed":
      return {
        ...event,
        output: sanitizeNodePrimaryOutputForHistory(event.output, event.result?.outputs),
        ...(event.result ? { result: sanitizeNodeRunResultForRenderer(event.result) } : {}),
      }
    case "node:failed":
      return {
        ...event,
        error: sanitizeError(event.error),
        ...(event.result ? { result: sanitizeNodeRunResultForRenderer(event.result) } : {}),
      }
    case "workflow:completed":
      return { ...event, result: sanitizeWorkflowRunResultForRenderer(event.result) }
    case "workflow:failed":
    case "workflow:cancelled":
      return {
        ...event,
        ...(event.type === "workflow:failed" ? { error: sanitizeError(event.error) } : {}),
        ...(event.result ? { result: sanitizeWorkflowRunResultForRenderer(event.result) } : {}),
      }
    default:
      return event
  }
}

export function sanitizeWorkflowOutputForHistory<T>(output: T): T {
  return sanitizeBoundedSnapshotValue(output, {
    remainingBytes: WORKFLOW_HISTORY_OUTPUT_MAX_BYTES,
  }) as T
}

export function sanitizeWorkflowDefinitionForSnapshot(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    params: definition.params.map((param) => ({
      ...param,
      default: sanitizeSnapshotValue(param.default) as typeof param.default,
    })),
    nodes: definition.nodes.map(sanitizeWorkflowNodeForSnapshot),
  }
}

function sanitizeWorkflowNodeForSnapshot(node: WorkflowNode): WorkflowNode {
  const sanitizedConfig = sanitizeWorkflowNodeConfigForSnapshot(node)
  if (node.type !== "codex" && node.type !== "claude_code") {
    return {
      ...node,
      config: sanitizedConfig,
    }
  }
  const configOverrides = node.config.configOverrides
  const prompt = node.config.prompt
  return {
    ...node,
    config: {
      ...sanitizedConfig,
      ...(typeof prompt === "string" ? { prompt: sanitizeError(prompt) } : {}),
      ...(node.type === "codex" && Array.isArray(configOverrides) ? { configOverrides: configOverrides.map(redactConfigOverrideValue) } : {}),
    },
  }
}

function sanitizeWorkflowNodeConfigForSnapshot(node: WorkflowNode): WorkflowNode["config"] {
  const sanitizedConfig = sanitizeSnapshotValue(node.config) as WorkflowNode["config"]
  if (node.type !== "script" || !isRecord(node.config.env)) return sanitizedConfig
  return {
    ...sanitizedConfig,
    env: redactScriptEnv(node.config.env),
  }
}

function redactScriptEnv(env: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value ? "[redacted]" : value]),
  )
}

function redactConfigOverrideValue(entry: unknown): unknown {
  if (!isRecord(entry) || !Object.hasOwn(entry, "value")) return entry
  return {
    ...entry,
    value: "[redacted]",
  }
}

function sanitizeNodeResultForSnapshot(result: NodeRunResult): NodeRunResult {
  return {
    ...result,
    ...(result.input ? { input: sanitizeNodeInput(result.input) } : {}),
    ...(result.output !== undefined ? { output: sanitizeNodePrimaryOutputForHistory(result.output, result.outputs) } : {}),
    ...(result.outputs ? { outputs: sanitizeNodeOutputs(result.outputs) } : {}),
    ...(result.error !== undefined ? { error: sanitizeError(result.error) } : {}),
  }
}

function sanitizeNodeRunResultForRenderer(result: NodeRunResult): NodeRunResult {
  return sanitizeNodeResultsForSnapshot({ [result.nodeId]: result })[result.nodeId] ?? result
}

function sanitizeWorkflowRunResultForRenderer(result: WorkflowRunResult): WorkflowRunResult {
  return {
    ...result,
    nodeResults: sanitizeNodeResultsForSnapshot(result.nodeResults),
    ...(result.output !== undefined ? { output: sanitizeWorkflowOutputForHistory(result.output) } : {}),
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
  const sanitizedOutputs = sanitizeWorkflowOutputForHistory(outputs)
  if (!isRecord(sanitizedOutputs)) return sanitizedOutputs as NodeRunResult["outputs"]
  if (!isRecord(agentConversation)) return sanitizedOutputs as NodeRunResult["outputs"]

  return {
    ...sanitizedOutputs,
    agentConversation: sanitizeAgentConversationOutput(agentConversation),
  } as unknown as NodeRunResult["outputs"]
}

function sanitizeNodePrimaryOutputForHistory<T>(
  output: T,
  outputs: NodeRunResult["outputs"] | undefined,
): T {
  if (typeof output === "string" && outputs?.path === output) {
    return sanitizeBoundedSnapshotString(output, "path", {
      remainingBytes: WORKFLOW_HISTORY_OUTPUT_MAX_BYTES,
    }) as T
  }
  return sanitizeWorkflowOutputForHistory(output)
}

function sanitizeSnapshotValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
  key = "",
): unknown {
  if (typeof value === "string") {
    if (isSensitiveSnapshotKey(key) && value) return "[redacted]"
    if (DEBUG_PATH_KEYS.has(key)) return value
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

type OutputBudget = { remainingBytes: number }

function sanitizeBoundedSnapshotValue(
  value: unknown,
  budget: OutputBudget,
  seen = new WeakSet<object>(),
  key = "",
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return sanitizeBoundedSnapshotString(value, key, budget)
  }
  if (typeof value === "bigint" || value === null || value === undefined) return value
  if (typeof value !== "object") return value
  if (depth >= WORKFLOW_HISTORY_OUTPUT_MAX_DEPTH || budget.remainingBytes <= 0) {
    return TRUNCATED_OUTPUT_MARKER
  }
  if (seen.has(value)) return "[circular]"
  seen.add(value)

  if (Array.isArray(value)) {
    const sanitizedArray: unknown[] = []
    const itemLimit = Math.min(value.length, WORKFLOW_HISTORY_OUTPUT_MAX_COLLECTION_ITEMS)
    for (let index = 0; index < itemLimit && budget.remainingBytes > 0; index += 1) {
      sanitizedArray.push(sanitizeBoundedSnapshotValue(value[index], budget, seen, key, depth + 1))
    }
    if (sanitizedArray.length < value.length) sanitizedArray.push(TRUNCATED_OUTPUT_MARKER)
    seen.delete(value)
    return sanitizedArray
  }

  const sanitizedRecord: Record<string, unknown> = {}
  const entries = Object.entries(value)
  const entryLimit = Math.min(entries.length, WORKFLOW_HISTORY_OUTPUT_MAX_COLLECTION_ITEMS)
  let processedEntries = 0
  for (let index = 0; index < entryLimit && budget.remainingBytes > 0; index += 1) {
    const [entryKey, entryValue] = entries[index]
    const keyBytes = Buffer.byteLength(entryKey, "utf8")
    if (keyBytes > budget.remainingBytes) break
    budget.remainingBytes -= keyBytes
    sanitizedRecord[entryKey] = sanitizeBoundedSnapshotValue(entryValue, budget, seen, entryKey, depth + 1)
    processedEntries += 1
  }
  if (processedEntries < entries.length) sanitizedRecord.__synapseTruncated = true
  seen.delete(value)
  return sanitizedRecord
}

function sanitizeBoundedSnapshotString(value: string, key: string, budget: OutputBudget): string {
  if (isSensitiveSnapshotKey(key) && value) {
    return consumeStringBudget("[redacted]", budget)
  }
  const boundedValue = consumeStringBudget(value, budget)
  if (PRESERVED_STRUCTURED_PATH_KEYS.has(key)) return boundedValue
  return sanitizeError(boundedValue)
}

function consumeStringBudget(value: string, budget: OutputBudget): string {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.byteLength <= budget.remainingBytes) {
    budget.remainingBytes -= bytes.byteLength
    return value
  }
  const marker = `\n${TRUNCATED_OUTPUT_MARKER}`
  const markerBytes = Buffer.byteLength(marker, "utf8")
  const prefixBudget = Math.max(0, budget.remainingBytes - markerBytes)
  let prefix = bytes.subarray(0, prefixBudget).toString("utf8")
  while (prefix.endsWith("\uFFFD")) {
    prefix = prefix.slice(0, -1)
  }
  budget.remainingBytes = 0
  return `${prefix}${marker}`
}

function sanitizeAgentConversationOutput(agentConversation: Record<string, unknown>): Record<string, unknown> {
  return sanitizeWorkflowOutputForHistory(Object.fromEntries(
    Object.entries(agentConversation).filter(([key]) => key !== "sessionKey"),
  ))
}

function isSensitiveSnapshotKey(key: string): boolean {
  return SENSITIVE_OUTPUT_KEY_PATTERN.test(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
