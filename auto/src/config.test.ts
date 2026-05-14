import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_UI_CONFIG, loadUiConfig, saveUiConfig, validateUiConfig } from './config.js'

test('DEFAULT_UI_CONFIG uses GPT-5.5 as the default model', () => {
  assert.equal(DEFAULT_UI_CONFIG.codex.model, 'gpt-5.5')
})

test('validateUiConfig rejects invalid concurrency', () => {
  assert.throws(() => validateUiConfig({ concurrency: 0 }), /concurrency/)
})

test('validateUiConfig fills blank model with GPT-5.5', () => {
  const config = validateUiConfig({ codex: { model: '' } })
  assert.equal(config.codex.model, 'gpt-5.5')
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
