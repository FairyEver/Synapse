import path from "node:path"

export interface KnowledgeBaseWorkerToolPolicyContext {
  readonly targetPage: string
}

export interface KnowledgeBaseWorkerToolPolicyResult {
  readonly behavior: "deny"
  readonly message: string
}

export function evaluateKnowledgeBaseWorkerToolPolicy(
  toolName: string,
  input: Record<string, unknown>,
  context: KnowledgeBaseWorkerToolPolicyContext,
): KnowledgeBaseWorkerToolPolicyResult | undefined {
  if (!isWriteTool(toolName)) return undefined
  const writePath = typeof input.file_path === "string" ? input.file_path : undefined
  if (!writePath) return deny()
  const normalized = normalizeToolPath(writePath)
  if (!normalized) return deny()
  if (normalized !== normalizeToolPath(context.targetPage)) return deny()
  return undefined
}

function isWriteTool(toolName: string): boolean {
  return ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)
}

function deny(): KnowledgeBaseWorkerToolPolicyResult {
  return {
    behavior: "deny",
    message: "Knowledge Base ingest workers may write only their assigned wiki/sources page.",
  }
}

function normalizeToolPath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").replace(/^\.?\//, "")
  if (normalized.includes("\0")) return null
  if (path.posix.isAbsolute(normalized)) return null
  if (normalized.split("/").includes("..")) return null
  return normalized
}
