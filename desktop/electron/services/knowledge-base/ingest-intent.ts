const NATURAL_INGEST_PATTERNS = [
  /汲取知识/,
  /提取知识/,
  /入库/,
  /导入.*(来源|资料|知识库|wiki)/,
  /整理.*(知识库|wiki)/,
  /\bingest\b/i,
  /\bprocess\b.*\bsource/i,
  /\badd\b.*\bwiki\b/i,
] as const

export function isKnowledgeBaseIngestIntent(content: string): boolean {
  const trimmed = content.trim()
  if (/^\/wiki\s+ingest(?:\s|$)/i.test(trimmed)) {
    return true
  }
  if (/^\/wiki\s+/i.test(trimmed)) {
    return false
  }
  return NATURAL_INGEST_PATTERNS.some((pattern) => pattern.test(trimmed))
}
