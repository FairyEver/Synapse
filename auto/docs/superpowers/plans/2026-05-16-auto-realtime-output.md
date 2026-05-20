# auto 实时输出流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream real-time worker output to a new Vite + React + shadcn Web UI with terminal-style panels.

**Architecture:** Extend the existing SSE channel with named `output` events alongside `snapshot` events. Server-side `runner.ts` gains an `onOutput` callback that fires for every stdout/stderr line. Frontend is a complete rewrite in `auto/web/` using Vite + React + shadcn, with a `terminal.tsx` component rendering scrolling output per worker.

**Tech Stack:** Node.js (server), Vite + React 19 + Tailwind CSS 4 + shadcn/ui (frontend), `@tanstack/react-virtual` (virtual scrolling), `node:test` (server tests)

**Spec:** `auto/docs/superpowers/specs/2026-05-16-auto-realtime-output-design.md`

---

## File Map

### Server-side (modify)

| File | Change |
|---|---|
| `auto/src/runner.ts` | Add `OutputLine` type, `WorkerOutputCallback`, wire `onOutput` through `runWorker` and `runBatch` |
| `auto/src/scheduler.ts` | Add `outputListeners`, `subscribeOutput()`, update `BatchRunner` type, pass `onOutput` in `loop()` |
| `auto/src/server.ts` | SSE named events, `OutputBuffer` class, `GET /api/workers/output`, static path → `dist/web/` |
| `auto/src/runner.test.ts` | Add test for `onOutput` callback |
| `auto/src/scheduler.test.ts` | Add test for `subscribeOutput` |
| `auto/src/server.test.ts` | Add tests for SSE named events and output buffer endpoint |

### Frontend (create)

| File | Purpose |
|---|---|
| `auto/web/package.json` | Dependencies: react, react-dom, tailwindcss, vite, @tanstack/react-virtual |
| `auto/web/vite.config.ts` | Build to `../dist/web/`, dev proxy to auto server |
| `auto/web/tsconfig.json` | Strict TS, path aliases |
| `auto/web/components.json` | shadcn config |
| `auto/web/index.html` | Entry HTML |
| `auto/web/src/main.tsx` | React root mount |
| `auto/web/src/app.tsx` | Top-level app with SSE provider |
| `auto/web/src/lib/types.ts` | Shared types mirroring server |
| `auto/web/src/lib/api.ts` | Fetch helpers |
| `auto/web/src/hooks/use-sse.ts` | SSE connection + event dispatch |
| `auto/web/src/hooks/use-output-buffer.ts` | Per-worker line accumulation |
| `auto/web/src/hooks/use-config.ts` | Config CRUD |
| `auto/web/src/components/layout/app-shell.tsx` | Tabs layout |
| `auto/web/src/components/layout/config-view.tsx` | Config page |
| `auto/web/src/components/layout/run-view.tsx` | Run page with worker panels |
| `auto/web/src/components/workers/terminal.tsx` | Terminal output renderer |
| `auto/web/src/components/workers/worker-panel.tsx` | Collapsible worker panel |
| `auto/web/src/components/workers/worker-grid.tsx` | Worker panel container |
| `auto/web/src/components/config/prompt-editor.tsx` | Prompt select + textarea |
| `auto/web/src/components/config/provider-settings.tsx` | Codex / Claude Code settings |
| `auto/web/src/components/config/run-params.tsx` | Concurrency, interval, timeout, etc. |
| `auto/web/src/components/ui/` | shadcn components (button, input, select, tabs, collapsible, badge, dialog, textarea, label, separator, scroll-area) |

### Cleanup (delete)

| File | Reason |
|---|---|
| `auto/src/web/index.html` | Replaced by `auto/web/` |
| `auto/src/web/app.js` | Replaced by `auto/web/` |
| `auto/src/web/styles.css` | Replaced by `auto/web/` |

---

## Task 1: Server — OutputLine type + runner onOutput

**Files:**
- Modify: `auto/src/runner.ts`
- Test: `auto/src/runner.test.ts`

- [ ] **Step 1: Add OutputLine type and WorkerOutputCallback to runner.ts**

Add after the existing `WorkerUpdate` type:

```typescript
export type OutputLine = {
  workerId: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number
}

export type WorkerOutputCallback = (line: OutputLine) => void
```

- [ ] **Step 2: Add onOutput parameter to runWorker**

Change `runWorker` signature from:

```typescript
export async function runWorker(
  config: UiConfig,
  workerId: number,
  logger: WorkerLogger,
  onUpdate?: WorkerUpdate
): Promise<WorkerResult>
```

to:

```typescript
export async function runWorker(
  config: UiConfig,
  workerId: number,
  logger: WorkerLogger,
  onUpdate?: WorkerUpdate,
  onOutput?: WorkerOutputCallback
): Promise<WorkerResult>
```

- [ ] **Step 3: Emit onOutput in stdout handler**

In the `child.stdout.on('data')` handler, inside the `for (const line of lines)` loop, after the existing event/lastMessage logic, add output emission:

```typescript
// existing code that sets lastMessage ...
if (event) {
  logger.writeEvent(event)
  lastMessage = eventAccumulator.read(event) || lastMessage
  onOutput?.({ workerId, stream: 'event', text: line, ts: Date.now() })
} else {
  lastMessage = line
  onOutput?.({ workerId, stream: 'stdout', text: line, ts: Date.now() })
}
emitProgress()
```

- [ ] **Step 4: Emit onOutput in stderr handler**

In the `child.stderr.on('data')` handler, inside the `for (const line of lines)` loop, add:

```typescript
if (line.trim()) {
  lastMessage = line
  onOutput?.({ workerId, stream: 'stderr', text: line, ts: Date.now() })
}
emitProgress()
```

- [ ] **Step 5: Add onOutput parameter to runBatch and pass through**

Change `runBatch` signature to:

```typescript
export async function runBatch(
  config: UiConfig,
  onUpdate?: BatchUpdate,
  onOutput?: WorkerOutputCallback
): Promise<BatchResult>
```

In the `Promise.all` map, pass `onOutput` to `runWorker`:

```typescript
const result = await runWorker(config, worker.id, workerLogger, update => {
  workers[index] = update
  onUpdate?.(snapshot())
}, onOutput)
```

- [ ] **Step 6: Write test for onOutput callback**

Add to `auto/src/runner.test.ts`:

```typescript
import type { OutputLine } from './runner.js'

test('runWorker calls onOutput for each stdout line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-output-'))
  try {
    const command = join(dir, 'output.sh')
    await writeFile(command, '#!/bin/sh\necho "line one"\necho "line two"\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      provider: 'codex',
      codex: {
        command,
        model: '',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
        disableMcp: true,
      },
    }
    const logger = new BatchLogger(new Date('2026-05-13T12:00:00Z'), dir)
    const outputLines: OutputLine[] = []
    await runWorker(config, 1, logger.createWorkerLogger(1), undefined, line => {
      outputLines.push(line)
    })

    assert.ok(outputLines.length >= 2)
    assert.ok(outputLines.some(l => l.stream === 'stdout' && l.text === 'line one'))
    assert.ok(outputLines.some(l => l.stream === 'stdout' && l.text === 'line two'))
    assert.ok(outputLines.every(l => l.workerId === 1))
    assert.ok(outputLines.every(l => typeof l.ts === 'number'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 7: Run tests**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto && pnpm test`
Expected: All existing tests pass + new test passes.

- [ ] **Step 8: Commit**

```bash
git add auto/src/runner.ts auto/src/runner.test.ts
git commit -m "feat(auto): add onOutput callback to runner for real-time output streaming"
```

---

## Task 2: Server — AutoScheduler output broadcasting

**Files:**
- Modify: `auto/src/scheduler.ts`
- Test: `auto/src/scheduler.test.ts`

- [ ] **Step 1: Update BatchRunner type**

Change the existing type:

```typescript
export type BatchRunner = (config: UiConfig, onUpdate?: (snapshot: BatchSnapshot) => void) => Promise<BatchResult>
```

to:

```typescript
import type { WorkerOutputCallback } from './runner.js'

export type BatchRunner = (
  config: UiConfig,
  onUpdate?: (snapshot: BatchSnapshot) => void,
  onOutput?: WorkerOutputCallback
) => Promise<BatchResult>
```

- [ ] **Step 2: Add outputListeners and subscribeOutput to AutoScheduler**

Add to the private fields:

```typescript
private outputListeners = new Set<WorkerOutputCallback>()
```

Add public method:

```typescript
subscribeOutput(listener: WorkerOutputCallback): () => void {
  this.outputListeners.add(listener)
  return () => this.outputListeners.delete(listener)
}
```

- [ ] **Step 3: Wire onOutput in loop()**

In the `loop()` method, change the `batchRunner` call from:

```typescript
const batch = await this.batchRunner(config, snapshot => {
  this.currentBatch = snapshot
  this.emit()
})
```

to:

```typescript
const batch = await this.batchRunner(config, snapshot => {
  this.currentBatch = snapshot
  this.emit()
}, line => {
  for (const listener of this.outputListeners) listener(line)
})
```

- [ ] **Step 4: Write test for subscribeOutput**

Add to `auto/src/scheduler.test.ts`:

```typescript
import type { OutputLine } from './runner.js'

test('subscribeOutput receives output lines from batch runner', async () => {
  const collectedLines: OutputLine[] = []
  const fakeLine: OutputLine = { workerId: 1, stream: 'stdout', text: 'hello', ts: Date.now() }

  const runner: BatchRunner = async (_config, _onUpdate, onOutput) => {
    onOutput?.(fakeLine)
    return {
      id: 'batch-1',
      status: 'success',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      workers: [],
      summaryPath: '/tmp/summary.md',
    }
  }

  const scheduler = new AutoScheduler(runner, { wait: () => Promise.resolve() })
  scheduler.subscribeOutput(line => collectedLines.push(line))
  scheduler.stopAfterCurrent()
  await scheduler.start(config())

  assert.equal(collectedLines.length, 1)
  assert.deepEqual(collectedLines[0], fakeLine)
})
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto && pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add auto/src/scheduler.ts auto/src/scheduler.test.ts
git commit -m "feat(auto): add output broadcasting to AutoScheduler"
```

---

## Task 3: Server — OutputBuffer + SSE named events + REST endpoint

**Files:**
- Modify: `auto/src/server.ts`
- Test: `auto/src/server.test.ts`

- [ ] **Step 1: Create OutputBuffer class in server.ts**

Add before `createHandler`:

```typescript
import type { OutputLine } from './runner.js'

export class OutputBuffer {
  private lines = new Map<number, OutputLine[]>()
  private maxPerWorker: number

  constructor(maxPerWorker = 2000) {
    this.maxPerWorker = maxPerWorker
  }

  append(line: OutputLine): void {
    let bucket = this.lines.get(line.workerId)
    if (!bucket) {
      bucket = []
      this.lines.set(line.workerId, bucket)
    }
    bucket.push(line)
    if (bucket.length > this.maxPerWorker) {
      bucket.splice(0, bucket.length - this.maxPerWorker)
    }
  }

  reset(): void {
    this.lines.clear()
  }

  getAll(): Record<number, OutputLine[]> {
    const result: Record<number, OutputLine[]> = {}
    for (const [id, lines] of this.lines) {
      result[id] = [...lines]
    }
    return result
  }
}
```

- [ ] **Step 2: Update createHandler to accept OutputBuffer**

Change `createHandler` signature to:

```typescript
export function createHandler(
  scheduler: AutoScheduler,
  outputBuffer: OutputBuffer,
  paths: HandlerPaths = {}
)
```

- [ ] **Step 3: Add GET /api/workers/output endpoint**

Inside the handler, add before the 404:

```typescript
if (req.method === 'GET' && url.pathname === '/api/workers/output') {
  sendJson(res, 200, { workers: outputBuffer.getAll() })
  return
}
```

- [ ] **Step 4: Change SSE to use named events**

Replace the existing `/events` handler:

```typescript
if (req.method === 'GET' && url.pathname === '/events') {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const sendSnapshot = (snapshot: unknown): void => {
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
  }
  const sendOutput = (line: OutputLine): void => {
    res.write(`event: output\ndata: ${JSON.stringify(line)}\n\n`)
  }
  const unsubSnapshot = scheduler.subscribe(sendSnapshot)
  const unsubOutput = scheduler.subscribeOutput(sendOutput)
  req.on('close', () => {
    unsubSnapshot()
    unsubOutput()
  })
  return
}
```

- [ ] **Step 5: Update startServer to create and wire OutputBuffer**

In `startServer`, create the buffer and wire it:

```typescript
export async function startServer(options: { port?: number; open?: boolean } = {}): Promise<{ server: Server; url: string }> {
  const scheduler = new AutoScheduler()
  const outputBuffer = new OutputBuffer()

  // Subscribe to output for buffering
  scheduler.subscribeOutput(line => outputBuffer.append(line))

  // Reset buffer on new batch
  let lastBatchId = ''
  scheduler.subscribe(snapshot => {
    const batchId = snapshot.currentBatch?.id ?? ''
    if (batchId && batchId !== lastBatchId) {
      outputBuffer.reset()
      lastBatchId = batchId
    }
  })

  // ... rest unchanged, but pass outputBuffer to createHandler:
  const server = createServer((req, res) => {
    void createHandler(scheduler, outputBuffer)(req, res)
  })
  // ...
}
```

- [ ] **Step 6: Update runSavedConfigOnce (no buffer needed)**

No change needed — `runSavedConfigOnce` doesn't use the web server.

- [ ] **Step 7: Update static file serving path**

Change `WEB_DIR` from:

```typescript
const WEB_DIR = resolve(__dirname, 'web')
```

to:

```typescript
const WEB_DIR = resolve(__dirname, '../dist/web')
```

- [ ] **Step 8: Update server tests**

Update existing tests to pass `OutputBuffer`:

```typescript
// In both existing tests, change createHandler calls:
const outputBuffer = new OutputBuffer()
const server = createServer(createHandler(new AutoScheduler(), outputBuffer, { ... }))
```

Add new test for the output buffer endpoint:

```typescript
test('output buffer endpoint returns buffered lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-server-'))
  const outputBuffer = new OutputBuffer()
  const server = createServer(createHandler(new AutoScheduler(), outputBuffer, {
    configPath: join(dir, 'ui-config.json'),
    promptPath: join(dir, 'prompt.md'),
    promptsDir: join(dir, 'prompts'),
  }))
  try {
    await mkdir(join(dir, 'prompts'), { recursive: true })
    const baseUrl = await listen(server)

    outputBuffer.append({ workerId: 1, stream: 'stdout', text: 'hello', ts: 1000 })
    outputBuffer.append({ workerId: 2, stream: 'stderr', text: 'warn', ts: 2000 })

    const result = record(await requestJson(baseUrl, '/api/workers/output'))
    const workers = result.workers as Record<string, unknown[]>
    assert.equal(Array.isArray(workers[1]), true)
    assert.equal(Array.isArray(workers[2]), true)
    assert.equal((workers[1] as Array<{ text: string }>)[0].text, 'hello')
    assert.equal((workers[2] as Array<{ text: string }>)[0].text, 'warn')
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 9: Run tests**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto && pnpm test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add auto/src/server.ts auto/src/server.test.ts
git commit -m "feat(auto): add OutputBuffer, SSE named events, and output REST endpoint"
```

---

## Task 4: Frontend — Scaffold Vite + React + shadcn project

**Files:**
- Create: `auto/web/package.json`, `auto/web/vite.config.ts`, `auto/web/tsconfig.json`, `auto/web/tsconfig.app.json`, `auto/web/index.html`, `auto/web/src/main.tsx`, `auto/web/src/app.tsx`, `auto/web/src/index.css`, `auto/web/components.json`

- [ ] **Step 1: Create auto/web/package.json**

```json
{
  "name": "@synapse/auto-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "@tanstack/react-virtual": "^3.13.0",
    "lucide-react": "^0.511.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "tailwindcss": "^4.1.0",
    "@tailwindcss/vite": "^4.1.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0"
  }
}
```

- [ ] **Step 2: Create auto/web/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:47831',
      '/events': {
        target: 'http://127.0.0.1:47831',
        ws: false,
      },
    },
  },
})
```

- [ ] **Step 3: Create auto/web/tsconfig.json**

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

- [ ] **Step 4: Create auto/web/tsconfig.app.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create auto/web/index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>auto</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create auto/web/src/index.css**

```css
@import "tailwindcss";

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-secondary: oklch(0.97 0 0);
  --color-secondary-foreground: oklch(0.205 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-accent: oklch(0.97 0 0);
  --color-accent-foreground: oklch(0.205 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.577 0.245 27.325);
  --color-border: oklch(0.922 0 0);
  --color-input: oklch(0.922 0 0);
  --color-ring: oklch(0.708 0 0);
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --color-terminal-bg: oklch(0.12 0 0);
  --color-terminal-fg: oklch(0.9 0 0);
  --color-terminal-stderr: oklch(0.7 0.15 25);
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground font-sans antialiased; }
}
```

- [ ] **Step 7: Create auto/web/src/main.tsx**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Create auto/web/src/app.tsx (placeholder)**

```tsx
export function App() {
  return (
    <div className="min-h-screen p-8">
      <h1 className="text-2xl font-bold">auto</h1>
      <p className="text-muted-foreground">Scaffold OK</p>
    </div>
  )
}
```

- [ ] **Step 9: Create auto/web/src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 10: Install dependencies**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm install`

- [ ] **Step 11: Verify scaffold builds**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm build`
Expected: Build succeeds, output in `auto/dist/web/`.

- [ ] **Step 12: Install shadcn components**

Run from `auto/web/`:

```bash
pnpm dlx shadcn@latest init --defaults
pnpm dlx shadcn@latest add button input label select textarea tabs collapsible badge dialog separator scroll-area
```

Verify `auto/web/src/components/ui/` contains the component files.

- [ ] **Step 13: Commit**

```bash
git add auto/web/
git commit -m "feat(auto): scaffold Vite + React + shadcn frontend project"
```

---

## Task 5: Frontend — Shared types + API layer

**Files:**
- Create: `auto/web/src/lib/types.ts`, `auto/web/src/lib/api.ts`

- [ ] **Step 1: Create types.ts**

```typescript
export type Provider = 'codex' | 'claude-code'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

export interface CodexConfig {
  command: string
  model: string
  sandbox: SandboxMode
  approvalPolicy: ApprovalPolicy
  json: boolean
  disableMcp: boolean
}

export interface ClaudeCodeConfig {
  command: string
  model: string
  dangerouslySkipPermissions: boolean
  outputFormat: 'json' | 'stream-json' | 'text'
  maxTurns: number
  systemPrompt: string
}

export interface UiConfig {
  prompt: string
  activePromptName: string
  prompts: string[]
  workingDirectory: string
  concurrency: number
  intervalMinutes: number
  timeoutMinutes: number
  maxLogs: number
  provider: Provider
  codex: CodexConfig
  claudeCode: ClaudeCodeConfig
}

export type WorkerStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout'
export type BatchStatus = 'running' | 'success' | 'partial' | 'error'
export type SchedulerStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'error'

export interface WorkerResult {
  id: number
  status: WorkerStatus
  durationMs: number
  exitCode: number | null
  logPath: string
  lastMessage: string
}

export interface BatchSnapshot {
  id: string
  status: BatchStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number
  workers: WorkerResult[]
  summaryPath: string
}

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  currentBatch: BatchSnapshot | null
  lastBatch: BatchSnapshot | null
  error: string
}

export interface OutputLine {
  workerId: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number
}
```

- [ ] **Step 2: Create api.ts**

```typescript
import type { UiConfig, SchedulerSnapshot, OutputLine } from './types'

const JSON_HEADERS = { 'content-type': 'application/json' }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { headers: JSON_HEADERS, ...options })
  const body = await response.json()
  if (!response.ok) throw new Error((body as { error?: string }).error || 'Request failed')
  return body as T
}

export function fetchConfig(): Promise<UiConfig> {
  return request('/api/config')
}

export function saveConfig(config: UiConfig): Promise<UiConfig> {
  return request('/api/config', { method: 'PUT', body: JSON.stringify(config) })
}

export function fetchStatus(): Promise<SchedulerSnapshot> {
  return request('/api/status')
}

export function startRun(config: UiConfig): Promise<SchedulerSnapshot> {
  return request('/api/start', { method: 'POST', body: JSON.stringify(config) })
}

export function stopAfterCurrent(): Promise<SchedulerSnapshot> {
  return request('/api/stop-after-current', { method: 'POST' })
}

export function fetchGuide(): Promise<{ content: string }> {
  return request('/api/guide')
}

export function fetchOutputBuffer(): Promise<{ workers: Record<number, OutputLine[]> }> {
  return request('/api/workers/output')
}

export function createPrompt(name: string): Promise<UiConfig> {
  return request('/api/prompts', { method: 'POST', body: JSON.stringify({ name }) })
}

export function fetchPrompt(name: string): Promise<{ name: string; prompt: string }> {
  return request(`/api/prompts/${encodeURIComponent(name)}`)
}

export function renamePrompt(from: string, to: string): Promise<UiConfig> {
  return request(`/api/prompts/${encodeURIComponent(from)}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ name: to }),
  })
}

export function deletePrompt(name: string): Promise<UiConfig> {
  return request(`/api/prompts/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
```

- [ ] **Step 3: Commit**

```bash
git add auto/web/src/lib/types.ts auto/web/src/lib/api.ts
git commit -m "feat(auto): add shared types and API layer for web frontend"
```

---

## Task 6: Frontend — Hooks (use-sse, use-output-buffer, use-config)

**Files:**
- Create: `auto/web/src/hooks/use-sse.ts`, `auto/web/src/hooks/use-output-buffer.ts`, `auto/web/src/hooks/use-config.ts`

- [ ] **Step 1: Create use-output-buffer.ts**

```typescript
import { useCallback, useRef, useState } from 'react'
import type { OutputLine } from '@/lib/types'

const MAX_LINES_PER_WORKER = 5000

export interface OutputBuffer {
  lines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
  append(line: OutputLine): void
  reset(): void
  load(workers: Record<number, OutputLine[]>): void
}

export function useOutputBuffer(): OutputBuffer {
  const linesRef = useRef(new Map<number, OutputLine[]>())
  const trimmedRef = useRef(new Map<number, number>())
  const [, forceUpdate] = useState(0)
  const tick = useCallback(() => forceUpdate(n => n + 1), [])

  const append = useCallback((line: OutputLine) => {
    let bucket = linesRef.current.get(line.workerId)
    if (!bucket) {
      bucket = []
      linesRef.current.set(line.workerId, bucket)
    }
    bucket.push(line)
    if (bucket.length > MAX_LINES_PER_WORKER) {
      const excess = bucket.length - MAX_LINES_PER_WORKER
      bucket.splice(0, excess)
      trimmedRef.current.set(
        line.workerId,
        (trimmedRef.current.get(line.workerId) ?? 0) + excess,
      )
    }
    tick()
  }, [tick])

  const reset = useCallback(() => {
    linesRef.current.clear()
    trimmedRef.current.clear()
    tick()
  }, [tick])

  const load = useCallback((workers: Record<number, OutputLine[]>) => {
    linesRef.current.clear()
    trimmedRef.current.clear()
    for (const [id, lines] of Object.entries(workers)) {
      linesRef.current.set(Number(id), lines)
    }
    tick()
  }, [tick])

  return {
    lines: linesRef.current,
    trimmed: trimmedRef.current,
    append,
    reset,
    load,
  }
}
```

- [ ] **Step 2: Create use-sse.ts**

```typescript
import { useEffect, useRef, useState } from 'react'
import type { SchedulerSnapshot, OutputLine } from '@/lib/types'
import { fetchOutputBuffer, fetchStatus } from '@/lib/api'
import type { OutputBuffer } from './use-output-buffer'

export function useSSE(outputBuffer: OutputBuffer) {
  const [snapshot, setSnapshot] = useState<SchedulerSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const lastBatchIdRef = useRef('')

  useEffect(() => {
    let retryDelay = 3000
    let timer: ReturnType<typeof setTimeout> | null = null
    let es: EventSource | null = null
    let disposed = false

    async function init() {
      try {
        const [status, buffer] = await Promise.all([fetchStatus(), fetchOutputBuffer()])
        if (disposed) return
        setSnapshot(status)
        outputBuffer.load(buffer.workers)
        lastBatchIdRef.current = status.currentBatch?.id ?? ''
      } catch {
        // will retry via SSE reconnect
      }
    }

    function connect() {
      if (disposed) return
      es = new EventSource('/events')

      es.addEventListener('snapshot', (e: MessageEvent) => {
        const snap: SchedulerSnapshot = JSON.parse(e.data)
        setSnapshot(snap)
        const batchId = snap.currentBatch?.id ?? ''
        if (batchId && batchId !== lastBatchIdRef.current) {
          outputBuffer.reset()
          lastBatchIdRef.current = batchId
        }
      })

      es.addEventListener('output', (e: MessageEvent) => {
        const line: OutputLine = JSON.parse(e.data)
        outputBuffer.append(line)
      })

      es.onopen = () => {
        setConnected(true)
        retryDelay = 3000
      }

      es.onerror = () => {
        setConnected(false)
        es?.close()
        es = null
        timer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 1.5, 30000)
      }
    }

    void init().then(connect)

    return () => {
      disposed = true
      es?.close()
      if (timer) clearTimeout(timer)
    }
  }, [outputBuffer])

  return { snapshot, connected }
}
```

- [ ] **Step 3: Create use-config.ts**

```typescript
import { useCallback, useEffect, useState } from 'react'
import type { UiConfig } from '@/lib/types'
import * as api from '@/lib/api'

export function useConfig() {
  const [config, setConfig] = useState<UiConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setConfig(await api.fetchConfig())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (next: UiConfig) => {
    try {
      setError('')
      const saved = await api.saveConfig(next)
      setConfig(saved)
      return saved
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      throw err
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  return { config, loading, error, save, setConfig, reload }
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add auto/web/src/hooks/
git commit -m "feat(auto): add SSE, output buffer, and config hooks"
```

---

## Task 7: Frontend — Terminal component

**Files:**
- Create: `auto/web/src/components/workers/terminal.tsx`

- [ ] **Step 1: Create terminal.tsx**

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { OutputLine } from '@/lib/types'
import { cn } from '@/lib/utils'

interface TerminalProps {
  lines: OutputLine[]
  trimmedCount: number
}

export function Terminal({ lines, trimmedCount }: TerminalProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const userScrolledRef = useRef(false)

  const totalRows = (trimmedCount > 0 ? 1 : 0) + lines.length

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 50,
  })

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && totalRows > 0) {
      virtualizer.scrollToIndex(totalRows - 1, { align: 'end' })
    }
  }, [totalRows, autoScroll, virtualizer])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!atBottom && !userScrolledRef.current) {
      userScrolledRef.current = true
      setAutoScroll(false)
    } else if (atBottom && userScrolledRef.current) {
      userScrolledRef.current = false
      setAutoScroll(true)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false
    setAutoScroll(true)
    virtualizer.scrollToIndex(totalRows - 1, { align: 'end' })
  }, [virtualizer, totalRows])

  const hasTrimmedRow = trimmedCount > 0
  const getLine = (index: number): { type: 'trimmed' | 'line'; line?: OutputLine } => {
    if (hasTrimmedRow && index === 0) return { type: 'trimmed' }
    const lineIndex = hasTrimmedRow ? index - 1 : index
    return { type: 'line', line: lines[lineIndex] }
  }

  return (
    <div className="relative">
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="h-80 overflow-auto bg-(--color-terminal-bg) text-(--color-terminal-fg) font-mono text-sm rounded-md"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map(virtualRow => {
            const { type, line } = getLine(virtualRow.index)
            return (
              <div
                key={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={cn(
                  'px-3 whitespace-pre overflow-x-auto leading-5',
                  type === 'trimmed' && 'text-muted-foreground italic',
                  line?.stream === 'stderr' && 'text-(--color-terminal-stderr)',
                )}
              >
                {type === 'trimmed'
                  ? `… 已裁剪 ${trimmedCount} 行`
                  : line?.text ?? ''}
              </div>
            )
          })}
        </div>
      </div>

      {!autoScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 right-4 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full shadow-md hover:opacity-90"
        >
          回到最新
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add auto/web/src/components/workers/terminal.tsx
git commit -m "feat(auto): add terminal output component with virtual scrolling"
```

---

## Task 8: Frontend — Worker panel + grid

**Files:**
- Create: `auto/web/src/components/workers/worker-panel.tsx`, `auto/web/src/components/workers/worker-grid.tsx`

- [ ] **Step 1: Create worker-panel.tsx**

```tsx
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Terminal } from './terminal'
import type { WorkerResult, OutputLine } from '@/lib/types'
import { cn } from '@/lib/utils'

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'default',
  success: 'secondary',
  error: 'destructive',
  timeout: 'destructive',
}

const statusLabel: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  error: '错误',
  timeout: '超时',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface WorkerPanelProps {
  worker: WorkerResult
  lines: OutputLine[]
  trimmedCount: number
  defaultOpen: boolean
}

export function WorkerPanel({ worker, lines, trimmedCount, defaultOpen }: WorkerPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [elapsed, setElapsed] = useState(worker.durationMs)

  useEffect(() => {
    if (worker.status !== 'running') {
      setElapsed(worker.durationMs)
      return
    }
    const interval = setInterval(() => setElapsed(worker.durationMs), 500)
    return () => clearInterval(interval)
  }, [worker.status, worker.durationMs])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border',
            'hover:bg-accent transition-colors text-left',
          )}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="font-medium text-sm">Worker {worker.id}</span>
          <Badge variant={statusVariant[worker.status] ?? 'outline'} className="text-xs">
            {statusLabel[worker.status] ?? worker.status}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDuration(elapsed)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <Terminal lines={lines} trimmedCount={trimmedCount} />
        {worker.status !== 'pending' && worker.status !== 'running' && (
          <div className={cn(
            'mt-1 px-3 py-1.5 text-xs font-mono rounded-b-md',
            worker.status === 'success' ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive',
          )}>
            {statusLabel[worker.status]} · {formatDuration(worker.durationMs)} · exit {worker.exitCode ?? '-'}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
```

- [ ] **Step 2: Create worker-grid.tsx**

```tsx
import type { WorkerResult, OutputLine } from '@/lib/types'
import { WorkerPanel } from './worker-panel'

interface WorkerGridProps {
  workers: WorkerResult[]
  outputLines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
}

export function WorkerGrid({ workers, outputLines, trimmed }: WorkerGridProps) {
  if (workers.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">无 worker 数据</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {workers.map((worker, index) => (
        <WorkerPanel
          key={worker.id}
          worker={worker}
          lines={outputLines.get(worker.id) ?? []}
          trimmedCount={trimmed.get(worker.id) ?? 0}
          defaultOpen={workers.length <= 3 || index === 0}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add auto/web/src/components/workers/
git commit -m "feat(auto): add worker panel and grid components"
```

---

## Task 9: Frontend — Config components

**Files:**
- Create: `auto/web/src/components/config/prompt-editor.tsx`, `auto/web/src/components/config/provider-settings.tsx`, `auto/web/src/components/config/run-params.tsx`

- [ ] **Step 1: Create prompt-editor.tsx**

Port the prompt selection, textarea, and prompt management actions (new, rename, delete, copy guide) from the old `app.js`. Use shadcn `Select`, `Textarea`, `Button`, `Dialog`. Wire to `api.ts` functions for create/rename/delete/guide.

Key props:

```typescript
interface PromptEditorProps {
  config: UiConfig
  onChange: (patch: Partial<UiConfig>) => void
  onSave: () => Promise<void>
}
```

This component manages:
- Prompt select dropdown with the `config.prompts` list
- Prompt textarea bound to `config.prompt`
- New / Rename / Delete buttons calling `api.createPrompt` / `api.renamePrompt` / `api.deletePrompt`
- Copy Guide button calling `api.fetchGuide` + clipboard
- Unsaved changes dialog when switching prompts with edits

- [ ] **Step 2: Create provider-settings.tsx**

Port the Codex and Claude Code fieldsets. Show/hide based on `config.provider`.

```typescript
interface ProviderSettingsProps {
  config: UiConfig
  onChange: (patch: Partial<UiConfig>) => void
}
```

Contains:
- Provider `Select` (codex / claude-code)
- Codex: command select, model select
- Claude Code: command select, model select, max turns input, output format select, system prompt input

- [ ] **Step 3: Create run-params.tsx**

Port the numeric config fields.

```typescript
interface RunParamsProps {
  config: UiConfig
  onChange: (patch: Partial<UiConfig>) => void
}
```

Contains:
- Working directory `Input`
- Concurrency, interval, timeout, max logs `Input[type=number]`

- [ ] **Step 4: Verify typecheck + build**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm typecheck && pnpm build`

- [ ] **Step 5: Commit**

```bash
git add auto/web/src/components/config/
git commit -m "feat(auto): add config form components (prompt, provider, params)"
```

---

## Task 10: Frontend — Config view + Run view + App shell

**Files:**
- Create: `auto/web/src/components/layout/config-view.tsx`, `auto/web/src/components/layout/run-view.tsx`, `auto/web/src/components/layout/app-shell.tsx`
- Modify: `auto/web/src/app.tsx`

- [ ] **Step 1: Create config-view.tsx**

Compose the config components into the config page layout:

```tsx
import { PromptEditor } from '@/components/config/prompt-editor'
import { ProviderSettings } from '@/components/config/provider-settings'
import { RunParams } from '@/components/config/run-params'
import { Button } from '@/components/ui/button'
import type { UiConfig, SchedulerSnapshot } from '@/lib/types'
import * as api from '@/lib/api'

interface ConfigViewProps {
  config: UiConfig
  snapshot: SchedulerSnapshot | null
  onConfigChange: (config: UiConfig) => void
  onSave: () => Promise<void>
  onStart: () => Promise<void>
}

export function ConfigView({ config, snapshot, onConfigChange, onSave, onStart }: ConfigViewProps) {
  const patch = (partial: Partial<UiConfig>) => onConfigChange({ ...config, ...partial })
  const isRunning = snapshot?.status === 'running' || snapshot?.status === 'stopping'

  return (
    <div className="flex gap-6 max-w-4xl">
      <div className="flex-1 space-y-6">
        <PromptEditor config={config} onChange={patch} onSave={onSave} />
        <RunParams config={config} onChange={patch} />
        <ProviderSettings config={config} onChange={patch} />
      </div>
      <aside className="w-40 shrink-0 space-y-2 pt-1">
        <Button className="w-full" onClick={onStart} disabled={isRunning}>
          开始运行
        </Button>
        <Button variant="secondary" className="w-full" onClick={onSave}>
          保存配置
        </Button>
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Create run-view.tsx**

```tsx
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WorkerGrid } from '@/components/workers/worker-grid'
import type { SchedulerSnapshot, OutputLine } from '@/lib/types'
import * as api from '@/lib/api'

const statusLabel: Record<string, string> = {
  idle: '空闲', running: '运行中', waiting: '等待',
  stopping: '停止中', stopped: '已停止', error: '错误',
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

interface RunViewProps {
  snapshot: SchedulerSnapshot | null
  outputLines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
}

export function RunView({ snapshot, outputLines, trimmed }: RunViewProps) {
  const batch = snapshot?.currentBatch ?? snapshot?.lastBatch
  const canStop = snapshot?.status === 'running' || snapshot?.status === 'waiting'

  return (
    <div className="flex gap-6 max-w-4xl">
      <div className="flex-1 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={snapshot?.status === 'error' ? 'destructive' : 'secondary'}>
            {statusLabel[snapshot?.status ?? ''] ?? snapshot?.status ?? '-'}
          </Badge>
          {batch && (
            <>
              <span className="text-sm text-muted-foreground">
                开始 {formatDate(batch.startedAt)}
              </span>
              <span className="text-sm text-muted-foreground">
                {batch.summaryPath || ''}
              </span>
            </>
          )}
        </div>

        {snapshot?.error && (
          <p className="text-sm text-destructive">{snapshot.error}</p>
        )}

        <WorkerGrid
          workers={batch?.workers ?? []}
          outputLines={outputLines}
          trimmed={trimmed}
        />
      </div>
      <aside className="w-40 shrink-0 pt-1">
        <Button
          variant="secondary"
          className="w-full"
          disabled={!canStop}
          onClick={() => void api.stopAfterCurrent()}
        >
          本批结束后停止
        </Button>
      </aside>
    </div>
  )
}
```

- [ ] **Step 3: Create app-shell.tsx**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { ConfigView } from './config-view'
import { RunView } from './run-view'
import type { SchedulerSnapshot, UiConfig, OutputLine } from '@/lib/types'

const statusLabel: Record<string, string> = {
  idle: '空闲', running: '运行中', waiting: '等待',
  stopping: '停止中', stopped: '已停止', error: '错误',
}

interface AppShellProps {
  config: UiConfig | null
  snapshot: SchedulerSnapshot | null
  connected: boolean
  outputLines: ReadonlyMap<number, OutputLine[]>
  trimmed: ReadonlyMap<number, number>
  onConfigChange: (config: UiConfig) => void
  onSave: () => Promise<void>
  onStart: () => Promise<void>
}

export function AppShell({
  config, snapshot, connected, outputLines, trimmed,
  onConfigChange, onSave, onStart,
}: AppShellProps) {
  return (
    <div className="min-h-screen p-6">
      <Tabs defaultValue="config">
        <div className="flex items-center gap-2 mb-6">
          <h1 className="text-lg font-semibold">auto</h1>
          <TabsList>
            <TabsTrigger value="config">配置</TabsTrigger>
            <TabsTrigger value="run">运行</TabsTrigger>
          </TabsList>
          <Badge variant="outline" className="text-xs">
            {statusLabel[snapshot?.status ?? ''] ?? 'idle'}
          </Badge>
          {!connected && (
            <span className="text-xs text-destructive">断连</span>
          )}
        </div>

        <TabsContent value="config">
          {config && (
            <ConfigView
              config={config}
              snapshot={snapshot}
              onConfigChange={onConfigChange}
              onSave={onSave}
              onStart={onStart}
            />
          )}
        </TabsContent>

        <TabsContent value="run">
          <RunView
            snapshot={snapshot}
            outputLines={outputLines}
            trimmed={trimmed}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 4: Update app.tsx to wire everything together**

```tsx
import { useCallback } from 'react'
import { useConfig } from '@/hooks/use-config'
import { useOutputBuffer } from '@/hooks/use-output-buffer'
import { useSSE } from '@/hooks/use-sse'
import { AppShell } from '@/components/layout/app-shell'
import * as api from '@/lib/api'

export function App() {
  const { config, save, setConfig } = useConfig()
  const outputBuffer = useOutputBuffer()
  const { snapshot, connected } = useSSE(outputBuffer)

  const handleSave = useCallback(async () => {
    if (config) await save(config)
  }, [config, save])

  const handleStart = useCallback(async () => {
    if (!config) return
    await save(config)
    await api.startRun(config)
  }, [config, save])

  const handleConfigChange = useCallback((next: typeof config) => {
    if (next) setConfig(next)
  }, [setConfig])

  return (
    <AppShell
      config={config}
      snapshot={snapshot}
      connected={connected}
      outputLines={outputBuffer.lines}
      trimmed={outputBuffer.trimmed}
      onConfigChange={handleConfigChange}
      onSave={handleSave}
      onStart={handleStart}
    />
  )
}
```

- [ ] **Step 5: Verify typecheck + build**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto/web && pnpm typecheck && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add auto/web/src/
git commit -m "feat(auto): add config view, run view, and app shell layout"
```

---

## Task 11: Build integration + cleanup

**Files:**
- Modify: `auto/package.json`
- Delete: `auto/src/web/index.html`, `auto/src/web/app.js`, `auto/src/web/styles.css`

- [ ] **Step 1: Update auto/package.json scripts**

Add web build scripts:

```json
{
  "scripts": {
    "start": "pnpm run build:web && tsx src/index.ts",
    "dev": "tsx src/index.ts",
    "dev:web": "cd web && pnpm dev",
    "build:web": "cd web && pnpm build",
    "once": "tsx src/index.ts --once",
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Add auto/web to pnpm workspace (if needed)**

Check `pnpm-workspace.yaml` at repo root. If it only lists specific packages, add `auto/web`. If it uses a wildcard that already covers it, skip.

- [ ] **Step 3: Delete old static files**

```bash
rm auto/src/web/index.html auto/src/web/app.js auto/src/web/styles.css
rmdir auto/src/web
```

- [ ] **Step 4: Run full server test suite**

Run: `cd /Users/liyang/Documents/code/github/Synapse/auto && pnpm test`
Expected: All tests pass.

- [ ] **Step 5: Build and verify end-to-end**

```bash
cd /Users/liyang/Documents/code/github/Synapse/auto && pnpm run build:web
```

Then manually start `pnpm dev` and verify:
1. `http://127.0.0.1:47831` serves the built React app
2. Config tab loads and saves configuration
3. Starting a run switches to run tab and shows worker panels
4. Worker panels show real-time output in terminal-style view

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auto): complete web UI rewrite with real-time output streaming"
```

---

## Parallelism Notes

- **Tasks 1-3** (server changes) are sequential — each builds on the previous.
- **Task 4** (frontend scaffold) can start in parallel with Tasks 1-3.
- **Task 5** (types + API) depends on Task 4.
- **Tasks 6-9** (hooks + components) depend on Task 5 but are parallelizable with each other.
- **Task 10** (views + app shell) depends on Tasks 6-9.
- **Task 11** (integration) depends on all previous tasks.
