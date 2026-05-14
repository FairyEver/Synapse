import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'http'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AutoScheduler } from './scheduler.js'
import { createHandler } from './server.js'

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

async function requestJson(baseUrl: string, path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(body))
  return body
}

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

test('prompt API creates, reads, renames, and deletes prompts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-server-'))
  const server = createServer(createHandler(new AutoScheduler(), {
    configPath: join(dir, 'ui-config.json'),
    promptPath: join(dir, 'prompt.md'),
    promptsDir: join(dir, 'prompts'),
  }))
  try {
    await mkdir(join(dir, 'prompts'), { recursive: true })
    const baseUrl = await listen(server)

    const initialConfig = record(await requestJson(baseUrl, '/api/config'))
    assert.equal(initialConfig.activePromptName, 'default')

    await requestJson(baseUrl, '/api/prompts', {
      method: 'POST',
      body: JSON.stringify({ name: 'work' }),
    })

    const created = record(await requestJson(baseUrl, '/api/prompts/work'))
    assert.equal(created.name, 'work')
    assert.equal(created.prompt, '')

    await requestJson(baseUrl, '/api/config', {
      method: 'PUT',
      body: JSON.stringify({
        ...initialConfig,
        activePromptName: 'work',
        prompt: 'hello',
      }),
    })

    const saved = record(await requestJson(baseUrl, '/api/prompts/work'))
    assert.equal(saved.prompt, 'hello')

    const renamedConfig = record(await requestJson(baseUrl, '/api/prompts/work/rename', {
      method: 'PUT',
      body: JSON.stringify({ name: 'renamed' }),
    }))
    assert.equal(renamedConfig.activePromptName, 'renamed')

    const renamed = record(await requestJson(baseUrl, '/api/prompts/renamed'))
    assert.equal(renamed.prompt, 'hello')

    const afterDelete = record(await requestJson(baseUrl, '/api/prompts/renamed', { method: 'DELETE' }))
    assert.deepEqual(afterDelete.prompts, ['default'])
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
