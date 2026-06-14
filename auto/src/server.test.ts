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
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers({ 'content-type': 'application/json' })
  if (method !== 'GET' && method !== 'HEAD') {
    const tokenResponse = await fetch(`${baseUrl}/api/csrf-token`)
    assert.equal(tokenResponse.status, 200)
    const tokenBody = record(await tokenResponse.json())
    assert.equal(typeof tokenBody.token, 'string')
    headers.set('x-auto-csrf-token', tokenBody.token as string)
  }
  for (const [key, value] of new Headers(options.headers).entries()) {
    headers.set(key, value)
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
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
    const token = record(await requestJson(baseUrl, '/api/csrf-token')).token
    assert.equal(typeof token, 'string')
    const oversizedPrompt = 'x'.repeat(1024 * 1024 + 1)
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-auto-csrf-token': token as string },
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

test('mutable API rejects missing CSRF token, cross-origin requests, and non-JSON bodies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-server-'))
  let startCount = 0
  const scheduler = {
    start: async () => {
      startCount += 1
    },
    getSnapshot: () => ({ running: false }),
  } as unknown as AutoScheduler
  const server = createServer(createHandler(scheduler, new OutputBuffer(), {
    configPath: join(dir, 'ui-config.json'),
    promptPath: join(dir, 'prompt.md'),
    promptsDir: join(dir, 'prompts'),
  }))
  try {
    await mkdir(join(dir, 'prompts'), { recursive: true })
    const baseUrl = await listen(server)
    const config = record(await requestJson(baseUrl, '/api/config'))
    const token = record(await requestJson(baseUrl, '/api/csrf-token')).token
    assert.equal(typeof token, 'string')

    const missingToken = await fetch(`${baseUrl}/api/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    })
    assert.equal(missingToken.status, 403)

    const crossOrigin = await fetch(`${baseUrl}/api/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.test',
        'x-auto-csrf-token': token as string,
      },
      body: JSON.stringify(config),
    })
    assert.equal(crossOrigin.status, 403)

    const textPlain = await fetch(`${baseUrl}/api/start`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-auto-csrf-token': token as string,
      },
      body: JSON.stringify(config),
    })
    assert.equal(textPlain.status, 415)

    await requestJson(baseUrl, '/api/start', {
      method: 'POST',
      body: JSON.stringify(config),
    })

    assert.equal(startCount, 1)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('static assets reject same-prefix directory traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-server-'))
  const webDir = join(dir, 'dist', 'web')
  const siblingDir = join(dir, 'dist', 'web-secret')
  const server = createServer(createHandler(new AutoScheduler(), new OutputBuffer(), {
    configPath: join(dir, 'ui-config.json'),
    promptPath: join(dir, 'prompt.md'),
    promptsDir: join(dir, 'prompts'),
    webDir,
  }))
  try {
    await mkdir(join(webDir, 'assets'), { recursive: true })
    await mkdir(siblingDir, { recursive: true })
    await writeFile(join(webDir, 'assets', 'app.js'), 'console.log("ok")', 'utf-8')
    await writeFile(join(siblingDir, 'secret.txt'), 'secret-value', 'utf-8')
    const baseUrl = await listen(server)

    const assetResponse = await fetch(`${baseUrl}/assets/app.js`)
    assert.equal(assetResponse.status, 200)
    assert.equal(await assetResponse.text(), 'console.log("ok")')

    const traversalResponse = await fetch(`${baseUrl}/assets/%2e%2e%2f%2e%2e%2fweb-secret%2fsecret.txt`)
    assert.equal(traversalResponse.status, 400)
    assert.doesNotMatch(await traversalResponse.text(), /secret-value/)
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
