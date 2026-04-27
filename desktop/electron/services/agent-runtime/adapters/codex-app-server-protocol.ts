import type {
  AgentPermissionDecision,
  AgentPermissionRequestEvent,
  AgentUserQuestion,
} from "../types"

export interface CodexServerRequestLike {
  readonly method: string
  readonly params?: Record<string, unknown>
}

export function codexAppServerModeSettings(_mode: string | undefined): {
  readonly approvalPolicy: "on-request" | "never"
  readonly sandbox: "read-only" | "workspace-write" | "danger-full-access"
} {
  switch (normalizeCodexMode(_mode)) {
    case "auto-edit":
    case "full-auto":
      return { approvalPolicy: "never", sandbox: "workspace-write" }
    case "yolo":
      return { approvalPolicy: "never", sandbox: "danger-full-access" }
    default:
      return { approvalPolicy: "on-request", sandbox: "read-only" }
  }
}

export function permissionEventForCodexServerRequest(
  requestId: string,
  request: CodexServerRequestLike,
): AgentPermissionRequestEvent | null {
  const params = request.params ?? {}
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return {
        type: "permissionRequest",
        requestId,
        toolName: "Bash",
        toolInput: stringValue(params.command)
          ?? stringValue(params.reason)
          ?? stringFromUnknown(params),
        toolInputRaw: params,
      }
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return {
        type: "permissionRequest",
        requestId,
        toolName: "FileChange",
        toolInput: stringValue(params.grantRoot)
          ?? stringValue(params.reason)
          ?? stringFromUnknown(params),
        toolInputRaw: params,
      }
    case "item/permissions/requestApproval":
      return {
        type: "permissionRequest",
        requestId,
        toolName: "Permissions",
        toolInput: stringValue(params.reason) ?? stringFromUnknown(params.permissions),
        toolInputRaw: params,
      }
    case "mcpServer/elicitation/request":
      return {
        type: "permissionRequest",
        requestId,
        toolName: "MCP Elicitation",
        toolInput: stringValue(params.message)
          ?? stringValue(params.url)
          ?? stringFromUnknown(params),
        toolInputRaw: params,
      }
    case "item/tool/requestUserInput":
      return {
        type: "permissionRequest",
        requestId,
        toolName: "AskUserQuestion",
        toolInput: stringFromUnknown(params.questions),
        toolInputRaw: params,
        questions: parseCodexUserQuestions(params),
      }
    default:
      return null
  }
}

export function permissionResponseForCodexServerRequest(
  request: CodexServerRequestLike,
  decision: AgentPermissionDecision,
): Record<string, unknown> | Error {
  const allowed = decision.behavior === "allow"
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return { decision: allowed ? "accept" : "decline" }
    case "item/permissions/requestApproval":
      if (!allowed) {
        return new Error(decision.message ?? "Permission denied")
      }
      return {
        permissions: grantedPermissionsFromRequest(request.params?.permissions),
        scope: "turn",
      }
    case "mcpServer/elicitation/request":
      return {
        action: allowed ? "accept" : "decline",
        content: allowed ? decision.updatedInput ?? {} : null,
        _meta: null,
      }
    case "item/tool/requestUserInput":
      return {
        answers: allowed ? answersFromDecision(decision) : {},
      }
    case "account/chatgptAuthTokens/refresh":
      return new Error(
        "ChatGPT auth token refresh is not available in this Synapse provider session.",
      )
    default:
      return new Error(`Unsupported codex app-server request: ${request.method}`)
  }
}

function normalizeCodexMode(mode: string | undefined): string {
  const value = mode?.trim()
  if (!value || value === "default" || value === "suggest") return "suggest"
  return value
}

function parseCodexUserQuestions(input: Record<string, unknown>): AgentUserQuestion[] | undefined {
  const questions = input.questions
  if (!Array.isArray(questions)) return undefined
  const parsed = questions.flatMap((value): AgentUserQuestion[] => {
    const record = asRecord(value)
    const question = stringValue(record?.question)
    if (!question) return []
    return [{
      question,
      header: stringValue(record?.header),
      options: parseCodexQuestionOptions(record?.options),
    }]
  })
  return parsed.length > 0 ? parsed : undefined
}

function parseCodexQuestionOptions(value: unknown): AgentUserQuestion["options"] {
  if (!Array.isArray(value)) return undefined
  const options = value.flatMap((item): NonNullable<AgentUserQuestion["options"]>[number][] => {
    const record = asRecord(item)
    const label = stringValue(record?.label)
    if (!label) return []
    return [{ label, description: stringValue(record?.description) }]
  })
  return options.length > 0 ? options : undefined
}

function grantedPermissionsFromRequest(value: unknown): Record<string, unknown> {
  const request = asRecord(value)
  if (!request) return {}
  const granted: Record<string, unknown> = {}
  const network = request.network
  const fileSystem = request.fileSystem
  if (network !== undefined && network !== null) granted.network = network
  if (fileSystem !== undefined && fileSystem !== null) granted.fileSystem = fileSystem
  return granted
}

function answersFromDecision(
  decision: AgentPermissionDecision,
): Record<string, { readonly answers: readonly string[] }> {
  const input = asRecord(decision.updatedInput)
  const answers = asRecord(input?.answers)
  if (!answers) return {}

  const result: Record<string, { readonly answers: readonly string[] }> = {}
  for (const [questionId, answerValue] of Object.entries(answers)) {
    const answerRecord = asRecord(answerValue)
    const values = answerRecord?.answers
    if (!Array.isArray(values)) continue
    const labels = values.filter((value): value is string => typeof value === "string")
    result[questionId] = { answers: labels }
  }
  return result
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
