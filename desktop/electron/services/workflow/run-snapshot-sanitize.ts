import type { NodeRunResult, WorkflowDefinition, WorkflowEvent, WorkflowNode, WorkflowRunResult, WorkflowRunSnapshot, WorkflowRunStatus } from "../../../src/types/workflow"
import { sanitizeError } from "../error-sanitize"

const SENSITIVE_OUTPUT_KEY_PATTERN = /^(authorization|cookie|set-cookie|.*(?:secret|token|password|credential|api[-_]?key|session[-_]?key).*)$/i
const DEBUG_PATH_KEYS = new Set(["cwd", "stdoutPath", "stderrPath", "promptPath", "lastMessagePath"])

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
    params: sanitizeSnapshotValue(snapshot.params) as WorkflowRunSnapshot["params"],
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
        output: sanitizeWorkflowOutputForHistory(event.output),
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
  return sanitizeSnapshotValue(output) as T
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
    ...(result.output !== undefined ? { output: sanitizeError(result.output) } : {}),
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
    ...(result.output !== undefined ? { output: sanitizeError(result.output) } : {}),
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
