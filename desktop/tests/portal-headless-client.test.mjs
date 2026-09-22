import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { execute } from '../app-capabilities/synapse-skill/skill-package/extend/portal-headless/scripts/client.mjs'

const script = fileURLToPath(new URL('../app-capabilities/synapse-skill/skill-package/extend/portal-headless/scripts/client.mjs', import.meta.url))
const envelope = (data) => ({ protocolVersion: 1, catalogRevision: 'fixture', data })
const credentials = (base) => ({ apiBaseUrl: base, authorization: { accessToken: 'sy-canary' }, portal: { token: 'portal-canary', tenantId: 'tenant' } })
const request = { endpoint: 'catalog', body: { op: 'pages', domain: 'year-agreement', limit: 1 }, paginate: true }
async function fixture(fn) {
  const calls = []
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = JSON.parse(text); calls.push({ body, headers: req.headers })
    const answer = fn(body, calls.length, req)
    res.writeHead(answer.status ?? 200, answer.headers ?? { 'Content-Type': 'application/json' })
    if (!answer.hang) res.end(answer.raw ?? JSON.stringify(answer.body))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const input = { credentials: credentials(`http://127.0.0.1:${server.address().port}/api/extend/portal-headless`), request }
  return { input, calls, close: async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)) } }
}
async function withServer(fn, run) { const f = await fixture(fn); try { await run(f) } finally { await f.close() } }
const rejectCode = (code) => (e) => { assert.equal(e.code, code); assert.doesNotMatch(JSON.stringify(e), /sy-canary|portal-canary/); return true }

test('completes typed null pagination, preserves domain and authenticates each request', async () => {
  await withServer((b) => ({ body: envelope({ items: [{ id: b.offset }], total: 2, nextOffset: b.offset === 0 ? 1 : null, complete: b.offset === 1 }) }), async ({ input, calls }) => {
    const result = await execute(input)
    assert.deepEqual(result.data.items, [{ id: 0 }, { id: 1 }]); assert.equal(calls.length, 2)
    assert.ok(calls.every((c) => c.body.domain === 'year-agreement' && c.headers['x-portal-token'] === 'portal-canary'))
  })
})
test('missing domain fails before network', async () => {
  let count = 0
  await assert.rejects(execute({ credentials: credentials('https://example.invalid/api/extend/portal-headless'), request: { ...request, body: { op: 'pages' } } }, { fetchImpl: () => { count++ } }), (e) => { assert.equal(e.extra.fields[0].path, 'domain'); return true })
  assert.equal(count, 0)
})
test('400 stops immediately and preserves safe field errors without upstream secrets', async () => {
  await withServer(() => ({ status: 400, body: { code: 'INVALID_REQUEST', message: 'portal-canary', fields: [{ path: 'domain', code: 'required', message: 'sy-canary' }, { path: 'portal-canary', code: 'invalid' }] } }), async ({ input, calls }) => {
    await assert.rejects(execute(input), (e) => { assert.deepEqual(e.extra.fields, [{ path: 'domain', code: 'required', message: 'Missing required parameter' }]); return rejectCode('INVALID_REQUEST')(e) })
    assert.equal(calls.length, 1)
  })
})
test('401 asks for one MCP refresh; a failed refresh terminates', async () => {
  await withServer(() => ({ status: 401, body: { code: 'SY_EXTENSION_AUTH_REQUIRED' } }), async ({ input, calls }) => {
    await assert.rejects(execute(input), (e) => { assert.equal(e.extra.action, 'refresh_credentials_once'); assert.equal(e.extra.authRetry, 1); return true })
    await assert.rejects(execute({ ...input, authRetry: 1 }), rejectCode('AUTH_REFRESH_FAILED'))
    assert.equal(calls.length, 2)
  })
})
test('fresh credentials can complete the one allowed retry', async () => {
  await withServer((_b, n) => n === 1 ? { status: 401, body: { code: 'SY_EXTENSION_AUTH_REQUIRED' } } : { body: envelope({ items: [], total: 0, nextOffset: null, complete: true }) }, async ({ input, calls }) => {
    await assert.rejects(execute(input), rejectCode('SY_EXTENSION_AUTH_REQUIRED'))
    const fresh = { ...input, authRetry: 1, credentials: { ...input.credentials, authorization: { accessToken: 'fresh-canary' } } }
    assert.equal((await execute(fresh)).data.complete, true)
    assert.equal(calls[1].headers.authorization, 'Bearer fresh-canary')
  })
})
test('Portal 401 does not ask to refresh SY', async () => {
  await withServer(() => ({ status: 401, body: { code: 'PORTAL_CREDENTIAL_INVALID' } }), async ({ input, calls }) => {
    await assert.rejects(execute(input), (e) => { assert.equal(e.extra.action, undefined); return rejectCode('PORTAL_CREDENTIAL_INVALID')(e) }); assert.equal(calls.length, 1)
  })
})
for (const [name, data] of [
  ['repeated cursor', { items: [{ id: 1 }], total: 2, nextOffset: 0, complete: false }],
  ['string null', { items: [{ id: 1 }], total: 1, nextOffset: 'null', complete: false }],
  ['wrong completeness', { items: [{ id: 1 }], total: 2, nextOffset: null, complete: true }],
  ['empty nonterminal', { items: [], total: 2, nextOffset: 1, complete: false }],
]) test(`rejects ${name} without a second request`, async () => {
  await withServer(() => ({ body: envelope(data) }), async ({ input, calls }) => { await assert.rejects(execute(input), rejectCode('PAGINATION_INVALID')); assert.equal(calls.length, 1) })
})
test('maximum pages aborts without claiming partial results are complete', async () => {
  await withServer((b) => ({ body: envelope({ items: [{ id: b.offset }], total: 4, nextOffset: b.offset + 1, complete: false }) }), async ({ input, calls }) => {
    await assert.rejects(execute({ ...input, maxPages: 2 }), rejectCode('PAGE_LIMIT')); assert.equal(calls.length, 2)
  })
})
test('yearly business pagination stops at total without a redundant empty read', async () => {
  await withServer((b) => ({ body: envelope({ capabilityId: 'perf-year-agreement-list', result: { list: [{ id: b.arguments.pageNo }], total: 2 } }) }), async ({ input, calls }) => {
    input.request = { endpoint: 'read', body: { capabilityId: 'perf-year-agreement-list', arguments: { pageSize: 1 } }, paginate: true }
    assert.equal((await execute(input)).data.result.list.length, 2); assert.equal(calls.length, 2)
  })
})
test('bounded timeout stops a hanging response body', async () => {
  await withServer(() => ({ hang: true }), async ({ input, calls }) => { await assert.rejects(execute(input, { requestTimeoutMs: 40 }), rejectCode('REQUEST_TIMEOUT')); assert.equal(calls.length, 1) })
})
test('does not follow credential-bearing redirects', async () => {
  await withServer(() => ({ status: 302, headers: { Location: 'http://127.0.0.1:1/stolen' }, raw: '' }), async ({ input, calls }) => { await assert.rejects(execute(input), rejectCode('REQUEST_FAILED')); assert.equal(calls.length, 1) })
})
test('CLI reads stdin from an unrelated cwd and reports success without exposing credentials', async () => {
  await withServer(() => ({ body: envelope({ items: [], total: 0, nextOffset: null, complete: true }) }), async ({ input }) => {
    const child = spawn(process.execPath, [script], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''; child.stdout.on('data', (b) => out += b); child.stderr.on('data', (b) => err += b)
    child.stdin.end(JSON.stringify(input))
    const code = await new Promise((r) => child.on('exit', r))
    assert.equal(code, 0); assert.equal(JSON.parse(out).data.complete, true); assert.equal(err, ''); assert.doesNotMatch(out, /sy-canary|portal-canary/)
  })
})

for (const [name, answer] of [
  ['non-JSON HTTP failure', { status: 502, raw: '<html>portal-canary</html>' }],
  ['malformed success envelope', { body: { data: { items: [] } } }],
]) test(`stops on ${name} without parsing business data`, async () => {
  await withServer(() => answer, async ({ input, calls }) => {
    await assert.rejects(execute(input), rejectCode('INVALID_RESPONSE')); assert.equal(calls.length, 1)
  })
})
test('repeated data with an advancing cursor is rejected', async () => {
  await withServer((b) => ({ body: envelope({ items: [{ id: 'duplicate' }], total: 3, nextOffset: b.offset + 1, complete: false }) }), async ({ input, calls }) => {
    await assert.rejects(execute(input), rejectCode('PAGINATION_INVALID')); assert.equal(calls.length, 2)
  })
})
test('CLI exposes exit 10 for the first SY failure and exit 1 after refresh', async () => {
  await withServer(() => ({ status: 401, body: { code: 'SY_EXTENSION_AUTH_REQUIRED' } }), async ({ input }) => {
    for (const authRetry of [0, 1]) {
      const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = '', err = ''; child.stdout.on('data', (b) => out += b); child.stderr.on('data', (b) => err += b)
      child.stdin.end(JSON.stringify({ ...input, authRetry }))
      const code = await new Promise((r) => child.on('close', r))
      assert.equal(code, authRetry ? 1 : 10); assert.equal(err, '')
      const result = JSON.parse(out)
      assert.equal(result.error.action, authRetry ? undefined : 'refresh_credentials_once')
      assert.doesNotMatch(out, /sy-canary|portal-canary/)
    }
  })
})
