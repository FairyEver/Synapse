import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DEFAULT_UI_CONFIG,
  MAX_CONCURRENCY,
  MAX_LOGS,
  MAX_TIMEOUT_MINUTES,
  loadUiConfig,
  saveUiConfig,
  validateUiConfig,
} from './config.js'

test('DEFAULT_UI_CONFIG uses GPT-5.6 Sol as the default model', () => {
  assert.equal(DEFAULT_UI_CONFIG.codex.model, 'gpt-5.6-sol')
})

test('validateUiConfig rejects invalid concurrency', () => {
  assert.throws(() => validateUiConfig({ concurrency: 0 }), /concurrency/)
})

test('validateUiConfig rejects resource limit values above supported bounds', () => {
  assert.equal(MAX_CONCURRENCY, 20)
  assert.throws(() => validateUiConfig({ concurrency: MAX_CONCURRENCY + 1 }), /concurrency/)
  assert.throws(() => validateUiConfig({ timeoutMinutes: MAX_TIMEOUT_MINUTES + 1 }), /timeoutMinutes/)
  assert.throws(() => validateUiConfig({ maxLogs: MAX_LOGS + 1 }), /maxLogs/)

  const config = validateUiConfig({
    concurrency: MAX_CONCURRENCY,
    timeoutMinutes: MAX_TIMEOUT_MINUTES,
    maxLogs: MAX_LOGS,
  })
  assert.equal(config.concurrency, MAX_CONCURRENCY)
  assert.equal(config.timeoutMinutes, MAX_TIMEOUT_MINUTES)
  assert.equal(config.maxLogs, MAX_LOGS)
})

test('validateUiConfig fills blank model with GPT-5.6 Sol', () => {
  const config = validateUiConfig({ codex: { model: '' } })
  assert.equal(config.codex.model, 'gpt-5.6-sol')
})

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
      intervalSeconds: 180,
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
