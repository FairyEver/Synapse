# CC Conversation Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CC `对话` tab and a separate conversation detail window that query Claude Code raw JSONL transcripts on demand.

**Architecture:** Keep the existing usage-analysis report database as the lightweight index. Add a main-process transcript parser and conversation service that read raw JSONL only for explicit user actions. Add renderer list/search UI in the CC module and route heavy transcript rendering to a standalone Electron window.

**Tech Stack:** Electron main process, React, TypeScript, shadcn/ui + Radix, Tailwind token classes, Vitest, Node streams, existing `window.synapse` preload bridge.

---

## File Structure

Create:

- `desktop/src/types/usage-analysis-conversations.ts`: shared conversation query, detail, focus, raw event, and window request types.
- `desktop/src/lib/cc-conversation-window.ts`: URL search param builder/parser for the standalone CC conversation window.
- `desktop/src/lib/__tests__/cc-conversation-window.test.ts`: URL helper tests.
- `desktop/electron/services/usage-analysis/cc-conversation-parser.ts`: read-only JSONL transcript parser.
- `desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts`: parser tests for observed and malformed event types.
- `desktop/electron/services/usage-analysis/cc-conversation-service.ts`: session list, indexed search, raw text search, and get-conversation service.
- `desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts`: service tests with temporary `usage.db` and JSONL fixtures.
- `desktop/electron/services/usage-analysis/cc-conversation-window-service.ts`: managed BrowserWindow service for conversation detail windows.
- `desktop/electron/services/__tests__/cc-conversation-window-service.test.ts`: window service tests.
- `desktop/src/modules/usage-analysis/cc/pages/conversations.tsx`: CC `对话` tab page.
- `desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx`: search and filters.
- `desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx`: paginated session table.
- `desktop/src/modules/usage-analysis/cc/components/conversation-detail-window-page.tsx`: standalone detail window page.
- `desktop/src/modules/usage-analysis/cc/components/conversation-event-stream.tsx`: center transcript renderer.
- `desktop/src/modules/usage-analysis/cc/components/conversation-event-inspector.tsx`: raw JSON and metadata inspector.
- `desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx`: renderer tests for the main tab.
- `desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx`: renderer tests for the detail window.

Modify:

- `desktop/src/types/bridge.ts`: import and expose conversation types and bridge methods.
- `desktop/electron/usage-analysis/channels.ts`: add conversation IPC channel constants.
- `desktop/electron/generated/ipc-channels.generated.ts`: keep generated channel map in sync with preload channel map.
- `desktop/electron/preload.ts`: add conversation channels and `window.synapse.usageAnalysis.cc` methods.
- `desktop/electron/usage-analysis/ipc-handlers.ts`: normalize conversation inputs and register handlers.
- `desktop/electron/services/usage-analysis/index.ts`: export `CcConversationService` and `parseCcConversationFile`.
- `desktop/src/modules/usage-analysis/shared/types.ts`: extend `UsageViewId` with `details` and `conversations`.
- `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`: add `明细` and `对话` tabs.
- `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`: render `CcDetailsPage` and `CcConversationsPage`.
- `desktop/src/modules/usage-analysis/cc/hooks.ts`: add conversation list/search/detail hooks.
- `desktop/src/modules/usage-analysis/cc/pages/details.tsx`: add open-conversation action to detail rows.
- `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`: accept optional open-conversation callbacks for rows.
- `desktop/src/App.tsx`: parse CC conversation window requests and render standalone detail window page.
- `RELEASE_NOTES_PENDING.md`: add a user-facing note when implementation changes product behavior.

## Task 1: Shared Conversation Types And Window URL Contract

**Files:**

- Create: `desktop/src/types/usage-analysis-conversations.ts`
- Create: `desktop/src/lib/cc-conversation-window.ts`
- Create: `desktop/src/lib/__tests__/cc-conversation-window.test.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write URL helper tests**

Add `desktop/src/lib/__tests__/cc-conversation-window.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildCcConversationWindowSearchParams,
  parseCcConversationWindowRequest,
} from "../cc-conversation-window"

describe("cc conversation window helpers", () => {
  it("round-trips a session window request with focus", () => {
    const params = buildCcConversationWindowSearchParams({
      sessionId: "session-1",
      title: "对话",
      focus: { timestampMs: 1779860000000, usageEventId: "usage-1" },
    })

    expect(parseCcConversationWindowRequest(`?${params.toString()}`)).toEqual({
      sessionId: "session-1",
      title: "对话",
      focus: { timestampMs: 1779860000000, usageEventId: "usage-1" },
    })
  })

  it("rejects unrelated windows", () => {
    expect(parseCcConversationWindowRequest("?synapseWindow=content&id=x")).toBeNull()
  })

  it("rejects an empty session id", () => {
    expect(parseCcConversationWindowRequest("?synapseWindow=cc-conversation&sessionId=")).toBeNull()
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/cc-conversation-window.test.ts
```

Expected: FAIL because `desktop/src/lib/cc-conversation-window.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `desktop/src/types/usage-analysis-conversations.ts`:

```ts
export type CcConversationRangePreset = "today" | "7d" | "30d" | "90d" | "all"

export type CcConversationFocus = {
  readonly eventId?: string
  readonly usageEventId?: string
  readonly toolEventId?: string
  readonly timestampMs?: number
}

export type CcConversationListInput = {
  readonly preset: CcConversationRangePreset
  readonly query?: string
  readonly rawText?: boolean
  readonly project?: string
  readonly model?: string
  readonly tool?: string
  readonly eventType?: string
  readonly limit?: number
  readonly offset?: number
  readonly cursor?: string
}

export type CcConversationMatchSnippet = {
  readonly eventId: string
  readonly eventType: string
  readonly timestamp?: string
  readonly text: string
}

export type CcConversationListItem = {
  readonly sessionId: string
  readonly title: string
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly startedAt: string
  readonly endedAt: string
  readonly modelSummary: string
  readonly tokens: number
  readonly estimatedCost: number
  readonly toolCalls: number
  readonly eventCount: number
  readonly attachmentCount: number
  readonly lastUsedAt: string
  readonly sourceFilePath: string
  readonly matchSnippets?: readonly CcConversationMatchSnippet[]
}

export type CcConversationListResult = {
  readonly items: readonly CcConversationListItem[]
  readonly total: number
  readonly nextCursor?: string
  readonly partial: boolean
}

export type CcRawConversationEvent = {
  readonly id: string
  readonly type: string
  readonly timestamp?: string
  readonly timestampMs?: number
  readonly lineNumber: number
  readonly byteOffset: number
  readonly uuid?: string
  readonly parentUuid?: string | null
  readonly role?: string
  readonly model?: string
  readonly contentBlocks: readonly Record<string, unknown>[]
  readonly usage?: Record<string, unknown>
  readonly toolName?: string
  readonly toolUseId?: string
  readonly raw: Record<string, unknown>
}

export type CcConversationParseError = {
  readonly id: string
  readonly lineNumber: number
  readonly byteOffset: number
  readonly message: string
  readonly rawLine: string
}

export type CcConversationDetail = {
  readonly session: CcConversationListItem
  readonly events: readonly CcRawConversationEvent[]
  readonly parseErrors: readonly CcConversationParseError[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export type CcConversationWindowRequest = {
  readonly sessionId: string
  readonly title?: string
  readonly focus?: CcConversationFocus
}
```

- [ ] **Step 4: Add URL helper implementation**

Create `desktop/src/lib/cc-conversation-window.ts`:

```ts
import type {
  CcConversationFocus,
  CcConversationWindowRequest,
} from "@/types/usage-analysis-conversations"

const WINDOW_KIND_PARAM = "synapseWindow"
const WINDOW_KIND = "cc-conversation"

function appendFocus(params: URLSearchParams, focus?: CcConversationFocus): void {
  if (!focus) return
  if (focus.eventId) params.set("eventId", focus.eventId)
  if (focus.usageEventId) params.set("usageEventId", focus.usageEventId)
  if (focus.toolEventId) params.set("toolEventId", focus.toolEventId)
  if (typeof focus.timestampMs === "number" && Number.isFinite(focus.timestampMs)) {
    params.set("timestampMs", String(Math.trunc(focus.timestampMs)))
  }
}

function parseFocus(params: URLSearchParams): CcConversationFocus | undefined {
  const eventId = params.get("eventId")?.trim() || undefined
  const usageEventId = params.get("usageEventId")?.trim() || undefined
  const toolEventId = params.get("toolEventId")?.trim() || undefined
  const timestampValue = Number(params.get("timestampMs"))
  const timestampMs = Number.isFinite(timestampValue) ? Math.trunc(timestampValue) : undefined
  if (!eventId && !usageEventId && !toolEventId && timestampMs === undefined) return undefined
  return { eventId, usageEventId, toolEventId, timestampMs }
}

export function buildCcConversationWindowSearchParams(
  request: CcConversationWindowRequest,
): URLSearchParams {
  const params = new URLSearchParams({
    [WINDOW_KIND_PARAM]: WINDOW_KIND,
    sessionId: request.sessionId,
  })
  if (request.title?.trim()) params.set("title", request.title.trim())
  appendFocus(params, request.focus)
  return params
}

export function parseCcConversationWindowRequest(search: string): CcConversationWindowRequest | null {
  const params = new URLSearchParams(search)
  if (params.get(WINDOW_KIND_PARAM) !== WINDOW_KIND) return null
  const sessionId = params.get("sessionId")?.trim() ?? ""
  if (!sessionId) return null
  const title = params.get("title")?.trim() || undefined
  return {
    sessionId,
    ...(title ? { title } : {}),
    focus: parseFocus(params),
  }
}
```

- [ ] **Step 5: Extend bridge types**

In `desktop/src/types/bridge.ts`, import the conversation types near the other imports:

```ts
import type {
  CcConversationDetail,
  CcConversationFocus,
  CcConversationListInput,
  CcConversationListResult,
  CcConversationWindowRequest,
} from "./usage-analysis-conversations"
```

Update `UsageAnalysisBridgeDomain`:

```ts
export type UsageAnalysisBridgeDomain = {
  refresh: () => Promise<UsageAnalysisRefreshResult>
  getOverview: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisOverviewReport>
  getTime: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisTimeBucket[]>
  getModels: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisModelRow[]>
  getProjects: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisProjectRow[]>
  getTools: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisToolRow[]>
  getDetails: (range: UsageAnalysisDetailInput) => Promise<UsageAnalysisDetailRow[]>
  listConversations?: (input: CcConversationListInput) => Promise<CcConversationListResult>
  getConversation?: (sessionId: string, focus?: CcConversationFocus) => Promise<CcConversationDetail>
  searchConversationText?: (input: CcConversationListInput) => Promise<CcConversationListResult>
  openConversationWindow?: (request: CcConversationWindowRequest) => Promise<void>
}
```

Use optional methods in this task so existing preload implementation still typechecks until Task 5 makes them required.

- [ ] **Step 6: Run helper tests and typecheck targeted files**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/cc-conversation-window.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: tests PASS, typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/usage-analysis-conversations.ts desktop/src/lib/cc-conversation-window.ts desktop/src/lib/__tests__/cc-conversation-window.test.ts desktop/src/types/bridge.ts
git commit -m "feat: add cc conversation contracts"
```

## Task 2: Read-Only Claude Code Transcript Parser

**Files:**

- Create: `desktop/electron/services/usage-analysis/cc-conversation-parser.ts`
- Create: `desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts`

- [ ] **Step 1: Write parser tests**

Create `desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseCcConversationFile } from "../cc-conversation-parser"

function writeJsonl(lines: readonly string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-conversation-parser-"))
  const file = path.join(dir, "session-1.jsonl")
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8")
  return file
}

describe("parseCcConversationFile", () => {
  it("preserves observed raw event types and normalized fields", async () => {
    const file = writeJsonl([
      JSON.stringify({ type: "ai-title", sessionId: "s1", aiTitle: "标题" }),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-05-27T01:00:00.000Z",
        cwd: "/repo",
        gitBranch: "main",
        message: { role: "user", content: "帮我看一下" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s1",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-05-27T01:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 2 },
          content: [
            { type: "thinking", thinking: "analysis" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.ts" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        uuid: "tr1",
        parentUuid: "a1",
        timestamp: "2026-05-27T01:00:02.000Z",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] },
        toolUseResult: { stdout: "ok", stderr: "", interrupted: false },
      }),
      JSON.stringify({ type: "attachment", sessionId: "s1", uuid: "att1", attachment: { fileName: "a.png" } }),
      JSON.stringify({ type: "system", sessionId: "s1", uuid: "sys1", level: "info", content: "done" }),
      JSON.stringify({ type: "queue-operation", sessionId: "s1", operation: "enqueue", content: "x" }),
      JSON.stringify({ type: "permission-mode", sessionId: "s1", permissionMode: "default" }),
      JSON.stringify({ type: "last-prompt", sessionId: "s1", lastPrompt: "继续", leafUuid: "a1" }),
      JSON.stringify({ type: "file-history-snapshot", messageId: "m1", snapshot: [] }),
    ])

    const result = await parseCcConversationFile(file)

    expect(result.events.map((event) => event.type)).toEqual([
      "ai-title",
      "user",
      "assistant",
      "user",
      "attachment",
      "system",
      "queue-operation",
      "permission-mode",
      "last-prompt",
      "file-history-snapshot",
    ])
    expect(result.events[1]).toMatchObject({ id: "u1", role: "user", uuid: "u1" })
    expect(result.events[2]).toMatchObject({ id: "a1", role: "assistant", model: "claude-opus-4.6", toolName: "Read", toolUseId: "tool-1" })
    expect(result.events[2].contentBlocks).toHaveLength(2)
    expect(result.events[3].raw.toolUseResult).toEqual({ stdout: "ok", stderr: "", interrupted: false })
    expect(result.parseErrors).toEqual([])
  })

  it("keeps malformed lines as parse errors", async () => {
    const file = writeJsonl([
      JSON.stringify({ type: "user", sessionId: "s1", uuid: "u1", message: { role: "user", content: "ok" } }),
      "{bad json",
    ])

    const result = await parseCcConversationFile(file)

    expect(result.events).toHaveLength(1)
    expect(result.parseErrors).toEqual([expect.objectContaining({
      id: "parse-error:2",
      lineNumber: 2,
      rawLine: "{bad json",
    })])
  })
})
```

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement parser**

Create `desktop/electron/services/usage-analysis/cc-conversation-parser.ts`:

```ts
import fs from "node:fs"
import readline from "node:readline"
import type {
  CcConversationParseError,
  CcRawConversationEvent,
} from "../../../src/types/usage-analysis-conversations"

export type ParsedCcConversationFile = {
  readonly events: readonly CcRawConversationEvent[]
  readonly parseErrors: readonly CcConversationParseError[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeContentBlocks(message: Record<string, unknown> | undefined): readonly Record<string, unknown>[] {
  const content = message?.content
  if (Array.isArray(content)) {
    return content.flatMap((item) => {
      const block = asRecord(item)
      return block ? [block] : []
    })
  }
  if (typeof content === "string") {
    return [{ type: "string", text: content }]
  }
  return []
}

function firstToolUse(blocks: readonly Record<string, unknown>[]): { toolName?: string; toolUseId?: string } {
  const block = blocks.find((item) => item.type === "tool_use")
  return {
    toolName: asString(block?.name),
    toolUseId: asString(block?.id),
  }
}

function createEventId(raw: Record<string, unknown>, lineNumber: number, byteOffset: number): string {
  return asString(raw.uuid) ?? `${asString(raw.sessionId) ?? "unknown"}:${lineNumber}:${byteOffset}`
}

function toConversationEvent(
  raw: Record<string, unknown>,
  lineNumber: number,
  byteOffset: number,
): CcRawConversationEvent {
  const message = asRecord(raw.message)
  const blocks = normalizeContentBlocks(message)
  const tool = firstToolUse(blocks)
  const timestamp = asString(raw.timestamp)
  return {
    id: createEventId(raw, lineNumber, byteOffset),
    type: asString(raw.type) ?? "unknown",
    ...(timestamp ? { timestamp } : {}),
    ...(parseTimestampMs(timestamp) !== undefined ? { timestampMs: parseTimestampMs(timestamp) } : {}),
    lineNumber,
    byteOffset,
    ...(asString(raw.uuid) ? { uuid: asString(raw.uuid) } : {}),
    parentUuid: raw.parentUuid === null ? null : asString(raw.parentUuid),
    ...(asString(message?.role) ? { role: asString(message?.role) } : {}),
    ...(asString(message?.model) ? { model: asString(message?.model) } : {}),
    contentBlocks: blocks,
    ...(asRecord(message?.usage) ? { usage: asRecord(message?.usage) } : {}),
    ...(tool.toolName ? { toolName: tool.toolName } : {}),
    ...(tool.toolUseId ? { toolUseId: tool.toolUseId } : {}),
    raw,
  }
}

export async function parseCcConversationFile(filePath: string): Promise<ParsedCcConversationFile> {
  const events: CcRawConversationEvent[] = []
  const parseErrors: CcConversationParseError[] = []
  const input = fs.createReadStream(filePath, { encoding: "utf8" })
  const reader = readline.createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  let byteOffset = 0

  for await (const line of reader) {
    lineNumber += 1
    const currentOffset = byteOffset
    byteOffset += Buffer.byteLength(line, "utf8") + 1
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as unknown
      const raw = asRecord(parsed)
      if (!raw) {
        parseErrors.push({
          id: `parse-error:${lineNumber}`,
          lineNumber,
          byteOffset: currentOffset,
          message: "JSONL line is not an object.",
          rawLine: line,
        })
        continue
      }
      events.push(toConversationEvent(raw, lineNumber, currentOffset))
    } catch (error) {
      parseErrors.push({
        id: `parse-error:${lineNumber}`,
        lineNumber,
        byteOffset: currentOffset,
        message: error instanceof Error ? error.message : "Invalid JSONL line.",
        rawLine: line,
      })
    }
  }

  return { events, parseErrors }
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-conversation-parser.ts desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts
git commit -m "feat: parse cc conversation transcripts"
```

## Task 3: Conversation Index, Detail, And Raw Search Service

**Files:**

- Create: `desktop/electron/services/usage-analysis/cc-conversation-service.ts`
- Create: `desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts`
- Modify: `desktop/electron/services/usage-analysis/index.ts`

- [ ] **Step 1: Write service tests**

Create `desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts`:

```ts
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { initUsageAnalysisSchema } from "../db-schema"
import { CcConversationService } from "../cc-conversation-service"

function setupFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-conversation-service-"))
  const db = new DatabaseSync(path.join(dir, "usage.db"))
  initUsageAnalysisSchema(db)
  const filePath = path.join(dir, "session-1.jsonl")
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: "ai-title", sessionId: "session-1", aiTitle: "修登录问题" }),
    JSON.stringify({ type: "user", sessionId: "session-1", uuid: "u1", timestamp: "2026-05-27T01:00:00.000Z", message: { role: "user", content: "请修登录问题" } }),
    JSON.stringify({ type: "assistant", sessionId: "session-1", uuid: "a1", timestamp: "2026-05-27T01:00:01.000Z", message: { role: "assistant", model: "claude-opus-4.6", content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "auth.ts" } }], usage: { input_tokens: 10, output_tokens: 5 } } }),
  ].join("\n"), "utf8")
  db.prepare(`
    INSERT INTO cc_sessions (
      session_id, file_path, workspace_key, workspace_label, provider, source,
      started_at, ended_at, model_summary, request_count, conversation_count, tool_call_count
    ) VALUES (?, ?, ?, ?, 'anthropic', 'claude-code', ?, ?, ?, 1, 1, 1)
  `).run("session-1", filePath, "-repo", "/repo", "2026-05-27T01:00:00.000Z", "2026-05-27T01:00:01.000Z", "claude-opus-4.6")
  db.prepare(`
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      priced_tokens, unpriced_tokens, total_cost
    ) VALUES (?, ?, ?, '2026-05-27', '2026-05-27 09', ?, ?, ?, 'anthropic', 10, 5, 0, 0, 0, 15, 0, 0.01)
  `).run("usage-1", "session-1", Date.parse("2026-05-27T01:00:01.000Z"), "-repo", "/repo", "claude-opus-4.6")
  db.prepare(`
    INSERT INTO cc_tool_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, tool_name, category
    ) VALUES (?, ?, ?, '2026-05-27', '2026-05-27 09', ?, 'Read', 'tool_use')
  `).run("tool-event-1", "session-1", Date.parse("2026-05-27T01:00:01.000Z"), "-repo")
  return { db, dir, filePath }
}

describe("CcConversationService", () => {
  it("lists conversations from the usage index", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

    const result = service.listConversations({ preset: "all", limit: 20 })

    expect(result).toMatchObject({
      total: 1,
      partial: false,
      items: [expect.objectContaining({
        sessionId: "session-1",
        workspaceLabel: "/repo",
        modelSummary: "claude-opus-4.6",
        tokens: 15,
        estimatedCost: 0.01,
        toolCalls: 1,
        sourceFilePath: expect.stringContaining("session-1.jsonl"),
      })],
    })
  })

  it("opens a conversation by reading raw JSONL on demand", async () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

    const detail = await service.getConversation("session-1")

    expect(detail.session.sessionId).toBe("session-1")
    expect(detail.events.map((event) => event.type)).toEqual(["ai-title", "user", "assistant"])
    expect(detail.parseErrors).toEqual([])
  })

  it("searches raw text only when requested", async () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

    expect(service.listConversations({ preset: "all", query: "登录", rawText: false }).items).toEqual([])
    const result = await service.searchConversationText({ preset: "all", query: "登录", rawText: true })

    expect(result.items[0].matchSnippets?.[0]).toEqual(expect.objectContaining({
      eventId: "u1",
      eventType: "user",
      text: expect.stringContaining("登录"),
    }))
  })

  it("returns an explicit error for a missing source file", async () => {
    const { db, filePath } = setupFixture()
    fs.rmSync(filePath)
    const service = new CcConversationService({ db })

    await expect(service.getConversation("session-1")).rejects.toThrow("Claude Code transcript file is missing")
  })
})
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts
```

Expected: FAIL because `CcConversationService` does not exist.

- [ ] **Step 3: Implement service**

Create `desktop/electron/services/usage-analysis/cc-conversation-service.ts` with these exported members:

```ts
import fs from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import type {
  CcConversationDetail,
  CcConversationListInput,
  CcConversationListItem,
  CcConversationListResult,
  CcConversationMatchSnippet,
} from "../../../src/types/usage-analysis-conversations"
import { createUsageRangeFilter } from "./range"
import { parseCcConversationFile } from "./cc-conversation-parser"

type ServiceOptions = {
  readonly db: DatabaseSync
}

type SessionRow = {
  readonly session_id: string
  readonly file_path: string
  readonly workspace_key: string
  readonly workspace_label: string
  readonly started_at: string
  readonly ended_at: string
  readonly model_summary: string
  readonly tool_call_count: number
}

type AggregateRow = {
  readonly session_id: string
  readonly tokens: number
  readonly estimated_cost: number
  readonly last_timestamp_ms: number
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function normalizeLimit(value: unknown): number {
  const limit = Math.trunc(Number(value))
  if (!Number.isFinite(limit)) return 50
  return Math.min(Math.max(limit, 1), 200)
}

function normalizeOffset(value: unknown): number {
  const offset = Math.trunc(Number(value))
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function titleFromSession(row: SessionRow): string {
  return row.workspace_label || row.workspace_key || row.session_id
}

function textFromRaw(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(textFromRaw).filter(Boolean).join("\n")
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(textFromRaw).filter(Boolean).join("\n")
  return ""
}

export class CcConversationService {
  private readonly db: DatabaseSync

  constructor(options: ServiceOptions) {
    this.db = options.db
  }

  listConversations(input: CcConversationListInput): CcConversationListResult {
    const limit = normalizeLimit(input.limit)
    const offset = normalizeOffset(input.offset)
    const params: (string | number)[] = []
    const where: string[] = []
    const range = createUsageRangeFilter(input)
    if (range.sinceTimestampMs !== undefined) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.timestamp_ms >= ?)")
      params.push(range.sinceTimestampMs)
    }
    if (range.untilTimestampMs !== undefined) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.timestamp_ms <= ?)")
      params.push(range.untilTimestampMs)
    }
    if (input.project) {
      where.push("s.workspace_key = ?")
      params.push(input.project)
    }
    if (input.model) {
      where.push("s.model_summary LIKE ?")
      params.push(`%${input.model}%`)
    }
    if (input.query?.trim() && !input.rawText) {
      where.push("(s.session_id LIKE ? OR s.workspace_label LIKE ? OR s.model_summary LIKE ?)")
      const query = `%${input.query.trim()}%`
      params.push(query, query, query)
    }
    if (input.tool) {
      where.push("EXISTS (SELECT 1 FROM cc_tool_events t WHERE t.session_id = s.session_id AND t.tool_name = ?)")
      params.push(input.tool)
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const count = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM cc_sessions s
      ${whereSql}
    `).get(...params) as { total?: number } | undefined
    const rows = this.db.prepare(`
      SELECT s.*
      FROM cc_sessions s
      ${whereSql}
      ORDER BY COALESCE(NULLIF(s.ended_at, ''), s.started_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as SessionRow[]
    return {
      items: rows.map((row) => this.toListItem(row)),
      total: toNumber(count?.total),
      partial: false,
    }
  }

  async getConversation(sessionId: string): Promise<CcConversationDetail> {
    const row = this.getSessionRow(sessionId)
    if (!row) throw new Error(`Claude Code session not found: ${sessionId}`)
    if (!fs.existsSync(row.file_path)) throw new Error(`Claude Code transcript file is missing: ${row.file_path}`)
    const parsed = await parseCcConversationFile(row.file_path)
    return {
      session: this.toListItem(row, parsed.events.length),
      events: parsed.events,
      parseErrors: parsed.parseErrors,
      hasMore: false,
    }
  }

  async searchConversationText(input: CcConversationListInput): Promise<CcConversationListResult> {
    const query = input.query?.trim()
    if (!query || !input.rawText) return this.listConversations(input)
    const candidates = this.listConversations({ ...input, query: undefined, rawText: false, limit: 100 }).items
    const matches: CcConversationListItem[] = []
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate.sourceFilePath)) continue
      const parsed = await parseCcConversationFile(candidate.sourceFilePath)
      const snippets: CcConversationMatchSnippet[] = []
      for (const event of parsed.events) {
        const text = textFromRaw(event.raw)
        const index = text.indexOf(query)
        if (index < 0) continue
        snippets.push({
          eventId: event.id,
          eventType: event.type,
          timestamp: event.timestamp,
          text: text.slice(Math.max(0, index - 40), index + query.length + 80),
        })
      }
      if (snippets.length > 0) {
        matches.push({ ...candidate, matchSnippets: snippets.slice(0, 3) })
      }
    }
    return { items: matches, total: matches.length, partial: candidates.length >= 100 }
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM cc_sessions WHERE session_id = ?").get(sessionId) as SessionRow | undefined
  }

  private toListItem(row: SessionRow, eventCount = 0): CcConversationListItem {
    const aggregate = this.db.prepare(`
      SELECT
        session_id,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(total_cost) AS estimated_cost,
        MAX(timestamp_ms) AS last_timestamp_ms
      FROM cc_usage_events
      WHERE session_id = ?
      GROUP BY session_id
    `).get(row.session_id) as AggregateRow | undefined
    return {
      sessionId: row.session_id,
      title: titleFromSession(row),
      workspaceKey: row.workspace_key,
      workspaceLabel: row.workspace_label,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      modelSummary: row.model_summary,
      tokens: toNumber(aggregate?.tokens),
      estimatedCost: toNumber(aggregate?.estimated_cost),
      toolCalls: toNumber(row.tool_call_count),
      eventCount,
      attachmentCount: 0,
      lastUsedAt: aggregate?.last_timestamp_ms ? new Date(aggregate.last_timestamp_ms).toISOString() : row.ended_at,
      sourceFilePath: row.file_path,
    }
  }
}
```

Keep the implementation smaller than the design's future chunk API; chunking can be added when a real huge-file test demands it.

- [ ] **Step 4: Export service**

In `desktop/electron/services/usage-analysis/index.ts`, add:

```ts
export { CcConversationService } from "./cc-conversation-service"
export { parseCcConversationFile } from "./cc-conversation-parser"
```

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-conversation-parser.ts desktop/electron/services/usage-analysis/cc-conversation-service.ts desktop/electron/services/usage-analysis/index.ts desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts
git commit -m "feat: add cc conversation query service"
```

## Task 4: Conversation Window Service And IPC Bridge

**Files:**

- Create: `desktop/electron/services/usage-analysis/cc-conversation-window-service.ts`
- Create: `desktop/electron/services/__tests__/cc-conversation-window-service.test.ts`
- Modify: `desktop/electron/usage-analysis/channels.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/usage-analysis/ipc-handlers.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write window service tests**

Create `desktop/electron/services/__tests__/cc-conversation-window-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createCcConversationWindowService } from "../usage-analysis/cc-conversation-window-service"

describe("createCcConversationWindowService", () => {
  it("opens one window per session and focuses duplicates", async () => {
    const webContents = { on: vi.fn() }
    const window = {
      webContents,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
    }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createCcConversationWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.openConversationWindow({ sessionId: "s1", title: "对话" })
    await service.openConversationWindow({ sessionId: "s1", title: "对话" })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run window service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/cc-conversation-window-service.test.ts
```

Expected: FAIL because the window service does not exist.

- [ ] **Step 3: Implement window service**

Create `desktop/electron/services/usage-analysis/cc-conversation-window-service.ts` following `content-window-service.ts`:

```ts
import { app, BrowserWindow } from "electron"
import path from "node:path"
import { DEFAULT_WINDOW_BOUNDS } from "../../../src/constants/defaults"
import { buildCcConversationWindowSearchParams } from "../../../src/lib/cc-conversation-window"
import type { CcConversationWindowRequest } from "../../../src/types/usage-analysis-conversations"
import { getWindowIconPath } from "../app-icon-service"
import { createMainLogger } from "../log-store"
import { RendererHealthService } from "../renderer-health"

const WINDOW_BOUNDS = {
  width: 1360,
  height: 820,
  minWidth: 1120,
  minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
}

type Logger = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type Health = {
  attach: (webContents: Electron.WebContents) => void
  detach: () => void
}

type Deps = {
  createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  createHealthService: (payload: CcConversationWindowRequest) => Health
  getAppPath: () => string
  getIconPath: () => string | null
  getPreloadPath: () => string
  logger: Logger
  loadWindow?: (window: BrowserWindow, payload: CcConversationWindowRequest) => Promise<void>
}

async function loadConversationWindow(window: BrowserWindow, payload: CcConversationWindowRequest): Promise<void> {
  const searchParams = buildCcConversationWindowSearchParams(payload)
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    const url = new URL(devServerUrl)
    for (const [key, value] of searchParams.entries()) url.searchParams.set(key, value)
    await window.loadURL(url.toString())
    return
  }
  await window.loadFile(path.join(app.getAppPath(), "dist/index.html"), {
    query: Object.fromEntries(searchParams.entries()),
  })
}

export function createCcConversationWindowService(deps: Deps) {
  const windowsBySession = new Map<string, BrowserWindow>()

  return {
    async openConversationWindow(payload: CcConversationWindowRequest): Promise<void> {
      const existing = windowsBySession.get(payload.sessionId)
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore()
        existing.focus()
        deps.logger.info("Focused existing CC conversation window.", { sessionId: payload.sessionId })
        return
      }

      const icon = deps.getIconPath()
      const window = deps.createWindow({
        ...WINDOW_BOUNDS,
        show: false,
        title: payload.title || "对话",
        ...(icon ? { icon } : {}),
        webPreferences: {
          preload: deps.getPreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const health = deps.createHealthService(payload)
      health.attach(window.webContents)
      windowsBySession.set(payload.sessionId, window)
      window.webContents.on("preload-error", (_event, _preloadPath, error) => {
        deps.logger.error("CC conversation window preload script failed.", { error })
      })
      window.once("ready-to-show", () => window.show())
      window.on("closed", () => {
        health.detach()
        windowsBySession.delete(payload.sessionId)
      })
      await (deps.loadWindow ?? loadConversationWindow)(window, payload)
    },
  }
}

export const ccConversationWindowService = createCcConversationWindowService({
  createWindow: (options) => new BrowserWindow(options),
  createHealthService: (payload) => new RendererHealthService({
    logger: createMainLogger(`renderer-health.cc-conversation.${payload.sessionId}`),
  }),
  getAppPath: () => app.getAppPath(),
  getIconPath: () => getWindowIconPath() ?? null,
  getPreloadPath: () => path.join(__dirname, "../preload.js"),
  logger: createMainLogger("cc-conversation-window"),
})
```

- [ ] **Step 4: Add IPC channels and preload methods**

In `desktop/electron/usage-analysis/channels.ts`, add:

```ts
  ccConversationsList: "synapse:usage-analysis:cc:conversations:list",
  ccConversationGet: "synapse:usage-analysis:cc:conversation:get",
  ccConversationSearchText: "synapse:usage-analysis:cc:conversation:search-text",
  ccConversationWindowOpen: "synapse:usage-analysis:cc:conversation-window:open",
```

Add the same keys and values under `"usage-analysis"` in `desktop/electron/generated/ipc-channels.generated.ts` and `desktop/electron/preload.ts`.

In `desktop/electron/preload.ts`, extend `usageAnalysis.cc`:

```ts
      listConversations: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationsList)(input),
      getConversation: (sessionId, focus) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationGet)({ sessionId, focus }),
      searchConversationText: (input) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationSearchText)(input),
      openConversationWindow: (request) => invoke(IPC_CHANNELS["usage-analysis"].ccConversationWindowOpen)(request),
```

- [ ] **Step 5: Register IPC handlers**

In `desktop/electron/usage-analysis/ipc-handlers.ts`, import:

```ts
import { CcConversationService } from "../services/usage-analysis/cc-conversation-service"
import { ccConversationWindowService } from "../services/usage-analysis/cc-conversation-window-service"
import type {
  CcConversationFocus,
  CcConversationListInput,
  CcConversationWindowRequest,
} from "../../src/types/usage-analysis-conversations"
```

Add normalizers near `normalizeDetailsRange`:

```ts
function normalizeConversationListInput(input: CcConversationListInput | undefined): CcConversationListInput {
  const range = normalizeUsageRangeForIpc(input)
  const limit = Number(input?.limit)
  const offset = Number(input?.offset)
  return {
    ...range,
    query: typeof input?.query === "string" ? input.query.trim() : undefined,
    rawText: input?.rawText === true,
    project: typeof input?.project === "string" ? input.project : undefined,
    model: typeof input?.model === "string" ? input.model : undefined,
    tool: typeof input?.tool === "string" ? input.tool : undefined,
    eventType: typeof input?.eventType === "string" ? input.eventType : undefined,
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
    cursor: typeof input?.cursor === "string" ? input.cursor : undefined,
  }
}

function normalizeConversationFocus(focus: CcConversationFocus | undefined): CcConversationFocus | undefined {
  if (!focus) return undefined
  return {
    eventId: typeof focus.eventId === "string" ? focus.eventId : undefined,
    usageEventId: typeof focus.usageEventId === "string" ? focus.usageEventId : undefined,
    toolEventId: typeof focus.toolEventId === "string" ? focus.toolEventId : undefined,
    timestampMs: Number.isFinite(Number(focus.timestampMs)) ? Math.trunc(Number(focus.timestampMs)) : undefined,
  }
}
```

Inside `registerUsageAnalysisHandlers`, instantiate:

```ts
  const ccConversations = new CcConversationService({ db })
```

Register handlers:

```ts
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationsList, async (_event, input?: CcConversationListInput) => {
    return ccConversations.listConversations(normalizeConversationListInput(input))
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationGet, async (_event, payload?: { sessionId?: string; focus?: CcConversationFocus }) => {
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : ""
    if (!sessionId) throw new Error("sessionId is required")
    return ccConversations.getConversation(sessionId, normalizeConversationFocus(payload?.focus))
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationSearchText, async (_event, input?: CcConversationListInput) => {
    return ccConversations.searchConversationText(normalizeConversationListInput({ ...input, rawText: true }))
  })
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccConversationWindowOpen, async (_event, request?: CcConversationWindowRequest) => {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : ""
    if (!sessionId) throw new Error("sessionId is required")
    await ccConversationWindowService.openConversationWindow({
      sessionId,
      title: typeof request?.title === "string" ? request.title : undefined,
      focus: normalizeConversationFocus(request?.focus),
    })
  })
```

- [ ] **Step 6: Make bridge methods required**

In `desktop/src/types/bridge.ts`, remove `?` from the four conversation methods added in Task 1.

- [ ] **Step 7: Run IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/cc-conversation-window-service.test.ts desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts desktop/electron/__tests__/preload.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-conversation-window-service.ts desktop/electron/services/__tests__/cc-conversation-window-service.test.ts desktop/electron/usage-analysis/channels.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/preload.ts desktop/electron/usage-analysis/ipc-handlers.ts desktop/src/types/bridge.ts
git commit -m "feat: expose cc conversation ipc"
```

## Task 5: CC Conversation Tab Renderer

**Files:**

- Create: `desktop/src/modules/usage-analysis/cc/pages/conversations.tsx`
- Create: `desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx`
- Create: `desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx`
- Create: `desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/types.ts`
- Modify: `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/hooks.ts`
- Modify: `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`

- [ ] **Step 1: Write shell and page tests**

Add to `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`:

```ts
  it("shows details and conversation tabs for CC analysis", () => {
    const html = renderToStaticMarkup(
      <UsageAnalysisShell
        title="CC"
        view="conversations"
        range="30d"
        refreshing={false}
        onViewChange={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
      >
        <div>content</div>
      </UsageAnalysisShell>,
    )

    expect(html).toContain("明细")
    expect(html).toContain("对话")
  })
```

Create `desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcConversationsPage } from "../cc/pages/conversations"

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    usageAnalysis: {
      cc: {
        listConversations: async () => ({
          total: 1,
          partial: false,
          items: [{
            sessionId: "s1",
            title: "修登录问题",
            workspaceKey: "-repo",
            workspaceLabel: "/repo",
            startedAt: "2026-05-27T01:00:00.000Z",
            endedAt: "2026-05-27T01:00:01.000Z",
            modelSummary: "claude-opus-4.6",
            tokens: 15,
            estimatedCost: 0.01,
            toolCalls: 1,
            eventCount: 3,
            attachmentCount: 0,
            lastUsedAt: "2026-05-27T01:00:01.000Z",
            sourceFilePath: "/tmp/session-1.jsonl",
          }],
        }),
        openConversationWindow: async () => undefined,
      },
    },
  }),
}))

describe("CcConversationsPage", () => {
  it("renders conversation filters and table headings", () => {
    const html = renderToStaticMarkup(<CcConversationsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("项目")
    expect(html).toContain("模型")
    expect(html).toContain("打开对话")
  })
})
```

- [ ] **Step 2: Run renderer tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx
```

Expected: FAIL because `conversations` view and page do not exist.

- [ ] **Step 3: Extend view ids and shell tabs**

In `desktop/src/modules/usage-analysis/shared/types.ts`:

```ts
export type UsageViewId = "today" | "overview" | "time" | "models" | "projects" | "tools" | "details" | "conversations"
```

In `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`, update `VIEWS`:

```ts
const VIEWS: { readonly id: UsageViewId; readonly label: string }[] = [
  { id: "today", label: "今日" },
  { id: "overview", label: "概览" },
  { id: "time", label: "时间" },
  { id: "models", label: "模型" },
  { id: "projects", label: "项目" },
  { id: "tools", label: "工具" },
  { id: "details", label: "明细" },
  { id: "conversations", label: "对话" },
]
```

- [ ] **Step 4: Add hooks**

In `desktop/src/modules/usage-analysis/cc/hooks.ts`, add:

```ts
import type { CcConversationListInput } from "@/types/usage-analysis-conversations"

export function useCcConversations(input: CcConversationListInput, refreshKey: number) {
  return useReportLoader(
    () => input.rawText
      ? requireSynapseBridge().usageAnalysis.cc.searchConversationText(input)
      : requireSynapseBridge().usageAnalysis.cc.listConversations(input),
    [input.preset, input.query, input.rawText, input.project, input.model, input.tool, input.eventType, input.limit, input.offset, input.cursor, refreshKey],
  )
}
```

- [ ] **Step 5: Add filter component**

Create `desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx`:

```tsx
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

export function ConversationFilters({
  query,
  rawText,
  onQueryChange,
  onRawTextChange,
}: {
  readonly query: string
  readonly rawText: boolean
  readonly onQueryChange: (value: string) => void
  readonly onRawTextChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="relative min-w-64 flex-1">
        <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          className="pl-8"
          placeholder="搜索"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <Button type="button" variant={rawText ? "default" : "outline"} size="sm" onClick={() => onRawTextChange(!rawText)}>
        原文
      </Button>
      <Switch checked={rawText} onCheckedChange={onRawTextChange} aria-label="原文" />
    </div>
  )
}
```

`desktop/src/components/ui/switch.tsx` already exists in this repository, so use it directly.

- [ ] **Step 6: Add table component**

Create `desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx`:

```tsx
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import type { CcConversationListItem } from "@/types/usage-analysis-conversations"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

export function ConversationTable({
  rows,
  onOpen,
}: {
  readonly rows: readonly CcConversationListItem[]
  readonly onOpen: (row: CcConversationListItem) => void
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead>项目</TableHead>
            <TableHead>模型</TableHead>
            <TableHead className="text-right">Token</TableHead>
            <TableHead className="text-right">费用</TableHead>
            <TableHead className="text-right">工具</TableHead>
            <TableHead className="text-right">事件</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.sessionId}>
              <TableCell>{row.title || row.sessionId}</TableCell>
              <TableCell>{row.workspaceLabel || row.workspaceKey || "-"}</TableCell>
              <TableCell>{row.modelSummary || "-"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatSynapseCost(row.estimatedCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.eventCount)}</TableCell>
              <TableCell className="text-right">
                <Button type="button" size="sm" variant="outline" onClick={() => onOpen(row)}>
                  <ExternalLink data-icon="inline-start" />
                  打开对话
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 7: Add page**

Create `desktop/src/modules/usage-analysis/cc/pages/conversations.tsx`:

```tsx
import { useMemo, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { ReportState } from "../../shared/components/report-state"
import type { UsageRangePreset } from "../../shared/types"
import { ConversationFilters } from "../components/conversation-filters"
import { ConversationTable } from "../components/conversation-table"
import { useCcConversations } from "../hooks"

export function CcConversationsPage({
  range,
  refreshKey,
}: {
  readonly range: UsageRangePreset
  readonly refreshKey: number
}) {
  const [query, setQuery] = useState("")
  const [rawText, setRawText] = useState(false)
  const input = useMemo(() => ({
    preset: range,
    query,
    rawText,
    limit: 50,
    offset: 0,
  }), [range, query, rawText])
  const state = useCcConversations(input, refreshKey)
  const rows = state.data?.items ?? []

  return (
    <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0}>
      <div className="flex min-w-0 flex-col gap-2">
        <ConversationFilters
          query={query}
          rawText={rawText}
          onQueryChange={setQuery}
          onRawTextChange={setRawText}
        />
        <ConversationTable
          rows={rows}
          onOpen={(row) => {
            void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
              sessionId: row.sessionId,
              title: row.title,
            })
          }}
        />
      </div>
    </ReportState>
  )
}
```

- [ ] **Step 8: Render the new page**

In `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`, import `CcDetailsPage` and `CcConversationsPage`, then add:

```tsx
      {view === "details" ? <CcDetailsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "conversations" ? <CcConversationsPage range={range} refreshKey={refreshKey} /> : null}
```

- [ ] **Step 9: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/modules/usage-analysis/shared/types.ts desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx desktop/src/modules/usage-analysis/cc/hooks.ts desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx desktop/src/modules/usage-analysis/cc/pages/conversations.tsx desktop/src/modules/usage-analysis/cc/components/conversation-filters.tsx desktop/src/modules/usage-analysis/cc/components/conversation-table.tsx desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx
git commit -m "feat: add cc conversation tab"
```

## Task 6: Standalone Conversation Detail Window Renderer

**Files:**

- Create: `desktop/src/modules/usage-analysis/cc/components/conversation-detail-window-page.tsx`
- Create: `desktop/src/modules/usage-analysis/cc/components/conversation-event-stream.tsx`
- Create: `desktop/src/modules/usage-analysis/cc/components/conversation-event-inspector.tsx`
- Create: `desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Write detail window tests**

Create `desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcConversationDetailWindowPage } from "../cc/components/conversation-detail-window-page"

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    usageAnalysis: {
      cc: {
        getConversation: async () => ({
          session: {
            sessionId: "s1",
            title: "修登录问题",
            workspaceKey: "-repo",
            workspaceLabel: "/repo",
            startedAt: "2026-05-27T01:00:00.000Z",
            endedAt: "2026-05-27T01:00:01.000Z",
            modelSummary: "claude-opus-4.6",
            tokens: 15,
            estimatedCost: 0.01,
            toolCalls: 1,
            eventCount: 2,
            attachmentCount: 0,
            lastUsedAt: "2026-05-27T01:00:01.000Z",
            sourceFilePath: "/tmp/s1.jsonl",
          },
          events: [{
            id: "u1",
            type: "user",
            timestamp: "2026-05-27T01:00:00.000Z",
            timestampMs: 1779843600000,
            lineNumber: 1,
            byteOffset: 0,
            role: "user",
            contentBlocks: [{ type: "string", text: "请修登录问题" }],
            raw: { type: "user", message: { content: "请修登录问题" } },
          }],
          parseErrors: [],
          hasMore: false,
        }),
      },
    },
  }),
}))

describe("CcConversationDetailWindowPage", () => {
  it("renders the header, event stream, and inspector", () => {
    const html = renderToStaticMarkup(
      <CcConversationDetailWindowPage request={{ sessionId: "s1", title: "修登录问题" }} />,
    )

    expect(html).toContain("修登录问题")
    expect(html).toContain("事件")
    expect(html).toContain("字段")
  })
})
```

- [ ] **Step 2: Run detail window tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Add event stream**

Create `desktop/src/modules/usage-analysis/cc/components/conversation-event-stream.tsx`:

```tsx
import type { CcRawConversationEvent } from "@/types/usage-analysis-conversations"

function eventText(event: CcRawConversationEvent): string {
  return event.contentBlocks.map((block) => {
    const text = block.text
    const thinking = block.thinking
    const content = block.content
    if (typeof text === "string") return text
    if (typeof thinking === "string") return thinking
    if (typeof content === "string") return content
    return JSON.stringify(block)
  }).filter(Boolean).join("\n")
}

export function ConversationEventStream({
  events,
  selectedId,
  onSelect,
}: {
  readonly events: readonly CcRawConversationEvent[]
  readonly selectedId?: string
  readonly onSelect: (event: CcRawConversationEvent) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {events.map((event) => (
        <button
          key={event.id}
          type="button"
          className="min-w-0 rounded-md border bg-card p-3 text-left"
          data-selected={selectedId === event.id ? "true" : undefined}
          onClick={() => onSelect(event)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{event.type}</span>
            <span className="text-xs text-muted-foreground">{event.timestamp ?? `#${event.lineNumber}`}</span>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs" data-allow-select="true">
            {eventText(event) || JSON.stringify(event.raw, null, 2)}
          </pre>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Add inspector**

Create `desktop/src/modules/usage-analysis/cc/components/conversation-event-inspector.tsx`:

```tsx
import type { CcRawConversationEvent } from "@/types/usage-analysis-conversations"

export function ConversationEventInspector({ event }: { readonly event: CcRawConversationEvent | null }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">字段</h3>
      {event ? (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-card p-3 text-xs" data-allow-select="true">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      ) : (
        <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">选择事件</div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add detail page**

Create `desktop/src/modules/usage-analysis/cc/components/conversation-detail-window-page.tsx`:

```tsx
import { useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  CcConversationDetail,
  CcConversationWindowRequest,
  CcRawConversationEvent,
} from "@/types/usage-analysis-conversations"
import { ConversationEventInspector } from "./conversation-event-inspector"
import { ConversationEventStream } from "./conversation-event-stream"

export function CcConversationDetailWindowPage({ request }: { readonly request: CcConversationWindowRequest }) {
  const [detail, setDetail] = useState<CcConversationDetail | null>(null)
  const [selected, setSelected] = useState<CcRawConversationEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    requireSynapseBridge().usageAnalysis.cc.getConversation(request.sessionId, request.focus)
      .then((next) => {
        if (cancelled) return
        setDetail(next)
        const focused = next.events.find((event) => event.id === request.focus?.eventId)
          ?? next.events.find((event) => event.timestampMs === request.focus?.timestampMs)
          ?? next.events[0]
          ?? null
        setSelected(focused)
      })
      .catch(() => {
        if (!cancelled) setError("读取失败")
      })
    return () => {
      cancelled = true
    }
  }, [request.sessionId, request.focus?.eventId, request.focus?.timestampMs])

  if (error) return <div className="p-3 text-sm text-destructive">{error}</div>
  if (!detail) return <div className="p-3 text-sm text-muted-foreground">加载中</div>

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{detail.session.title || request.title || detail.session.sessionId}</h1>
          <div className="truncate text-xs text-muted-foreground">{detail.session.workspaceLabel || detail.session.sourceFilePath}</div>
        </div>
        <div className="text-xs text-muted-foreground">{detail.events.length} 事件</div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_360px] gap-2 p-2">
        <aside className="min-h-0 overflow-auto rounded-md border bg-card p-2">
          <h2 className="text-sm font-medium">事件</h2>
          <div className="mt-2 flex flex-col gap-1">
            {detail.events.map((event) => (
              <button key={event.id} type="button" className="truncate rounded-md px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => setSelected(event)}>
                {event.type}
              </button>
            ))}
          </div>
        </aside>
        <section className="min-h-0 overflow-auto">
          <ConversationEventStream events={detail.events} selectedId={selected?.id} onSelect={setSelected} />
        </section>
        <aside className="min-h-0 overflow-hidden">
          <ConversationEventInspector event={selected} />
        </aside>
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Route standalone window in App**

In `desktop/src/App.tsx`, import:

```ts
import { parseCcConversationWindowRequest } from "@/lib/cc-conversation-window"
import { CcConversationDetailWindowPage } from "@/modules/usage-analysis/cc/components/conversation-detail-window-page"
```

In `App`, add state and parse:

```tsx
  const [ccConversationWindowRequest, setCcConversationWindowRequest] = useState<ReturnType<typeof parseCcConversationWindowRequest>>(null)

  useEffect(() => {
    setCcConversationWindowRequest(parseCcConversationWindowRequest(window.location.search))
  }, [])
```

Before the content window branch, add:

```tsx
  if (ccConversationWindowRequest) {
    return (
      <IdentityGate>
        <ErrorBoundary fallbackTitle="对话窗口出现问题">
          <CcConversationDetailWindowPage request={ccConversationWindowRequest} />
        </ErrorBoundary>
      </IdentityGate>
    )
  }
```

- [ ] **Step 7: Run detail window tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx desktop/src/lib/__tests__/cc-conversation-window.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/usage-analysis/cc/components/conversation-detail-window-page.tsx desktop/src/modules/usage-analysis/cc/components/conversation-event-stream.tsx desktop/src/modules/usage-analysis/cc/components/conversation-event-inspector.tsx desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx desktop/src/App.tsx
git commit -m "feat: add cc conversation detail window"
```

## Task 7: Report Linkage And Details Actions

**Files:**

- Modify: `desktop/electron/services/usage-analysis/types.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`
- Modify: `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/pages/details.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx`

- [ ] **Step 1: Write report row tests**

In `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`, add this test inside the existing `describe("usage analysis reports", () => {` block:

```ts
it("includes stable focus fields in CC details rows", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
  tempDirs.push(dir)
  const db = getUsageAnalysisDb(dir)
  const service = new CcUsageAnalysisService({ db, roots: [] })
  db.prepare(`
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
      input_tokens, output_tokens
    ) VALUES ('usage-1', 'session-1', 1779843600000, '2026-05-27', '2026-05-27 09', '-repo', '/repo', 'claude-opus-4.6', 'anthropic', 10, 5)
  `).run()

  expect(service.getDetails({ preset: "all", limit: 10 })[0]).toEqual(expect.objectContaining({
    id: "usage-1",
    usageEventId: "usage-1",
    sessionId: "session-1",
    timestampMs: 1779843600000,
  }))
})
```

In `desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx`, add:

```tsx
it("renders detail rows with an open conversation action", () => {
  const html = renderToStaticMarkup(
    <DetailsReportView
      state={state([{
        id: "usage-1",
        usageEventId: "usage-1",
        timestamp: "2026-05-27T01:00:00.000Z",
        timestampMs: 1779843600000,
        sessionId: "session-1",
        workspaceLabel: "/repo",
        model: "claude-opus-4.6",
        tokens: 15,
        pricedTokens: 15,
        unpricedTokens: 0,
        estimatedCost: 0.01,
        tokenBreakdown: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
        toolCalls: 1,
      }], false)}
      onOpenConversation={() => undefined}
    />,
  )

  expect(html).toContain("打开对话")
})
```

- [ ] **Step 2: Run report tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/usage-analysis/__tests__/reports.test.ts desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx
```

Expected: FAIL because detail rows do not expose all focus fields and no button exists.

- [ ] **Step 3: Extend detail row type**

In `desktop/electron/services/usage-analysis/types.ts` and matching `desktop/src/types/bridge.ts`, add to detail row:

```ts
  readonly usageEventId?: string
  readonly timestampMs?: number
```

Keep `id` unchanged for backward compatibility.

- [ ] **Step 4: Populate focus fields**

In `desktop/electron/services/usage-analysis/cc-service.ts`, update `getDetails` mapping:

```ts
      usageEventId: row.id,
      timestampMs: row.timestamp_ms,
```

- [ ] **Step 5: Add detail action callback**

In `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`, update `DetailsReportView` signature:

```tsx
export function DetailsReportView({
  state,
  onOpenConversation,
}: {
  readonly state: LoaderState<UsageDetailRow[]>
  readonly onOpenConversation?: (row: UsageDetailRow) => void
}) {
```

Add a final table head:

```tsx
              {onOpenConversation ? <TableHead className="text-right">操作</TableHead> : null}
```

Add a cell in each row:

```tsx
                {onOpenConversation ? (
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation(row)}>
                      打开对话
                    </Button>
                  </TableCell>
                ) : null}
```

Import `Button` from `@/components/ui/button`.

- [ ] **Step 6: Wire CC details page**

In `desktop/src/modules/usage-analysis/cc/pages/details.tsx`:

```tsx
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { DetailsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcDetails } from "../hooks"

export function CcDetailsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return (
    <DetailsReportView
      state={useCcDetails(range, refreshKey)}
      onOpenConversation={(row) => {
        void requireSynapseBridge().usageAnalysis.cc.openConversationWindow({
          sessionId: row.sessionId,
          title: row.workspaceLabel,
          focus: {
            usageEventId: row.usageEventId ?? row.id,
            timestampMs: row.timestampMs,
          },
        })
      }}
    />
  )
}
```

- [ ] **Step 7: Run report linkage tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/usage-analysis/__tests__/reports.test.ts desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/usage-analysis/types.ts desktop/src/types/bridge.ts desktop/electron/services/usage-analysis/cc-service.ts desktop/electron/services/usage-analysis/__tests__/reports.test.ts desktop/src/modules/usage-analysis/shared/components/report-views.tsx desktop/src/modules/usage-analysis/cc/pages/details.tsx desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx
git commit -m "feat: link cc details to raw conversations"
```

## Task 8: Polish, Release Notes, And Full Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`
- Touch only files that fail verification from previous tasks.

- [ ] **Step 1: Add release note**

Append one user-facing bullet under the pending notes section:

```md
- CC 使用分析新增“对话”查询入口，可以从会话列表或明细打开独立窗口查看 Claude Code 原始对话、工具调用和事件字段。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/usage-analysis/__tests__/cc-conversation-parser.test.ts \
  desktop/electron/services/usage-analysis/__tests__/cc-conversation-service.test.ts \
  desktop/electron/services/__tests__/cc-conversation-window-service.test.ts \
  desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts \
  desktop/electron/__tests__/preload.test.ts \
  desktop/src/lib/__tests__/cc-conversation-window.test.ts \
  desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx \
  desktop/src/modules/usage-analysis/__tests__/cc-conversations-page.test.tsx \
  desktop/src/modules/usage-analysis/__tests__/cc-conversation-detail-window-page.test.tsx \
  desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx \
  desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx \
  desktop/src/modules/usage-analysis/__tests__/codex-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for UI rule violations**

Run:

```bash
git diff --check
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" desktop/src/modules/usage-analysis desktop/electron/services/usage-analysis desktop/electron/usage-analysis desktop/electron/preload.ts
```

Expected:

- `git diff --check` exits 0.
- `rg` returns no new UI color/style/gradient violations and no `console.log`.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note cc conversation query"
```

If verification fixes touched additional files, include only those task-related files in this commit and mention them in the commit message.

## Final Acceptance Criteria

- CC analysis has a `对话` tab.
- The tab lists sessions from the lightweight `usage.db` index.
- Default search does not scan raw transcript text.
- Raw text search is opt-in and reads JSONL on demand.
- A session row opens a separate detail window.
- The detail window renders all raw event categories and exposes raw JSON fields.
- CC detail rows can open the raw conversation window with focus metadata.
- Renderer never reads files directly.
- No full transcript content is written into `usage.db`.
- Tests and typecheck pass.
