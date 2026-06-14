import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'http'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AutoScheduler } from './scheduler.js'
import { createHandler, OutputBuffer } from './server.js'

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
  const server = createServer(createHandler(new AutoScheduler(), new OutputBuffer(), {
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

test('guide API returns the prompt writing guide', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-server-'))
  const guidePath = join(dir, 'GUIDE.md')
  const server = createServer(createHandler(new AutoScheduler(), new OutputBuffer(), {
    configPath: join(dir, 'ui-config.json'),
    promptPath: join(dir, 'prompt.md'),
    promptsDir: join(dir, 'prompts'),
    guidePath,
  }))
  try {
    await writeFile(guidePath, '# Guide\n\nCopy this into an AI chat.', 'utf-8')
    const baseUrl = await listen(server)

    const guide = record(await requestJson(baseUrl, '/api/guide'))

    assert.equal(guide.content, '# Guide\n\nCopy this into an AI chat.')
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

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

test('JSON endpoints reject oversized request bodies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-server-'))
  const server = createServer(createHandler(new AutoScheduler(), new OutputBuffer(), {
    configPath: join(dir, 'ui-config.json'),
    promptPath: join(dir, 'prompt.md'),
    promptsDir: join(dir, 'prompts'),
  }))
  try {
    await mkdir(join(dir, 'prompts'), { recursive: true })
    const baseUrl = await listen(server)
    const oversizedPrompt = 'x'.repeat(1024 * 1024 + 1)
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: oversizedPrompt }),
    })

    assert.equal(response.status, 413)
    const body = record(await response.json())
    assert.equal(body.error, 'Request body too large')

    const config = record(await requestJson(baseUrl, '/api/config'))
    assert.notEqual(config.prompt, oversizedPrompt)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('output buffer separates repeated slot runs by sequence', () => {
  const outputBuffer = new OutputBuffer()

  outputBuffer.append({ workerId: 1, sequence: 1, stream: 'stdout', text: 'old', ts: 1000 })
  outputBuffer.append({ workerId: 1, sequence: 2, stream: 'stdout', text: 'new', ts: 2000 })

  const all = outputBuffer.getAll()
  assert.equal(all['1:1'][0].text, 'old')
  assert.equal(all['1:2'][0].text, 'new')
})
