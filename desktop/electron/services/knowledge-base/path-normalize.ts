export function normalizeKnowledgeBaseRelativePath(value: string): string {
  return value.replace(/[\\/]/g, "/")
}

export function normalizeKnowledgeBaseRawPath(value: string): string {
  return normalizeKnowledgeBaseRelativePath(value).replace(/^\/+/, "").replace(/\/+$/g, "")
}
