# Terminal App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Synapse system app that hosts real persistent terminal sessions and exposes authorized session control through `synapse-mcp`.

**Architecture:** Add `desktop/app-capabilities/terminal/` as an App Capability Package. Electron Main owns `node-pty` processes through `TerminalService`; Renderer attaches with `@xterm/xterm`; MCP and IPC both call the same service.

**Tech Stack:** Electron 41, React 19, TypeScript 6, shadcn/ui, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `node-pty`, zod, Vitest.

---

## Implementation Notes

- Do not implement `runCommand(command)`. MCP writes raw terminal input through `session_write`.
- Do not allow arbitrary shell paths in the first version. Resolve the user's default shell in Electron Main.
- Do not kill pty processes when the terminal app window closes. Only explicit stop kills a session.
- Do not log full terminal input. Log byte counts and metadata only.
- Keep output retention configurable. Default: 10 MB per session.
- Use `import * as pty from "node-pty"` in Main only.
- Use scoped xterm packages in Renderer:

```ts
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import "@xterm/xterm/css/xterm.css"
```

## File Map

Create:

- `desktop/app-capabilities/terminal/shared/capability.ts` — app id, capability ids, MCP tool names.
- `desktop/app-capabilities/terminal/shared/schema.ts` — zod schemas and exported TypeScript types.
- `desktop/app-capabilities/terminal/shared/manifest.ts` — capability package manifest.
- `desktop/app-capabilities/terminal/main/output-buffer.ts` — byte-bounded output buffer.
- `desktop/app-capabilities/terminal/main/store.ts` — persisted groups, sessions, and retained output.
- `desktop/app-capabilities/terminal/main/service.ts` — session lifecycle and pty ownership.
- `desktop/app-capabilities/terminal/main/ipc.ts` — terminal IPC module.
- `desktop/app-capabilities/terminal/main/dispatcher.ts` — MCP capability dispatcher.
- `desktop/app-capabilities/terminal/main/__tests__/output-buffer.test.ts`
- `desktop/app-capabilities/terminal/main/__tests__/store.test.ts`
- `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`
- `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`
- `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`
- `desktop/app-capabilities/terminal/renderer/app-definition.ts`
- `desktop/app-capabilities/terminal/renderer/app-manifest.ts`
- `desktop/app-capabilities/terminal/renderer/index.tsx`
- `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`
- `desktop/src/types/terminal.ts`

Modify:

- `desktop/package.json` — add terminal dependencies; add `node_modules/node-pty/**` to `build.asarUnpack` only if the packaged verification step proves electron-builder does not include the native runtime correctly.
- `desktop/config.ts` — add commented output retention constant.
- `desktop/synapse-capabilities/shared/naming.ts` — add `write` and `stop` actions.
- `desktop/synapse-capabilities/shared/app-domain.ts` — register terminal MCP tools.
- `desktop/electron/bootstrap/descriptors.ts` — compose document-template and terminal app dispatchers for the `app` capability domain.
- `desktop/electron/bootstrap/descriptors.ts` — register the singleton `core.terminal` service used by IPC and MCP.
- `desktop/electron/bootstrap/ipc-registry.ts` — register `terminalIpcModule`.
- `desktop/electron/preload.ts` — generated or checked terminal bridge surface.
- `desktop/src/types/bridge.ts` — terminal bridge types.
- `desktop/src/modules/apps/types.ts` — add system app id.
- `desktop/src/modules/apps/registry.ts` — add terminal app manifest.
- `desktop/src/modules/apps/components/system-app-content.tsx` — render terminal app.
- `desktop/resources/templates/skills/synapse-skill/files/app/index.md` — document terminal usage.
- `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md` — document terminal MCP tools.
- `RELEASE_NOTES_PENDING.md` — mention terminal app and MCP control.

---

### Task 1: Dependencies, Config, and Capability Names

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/config.ts`
- Modify: `desktop/synapse-capabilities/shared/naming.ts`
- Create: `desktop/app-capabilities/terminal/shared/capability.ts`
- Create: `desktop/app-capabilities/terminal/shared/schema.ts`
- Test: `desktop/synapse-capabilities/shared/app-domain.test.ts`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm --filter @synapse/desktop add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links node-pty
```

Expected: `desktop/package.json` and `pnpm-lock.yaml` include the four packages.

- [ ] **Step 2: Add configurable output limit**

Add to `desktop/config.ts` near other size limits:

```ts
// 终端会话单个 session 的输出保留上限：限制后台任务长时间输出占用内存和磁盘，超出后按最旧输出滚动清理。
export const TERMINAL_SESSION_OUTPUT_RETENTION_BYTES = 10 * 1024 * 1024
```

- [ ] **Step 3: Extend capability actions**

In `desktop/synapse-capabilities/shared/naming.ts`, extend `CAPABILITY_ACTIONS`:

```ts
const CAPABILITY_ACTIONS = [
  "list",
  "get",
  "create",
  "update",
  "upsert",
  "delete",
  "count",
  "rename",
  "describe",
  "inspect",
  "enable",
  "disable",
  "read",
  "write",
  "execute",
  "reorder",
  "move",
  "upload",
  "restore",
  "generate",
  "stop",
] as const
```

- [ ] **Step 4: Create shared capability ids**

Create `desktop/app-capabilities/terminal/shared/capability.ts`:

```ts
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const TERMINAL_APP_ID = "terminal" as const

export const TERMINAL_GROUP_CREATE_CAPABILITY_ID =
  "app.terminal.group.create" as CapabilityId
export const TERMINAL_GROUP_LIST_CAPABILITY_ID =
  "app.terminal.group.list" as CapabilityId
export const TERMINAL_SESSION_CREATE_CAPABILITY_ID =
  "app.terminal.session.create" as CapabilityId
export const TERMINAL_SESSION_LIST_CAPABILITY_ID =
  "app.terminal.session.list" as CapabilityId
export const TERMINAL_SESSION_GET_CAPABILITY_ID =
  "app.terminal.session.get" as CapabilityId
export const TERMINAL_SESSION_READ_CAPABILITY_ID =
  "app.terminal.session.read" as CapabilityId
export const TERMINAL_SESSION_WRITE_CAPABILITY_ID =
  "app.terminal.session.write" as CapabilityId
export const TERMINAL_SESSION_RESIZE_CAPABILITY_ID =
  "app.terminal.session.update" as CapabilityId
export const TERMINAL_SESSION_STOP_CAPABILITY_ID =
  "app.terminal.session.stop" as CapabilityId

export const TERMINAL_MCP_TOOL_NAMES = {
  groupCreate: "app_terminal_group_create",
  groupList: "app_terminal_group_list",
  sessionCreate: "app_terminal_session_create",
  sessionList: "app_terminal_session_list",
  sessionGet: "app_terminal_session_get",
  sessionRead: "app_terminal_session_read",
  sessionWrite: "app_terminal_session_write",
  sessionResize: "app_terminal_session_resize",
  sessionStop: "app_terminal_session_stop",
} as const
```

- [ ] **Step 5: Create shared schemas**

Create `desktop/app-capabilities/terminal/shared/schema.ts`:

```ts
import { z } from "zod"

export const terminalSessionStatusSchema = z.enum(["running", "exited", "killed", "failed", "lost"])
export const terminalAgentControlSchema = z.enum(["disabled", "enabled"])

export const terminalGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sortOrder: z.number().int(),
})

export const terminalSessionSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  shell: z.string().min(1),
  status: terminalSessionStatusSchema,
  exitCode: z.number().int().optional(),
  signal: z.number().int().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  agentControl: terminalAgentControlSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  lastOutputSeq: z.number().int().nonnegative(),
})

export const terminalOutputChunkSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  data: z.string(),
  createdAt: z.string().min(1),
  source: z.literal("pty"),
})

export const terminalCreateGroupInputSchema = z.object({
  name: z.string().min(1).max(80),
}).strict()

export const terminalCreateSessionInputSchema = z.object({
  groupId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional(),
  cwd: z.string().min(1).optional(),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
  agentControl: z.boolean().optional(),
}).strict()

export const terminalSessionIdInputSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

export const terminalReadSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().optional(),
  limitBytes: z.number().int().positive().max(1024 * 1024).optional(),
}).strict()

export const terminalWriteSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string().min(1).max(64 * 1024),
}).strict()

export const terminalResizeSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200),
}).strict()

export const terminalStopSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  force: z.boolean().optional(),
}).strict()

export const terminalReadSessionResultSchema = z.object({
  session: terminalSessionSchema,
  chunks: z.array(terminalOutputChunkSchema),
  nextSeq: z.number().int().nonnegative(),
  truncated: z.boolean(),
  firstSeq: z.number().int().nonnegative(),
})

export type TerminalGroup = z.infer<typeof terminalGroupSchema>
export type TerminalSession = z.infer<typeof terminalSessionSchema>
export type TerminalOutputChunk = z.infer<typeof terminalOutputChunkSchema>
export type TerminalCreateGroupInput = z.infer<typeof terminalCreateGroupInputSchema>
export type TerminalCreateSessionInput = z.infer<typeof terminalCreateSessionInputSchema>
export type TerminalReadSessionInput = z.infer<typeof terminalReadSessionInputSchema>
export type TerminalWriteSessionInput = z.infer<typeof terminalWriteSessionInputSchema>
export type TerminalResizeSessionInput = z.infer<typeof terminalResizeSessionInputSchema>
export type TerminalStopSessionInput = z.infer<typeof terminalStopSessionInputSchema>
export type TerminalReadSessionResult = z.infer<typeof terminalReadSessionResultSchema>
```

- [ ] **Step 6: Run focused type checks for shared code**

Run:

```bash
pnpm --filter @synapse/desktop exec tsc -p tsconfig.electron.json --noEmit
```

Expected: PASS or only pre-existing errors unrelated to terminal files.

- [ ] **Step 7: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml desktop/config.ts desktop/synapse-capabilities/shared/naming.ts desktop/app-capabilities/terminal/shared
git commit -m "feat(terminal): add shared capability contracts"
```

---

### Task 2: Output Buffer and Persistent Store

**Files:**
- Create: `desktop/app-capabilities/terminal/main/output-buffer.ts`
- Create: `desktop/app-capabilities/terminal/main/store.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/output-buffer.test.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/store.test.ts`

- [ ] **Step 1: Write output buffer tests**

Create `desktop/app-capabilities/terminal/main/__tests__/output-buffer.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createTerminalOutputBuffer } from "../output-buffer"

describe("terminal output buffer", () => {
  it("keeps chunks in sequence order", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100 })
    buffer.append("s1", "one")
    buffer.append("s1", "two")

    expect(buffer.read({ afterSeq: 0, limitBytes: 100 })).toMatchObject({
      truncated: false,
      firstSeq: 1,
      nextSeq: 2,
      chunks: [
        { seq: 1, data: "one" },
        { seq: 2, data: "two" },
      ],
    })
  })

  it("prunes old chunks by byte limit", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 6 })
    buffer.append("s1", "1234")
    buffer.append("s1", "5678")

    const result = buffer.read({ afterSeq: 0, limitBytes: 100 })
    expect(result.truncated).toBe(true)
    expect(result.firstSeq).toBe(2)
    expect(result.chunks.map((chunk) => chunk.data)).toEqual(["5678"])
  })

  it("limits reads by requested byte count", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100 })
    buffer.append("s1", "abc")
    buffer.append("s1", "def")

    const result = buffer.read({ afterSeq: 0, limitBytes: 3 })
    expect(result.chunks.map((chunk) => chunk.data)).toEqual(["abc"])
    expect(result.nextSeq).toBe(1)
  })
})
```

- [ ] **Step 2: Implement output buffer**

Create `desktop/app-capabilities/terminal/main/output-buffer.ts`:

```ts
import type { TerminalOutputChunk } from "../shared/schema"

type BufferEntry = TerminalOutputChunk & { byteLength: number }

export type TerminalOutputBuffer = {
  append(sessionId: string, data: string): TerminalOutputChunk
  read(input: { afterSeq?: number; limitBytes: number }): {
    chunks: TerminalOutputChunk[]
    nextSeq: number
    firstSeq: number
    truncated: boolean
  }
  snapshot(): TerminalOutputChunk[]
}

export function createTerminalOutputBuffer(options: { maxBytes: number; initialChunks?: TerminalOutputChunk[] }): TerminalOutputBuffer {
  const entries: BufferEntry[] = (options.initialChunks ?? [])
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .map(toBufferEntry)
  let nextSeq = (entries.at(-1)?.seq ?? 0) + 1
  let totalBytes = entries.reduce((sum, entry) => sum + entry.byteLength, 0)

  function prune() {
    while (totalBytes > options.maxBytes && entries.length > 0) {
      const removed = entries.shift()
      if (removed) totalBytes -= removed.byteLength
    }
  }

  return {
    append(sessionId, data) {
      const chunk: BufferEntry = {
        sessionId,
        seq: nextSeq,
        data,
        createdAt: new Date().toISOString(),
        source: "pty",
        byteLength: Buffer.byteLength(data, "utf8"),
      }
      nextSeq += 1
      entries.push(chunk)
      totalBytes += chunk.byteLength
      prune()
      return stripByteLength(chunk)
    },
    read(input) {
      const afterSeq = input.afterSeq ?? 0
      const firstSeq = entries[0]?.seq ?? nextSeq - 1
      const truncated = entries.length > 0 && afterSeq < firstSeq - 1
      let bytes = 0
      const chunks: TerminalOutputChunk[] = []
      for (const entry of entries) {
        if (entry.seq <= afterSeq) continue
        if (chunks.length > 0 && bytes + entry.byteLength > input.limitBytes) break
        if (chunks.length === 0 && entry.byteLength > input.limitBytes) {
          chunks.push(stripByteLength(entry))
          break
        }
        chunks.push(stripByteLength(entry))
        bytes += entry.byteLength
      }
      return {
        chunks,
        firstSeq: entries[0]?.seq ?? 0,
        nextSeq: chunks.at(-1)?.seq ?? afterSeq,
        truncated,
      }
    },
    snapshot() {
      return entries.map(stripByteLength)
    },
  }
}

function stripByteLength(entry: BufferEntry): TerminalOutputChunk {
  const { byteLength: _byteLength, ...chunk } = entry
  return chunk
}

function toBufferEntry(chunk: TerminalOutputChunk): BufferEntry {
  return {
    ...chunk,
    byteLength: Buffer.byteLength(chunk.data, "utf8"),
  }
}
```

- [ ] **Step 3: Write store tests**

Create `desktop/app-capabilities/terminal/main/__tests__/store.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTerminalStore } from "../store"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-store-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("terminal store", () => {
  it("persists groups and sessions", async () => {
    const store = createTerminalStore({ baseDir: tempDir })
    await store.saveState({
      groups: [{ id: "g1", name: "默认", createdAt: "t1", updatedAt: "t1", sortOrder: 0 }],
      sessions: [{
        id: "s1",
        groupId: "g1",
        title: "zsh",
        cwd: tempDir,
        shell: "/bin/zsh",
        status: "running",
        createdAt: "t1",
        updatedAt: "t1",
        startedAt: "t1",
        agentControl: "disabled",
        cols: 80,
        rows: 24,
        lastOutputSeq: 0,
      }],
      output: [],
    })

    await expect(createTerminalStore({ baseDir: tempDir }).loadState()).resolves.toMatchObject({
      groups: [{ id: "g1" }],
      sessions: [{ id: "s1", status: "running" }],
    })
  })
})
```

- [ ] **Step 4: Implement file-backed store**

Create `desktop/app-capabilities/terminal/main/store.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  terminalGroupSchema,
  terminalOutputChunkSchema,
  terminalSessionSchema,
  type TerminalGroup,
  type TerminalOutputChunk,
  type TerminalSession,
} from "../shared/schema"

const terminalStoreStateSchema = z.object({
  groups: z.array(terminalGroupSchema),
  sessions: z.array(terminalSessionSchema),
  output: z.array(terminalOutputChunkSchema),
})

export type TerminalStoreState = z.infer<typeof terminalStoreStateSchema>

export type TerminalStore = {
  loadState(): Promise<TerminalStoreState>
  saveState(state: {
    groups: TerminalGroup[]
    sessions: TerminalSession[]
    output: TerminalOutputChunk[]
  }): Promise<void>
}

export function createTerminalStore(options: { baseDir: string }): TerminalStore {
  const filePath = path.join(options.baseDir, "terminal-state.json")

  return {
    async loadState() {
      try {
        const raw = await readFile(filePath, "utf8")
        return terminalStoreStateSchema.parse(JSON.parse(raw))
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return { groups: [], sessions: [], output: [] }
        }
        throw error
      }
    },
    async saveState(state) {
      await mkdir(options.baseDir, { recursive: true })
      const parsed = terminalStoreStateSchema.parse(state)
      await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
    },
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/output-buffer.test.ts desktop/app-capabilities/terminal/main/__tests__/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/app-capabilities/terminal/main/output-buffer.ts desktop/app-capabilities/terminal/main/store.ts desktop/app-capabilities/terminal/main/__tests__/output-buffer.test.ts desktop/app-capabilities/terminal/main/__tests__/store.test.ts
git commit -m "feat(terminal): add output retention store"
```

---

### Task 3: TerminalService and Pty Lifecycle

**Files:**
- Create: `desktop/app-capabilities/terminal/main/service.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`

- [ ] **Step 1: Write service lifecycle tests**

Create `desktop/app-capabilities/terminal/main/__tests__/service.test.ts`:

```ts
import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTerminalStore } from "../store"
import { createTerminalService, type PtyLike } from "../service"

class FakePty extends EventEmitter implements PtyLike {
  written: string[] = []
  resized: Array<{ cols: number; rows: number }> = []
  killed = false

  onData(listener: (data: string) => void) {
    this.on("data", listener)
    return { dispose: () => this.off("data", listener) }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.on("exit", listener)
    return { dispose: () => this.off("exit", listener) }
  }

  write(data: string) {
    this.written.push(data)
  }

  resize(cols: number, rows: number) {
    this.resized.push({ cols, rows })
  }

  kill() {
    this.killed = true
    this.emit("exit", { exitCode: 0, signal: 0 })
  }

  emitData(data: string) {
    this.emit("data", data)
  }
}

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-service-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("terminal service", () => {
  it("creates a session and records output", async () => {
    const fake = new FakePty()
    const service = createTerminalService({
      store: createTerminalStore({ baseDir: tempDir }),
      outputRetentionBytes: 10 * 1024,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => tempDir,
      spawnPty: () => fake,
    })

    await service.start()
    const session = await service.createSession({})
    fake.emitData("hello")

    const output = service.readSession({ sessionId: session.id, afterSeq: 0, limitBytes: 1024 })
    expect(output.chunks.map((chunk) => chunk.data)).toEqual(["hello"])
    expect(output.session.status).toBe("running")
  })

  it("blocks agent writes until agent control is enabled", async () => {
    const fake = new FakePty()
    const service = createTerminalService({
      store: createTerminalStore({ baseDir: tempDir }),
      outputRetentionBytes: 10 * 1024,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => tempDir,
      spawnPty: () => fake,
    })

    await service.start()
    const session = await service.createSession({})

    expect(() => service.writeSession({ sessionId: session.id, data: "pwd\n", actor: "mcp" }))
      .toThrow("Agent control is disabled")

    service.setAgentControl({ sessionId: session.id, enabled: true })
    service.writeSession({ sessionId: session.id, data: "pwd\n", actor: "mcp" })
    expect(fake.written).toEqual(["pwd\n"])
  })

  it("marks restored running sessions as lost", async () => {
    const store = createTerminalStore({ baseDir: tempDir })
    await store.saveState({
      groups: [],
      sessions: [{
        id: "s1",
        groupId: "g1",
        title: "zsh",
        cwd: tempDir,
        shell: "/bin/zsh",
        status: "running",
        createdAt: "t1",
        updatedAt: "t1",
        startedAt: "t1",
        agentControl: "disabled",
        cols: 80,
        rows: 24,
        lastOutputSeq: 0,
      }],
      output: [],
    })

    const service = createTerminalService({
      store,
      outputRetentionBytes: 10 * 1024,
      resolveDefaultShell: () => "/bin/zsh",
      resolveDefaultCwd: () => tempDir,
      spawnPty: vi.fn(),
    })

    await service.start()
    expect(service.listSessions()[0]?.status).toBe("lost")
  })
})
```

- [ ] **Step 2: Implement TerminalService with injectable pty**

Create `desktop/app-capabilities/terminal/main/service.ts`:

```ts
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import * as pty from "node-pty"
import { TERMINAL_SESSION_OUTPUT_RETENTION_BYTES } from "../../../config"
import type {
  TerminalCreateGroupInput,
  TerminalCreateSessionInput,
  TerminalGroup,
  TerminalOutputChunk,
  TerminalReadSessionInput,
  TerminalReadSessionResult,
  TerminalResizeSessionInput,
  TerminalSession,
  TerminalStopSessionInput,
  TerminalWriteSessionInput,
} from "../shared/schema"
import { createTerminalOutputBuffer, type TerminalOutputBuffer } from "./output-buffer"
import type { TerminalStore } from "./store"

export type TerminalActor = "user" | "mcp"

export type PtyLike = {
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

type TerminalRuntime = {
  pty: PtyLike
  buffer: TerminalOutputBuffer
}

export type TerminalService = ReturnType<typeof createTerminalService>

export function createTerminalService(deps: {
  store: TerminalStore
  outputRetentionBytes?: number
  resolveDefaultShell?: () => string
  resolveDefaultCwd?: () => string
  spawnPty?: (input: { shell: string; cwd: string; cols: number; rows: number }) => PtyLike
}) {
  const events = new EventEmitter()
  const groups = new Map<string, TerminalGroup>()
  const sessions = new Map<string, TerminalSession>()
  const runtimes = new Map<string, TerminalRuntime>()
  const buffers = new Map<string, TerminalOutputBuffer>()
  const outputRetentionBytes = deps.outputRetentionBytes ?? TERMINAL_SESSION_OUTPUT_RETENTION_BYTES

  async function persist() {
    const output: TerminalOutputChunk[] = []
    for (const buffer of buffers.values()) {
      output.push(...buffer.snapshot())
    }
    await deps.store.saveState({
      groups: [...groups.values()],
      sessions: [...sessions.values()],
      output,
    })
  }

  function now() {
    return new Date().toISOString()
  }

  function ensureDefaultGroup(): TerminalGroup {
    const existing = [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder)[0]
    if (existing) return existing
    const timestamp = now()
    const group = { id: randomUUID(), name: "默认", createdAt: timestamp, updatedAt: timestamp, sortOrder: 0 }
    groups.set(group.id, group)
    return group
  }

  function getRunningRuntime(sessionId: string): TerminalRuntime {
    const session = sessions.get(sessionId)
    const runtime = runtimes.get(sessionId)
    if (!session || !runtime || session.status !== "running") {
      throw new Error("Terminal session is not running")
    }
    return runtime
  }

  return {
    events,
    async start() {
      const state = await deps.store.loadState()
      for (const group of state.groups) groups.set(group.id, group)
      const outputBySession = new Map<string, TerminalOutputChunk[]>()
      for (const chunk of state.output) {
        outputBySession.set(chunk.sessionId, [...(outputBySession.get(chunk.sessionId) ?? []), chunk])
      }
      for (const session of state.sessions) {
        const restoredSession = session.status === "running"
          ? { ...session, status: "lost", updatedAt: now(), endedAt: now() }
          : session
        sessions.set(session.id, restoredSession)
        buffers.set(session.id, createTerminalOutputBuffer({
          maxBytes: outputRetentionBytes,
          initialChunks: outputBySession.get(session.id) ?? [],
        }))
      }
      await persist()
    },
    listGroups() {
      return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder)
    },
    async createGroup(input: TerminalCreateGroupInput) {
      const timestamp = now()
      const group: TerminalGroup = {
        id: randomUUID(),
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        sortOrder: groups.size,
      }
      groups.set(group.id, group)
      await persist()
      return group
    },
    listSessions() {
      return [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    getSession(input: { sessionId: string }) {
      const session = sessions.get(input.sessionId)
      if (!session) throw new Error("Terminal session not found")
      return session
    },
    async createSession(input: TerminalCreateSessionInput) {
      const group = input.groupId ? groups.get(input.groupId) : ensureDefaultGroup()
      if (!group) throw new Error("Terminal group not found")
      const cwd = resolveCwd(input.cwd, deps.resolveDefaultCwd?.() ?? defaultCwd())
      const shell = deps.resolveDefaultShell?.() ?? defaultShell()
      const cols = input.cols ?? 80
      const rows = input.rows ?? 24
      const timestamp = now()
      const session: TerminalSession = {
        id: randomUUID(),
        groupId: group.id,
        title: input.title ?? path.basename(shell),
        cwd,
        shell,
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        agentControl: input.agentControl ? "enabled" : "disabled",
        cols,
        rows,
        lastOutputSeq: 0,
      }
      const child = deps.spawnPty?.({ shell, cwd, cols, rows }) ?? spawnNodePty({ shell, cwd, cols, rows })
      const buffer = createTerminalOutputBuffer({ maxBytes: outputRetentionBytes })
      buffers.set(session.id, buffer)
      runtimes.set(session.id, { pty: child, buffer })
      sessions.set(session.id, session)
      child.onData((data) => {
        const runtime = runtimes.get(session.id)
        const current = sessions.get(session.id)
        if (!runtime || !current) return
        const chunk = runtime.buffer.append(session.id, data)
        sessions.set(session.id, { ...current, lastOutputSeq: chunk.seq, updatedAt: now() })
        events.emit("data", { sessionId: session.id, chunk })
        void persist()
      })
      child.onExit((exitEvent) => {
        const current = sessions.get(session.id)
        if (!current) return
        runtimes.delete(session.id)
        sessions.set(session.id, {
          ...current,
          status: current.status === "killed" ? "killed" : "exited",
          exitCode: exitEvent.exitCode,
          signal: exitEvent.signal,
          updatedAt: now(),
          endedAt: now(),
        })
        events.emit("sessionChanged", sessions.get(session.id))
        void persist()
      })
      await persist()
      return session
    },
    readSession(input: TerminalReadSessionInput): TerminalReadSessionResult {
      const session = this.getSession({ sessionId: input.sessionId })
      const buffer = buffers.get(input.sessionId)
      if (!buffer) return { session, chunks: [], nextSeq: session.lastOutputSeq, truncated: false, firstSeq: session.lastOutputSeq }
      return { session, ...buffer.read({ afterSeq: input.afterSeq, limitBytes: input.limitBytes ?? 64 * 1024 }) }
    },
    writeSession(input: TerminalWriteSessionInput & { actor: TerminalActor }) {
      const session = this.getSession({ sessionId: input.sessionId })
      if (input.actor === "mcp" && session.agentControl !== "enabled") {
        throw new Error("Agent control is disabled")
      }
      getRunningRuntime(input.sessionId).pty.write(input.data)
    },
    resizeSession(input: TerminalResizeSessionInput) {
      const session = this.getSession({ sessionId: input.sessionId })
      sessions.set(session.id, { ...session, cols: input.cols, rows: input.rows, updatedAt: now() })
      getRunningRuntime(input.sessionId).pty.resize(input.cols, input.rows)
      void persist()
    },
    setAgentControl(input: { sessionId: string; enabled: boolean }) {
      const session = this.getSession({ sessionId: input.sessionId })
      sessions.set(session.id, { ...session, agentControl: input.enabled ? "enabled" : "disabled", updatedAt: now() })
      void persist()
    },
    stopSession(input: TerminalStopSessionInput & { actor: TerminalActor }) {
      const session = this.getSession({ sessionId: input.sessionId })
      if (input.actor === "mcp" && session.agentControl !== "enabled") {
        throw new Error("Agent control is disabled")
      }
      sessions.set(session.id, { ...session, status: "killed", updatedAt: now(), endedAt: now() })
      getRunningRuntime(input.sessionId).pty.kill()
      void persist()
    },
  }
}

function spawnNodePty(input: { shell: string; cwd: string; cols: number; rows: number }): PtyLike {
  return pty.spawn(input.shell, [], {
    name: "xterm-256color",
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  })
}

function defaultShell() {
  if (os.platform() === "win32") return process.env.ComSpec || "powershell.exe"
  return process.env.SHELL || "/bin/zsh"
}

function defaultCwd() {
  return process.env.HOME || process.env.USERPROFILE || process.cwd()
}

function resolveCwd(input: string | undefined, fallback: string) {
  const cwd = input ?? fallback
  if (!path.isAbsolute(cwd) || !existsSync(cwd)) {
    throw new Error("Terminal cwd must be an existing absolute path")
  }
  return cwd
}
```

- [ ] **Step 3: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Register TerminalService as `core.terminal`**

Modify `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { app } from "electron"
import { createTerminalService, type TerminalService } from "../../app-capabilities/terminal/main/service"
import { createTerminalStore } from "../../app-capabilities/terminal/main/store"
```

Add a descriptor near other core service descriptors:

```ts
export const coreTerminalDescriptor: ServiceDescriptor<TerminalService> = {
  id: "core.terminal",
  dependsOn: [],
  async start() {
    const service = createTerminalService({
      store: createTerminalStore({ baseDir: path.join(app.getPath("userData"), "terminal") }),
    })
    await service.start()
    return service
  },
}
```

Add `coreTerminalDescriptor` to the exported descriptor list in the same file so the registry starts it during bootstrap.

- [ ] **Step 5: Commit**

```bash
git add desktop/app-capabilities/terminal/main/service.ts desktop/app-capabilities/terminal/main/__tests__/service.test.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "feat(terminal): manage pty sessions"
```

---

### Task 4: IPC, Bridge Types, and Preload Surface

**Files:**
- Create: `desktop/app-capabilities/terminal/main/ipc.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/preload.ts` through `pnpm --filter @synapse/desktop run generate:ipc`
- Create: `desktop/src/types/terminal.ts`

- [ ] **Step 1: Add renderer terminal types**

Create `desktop/src/types/terminal.ts`:

```ts
export type {
  TerminalGroup as SynapseTerminalGroup,
  TerminalSession as SynapseTerminalSession,
  TerminalOutputChunk as SynapseTerminalOutputChunk,
  TerminalCreateGroupInput as SynapseTerminalCreateGroupInput,
  TerminalCreateSessionInput as SynapseTerminalCreateSessionInput,
  TerminalReadSessionInput as SynapseTerminalReadSessionInput,
  TerminalReadSessionResult as SynapseTerminalReadSessionResult,
  TerminalWriteSessionInput as SynapseTerminalWriteSessionInput,
  TerminalResizeSessionInput as SynapseTerminalResizeSessionInput,
  TerminalStopSessionInput as SynapseTerminalStopSessionInput,
} from "../../app-capabilities/terminal/shared/schema"
```

- [ ] **Step 2: Write IPC descriptor test**

Create `desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { terminalIpcModule } from "../ipc"

describe("terminalIpcModule", () => {
  it("declares stable channels", () => {
    expect(terminalIpcModule.id).toBe("terminal")
    expect(terminalIpcModule.methods.createSession.channel).toBe("synapse:terminal:session:create")
    expect(terminalIpcModule.methods.writeSession.channel).toBe("synapse:terminal:session:write")
    expect(terminalIpcModule.events.data.channel).toBe("synapse:terminal:data")
  })

  it("writes as user actor from IPC", async () => {
    const service = { writeSession: vi.fn() }
    const ctx = { moduleId: "terminal", resolve: () => service }
    await terminalIpcModule.methods.writeSession.handler(ctx, { sessionId: "s1", data: "pwd\n" })
    expect(service.writeSession).toHaveBeenCalledWith({ sessionId: "s1", data: "pwd\n", actor: "user" })
  })
})
```

- [ ] **Step 3: Implement IPC module**

Create `desktop/app-capabilities/terminal/main/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import {
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalGroupSchema,
  terminalReadSessionInputSchema,
  terminalReadSessionResultSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalSessionSchema,
  terminalStopSessionInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"
import type { TerminalService } from "./service"

const terminalServiceId = "core.terminal"

function service(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): TerminalService {
  return ctx.resolve<TerminalService>(terminalServiceId)
}

export const terminalIpcModule: IpcModule = {
  id: "terminal",
  methods: {
    listGroups: {
      channel: "synapse:terminal:group:list",
      kind: "invoke",
      request: z.void().optional(),
      response: z.array(terminalGroupSchema),
      handler: (ctx) => service(ctx).listGroups(),
    },
    createGroup: {
      channel: "synapse:terminal:group:create",
      kind: "invoke",
      request: terminalCreateGroupInputSchema,
      response: terminalGroupSchema,
      handler: (ctx, request) => service(ctx).createGroup(request),
    },
    listSessions: {
      channel: "synapse:terminal:session:list",
      kind: "invoke",
      request: z.void().optional(),
      response: z.array(terminalSessionSchema),
      handler: (ctx) => service(ctx).listSessions(),
    },
    createSession: {
      channel: "synapse:terminal:session:create",
      kind: "invoke",
      request: terminalCreateSessionInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request) => service(ctx).createSession(request),
    },
    getSession: {
      channel: "synapse:terminal:session:get",
      kind: "invoke",
      request: terminalSessionIdInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request) => service(ctx).getSession(request),
    },
    readSession: {
      channel: "synapse:terminal:session:read",
      kind: "invoke",
      request: terminalReadSessionInputSchema,
      response: terminalReadSessionResultSchema,
      handler: (ctx, request) => service(ctx).readSession(request),
    },
    writeSession: {
      channel: "synapse:terminal:session:write",
      kind: "invoke",
      request: terminalWriteSessionInputSchema,
      response: z.void(),
      handler: (ctx, request) => service(ctx).writeSession({ ...request, actor: "user" }),
    },
    resizeSession: {
      channel: "synapse:terminal:session:resize",
      kind: "invoke",
      request: terminalResizeSessionInputSchema,
      response: z.void(),
      handler: (ctx, request) => service(ctx).resizeSession(request),
    },
    stopSession: {
      channel: "synapse:terminal:session:stop",
      kind: "invoke",
      request: terminalStopSessionInputSchema,
      response: z.void(),
      handler: (ctx, request) => service(ctx).stopSession({ ...request, actor: "user" }),
    },
  },
  events: {
    data: {
      channel: "synapse:terminal:data",
      kind: "event",
      payload: z.object({
        sessionId: z.string().min(1),
        chunk: z.unknown(),
      }),
    },
    sessionChanged: {
      channel: "synapse:terminal:session-changed",
      kind: "event",
      payload: terminalSessionSchema,
    },
  },
}
```

- [ ] **Step 4: Register IPC module**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { terminalIpcModule } from "../../app-capabilities/terminal/main/ipc"
```

Register it in `createIpcRegistry`:

```ts
registry.register(terminalIpcModule, ctx)
```

Add it to `registeredIpcModules`:

```ts
terminalIpcModule,
```

- [ ] **Step 5: Update bridge types**

Add imports to `desktop/src/types/bridge.ts`:

```ts
import type {
  SynapseTerminalCreateGroupInput,
  SynapseTerminalCreateSessionInput,
  SynapseTerminalGroup,
  SynapseTerminalReadSessionInput,
  SynapseTerminalReadSessionResult,
  SynapseTerminalResizeSessionInput,
  SynapseTerminalSession,
  SynapseTerminalStopSessionInput,
  SynapseTerminalWriteSessionInput,
} from "./terminal"
```

Add `terminal` to `SynapseBridge`:

```ts
  terminal: {
    listGroups: () => Promise<SynapseTerminalGroup[]>
    createGroup: (input: SynapseTerminalCreateGroupInput) => Promise<SynapseTerminalGroup>
    listSessions: () => Promise<SynapseTerminalSession[]>
    createSession: (input: SynapseTerminalCreateSessionInput) => Promise<SynapseTerminalSession>
    getSession: (input: { sessionId: string }) => Promise<SynapseTerminalSession>
    readSession: (input: SynapseTerminalReadSessionInput) => Promise<SynapseTerminalReadSessionResult>
    writeSession: (input: SynapseTerminalWriteSessionInput) => Promise<void>
    resizeSession: (input: SynapseTerminalResizeSessionInput) => Promise<void>
    stopSession: (input: SynapseTerminalStopSessionInput) => Promise<void>
    onData: (listener: (event: { sessionId: string; chunk: unknown }) => void) => () => void
    onSessionChanged: (listener: (session: SynapseTerminalSession) => void) => () => void
  }
```

- [ ] **Step 6: Generate preload bridge**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/preload.ts` includes `terminal` channels and subscription helpers without exposing raw `ipcRenderer`.

- [ ] **Step 7: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/terminal/main/ipc.ts desktop/app-capabilities/terminal/main/__tests__/ipc.test.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/types/terminal.ts
git commit -m "feat(terminal): expose terminal ipc bridge"
```

---

### Task 5: MCP Dispatcher and App Capability Registry

**Files:**
- Create: `desktop/app-capabilities/terminal/main/dispatcher.ts`
- Test: `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/synapse-capabilities/shared/app-domain.ts`
- Modify: app dispatcher composition file that currently wires `createDocumentTemplateCapabilityDispatcher`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/app/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md`

- [ ] **Step 1: Write dispatcher tests**

Create `desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../../shared/capability"
import { createTerminalCapabilityDispatcher } from "../dispatcher"

describe("terminal capability dispatcher", () => {
  it("dispatches read", async () => {
    const service = {
      readSession: vi.fn(() => ({ session: { id: "s1" }, chunks: [], nextSeq: 0, firstSeq: 0, truncated: false })),
    }
    const dispatcher = createTerminalCapabilityDispatcher({ service: service as never })

    await dispatcher.dispatch(TERMINAL_SESSION_READ_CAPABILITY_ID, { sessionId: "s1" }, { source: "mcp" })

    expect(service.readSession).toHaveBeenCalledWith({ sessionId: "s1" })
  })

  it("writes as mcp actor", async () => {
    const service = { writeSession: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({ service: service as never })

    await dispatcher.dispatch(TERMINAL_SESSION_WRITE_CAPABILITY_ID, { sessionId: "s1", data: "pwd\n" }, { source: "mcp" })

    expect(service.writeSession).toHaveBeenCalledWith({ sessionId: "s1", data: "pwd\n", actor: "mcp" })
  })
})
```

- [ ] **Step 2: Implement dispatcher**

Create `desktop/app-capabilities/terminal/main/dispatcher.ts`:

```ts
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../shared/capability"
import {
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalReadSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalStopSessionInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"
import type { TerminalService } from "./service"

export type TerminalCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createTerminalCapabilityDispatcher(deps: { service: TerminalService }): TerminalCapabilityDispatcher {
  return {
    async dispatch(action, params) {
      if (action === TERMINAL_GROUP_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createGroup(terminalCreateGroupInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_GROUP_LIST_CAPABILITY_ID) {
        return { ok: true, data: deps.service.listGroups(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createSession(terminalCreateSessionInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_SESSION_LIST_CAPABILITY_ID) {
        return { ok: true, data: deps.service.listSessions(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_GET_CAPABILITY_ID) {
        return { ok: true, data: deps.service.getSession(terminalSessionIdInputSchema.parse(params)), affected: 0 }
      }
      if (action === TERMINAL_SESSION_READ_CAPABILITY_ID) {
        return { ok: true, data: deps.service.readSession(terminalReadSessionInputSchema.parse(params)), affected: 0 }
      }
      if (action === TERMINAL_SESSION_WRITE_CAPABILITY_ID) {
        deps.service.writeSession({ ...terminalWriteSessionInputSchema.parse(params), actor: "mcp" })
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_RESIZE_CAPABILITY_ID) {
        deps.service.resizeSession(terminalResizeSessionInputSchema.parse(params))
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_STOP_CAPABILITY_ID) {
        deps.service.stopSession({ ...terminalStopSessionInputSchema.parse(params), actor: "mcp" })
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      throw new Error(`Unknown terminal action: ${action}`)
    },
  }
}
```

- [ ] **Step 3: Register app domain tools**

Modify `desktop/synapse-capabilities/shared/app-domain.ts` to import terminal constants and add capability definitions:

```ts
import {
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
```

Add capability entries:

```ts
  { id: TERMINAL_GROUP_CREATE_CAPABILITY_ID, title: "Create terminal group", description: "Create a Synapse terminal group.", mutates: true },
  { id: TERMINAL_GROUP_LIST_CAPABILITY_ID, title: "List terminal groups", description: "List Synapse terminal groups.", mutates: false },
  { id: TERMINAL_SESSION_CREATE_CAPABILITY_ID, title: "Create terminal session", description: "Create a Synapse-managed terminal session.", mutates: true },
  { id: TERMINAL_SESSION_LIST_CAPABILITY_ID, title: "List terminal sessions", description: "List Synapse terminal sessions.", mutates: false },
  { id: TERMINAL_SESSION_GET_CAPABILITY_ID, title: "Get terminal session", description: "Get terminal session status.", mutates: false },
  { id: TERMINAL_SESSION_READ_CAPABILITY_ID, title: "Read terminal output", description: "Read retained terminal output by sequence cursor.", mutates: false },
  { id: TERMINAL_SESSION_WRITE_CAPABILITY_ID, title: "Write terminal input", description: "Write raw input to an Agent-enabled terminal session.", mutates: true },
  { id: TERMINAL_SESSION_RESIZE_CAPABILITY_ID, title: "Resize terminal session", description: "Resize a terminal session pty.", mutates: true },
  { id: TERMINAL_SESSION_STOP_CAPABILITY_ID, title: "Stop terminal session", description: "Stop an Agent-enabled terminal session.", mutates: true },
```

Add tool action mappings:

```ts
  [TERMINAL_MCP_TOOL_NAMES.groupCreate]: TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.groupList]: TERMINAL_GROUP_LIST_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionCreate]: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionList]: TERMINAL_SESSION_LIST_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionGet]: TERMINAL_SESSION_GET_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionRead]: TERMINAL_SESSION_READ_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionWrite]: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionResize]: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  [TERMINAL_MCP_TOOL_NAMES.sessionStop]: TERMINAL_SESSION_STOP_CAPABILITY_ID,
```

Add tool definitions in `buildAppTools()` with object schemas matching `schema.ts`.

- [ ] **Step 4: Wire action router app dispatcher**

Modify `desktop/electron/bootstrap/descriptors.ts` so app dispatch handles both document template and terminal:

```ts
const terminalService = ctx.registry.get<TerminalService>("core.terminal")
const documentTemplateDispatcher = createDocumentTemplateCapabilityDispatcher({ service: documentTemplateService, permissionGuard, auditSink })
const terminalDispatcher = createTerminalCapabilityDispatcher({ service: terminalService })

const appDispatch = async (action: string, params: Record<string, unknown>, context: DispatchContext) => {
  if (action.startsWith("app.terminal.")) {
    return terminalDispatcher.dispatch(action, params, context)
  }
  return documentTemplateDispatcher.dispatch(action, params, context)
}
```

Add `"core.terminal"` to the `dependsOn` list of the descriptor that builds `createSynapseActionRouter`, because MCP app dispatch needs the terminal service before database MCP starts.

- [ ] **Step 5: Update app MCP docs**

Add to `desktop/resources/templates/skills/synapse-skill/files/app/api-reference.md`:

```md
## Terminal

- `app_terminal_group_create({ name })`
- `app_terminal_group_list({})`
- `app_terminal_session_create({ groupId?, title?, cwd?, cols?, rows?, agentControl? })`
- `app_terminal_session_list({})`
- `app_terminal_session_get({ sessionId })`
- `app_terminal_session_read({ sessionId, afterSeq?, limitBytes? })`
- `app_terminal_session_write({ sessionId, data })`
- `app_terminal_session_resize({ sessionId, cols, rows })`
- `app_terminal_session_stop({ sessionId, force? })`

`app_terminal_session_write` writes raw input. Include `\n` when the shell should submit a command. Write and stop require Agent control to be enabled on the session.
```

Add to `desktop/resources/templates/skills/synapse-skill/files/app/index.md`:

```md
Use Terminal tools when you need to work inside a Synapse-managed shell session. Create a session, read output with `afterSeq`, and write raw input only when the session has Agent control enabled.
```

- [ ] **Step 6: Run dispatcher and registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts desktop/synapse-capabilities/shared/app-domain.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/terminal/main/dispatcher.ts desktop/app-capabilities/terminal/main/__tests__/dispatcher.test.ts desktop/synapse-capabilities/shared/app-domain.ts desktop/electron desktop/resources/templates/skills/synapse-skill/files/app
git commit -m "feat(terminal): expose mcp terminal controls"
```

---

### Task 6: System App Renderer

**Files:**
- Create: `desktop/app-capabilities/terminal/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/terminal/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/terminal/renderer/index.tsx`
- Test: `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`

- [ ] **Step 1: Register system app id**

Modify `desktop/src/modules/apps/types.ts`:

```ts
export const SYSTEM_APP_IDS = [
  "resource-repository",
  "git",
  "database",
  "document-template",
  "terminal",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const
```

- [ ] **Step 2: Create app definition and manifest**

Create `desktop/app-capabilities/terminal/renderer/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { TERMINAL_APP_ID } from "../shared/capability"

export const terminalAppDefinition = {
  id: TERMINAL_APP_ID,
  type: "system",
  name: "终端",
  windowTitle: "终端",
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/terminal/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { terminalAppDefinition } from "./app-definition"
import icon from "../../../src/modules/git/assets/icon.png"

export const terminalAppManifest = {
  ...terminalAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 3: Register manifest**

Modify `desktop/src/modules/apps/registry.ts`:

```ts
import { terminalAppManifest } from "../../../app-capabilities/terminal/renderer/app-manifest"
```

Add `terminalAppManifest` to `systemApps`.

- [ ] **Step 4: Implement terminal module**

Create `desktop/app-capabilities/terminal/renderer/index.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Square } from "lucide-react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import "@xterm/xterm/css/xterm.css"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Switch } from "../../../src/components/ui/switch"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SynapseTerminalGroup, SynapseTerminalSession } from "../../../src/types/terminal"

export function TerminalModule() {
  const bridge = useMemo(() => requireBridgeDomain("terminal"), [])
  const [groups, setGroups] = useState<SynapseTerminalGroup[]>([])
  const [sessions, setSessions] = useState<SynapseTerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState("")

  const refresh = async () => {
    const [nextGroups, nextSessions] = await Promise.all([bridge.listGroups(), bridge.listSessions()])
    setGroups(nextGroups)
    setSessions(nextSessions)
    setActiveSessionId((current) => current || nextSessions.find((session) => session.status === "running")?.id || nextSessions[0]?.id || "")
  }

  useEffect(() => {
    void refresh()
    return bridge.onSessionChanged((session) => {
      setSessions((current) => current.map((item) => item.id === session.id ? session : item))
    })
  }, [])

  const createSession = async () => {
    const session = await bridge.createSession({ cols: 80, rows: 24 })
    await refresh()
    setActiveSessionId(session.id)
  }

  const stopSession = async () => {
    if (!activeSessionId) return
    await bridge.stopSession({ sessionId: activeSessionId })
    await refresh()
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null

  return (
    <SystemAppWindowShell
      actions={(
        <div className="flex items-center gap-2">
          {activeSession ? <Badge variant="outline">{activeSession.status}</Badge> : null}
          <Button type="button" size="sm" variant="outline" onClick={createSession}>
            <Plus className="size-4" />
            新建终端
          </Button>
          <Button type="button" size="icon" variant="outline" disabled={!activeSession} onClick={stopSession}>
            <Square className="size-4" />
          </Button>
        </div>
      )}
    >
      <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)]">
        <ScrollArea className="border-r">
          <div className="grid gap-2 p-3">
            {groups.map((group) => (
              <div key={group.id} className="grid gap-1">
                <div className="px-2 text-sm font-medium">{group.name}</div>
                {sessions.filter((session) => session.groupId === group.id).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    data-active={session.id === activeSessionId ? "true" : "false"}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    <span className="truncate">{session.title}</span>
                    <span className="text-xs text-muted-foreground">{session.status}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
        {activeSession ? (
          <TerminalPane session={activeSession} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Button type="button" onClick={createSession}>新建终端</Button>
          </div>
        )}
      </div>
    </SystemAppWindowShell>
  )
}

function TerminalPane({ session }: { session: SynapseTerminalSession }) {
  const bridge = useMemo(() => requireBridgeDomain("terminal"), [])
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    let disposed = false
    let lastSeq = 0
    const term = new Terminal({ cursorBlink: true, scrollback: 5000, convertEol: true })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fitAddon.fit()
    term.focus()

    void bridge.readSession({ sessionId: session.id, afterSeq: 0, limitBytes: 1024 * 1024 }).then((result) => {
      if (disposed) return
      for (const chunk of result.chunks) term.write(chunk.data)
      lastSeq = result.nextSeq
    })

    const inputDisposable = term.onData((data) => {
      void bridge.writeSession({ sessionId: session.id, data })
    })
    const removeDataListener = bridge.onData((event) => {
      if (disposed || event.sessionId !== session.id) return
      const chunk = event.chunk as { seq: number; data: string }
      if (chunk.seq <= lastSeq) return
      term.write(chunk.data)
      lastSeq = chunk.seq
    })
    const resizeObserver = new ResizeObserver(() => {
      if (disposed) return
      fitAddon.fit()
      void bridge.resizeSession({ sessionId: session.id, cols: term.cols, rows: term.rows })
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      removeDataListener()
      inputDisposable.dispose()
      term.dispose()
    }
  }, [bridge, session.id])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 items-center gap-3 border-b px-3 text-sm">
        <span className="font-medium">{session.title}</span>
        <span className="min-w-0 truncate text-muted-foreground">{session.cwd}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground">Agent 控制</span>
          <Switch checked={session.agentControl === "enabled"} disabled />
        </div>
      </div>
      <div ref={containerRef} className="h-full min-h-0 overflow-hidden p-2" />
    </div>
  )
}
```

- [ ] **Step 5: Render module in app content**

Modify `desktop/src/modules/apps/components/system-app-content.tsx` by importing:

```ts
import { TerminalModule } from "../../../../app-capabilities/terminal/renderer"
```

Add to the app switch:

```tsx
if (appId === "terminal") return <TerminalModule />
```

- [ ] **Step 6: Write renderer smoke test**

Create `desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TerminalModule } from "../index"

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    onData() { return { dispose() {} } }
    dispose() {}
  },
}))

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class { fit() {} },
}))

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}))

describe("TerminalModule", () => {
  it("shows create action when there are no sessions", async () => {
    Object.assign(window, {
      synapse: {
        terminal: {
          listGroups: vi.fn(async () => []),
          listSessions: vi.fn(async () => []),
          createSession: vi.fn(async () => ({ id: "s1", groupId: "g1", title: "zsh", status: "running" })),
          onSessionChanged: vi.fn(() => () => {}),
        },
      },
    })

    render(<TerminalModule />)

    expect(await screen.findByText("新建终端")).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run renderer test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/terminal/renderer desktop/src/modules/apps/types.ts desktop/src/modules/apps/registry.ts desktop/src/modules/apps/components/system-app-content.tsx
git commit -m "feat(terminal): add terminal system app"
```

---

### Task 7: Native Packaging, Release Notes, and Verification

**Files:**
- Modify: `desktop/package.json`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Check native package requirements**

Run:

```bash
pnpm --filter @synapse/desktop run build:electron
```

Expected: PASS. If `node-pty` native ABI fails, add the smallest existing-compatible rebuild step for Electron native modules and document the command in this plan's implementation notes before committing the fix.

- [ ] **Step 2: Check package asar rules**

Inspect `desktop/package.json` `build.files` and `build.asarUnpack`.

If packaged verification reports missing `node-pty` native files, add a narrow unpack rule:

```json
"node_modules/node-pty/**"
```

Only add this rule after a verification failure or documented electron-builder need.

- [ ] **Step 3: Update release notes**

Add to `RELEASE_NOTES_PENDING.md`:

```md
- 新增终端应用：可以在 Synapse 中创建真实终端会话，并允许已授权的 Agent 通过 MCP 读取输出、写入输入和管理会话。
```

- [ ] **Step 4: Run full focused verification**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Run packaged asar check if packaging changed**

Run when `desktop/package.json` packaging fields changed:

```bash
pnpm --filter @synapse/desktop run check:packaged-asar
```

Expected: PASS or a clear pre-existing packaged artifact absence unrelated to terminal changes.

- [ ] **Step 6: Manual app verification**

Run:

```bash
pnpm dev:desktop
```

Manual checks:

- Open `应用` -> `终端`.
- Create a terminal.
- Confirm the shell prompt appears.
- Run `pwd`, `ls`, `echo hello`, `node -v`, `npm -v`.
- Close the terminal app window or switch away.
- Run a long command such as `for i in {1..5}; do echo $i; sleep 1; done`.
- Reopen the terminal app and confirm output continued while detached.
- Enable Agent control, call MCP `app_terminal_session_write` with `echo mcp\n`, then read output.
- Disable Agent control and confirm MCP write fails.

- [ ] **Step 7: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml RELEASE_NOTES_PENDING.md
git commit -m "chore(terminal): verify native packaging"
```
