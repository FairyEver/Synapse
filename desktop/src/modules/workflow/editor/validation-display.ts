import type { ValidationError, WorkflowDefinition } from "@/types/workflow"

export interface WorkflowValidationDisplayItem {
  readonly id: string
  readonly summary: string
  readonly location: string
  readonly nodeId?: string
  readonly edgeId?: string
  readonly fieldKey?: string
  readonly type: ValidationError["type"]
}

type ZodIssueLike = {
  readonly path?: readonly unknown[]
  readonly message?: unknown
}

const FIELD_MESSAGES: Record<string, string> = {
  projectId: "请选择项目，或设置工作流默认项目。",
  workingDirectory: "请检查工作目录。",
  providerId: "请选择供应商，或设置工作流默认供应商。",
  modelTier: "请选择模型，或设置工作流默认模型。",
  prompt: "提示词不能为空。",
  branches: "请至少保留一个分支。",
  defaultBranch: "默认分支需要属于分支列表。",
  template: "输出模板不能为空。",
  variables: "请检查变量绑定。",
  url: "URL 不能为空。",
  script: "脚本不能为空。",
  templatePath: "模板文件不能为空。",
  outputPath: "输出文件不能为空。",
  dataPath: "JSON 文件不能为空。",
  dataJson: "内联 JSON 不能为空。",
  additionalWritableDirs: "可写目录不能为空。",
  images: "图片路径不能为空。",
  configOverrides: "配置覆盖项 key 不能重复或为空。",
}

export function buildWorkflowValidationDisplayItems(
  definition: WorkflowDefinition,
  errors: readonly ValidationError[],
): WorkflowValidationDisplayItem[] {
  return errors.map((error, index) => {
    const node = error.nodeId ? definition.nodes.find((candidate) => candidate.id === error.nodeId) : undefined
    const fieldKey = fieldKeyFromMessage(error.message)
    return {
      id: `${error.nodeId ? `node:${error.nodeId}` : error.edgeId ? `edge:${error.edgeId}` : "workflow"}:${index}`,
      summary: friendlySummary(error, fieldKey),
      location: node?.name ?? (error.edgeId ? "连线" : "工作流"),
      ...(error.nodeId ? { nodeId: error.nodeId } : {}),
      ...(error.edgeId ? { edgeId: error.edgeId } : {}),
      ...(fieldKey ? { fieldKey } : {}),
      type: error.type,
    }
  })
}

function friendlySummary(error: ValidationError, fieldKey: string | undefined): string {
  if (fieldKey && FIELD_MESSAGES[fieldKey]) return FIELD_MESSAGES[fieldKey]

  const branch = /分支[「"]([^」"]+)[」"]/.exec(error.message)?.[1]
  if (branch && /没有连接到下游节点/.test(error.message)) return `分支“${branch}”需要连接到下游节点。`
  if (branch && /路径无法到达结束节点/.test(error.message)) return `分支“${branch}”需要连接到结束节点。`

  const templateVariable = /模板变量[「"]([^」"]+)[」"]未绑定/.exec(error.message)?.[1]
  if (templateVariable) return `模板变量“${templateVariable}”需要添加变量绑定。`

  switch (error.type) {
    case "missing_end_node":
      return "工作流需要一个结束节点。"
    case "multiple_end_nodes":
      return "工作流只能保留一个结束节点。"
    case "cycle":
      return "工作流不能包含循环连接。"
    case "disconnected_node":
      return "节点未连接，无法运行。"
    case "missing_param":
      return ensurePeriod(error.message)
    case "invalid_config":
      return isRawIssueList(error.message) ? "请检查节点配置。" : ensurePeriod(error.message)
    default:
      return ensurePeriod(error.message)
  }
}

function fieldKeyFromMessage(message: string): string | undefined {
  const issues = parseIssueList(message)
  const firstPath = issues[0]?.path?.find((part): part is string => typeof part === "string")
  if (firstPath) return firstPath
  for (const key of Object.keys(FIELD_MESSAGES)) {
    if (message.includes(key)) return key
  }
  return undefined
}

function parseIssueList(message: string): ZodIssueLike[] {
  try {
    const value = JSON.parse(message) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is ZodIssueLike => typeof item === "object" && item !== null)
  } catch {
    return []
  }
}

function isRawIssueList(message: string): boolean {
  return parseIssueList(message).length > 0
}

function ensurePeriod(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return "请检查配置。"
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`
}
