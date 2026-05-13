# auto Codex Web Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web console for `auto/` that persists prompt/runtime settings and runs multiple Codex CLI workers in parallel against one working directory.

**Architecture:** Keep the implementation inside `auto/`. A lightweight Node HTTP server serves static HTML/CSS/JS, exposes JSON APIs and SSE status, and delegates scheduling to a focused scheduler module. The runner invokes `codex exec` through child processes; config and logs are ordinary files under `auto/state/` and `auto/logs/`.

**Tech Stack:** Node built-ins (`http`, `fs/promises`, `child_process`), TypeScript, tsx, static HTML/CSS/JS, Server-Sent Events.

---

## File Structure

- Modify `auto/package.json`: remove Claude SDK, add `test` and `typecheck` scripts.
- Modify `auto/src/config.ts`: define persisted UI config, default values, validation, load/save helpers.
- Modify `auto/src/logger.ts`: support batch directories, summary logs, and worker logs.
- Modify `auto/src/runner.ts`: replace Claude SDK streaming with Codex child-process worker execution.
- Create `auto/src/scheduler.ts`: batch loop, status model, drain flag, event notifications.
- Create `auto/src/server.ts`: HTTP routing, static assets, JSON APIs, SSE, browser opening.
- Modify `auto/src/index.ts`: start server by default, keep `--once`.
- Create `auto/src/web/index.html`: static console markup.
- Create `auto/src/web/styles.css`: `DESIGN.md`-based tokens and layout.
- Create `auto/src/web/app.js`: browser-side API calls and SSE rendering.
- Create `auto/src/config.test.ts`, `auto/src/runner.test.ts`, `auto/src/scheduler.test.ts`, `auto/src/logger.test.ts`: focused tests for pure and filesystem behavior.
- Modify `auto/README.md`: document web console, persistence, parallel same-directory risk, and commit guidance.

---

### Task 1: Test Harness

**Files:**
- Modify: `/Users/liyang/Documents/code/github/Synapse/auto/package.json`

- [ ] **Step 1: Add test scripts**

Add:

```json
{
  "scripts": {
    "start": "tsx src/index.ts",
    "once": "tsx src/index.ts --once",
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Run empty test command**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test`

Expected: command exits successfully with no test files or no failing tests.

---

### Task 2: Persisted UI Config

**Files:**
- Modify: `/Users/liyang/Documents/code/github/Synapse/auto/src/config.ts`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Tests should assert:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadUiConfig, saveUiConfig, validateUiConfig } from './config.js'

test('validateUiConfig rejects invalid concurrency', () => {
  assert.throws(() => validateUiConfig({ concurrency: 0 }), /concurrency/)
})

test('saveUiConfig persists prompt and runtime settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-'))
  try {
    const file = join(dir, 'ui-config.json')
    await saveUiConfig({
      prompt: 'hello',
      workingDirectory: dir,
      concurrency: 2,
      intervalMinutes: 3,
      timeoutMinutes: 4,
      maxLogs: 5,
      codex: {
        command: 'codex',
        model: 'gpt-test',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        json: true,
      },
    }, file)
    const loaded = await loadUiConfig(file)
    assert.equal(loaded.prompt, 'hello')
    assert.equal(loaded.concurrency, 2)
    assert.equal(loaded.codex.model, 'gpt-test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run config tests and verify red**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/config.test.ts`

Expected: fails because `loadUiConfig`, `saveUiConfig`, and `validateUiConfig` are not implemented.

- [ ] **Step 3: Implement config helpers**

Implement exported `UiConfig`, `DEFAULT_UI_CONFIG`, `UI_CONFIG_PATH`, `loadUiConfig`, `saveUiConfig`, `validateUiConfig`, and path resolution.

- [ ] **Step 4: Run config tests and verify green**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/config.test.ts`

Expected: all config tests pass.

---

### Task 3: Codex Runner Core

**Files:**
- Modify: `/Users/liyang/Documents/code/github/Synapse/auto/src/runner.ts`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Tests should assert:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCodexArgs, buildWorkerPrompt, classifyBatchStatus } from './runner.js'

test('buildWorkerPrompt prepends worker identity and git commit constraint', () => {
  const prompt = buildWorkerPrompt('原始任务', 2, 5)
  assert.match(prompt, /worker 2\/5/)
  assert.match(prompt, /只能 stage 和 commit 你本轮亲自修改的文件/)
  assert.match(prompt, /原始任务/)
})

test('buildCodexArgs omits empty optional model and includes json flag', () => {
  const args = buildCodexArgs({
    command: 'codex',
    model: '',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    json: true,
  }, '/tmp/work')
  assert.deepEqual(args, [
    'exec',
    '--cd', '/tmp/work',
    '--sandbox', 'danger-full-access',
    '--ask-for-approval', 'never',
    '--json',
    '-',
  ])
})

test('classifyBatchStatus distinguishes success partial and error', () => {
  assert.equal(classifyBatchStatus([{ status: 'success' }]), 'success')
  assert.equal(classifyBatchStatus([{ status: 'success' }, { status: 'error' }]), 'partial')
  assert.equal(classifyBatchStatus([{ status: 'timeout' }, { status: 'error' }]), 'error')
})
```

- [ ] **Step 2: Run runner tests and verify red**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/runner.test.ts`

Expected: fails because the exported helpers are not implemented.

- [ ] **Step 3: Implement runner helpers and child-process execution**

Implement `buildWorkerPrompt`, `buildCodexArgs`, `classifyBatchStatus`, and `runWorker`. `runWorker` should spawn `config.codex.command` with built args, write the wrapped prompt to stdin, capture stdout/stderr, parse JSONL opportunistically, enforce timeout, and update a worker logger.

- [ ] **Step 4: Run runner tests and verify green**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/runner.test.ts`

Expected: all runner tests pass.

---

### Task 4: Batch Logger

**Files:**
- Modify: `/Users/liyang/Documents/code/github/Synapse/auto/src/logger.ts`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/logger.test.ts`

- [ ] **Step 1: Write failing logger tests**

Tests should assert a batch directory is created, worker logs can be written, and pruning removes old batch directories by name.

- [ ] **Step 2: Run logger tests and verify red**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/logger.test.ts`

Expected: fails because batch logging APIs do not exist.

- [ ] **Step 3: Implement batch logging**

Implement `BatchLogger`, `WorkerLogger`, and `pruneOldBatchLogs(maxLogs, logsDir?)`.

- [ ] **Step 4: Run logger tests and verify green**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/logger.test.ts`

Expected: all logger tests pass.

---

### Task 5: Scheduler

**Files:**
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/scheduler.ts`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Tests should assert stop-after-current prevents the next batch after the active batch completes and snapshots include worker status.

- [ ] **Step 2: Run scheduler tests and verify red**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/scheduler.test.ts`

Expected: fails because scheduler APIs do not exist.

- [ ] **Step 3: Implement scheduler**

Implement `AutoScheduler` with `start(config)`, `stopAfterCurrent()`, `getSnapshot()`, `subscribe(listener)`, batch lifecycle, waiting timer, and drain behavior.

- [ ] **Step 4: Run scheduler tests and verify green**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test -- src/scheduler.test.ts`

Expected: all scheduler tests pass.

---

### Task 6: HTTP Server and Web UI

**Files:**
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/server.ts`
- Modify: `/Users/liyang/Documents/code/github/Synapse/auto/src/index.ts`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/web/index.html`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/web/styles.css`
- Create: `/Users/liyang/Documents/code/github/Synapse/auto/src/web/app.js`

- [ ] **Step 1: Implement HTTP server**

Add routes for `/`, `/assets/*`, `/api/config`, `/api/start`, `/api/stop-after-current`, `/api/status`, and `/events`.

- [ ] **Step 2: Implement web console UI**

Use static HTML/CSS/JS. Follow `DESIGN.md`: tokenized CSS variables, ink-on-canvas surfaces, hairline borders, compact form controls, mono technical labels, no inline styles, no decorative emoji, no marketing hero.

- [ ] **Step 3: Wire entrypoint**

Make `pnpm start` start the server and open the browser. Keep `pnpm once` as a saved-config one-batch path.

- [ ] **Step 4: Typecheck**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto typecheck`

Expected: TypeScript exits 0.

---

### Task 7: Docs and Final Verification

**Files:**
- Modify: `/Users/liyang/Documents/code/github/Synapse/auto/README.md`

- [ ] **Step 1: Update README**

Document web console startup, persisted config, same-directory parallelism risk, worker git commit constraint, stop-after-current, and logs.

- [ ] **Step 2: Run all tests**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto test`

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto typecheck`

Expected: TypeScript exits 0.

- [ ] **Step 4: Manual smoke**

Run: `pnpm --dir /Users/liyang/Documents/code/github/Synapse/auto start`

Expected: local HTTP server prints a URL and opens the browser. Stop the server after confirming it starts; do not run a real long Codex batch unless using a harmless prompt.
