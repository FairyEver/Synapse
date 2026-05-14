# Token Usage Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite tokscale's core functionality as a built-in Synapse module with GUI visualization, covering 21 AI agent parsers, SQLite caching, and 6 dashboard views.

**Architecture:** Main process service handles file scanning, parsing, and SQLite storage. Renderer communicates via IPC. Parsers are modular — one file per agent (or shared generic parser). Frontend uses shadcn components with recharts for visualization.

**Tech Stack:** Electron main process (Node.js), node:sqlite DatabaseSync, readline for JSONL streaming, recharts for charts, shadcn/ui components, Tailwind CSS.

**Reference:** tokscale source at `/Users/liyang/Documents/code/demo/tokscale-main`

**Spec:** `docs/superpowers/specs/2026-05-04-token-usage-monitor-design.md`

---

## File Structure

### Main Process (Electron)

```
desktop/electron/services/token-usage/
├── index.ts                  # Service entry: init, scan, query APIs
├── clients.ts                # 21 ClientDef declarations + PathRoot resolver
├── scanner.ts                # File discovery + fingerprint-based incremental scan
├── db.ts                     # SQLite schema, read/write, migrations
├── aggregator.ts             # Query helpers: daily, model, hourly, graph result
├── parsers/
│   ├── types.ts              # UnifiedMessage, TokenBreakdown, AgentParser interface
│   ├── utils.ts              # Shared: extractI64, parseTimestamp, fileModifiedMs
│   ├── claude.ts             # Claude Code JSONL parser
│   ├── codex.ts              # Codex JSONL stateful parser
│   └── generic-jsonl.ts      # Shared parser for simple JSONL agents
desktop/electron/token-usage/
├── channels.ts               # IPC channel constants
├── ipc-handlers.ts           # IPC handler registration
```

### Renderer (React)

```
desktop/src/modules/token-usage/
├── index.tsx                 # Module entry: sub-tab navigation + scan trigger
├── hooks/
│   └── use-token-usage.ts    # IPC call wrappers
├── components/
│   ├── overview-view.tsx     # Stacked bar chart + top models
│   ├── models-view.tsx       # Model breakdown table
│   ├── daily-view.tsx        # Daily usage table
│   ├── stats-view.tsx        # Contribution graph + stats panel
│   ├── contribution-graph.tsx # GitHub-style heatmap
│   ├── stacked-bar-chart.tsx # Recharts stacked bar
│   └── scan-button.tsx       # Refresh button with loading state
└── lib/
    ├── format.ts             # Number formatting (1.2M, $3.45)
    └── colors.ts             # Provider color palette
```

---

## Phase 1 — Core Pipeline

### Task 1: Types & Interfaces

**Files:**
- Create: `desktop/electron/services/token-usage/parsers/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// desktop/electron/services/token-usage/parsers/types.ts

export interface TokenBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

export interface UnifiedMessage {
  client: string
  modelId: string
  providerId: string
  sessionId: string
  workspaceKey?: string
  workspaceLabel?: string
  timestamp: number
  date: string
  tokens: TokenBreakdown
  cost: number
  messageCount: number
  agent?: string
  dedupKey?: string
  isTurnStart: boolean
}

export interface AgentParser {
  parseFile(filePath: string): Promise<UnifiedMessage[]>
}

export type PathRoot = "home" | "xdgData" | "config" | "envVar"

export interface ClientDef {
  id: string
  name: string
  root: PathRoot
  envVar?: string
  fallbackRelative?: string
  relativePath: string
  filePattern: string
  parseLocal: boolean
}

export interface ScanResult {
  clientId: string
  files: string[]
}

export interface FileFingerprint {
  filePath: string
  clientId: string
  size: number
  mtimeMs: number
  bytesParsed: number
}

export interface DailyContribution {
  date: string
  totals: { tokens: number; cost: number; messages: number }
  intensity: 0 | 1 | 2 | 3 | 4
  tokenBreakdown: TokenBreakdown
  clients: ClientContribution[]
}

export interface ClientContribution {
  client: string
  modelId: string
  providerId: string
  tokens: TokenBreakdown
  cost: number
  messages: number
}

export interface DataSummary {
  totalTokens: number
  totalCost: number
  totalDays: number
  activeDays: number
  averagePerDay: number
  maxCostInSingleDay: number
  clients: string[]
  models: string[]
}

export interface ModelUsage {
  client: string
  model: string
  provider: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  cost: number
}

export interface HourlyUsage {
  hour: string
  clients: string[]
  models: string[]
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  turnCount: number
  cost: number
}

export interface GraphResult {
  meta: { generatedAt: string; processingTimeMs: number }
  summary: DataSummary
  years: { year: string; totalTokens: number; totalCost: number }[]
  contributions: DailyContribution[]
}

export interface ScanProgress {
  totalClients: number
  scannedClients: number
  totalFiles: number
  parsedFiles: number
  newMessages: number
  elapsedMs: number
}

export function emptyBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

export function totalTokens(b: TokenBreakdown): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/parsers/types.ts
git commit -m "feat(token-usage): add core type definitions"
```

---

### Task 2: Parser Utilities

**Files:**
- Create: `desktop/electron/services/token-usage/parsers/utils.ts`

- [ ] **Step 1: Create shared parser utilities**

Translated from tokscale `src/sessions/utils.rs`. Key functions: `extractI64` (handles number/string/null), `parseTimestamp` (RFC3339/ms/s auto-detect), `fileModifiedMs`, `timestampToLocalDate`, `normalizeAgentName` (zero-width strip + special mappings).

```typescript
// desktop/electron/services/token-usage/parsers/utils.ts
import fs from "node:fs"

export function extractI64(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Math.floor(value)
  if (typeof value === "string") {
    const parsed = parseInt(value, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function parseTimestamp(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "string") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.getTime()
    const numeric = parseInt(value, 10)
    if (!Number.isNaN(numeric)) {
      return numeric >= 1_000_000_000_000 ? numeric : numeric * 1000
    }
    return 0
  }
  if (typeof value === "number") {
    if (value <= 0) return 0
    return value >= 1_000_000_000_000 ? value : value * 1000
  }
  return 0
}

export function fileModifiedMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return Date.now()
  }
}

export function timestampToLocalDate(ms: number): string {
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function normalizeAgentName(raw: string): string {
  let name = raw.replace(/[​‌‍﻿]/g, "").trim()
  name = name.replace(/^(astrape|oh-my-claudecode|oh-my-codex):/, "")
  name = name.replace(/\s+/g, " ").trim()
  if (!name) return "unknown"

  const lower = name.toLowerCase()
  if (lower === "omo" || lower === "sisyphus") return "Sisyphus"
  if (lower === "orchestrator-sisyphus") return "Atlas"
  if (lower.includes("plan")) {
    if (lower === "omo-plan") return "Planner-Sisyphus"
  }

  return name
    .split(/[-\s]+/)
    .map((w) => {
      const upper = w.toUpperCase()
      if (["UI", "UX", "API"].includes(upper)) return upper
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(" ")
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/parsers/utils.ts
git commit -m "feat(token-usage): add parser utility functions"
```

---

### Task 3: Client Definitions (Agent Registry)

**Files:**
- Create: `desktop/electron/services/token-usage/clients.ts`

- [ ] **Step 1: Create the 21-agent registry**

Translated from tokscale `src/clients.rs`. Each `ClientDef` declares: id, display name, root type, relative path, file glob pattern. `resolvePathRoot` maps root types to absolute paths on macOS. `getExtraScanPaths` handles the 9 agents with special scan logic (Codex archived_sessions, OpenClaw legacy brands, Pi OMP path, RooCode/KiloCode vscode-server, Copilot env var, Codebuff channels).

```typescript
// desktop/electron/services/token-usage/clients.ts
import os from "node:os"
import path from "node:path"
import type { ClientDef, PathRoot } from "./parsers/types"

export const CLIENT_DEFS: ClientDef[] = [
  { id: "opencode", name: "OpenCode", root: "xdgData", relativePath: "opencode/storage/message", filePattern: "*.json", parseLocal: true },
  { id: "claude", name: "Claude Code", root: "home", relativePath: ".claude/projects", filePattern: "*.jsonl", parseLocal: true },
  { id: "codex", name: "Codex", root: "envVar", envVar: "CODEX_HOME", fallbackRelative: ".codex", relativePath: "sessions", filePattern: "*.jsonl", parseLocal: true },
  { id: "gemini", name: "Gemini", root: "home", relativePath: ".gemini/tmp", filePattern: "*.json|*.jsonl", parseLocal: true },
  { id: "amp", name: "Amp", root: "xdgData", relativePath: "amp/threads", filePattern: "T-*.json", parseLocal: true },
  { id: "droid", name: "Droid", root: "home", relativePath: ".factory/sessions", filePattern: "*.settings.json", parseLocal: true },
  { id: "openclaw", name: "OpenClaw", root: "home", relativePath: ".openclaw/agents", filePattern: "*.jsonl*", parseLocal: true },
  { id: "pi", name: "Pi", root: "home", relativePath: ".pi/agent/sessions", filePattern: "*.jsonl", parseLocal: true },
  { id: "kimi", name: "Kimi", root: "home", relativePath: ".kimi/sessions", filePattern: "wire.jsonl", parseLocal: true },
  { id: "qwen", name: "Qwen", root: "home", relativePath: ".qwen/projects", filePattern: "*.jsonl", parseLocal: true },
  { id: "roocode", name: "Roo Code", root: "home", relativePath: ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks", filePattern: "ui_messages.json", parseLocal: true },
  { id: "kilocode", name: "Kilo Code", root: "home", relativePath: ".config/Code/User/globalStorage/kilocode.kilo-code/tasks", filePattern: "ui_messages.json", parseLocal: true },
  { id: "mux", name: "Mux", root: "home", relativePath: ".mux/sessions", filePattern: "session-usage.json", parseLocal: true },
  { id: "kilo", name: "Kilo", root: "xdgData", relativePath: "kilo/kilo.db", filePattern: "kilo.db", parseLocal: true },
  { id: "crush", name: "Crush", root: "xdgData", relativePath: "crush/projects.json", filePattern: "projects.json", parseLocal: true },
  { id: "hermes", name: "Hermes", root: "envVar", envVar: "HERMES_HOME", fallbackRelative: ".hermes", relativePath: "state.db", filePattern: "state.db", parseLocal: true },
  { id: "copilot", name: "Copilot", root: "home", relativePath: ".copilot/otel", filePattern: "*.jsonl", parseLocal: true },
  { id: "goose", name: "Goose", root: "xdgData", relativePath: "goose/sessions/sessions.db", filePattern: "sessions.db", parseLocal: true },
  { id: "codebuff", name: "Codebuff", root: "envVar", envVar: "CODEBUFF_DATA_DIR", fallbackRelative: ".config/manicode", relativePath: "projects", filePattern: "chat-messages.json", parseLocal: true },
  { id: "antigravity", name: "Antigravity", root: "config", relativePath: "antigravity-cache/sessions", filePattern: "*.jsonl", parseLocal: true },
]

export function resolvePathRoot(root: PathRoot, def: ClientDef): string {
  const home = os.homedir()
  switch (root) {
    case "home":
      return home
    case "xdgData":
      return process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
    case "config":
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "tokscale")
    case "envVar": {
      if (def.envVar && process.env[def.envVar]) return process.env[def.envVar]!
      return path.join(home, def.fallbackRelative || "")
    }
  }
}

export function resolveClientBasePath(def: ClientDef): string {
  return path.join(resolvePathRoot(def.root, def), def.relativePath)
}

export function getExtraScanPaths(def: ClientDef): string[] {
  const home = os.homedir()
  const extras: string[] = []
  switch (def.id) {
    case "codex": {
      const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
      extras.push(path.join(codexHome, "archived_sessions"))
      break
    }
    case "openclaw":
      extras.push(
        path.join(home, ".clawdbot", "agents"),
        path.join(home, ".moltbot", "agents"),
        path.join(home, ".moldbot", "agents"),
      )
      break
    case "pi":
      extras.push(path.join(home, ".omp", "agent", "sessions"))
      break
    case "roocode":
      extras.push(path.join(home, ".vscode-server", "data", "User", "globalStorage", "rooveterinaryinc.roo-cline", "tasks"))
      break
    case "kilocode":
      extras.push(path.join(home, ".vscode-server", "data", "User", "globalStorage", "kilocode.kilo-code", "tasks"))
      break
    case "copilot": {
      const otelPath = process.env.COPILOT_OTEL_FILE_EXPORTER_PATH
      if (otelPath) extras.push(path.dirname(otelPath))
      break
    }
    case "codebuff": {
      const base = process.env.CODEBUFF_DATA_DIR || path.join(home, ".config", "manicode")
      extras.push(
        path.join(path.dirname(base), "manicode-dev", "projects"),
        path.join(path.dirname(base), "manicode-staging", "projects"),
      )
      break
    }
  }
  return extras
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/clients.ts
git commit -m "feat(token-usage): add 21-agent client registry"
```

---

### Task 4: SQLite Database Layer

**Files:**
- Create: `desktop/electron/services/token-usage/db.ts`

- [ ] **Step 1: Create the database module**

Uses `node:sqlite` DatabaseSync (same pattern as `desktop/electron/database/service.ts`). Three tables: `file_fingerprints` (incremental scan), `usage_daily` (aggregated data with UNIQUE on client+model_id+provider_id+date), `scan_meta` (key-value metadata). DB location: `app.getPath("userData")/token-usage.db`.

Key operations: `getFingerprint`/`upsertFingerprint` for incremental scan, `upsertDailyUsage` with ON CONFLICT accumulation, `clearDailyUsageForClient` for full re-parse, `clearAllData` for reset.

```typescript
// desktop/electron/services/token-usage/db.ts
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { app } from "electron"
import type { FileFingerprint, UnifiedMessage } from "./parsers/types"

let db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (db) return db
  const dbPath = path.join(app.getPath("userData"), "token-usage.db")
  db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  initSchema(db)
  return db
}

function initSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS file_fingerprints (
      file_path TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      bytes_parsed INTEGER NOT NULL DEFAULT 0
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      model_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      date TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      turn_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      UNIQUE(client, model_id, provider_id, date)
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

export function getFingerprint(filePath: string): FileFingerprint | null {
  const row = getDb()
    .prepare("SELECT file_path, client_id, size, mtime_ms, bytes_parsed FROM file_fingerprints WHERE file_path = ?")
    .get(filePath) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    filePath: row.file_path as string,
    clientId: row.client_id as string,
    size: row.size as number,
    mtimeMs: row.mtime_ms as number,
    bytesParsed: row.bytes_parsed as number,
  }
}

export function upsertFingerprint(fp: FileFingerprint): void {
  getDb()
    .prepare(
      `INSERT INTO file_fingerprints (file_path, client_id, size, mtime_ms, bytes_parsed)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         size = excluded.size, mtime_ms = excluded.mtime_ms, bytes_parsed = excluded.bytes_parsed`,
    )
    .run(fp.filePath, fp.clientId, fp.size, fp.mtimeMs, fp.bytesParsed)
}

export function upsertDailyUsage(messages: UnifiedMessage[]): void {
  const database = getDb()
  const stmt = database.prepare(
    `INSERT INTO usage_daily (client, model_id, provider_id, date, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count, turn_count, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client, model_id, provider_id, date) DO UPDATE SET
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
       cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
       reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
       message_count = message_count + excluded.message_count,
       turn_count = turn_count + excluded.turn_count,
       cost_usd = cost_usd + excluded.cost_usd`,
  )
  for (const msg of messages) {
    stmt.run(msg.client, msg.modelId, msg.providerId, msg.date,
      msg.tokens.input, msg.tokens.output, msg.tokens.cacheRead, msg.tokens.cacheWrite,
      msg.tokens.reasoning, msg.messageCount, msg.isTurnStart ? 1 : 0, msg.cost)
  }
}

export function clearDailyUsageForClient(clientId: string): void {
  getDb().prepare("DELETE FROM usage_daily WHERE client = ?").run(clientId)
}

export function clearFingerprintsForClient(clientId: string): void {
  getDb().prepare("DELETE FROM file_fingerprints WHERE client_id = ?").run(clientId)
}

export function clearAllData(): void {
  const database = getDb()
  database.exec("DELETE FROM usage_daily")
  database.exec("DELETE FROM file_fingerprints")
  database.exec("DELETE FROM scan_meta")
}

export function setScanMeta(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO scan_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value)
}

export function getScanMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM scan_meta WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value ?? null
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/db.ts
git commit -m "feat(token-usage): add SQLite database layer"
```

---

### Task 5: Claude Code Parser

**Files:**
- Create: `desktop/electron/services/token-usage/parsers/claude.ts`

- [ ] **Step 1: Create the Claude Code JSONL parser**

Translated from tokscale `src/sessions/claudecode.rs`. Core logic:
1. Stream JSONL via `readline`, fast-skip lines not containing `"type":"assistant"`
2. Parse JSON, extract `message.usage` and `message.model`
3. Dedup via `messageId:requestId` composite key with per-field max merge (each token field independently takes the max across duplicate lines — handles streaming partial updates)
4. `isHumanTurn` detection: returns false for JSON arrays (tool results) and lines starting with internal tags (`<local-command-stdout>`, `<bash-input>`, `<system-reminder>`, etc.)
5. Workspace extraction: search path segments for `[".claude", "projects", workspaceKey]` pattern
6. Token mapping: `input_tokens`→input, `output_tokens`→output, `cache_read_input_tokens`→cacheRead, `cache_creation_input_tokens`→cacheWrite, reasoning=0

```typescript
// desktop/electron/services/token-usage/parsers/claude.ts
import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { emptyBreakdown } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface DedupEntry {
  msg: UnifiedMessage
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const INTERNAL_TAGS = [
  "<local-command-stdout>", "<local-command-stderr>",
  "<command-name>", "<command-message>",
  "<system-reminder>", "<bash-input>",
  "<bash-stdout>", "<bash-stderr>",
]

function isHumanTurn(content: unknown): boolean {
  if (Array.isArray(content)) return false
  if (typeof content !== "string") return false
  const trimmed = content.trimStart()
  return !INTERNAL_TAGS.some((tag) => trimmed.startsWith(tag))
}

function extractWorkspace(filePath: string): { key?: string; label?: string } {
  const segments = filePath.split(path.sep)
  for (let i = 0; i < segments.length - 2; i++) {
    if (segments[i] === ".claude" && segments[i + 1] === "projects") {
      const key = segments[i + 2]
      if (key) {
        const label = key.split(/[-/]/).pop() || key
        return { key, label }
      }
    }
  }
  return {}
}

export const claudeParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const dedup = new Map<string, DedupEntry>()
    const fallbackTs = fileModifiedMs(filePath)
    const workspace = extractWorkspace(filePath)

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.includes('"type":"assistant"')) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type !== "assistant") continue
        const msg = obj.message
        if (!msg?.usage) continue

        const usage = msg.usage
        const input = Math.max(0, extractI64(usage.input_tokens))
        const output = Math.max(0, extractI64(usage.output_tokens))
        const cacheRead = Math.max(0, extractI64(usage.cache_read_input_tokens))
        const cacheWrite = Math.max(0, extractI64(usage.cache_creation_input_tokens))

        if (input + output === 0) continue

        const messageId = msg.id || ""
        const requestId = obj.requestId || ""
        const dedupKey = `${messageId}:${requestId}`

        const ts = parseTimestamp(obj.timestamp) || fallbackTs
        const isTurnStart = obj.parentMessageId
          ? isHumanTurn(obj.parentMessageContent)
          : false

        if (dedupKey !== ":" && dedup.has(dedupKey)) {
          const existing = dedup.get(dedupKey)!
          existing.input = Math.max(existing.input, input)
          existing.output = Math.max(existing.output, output)
          existing.cacheRead = Math.max(existing.cacheRead, cacheRead)
          existing.cacheWrite = Math.max(existing.cacheWrite, cacheWrite)
          existing.msg.tokens = {
            input: existing.input,
            output: existing.output,
            cacheRead: existing.cacheRead,
            cacheWrite: existing.cacheWrite,
            reasoning: 0,
          }
          continue
        }

        const unified: UnifiedMessage = {
          client: "claude",
          modelId: msg.model || "unknown",
          providerId: "anthropic",
          sessionId: obj.sessionId || "",
          workspaceKey: workspace.key,
          workspaceLabel: workspace.label,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
          cost: 0,
          messageCount: 1,
          agent: obj.isSidechain ? (obj.agentId || "claude-code-subagent") : undefined,
          dedupKey: dedupKey !== ":" ? dedupKey : undefined,
          isTurnStart,
        }

        if (dedupKey !== ":") {
          dedup.set(dedupKey, { msg: unified, input, output, cacheRead, cacheWrite })
        } else {
          dedup.set(`anon-${dedup.size}`, { msg: unified, input, output, cacheRead, cacheWrite })
        }
      } catch {
        // skip malformed lines
      }
    }

    return Array.from(dedup.values()).map((e) => e.msg)
  },
}
```

- [ ] **Step 2: Verify against local data**

Run: `cd desktop && npx tsx -e "import { claudeParser } from './electron/services/token-usage/parsers/claude'; ..."`

Or add a quick smoke test script. The parser should produce results consistent with the POC (`docs/poc-token-usage.js`) which found ~19K Claude Code messages.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/token-usage/parsers/claude.ts
git commit -m "feat(token-usage): add Claude Code JSONL parser"
```

---

### Task 6: Codex Parser

**Files:**
- Create: `desktop/electron/services/token-usage/parsers/codex.ts`

- [ ] **Step 1: Create the Codex JSONL stateful parser**

Translated from tokscale `src/sessions/codex.rs`. This is the most complex parser due to stateful cumulative-to-delta conversion.

Core logic:
1. Maintain `CodexParseState`: `currentModel`, `previousTotals`, `sessionProvider`, `sessionAgent`, `sessionWorkspace`
2. Three event types: `session_meta` (provider/agent/workspace), `turn_context` (model name via 5-level priority: `model_info.slug` → `model` → `model_name` → `info.model` → `info.model_name`), `event_msg` with `payload.type === "token_count"` (core counting)
3. Cumulative delta: Codex reports running totals. Compute `current - previous` for each field. If any field regresses, check `looksLikeStaleRegression` (within 98% or recoverable by 2×last) — if stale, skip; otherwise treat as session reset.
4. Delayed model binding: `token_count` may arrive before `turn_context`. Push to `pendingModelMessages` queue, flush when model discovered.
5. Token mapping: `input_tokens - cached_input_tokens` → input, `output_tokens` → output, `cached_input_tokens` → cacheRead, cacheWrite=0, `reasoning_output_tokens` → reasoning

```typescript
// desktop/electron/services/token-usage/parsers/codex.ts
import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface CodexTotals {
  input: number
  output: number
  cached: number
  reasoning: number
}

function totalOf(t: CodexTotals): number {
  return t.input + t.output + t.cached + t.reasoning
}

function deltaFrom(current: CodexTotals, previous: CodexTotals): CodexTotals | null {
  if (current.input < previous.input || current.output < previous.output
    || current.cached < previous.cached || current.reasoning < previous.reasoning) {
    return null
  }
  return {
    input: current.input - previous.input,
    output: current.output - previous.output,
    cached: current.cached - previous.cached,
    reasoning: current.reasoning - previous.reasoning,
  }
}

function looksLikeStaleRegression(current: CodexTotals, previous: CodexTotals, last: CodexTotals): boolean {
  const prevTotal = totalOf(previous)
  const curTotal = totalOf(current)
  const lastTotal = totalOf(last)
  if (prevTotal <= 0 || curTotal <= 0 || lastTotal <= 0) return false
  return (curTotal * 100 >= prevTotal * 98) || (curTotal + lastTotal * 2 >= prevTotal)
}

function extractModel(payload: Record<string, unknown>): string | null {
  const info = payload.model_info as Record<string, unknown> | undefined
  if (info?.slug && typeof info.slug === "string" && info.slug.length > 0) return info.slug
  if (typeof payload.model === "string" && payload.model.length > 0) return payload.model
  if (typeof payload.model_name === "string" && payload.model_name.length > 0) return payload.model_name
  const infoObj = payload.info as Record<string, unknown> | undefined
  if (typeof infoObj?.model === "string" && (infoObj.model as string).length > 0) return infoObj.model as string
  if (typeof infoObj?.model_name === "string" && (infoObj.model_name as string).length > 0) return infoObj.model_name as string
  return null
}

export const codexParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const pendingModelMessages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const sessionId = path.basename(filePath, ".jsonl")

    let currentModel: string | null = null
    let previousTotals: CodexTotals | null = null
    let lastDelta: CodexTotals = { input: 0, output: 0, cached: 0, reasoning: 0 }
    let sessionProvider: string | null = null
    let sessionAgent: string | null = null
    let sessionWorkspaceKey: string | undefined
    let sessionWorkspaceLabel: string | undefined

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.includes("token_count") && !line.includes("turn_context") && !line.includes("session_meta")) continue
      try {
        const obj = JSON.parse(line)
        const payload = obj.payload as Record<string, unknown> | undefined
        if (!payload) continue
        const ts = parseTimestamp(obj.timestamp) || fallbackTs

        // session_meta
        if (payload.type === "session_meta" || obj.type === "session_meta") {
          sessionProvider = (payload.provider as string) || null
          sessionAgent = (payload.agent as string) || null
          const cwd = payload.cwd as string | undefined
          if (cwd) {
            sessionWorkspaceKey = cwd
            sessionWorkspaceLabel = path.basename(cwd)
          }
          continue
        }

        // turn_context — extract model
        if (obj.type === "turn_context" || payload.type === "turn_context") {
          const model = extractModel(payload)
          if (model) {
            currentModel = model
            for (const pending of pendingModelMessages) {
              pending.modelId = model
            }
            messages.push(...pendingModelMessages)
            pendingModelMessages.length = 0
          }
          continue
        }

        // event_msg with token_count
        if (payload.type !== "token_count") continue
        const info = payload.info as Record<string, unknown> | undefined
        if (!info) continue
        const totalUsage = info.total_token_usage as Record<string, unknown> | undefined
        if (!totalUsage) continue

        const current: CodexTotals = {
          input: extractI64(totalUsage.input_tokens),
          output: extractI64(totalUsage.output_tokens),
          cached: extractI64(totalUsage.cached_input_tokens),
          reasoning: extractI64(totalUsage.reasoning_output_tokens),
        }

        let delta: CodexTotals
        if (previousTotals) {
          const d = deltaFrom(current, previousTotals)
          if (d) {
            delta = d
          } else if (looksLikeStaleRegression(current, previousTotals, lastDelta)) {
            previousTotals = current
            continue
          } else {
            delta = current
          }
        } else {
          delta = current
        }
        previousTotals = current

        const netInput = Math.max(0, delta.input - delta.cached)
        if (netInput + delta.output === 0) continue

        lastDelta = delta

        const unified: UnifiedMessage = {
          client: "codex",
          modelId: currentModel || "unknown",
          providerId: sessionProvider || "openai",
          sessionId,
          workspaceKey: sessionWorkspaceKey,
          workspaceLabel: sessionWorkspaceLabel,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input: netInput,
            output: delta.output,
            cacheRead: delta.cached,
            cacheWrite: 0,
            reasoning: delta.reasoning,
          },
          cost: 0,
          messageCount: 1,
          agent: sessionAgent || undefined,
          isTurnStart: false,
        }

        if (currentModel) {
          messages.push(unified)
        } else {
          pendingModelMessages.push(unified)
        }
      } catch {
        // skip malformed lines
      }
    }

    // Flush remaining pending messages with unknown model
    for (const pending of pendingModelMessages) {
      pending.modelId = "unknown"
      messages.push(pending)
    }

    return messages
  },
}
```

- [ ] **Step 2: Verify against local data**

The POC found ~57.3K Codex messages. Run a quick check that the parser produces similar counts.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/token-usage/parsers/codex.ts
git commit -m "feat(token-usage): add Codex JSONL stateful parser"
```

---

### Task 7: Generic JSONL Parser

**Files:**
- Create: `desktop/electron/services/token-usage/parsers/generic-jsonl.ts`

- [ ] **Step 1: Create the generic JSONL parser**

Covers simple JSONL agents that share a common pattern: OpenClaw, Pi, Kimi, Qwen, Mux, Droid, Antigravity. Each has slightly different field paths but the same basic structure: read JSONL, extract model/usage/timestamp, output UnifiedMessage.

The generic parser accepts a config object that maps field paths for each agent. This avoids duplicating the readline boilerplate across 7+ files.

```typescript
// desktop/electron/services/token-usage/parsers/generic-jsonl.ts
import fs from "node:fs"
import readline from "node:readline"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface GenericJsonlConfig {
  clientId: string
  providerId: string
  lineFilter?: string
  extractModel: (obj: Record<string, unknown>) => string
  extractUsage: (obj: Record<string, unknown>) => {
    input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number
  } | null
  extractTimestamp: (obj: Record<string, unknown>) => unknown
  extractSessionId?: (obj: Record<string, unknown>) => string
}

export function createGenericJsonlParser(config: GenericJsonlConfig): AgentParser {
  return {
    async parseFile(filePath: string): Promise<UnifiedMessage[]> {
      const messages: UnifiedMessage[] = []
      const fallbackTs = fileModifiedMs(filePath)

      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      })

      for await (const line of rl) {
        if (config.lineFilter && !line.includes(config.lineFilter)) continue
        try {
          const obj = JSON.parse(line)
          const usage = config.extractUsage(obj)
          if (!usage) continue
          if (usage.input + usage.output === 0) continue

          const ts = parseTimestamp(config.extractTimestamp(obj)) || fallbackTs
          messages.push({
            client: config.clientId,
            modelId: config.extractModel(obj) || "unknown",
            providerId: config.providerId,
            sessionId: config.extractSessionId?.(obj) || "",
            timestamp: ts,
            date: timestampToLocalDate(ts),
            tokens: usage,
            cost: 0,
            messageCount: 1,
            isTurnStart: false,
          })
        } catch {
          // skip malformed lines
        }
      }

      return messages
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/parsers/generic-jsonl.ts
git commit -m "feat(token-usage): add generic JSONL parser factory"
```

---

### Task 8: File Scanner

**Files:**
- Create: `desktop/electron/services/token-usage/scanner.ts`

- [ ] **Step 1: Create the file scanner**

Discovers files for all 21 agents. For each `ClientDef`: resolve base path → check directory exists → recursive walk matching `filePattern` → add extra scan paths → canonicalize and deduplicate. Returns `Map<clientId, filePath[]>`.

File pattern matching supports `*` glob and `|` alternation (e.g., `*.json|*.jsonl`). Uses `fs.readdirSync` recursive walk — no external glob library needed.

```typescript
// desktop/electron/services/token-usage/scanner.ts
import fs from "node:fs"
import path from "node:path"
import { CLIENT_DEFS, resolveClientBasePath, getExtraScanPaths } from "./clients"
import type { ClientDef, ScanResult } from "./parsers/types"

function matchesPattern(fileName: string, pattern: string): boolean {
  const patterns = pattern.split("|")
  return patterns.some((p) => {
    if (p === fileName) return true
    if (p.startsWith("*")) {
      return fileName.endsWith(p.slice(1))
    }
    if (p.endsWith("*")) {
      return fileName.startsWith(p.slice(0, -1))
    }
    if (p.includes("*")) {
      const [prefix, suffix] = p.split("*", 2)
      return fileName.startsWith(prefix) && fileName.endsWith(suffix)
    }
    return false
  })
}

function collectFiles(dir: string, pattern: string, result: string[], maxDepth = 10): void {
  if (maxDepth <= 0) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        collectFiles(full, pattern, result, maxDepth - 1)
      } else if (matchesPattern(entry.name, pattern)) {
        result.push(full)
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }
}

export function scanAllClients(): ScanResult[] {
  const results: ScanResult[] = []

  for (const def of CLIENT_DEFS) {
    if (!def.parseLocal) continue

    const files: string[] = []
    const seen = new Set<string>()

    const basePath = resolveClientBasePath(def)
    collectFiles(basePath, def.filePattern, files)

    const extraPaths = getExtraScanPaths(def)
    for (const extra of extraPaths) {
      collectFiles(extra, def.filePattern, files)
    }

    // Deduplicate by resolved path
    const uniqueFiles: string[] = []
    for (const f of files) {
      try {
        const resolved = fs.realpathSync(f)
        if (!seen.has(resolved)) {
          seen.add(resolved)
          uniqueFiles.push(f)
        }
      } catch {
        if (!seen.has(f)) {
          seen.add(f)
          uniqueFiles.push(f)
        }
      }
    }

    if (uniqueFiles.length > 0) {
      results.push({ clientId: def.id, files: uniqueFiles })
    }
  }

  return results
}

export function getClientDef(clientId: string): ClientDef | undefined {
  return CLIENT_DEFS.find((d) => d.id === clientId)
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/scanner.ts
git commit -m "feat(token-usage): add file scanner with incremental support"
```

---

### Task 9: Aggregator (Query Helpers)

**Files:**
- Create: `desktop/electron/services/token-usage/aggregator.ts`

- [ ] **Step 1: Create the aggregator module**

Reads from `usage_daily` SQLite table and produces the aggregated views: `GraphResult` (overview + contribution graph), model report, daily report, hourly report. All queries use `DatabaseSync.prepare().all()`.

Key aggregations:
- `getGraphResult`: GROUP BY date → DailyContribution array with intensity levels (0-4 based on percentile), plus DataSummary and yearly totals
- `getModelReport`: GROUP BY client, model_id, provider_id → ModelUsage array
- `getDailyReport`: GROUP BY date → daily totals with turn counts
- Intensity calculation: sort daily totals, assign 0=zero, 1=bottom 25%, 2=25-50%, 3=50-75%, 4=top 25%

```typescript
// desktop/electron/services/token-usage/aggregator.ts
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { app } from "electron"
import type {
  GraphResult, DataSummary, DailyContribution, ModelUsage,
  TokenBreakdown, ClientContribution,
} from "./parsers/types"

function getDb(): DatabaseSync {
  const dbPath = path.join(app.getPath("userData"), "token-usage.db")
  return new DatabaseSync(dbPath, { open: true })
}

interface DailyRow {
  date: string
  client: string
  model_id: string
  provider_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  message_count: number
  turn_count: number
  cost_usd: number
}

export function getGraphResult(options?: { since?: string; until?: string }): GraphResult {
  const start = Date.now()
  const db = getDb()

  let query = "SELECT * FROM usage_daily"
  const conditions: string[] = []
  const params: string[] = []
  if (options?.since) { conditions.push("date >= ?"); params.push(options.since) }
  if (options?.until) { conditions.push("date <= ?"); params.push(options.until) }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ")
  query += " ORDER BY date ASC"

  const rows = db.prepare(query).all(...params) as DailyRow[]

  // Group by date
  const byDate = new Map<string, DailyRow[]>()
  for (const row of rows) {
    const existing = byDate.get(row.date) || []
    existing.push(row)
    byDate.set(row.date, existing)
  }

  // Build contributions
  const dailyTotals: { date: string; tokens: number; cost: number }[] = []
  const contributions: DailyContribution[] = []
  const allClients = new Set<string>()
  const allModels = new Set<string>()
  let totalTokens = 0, totalCost = 0, maxDayCost = 0

  for (const [date, dateRows] of byDate) {
    let dayTokens = 0, dayCost = 0, dayMessages = 0
    const breakdown: TokenBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
    const clients: ClientContribution[] = []

    for (const r of dateRows) {
      const rowTokens = r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens + r.reasoning_tokens
      dayTokens += rowTokens
      dayCost += r.cost_usd
      dayMessages += r.message_count
      breakdown.input += r.input_tokens
      breakdown.output += r.output_tokens
      breakdown.cacheRead += r.cache_read_tokens
      breakdown.cacheWrite += r.cache_write_tokens
      breakdown.reasoning += r.reasoning_tokens
      allClients.add(r.client)
      allModels.add(r.model_id)
      clients.push({
        client: r.client, modelId: r.model_id, providerId: r.provider_id,
        tokens: { input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens, cacheWrite: r.cache_write_tokens, reasoning: r.reasoning_tokens },
        cost: r.cost_usd, messages: r.message_count,
      })
    }

    totalTokens += dayTokens
    totalCost += dayCost
    maxDayCost = Math.max(maxDayCost, dayCost)
    dailyTotals.push({ date, tokens: dayTokens, cost: dayCost })
    contributions.push({
      date, totals: { tokens: dayTokens, cost: dayCost, messages: dayMessages },
      intensity: 0, tokenBreakdown: breakdown, clients,
    })
  }

  // Calculate intensity levels
  const sorted = [...dailyTotals].filter((d) => d.tokens > 0).sort((a, b) => a.tokens - b.tokens)
  if (sorted.length > 0) {
    const thresholds = [0.25, 0.5, 0.75].map((p) => sorted[Math.floor(p * (sorted.length - 1))].tokens)
    for (const c of contributions) {
      if (c.totals.tokens === 0) c.intensity = 0
      else if (c.totals.tokens <= thresholds[0]) c.intensity = 1
      else if (c.totals.tokens <= thresholds[1]) c.intensity = 2
      else if (c.totals.tokens <= thresholds[2]) c.intensity = 3
      else c.intensity = 4
    }
  }

  // Yearly totals
  const yearMap = new Map<string, { tokens: number; cost: number }>()
  for (const d of dailyTotals) {
    const year = d.date.slice(0, 4)
    const existing = yearMap.get(year) || { tokens: 0, cost: 0 }
    existing.tokens += d.tokens
    existing.cost += d.cost
    yearMap.set(year, existing)
  }

  const activeDays = contributions.filter((c) => c.totals.tokens > 0).length
  const summary: DataSummary = {
    totalTokens, totalCost,
    totalDays: contributions.length,
    activeDays,
    averagePerDay: activeDays > 0 ? totalTokens / activeDays : 0,
    maxCostInSingleDay: maxDayCost,
    clients: [...allClients],
    models: [...allModels],
  }

  return {
    meta: { generatedAt: new Date().toISOString(), processingTimeMs: Date.now() - start },
    summary,
    years: [...yearMap.entries()].map(([year, v]) => ({ year, totalTokens: v.tokens, totalCost: v.cost })),
    contributions,
  }
}

export function getModelReport(): ModelUsage[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT client, model_id, provider_id,
      SUM(input_tokens) as input, SUM(output_tokens) as output,
      SUM(cache_read_tokens) as cacheRead, SUM(cache_write_tokens) as cacheWrite,
      SUM(reasoning_tokens) as reasoning, SUM(message_count) as messageCount,
      SUM(cost_usd) as cost
    FROM usage_daily GROUP BY client, model_id, provider_id
    ORDER BY (SUM(input_tokens) + SUM(output_tokens) + SUM(cache_read_tokens) + SUM(cache_write_tokens) + SUM(reasoning_tokens)) DESC
  `).all() as Record<string, unknown>[]

  return rows.map((r) => ({
    client: r.client as string,
    model: r.model_id as string,
    provider: r.provider_id as string,
    input: r.input as number,
    output: r.output as number,
    cacheRead: r.cacheRead as number,
    cacheWrite: r.cacheWrite as number,
    reasoning: r.reasoning as number,
    messageCount: r.messageCount as number,
    cost: r.cost as number,
  }))
}

export function getDailyReport(): Record<string, unknown>[] {
  const db = getDb()
  return db.prepare(`
    SELECT date,
      SUM(input_tokens) as input, SUM(output_tokens) as output,
      SUM(cache_read_tokens) as cacheRead, SUM(cache_write_tokens) as cacheWrite,
      SUM(reasoning_tokens) as reasoning, SUM(message_count) as messages,
      SUM(turn_count) as turns, SUM(cost_usd) as cost
    FROM usage_daily GROUP BY date ORDER BY date DESC
  `).all() as Record<string, unknown>[]
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/aggregator.ts
git commit -m "feat(token-usage): add data aggregator with graph result and reports"
```

---

### Task 10: Service Entry Point

**Files:**
- Create: `desktop/electron/services/token-usage/index.ts`

- [ ] **Step 1: Create the service entry**

Orchestrates the full scan pipeline: scanner discovers files → check fingerprints → parse changed files → upsert daily usage → update fingerprints. Exports the public API that IPC handlers call.

```typescript
// desktop/electron/services/token-usage/index.ts
import fs from "node:fs"
import { scanAllClients, getClientDef } from "./scanner"
import { getFingerprint, upsertFingerprint, upsertDailyUsage, clearDailyUsageForClient, clearFingerprintsForClient, clearAllData, setScanMeta } from "./db"
import { getGraphResult, getModelReport, getDailyReport } from "./aggregator"
import { claudeParser } from "./parsers/claude"
import { codexParser } from "./parsers/codex"
import type { AgentParser, ScanProgress, UnifiedMessage } from "./parsers/types"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("token-usage")

const PARSERS: Record<string, AgentParser> = {
  claude: claudeParser,
  codex: codexParser,
}

function getParser(clientId: string): AgentParser | null {
  return PARSERS[clientId] || null
}

export async function scanTokenUsage(): Promise<ScanProgress> {
  const start = Date.now()
  const scanResults = scanAllClients()
  const progress: ScanProgress = {
    totalClients: scanResults.length,
    scannedClients: 0,
    totalFiles: scanResults.reduce((sum, r) => sum + r.files.length, 0),
    parsedFiles: 0,
    newMessages: 0,
    elapsedMs: 0,
  }

  for (const result of scanResults) {
    const parser = getParser(result.clientId)
    if (!parser) {
      progress.scannedClients++
      continue
    }

    for (const filePath of result.files) {
      try {
        const stat = fs.statSync(filePath)
        const fp = getFingerprint(filePath)

        // Check if file needs parsing
        if (fp && fp.size === stat.size && fp.mtimeMs === stat.mtimeMs) {
          continue // cache hit
        }

        // Full re-parse if file shrunk or mtime changed with same size
        if (fp && (stat.size < fp.size || (stat.size === fp.size && stat.mtimeMs !== fp.mtimeMs))) {
          clearDailyUsageForClient(result.clientId)
          clearFingerprintsForClient(result.clientId)
        }

        const messages = await parser.parseFile(filePath)
        if (messages.length > 0) {
          upsertDailyUsage(messages)
          progress.newMessages += messages.length
        }

        upsertFingerprint({
          filePath,
          clientId: result.clientId,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          bytesParsed: stat.size,
        })

        progress.parsedFiles++
      } catch (error) {
        logger.error("Failed to parse file", { filePath, error: String(error) })
      }
    }

    progress.scannedClients++
  }

  progress.elapsedMs = Date.now() - start
  setScanMeta("lastScanAt", new Date().toISOString())
  setScanMeta("lastScanMs", String(progress.elapsedMs))
  logger.info("Scan complete", {
    clients: progress.scannedClients,
    files: progress.parsedFiles,
    messages: progress.newMessages,
    elapsedMs: progress.elapsedMs,
  })

  return progress
}

export { getGraphResult, getModelReport, getDailyReport, clearAllData }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/services/token-usage/index.ts
git commit -m "feat(token-usage): add service entry point with scan orchestration"
```

---

### Task 11: IPC Channels & Handlers

**Files:**
- Create: `desktop/electron/token-usage/channels.ts`
- Create: `desktop/electron/token-usage/ipc-handlers.ts`

- [ ] **Step 1: Create IPC channel constants**

Follow the pattern from `desktop/electron/database/channels.ts`.

```typescript
// desktop/electron/token-usage/channels.ts
export const TOKEN_USAGE_CHANNELS = {
  scan: "synapse:token-usage:scan",
  getGraphResult: "synapse:token-usage:graph-result",
  getModelReport: "synapse:token-usage:model-report",
  getDailyReport: "synapse:token-usage:daily-report",
  getDetectedAgents: "synapse:token-usage:detected-agents",
  clearData: "synapse:token-usage:clear-data",
} as const
```

- [ ] **Step 2: Create IPC handlers**

Follow the pattern from `desktop/electron/database/ipc-handlers.ts`.

```typescript
// desktop/electron/token-usage/ipc-handlers.ts
import { TOKEN_USAGE_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { scanTokenUsage, getGraphResult, getModelReport, getDailyReport, clearAllData } from "../services/token-usage"
import { scanAllClients } from "../services/token-usage/scanner"
import { CLIENT_DEFS } from "../services/token-usage/clients"

let handlersRegistered = false

export function registerTokenUsageHandlers(): void {
  if (handlersRegistered) return

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.scan, async () => {
    return scanTokenUsage()
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getGraphResult, async (_event, options?: { since?: string; until?: string }) => {
    return getGraphResult(options)
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getModelReport, async () => {
    return getModelReport()
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getDailyReport, async () => {
    return getDailyReport()
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.getDetectedAgents, async () => {
    const results = scanAllClients()
    return results.map((r) => {
      const def = CLIENT_DEFS.find((d) => d.id === r.clientId)
      return { id: r.clientId, name: def?.name || r.clientId, fileCount: r.files.length }
    })
  })

  handleValidatedIpc(TOKEN_USAGE_CHANNELS.clearData, async () => {
    clearAllData()
  })

  handlersRegistered = true
}
```

- [ ] **Step 3: Register handlers in app bootstrap**

In the main process bootstrap file (where `registerDatabaseHandlers()` is called), add:

```typescript
import { registerTokenUsageHandlers } from "../token-usage/ipc-handlers"
// ... in the init function:
registerTokenUsageHandlers()
```

- [ ] **Step 4: Add to preload bridge**

In `desktop/electron/preload.ts`, add to the `IPC_CHANNELS` object:

```typescript
"token-usage": {
  scan: "synapse:token-usage:scan",
  getGraphResult: "synapse:token-usage:graph-result",
  getModelReport: "synapse:token-usage:model-report",
  getDailyReport: "synapse:token-usage:daily-report",
  getDetectedAgents: "synapse:token-usage:detected-agents",
  clearData: "synapse:token-usage:clear-data",
},
```

And in the `synapseBridge` object:

```typescript
tokenUsage: {
  scan: invoke(IPC_CHANNELS["token-usage"].scan),
  getGraphResult: (options?: { since?: string; until?: string }) =>
    invoke(IPC_CHANNELS["token-usage"].getGraphResult)(options),
  getModelReport: invoke(IPC_CHANNELS["token-usage"].getModelReport),
  getDailyReport: invoke(IPC_CHANNELS["token-usage"].getDailyReport),
  getDetectedAgents: invoke(IPC_CHANNELS["token-usage"].getDetectedAgents),
  clearData: invoke(IPC_CHANNELS["token-usage"].clearData),
},
```

- [ ] **Step 5: Add bridge types**

In `desktop/src/types/bridge.ts`, add to the `SynapseBridge` type:

```typescript
tokenUsage: {
  scan: () => Promise<ScanProgress>
  getGraphResult: (options?: { since?: string; until?: string }) => Promise<GraphResult>
  getModelReport: () => Promise<ModelUsage[]>
  getDailyReport: () => Promise<Record<string, unknown>[]>
  getDetectedAgents: () => Promise<{ id: string; name: string; fileCount: number }[]>
  clearData: () => Promise<void>
}
```

Import the types from the shared types file or re-declare them in the bridge types.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/token-usage/ desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat(token-usage): add IPC channels, handlers, and bridge types"
```

---

### Task 12: Frontend Utilities (Format + Colors)

**Files:**
- Create: `desktop/src/modules/token-usage/lib/format.ts`
- Create: `desktop/src/modules/token-usage/lib/colors.ts`

- [ ] **Step 1: Create number formatting utilities**

Aligned with tokscale formatting rules: tokens use compact notation (1.2B, 3.4M, 56K), cost uses dollar format ($1.2K or $3.45), cache ratio as multiplier (2.3x).

```typescript
// desktop/src/modules/token-usage/lib/format.ts

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

export function formatCost(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(2)}`
  if (n > 0) return `$${n.toFixed(4)}`
  return "$0.00"
}

export function formatCacheRatio(cacheRead: number, input: number, cacheWrite: number): string {
  const denominator = input + cacheWrite
  if (denominator === 0) return "0.0x"
  return `${(cacheRead / denominator).toFixed(1)}x`
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%"
  return `${((value / total) * 100).toFixed(1)}%`
}
```

- [ ] **Step 2: Create provider color palette**

Aligned with tokscale provider colors.

```typescript
// desktop/src/modules/token-usage/lib/colors.ts

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#DA7756",
  openai: "#10B981",
  google: "#3B82F6",
  deepseek: "#06B6D4",
  xai: "#EAB308",
  meta: "#6366F1",
  unknown: "#888888",
}

export function getProviderColor(providerId: string): string {
  return PROVIDER_COLORS[providerId.toLowerCase()] || PROVIDER_COLORS.unknown
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/token-usage/lib/
git commit -m "feat(token-usage): add formatting utilities and provider colors"
```

---

### Task 13: Frontend Hook (IPC Wrapper)

**Files:**
- Create: `desktop/src/modules/token-usage/hooks/use-token-usage.ts`

- [ ] **Step 1: Create the IPC hook**

Follow the pattern from `desktop/src/modules/database/hooks/use-database.ts`. Wraps all token-usage IPC calls with loading/error state management.

```typescript
// desktop/src/modules/token-usage/hooks/use-token-usage.ts
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

function toLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error("读取失败")
}

export function useTokenUsageScan() {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const result = await requireSynapseBridge().tokenUsage.scan()
      return result
    } catch (e) {
      setError(toLoadError(e))
      return null
    } finally {
      setScanning(false)
    }
  }, [])

  return { scan, scanning, error }
}

export function useGraphResult() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: { since?: string; until?: string }) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getGraphResult(options)
      setData(result as Record<string, unknown>)
      setError(null)
    } catch (e) {
      setData(null)
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useModelReport() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getModelReport()
      setData(result as Record<string, unknown>[])
      setError(null)
    } catch (e) {
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useDailyReport() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getDailyReport()
      setData(result as Record<string, unknown>[])
      setError(null)
    } catch (e) {
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useDetectedAgents() {
  const [agents, setAgents] = useState<{ id: string; name: string; fileCount: number }[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getDetectedAgents()
      setAgents(result)
    } catch {
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { agents, loading, refresh }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/token-usage/hooks/
git commit -m "feat(token-usage): add IPC hook wrappers"
```

---

### Task 14: Scan Button Component

**Files:**
- Create: `desktop/src/modules/token-usage/components/scan-button.tsx`

- [ ] **Step 1: Create the scan button**

Simple button with loading spinner. Uses shadcn `Button` component. Shows elapsed time and message count after scan completes.

```typescript
// desktop/src/modules/token-usage/components/scan-button.tsx
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ScanButtonProps {
  scanning: boolean
  onScan: () => void
  lastScanInfo?: { elapsedMs: number; newMessages: number } | null
}

export function ScanButton({ scanning, onScan, lastScanInfo }: ScanButtonProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onScan} disabled={scanning}>
        <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Scanning..." : "Refresh"}
      </Button>
      {lastScanInfo && !scanning ? (
        <span className="text-xs text-muted-foreground">
          {lastScanInfo.newMessages} messages in {(lastScanInfo.elapsedMs / 1000).toFixed(1)}s
        </span>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/token-usage/components/scan-button.tsx
git commit -m "feat(token-usage): add scan button component"
```

---

### Task 15: Overview View

**Files:**
- Create: `desktop/src/modules/token-usage/components/overview-view.tsx`
- Create: `desktop/src/modules/token-usage/components/stacked-bar-chart.tsx`

- [ ] **Step 1: Install recharts**

```bash
cd desktop && pnpm add recharts
```

- [ ] **Step 2: Create the stacked bar chart component**

Uses recharts `BarChart` with stacked bars. Each bar represents a day, stacked by model. Colors from provider palette.

```typescript
// desktop/src/modules/token-usage/components/stacked-bar-chart.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { formatTokens } from "../lib/format"
import { getProviderColor } from "../lib/colors"

interface StackedBarChartProps {
  contributions: Array<{
    date: string
    clients: Array<{ modelId: string; providerId: string; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number } }>
  }>
}

export function StackedBarChart({ contributions }: StackedBarChartProps) {
  // Aggregate by model across all days to find top models
  const modelTotals = new Map<string, { total: number; providerId: string }>()
  for (const c of contributions) {
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const existing = modelTotals.get(cl.modelId) || { total: 0, providerId: cl.providerId }
      existing.total += total
      modelTotals.set(cl.modelId, existing)
    }
  }

  // Top 8 models, rest grouped as "other"
  const sorted = [...modelTotals.entries()].sort((a, b) => b[1].total - a[1].total)
  const topModels = sorted.slice(0, 8).map(([id]) => id)

  // Build chart data
  const chartData = contributions.map((c) => {
    const entry: Record<string, unknown> = { date: c.date.slice(5) }
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const key = topModels.includes(cl.modelId) ? cl.modelId : "other"
      entry[key] = ((entry[key] as number) || 0) + total
    }
    return entry
  })

  const modelColors = new Map<string, string>()
  for (const [id, info] of modelTotals) {
    modelColors.set(id, getProviderColor(info.providerId))
  }
  modelColors.set("other", "#888888")

  const barKeys = [...topModels, ...(sorted.length > 8 ? ["other"] : [])]

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={formatTokens} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value: number) => formatTokens(value)} />
        {barKeys.map((key) => (
          <Bar key={key} dataKey={key} stackId="tokens" fill={modelColors.get(key) || "#888"} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: Create the overview view**

Combines stacked bar chart with top models ranking and total cost display.

```typescript
// desktop/src/modules/token-usage/components/overview-view.tsx
import { StackedBarChart } from "./stacked-bar-chart"
import { formatTokens, formatCost, formatPercent } from "../lib/format"
import { getProviderColor } from "../lib/colors"

interface OverviewViewProps {
  graphResult: {
    summary: { totalTokens: number; totalCost: number; models: string[] }
    contributions: Array<{
      date: string
      clients: Array<{
        modelId: string; providerId: string
        tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }
        cost: number
      }>
    }>
  }
}

export function OverviewView({ graphResult }: OverviewViewProps) {
  const { summary, contributions } = graphResult

  // Aggregate by model for top models table
  const modelMap = new Map<string, { providerId: string; tokens: number; cost: number }>()
  for (const c of contributions) {
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const existing = modelMap.get(cl.modelId) || { providerId: cl.providerId, tokens: 0, cost: 0 }
      existing.tokens += total
      existing.cost += cl.cost
      modelMap.set(cl.modelId, existing)
    }
  }
  const topModels = [...modelMap.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tokens per Day</h3>
        <span className="text-sm text-muted-foreground">
          Total: {formatCost(summary.totalCost)}
        </span>
      </div>
      <StackedBarChart contributions={contributions} />
      <div>
        <h3 className="mb-2 text-sm font-medium">Top Models</h3>
        <div className="space-y-1">
          {topModels.map(([modelId, info], i) => (
            <div key={modelId} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: getProviderColor(info.providerId) }}
              />
              <span className="flex-1 truncate">{modelId}</span>
              <span className="text-muted-foreground">{formatPercent(info.tokens, summary.totalTokens)}</span>
              <span className="w-20 text-right">{formatTokens(info.tokens)}</span>
              <span className="w-16 text-right text-muted-foreground">{formatCost(info.cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/token-usage/components/overview-view.tsx desktop/src/modules/token-usage/components/stacked-bar-chart.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(token-usage): add overview view with stacked bar chart"
```

---

### Task 16: Models View

**Files:**
- Create: `desktop/src/modules/token-usage/components/models-view.tsx`

- [ ] **Step 1: Create the models table view**

Table columns: # | Model | Provider | Source | Input | Output | Cache R | Cache W | Total | Cost. Sorted by total tokens descending. Uses shadcn `Table` component.

```typescript
// desktop/src/modules/token-usage/components/models-view.tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost } from "../lib/format"
import { getProviderColor } from "../lib/colors"

interface ModelRow {
  client: string
  model: string
  provider: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  messageCount: number
  cost: number
}

interface ModelsViewProps {
  models: ModelRow[]
}

export function ModelsView({ models }: ModelsViewProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Cache R</TableHead>
          <TableHead className="text-right">Cache W</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((m, i) => {
          const total = m.input + m.output + m.cacheRead + m.cacheWrite + m.reasoning
          return (
            <TableRow key={`${m.client}-${m.model}-${m.provider}`}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium">{m.model}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getProviderColor(m.provider) }} />
                  {m.provider}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{m.client}</TableCell>
              <TableCell className="text-right">{formatTokens(m.input)}</TableCell>
              <TableCell className="text-right">{formatTokens(m.output)}</TableCell>
              <TableCell className="text-right">{formatTokens(m.cacheRead)}</TableCell>
              <TableCell className="text-right">{formatTokens(m.cacheWrite)}</TableCell>
              <TableCell className="text-right font-medium">{formatTokens(total)}</TableCell>
              <TableCell className="text-right">{formatCost(m.cost)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/token-usage/components/models-view.tsx
git commit -m "feat(token-usage): add models table view"
```

---

### Task 17: Daily View

**Files:**
- Create: `desktop/src/modules/token-usage/components/daily-view.tsx`

- [ ] **Step 1: Create the daily table view**

Table columns: Date | Turns | Msgs | Input | Output | Cache R | Cache W | Total | Cost. Today's row highlighted. Sorted by date descending.

```typescript
// desktop/src/modules/token-usage/components/daily-view.tsx
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost } from "../lib/format"

interface DailyRow {
  date: string
  turns: number
  messages: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
}

interface DailyViewProps {
  rows: DailyRow[]
}

export function DailyView({ rows }: DailyViewProps) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Turns</TableHead>
          <TableHead className="text-right">Msgs</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Cache R</TableHead>
          <TableHead className="text-right">Cache W</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const total = r.input + r.output + r.cacheRead + r.cacheWrite + r.reasoning
          const isToday = r.date === today
          return (
            <TableRow key={r.date} className={isToday ? "bg-muted/50" : undefined}>
              <TableCell className={isToday ? "font-medium" : ""}>{r.date}</TableCell>
              <TableCell className="text-right">{r.turns}</TableCell>
              <TableCell className="text-right">{r.messages}</TableCell>
              <TableCell className="text-right">{formatTokens(r.input)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.output)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.cacheRead)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.cacheWrite)}</TableCell>
              <TableCell className="text-right font-medium">{formatTokens(total)}</TableCell>
              <TableCell className="text-right">{formatCost(r.cost)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/token-usage/components/daily-view.tsx
git commit -m "feat(token-usage): add daily table view"
```

---

### Task 18: Stats View (Contribution Graph)

**Files:**
- Create: `desktop/src/modules/token-usage/components/contribution-graph.tsx`
- Create: `desktop/src/modules/token-usage/components/stats-view.tsx`

- [ ] **Step 1: Create the contribution graph component**

GitHub-style 52-week × 7-day heatmap. Pure CSS grid, no chart library needed. Intensity 0-4 maps to opacity levels. Tooltip on hover shows date and token count.

```typescript
// desktop/src/modules/token-usage/components/contribution-graph.tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatTokens } from "../lib/format"

interface ContributionDay {
  date: string
  tokens: number
  intensity: 0 | 1 | 2 | 3 | 4
}

interface ContributionGraphProps {
  contributions: ContributionDay[]
}

const INTENSITY_CLASSES = [
  "bg-muted",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-500",
  "bg-emerald-700 dark:bg-emerald-300",
]

export function ContributionGraph({ contributions }: ContributionGraphProps) {
  // Build 52-week grid ending today
  const today = new Date()
  const grid: (ContributionDay | null)[][] = []
  const contribMap = new Map(contributions.map((c) => [c.date, c]))

  // Start from 52 weeks ago, aligned to Sunday
  const start = new Date(today)
  start.setDate(start.getDate() - 52 * 7 - start.getDay())

  for (let week = 0; week < 53; week++) {
    const col: (ContributionDay | null)[] = []
    for (let day = 0; day < 7; day++) {
      const d = new Date(start)
      d.setDate(d.getDate() + week * 7 + day)
      if (d > today) {
        col.push(null)
        continue
      }
      const dateStr = d.toISOString().slice(0, 10)
      col.push(contribMap.get(dateStr) || { date: dateStr, tokens: 0, intensity: 0 })
    }
    grid.push(col)
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex gap-0.5 overflow-x-auto">
        {grid.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day, di) => {
              if (!day) return <div key={di} className="h-2.5 w-2.5" />
              return (
                <Tooltip key={di}>
                  <TooltipTrigger asChild>
                    <div
                      className={`h-2.5 w-2.5 rounded-[2px] ${INTENSITY_CLASSES[day.intensity]}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p>{day.date}</p>
                    <p>{formatTokens(day.tokens)} tokens</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ))}
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: Create the stats view**

Combines contribution graph with summary statistics panel.

```typescript
// desktop/src/modules/token-usage/components/stats-view.tsx
import { ContributionGraph } from "./contribution-graph"
import { formatTokens, formatCost } from "../lib/format"

interface StatsViewProps {
  graphResult: {
    summary: {
      totalTokens: number; totalCost: number
      activeDays: number; totalDays: number
      averagePerDay: number; models: string[]
    }
    contributions: Array<{
      date: string
      totals: { tokens: number }
      intensity: 0 | 1 | 2 | 3 | 4
    }>
  }
}

function calculateStreak(contributions: Array<{ date: string; totals: { tokens: number } }>): {
  current: number; longest: number
} {
  const sorted = [...contributions].sort((a, b) => a.date.localeCompare(b.date))
  let current = 0, longest = 0, streak = 0
  const today = new Date().toISOString().slice(0, 10)

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].totals.tokens > 0) {
      streak++
      longest = Math.max(longest, streak)
    } else {
      if (current === 0) current = streak
      streak = 0
    }
  }
  if (current === 0) current = streak

  return { current, longest: Math.max(longest, streak) }
}

export function StatsView({ graphResult }: StatsViewProps) {
  const { summary, contributions } = graphResult
  const streaks = calculateStreak(contributions)

  const contribDays = contributions.map((c) => ({
    date: c.date,
    tokens: c.totals.tokens,
    intensity: c.intensity,
  }))

  const stats = [
    { label: "Active days", value: String(summary.activeDays) },
    { label: "Current streak", value: `${streaks.current} days` },
    { label: "Longest streak", value: `${streaks.longest} days` },
    { label: "Total tokens", value: formatTokens(summary.totalTokens) },
    { label: "Total cost", value: formatCost(summary.totalCost) },
    { label: "Avg per day", value: formatTokens(summary.averagePerDay) },
    { label: "Models used", value: String(summary.models.length) },
  ]

  return (
    <div className="flex flex-col gap-6">
      <ContributionGraph contributions={contribDays} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-medium">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/token-usage/components/contribution-graph.tsx desktop/src/modules/token-usage/components/stats-view.tsx
git commit -m "feat(token-usage): add stats view with contribution graph"
```

---

### Task 19: Module Entry + App Integration

**Files:**
- Create: `desktop/src/modules/token-usage/index.tsx`
- Modify: `desktop/src/App.tsx:38` (AppTabId type)
- Modify: `desktop/src/App.tsx:110-122` (tabs array)
- Modify: `desktop/src/App.tsx:327-351` (module render block)

- [ ] **Step 1: Create the module entry component**

Sub-tab navigation between Overview / Models / Daily / Stats views. Scan button in header. Auto-scans on first mount.

```typescript
// desktop/src/modules/token-usage/index.tsx
import { useState, useEffect, useCallback } from "react"
import { useTokenUsageScan, useGraphResult, useModelReport, useDailyReport } from "./hooks/use-token-usage"
import { ScanButton } from "./components/scan-button"
import { OverviewView } from "./components/overview-view"
import { ModelsView } from "./components/models-view"
import { DailyView } from "./components/daily-view"
import { StatsView } from "./components/stats-view"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"

type SubTab = "overview" | "models" | "daily" | "stats"

export function TokenUsageModule() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("overview")
  const { scan, scanning } = useTokenUsageScan()
  const { data: graphResult, refresh: refreshGraph } = useGraphResult()
  const { data: models, refresh: refreshModels } = useModelReport()
  const { data: dailyRows, refresh: refreshDaily } = useDailyReport()
  const [lastScanInfo, setLastScanInfo] = useState<{ elapsedMs: number; newMessages: number } | null>(null)
  const [hasScanned, setHasScanned] = useState(false)

  const handleScan = useCallback(async () => {
    const result = await scan()
    if (result) {
      setLastScanInfo({ elapsedMs: result.elapsedMs, newMessages: result.newMessages })
      void refreshGraph()
      void refreshModels()
      void refreshDaily()
    }
  }, [scan, refreshGraph, refreshModels, refreshDaily])

  useEffect(() => {
    if (!hasScanned) {
      setHasScanned(true)
      void handleScan()
    }
  }, [hasScanned, handleScan])

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as SubTab)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>
        </Tabs>
        <ScanButton scanning={scanning} onScan={handleScan} lastScanInfo={lastScanInfo} />
      </div>
      <ScrollArea className="flex-1">
        {activeSubTab === "overview" && graphResult ? (
          <OverviewView graphResult={graphResult as any} />
        ) : null}
        {activeSubTab === "models" ? (
          <ModelsView models={models as any[]} />
        ) : null}
        {activeSubTab === "daily" ? (
          <DailyView rows={dailyRows as any[]} />
        ) : null}
        {activeSubTab === "stats" && graphResult ? (
          <StatsView graphResult={graphResult as any} />
        ) : null}
      </ScrollArea>
    </div>
  )
}
```

- [ ] **Step 2: Add "token-usage" to AppTabId type**

In `desktop/src/App.tsx:38`, change:

```typescript
// Before:
type AppTabId = SynapseContentType | "agent" | "database" | "task-scheduler" | "editor-scan" | "settings"

// After:
type AppTabId = SynapseContentType | "agent" | "database" | "task-scheduler" | "editor-scan" | "token-usage" | "settings"
```

- [ ] **Step 3: Add tab entry**

In `desktop/src/App.tsx:110-122`, add before the settings entry:

```typescript
{ id: "token-usage" as const, label: "Token Usage" },
```

- [ ] **Step 4: Add module render block**

In `desktop/src/App.tsx`, after the editor-scan block (around line 346), add:

```typescript
{activeTab === "token-usage" ? (
  <ErrorBoundary fallbackTitle="Token Usage 模块出现问题">
    <TokenUsageModule />
  </ErrorBoundary>
) : null}
```

And add the import at the top:

```typescript
import { TokenUsageModule } from "@/modules/token-usage"
```

- [ ] **Step 5: Verify the app builds**

Run: `cd desktop && pnpm typecheck`
Expected: No type errors

- [ ] **Step 6: Start dev server and verify**

Run: `pnpm dev`

Open the app, click the "Token Usage" tab. Verify:
1. Tab appears in the sidebar
2. Auto-scan triggers on first visit
3. Overview shows stacked bar chart with data
4. Models table shows model breakdown
5. Daily table shows per-day data with today highlighted
6. Stats shows contribution graph and statistics

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/token-usage/index.tsx desktop/src/App.tsx
git commit -m "feat(token-usage): add module entry and app integration"
```

---

## Phase 2 — Extended Coverage (Future)

Phase 2 tasks are outlined here for reference. Each will be a separate implementation cycle.

### Task 20: Remaining Agent Parsers

Add parsers for the remaining agents. Priority order:
1. Gemini (3 format variants, promptTokenCount cache subtraction)
2. Amp (JSON with thread structure)
3. RooCode/KiloCode (JSON array, filter `say: "api_req_started"`)
4. OpenClaw/Pi/Kimi/Qwen/Mux/Droid/Antigravity (generic JSONL with config)
5. Copilot (OpenTelemetry JSONL, traceId:spanId dedup)
6. OpenCode/Kilo/Hermes/Goose/Crush (SQLite readers)
7. Codebuff (chat-messages.json)

### Task 21: Hourly + Agents Views

- Hourly view: table with hour-level granularity
- Agents view: table grouped by agent with token/cost totals
- Add hourly aggregation query to aggregator.ts

### Task 22: LiteLLM Pricing Integration

- Fetch pricing JSON from LiteLLM GitHub
- 4-level model matching (exact → provider prefix → suffix strip → fuzzy)
- 200K threshold tiered pricing
- Offline fallback with bundled pricing data

### Task 23: Date Range Filtering

- Add date picker to module header
- Pass since/until to all queries
- Persist last-used range in scan_meta

---

## Phase 3 — UX Polish (Future)

### Task 24: Scan Progress Bar
### Task 25: Hourly Profile Mode (Morning/Daytime/Evening/Night)
### Task 26: Contribution Graph Click → Day Detail
### Task 27: GroupBy Toggle for Models View
### Task 28: Data Export (JSON)
