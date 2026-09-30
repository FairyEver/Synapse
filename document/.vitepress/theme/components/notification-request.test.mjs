import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNotificationRequest } from './notification-request.mjs'

const base = {
  baseUrl: 'https://synapse.d2.pub/',
  shape: 'json',
  key: `syn_sk_${'a'.repeat(43)}`,
  title: '部署完成',
  body: '生产环境已更新',
  group: '',
  url: '',
  level: 'active',
  idempotencyKey: ''
}

test('JSON POST includes the key and optional fields in a quoted body', () => {
  const result = buildNotificationRequest({
    ...base,
    title: "O'Brien 部署",
    group: '生产',
    url: 'https://example.com/releases?a=1&b=2',
    level: 'timeSensitive',
    idempotencyKey: 'deploy_20260930'
  })

  assert.deepEqual(result.errors, [])
  assert.match(result.curl, /--request POST 'https:\/\/synapse\.d2\.pub\/api\/open\/v1\/notifications'/u)
  assert.match(result.curl, /O'\\''Brien/u)
  assert.match(result.curl, /Idempotency-Key: deploy_20260930/u)
  assert.match(result.fetch, /body: JSON\.stringify\(\{"key":"syn_sk_/u)
  assert.match(result.fetch, /"level":"timeSensitive"/u)
  assert.equal(result.url, '')
  new Function(`return (async () => { ${result.fetch} })`)
})

test('form POST URL encodes fields through curl and URLSearchParams', () => {
  const result = buildNotificationRequest({
    ...base,
    shape: 'form',
    body: 'A&B=1',
    group: '部署 通知',
    level: 'passive'
  })

  assert.deepEqual(result.errors, [])
  assert.match(result.curl, /--request POST 'https:\/\/synapse\.d2\.pub\/api\/open\/v1\/notifications\/syn_sk_/u)
  assert.match(result.curl, /--data-urlencode 'body=A&B=1'/u)
  assert.match(result.curl, /--data-urlencode 'group=部署 通知'/u)
  assert.match(result.fetch, /new URLSearchParams\(\{"title":"部署完成","body":"A&B=1","group":"部署 通知","level":"passive"\}\)/u)
  assert.doesNotMatch(result.fetch, /"key":/u)
  new Function(`return (async () => { ${result.fetch} })`)
})

test('path GET encodes segments and query, while URL output cannot carry the retry header', () => {
  const result = buildNotificationRequest({
    ...base,
    shape: 'path',
    title: '部署/完成?',
    body: '第一行\n第二行 & 已更新',
    group: '部署 通知',
    url: 'https://example.com/a?b=1&c=2',
    level: 'passive',
    idempotencyKey: 'deploy_20260930'
  })

  assert.deepEqual(result.errors, [])
  const url = new URL(result.url)
  assert.deepEqual(url.pathname.split('/').slice(-3).map(decodeURIComponent), [base.key, '部署/完成?', '第一行\n第二行 & 已更新'])
  assert.equal(url.searchParams.get('group'), '部署 通知')
  assert.equal(url.searchParams.get('url'), 'https://example.com/a?b=1&c=2')
  assert.equal(url.searchParams.get('level'), 'passive')
  assert.match(result.curl, /Idempotency-Key: deploy_20260930/u)
  assert.match(result.fetch, /'Idempotency-Key': "deploy_20260930"/u)
  assert.doesNotMatch(result.url, /deploy_20260930/u)
  new Function(`return (async () => { ${result.fetch} })`)
})

test('rejects invalid required and optional values before generating output', () => {
  const result = buildNotificationRequest({
    ...base,
    key: 'invalid',
    title: ' ',
    body: 'x'.repeat(513),
    group: 'x'.repeat(65),
    url: 'http://example.com',
    idempotencyKey: 'short'
  })

  assert.equal(result.errors.length, 6)
  assert.equal(result.curl, '')
  assert.equal(result.fetch, '')
  assert.equal(result.url, '')
})

test('rejects malformed HTTPS links and unknown request settings', () => {
  const result = buildNotificationRequest({
    ...base,
    shape: 'unknown',
    level: 'urgent',
    url: 'https:example.com'
  })

  assert.equal(result.errors.length, 3)
  assert.equal(result.curl, '')
})

test('rejects dot-only path segments that URL clients normalize away', () => {
  const result = buildNotificationRequest({ ...base, shape: 'path', title: '..' })
  assert.equal(result.errors.length, 1)
  assert.equal(result.url, '')
})
