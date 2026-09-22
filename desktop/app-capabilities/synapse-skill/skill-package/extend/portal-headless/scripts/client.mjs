import { pathToFileURL } from 'node:url'

const messages = {
  INVALID_INPUT: 'Invalid client input. Check the documented request schema.',
  INVALID_RESPONSE: 'The backend returned an invalid response. Stop; do not infer empty results.',
  REQUEST_FAILED: 'The HTTP request failed. No automatic retry was made.',
  REQUEST_TIMEOUT: 'The bounded HTTP operation timed out.',
  PAGINATION_INVALID: 'Pagination did not advance consistently. No complete result is available.',
  PAGE_LIMIT: 'The maximum page count was reached. No complete result is available.',
  SY_EXTENSION_AUTH_REQUIRED: 'Obtain fresh credentials through MCP and retry once.',
  AUTH_REFRESH_FAILED: 'Fresh SY authorization was rejected. Stop and report the failure.',
  PORTAL_CREDENTIAL_INVALID: 'Reconnect Portal; refreshing the SY grant will not repair Portal credentials.',
  HTTP_ERROR: 'The backend rejected the request. Read the code and field errors; do not repeat unchanged input.',
}
export class ClientError extends Error {
  constructor(code, extra = {}) { super(messages[code] ?? messages.HTTP_ERROR); this.code = code; this.extra = extra }
}
const fail = (code) => { throw new ClientError(code) }
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const integer = (v) => Number.isSafeInteger(v) && v >= 0
const secret = (v) => typeof v === 'string' && v.length > 0 && v.length <= 16384 && !/[\r\n]/.test(v)
const fieldNames = new Set(['$', 'op', 'domain', 'offset', 'limit', 'pageId', 'query', 'kind', 'capabilityId', 'id', 'arguments', 'date', 'pageNo', 'pageSize', 'dictType', 'token', 'tenantId', 'language'])
function safeFields(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).filter((v) => object(v) && typeof v.path === 'string' && v.path.split('.').every((p) => fieldNames.has(p)))
    .map((v) => ({ path: v.path, code: v.code === 'required' ? 'required' : 'invalid', message: v.code === 'required' ? 'Missing required parameter' : 'Invalid parameter' }))
}
function validate(input) {
  if (!object(input) || !object(input.credentials) || !object(input.request)) fail('INVALID_INPUT')
  const { credentials: c, request: r } = input
  if (!['context', 'catalog', 'describe', 'read'].includes(r.endpoint) || !object(r.body)) fail('INVALID_INPUT')
  if (input.authRetry !== undefined && input.authRetry !== 0 && input.authRetry !== 1) fail('INVALID_INPUT')
  if (r.paginate !== undefined && typeof r.paginate !== 'boolean') fail('INVALID_INPUT')
  if (input.maxPages !== undefined && (!integer(input.maxPages) || input.maxPages < 1 || input.maxPages > 100)) fail('INVALID_INPUT')
  if (!object(c.authorization) || !object(c.portal) || !secret(c.authorization.accessToken) || !secret(c.portal.token) || !secret(c.portal.tenantId)) fail('INVALID_INPUT')
  if (c.portal.language !== undefined && !['zh-CN', 'en-US'].includes(c.portal.language)) fail('INVALID_INPUT')
  let url
  try { url = new URL(c.apiBaseUrl) } catch { fail('INVALID_INPUT') }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/extend/portal-headless') fail('INVALID_INPUT')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('INVALID_INPUT')
  const directory = r.endpoint === 'catalog' && ['domains', 'pages', 'search'].includes(r.body.op)
  const yearly = r.endpoint === 'read' && r.body.capabilityId === 'perf-year-agreement-list'
  if (r.paginate && !directory && !yearly) fail('INVALID_INPUT')
  if (r.endpoint === 'catalog' && r.body.op === 'pages' && (typeof r.body.domain !== 'string' || !r.body.domain.trim())) {
    throw new ClientError('INVALID_INPUT', { fields: [{ path: 'domain', code: 'required', message: 'Missing required parameter' }] })
  }
  return { c, r, url, directory, yearly }
}

async function responseJson(response) {
  if (!response.body) fail('INVALID_RESPONSE')
  const reader = response.body.getReader()
  const chunks = []; let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2 * 1024 * 1024) fail('INVALID_RESPONSE')
      chunks.push(value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('INVALID_RESPONSE') }
  } finally { await reader.cancel().catch(() => undefined) }
}

/** No MCP, disk credential storage, redirects, shell commands, or hidden HTTP retries. */
export async function execute(input, { fetchImpl = fetch, requestTimeoutMs = 35_000, totalTimeoutMs = 120_000 } = {}) {
  const { c, r, url, directory, yearly } = validate(input)
  const maxPages = input.maxPages ?? 20
  const whole = new AbortController()
  const body = structuredClone(r.body)
  let first, expectedTotal, revision
  const items = []; const seen = new Set()
  if (r.paginate) {
    if (directory) { body.offset ??= 0; body.limit ??= 50; if (body.offset !== 0 || !integer(body.limit) || body.limit < 1 || body.limit > 50) fail('INVALID_INPUT') }
    if (yearly) { body.arguments ??= {}; if (!object(body.arguments)) fail('INVALID_INPUT'); body.arguments.pageNo ??= 1; body.arguments.pageSize ??= 50; if (body.arguments.pageNo !== 1 || !integer(body.arguments.pageSize) || body.arguments.pageSize < 1 || body.arguments.pageSize > 50) fail('INVALID_INPUT') }
  }
  const timer = setTimeout(() => whole.abort(), totalTimeoutMs)
  try {
    for (let n = 0; n < (r.paginate ? maxPages : 1); n++) {
      let response, envelope
      const single = new AbortController()
      const deadline = setTimeout(() => single.abort(), requestTimeoutMs)
      try {
        response = await fetchImpl(`${url.href}/${r.endpoint}`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.any([whole.signal, single.signal]),
          headers: { Authorization: `Bearer ${c.authorization.accessToken}`, 'X-Portal-Token': c.portal.token,
            'X-Portal-Tenant-Id': c.portal.tenantId, 'Accept-Language': c.portal.language ?? 'zh-CN', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        envelope = await responseJson(response)
      } catch (e) {
        if (whole.signal.aborted || single.signal.aborted) fail('REQUEST_TIMEOUT')
        if (e instanceof ClientError) throw e
        fail('REQUEST_FAILED')
      } finally { clearTimeout(deadline) }
      if (!response.ok) {
        const code = typeof envelope?.code === 'string' && /^[A-Z][A-Z_]{0,63}$/.test(envelope.code) ? envelope.code : 'HTTP_ERROR'
        if (response.status === 401 && code === 'SY_EXTENSION_AUTH_REQUIRED') {
          throw new ClientError(input.authRetry === 1 ? 'AUTH_REFRESH_FAILED' : code,
            input.authRetry === 1 ? { status: 401 } : { status: 401, action: 'refresh_credentials_once', authRetry: 1 })
        }
        throw new ClientError(code, { status: response.status, fields: safeFields(envelope?.fields) })
      }
      if (!object(envelope) || envelope.protocolVersion !== 1 || typeof envelope.catalogRevision !== 'string' || !object(envelope.data)) fail('INVALID_RESPONSE')
      if (!r.paginate) return envelope
      if (revision !== undefined && revision !== envelope.catalogRevision) fail('PAGINATION_INVALID')
      revision = envelope.catalogRevision; first ??= envelope
      const data = directory ? envelope.data : envelope.data.result
      const batch = directory ? data?.items : data?.list
      if (!object(data) || !Array.isArray(batch) || !integer(data.total)) fail('INVALID_RESPONSE')
      expectedTotal ??= data.total
      if (data.total !== expectedTotal || batch.length > (directory ? body.limit : body.arguments.pageSize)) fail('PAGINATION_INVALID')
      for (const item of batch) {
        const key = JSON.stringify(item)
        if (seen.has(key)) fail('PAGINATION_INVALID')
        seen.add(key); items.push(item)
      }
      if (items.length > expectedTotal) fail('PAGINATION_INVALID')
      if (directory) {
        if (typeof data.complete !== 'boolean' || !Object.hasOwn(data, 'nextOffset')) fail('INVALID_RESPONSE')
        if (data.nextOffset === null) {
          if (!data.complete || items.length !== expectedTotal) fail('PAGINATION_INVALID')
          return { ...first, data: { ...first.data, items, total: expectedTotal, nextOffset: null, complete: true } }
        }
        if (data.complete || !batch.length || !integer(data.nextOffset) || data.nextOffset !== body.offset + batch.length || data.nextOffset <= body.offset || data.nextOffset >= expectedTotal) fail('PAGINATION_INVALID')
        body.offset = data.nextOffset
      } else {
        if (items.length === expectedTotal) return { ...first, data: { ...first.data, result: { ...first.data.result, list: items, total: expectedTotal } } }
        if (!batch.length || batch.length < body.arguments.pageSize) fail('PAGINATION_INVALID')
        body.arguments.pageNo++
      }
    }
    fail('PAGE_LIMIT')
  } finally { clearTimeout(timer); whole.abort() }
}

export async function main(stdin = process.stdin, stdout = process.stdout) {
  stdin.setEncoding('utf8')
  let text = ''
  const timer = setTimeout(() => stdin.destroy(new Error('input timeout')), 30_000)
  try {
    for await (const chunk of stdin) { text += chunk; if (Buffer.byteLength(text) > 256 * 1024) fail('INVALID_INPUT') }
    clearTimeout(timer)
    let input
    try { input = JSON.parse(text) } catch { fail('INVALID_INPUT') }
    const result = await execute(input)
    stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (e) {
    const error = e instanceof ClientError ? e : new ClientError('INVALID_INPUT')
    stdout.write(`${JSON.stringify({ error: { code: error.code, message: error.message, ...error.extra } })}\n`)
    return error.extra.action === 'refresh_credentials_once' ? 10 : 1
  } finally { clearTimeout(timer) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
