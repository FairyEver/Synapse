# auto Continuous Pool Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `auto` worker capacity fully utilized by replacing full-batch scheduling with an infinite fixed-slot worker pool.

**Architecture:** `AutoScheduler` owns a continuous session with fixed slots. `runWorker` remains the child-process boundary; the scheduler repeatedly starts a new run in whichever slot finishes first. Config and UI remove `intervalSeconds`, logs become session-based, and stop drains active slots without starting replacements.

**Tech Stack:** TypeScript, Node `node:test`, React, Vite, existing `auto` HTTP/SSE server.

---

## File Structure

- Modify `auto/src/config.ts`: remove active `intervalSeconds` config while loading old files safely.
- Modify `auto/src/config.test.ts`: cover old-config compatibility and new save shape.
- Modify `auto/src/runner.ts`: keep `runWorker`; keep `runBatch` for `pnpm once`; add optional `sequence` to `OutputLine`.
- Modify `auto/src/runner.test.ts`: confirm one-shot behavior still starts exactly `concurrency` workers.
- Modify `auto/src/scheduler.ts`: replace batch loop with continuous fixed-slot orchestration.
- Modify `auto/src/scheduler.test.ts`: cover slot startup, immediate replacement, drain stop, and worker failure continuation.
- Modify `auto/src/logger.ts`: create session log directories and per-slot run log files.
- Modify `auto/src/server.ts`: adapt snapshots and output buffering for slot/run identity.
- Modify `auto/src/server.test.ts`: cover output buffer reset or run identity behavior.
- Modify `auto/web/src/types.ts`: replace batch snapshot types with session/slot types and remove interval config.
- Modify `auto/web/src/components/config-form.tsx`: remove "循环间隔".
- Modify `auto/web/src/hooks/use-output-buffer.ts`: align with selected output identity.
- Modify `auto/web/src/app.tsx`: use `snapshot.session`.
- Modify `auto/web/src/views/run-view.tsx`: render slot session and totals.
- Modify `auto/web/src/components/worker-grid.tsx` and `auto/web/src/components/worker-panel.tsx`: render slot workers or active run output.
- Modify `auto/README.md` and `auto/GUIDE.md`: document continuous slot behavior and new stop semantics.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing note about continuous worker refill.

---

### Task 1: Remove Interval From Config And Settings UI

**Files:**
- Modify: `auto/src/config.ts`
- Modify: `auto/src/config.test.ts`
- Modify: `auto/web/src/types.ts`
- Modify: `auto/web/src/components/config-form.tsx`

- [ ] **Step 1: Write config tests for interval removal**

Add these assertions to `auto/src/config.test.ts`.

```ts
test('loadUiConfig tolerates legacy intervalSeconds without keeping it active', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-legacy-interval-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    const promptsDir = join(dir, 'prompts')
    await mkdir(promptsDir, { recursive: true })
    await writeFile(join(promptsDir, 'default.md'), 'prompt', 'utf-8')
    await writeFile(file, `${JSON.stringify({
      ...DEFAULT_UI_CONFIG,
      activePromptName: 'default',
      workingDirectory: dir,
      intervalSeconds: 180,
    }, null, 2)}\n`, 'utf-8')

    const loaded = await loadUiConfig(file, promptFile, promptsDir)

    assert.equal('intervalSeconds' in loaded, false)
    assert.equal(loaded.workingDirectory, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('saveUiConfig does not persist intervalSeconds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-save-no-interval-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    const promptsDir = join(dir, 'prompts')
    await mkdir(promptsDir, { recursive: true })
    await writeFile(join(promptsDir, 'default.md'), 'old', 'utf-8')

    await saveUiConfig({
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      activePromptName: 'default',
      workingDirectory: dir,
      intervalSeconds: 60,
    }, file, promptFile, promptsDir)

    const savedConfig = JSON.parse(await readFile(file, 'utf-8'))
    assert.equal('intervalSeconds' in savedConfig, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
pnpm --dir auto exec tsx --test src/config.test.ts
```

Expected: FAIL because `UiConfig` still contains `intervalSeconds` and save still writes it.

- [ ] **Step 3: Remove interval from `UiConfig`**

In `auto/src/config.ts`, remove the `intervalSeconds` field from `UiConfig`, `DEFAULT_UI_CONFIG`, and `uiConfigFile`.

Keep load-time tolerance by doing nothing with old `raw.intervalSeconds`. The merged object can contain it internally, but the returned config object must not include it.

The returned object in `validateUiConfig` should include this shape:

```ts
return {
  prompt,
  activePromptName,
  prompts,
  workingDirectory: resolveFromPackageRoot(workingDirectory),
  concurrency: positiveInteger(merged.concurrency, 'concurrency'),
  timeoutMinutes: positiveInteger(merged.timeoutMinutes, 'timeoutMinutes'),
  maxLogs: positiveInteger(merged.maxLogs, 'maxLogs'),
  provider,
  codex: {
    command: codexCommand,
    model: stringValue(merged.codex.model, 'codex.model').trim() || DEFAULT_UI_CONFIG.codex.model,
    sandbox: sandboxValue(merged.codex.sandbox),
    approvalPolicy: approvalValue(merged.codex.approvalPolicy),
    json: booleanValue(merged.codex.json, 'codex.json'),
    disableMcp: booleanValue(merged.codex.disableMcp, 'codex.disableMcp'),
  },
  claudeCode: {
    command: claudeCommand,
    model: stringValue(merged.claudeCode.model, 'claudeCode.model').trim() || DEFAULT_UI_CONFIG.claudeCode.model,
    dangerouslySkipPermissions: typeof merged.claudeCode.dangerouslySkipPermissions === 'boolean'
      ? merged.claudeCode.dangerouslySkipPermissions
      : DEFAULT_UI_CONFIG.claudeCode.dangerouslySkipPermissions,
    outputFormat: outputFormatValue(merged.claudeCode.outputFormat),
    maxTurns: typeof merged.claudeCode.maxTurns === 'number' && merged.claudeCode.maxTurns >= 1
      ? merged.claudeCode.maxTurns
      : DEFAULT_UI_CONFIG.claudeCode.maxTurns,
    systemPrompt: typeof merged.claudeCode.systemPrompt === 'string'
      ? merged.claudeCode.systemPrompt
      : DEFAULT_UI_CONFIG.claudeCode.systemPrompt,
  },
}
```

- [ ] **Step 4: Remove interval from Web types and form**

In `auto/web/src/types.ts`, remove:

```ts
intervalSeconds: number
```

In `auto/web/src/components/config-form.tsx`, remove `INTERVAL_OPTIONS` and the entire field:

```tsx
<Field label="循环间隔">
  <select
    value={config.intervalSeconds}
    onChange={e => update('intervalSeconds', Number(e.target.value))}
    className="select-field"
  >
    {INTERVAL_OPTIONS.map(o => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
</Field>
```

- [ ] **Step 5: Run tests and typecheck for config removal**

Run:

```bash
pnpm --dir auto exec tsx --test src/config.test.ts
pnpm --dir auto typecheck
```

Expected: config tests PASS. If typecheck reports scheduler test config objects still using `intervalSeconds`, remove that property in Task 2.

- [ ] **Step 6: Commit config removal**

```bash
git add auto/src/config.ts auto/src/config.test.ts auto/web/src/types.ts auto/web/src/components/config-form.tsx
git commit -m "refactor(auto): remove interval config"
```

---

### Task 2: Introduce Continuous Scheduler Types And Tests

**Files:**
- Modify: `auto/src/scheduler.ts`
- Modify: `auto/src/scheduler.test.ts`

- [ ] **Step 1: Replace scheduler tests with slot-pool behavior tests**

Rewrite `auto/src/scheduler.test.ts` around a controllable runner. Use this structure:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_UI_CONFIG, type UiConfig } from './config.js'
import { AutoScheduler, type WorkerRunner } from './scheduler.js'
import type { WorkerResult } from './runner.js'

function config(): UiConfig {
  return {
    ...DEFAULT_UI_CONFIG,
    prompt: 'hello',
    workingDirectory: '/tmp/work',
    concurrency: 2,
    timeoutMinutes: 1,
    maxLogs: 10,
  }
}

function result(slotId: number, sequence: number, status: WorkerResult['status'] = 'success'): WorkerResult {
  return {
    id: slotId,
    status,
    durationMs: 1,
    exitCode: status === 'success' ? 0 : 1,
    logPath: `/tmp/slot-${slotId}-run-${sequence}.md`,
    lastMessage: `slot ${slotId} run ${sequence}`,
  }
}
```

Add tests:

```ts
test('start fills all configured slots', async () => {
  const started: Array<{ slotId: number; sequence: number }> = []
  const runner: WorkerRunner = async (_config, run, _onUpdate, _onOutput) => {
    started.push({ slotId: run.slotId, sequence: run.sequence })
    await new Promise<void>(() => {})
    return result(run.slotId, run.sequence)
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForStatus('running')

  assert.deepEqual(started, [
    { slotId: 1, sequence: 1 },
    { slotId: 2, sequence: 2 },
  ])
  assert.equal(scheduler.getSnapshot().session?.slots.length, 2)
})

test('finished slot is refilled without waiting for sibling slots', async () => {
  const deferred = new Map<number, () => void>()
  const started: Array<{ slotId: number; sequence: number }> = []
  const runner: WorkerRunner = async (_config, run) => {
    started.push({ slotId: run.slotId, sequence: run.sequence })
    await new Promise<void>(resolve => deferred.set(run.sequence, resolve))
    return result(run.slotId, run.sequence)
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForRunCount(2)
  deferred.get(1)?.()
  await scheduler.waitForRunCount(3)

  assert.deepEqual(started, [
    { slotId: 1, sequence: 1 },
    { slotId: 2, sequence: 2 },
    { slotId: 1, sequence: 3 },
  ])
})

test('stop drains active slots without replacement', async () => {
  const deferred = new Map<number, () => void>()
  const runner: WorkerRunner = async (_config, run) => {
    await new Promise<void>(resolve => deferred.set(run.sequence, resolve))
    return result(run.slotId, run.sequence)
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForRunCount(2)
  scheduler.stopAfterCurrent()
  await scheduler.waitForStatus('draining')
  deferred.get(1)?.()
  deferred.get(2)?.()
  await scheduler.waitForStatus('stopped')

  const snapshot = scheduler.getSnapshot()
  assert.equal(snapshot.status, 'stopped')
  assert.equal(snapshot.session?.totals.started, 2)
})

test('worker failure increments totals and continues the slot', async () => {
  const deferred = new Map<number, () => void>()
  const runner: WorkerRunner = async (_config, run) => {
    await new Promise<void>(resolve => deferred.set(run.sequence, resolve))
    return result(run.slotId, run.sequence, run.sequence === 1 ? 'error' : 'success')
  }

  const scheduler = new AutoScheduler(runner)
  void scheduler.start(config())
  await scheduler.waitForRunCount(2)
  deferred.get(1)?.()
  await scheduler.waitForRunCount(3)

  const snapshot = scheduler.getSnapshot()
  assert.equal(snapshot.session?.totals.error, 1)
  assert.equal(snapshot.session?.totals.started, 3)

  scheduler.stopAfterCurrent()
  deferred.get(2)?.()
  deferred.get(3)?.()
  await scheduler.waitForStatus('stopped')
})
```

- [ ] **Step 2: Run scheduler tests and verify they fail**

Run:

```bash
pnpm --dir auto exec tsx --test src/scheduler.test.ts
```

Expected: FAIL because `WorkerRunner`, `waitForRunCount`, `draining`, and session snapshots do not exist yet.

- [ ] **Step 3: Define scheduler snapshot and runner types**

In `auto/src/scheduler.ts`, replace batch imports with worker imports:

```ts
import { runWorker, type OutputLine, type WorkerResult, type WorkerUpdate } from './runner.js'
import { BatchLogger } from './logger.js'
```

Define:

```ts
export type SchedulerStatus = 'idle' | 'running' | 'draining' | 'stopped' | 'error'

export interface WorkerRun {
  slotId: number
  sequence: number
  logger: ReturnType<BatchLogger['createWorkerLogger']>
}

export type WorkerRunner = (
  config: UiConfig,
  run: WorkerRun,
  onUpdate?: WorkerUpdate,
  onOutput?: WorkerOutputCallback
) => Promise<WorkerResult>

export interface RunTotals {
  started: number
  success: number
  error: number
  timeout: number
}

export interface SlotSnapshot {
  slotId: number
  sequence: number
  worker: WorkerResult | null
}

export interface RunSessionSnapshot {
  id: string
  startedAt: string
  durationMs: number
  slots: SlotSnapshot[]
  recentRuns: WorkerResult[]
  totals: RunTotals
  summaryPath: string
}

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  session: RunSessionSnapshot | null
  error: string
}
```

Use this default runner wrapper:

```ts
const defaultWorkerRunner: WorkerRunner = (config, run, onUpdate, onOutput) =>
  runWorker(config, run.slotId, run.logger, onUpdate, onOutput)
```

- [ ] **Step 4: Implement continuous slot orchestration**

Replace the batch loop with these class fields:

```ts
private status: SchedulerStatus = 'idle'
private drainAfterCurrent = false
private activeConfig: UiConfig | null = null
private session: RunSessionSnapshot | null = null
private error = ''
private listeners = new Set<SchedulerListener>()
private outputListeners = new Set<WorkerOutputCallback>()
private runningPromise: Promise<void> | null = null
private nextSequence = 1
private activeSlots = 0
```

Implement `start(config)` so it creates one session and starts all slots:

```ts
async start(config: UiConfig): Promise<void> {
  if (this.runningPromise) return this.runningPromise
  this.activeConfig = config
  this.drainAfterCurrent = false
  this.error = ''
  this.runningPromise = this.runPool(config).finally(() => {
    this.runningPromise = null
  })
  return this.runningPromise
}
```

Implement `runPool(config)`:

```ts
private async runPool(config: UiConfig): Promise<void> {
  const started = new Date()
  const batchLogger = new BatchLogger(started)
  this.nextSequence = 1
  this.activeSlots = config.concurrency
  this.status = 'running'
  this.session = {
    id: started.toISOString(),
    startedAt: started.toISOString(),
    durationMs: 0,
    slots: Array.from({ length: config.concurrency }, (_, index) => ({
      slotId: index + 1,
      sequence: 0,
      worker: null,
    })),
    recentRuns: [],
    totals: { started: 0, success: 0, error: 0, timeout: 0 },
    summaryPath: '',
  }
  this.emit()
  await Promise.all(this.session.slots.map(slot => this.runSlot(config, batchLogger, slot.slotId)))
}
```

Implement `runSlot(config, batchLogger, slotId)` as a loop:

```ts
private async runSlot(config: UiConfig, batchLogger: BatchLogger, slotId: number): Promise<void> {
  while (!this.drainAfterCurrent) {
    const sequence = this.nextSequence++
    const logger = batchLogger.createWorkerLogger(slotId, sequence)
    this.markSlotRunning(slotId, sequence, logger.path)
    const result = await this.workerRunner(config, { slotId, sequence, logger }, update => {
      this.updateSlot(slotId, sequence, update)
    }, line => {
      for (const listener of this.outputListeners) listener({ ...line, workerId: slotId, sequence })
    })
    this.finishRun(slotId, sequence, result)
  }
  this.markSlotIdle(slotId)
}
```

After a slot exits, decrement active slots and set stopped when all are done:

```ts
private markSlotIdle(slotId: number): void {
  const slot = this.session?.slots.find(item => item.slotId === slotId)
  if (slot) slot.worker = null
  this.activeSlots--
  if (this.activeSlots === 0) {
    this.status = 'stopped'
  }
  this.emit()
}
```

Implement `stopAfterCurrent`:

```ts
stopAfterCurrent(): void {
  this.drainAfterCurrent = true
  if (this.status === 'running') this.status = 'draining'
  if (this.status === 'idle') this.status = 'stopped'
  this.emit()
}
```

Keep `waitForStatus`; add test helper:

```ts
async waitForRunCount(count: number): Promise<void> {
  if ((this.session?.totals.started ?? 0) >= count) return
  await new Promise<void>(resolve => {
    const unsubscribe = this.subscribe(snapshot => {
      if ((snapshot.session?.totals.started ?? 0) >= count) {
        unsubscribe()
        resolve()
      }
    })
  })
}
```

- [ ] **Step 5: Update constructor signature**

Use:

```ts
constructor(private readonly workerRunner: WorkerRunner = defaultWorkerRunner) {}
```

Remove the old `SchedulerOptions`, wait implementation, wait abort controller, and `BatchRunner` type.

- [ ] **Step 6: Run scheduler tests**

Run:

```bash
pnpm --dir auto exec tsx --test src/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit scheduler pool**

```bash
git add auto/src/scheduler.ts auto/src/scheduler.test.ts
git commit -m "feat(auto): schedule workers with continuous slots"
```

---

### Task 3: Update Logging For Session Slot Runs

**Files:**
- Modify: `auto/src/logger.ts`
- Modify: `auto/src/runner.ts`
- Modify: `auto/src/runner.test.ts`

- [ ] **Step 1: Write logger-facing runner tests**

In `auto/src/runner.test.ts`, add a one-shot test to protect `runBatch`:

```ts
test('runBatch still runs one worker per configured concurrency for once mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-runner-once-'))
  try {
    const command = join(dir, 'success.sh')
    await writeFile(command, '#!/bin/sh\necho "ok"\n', 'utf-8')
    await chmod(command, 0o755)

    const config: UiConfig = {
      ...DEFAULT_UI_CONFIG,
      prompt: 'hello',
      workingDirectory: dir,
      concurrency: 3,
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

    const result = await runBatch(config)

    assert.equal(result.workers.length, 3)
    assert.equal(result.status, 'success')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

Update the import to include `runBatch`.

- [ ] **Step 2: Run runner tests and verify compatibility failures**

Run:

```bash
pnpm --dir auto exec tsx --test src/runner.test.ts
```

Expected: runtime runner tests PASS before logger changes. Type errors from stale `intervalSeconds` config objects are handled in Task 1 and Task 2.

- [ ] **Step 3: Add optional sequence-aware worker log names**

In `auto/src/logger.ts`, change `createWorkerLogger` and `WorkerLogger` constructor:

```ts
constructor(batchPath: string, workerId: number, sequence?: number) {
  const suffix = sequence === undefined ? `worker-${workerId}` : `slot-${workerId}-run-${String(sequence).padStart(4, '0')}`
  this.path = join(batchPath, `${suffix}.md`)
  this.stream = createWriteStream(this.path, { flags: 'w' })
  this.stream.write(sequence === undefined
    ? `# Worker ${workerId}\n\n`
    : `# Slot ${workerId} Run ${sequence}\n\n`)
}

createWorkerLogger(workerId: number, sequence?: number): WorkerLogger {
  return new WorkerLogger(this.path, workerId, sequence)
}
```

This preserves `runBatch` logs and allows continuous mode to produce `slot-N-run-MMMM.md`.

- [ ] **Step 4: Extend summary to support totals**

Update `BatchSummary` with optional session totals:

```ts
export type BatchSummary = {
  status: string
  durationMs: number
  workers: SummaryWorker[]
  totals?: {
    started: number
    success: number
    error: number
    timeout: number
  }
}
```

In `writeSummary`, if `summary.totals` exists, add lines before the table:

```ts
...(summary.totals ? [
  `**Started:** ${summary.totals.started}`,
  `**Success:** ${summary.totals.success}`,
  `**Error:** ${summary.totals.error}`,
  `**Timeout:** ${summary.totals.timeout}`,
  '',
] : []),
```

- [ ] **Step 5: Run runner tests**

Run:

```bash
pnpm --dir auto exec tsx --test src/runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit logging changes**

```bash
git add auto/src/logger.ts auto/src/runner.ts auto/src/runner.test.ts
git commit -m "feat(auto): log continuous slot runs"
```

---

### Task 4: Adapt Server Output Buffer And API Snapshots

**Files:**
- Modify: `auto/src/server.ts`
- Modify: `auto/src/server.test.ts`
- Modify: `auto/src/runner.ts`

- [ ] **Step 1: Add `sequence` to output lines**

In `auto/src/runner.ts`, extend `OutputLine`:

```ts
export type OutputLine = {
  workerId: number
  sequence?: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number
}
```

This keeps old tests and existing callers valid while allowing continuous scheduler events to identify the current slot run.

- [ ] **Step 2: Write output buffer tests for sequence reset**

In `auto/src/server.test.ts`, add:

```ts
test('output buffer separates repeated slot runs by sequence', () => {
  const outputBuffer = new OutputBuffer()

  outputBuffer.append({ workerId: 1, sequence: 1, stream: 'stdout', text: 'old', ts: 1000 })
  outputBuffer.append({ workerId: 1, sequence: 2, stream: 'stdout', text: 'new', ts: 2000 })

  const all = outputBuffer.getAll()
  assert.equal(all['1:1'][0].text, 'old')
  assert.equal(all['1:2'][0].text, 'new')
})
```

- [ ] **Step 3: Run server tests and verify failure**

Run:

```bash
pnpm --dir auto exec tsx --test src/server.test.ts
```

Expected: FAIL because `OutputBuffer.getAll()` is keyed only by numeric worker id.

- [ ] **Step 4: Change output buffer keying**

In `auto/src/server.ts`, add:

```ts
function outputKey(line: OutputLine): string {
  return line.sequence === undefined ? String(line.workerId) : `${line.workerId}:${line.sequence}`
}
```

Change `OutputBuffer` storage:

```ts
private lines = new Map<string, OutputLine[]>()
```

Update `append`:

```ts
const key = outputKey(line)
let bucket = this.lines.get(key)
if (!bucket) {
  bucket = []
  this.lines.set(key, bucket)
}
```

Update `getAll`:

```ts
getAll(): Record<string, OutputLine[]> {
  const result: Record<string, OutputLine[]> = {}
  for (const [key, lines] of this.lines) {
    result[key] = [...lines]
  }
  return result
}
```

- [ ] **Step 5: Remove batch-id reset logic in `startServer`**

Delete the old subscription that resets output based on `snapshot.currentBatch?.id`.

Keep:

```ts
scheduler.subscribeOutput(line => outputBuffer.append(line))
```

The frontend will select output by `slotId:sequence`.

- [ ] **Step 6: Keep `runSavedConfigOnce` as one-shot**

Keep:

```ts
const result = await runBatch(config)
console.log(`${c.boldGreen('✓')} ${c.bold('batch complete')} ${c.dim(result.summaryPath)}`)
```

No infinite scheduler should be used for `--once`; do not change this function unless a renamed type import requires a mechanical update.

- [ ] **Step 7: Run server tests**

Run:

```bash
pnpm --dir auto exec tsx --test src/server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server output update**

```bash
git add auto/src/server.ts auto/src/server.test.ts auto/src/runner.ts
git commit -m "feat(auto): separate output by slot run"
```

---

### Task 5: Update Web Runtime Types And Run View

**Files:**
- Modify: `auto/web/src/types.ts`
- Modify: `auto/web/src/hooks/use-output-buffer.ts`
- Modify: `auto/web/src/app.tsx`
- Modify: `auto/web/src/views/run-view.tsx`
- Modify: `auto/web/src/components/worker-grid.tsx`
- Modify: `auto/web/src/components/worker-panel.tsx`

- [ ] **Step 1: Replace Web snapshot types**

In `auto/web/src/types.ts`, remove `BatchSnapshot` from `SchedulerSnapshot` and add:

```ts
export type SchedulerStatus = 'idle' | 'running' | 'draining' | 'stopped' | 'error'

export interface RunTotals {
  started: number
  success: number
  error: number
  timeout: number
}

export interface SlotSnapshot {
  slotId: number
  sequence: number
  worker: WorkerResult | null
}

export interface RunSessionSnapshot {
  id: string
  startedAt: string
  durationMs: number
  slots: SlotSnapshot[]
  recentRuns: WorkerResult[]
  totals: RunTotals
  summaryPath: string
}

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  session: RunSessionSnapshot | null
  error: string
}

export interface OutputLine {
  workerId: number
  sequence?: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number
}
```

- [ ] **Step 2: Update output buffer hook to string keys**

Change `auto/web/src/hooks/use-output-buffer.ts`:

```ts
export interface OutputBufferState {
  lines: ReadonlyMap<string, OutputLine[]>
  trimmed: ReadonlyMap<string, number>
}

export interface OutputBufferActions {
  append: (line: OutputLine) => void
  reset: () => void
  load: (workers: Record<string, OutputLine[]>) => void
}

function lineKey(line: OutputLine): string {
  return line.sequence === undefined ? String(line.workerId) : `${line.workerId}:${line.sequence}`
}
```

Use `lineKey(line)` in `append`, and preserve string keys in `load`.

- [ ] **Step 3: Update `App` session logic**

In `auto/web/src/app.tsx`, replace references to `currentBatch` and `lastBatch`:

```ts
useEffect(() => {
  if (!snapshot?.session) return
  api.fetchWorkerOutput()
    .then(res => outputBuffer.load(res.workers))
    .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load on session change
}, [snapshot?.session?.id])

const isRunning = snapshot && ['running', 'draining'].includes(snapshot.status)
const hasResults = snapshot && snapshot.session
const showRunView = !showConfig && (isRunning || hasResults)
```

Do not add new console calls in this task. Leave the existing `console.error` calls unchanged because this plan is scoped to scheduling behavior.

- [ ] **Step 4: Rewrite `RunView` for session and slots**

Use this structure in `auto/web/src/views/run-view.tsx`:

```tsx
const statusLabels: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  draining: '停止中',
  stopped: '已停止',
  error: '错误',
}

export function RunView({ snapshot, outputLines, trimmed, onStop, onBack }: RunViewProps) {
  const session = snapshot.session
  const canStop = snapshot.status === 'running'
  const isFinished = snapshot.status === 'stopped' || snapshot.status === 'error'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isFinished && (
            <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              返回配置
            </button>
          )}
          <span className="text-sm font-medium">{statusLabels[snapshot.status] ?? snapshot.status}</span>
          {session && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(session.durationMs)}
            </span>
          )}
        </div>
        {canStop && (
          <button type="button" onClick={onStop} className="flex items-center gap-1.5 bg-destructive text-white rounded-md py-1.5 px-3 text-sm font-medium hover:opacity-90 transition-opacity">
            <Square className="h-3.5 w-3.5" />
            当前任务后停止
          </button>
        )}
        {isFinished && (
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 border border-border rounded-md py-1.5 px-3 text-sm font-medium hover:bg-muted transition-colors">
            返回配置
          </button>
        )}
      </div>

      {session && <SessionSummary totals={session.totals} />}

      {snapshot.error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {snapshot.error}
        </div>
      )}

      {session && (
        <WorkerGrid
          slots={session.slots}
          outputLines={outputLines}
          trimmed={trimmed}
        />
      )}
    </div>
  )
}
```

Add a compact `SessionSummary`:

```tsx
function SessionSummary({ totals }: { totals: { started: number; success: number; error: number; timeout: number } }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/50 p-3 text-sm">
      <span><span className="font-medium">{totals.started}</span> 已启动</span>
      <span className="text-muted-foreground">{totals.success} 成功</span>
      <span className="text-muted-foreground">{totals.error} 失败</span>
      <span className="text-muted-foreground">{totals.timeout} 超时</span>
    </div>
  )
}
```

- [ ] **Step 5: Update worker grid to render slots**

In `auto/web/src/components/worker-grid.tsx`, use:

```tsx
interface WorkerGridProps {
  slots: SlotSnapshot[]
  outputLines: ReadonlyMap<string, OutputLine[]>
  trimmed: ReadonlyMap<string, number>
}

function slotKey(slot: SlotSnapshot): string {
  return `${slot.slotId}:${slot.sequence}`
}

export function WorkerGrid({ slots, outputLines, trimmed }: WorkerGridProps) {
  if (slots.length === 0) return null

  return (
    <div className="space-y-2">
      {slots.map(slot => {
        const key = slotKey(slot)
        return (
          <WorkerPanel
            key={slot.slotId}
            worker={slot.worker}
            label={`Slot ${slot.slotId}`}
            lines={outputLines.get(key) ?? []}
            trimmedCount={trimmed.get(key) ?? 0}
            defaultOpen={slots.length <= 3}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Update worker panel to accept nullable worker and label**

In `auto/web/src/components/worker-panel.tsx`, change props to:

```ts
interface WorkerPanelProps {
  worker: WorkerResult | null
  label: string
  lines: OutputLine[]
  trimmedCount: number
  defaultOpen: boolean
}
```

Where it currently renders `Worker ${worker.id}`, render `label`. Where it reads worker fields, use an idle fallback:

```ts
const status = worker?.status ?? 'pending'
const durationMs = worker?.durationMs ?? 0
const lastMessage = worker?.lastMessage ?? ''
```

Keep existing status icons and layout. Do not add new colors or explanatory copy.

- [ ] **Step 7: Build Web app**

Run:

```bash
pnpm --filter @synapse/auto-web build
```

Expected: PASS.

- [ ] **Step 8: Commit Web updates**

```bash
git add auto/web/src/types.ts auto/web/src/hooks/use-output-buffer.ts auto/web/src/app.tsx auto/web/src/views/run-view.tsx auto/web/src/components/worker-grid.tsx auto/web/src/components/worker-panel.tsx
git commit -m "feat(auto): show continuous slot sessions"
```

---

### Task 6: Documentation, Release Notes, And Full Verification

**Files:**
- Modify: `auto/README.md`
- Modify: `auto/GUIDE.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update `auto/README.md` behavior text**

Replace batch-centric wording with:

```md
本地 Codex 连续并行运行控制台。启动后打开一个网页，在页面里编辑 Prompt、并行 Slot 数、超时和运行参数。开始后会保持最多 N 个 worker 同时运行；任意 worker 完成后，该 slot 会立刻补启动下一次任务。
```

Replace "批次间隔" in the config list with no entry. Replace stop text with:

```md
页面里的 `当前任务后停止` 会停止补新任务，已经运行中的 worker 会继续跑完。所有 slot 都空闲后，本次运行停止。
```

Update logs example:

```text
logs/
  2026-05-26T12-00-00/
    summary.md
    slot-1-run-0001.md
    slot-2-run-0002.md
```

- [ ] **Step 2: Update `auto/GUIDE.md` behavior text**

Change the run environment bullets:

```md
- 多个 worker 会在同一个工作目录中并行运行同一个 Prompt。
- `auto` 会保持最多 N 个 slot 同时运行；某个 slot 完成后，会立即补启动下一次 worker。
- `auto` 不再按批次等待所有 worker 结束，也没有循环间隔。
- 页面里的 `当前任务后停止` 只会阻止补新任务，当前正在运行的 worker 会继续跑完。
- worker 日志会写入 `auto/logs/<session>/slot-<slot>-run-<sequence>.md`，运行摘要写入 `summary.md`。
```

- [ ] **Step 3: Update release notes**

Append this bullet near the top of `RELEASE_NOTES_PENDING.md`, under the first existing unreleased changes section:

```md
- auto 并行运行改为连续补位：某个 worker 完成后会立即启动下一次任务，不再等待同批次全部结束；停止操作会等待当前任务跑完后收尾。
```

- [ ] **Step 4: Run full auto test suite**

Run:

```bash
pnpm --dir auto test
```

Expected: PASS.

- [ ] **Step 5: Run auto typecheck**

Run:

```bash
pnpm --dir auto typecheck
```

Expected: PASS.

- [ ] **Step 6: Build Web app**

Run:

```bash
pnpm --filter @synapse/auto-web build
```

Expected: PASS.

- [ ] **Step 7: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- auto RELEASE_NOTES_PENDING.md
```

Expected: only the planned `auto` files and release notes changed.

- [ ] **Step 8: Commit docs and verification updates**

```bash
git add auto/README.md auto/GUIDE.md RELEASE_NOTES_PENDING.md
git commit -m "docs(auto): document continuous scheduling"
```

---

## Final Verification Checklist

- [ ] `pnpm --dir auto test` passes.
- [ ] `pnpm --dir auto typecheck` passes.
- [ ] `pnpm --filter @synapse/auto-web build` passes.
- [ ] `git status --short` shows the implementation commits plus any unrelated pre-existing user changes that were present before execution.
- [ ] Release notes mention the user-visible auto scheduling behavior change.
