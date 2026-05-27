# CC Usage Fast Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Synapse's Claude Code usage refresh path with an offset-based incremental parser inspired by tokenusage.

**Architecture:** Keep the existing usage-analysis IPC, SQLite ledger, worker refresh boundary, and renderer UI. Add CC scan state to SQLite, parse changed Claude Code JSONL files from byte offsets, skip irrelevant lines before JSON decoding, and rebuild only affected daily/hourly aggregate buckets. Codex refresh remains on the current generic path.

**Tech Stack:** Electron main process, TypeScript, Node `fs` streams, Node `crypto`, `node:sqlite` `DatabaseSync`, Vitest.

---

## File Map

- Modify `desktop/electron/services/usage-analysis/db-schema.ts`
  - Add additive CC scan-state columns and `cc_scan_file_state`.
- Create `desktop/electron/services/usage-analysis/cc-scan-state.ts`
  - Own CC scan-state constants, pure classification helpers, pricing-rule hash, dedupe-state serialization, and affected bucket helpers.
- Modify `desktop/electron/services/usage-analysis/cc-parser.ts`
  - Add byte-offset segment parser and keep `parseClaudeUsageFile()` as a replace-mode wrapper.
- Modify `desktop/electron/services/usage-analysis/cc-service.ts`
  - Route CC refresh through the new scan-state pipeline, keep Codex on the existing generic refresh path, and add partial aggregate rebuild.
- Modify `desktop/electron/services/usage-analysis/__tests__/db.test.ts`
  - Cover new schema columns/table.
- Create `desktop/electron/services/usage-analysis/__tests__/cc-scan-state.test.ts`
  - Cover pure classification and hashing behavior.
- Modify `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`
  - Cover offset parsing, line fast-path, dedupe, privacy, and stable fallback ids.
- Modify `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`
  - Cover append refresh, legacy metadata upgrade, replace mode, partial aggregate rebuild, and ledger cost stability.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add one user-facing note under `功能优化`.

## Task 1: Schema And Scan-State Utilities

**Files:**
- Modify: `desktop/electron/services/usage-analysis/db-schema.ts`
- Create: `desktop/electron/services/usage-analysis/cc-scan-state.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/db.test.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/cc-scan-state.test.ts`

- [ ] **Step 1: Add schema tests for CC scan state**

Append these tests to `desktop/electron/services/usage-analysis/__tests__/db.test.ts`:

```ts
it("adds CC scan offset state columns", () => {
  const db = new DatabaseSync(":memory:")
  try {
    initUsageAnalysisSchema(db)

    const columns = db.prepare("PRAGMA table_info(cc_scan_files)").all() as { name: string }[]
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "parsed_offset",
      "parser_version",
      "pricing_rules_hash",
      "first_seen_at",
      "last_changed_at",
    ]))
  } finally {
    db.close()
  }
})

it("creates CC scan file parser state table", () => {
  const db = new DatabaseSync(":memory:")
  try {
    initUsageAnalysisSchema(db)

    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cc_scan_file_state'").get()
    expect(row).toEqual({ name: "cc_scan_file_state" })
  } finally {
    db.close()
  }
})
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/db.test.ts
```

Expected: FAIL because `parsed_offset` and `cc_scan_file_state` do not exist yet.

- [ ] **Step 3: Add additive schema migration**

In `desktop/electron/services/usage-analysis/db-schema.ts`, inside the loop over `["cc", "cx"]`, keep existing table creation intact. After the existing `ensureColumn(database, `${prefix}_scan_files`, "line_count", ...)` line, add CC-only columns:

```ts
    if (prefix === "cc") {
      ensureColumn(database, "cc_scan_files", "parsed_offset", "INTEGER NOT NULL DEFAULT 0")
      ensureColumn(database, "cc_scan_files", "parser_version", "INTEGER NOT NULL DEFAULT 0")
      ensureColumn(database, "cc_scan_files", "pricing_rules_hash", "TEXT NOT NULL DEFAULT ''")
      ensureColumn(database, "cc_scan_files", "first_seen_at", "TEXT NOT NULL DEFAULT ''")
      ensureColumn(database, "cc_scan_files", "last_changed_at", "TEXT NOT NULL DEFAULT ''")
    }
```

After the existing `cx_task_events` table creation block, create the parser-state table:

```ts
  database.exec(`
    CREATE TABLE IF NOT EXISTS cc_scan_file_state (
      file_path TEXT PRIMARY KEY,
      state_json TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `)
```

- [ ] **Step 4: Run schema tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/db.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add pure scan-state tests**

Create `desktop/electron/services/usage-analysis/__tests__/cc-scan-state.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  CC_SCAN_STATE_VERSION,
  classifyCcScanFile,
  hashUsagePriceRules,
  parseCcFileParserState,
  serializeCcFileParserState,
} from "../cc-scan-state"

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

  it("round-trips bounded parser state", () => {
    const state = parseCcFileParserState(serializeCcFileParserState({
      recentDedupeKeys: Array.from({ length: 9000 }, (_, index) => `key-${index}`),
    }))

    expect(state.recentDedupeKeys).toHaveLength(8192)
    expect(state.recentDedupeKeys[0]).toBe("key-808")
    expect(state.recentDedupeKeys.at(-1)).toBe("key-8999")
  })
})
```

- [ ] **Step 6: Run scan-state tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-scan-state.test.ts
```

Expected: FAIL because `cc-scan-state.ts` does not exist.

- [ ] **Step 7: Implement scan-state utilities**

Create `desktop/electron/services/usage-analysis/cc-scan-state.ts`:

```ts
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
    return {
      recentDedupeKeys: normalizeRecentDedupeKeys(parsed.recentDedupeKeys),
    }
  } catch {
    return { recentDedupeKeys: [] }
  }
}

export function serializeCcFileParserState(state: CcFileParserState): string {
  return JSON.stringify({
    recentDedupeKeys: normalizeRecentDedupeKeys(state.recentDedupeKeys),
  })
}

export function mergeUniqueBuckets(...groups: readonly (readonly string[] | undefined)[]): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))].sort()
}

function normalizeRecentDedupeKeys(value: unknown): string[] {
  const keys = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []
  return keys.slice(-CC_RECENT_DEDUPE_KEYS_LIMIT)
}
```

- [ ] **Step 8: Run scan-state tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-scan-state.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit schema and scan-state utilities**

```bash
git add desktop/electron/services/usage-analysis/db-schema.ts \
  desktop/electron/services/usage-analysis/cc-scan-state.ts \
  desktop/electron/services/usage-analysis/__tests__/db.test.ts \
  desktop/electron/services/usage-analysis/__tests__/cc-scan-state.test.ts
git commit -m "feat: add cc usage scan state"
```

## Task 2: Offset-Based Claude Code Parser

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-parser.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`

- [ ] **Step 1: Add parser tests for byte offsets and privacy**

Append these tests to `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`:

```ts
  it("parses only the appended segment from a byte offset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      const first = `${JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-19T01:00:01.000Z",
        message: {
          id: "msg-1",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      })}\n`
      fs.writeFileSync(file, first)
      const offset = Buffer.byteLength(first)
      fs.appendFileSync(file, `${JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-19T02:00:01.000Z",
        message: {
          id: "msg-2",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      })}\n`)

      const parsed = await parseClaudeUsageFileSegment({
        filePath: file,
        startOffset: offset,
        mode: "append",
        previousState: { recentDedupeKeys: [] },
      })

      expect(parsed.usageEvents).toHaveLength(1)
      expect(parsed.usageEvents[0]).toMatchObject({
        id: "session:usage:msg-2",
        inputTokens: 10,
        outputTokens: 5,
      })
      expect(parsed.nextOffset).toBe(fs.statSync(file).size)
      expect(parsed.affectedDates).toEqual(["2026-05-19"])
      expect(parsed.affectedHours).toEqual(["2026-05-19 02"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("skips unrelated JSON lines before JSON.parse", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      const lines = [
        JSON.stringify({ type: "summary", summary: "secret summary" }),
        JSON.stringify({ type: "system", content: "secret system" }),
        JSON.stringify({
          type: "assistant",
          sessionId: "session",
          timestamp: "2026-05-19T01:00:01.000Z",
          message: {
            id: "msg-1",
            role: "assistant",
            model: "claude-opus-4.6",
            usage: { input_tokens: 1, output_tokens: 2 },
          },
        }),
      ]
      fs.writeFileSync(file, `${lines.join("\n")}\n`)
      const parseSpy = vi.spyOn(JSON, "parse")

      const parsed = await parseClaudeUsageFileSegment({ filePath: file, startOffset: 0, mode: "replace" })

      expect(parsed.usageEvents).toHaveLength(1)
      expect(parseSpy).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(parsed)).not.toContain("secret summary")
      expect(JSON.stringify(parsed)).not.toContain("secret system")
      parseSpy.mockRestore()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("dedupes appended assistant usage by message and request id", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      const duplicate = {
        type: "assistant",
        sessionId: "session",
        requestId: "req-1",
        timestamp: "2026-05-19T01:00:01.000Z",
        message: {
          id: "msg-1",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      }
      fs.writeFileSync(file, `${JSON.stringify(duplicate)}\n`)

      const parsed = await parseClaudeUsageFileSegment({
        filePath: file,
        startOffset: 0,
        mode: "replace",
        previousState: { recentDedupeKeys: ["msg-1:req-1"] },
      })

      expect(parsed.usageEvents).toHaveLength(0)
      expect(parsed.parserState.recentDedupeKeys).toContain("msg-1:req-1")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
```

Add `vi` and `parseClaudeUsageFileSegment` imports at the top:

```ts
import { describe, expect, it, vi } from "vitest"
import { parseClaudeUsageFile, parseClaudeUsageFileSegment } from "../cc-parser"
```

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts
```

Expected: FAIL because `parseClaudeUsageFileSegment` does not exist and the current parser calls `JSON.parse` for skipped lines.

- [ ] **Step 3: Add parser types and byte-line reader**

In `desktop/electron/services/usage-analysis/cc-parser.ts`, add these interfaces below `UsageParseOptions`:

```ts
export type ClaudeUsageParseMode = "append" | "replace"

export interface ClaudeUsageParserState {
  readonly recentDedupeKeys: readonly string[]
}

export interface ClaudeUsageSegmentParseOptions extends UsageParseOptions {
  readonly filePath: string
  readonly startOffset: number
  readonly mode: ClaudeUsageParseMode
  readonly previousState?: ClaudeUsageParserState
}

export interface ParsedUsageSegment extends ParsedUsageFile {
  readonly nextOffset: number
  readonly affectedDates: string[]
  readonly affectedHours: string[]
  readonly parserState: ClaudeUsageParserState
}
```

Add this helper near the parser:

```ts
async function readCompleteJsonlLines(
  filePath: string,
  startOffset: number,
  onLine: (line: string, lineStartOffset: number, lineEndOffset: number) => void,
): Promise<number> {
  let pending = Buffer.alloc(0)
  let bufferStartOffset = startOffset
  const stream = fs.createReadStream(filePath, { start: startOffset })

  for await (const chunk of stream) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const buffer = pending.length > 0 ? Buffer.concat([pending, chunkBuffer]) : chunkBuffer
    let lineStart = 0

    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 10) continue
      const rawLine = buffer.subarray(lineStart, index)
      const line = rawLine.at(-1) === 13 ? rawLine.subarray(0, -1).toString("utf8") : rawLine.toString("utf8")
      onLine(line, bufferStartOffset + lineStart, bufferStartOffset + index + 1)
      lineStart = index + 1
    }

    pending = buffer.subarray(lineStart)
    bufferStartOffset += lineStart
  }

  return bufferStartOffset
}
```

- [ ] **Step 4: Add fast line classifiers and dedupe state**

Add these helpers in `cc-parser.ts`:

```ts
function shouldParseClaudeLine(line: string): boolean {
  return line.includes('"type":"assistant"') ||
    line.includes('"type": "assistant"') ||
    line.includes('"type":"user"') ||
    line.includes('"type": "user"')
}

function shouldParseClaudeAssistantLine(line: string): boolean {
  return line.includes('"type":"assistant"') || line.includes('"type": "assistant"')
}

function makeClaudeDedupeState(seed: readonly string[] = []): { insert: (key: string) => boolean; snapshot: () => string[] } {
  const seen = new Set<string>()
  const order: string[] = []
  const insert = (key: string) => {
    if (seen.has(key)) return false
    seen.add(key)
    order.push(key)
    while (order.length > 8192) {
      const old = order.shift()
      if (old) seen.delete(old)
    }
    return true
  }
  seed.forEach(insert)
  return { insert, snapshot: () => [...order] }
}
```

- [ ] **Step 5: Implement `parseClaudeUsageFileSegment`**

In `cc-parser.ts`, add the new exported function and keep the old function as a wrapper:

```ts
export async function parseClaudeUsageFile(filePath: string, options: UsageParseOptions = {}): Promise<ParsedUsageFile> {
  return parseClaudeUsageFileSegment({
    filePath,
    startOffset: 0,
    mode: "replace",
    priceRules: options.priceRules,
  })
}

export async function parseClaudeUsageFileSegment(options: ClaudeUsageSegmentParseOptions): Promise<ParsedUsageSegment> {
  const fallbackTs = fs.statSync(options.filePath).mtimeMs
  const fallbackSessionId = path.basename(options.filePath, ".jsonl")
  const workspace = workspaceFromClaudePath(options.filePath)
  const usageEvents = new Map<string, ParsedUsageEvent>()
  const toolEvents = new Map<string, ParsedToolEvent>()
  const sessionIds = new Set<string>()
  const models = new Set<string>()
  const affectedDates = new Set<string>()
  const affectedHours = new Set<string>()
  const dedupe = makeClaudeDedupeState(options.previousState?.recentDedupeKeys)
  let conversationCount = 0
  let startedAt = ""
  let endedAt = ""
  let lineCount = 0

  const nextOffset = await readCompleteJsonlLines(options.filePath, options.startOffset, (line, lineStartOffset, lineEndOffset) => {
    lineCount += 1
    if (!line.trim() || !shouldParseClaudeLine(line)) return

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    const timestampMs = parseTimestamp(raw.timestamp, fallbackTs)
    const iso = new Date(timestampMs).toISOString()
    const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : fallbackSessionId
    sessionIds.add(sessionId)
    if (!startedAt || iso < startedAt) startedAt = iso
    if (!endedAt || iso > endedAt) endedAt = iso

    if (raw.type === "user") {
      conversationCount += 1
      return
    }
    if (!shouldParseClaudeAssistantLine(line)) return

    const message = asRecord(raw.message)
    if (!message) return
    const content = Array.isArray(message.content) ? message.content : []
    const messageId = typeof message.id === "string" && message.id ? message.id : ""
    const requestId = typeof raw.requestId === "string" ? raw.requestId : typeof raw.request_id === "string" ? raw.request_id : ""
    if (messageId && requestId && !dedupe.insert(`${messageId}:${requestId}`)) return

    content.forEach((block, index) => {
      const value = asRecord(block)
      if (value?.type !== "tool_use") return
      const toolName = typeof value.name === "string" ? value.name : "unknown"
      const blockId = typeof value.id === "string" && value.id ? value.id : String(index)
      const idBase = messageId || `offset-${lineStartOffset}`
      const id = `${sessionId}:tool:${idBase}:${blockId}`
      const date = localDateKey(timestampMs)
      const hour = localHourKey(timestampMs)
      affectedDates.add(date)
      affectedHours.add(hour)
      toolEvents.set(id, {
        id,
        sessionId,
        timestampMs,
        date,
        hour,
        workspaceKey: workspace.key,
        toolName,
        category: "tool_use",
        status: "",
        durationMs: null,
      })
    })

    const usage = asRecord(message.usage)
    const model = typeof message.model === "string" ? message.model : ""
    if (!usage || !model) return
    models.add(model)

    const tokens = {
      input: asNumber(usage.input_tokens),
      output: asNumber(usage.output_tokens),
      cacheRead: asNumber(usage.cache_read_input_tokens),
      cacheWrite: asNumber(usage.cache_creation_input_tokens),
      reasoning: extractReasoningTokens(content),
    }
    if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning <= 0) return

    const date = localDateKey(timestampMs)
    const hour = localHourKey(timestampMs)
    const cost = estimateUsageCost(model, tokens, options.priceRules)
    const eventId = `${sessionId}:usage:${messageId || `offset-${lineStartOffset}`}`
    affectedDates.add(date)
    affectedHours.add(hour)
    usageEvents.set(eventId, {
      id: eventId,
      sessionId,
      timestampMs,
      date,
      hour,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      model,
      provider: "anthropic",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      reasoningTokens: tokens.reasoning,
      costInput: cost.input,
      costOutput: cost.output,
      costCacheRead: cost.cacheRead,
      costCacheWrite: cost.cacheWrite,
      costReasoning: cost.reasoning,
      totalCost: cost.total,
      priceKnown: cost.priceKnown,
    })

    void lineEndOffset
  })

  const usageRows = [...usageEvents.values()]
  const toolRows = [...toolEvents.values()]
  if (sessionIds.size === 0 && options.mode === "replace") sessionIds.add(fallbackSessionId)

  return {
    sessions: [...sessionIds].map((sessionId) => ({
      sessionId,
      filePath: options.filePath,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      provider: "anthropic",
      source: "claude-code",
      cliVersion: "",
      startedAt,
      endedAt,
      modelSummary: [...models].join(", "),
      requestCount: usageRows.filter((event) => event.sessionId === sessionId).length,
      conversationCount,
      toolCallCount: toolRows.filter((event) => event.sessionId === sessionId).length,
    })),
    usageEvents: usageRows,
    toolEvents: toolRows,
    lineCount,
    nextOffset,
    affectedDates: [...affectedDates].sort(),
    affectedHours: [...affectedHours].sort(),
    parserState: { recentDedupeKeys: dedupe.snapshot() },
  }
}
```

- [ ] **Step 6: Remove the old readline implementation**

In `cc-parser.ts`, remove the old body of `parseClaudeUsageFile()` and the `readline` import:

```ts
import readline from "node:readline"
```

Expected: `cc-parser.ts` should no longer import `readline`.

- [ ] **Step 7: Run parser tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit parser segment**

```bash
git add desktop/electron/services/usage-analysis/cc-parser.ts \
  desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts
git commit -m "feat: parse cc usage from byte offsets"
```

## Task 3: CC Refresh Classification And Persistence

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] **Step 1: Add append refresh ledger test**

Append this test to `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`:

```ts
  it("parses only appended CC usage and preserves historical event costs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    service.savePricingRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])
    fs.appendFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        id: "msg-2",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 1, usageEvents: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_usage_events").get()).toEqual({ count: 2 })
    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events ORDER BY timestamp_ms ASC").all()).toEqual([
      { total_cost: 0, price_known: 0 },
      { total_cost: 14.4, price_known: 1 },
    ])
    const scan = db.prepare("SELECT parsed_offset, size, parser_version FROM cc_scan_files WHERE file_path = ?").get(file) as { parsed_offset: number; size: number; parser_version: number }
    expect(scan.parsed_offset).toBe(scan.size)
    expect(scan.parser_version).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Add legacy metadata upgrade test**

Append this test to `reports.test.ts`:

```ts
  it("upgrades legacy parsed CC scan rows without reparsing historical events", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("UPDATE cc_scan_files SET parsed_offset = 0, parser_version = 0, pricing_rules_hash = ''")
    service.savePricingRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])

    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 0, skippedFiles: 1, usageEvents: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_usage_events").get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events").get()).toEqual({ total_cost: 0, price_known: 0 })
    const scan = db.prepare("SELECT parsed_offset, size, parser_version FROM cc_scan_files WHERE file_path = ?").get(file) as { parsed_offset: number; size: number; parser_version: number }
    expect(scan.parsed_offset).toBe(scan.size)
    expect(scan.parser_version).toBeGreaterThan(0)
  })
```

- [ ] **Step 3: Run report tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: FAIL because CC refresh still uses `startLine` and does not write parser offset state.

- [ ] **Step 4: Import new CC parser and scan-state utilities**

In `desktop/electron/services/usage-analysis/cc-service.ts`, change the imports near the top to include:

```ts
import {
  parseClaudeUsageFile,
  parseClaudeUsageFileSegment,
  type ClaudeUsageParserState,
  type ParsedUsageSegment,
  type ParsedUsageFile,
} from "./cc-parser"
import {
  CC_SCAN_STATE_VERSION,
  classifyCcScanFile,
  hashUsagePriceRules,
  parseCcFileParserState,
  serializeCcFileParserState,
  mergeUniqueBuckets,
  type CcStoredScanFile,
} from "./cc-scan-state"
```

Keep `parseClaudeUsageFile` because existing parser tests and the replace wrapper use it.

- [ ] **Step 5: Extend scan file row types**

In `cc-service.ts`, replace `ScanFileRow` with:

```ts
interface ScanFileRow extends CcStoredScanFile {
  readonly size: number
  readonly mtime_ms: number
  readonly line_count: number
  readonly parse_status: string
  readonly parsed_offset: number
  readonly parser_version: number
  readonly pricing_rules_hash: string
}

interface ScanFileStateRow {
  readonly state_json: string
}
```

Extend `ParsedFileWithTasks`:

```ts
interface ParsedFileWithTasks extends ParsedUsageFile {
  readonly taskEvents?: readonly ParsedTaskLike[]
  readonly nextOffset?: number
  readonly affectedDates?: readonly string[]
  readonly affectedHours?: readonly string[]
  readonly parserState?: ClaudeUsageParserState
}
```

- [ ] **Step 6: Route `CcUsageAnalysisService.refresh()` to a CC-specific function**

Replace the `refresh()` method in `CcUsageAnalysisService`:

```ts
  async refresh(): Promise<UsageRefreshResult> {
    return refreshCcUsageNamespace({
      db: this.db,
      roots: this.roots,
    })
  }
```

Keep `refreshUsageNamespace()` unchanged for Codex in this task.

- [ ] **Step 7: Add parser-state load/save helpers**

In `cc-service.ts`, above `refreshUsageNamespace()`, add:

```ts
function loadCcParserState(db: DatabaseSync, filePath: string): ClaudeUsageParserState {
  const row = db.prepare("SELECT state_json FROM cc_scan_file_state WHERE file_path = ?").get(filePath) as ScanFileStateRow | undefined
  return parseCcFileParserState(row?.state_json)
}

function saveCcParserState(db: DatabaseSync, filePath: string, state: ClaudeUsageParserState): void {
  db.prepare(`
    INSERT INTO cc_scan_file_state (file_path, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(filePath, serializeCcFileParserState(state), new Date().toISOString())
}
```

- [ ] **Step 8: Add CC-specific refresh loop**

In `cc-service.ts`, above `refreshUsageNamespace()`, add:

```ts
async function refreshCcUsageNamespace(options: {
  readonly db: DatabaseSync
  readonly roots: string[]
}): Promise<UsageRefreshResult> {
  const startedAt = Date.now()
  const files = collectJsonlFiles(options.roots)
  const priceRules = listUsagePriceRules(options.db)
  const pricingRulesHash = hashUsagePriceRules(priceRules)
  const pricedAt = new Date().toISOString()
  let parsedFiles = 0
  let skippedFiles = 0
  let failedFiles = 0
  let usageEvents = 0
  let toolEvents = 0
  const affectedDates: string[] = []
  const affectedHours: string[] = []

  for (const file of files) {
    let fp: ReturnType<typeof fingerprintFile> | null = null
    try {
      fp = fingerprintFile(file)
      const existing = options.db.prepare(`
        SELECT size, mtime_ms, line_count, parse_status, parsed_offset, parser_version, pricing_rules_hash
        FROM cc_scan_files
        WHERE file_path = ?
      `).get(file) as ScanFileRow | undefined
      const decision = classifyCcScanFile({ existing, fingerprint: fp, pricingRulesHash })

      if (decision.kind === "unchanged") {
        skippedFiles += 1
        continue
      }

      if (decision.kind === "legacy-upgrade") {
        await runWithUsageDatabaseLockRetry(() => {
          markScanFile(options.db, "cc", file, fp.size, fp.mtimeMs, existing?.line_count ?? 0, {
            parsedOffset: decision.parsedOffset,
            parserVersion: CC_SCAN_STATE_VERSION,
            pricingRulesHash,
          })
        })
        skippedFiles += 1
        continue
      }

      const mode = decision.kind === "append" ? "append" : "replace"
      const parsed = await parseClaudeUsageFileSegment({
        filePath: file,
        startOffset: decision.kind === "append" ? decision.startOffset : 0,
        mode,
        previousState: mode === "append" ? loadCcParserState(options.db, file) : { recentDedupeKeys: [] },
        priceRules,
      })
      if (parsed.usageEvents.length === 0 && parsed.toolEvents.length === 0 && mode === "append") {
        await runWithUsageDatabaseLockRetry(() => {
          markScanFile(options.db, "cc", file, fp.size, fp.mtimeMs, (existing?.line_count ?? 0) + parsed.lineCount, {
            parsedOffset: parsed.nextOffset,
            parserVersion: CC_SCAN_STATE_VERSION,
            pricingRulesHash,
          })
          saveCcParserState(options.db, file, parsed.parserState)
        })
        skippedFiles += 1
        continue
      }

      await runWithUsageDatabaseLockRetry(() => {
        const oldBuckets = mode === "replace" ? queryBucketsForFile(options.db, "cc", file) : { dates: [], hours: [] }
        persistParsedFile(options.db, "cc", file, fp.size, fp.mtimeMs, parsed, mode, pricedAt, {
          parsedOffset: parsed.nextOffset,
          parserVersion: CC_SCAN_STATE_VERSION,
          pricingRulesHash,
        })
        saveCcParserState(options.db, file, parsed.parserState)
        affectedDates.push(...mergeUniqueBuckets(oldBuckets.dates, parsed.affectedDates))
        affectedHours.push(...mergeUniqueBuckets(oldBuckets.hours, parsed.affectedHours))
      })
      parsedFiles += 1
      usageEvents += parsed.usageEvents.length
      toolEvents += parsed.toolEvents.length
    } catch (error) {
      failedFiles += 1
      const errorKind = error instanceof Error ? error.name : "ParseError"
      await runWithUsageDatabaseLockRetry(() => {
        markFailedScanFile(options.db, "cc", file, fp?.size ?? 0, fp?.mtimeMs ?? 0, errorKind)
      })
    }
  }

  const dates = mergeUniqueBuckets(affectedDates)
  const hours = mergeUniqueBuckets(affectedHours)
  if (dates.length > 0 || hours.length > 0) {
    await runWithUsageDatabaseLockRetry(() => {
      rebuildAffectedAggregates(options.db, "cc", { dates, hours })
    })
  }

  return {
    scannedFiles: files.length,
    parsedFiles,
    skippedFiles,
    failedFiles,
    usageEvents,
    toolEvents,
    elapsedMs: Date.now() - startedAt,
  }
}
```

This references `queryBucketsForFile()`, `markScanFile()` options, and `rebuildAffectedAggregates()`. The next steps in Task 3 add the first two; Task 4 adds aggregate rebuilding.

- [ ] **Step 9: Extend `markScanFile()`**

Replace `markScanFile()` in `cc-service.ts` with:

```ts
function markScanFile(
  db: DatabaseSync,
  prefix: "cc" | "cx",
  filePath: string,
  size: number,
  mtimeMs: number,
  lineCount: number,
  options: {
    readonly parsedOffset?: number
    readonly parserVersion?: number
    readonly pricingRulesHash?: string
  } = {},
): void {
  const now = new Date().toISOString()
  if (prefix === "cc") {
    db.prepare(`
      INSERT INTO cc_scan_files (
        file_path, size, mtime_ms, line_count, parse_status, error_kind, last_scanned_at,
        parsed_offset, parser_version, pricing_rules_hash, first_seen_at, last_changed_at
      )
      VALUES (?, ?, ?, ?, 'parsed', NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        line_count = excluded.line_count,
        parse_status = excluded.parse_status,
        error_kind = excluded.error_kind,
        last_scanned_at = excluded.last_scanned_at,
        parsed_offset = excluded.parsed_offset,
        parser_version = excluded.parser_version,
        pricing_rules_hash = excluded.pricing_rules_hash,
        first_seen_at = COALESCE(NULLIF(cc_scan_files.first_seen_at, ''), excluded.first_seen_at),
        last_changed_at = CASE
          WHEN cc_scan_files.size != excluded.size OR cc_scan_files.mtime_ms != excluded.mtime_ms THEN excluded.last_changed_at
          ELSE cc_scan_files.last_changed_at
        END
    `).run(
      filePath,
      size,
      mtimeMs,
      lineCount,
      now,
      options.parsedOffset ?? size,
      options.parserVersion ?? CC_SCAN_STATE_VERSION,
      options.pricingRulesHash ?? "",
      now,
      now,
    )
    return
  }

  db.prepare(`
    INSERT INTO ${prefix}_scan_files (file_path, size, mtime_ms, line_count, parse_status, error_kind, last_scanned_at)
    VALUES (?, ?, ?, ?, 'parsed', NULL, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      line_count = excluded.line_count,
      parse_status = excluded.parse_status,
      error_kind = excluded.error_kind,
      last_scanned_at = excluded.last_scanned_at
  `).run(filePath, size, mtimeMs, lineCount, now)
}
```

- [ ] **Step 10: Extend `persistParsedFile()` signature**

Change the signature:

```ts
function persistParsedFile(
  db: DatabaseSync,
  prefix: "cc" | "cx",
  filePath: string,
  size: number,
  mtimeMs: number,
  parsed: ParsedFileWithTasks,
  mode: "append" | "replace",
  pricedAt: string,
  scanStateOptions: {
    readonly parsedOffset?: number
    readonly parserVersion?: number
    readonly pricingRulesHash?: string
  } = {},
): void {
```

Inside it, replace:

```ts
    markScanFile(db, prefix, filePath, size, mtimeMs, parsed.lineCount)
```

with:

```ts
    markScanFile(db, prefix, filePath, size, mtimeMs, parsed.lineCount, scanStateOptions)
```

Existing Codex calls continue to use the default `{}` value.

- [ ] **Step 11: Add affected bucket query helper**

In `cc-service.ts`, above `rebuildAggregates()`, add:

```ts
function queryBucketsForFile(db: DatabaseSync, prefix: "cc" | "cx", filePath: string): { dates: string[]; hours: string[] } {
  const sessions = db.prepare(`SELECT session_id FROM ${prefix}_sessions WHERE file_path = ?`).all(filePath) as { session_id: string }[]
  const sessionIds = sessions.map((row) => row.session_id)
  if (sessionIds.length === 0) return { dates: [], hours: [] }

  const bindList = sessionIds.map(() => "?").join(", ")
  const usageDates = db.prepare(`SELECT DISTINCT date FROM ${prefix}_usage_events WHERE session_id IN (${bindList})`).all(...sessionIds) as { date: string }[]
  const toolDates = db.prepare(`SELECT DISTINCT date FROM ${prefix}_tool_events WHERE session_id IN (${bindList})`).all(...sessionIds) as { date: string }[]
  const usageHours = db.prepare(`SELECT DISTINCT hour FROM ${prefix}_usage_events WHERE session_id IN (${bindList})`).all(...sessionIds) as { hour: string }[]
  const toolHours = db.prepare(`SELECT DISTINCT hour FROM ${prefix}_tool_events WHERE session_id IN (${bindList})`).all(...sessionIds) as { hour: string }[]

  return {
    dates: mergeUniqueBuckets(usageDates.map((row) => row.date), toolDates.map((row) => row.date)),
    hours: mergeUniqueBuckets(usageHours.map((row) => row.hour), toolHours.map((row) => row.hour)),
  }
}
```

- [ ] **Step 12: Run report tests and note remaining failures**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: Tests still FAIL because `rebuildAffectedAggregates()` is not implemented yet.

Do not commit this task until Task 4 passes.

## Task 4: Partial Aggregate Rebuild

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] **Step 1: Add partial aggregate rebuild test**

Append this test to `reports.test.ts`:

```ts
  it("rebuilds only affected CC aggregate buckets after append refresh", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, [
      JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-18T01:00:01.000Z",
        message: {
          id: "msg-1",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-19T01:00:01.000Z",
        message: {
          id: "msg-2",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      }),
    ].join("\n") + "\n")

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("UPDATE cc_daily_usage SET input_tokens = 999 WHERE date = '2026-05-18'")
    fs.appendFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        id: "msg-3",
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 30, output_tokens: 5 },
      },
    })}\n`)

    await service.refresh()

    expect(db.prepare("SELECT input_tokens FROM cc_daily_usage WHERE date = '2026-05-18' AND model != '__synapse_tool_calls__'").get()).toEqual({ input_tokens: 999 })
    expect(db.prepare("SELECT input_tokens FROM cc_daily_usage WHERE date = '2026-05-19' AND model != '__synapse_tool_calls__'").get()).toEqual({ input_tokens: 50 })
  })
```

- [ ] **Step 2: Run report tests and verify partial aggregate test fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: FAIL because `rebuildAffectedAggregates()` does not exist.

- [ ] **Step 3: Add SQL bind-list helper functions**

In `cc-service.ts`, above `rebuildAggregates()`, add:

```ts
function sqlBindList(values: readonly string[]): string {
  return values.map(() => "?").join(", ")
}

function runIfValues(values: readonly string[], operation: (values: readonly string[]) => void): void {
  if (values.length === 0) return
  operation(values)
}
```

- [ ] **Step 4: Implement partial aggregate rebuild**

In `cc-service.ts`, above `rebuildAggregates()`, add:

```ts
function rebuildAffectedAggregates(
  db: DatabaseSync,
  prefix: "cc" | "cx",
  affected: { readonly dates: readonly string[]; readonly hours: readonly string[] },
): void {
  const dates = mergeUniqueBuckets(affected.dates)
  const hours = mergeUniqueBuckets(affected.hours)
  let transactionStarted = false
  db.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    runIfValues(dates, (values) => {
      db.prepare(`DELETE FROM ${prefix}_daily_usage WHERE date IN (${sqlBindList(values)})`).run(...values)
      db.prepare(`
        INSERT INTO ${prefix}_daily_usage (
          date, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
          cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
        )
        SELECT
          date,
          model,
          provider,
          workspace_key,
          SUM(input_tokens),
          SUM(output_tokens),
          SUM(cache_read_tokens),
          SUM(cache_write_tokens),
          SUM(reasoning_tokens),
          SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
          SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
          SUM(cost_input),
          SUM(cost_output),
          SUM(cost_cache_read),
          SUM(cost_cache_write),
          SUM(cost_reasoning),
          SUM(total_cost),
          MAX(price_known),
          '${SYNAPSE_COST_CURRENCY}',
          COUNT(*),
          COUNT(DISTINCT session_id),
          0
        FROM ${prefix}_usage_events
        WHERE date IN (${sqlBindList(values)})
        GROUP BY date, model, provider, workspace_key
      `).run(...values)
      db.prepare(`
        INSERT INTO ${prefix}_daily_usage (
          date, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
          cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
        )
        SELECT
          date,
          '${TOOL_CALLS_AGGREGATE_MODEL}',
          '',
          workspace_key,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          '${SYNAPSE_COST_CURRENCY}',
          0,
          0,
          COUNT(*)
        FROM ${prefix}_tool_events
        WHERE date IN (${sqlBindList(values)})
        GROUP BY date, workspace_key
      `).run(...values)
    })

    runIfValues(hours, (values) => {
      db.prepare(`DELETE FROM ${prefix}_hourly_usage WHERE hour IN (${sqlBindList(values)})`).run(...values)
      db.prepare(`
        INSERT INTO ${prefix}_hourly_usage (
          hour, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
          cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
        )
        SELECT
          hour,
          model,
          provider,
          workspace_key,
          SUM(input_tokens),
          SUM(output_tokens),
          SUM(cache_read_tokens),
          SUM(cache_write_tokens),
          SUM(reasoning_tokens),
          SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
          SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
          SUM(cost_input),
          SUM(cost_output),
          SUM(cost_cache_read),
          SUM(cost_cache_write),
          SUM(cost_reasoning),
          SUM(total_cost),
          MAX(price_known),
          '${SYNAPSE_COST_CURRENCY}',
          COUNT(*),
          COUNT(DISTINCT session_id),
          0
        FROM ${prefix}_usage_events
        WHERE hour IN (${sqlBindList(values)})
        GROUP BY hour, model, provider, workspace_key
      `).run(...values)
      db.prepare(`
        INSERT INTO ${prefix}_hourly_usage (
          hour, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
          cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
        )
        SELECT
          hour,
          '${TOOL_CALLS_AGGREGATE_MODEL}',
          '',
          workspace_key,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          '${SYNAPSE_COST_CURRENCY}',
          0,
          0,
          COUNT(*)
        FROM ${prefix}_tool_events
        WHERE hour IN (${sqlBindList(values)})
        GROUP BY hour, workspace_key
      `).run(...values)
    })

    db.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK")
    throw error
  }
}
```

- [ ] **Step 5: Run report tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run parser and scan-state tests together**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/usage-analysis/__tests__/cc-scan-state.test.ts \
  electron/services/usage-analysis/__tests__/cc-parser.test.ts \
  electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit CC refresh and aggregate rebuild**

```bash
git add desktop/electron/services/usage-analysis/cc-service.ts \
  desktop/electron/services/usage-analysis/__tests__/reports.test.ts
git commit -m "feat: refresh cc usage incrementally"
```

## Task 5: Regression Sweep And Release Note

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, add:

```md
- Claude Code 使用分析刷新改为增量解析，日志文件追加后只读取新增内容，大型历史记录下刷新更快。
```

- [ ] **Step 2: Run focused usage-analysis tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/usage-analysis/__tests__/db.test.ts \
  electron/services/usage-analysis/__tests__/scan.test.ts \
  electron/services/usage-analysis/__tests__/cc-scan-state.test.ts \
  electron/services/usage-analysis/__tests__/cc-parser.test.ts \
  electron/services/usage-analysis/__tests__/codex-parser.test.ts \
  electron/services/usage-analysis/__tests__/reports.test.ts \
  electron/services/usage-analysis/__tests__/refresh-runner.test.ts \
  electron/usage-analysis/__tests__/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run all usage-analysis matching tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- usage-analysis
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Check for UI-style accidental changes**

Run:

```bash
git diff -- desktop/src/modules/usage-analysis desktop/electron/services/usage-analysis RELEASE_NOTES_PENDING.md
```

Expected: Diff only touches Electron usage-analysis services/tests and release notes. No renderer UI files should be changed for this feature.

- [ ] **Step 6: Commit release note**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note faster cc usage refresh"
```

## Task 6: Final Verification And Summary

**Files:**
- No new code files.

- [ ] **Step 1: Confirm working tree scope**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated user changes may remain. No uncommitted files from this implementation should remain.

- [ ] **Step 2: Show implementation commits**

Run:

```bash
git log --oneline -5
```

Expected: recent commits include:

```text
docs: note faster cc usage refresh
feat: refresh cc usage incrementally
feat: parse cc usage from byte offsets
feat: add cc usage scan state
```

- [ ] **Step 3: Final user summary**

Report:

```text
Implemented the CC fast parser plan. Claude Code refresh now stores byte offsets, skips unchanged files, parses append-only logs from the tail, avoids JSON parsing irrelevant lines, preserves historical costs, and rebuilds only affected aggregates. Verified with focused usage-analysis tests and hard-constraint checks.
```
