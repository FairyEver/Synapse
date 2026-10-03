/** Real relay + production desktop adapter smoke. Start the local acceptance
 * endpoint first; this client performs no writes to the fixture or any PTY.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
const credentials = JSON.parse(await readFile('/tmp/synapse-workspace-files-acceptance-credentials.json', 'utf8'))
const base = 'http://127.0.0.1:3001'
const desktopId = 'workspace-files-acceptance-desktop'
const sessionId = 'f11e0000-0000-4000-8000-000000000001'
const mobileId = `files-smoke-${randomUUID()}`
const loginResponse = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: credentials.email, password: credentials.password }) })
assert.ok(loginResponse.ok)
const { accessToken } = await loginResponse.json()
const ws = new WebSocket(`${base.replace('http', 'ws')}/api/live/mobile`, { headers: { authorization: `Bearer ${accessToken}` } })
const inbox = [], waiters = []
const envelope = (type, payload) => ({ type, id: randomUUID(), sentAt: new Date().toISOString(), payload })
function send(type, payload) { ws.send(JSON.stringify(envelope(type, payload))) }
function wait(match) {
  const index = inbox.findIndex(match)
  if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0])
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Real file reply timed out')) }, 17000) }
    waiters.push(waiter)
  })
}
ws.on('message', raw => {
  const msg = JSON.parse(String(raw)), index = waiters.findIndex(w => w.match(msg))
  if (index < 0) inbox.push(msg)
  else { const [w] = waiters.splice(index, 1); clearTimeout(w.timer); w.resolve(msg) }
})
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
send('live.hello', { clientInstanceId: mobileId, platform: 'ios', appVersion: 'files-smoke', deviceName: 'Files smoke' })
const welcome = await wait(m => m.type === 'live.welcome')
assert.equal(welcome.payload.mobileCapabilities.workspaceFilesVersion, 1)
send('mobile.intent', { desktopClientInstanceId: desktopId, mobileClientInstanceId: mobileId, intent: { v: 1, intentId: randomUUID(), kind: 'sync' } })
const summary = await wait(m => m.type === 'mobile.summary' && m.payload.desktopClientInstanceId === desktopId)
assert.equal(summary.payload.workspaceFilesVersion, 1)
let checks = 0
function check(label) { checks++; process.stdout.write(`ok ${label}\n`) }
function intent(operation, args = {}) { return { v: 1, kind: 'workspaceFiles', filesVersion: 1, intentId: randomUUID(), sessionId, operation, ...args } }
async function read(operation, args = {}) {
  return readRequest(intent(operation, args))
}
function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]))
  return value
}
async function readRequest(request) {
  send('mobile.intent', { desktopClientInstanceId: desktopId, mobileClientInstanceId: mobileId, intent: request })
  const message = await wait(m => m.type === 'mobile.intentResult' && m.payload.result.intentId === request.intentId)
  assert.equal(message.payload.desktopClientInstanceId, desktopId)
  assert.equal(message.payload.mobileClientInstanceId, mobileId)
  return message.payload.result
}
function accepted(result) { assert.equal(result.outcome, 'accepted', result.code); return result.workspaceFiles.data }
try {
  check('both authenticated relay and desktop advertise version 1')
  const scope = accepted(await read('open', { scopeMode: 'currentDirectory' }))
  const scopeArgs = { scopeId: scope.scopeId, expectedContextVersion: scope.contextVersion }
  check('real session opens a scoped current directory')
  const directory = accepted(await read('directory', { ...scopeArgs, directoryEntryId: scope.rootEntryId }))
  const nested = directory.entries.find(e => e.name === 'nested')
  assert.ok(nested)
  const children = accepted(await read('directory', { ...scopeArgs, directoryEntryId: nested.entryId }))
  const notes = children.entries.find(e => e.name === 'notes.txt'); assert.ok(notes)
  check('lazy directory reads return real nested files')
  const paging = children.entries.find(e => e.name === 'paging'); assert.ok(paging)
  const first = accepted(await read('directory', { ...scopeArgs, directoryEntryId: paging.entryId }))
  assert.equal(first.entries.length, 100); assert.ok(first.nextCursor)
  const second = accepted(await readRequest(reverseObjectKeys(intent('directory', { ...scopeArgs, directoryEntryId: paging.entryId, cursor: first.nextCursor }))))
  assert.equal(second.entries.length, 100); assert.ok(second.nextCursor)
  const third = accepted(await read('directory', { ...scopeArgs, directoryEntryId: paging.entryId, cursor: second.nextCursor }))
  assert.equal(third.entries.length, 5); assert.equal(third.nextCursor, null)
  assert.equal(second.directoryVersion, first.directoryVersion)
  assert.equal(third.directoryVersion, first.directoryVersion)
  assert.ok(third.entries.some(e => e.relativePath === 'nested/paging/page-0204.txt'))
  assert.equal(new Set([...first.entries, ...second.entries, ...third.entries].map(e => e.entryId)).size, 205)
  check('real directory pagination ignores object-key order and returns 205 unique entries across three pages')
  const pagedSearch = accepted(await read('search', { ...scopeArgs, query: 'page-0204' }))
  const pagedTarget = pagedSearch.entries.find(e => e.relativePath === 'nested/paging/page-0204.txt'); assert.ok(pagedTarget)
  const pagedPreview = accepted(await read('preview', { ...scopeArgs, target: { source: 'disk', entryId: pagedTarget.entryId } }))
  assert.ok(pagedPreview.lines.some(line => line.text.includes('分页验收 0204')))
  check('search and preview reach a file beyond the first two directory pages')
  const preview = accepted(await read('preview', { ...scopeArgs, target: { source: 'disk', entryId: notes.entryId } }))
  assert.ok(preview.lines.some(line => line.text.includes('UTF-8 中文 😀')))
  check('UTF-8 source arrives through the real two-hop relay')
  const search = accepted(await read('search', { ...scopeArgs, query: 'notes' }))
  assert.ok(search.entries.some(e => e.relativePath === 'nested/notes.txt'))
  check('submitted search finds real scoped descendants')
  for (const [changeRange, word] of [['unstaged', 'WORKTREE'], ['staged', 'STAGED']]) {
    const changes = accepted(await read('changes', { ...scopeArgs, changeRange }))
    const review = changes.entries.find(e => e.relativePath === 'review.txt'); assert.ok(review)
    const diff = accepted(await read('diff', { ...scopeArgs, changeSetVersion: changes.changeSetVersion, changeId: review.changeId }))
    assert.ok(diff.hunks.some(h => h.lines.some(line => line.text.includes(word))))
    const after = accepted(await read('preview', { ...scopeArgs, target: { source: 'change', changeSetVersion: changes.changeSetVersion, changeId: review.changeId, side: 'after' } }))
    assert.ok(after.lines.some(line => line.text.includes(word)))
    check(`${changeRange} diff and selected-side preview use real Git/disk data`)
  }
  const reference = accepted(await read('reference', { ...scopeArgs, entryId: notes.entryId }))
  assert.ok(reference.referenceText.includes('/tmp/synapse-workspace-files-acceptance/nested/notes.txt'))
  check('desktop formats an absolute shell reference')
  const invalid = await read('directory', { ...scopeArgs, directoryEntryId: 'foreign-handle' })
  assert.equal(invalid.outcome, 'rejected'); check('forged entry handle is refused')
  const request = intent('directory', { ...scopeArgs, directoryEntryId: scope.rootEntryId })
  const fallback = await fetch(`${base}/api/mobile/terminal/intent`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ clientInstanceId: mobileId, desktopClientInstanceId: desktopId, intent: request, waitForResult: true }) })
  assert.ok(fallback.ok)
  const reply = await fallback.json(); assert.equal(reply.desktopClientInstanceId, desktopId); accepted(reply.result)
  check('HTTP fallback preserves verified desktop result context')
  const repeatedRequest = intent('preview', { ...scopeArgs, target: { source: 'disk', entryId: notes.entryId } })
  const originalReply = await readRequest(repeatedRequest)
  accepted(originalReply)
  assert.deepEqual(await readRequest(reverseObjectKeys(repeatedRequest)), originalReply)
  check('same intent with reordered top-level and nested keys replays the accepted result')
  const conflictingReply = await readRequest({ ...repeatedRequest, target: { source: 'disk', entryId: pagedTarget.entryId } })
  assert.equal(conflictingReply.code, 'request_conflict')
  check('same intent with a different target remains rejected')
  accepted(await read('close', { scopeId: scope.scopeId }))
  assert.equal((await read('reference', { ...scopeArgs, entryId: notes.entryId })).code, 'invalid_scope')
  check('closed scope cannot replay source or prepare a reference')
  process.stdout.write(`${checks} real workspace checks passed.\n`)
} finally { ws.close(); for (const w of waiters) clearTimeout(w.timer) }
