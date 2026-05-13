import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
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

test('saveUiConfig persists prompt and runtime settings in separate files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
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
    }, file, promptFile)

    const loaded = await loadUiConfig(file, promptFile)
    const savedConfig = JSON.parse(await readFile(file, 'utf-8'))
    assert.equal(loaded.prompt, 'hello')
    assert.equal(await readFile(promptFile, 'utf-8'), 'hello')
    assert.equal('prompt' in savedConfig, false)
    assert.equal(loaded.workingDirectory, dir)
    assert.equal(loaded.concurrency, 2)
    assert.equal(loaded.codex.model, 'gpt-test')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadUiConfig reads prompt from prompt file instead of ui config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-config-prompt-'))
  try {
    const file = join(dir, 'ui-config.json')
    const promptFile = join(dir, 'prompt.md')
    await writeFile(file, `${JSON.stringify({
      ...DEFAULT_UI_CONFIG,
      prompt: 'legacy prompt',
      workingDirectory: dir,
    }, null, 2)}\n`, 'utf-8')
    await writeFile(promptFile, 'from prompt file', 'utf-8')

    const loaded = await loadUiConfig(file, promptFile)
    assert.equal(loaded.prompt, 'from prompt file')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
