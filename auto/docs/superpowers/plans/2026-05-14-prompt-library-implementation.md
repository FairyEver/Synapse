# Prompt Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-backed prompt library to `auto` so users can create, rename, switch, save, and delete multiple prompts while keeping runtime settings shared.

**Architecture:** Add a focused prompt-library module that owns all `prompts/<name>.md` filesystem operations and path/name validation. Keep `config.ts` responsible for merging runtime config with the active prompt, and keep `runner.ts` unchanged because it already consumes `UiConfig.prompt`.

**Tech Stack:** Node.js `fs/promises`, TypeScript, `node:test`, static HTML/CSS/JS.

---

## File Structure

- Create `auto/src/prompt-library.ts`: prompt name validation, prompt listing, migration from `prompt.md`, create/read/write/rename/delete operations. This module computes its own default paths and must not import `config.ts`.
- Create `auto/src/prompt-library.test.ts`: focused tests for storage, migration, validation, and file operations.
- Modify `auto/src/config.ts`: add `activePromptName` and `prompts` to loaded config, persist `activePromptName` in `state/ui-config.json`, write prompt content to the active prompt file.
- Modify `auto/src/config.test.ts`: update existing prompt persistence tests for the library model and add active prompt fallback coverage.
- Modify `auto/src/server.ts`: add prompt management HTTP endpoints.
- Modify `auto/src/web/index.html`: add selector/actions and a small unsaved-changes dialog above the prompt textarea.
- Modify `auto/src/web/app.js`: add prompt library state, create/rename/delete/switch flows, dirty tracking, and active prompt submission.
- Modify `auto/src/web/styles.css`: add layout-only classes for the selector row/dialog using existing CSS variables only.
- Modify `auto/README.md`: document `prompts/`, migration, and the selected prompt behavior for `pnpm once`.

## Task 1: Prompt Library Module

**Files:**
- Create: `auto/src/prompt-library.ts`
- Create: `auto/src/prompt-library.test.ts`

- [ ] **Step 1: Write failing tests for prompt storage and validation**

Create `auto/src/prompt-library.test.ts` with these tests:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createPrompt,
  deletePrompt,
  ensurePromptLibrary,
  listPromptNames,
  readPrompt,
  renamePrompt,
  validatePromptName,
  writePrompt,
} from './prompt-library.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'auto-prompts-'))
}

test('ensurePromptLibrary migrates legacy prompt.md into default prompt', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    const legacyPromptPath = join(dir, 'prompt.md')
    await writeFile(legacyPromptPath, 'legacy prompt', 'utf-8')

    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath })

    assert.deepEqual(library.prompts, ['default'])
    assert.equal(library.activePromptName, 'default')
    assert.equal(library.prompt, 'legacy prompt')
    assert.equal(await readFile(join(promptsDir, 'default.md'), 'utf-8'), 'legacy prompt')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ensurePromptLibrary keeps existing prompt library instead of migrating legacy prompt', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    const legacyPromptPath = join(dir, 'prompt.md')
    await createPrompt('夜间审查', { promptsDir })
    await writePrompt('夜间审查', 'library prompt', { promptsDir })
    await writeFile(legacyPromptPath, 'legacy prompt', 'utf-8')

    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath })

    assert.deepEqual(library.prompts, ['夜间审查'])
    assert.equal(library.activePromptName, '夜间审查')
    assert.equal(library.prompt, 'library prompt')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ensurePromptLibrary creates an empty default prompt when no prompt exists', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    const legacyPromptPath = join(dir, 'prompt.md')

    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath })

    assert.deepEqual(library.prompts, ['default'])
    assert.equal(library.activePromptName, 'default')
    assert.equal(library.prompt, '')
    assert.equal(await readFile(join(promptsDir, 'default.md'), 'utf-8'), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('listPromptNames returns sorted markdown file names only', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    await createPrompt('b', { promptsDir })
    await createPrompt('a', { promptsDir })
    await writeFile(join(promptsDir, 'notes.txt'), 'ignore', 'utf-8')

    assert.deepEqual(await listPromptNames(promptsDir), ['a', 'b'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('validatePromptName rejects invalid names', () => {
  for (const name of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*', 'a?', 'a"', 'a<', 'a>', 'a|', 'name.md']) {
    assert.throws(() => validatePromptName(name), /prompt name/i)
  }
})

test('validatePromptName rejects duplicates', () => {
  assert.throws(() => validatePromptName('default', ['default']), /already exists/i)
})

test('read and write prompt use the validated prompt path', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    await createPrompt('default', { promptsDir })
    await writePrompt('default', 'updated', { promptsDir })

    assert.equal(await readPrompt('default', { promptsDir }), 'updated')
    await assert.rejects(() => readPrompt('../outside', { promptsDir }), /prompt name/i)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('renamePrompt renames files and preserves content', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    await createPrompt('old', { promptsDir })
    await writePrompt('old', 'content', { promptsDir })

    await renamePrompt('old', 'new', { promptsDir })

    assert.deepEqual(await listPromptNames(promptsDir), ['new'])
    assert.equal(await readPrompt('new', { promptsDir }), 'content')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('deletePrompt removes the prompt file', async () => {
  const dir = await tempDir()
  try {
    const promptsDir = join(dir, 'prompts')
    await createPrompt('default', { promptsDir })

    await deletePrompt('default', { promptsDir })

    assert.deepEqual(await listPromptNames(promptsDir), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir auto exec node --import tsx --test src/prompt-library.test.ts
```

Expected: FAIL with an import/module-not-found error for `./prompt-library.js`.

- [ ] **Step 3: Implement the prompt-library module**

Create `auto/src/prompt-library.ts`:

```ts
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, extname, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(__dirname, '..')
export const PROMPTS_DIR = resolve(PACKAGE_ROOT, 'prompts')
export const LEGACY_PROMPT_PATH = resolve(PACKAGE_ROOT, 'prompt.md')

export interface PromptLibraryPaths {
  promptsDir?: string
  legacyPromptPath?: string
}

export interface PromptLibraryState {
  activePromptName: string
  prompts: string[]
  prompt: string
}

const INVALID_PROMPT_NAME = /[\\/:*?"<>|]/

function promptsRoot(paths: PromptLibraryPaths = {}): string {
  return paths.promptsDir ?? PROMPTS_DIR
}

function legacyPrompt(paths: PromptLibraryPaths = {}): string {
  return paths.legacyPromptPath ?? LEGACY_PROMPT_PATH
}

function assertInside(root: string, path: string): void {
  const relativePath = relative(root, path)
  if (relativePath.startsWith('..') || resolve(path) === resolve(root)) {
    throw new Error('Invalid prompt path')
  }
}

export function validatePromptName(name: string, existingNames: string[] = []): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Prompt name is required')
  if (trimmed === '.' || trimmed === '..') throw new Error('Prompt name is invalid')
  if (trimmed.endsWith('.md')) throw new Error('Prompt name must not end with .md')
  if (INVALID_PROMPT_NAME.test(trimmed)) throw new Error('Prompt name contains invalid characters')
  if (existingNames.includes(trimmed)) throw new Error('Prompt name already exists')
  return trimmed
}

function promptPath(name: string, paths: PromptLibraryPaths = {}, existingNames: string[] = []): string {
  const safeName = validatePromptName(name, existingNames)
  const root = resolve(promptsRoot(paths))
  const path = resolve(root, `${safeName}.md`)
  assertInside(root, path)
  return path
}

async function readLegacyPrompt(paths: PromptLibraryPaths = {}): Promise<string> {
  try {
    return await readFile(legacyPrompt(paths), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

async function ensurePromptsDir(paths: PromptLibraryPaths = {}): Promise<void> {
  await mkdir(promptsRoot(paths), { recursive: true })
}

export async function listPromptNames(promptsDir = PROMPTS_DIR): Promise<string[]> {
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && extname(entry.name) === '.md')
      .map(entry => basename(entry.name, '.md'))
      .sort((a, b) => a.localeCompare(b))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function readPrompt(name: string, paths: PromptLibraryPaths = {}): Promise<string> {
  return readFile(promptPath(name, paths), 'utf-8')
}

export async function writePrompt(name: string, content: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await ensurePromptsDir(paths)
  await writeFile(promptPath(name, paths), content, 'utf-8')
}

export async function createPrompt(name: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await ensurePromptsDir(paths)
  const existing = await listPromptNames(promptsRoot(paths))
  await writeFile(promptPath(name, paths, existing), '', 'utf-8')
}

export async function renamePrompt(fromName: string, toName: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await ensurePromptsDir(paths)
  const existing = await listPromptNames(promptsRoot(paths))
  if (!existing.includes(fromName)) throw new Error('Prompt not found')
  await rename(promptPath(fromName, paths), promptPath(toName, paths, existing))
}

export async function deletePrompt(name: string, paths: PromptLibraryPaths = {}): Promise<void> {
  await rm(promptPath(name, paths), { force: false })
}

export async function ensurePromptLibrary(
  paths: PromptLibraryPaths = {},
  preferredPromptName = ''
): Promise<PromptLibraryState> {
  await ensurePromptsDir(paths)
  let prompts = await listPromptNames(promptsRoot(paths))

  if (prompts.length === 0) {
    const legacy = await readLegacyPrompt(paths)
    await writePrompt('default', legacy, paths)
    prompts = ['default']
  }

  const activePromptName = preferredPromptName && prompts.includes(preferredPromptName)
    ? preferredPromptName
    : prompts[0]

  return {
    activePromptName,
    prompts,
    prompt: await readPrompt(activePromptName, paths),
  }
}
```

- [ ] **Step 4: Run prompt-library tests**

Run:

```bash
pnpm --dir auto exec node --import tsx --test src/prompt-library.test.ts
```

Expected: PASS, with all `prompt-library` tests passing.

- [ ] **Step 5: Commit Task 1**

```bash
git add auto/src/prompt-library.ts auto/src/prompt-library.test.ts
git commit -m "feat(auto): add prompt library storage"
```

## Task 2: Config Integration

**Files:**
- Modify: `auto/src/config.ts`
- Modify: `auto/src/config.test.ts`

- [ ] **Step 1: Add failing config tests for active prompt loading and saving**

Append these tests to `auto/src/config.test.ts` and update the existing prompt persistence test in this task:

```ts
test('loadUiConfig migrates legacy prompt into prompt library', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-library-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    const promptsDir = join(dir, 'prompts')
    await writeFile(promptFile, 'legacy prompt', 'utf-8')

    const loaded = await loadUiConfig(file, promptFile, promptsDir)

    assert.equal(loaded.activePromptName, 'default')
    assert.deepEqual(loaded.prompts, ['default'])
    assert.equal(loaded.prompt, 'legacy prompt')
    assert.equal(await readFile(join(promptsDir, 'default.md'), 'utf-8'), 'legacy prompt')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadUiConfig uses saved active prompt name when it exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-active-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    const promptsDir = join(dir, 'prompts')
    await mkdir(promptsDir, { recursive: true })
    await writeFile(join(promptsDir, 'a.md'), 'prompt a', 'utf-8')
    await writeFile(join(promptsDir, 'b.md'), 'prompt b', 'utf-8')
    await writeFile(file, `${JSON.stringify({
      ...DEFAULT_UI_CONFIG,
      activePromptName: 'b',
      workingDirectory: dir,
    }, null, 2)}\n`, 'utf-8')

    const loaded = await loadUiConfig(file, promptFile, promptsDir)

    assert.equal(loaded.activePromptName, 'b')
    assert.deepEqual(loaded.prompts, ['a', 'b'])
    assert.equal(loaded.prompt, 'prompt b')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadUiConfig falls back when saved active prompt is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-missing-active-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    const promptsDir = join(dir, 'prompts')
    await mkdir(promptsDir, { recursive: true })
    await writeFile(join(promptsDir, 'a.md'), 'prompt a', 'utf-8')
    await writeFile(file, `${JSON.stringify({
      ...DEFAULT_UI_CONFIG,
      activePromptName: 'missing',
      workingDirectory: dir,
    }, null, 2)}\n`, 'utf-8')

    const loaded = await loadUiConfig(file, promptFile, promptsDir)

    assert.equal(loaded.activePromptName, 'a')
    assert.equal(loaded.prompt, 'prompt a')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

Replace the existing `saveUiConfig persists prompt and runtime settings in separate files` test with:

```ts
test('saveUiConfig persists active prompt content and runtime settings separately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-save-library-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    const promptsDir = join(dir, 'prompts')
    await mkdir(promptsDir, { recursive: true })
    await writeFile(join(promptsDir, 'work.md'), 'old', 'utf-8')

    await saveUiConfig({
      prompt: 'hello',
      activePromptName: 'work',
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
    }, file, promptFile, promptsDir)

    const loaded = await loadUiConfig(file, promptFile, promptsDir)
    const savedConfig = JSON.parse(await readFile(file, 'utf-8'))
    assert.equal(loaded.prompt, 'hello')
    assert.equal(await readFile(join(promptsDir, 'work.md'), 'utf-8'), 'hello')
    assert.equal('prompt' in savedConfig, false)
    assert.equal(savedConfig.activePromptName, 'work')
    assert.equal(loaded.workingDirectory, dir)
    assert.equal(loaded.concurrency, 2)
    assert.equal(loaded.codex.model, 'gpt-test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
pnpm --dir auto exec node --import tsx --test src/config.test.ts
```

Expected: FAIL because `UiConfig` does not yet include `activePromptName`/`prompts`, and config still reads/writes `prompt.md`.

- [ ] **Step 3: Integrate prompt library into config**

Modify `auto/src/config.ts`:

```ts
import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ensurePromptLibrary, listPromptNames, readPrompt, writePrompt, PROMPTS_DIR } from './prompt-library.js'
```

Extend `UiConfig`:

```ts
export interface UiConfig {
  prompt: string
  activePromptName: string
  prompts: string[]
  workingDirectory: string
  concurrency: number
  intervalMinutes: number
  timeoutMinutes: number
  maxLogs: number
  codex: CodexConfig
}
```

Update `DEFAULT_UI_CONFIG`:

```ts
export const DEFAULT_UI_CONFIG: UiConfig = {
  prompt: '',
  activePromptName: 'default',
  prompts: [],
  workingDirectory: PACKAGE_ROOT,
  concurrency: 1,
  intervalMinutes: 30,
  timeoutMinutes: 30,
  maxLogs: 50,
  codex: {
    command: 'codex',
    model: 'gpt-5.5',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    json: true,
    disableMcp: true,
  },
}
```

Inside `validateUiConfig`, add active prompt validation as a string:

```ts
const prompt = stringValue(merged.prompt, 'prompt')
const activePromptName = stringValue(merged.activePromptName, 'activePromptName').trim() || DEFAULT_UI_CONFIG.activePromptName
const prompts = Array.isArray(merged.prompts)
  ? merged.prompts.filter((name): name is string => typeof name === 'string')
  : []
```

Return the new fields:

```ts
return {
  prompt,
  activePromptName,
  prompts,
  workingDirectory: resolveFromPackageRoot(workingDirectory),
  concurrency: positiveInteger(merged.concurrency, 'concurrency'),
  intervalMinutes: positiveInteger(merged.intervalMinutes, 'intervalMinutes'),
  timeoutMinutes: positiveInteger(merged.timeoutMinutes, 'timeoutMinutes'),
  maxLogs: positiveInteger(merged.maxLogs, 'maxLogs'),
  codex: {
    command,
    model: stringValue(merged.codex.model, 'codex.model').trim() || DEFAULT_UI_CONFIG.codex.model,
    sandbox: sandboxValue(merged.codex.sandbox),
    approvalPolicy: approvalValue(merged.codex.approvalPolicy),
    json: booleanValue(merged.codex.json, 'codex.json'),
    disableMcp: booleanValue(merged.codex.disableMcp, 'codex.disableMcp'),
  },
}
```

Replace `uiConfigFile`:

```ts
function uiConfigFile(config: UiConfig): Omit<UiConfig, 'prompt' | 'prompts'> {
  return {
    activePromptName: config.activePromptName,
    workingDirectory: config.workingDirectory,
    concurrency: config.concurrency,
    intervalMinutes: config.intervalMinutes,
    timeoutMinutes: config.timeoutMinutes,
    maxLogs: config.maxLogs,
    codex: config.codex,
  }
}
```

Replace `loadUiConfig` and `saveUiConfig`:

```ts
export async function loadUiConfig(
  path = UI_CONFIG_PATH,
  promptPath = PROMPT_PATH,
  promptsDir = PROMPTS_DIR
): Promise<UiConfig> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'))
    const activePromptName = isRecord(raw) && typeof raw.activePromptName === 'string' ? raw.activePromptName : ''
    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath: promptPath }, activePromptName)
    return validateUiConfig({
      ...raw,
      prompt: library.prompt,
      activePromptName: library.activePromptName,
      prompts: library.prompts,
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const library = await ensurePromptLibrary({ promptsDir, legacyPromptPath: promptPath })
    return validateUiConfig({
      ...DEFAULT_UI_CONFIG,
      prompt: library.prompt,
      activePromptName: library.activePromptName,
      prompts: library.prompts,
    })
  }
}

export async function saveUiConfig(
  config: unknown,
  path = UI_CONFIG_PATH,
  promptPath = PROMPT_PATH,
  promptsDir = PROMPTS_DIR
): Promise<UiConfig> {
  const validated = validateUiConfig(config)
  const existingPrompts = await listPromptNames(promptsDir)
  if (!existingPrompts.includes(validated.activePromptName)) {
    throw new Error('Active prompt not found')
  }
  await mkdir(dirname(path), { recursive: true })
  await writePrompt(validated.activePromptName, validated.prompt, { promptsDir, legacyPromptPath: promptPath })
  const prompts = await listPromptNames(promptsDir)
  const saved = validateUiConfig({ ...validated, prompts })
  await writeFileIfChanged(path, `${JSON.stringify(uiConfigFile(saved), null, 2)}\n`)
  return saved
}
```

Remove the now-unused `readPromptFile` function from `config.ts`.

- [ ] **Step 4: Run config tests**

Run:

```bash
pnpm --dir auto exec node --import tsx --test src/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run prompt-library tests again**

Run:

```bash
pnpm --dir auto exec node --import tsx --test src/prompt-library.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add auto/src/config.ts auto/src/config.test.ts
git commit -m "feat(auto): load active prompt from library"
```

## Task 3: Server Endpoints

**Files:**
- Modify: `auto/src/server.ts`

- [ ] **Step 1: Add prompt endpoint helpers**

Modify imports in `auto/src/server.ts`:

```ts
import { createPrompt, deletePrompt, readPrompt, renamePrompt } from './prompt-library.js'
```

Add helper functions near `readJson`:

```ts
function promptNameFromPath(pathname: string, prefix: string): string {
  return decodeURIComponent(pathname.slice(prefix.length))
}

function bodyName(body: unknown, field: string): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`${field} is required`)
  }
  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string') throw new Error(`${field} is required`)
  return value
}
```

- [ ] **Step 2: Add HTTP routes**

Inside `createHandler`, add these routes after `/api/config` and before `/api/start`:

```ts
      if (req.method === 'POST' && url.pathname === '/api/prompts') {
        const body = await readJson(req)
        const name = bodyName(body, 'name')
        await createPrompt(name)
        const config = await loadUiConfig()
        sendJson(res, 200, config)
        return
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/prompts/')) {
        const name = promptNameFromPath(url.pathname, '/api/prompts/')
        sendJson(res, 200, { name, prompt: await readPrompt(name) })
        return
      }

      if (req.method === 'PUT' && url.pathname.startsWith('/api/prompts/') && url.pathname.endsWith('/rename')) {
        const prefix = '/api/prompts/'
        const name = decodeURIComponent(url.pathname.slice(prefix.length, -'/rename'.length))
        const body = await readJson(req)
        const nextName = bodyName(body, 'name')
        await renamePrompt(name, nextName)
        const current = await loadUiConfig()
        const activePromptName = current.activePromptName === name ? nextName : current.activePromptName
        const config = await saveUiConfig({ ...current, activePromptName, prompt: await readPrompt(activePromptName) })
        sendJson(res, 200, config)
        return
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/prompts/')) {
        const name = promptNameFromPath(url.pathname, '/api/prompts/')
        await deletePrompt(name)
        const config = await loadUiConfig()
        sendJson(res, 200, config)
        return
      }
```

Keep the existing catch block, which returns `{ error: message }` as JSON.

- [ ] **Step 3: Run server-adjacent checks**

Run:

```bash
pnpm --dir auto typecheck
pnpm --dir auto test
```

Expected: both PASS.

- [ ] **Step 4: Commit Task 3**

```bash
git add auto/src/server.ts
git commit -m "feat(auto): expose prompt library endpoints"
```

## Task 4: Web UI Prompt Library Controls

**Files:**
- Modify: `auto/src/web/index.html`
- Modify: `auto/src/web/app.js`
- Modify: `auto/src/web/styles.css`

- [ ] **Step 1: Update HTML controls**

In `auto/src/web/index.html`, replace the prompt label block with:

```html
            <div class="prompt-tools">
              <label class="field prompt-select-field">
                <span>提示词</span>
                <select id="activePromptName"></select>
              </label>
              <div class="prompt-actions" aria-label="提示词操作">
                <button id="new-prompt" class="button secondary" type="button">新建</button>
                <button id="rename-prompt" class="button secondary" type="button">重命名</button>
                <button id="delete-prompt" class="button secondary" type="button">删除</button>
              </div>
            </div>

            <label class="field span-all">
              <span>内容</span>
              <textarea id="prompt" rows="9" spellcheck="false"></textarea>
            </label>

            <dialog id="unsaved-dialog" class="dialog">
              <form method="dialog" class="dialog-body">
                <h2>未保存</h2>
                <div class="dialog-actions">
                  <button id="switch-save" class="button primary" value="save" type="submit">保存并切换</button>
                  <button id="switch-discard" class="button secondary" value="discard" type="submit">放弃修改</button>
                  <button class="button secondary" value="cancel" type="submit">取消</button>
                </div>
              </form>
            </dialog>
```

- [ ] **Step 2: Add layout CSS using existing variables**

Append to `auto/src/web/styles.css`:

```css
.prompt-tools {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: var(--space-sm);
  align-items: end;
  margin-bottom: var(--space-md);
}

.prompt-actions,
.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.dialog {
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  background: var(--canvas);
  color: var(--ink);
  padding: 0;
}

.dialog-body {
  display: grid;
  gap: var(--space-md);
  min-width: 360px;
  padding: var(--space-lg);
}

@media (max-width: 720px) {
  .prompt-tools {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Update frontend state and form serialization**

In `auto/src/web/app.js`, add the new fields:

```js
const fields = {
  prompt: document.querySelector('#prompt'),
  activePromptName: document.querySelector('#activePromptName'),
  workingDirectory: document.querySelector('#workingDirectory'),
  concurrency: document.querySelector('#concurrency'),
  intervalMinutes: document.querySelector('#intervalMinutes'),
  timeoutMinutes: document.querySelector('#timeoutMinutes'),
  maxLogs: document.querySelector('#maxLogs'),
  codexCommand: document.querySelector('#codexCommand'),
  codexModel: document.querySelector('#codexModel'),
  codexSandbox: document.querySelector('#codexSandbox'),
  codexApprovalPolicy: document.querySelector('#codexApprovalPolicy'),
}
```

Add elements and state:

```js
const elements = {
  save: document.querySelector('#save'),
  start: document.querySelector('#start'),
  stopAfterCurrent: document.querySelector('#stop-after-current'),
  newPrompt: document.querySelector('#new-prompt'),
  renamePrompt: document.querySelector('#rename-prompt'),
  deletePrompt: document.querySelector('#delete-prompt'),
  unsavedDialog: document.querySelector('#unsaved-dialog'),
  configTab: document.querySelector('#config-tab'),
  runTab: document.querySelector('#run-tab'),
  configView: document.querySelector('#config-view'),
  runView: document.querySelector('#run-view'),
  saveState: document.querySelector('#save-state'),
  schedulerStatus: document.querySelector('#scheduler-status'),
  batchId: document.querySelector('#batch-id'),
  batchStarted: document.querySelector('#batch-started'),
  summaryPath: document.querySelector('#summary-path'),
  workers: document.querySelector('#workers'),
  error: document.querySelector('#error'),
}

const state = {
  activePromptName: '',
  savedPrompt: '',
  pendingPromptName: '',
}
```

Update `readForm`:

```js
function readForm() {
  return {
    prompt: fields.prompt.value,
    activePromptName: fields.activePromptName.value,
    workingDirectory: fields.workingDirectory.value,
    concurrency: numberValue(fields.concurrency),
    intervalMinutes: numberValue(fields.intervalMinutes),
    timeoutMinutes: numberValue(fields.timeoutMinutes),
    maxLogs: numberValue(fields.maxLogs),
    codex: {
      command: fields.codexCommand.value,
      model: fields.codexModel.value,
      sandbox: fields.codexSandbox.value,
      approvalPolicy: fields.codexApprovalPolicy.value,
      json: true,
    },
  }
}
```

Add selector rendering:

```js
function renderPromptOptions(prompts, activePromptName) {
  fields.activePromptName.replaceChildren(...(prompts || []).map(name => {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    option.selected = name === activePromptName
    return option
  }))
}
```

Update `writeForm`:

```js
function writeForm(config) {
  state.activePromptName = config.activePromptName || 'default'
  state.savedPrompt = config.prompt || ''
  renderPromptOptions(config.prompts || [state.activePromptName], state.activePromptName)
  fields.prompt.value = config.prompt || ''
  fields.workingDirectory.value = config.workingDirectory || ''
  fields.concurrency.value = config.concurrency || 1
  fields.intervalMinutes.value = config.intervalMinutes || 30
  fields.timeoutMinutes.value = config.timeoutMinutes || 30
  fields.maxLogs.value = config.maxLogs || 50
  fields.codexCommand.value = config.codex?.command || 'codex'
  fields.codexModel.value = config.codex?.model || 'gpt-5.5'
  fields.codexSandbox.value = config.codex?.sandbox || 'danger-full-access'
  fields.codexApprovalPolicy.value = config.codex?.approvalPolicy || 'never'
}
```

- [ ] **Step 4: Implement prompt actions**

Add these functions to `auto/src/web/app.js`:

```js
function hasPromptChanges() {
  return fields.prompt.value !== state.savedPrompt
}

function promptUrl(name) {
  return `/api/prompts/${encodeURIComponent(name)}`
}

async function saveConfig() {
  const config = await requestJson('/api/config', {
    method: 'PUT',
    body: JSON.stringify(readForm()),
  })
  writeForm(config)
  setMessage('已保存')
}

async function loadPrompt(name) {
  const body = await requestJson(promptUrl(name))
  fields.prompt.value = body.prompt || ''
  state.savedPrompt = fields.prompt.value
  state.activePromptName = name
  fields.activePromptName.value = name
}

async function switchPrompt(name) {
  if (!name || name === state.activePromptName) {
    fields.activePromptName.value = state.activePromptName
    return
  }
  if (!hasPromptChanges()) {
    await loadPrompt(name)
    return
  }
  state.pendingPromptName = name
  elements.unsavedDialog.showModal()
}

async function createPrompt() {
  const name = window.prompt('提示词名称')
  if (!name) return
  const config = await requestJson('/api/prompts', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  writeForm({ ...config, activePromptName: name, prompt: '' })
  await loadPrompt(name)
  setMessage('已新建')
}

async function renameActivePrompt() {
  const name = window.prompt('提示词名称', state.activePromptName)
  if (!name || name === state.activePromptName) return
  const currentPrompt = fields.prompt.value
  const renamed = await requestJson(`${promptUrl(state.activePromptName)}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  writeForm({ ...renamed, activePromptName: name, prompt: currentPrompt })
  const saved = await requestJson('/api/config', {
    method: 'PUT',
    body: JSON.stringify(readForm()),
  })
  writeForm(saved)
  setMessage('已重命名')
}

async function deleteActivePrompt() {
  if (!window.confirm(`删除提示词「${state.activePromptName}」？`)) return
  const config = await requestJson(promptUrl(state.activePromptName), { method: 'DELETE' })
  writeForm(config)
  setMessage('已删除')
}

elements.unsavedDialog.addEventListener('close', () => {
  const action = elements.unsavedDialog.returnValue
  const nextName = state.pendingPromptName
  state.pendingPromptName = ''
  if (!nextName || action === 'cancel') {
    fields.activePromptName.value = state.activePromptName
    return
  }
  const run = async () => {
    if (action === 'save') await saveConfig()
    await loadPrompt(nextName)
  }
  void run().catch(err => {
    fields.activePromptName.value = state.activePromptName
    setMessage(err instanceof Error ? err.message : String(err), true)
  })
})
```

Replace the existing `saveConfig` function with the version above.

Add event listeners:

```js
fields.prompt.addEventListener('input', () => {
  setMessage(hasPromptChanges() ? '未保存' : '')
})

fields.activePromptName.addEventListener('change', () => {
  void switchPrompt(fields.activePromptName.value).catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.newPrompt.addEventListener('click', () => {
  void createPrompt().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.renamePrompt.addEventListener('click', () => {
  void renameActivePrompt().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})

elements.deletePrompt.addEventListener('click', () => {
  void deleteActivePrompt().catch(err => setMessage(err instanceof Error ? err.message : String(err), true))
})
```

Keep the existing save/start/stop/tab event listeners.

- [ ] **Step 5: Run static checks**

Run:

```bash
pnpm --dir auto typecheck
pnpm --dir auto test
```

Expected: both PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add auto/src/web/index.html auto/src/web/app.js auto/src/web/styles.css
git commit -m "feat(auto): add prompt library controls"
```

## Task 5: Docs and Final Verification

**Files:**
- Modify: `auto/README.md`

- [ ] **Step 1: Update README storage docs**

In `auto/README.md`, replace the prompt storage section:

```md
Prompt 会保存到：

```text
prompt.md
```
```

with:

```md
提示词库会保存到：

```text
prompts/
  default.md
  <提示词名称>.md
```

第一次启动时，如果 `prompts/` 为空且旧的 `prompt.md` 有内容，会迁移为 `prompts/default.md`。迁移后运行以提示词库中的当前选中项为准。
```

Update the parallel behavior sentence:

```md
每一批会同时启动多个 `codex exec` 进程。所有 worker 使用同一个工作目录和当前选中的 Prompt。
```

- [ ] **Step 2: Run all package verification**

Run:

```bash
pnpm --dir auto test
pnpm --dir auto typecheck
```

Expected: both PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff -- auto
```

Expected: only files listed in this plan changed; no generated logs, `.superpowers`, or runtime state files are staged.

- [ ] **Step 4: Commit Task 5**

```bash
git add auto/README.md
git commit -m "docs(auto): document prompt library"
```

## Self-Review

Spec coverage:

- Multiple named prompts: Task 1 creates file-backed library operations; Task 4 exposes UI controls.
- Markdown files in `prompts/`: Task 1 uses `prompts/<name>.md`; Task 5 documents it.
- Basic operations: Task 1 covers filesystem operations, Task 3 exposes endpoints, Task 4 wires UI.
- Shared runtime settings: Task 2 keeps runtime config in `state/ui-config.json`; Task 4 only adds active prompt selection.
- Runner contract unchanged: Task 2 still returns `UiConfig.prompt`; no task modifies `runner.ts`.
- Legacy migration: Task 1 and Task 2 both test migration from `prompt.md`.
- Name validation and path safety: Task 1 validates names and path containment, with tests.
- Unsaved switch confirmation and delete confirmation: Task 4 adds dialog and confirm flow.

Placeholder scan:

- No unresolved markers or open decisions remain.

Type consistency:

- `activePromptName`, `prompts`, and `prompt` are introduced in Task 2 and used by Task 3 and Task 4 with the same names.
- Prompt endpoint names are consistent: `POST /api/prompts`, `GET /api/prompts/:name`, `PUT /api/prompts/:name/rename`, `DELETE /api/prompts/:name`.
