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

const FORCE_INGEST_PATTERNS = [
  /--force(?:\s|$)/i,
  /强制.*(汲取|提取|导入|入库|整理)/,
  /(重新|重建|全量).*(汲取|提取|导入|入库|整理|知识库|wiki)/,
  /(汲取|提取|导入|入库|整理).*(强制|重新|重建|全量)/,
  /\b(force|forced|reingest|re-ingest)\b/i,
] as const

const NEGATED_FORCE_PATTERN = /(不要|不用|别|不必)\s*(强制|重新|重建|全量)/

export function isKnowledgeBaseIngestIntent(content: string): boolean {
  return isKnowledgeBaseSourceIngestIntent(content) || isKnowledgeBaseResearchWriteIntent(content)
}

export function isKnowledgeBaseSourceIngestIntent(content: string): boolean {
  const trimmed = content.trim()
  if (/^\/wiki\s+ingest(?:\s|$)/i.test(trimmed)) {
    return true
  }
  if (/^\/wiki\s+/i.test(trimmed)) {
    return false
  }
  return NATURAL_INGEST_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function isKnowledgeBaseForceIngestIntent(content: string): boolean {
  const trimmed = content.trim()
  if (/^\/wiki\s+ingest(?:\s|$)/i.test(trimmed)) {
    return FORCE_INGEST_PATTERNS.some((pattern) => pattern.test(trimmed))
  }
  if (/^\/wiki\s+/i.test(trimmed) || NEGATED_FORCE_PATTERN.test(trimmed)) {
    return false
  }
  return isKnowledgeBaseSourceIngestIntent(trimmed)
    && FORCE_INGEST_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function isKnowledgeBaseResearchWriteIntent(content: string): boolean {
  return /^\/wiki\s+research\s+\S/i.test(content.trim())
}
