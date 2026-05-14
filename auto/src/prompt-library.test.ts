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
