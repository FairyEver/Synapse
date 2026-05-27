import { createHash } from "node:crypto"
import type { UsageModelPriceRule } from "./pricing"

export const CC_SCAN_STATE_VERSION = 1
export const CC_RECENT_DEDUPE_KEYS_LIMIT = 8192

export interface CcStoredScanFile {
  readonly size: number
  readonly mtime_ms: number
  readonly line_count: number
  readonly parse_status: string
  readonly parsed_offset?: number
  readonly parser_version?: number
  readonly pricing_rules_hash?: string
}

export interface CcFileFingerprint {
  readonly filePath: string
  readonly size: number
  readonly mtimeMs: number
}

export type CcScanDecision =
  | { readonly kind: "new" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "legacy-upgrade"; readonly parsedOffset: number }
  | { readonly kind: "append"; readonly startOffset: number }
  | { readonly kind: "replace" }

export interface CcFileParserState {
  readonly recentDedupeKeys: readonly string[]
}

export function classifyCcScanFile({
  existing,
  fingerprint,
  pricingRulesHash: _pricingRulesHash,
}: {
  readonly existing: CcStoredScanFile | undefined
  readonly fingerprint: CcFileFingerprint
  readonly pricingRulesHash: string
}): CcScanDecision {
  if (!existing) return { kind: "new" }
  if (existing.parse_status !== "parsed") return { kind: "replace" }

  const parsedOffset = Number(existing.parsed_offset ?? 0)
  const parserVersion = Number(existing.parser_version ?? 0)
  const sameFingerprint = existing.size === fingerprint.size && existing.mtime_ms === fingerprint.mtimeMs

  if (sameFingerprint && parsedOffset === fingerprint.size && parserVersion === CC_SCAN_STATE_VERSION) {
    return { kind: "unchanged" }
  }
  if (sameFingerprint && (parsedOffset <= 0 || parserVersion !== CC_SCAN_STATE_VERSION)) {
    return { kind: "legacy-upgrade", parsedOffset: fingerprint.size }
  }
  if (fingerprint.size > existing.size) {
    const startOffset = parsedOffset > 0 && parsedOffset <= fingerprint.size ? parsedOffset : existing.size
    if (startOffset > 0 && startOffset <= fingerprint.size) {
      return { kind: "append", startOffset }
    }
  }
  return { kind: "replace" }
}

export function hashUsagePriceRules(rules: readonly UsageModelPriceRule[]): string {
  const payload = rules
    .map((rule) => ({
      id: rule.id,
      modelPattern: rule.modelPattern,
      inputPer1M: rule.inputPer1M,
      outputPer1M: rule.outputPer1M,
      cacheReadPer1M: rule.cacheReadPer1M,
      cacheWritePer1M: rule.cacheWritePer1M,
      reasoningPer1M: rule.reasoningPer1M,
      currency: rule.currency,
      enabled: rule.enabled,
      source: rule.source,
      sortIndex: rule.sortIndex,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export function parseCcFileParserState(raw: string | null | undefined): CcFileParserState {
  if (!raw) return { recentDedupeKeys: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<CcFileParserState>
    return { recentDedupeKeys: normalizeRecentDedupeKeys(parsed.recentDedupeKeys) }
  } catch {
    return { recentDedupeKeys: [] }
  }
}

export function serializeCcFileParserState(state: CcFileParserState): string {
  return JSON.stringify({ recentDedupeKeys: normalizeRecentDedupeKeys(state.recentDedupeKeys) })
}

export function mergeUniqueBuckets(...groups: readonly (readonly string[] | undefined)[]): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))].sort()
}

function normalizeRecentDedupeKeys(value: unknown): string[] {
  const keys = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  return keys.slice(-CC_RECENT_DEDUPE_KEYS_LIMIT)
}
