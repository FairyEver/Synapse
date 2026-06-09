import { describe, expect, it } from "vitest"
import { hashModelPriceRules, type ModelPriceRule } from "../../model-price"
import {
  CC_SCAN_STATE_VERSION,
  classifyCcScanFile,
  hashUsagePriceRules,
  parseCcFileParserState,
  serializeCcFileParserState,
} from "../cc-scan-state"

const scanPriceRulesFixture: readonly ModelPriceRule[] = [
  {
    id: "mpr_111111111111",
    modelPattern: "fixture-model-a",
    inputPer1M: 1,
    outputPer1M: 2,
    cacheReadPer1M: 0,
    cacheWritePer1M: 0,
    reasoningPer1M: 2,
    currency: "CNY",
    enabled: true,
    source: "user",
    sortIndex: 0,
    updatedAt: "2026-06-03T00:00:00.000Z",
  },
  {
    id: "mpr_222222222222",
    modelPattern: "fixture-model-b",
    inputPer1M: 3,
    outputPer1M: 4,
    cacheReadPer1M: 0,
    cacheWritePer1M: 0,
    reasoningPer1M: 4,
    currency: "CNY",
    enabled: true,
    source: "user",
    sortIndex: 1,
    updatedAt: "2026-06-03T00:00:00.000Z",
  },
]

describe("CC scan state", () => {
  it("classifies exact fingerprint matches as unchanged", () => {
    expect(classifyCcScanFile({
      existing: {
        size: 10,
        mtime_ms: 20,
        line_count: 1,
        parse_status: "parsed",
        parsed_offset: 10,
        parser_version: CC_SCAN_STATE_VERSION,
        pricing_rules_hash: "price",
      },
      fingerprint: { filePath: "/tmp/a.jsonl", size: 10, mtimeMs: 20 },
      pricingRulesHash: "price",
    }).kind).toBe("unchanged")
  })

  it("classifies unchanged files as replace when pricing rules changed", () => {
    expect(classifyCcScanFile({
      existing: {
        size: 10,
        mtime_ms: 20,
        line_count: 1,
        parse_status: "parsed",
        parsed_offset: 10,
        parser_version: CC_SCAN_STATE_VERSION,
        pricing_rules_hash: "old-price",
      },
      fingerprint: { filePath: "/tmp/a.jsonl", size: 10, mtimeMs: 20 },
      pricingRulesHash: "new-price",
    })).toEqual({ kind: "replace" })
  })

  it("upgrades legacy parsed rows without reparsing unchanged files", () => {
    expect(classifyCcScanFile({
      existing: {
        size: 10,
        mtime_ms: 20,
        line_count: 1,
        parse_status: "parsed",
        parsed_offset: 0,
        parser_version: 0,
        pricing_rules_hash: "",
      },
      fingerprint: { filePath: "/tmp/a.jsonl", size: 10, mtimeMs: 20 },
      pricingRulesHash: "new-price",
    })).toEqual({ kind: "legacy-upgrade", parsedOffset: 10 })
  })

  it("classifies growing parsed files as append", () => {
    expect(classifyCcScanFile({
      existing: {
        size: 10,
        mtime_ms: 20,
        line_count: 1,
        parse_status: "parsed",
        parsed_offset: 10,
        parser_version: CC_SCAN_STATE_VERSION,
        pricing_rules_hash: "old-price",
      },
      fingerprint: { filePath: "/tmp/a.jsonl", size: 30, mtimeMs: 25 },
      pricingRulesHash: "new-price",
    })).toEqual({ kind: "append", startOffset: 10 })
  })

  it("classifies growing legacy parsed files as append from the previous size", () => {
    expect(classifyCcScanFile({
      existing: {
        size: 10,
        mtime_ms: 20,
        line_count: 1,
        parse_status: "parsed",
        parsed_offset: 0,
        parser_version: 0,
        pricing_rules_hash: "",
      },
      fingerprint: { filePath: "/tmp/a.jsonl", size: 30, mtimeMs: 25 },
      pricingRulesHash: "new-price",
    })).toEqual({ kind: "append", startOffset: 10 })
  })

  it("classifies shrunk files as replace", () => {
    expect(classifyCcScanFile({
      existing: {
        size: 30,
        mtime_ms: 20,
        line_count: 3,
        parse_status: "parsed",
        parsed_offset: 30,
        parser_version: CC_SCAN_STATE_VERSION,
        pricing_rules_hash: "price",
      },
      fingerprint: { filePath: "/tmp/a.jsonl", size: 10, mtimeMs: 25 },
      pricingRulesHash: "price",
    }).kind).toBe("replace")
  })

  it("hashes pricing rules stably regardless of input order", () => {
    const first = hashUsagePriceRules([
      { id: "b", modelPattern: "b", inputPer1M: 2, outputPer1M: 0, cacheReadPer1M: 0, cacheWritePer1M: 0, reasoningPer1M: 0, currency: "CNY", enabled: true, source: "user", sortIndex: 2, updatedAt: "date-b" },
      { id: "a", modelPattern: "a", inputPer1M: 1, outputPer1M: 0, cacheReadPer1M: 0, cacheWritePer1M: 0, reasoningPer1M: 0, currency: "CNY", enabled: true, source: "user", sortIndex: 1, updatedAt: "now" },
    ])
    const second = hashUsagePriceRules([
      { id: "a", modelPattern: "a", inputPer1M: 1, outputPer1M: 0, cacheReadPer1M: 0, cacheWritePer1M: 0, reasoningPer1M: 0, currency: "CNY", enabled: true, source: "user", sortIndex: 1, updatedAt: "changed" },
      { id: "b", modelPattern: "b", inputPer1M: 2, outputPer1M: 0, cacheReadPer1M: 0, cacheWritePer1M: 0, reasoningPer1M: 0, currency: "CNY", enabled: true, source: "user", sortIndex: 2, updatedAt: "changed" },
    ])

    expect(first).toBe(second)
  })

  it("uses the model-price rule hash for scan replacement decisions", () => {
    const oldHash = hashModelPriceRules(scanPriceRulesFixture)
    const newHash = hashModelPriceRules([
      ...scanPriceRulesFixture,
      { ...scanPriceRulesFixture[0], id: "mpr_333333333333", modelPattern: "copy-model", sortIndex: 999 },
    ])

    expect(oldHash).not.toBe(newHash)
  })

  it("delegates pricing hash semantics to model-price", () => {
    expect(hashUsagePriceRules(scanPriceRulesFixture)).toBe(hashModelPriceRules(scanPriceRulesFixture))
  })

  it("round-trips bounded parser state", () => {
    const state = parseCcFileParserState(serializeCcFileParserState({
      recentDedupeKeys: Array.from({ length: 9000 }, (_, index) => `key-${index}`),
    }))

    expect(state.recentDedupeKeys).toHaveLength(8192)
    expect(state.recentDedupeKeys[0]).toBe("key-808")
    expect(state.recentDedupeKeys.at(-1)).toBe("key-8999")
  })
})
