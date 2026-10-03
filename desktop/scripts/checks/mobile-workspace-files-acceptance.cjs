/** Local-only real file/Git adapter endpoint for iOS acceptance. Terminal frames
 * are a presentation fixture; every workspaceFiles reply runs production code.
 * Build with pnpm --filter @synapse/desktop run build:electron first.
 */
const { randomUUID } = require('node:crypto')
const { mkdir, writeFile, readFile, access, realpath } = require('node:fs/promises')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const WebSocket = require('ws')
const desktopRoot = path.resolve(__dirname, '../..')
const load = (name) => require(path.join(desktopRoot, 'dist-electron/electron', name))
const { createMobileWorkspaceFilesService } = load('services/mobile-workspace-files-service.js')
const { createPermissionGuard } = load('runtime/security/permission-guard.js')
const { createControlledProcessRunner } = load('runtime/process/controlled-runner.js')
const { configureGitCommandSecurity } = load('services/git-command.js')
const root = '/tmp/synapse-workspace-files-acceptance'
const credentialsFile = '/tmp/synapse-workspace-files-acceptance-credentials.json'
const baseUrl = 'http://127.0.0.1:3001'
const desktopId = 'workspace-files-acceptance-desktop'
const sessionId = 'f11e0000-0000-4000-8000-000000000001'
const groupId = 'f11e0000-0000-4000-8000-000000000002'
const sessionStartedAt = new Date().toISOString()
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })
  if (result.status !== 0) throw new Error(`Fixture Git failed (${result.status})`)
  return result.stdout
}
async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Local acceptance API ${route} failed (${response.status})`)
  return response.json()
}
async function ensureFixtureFile(relativePath, content) {
  const target = path.join(root, relativePath)
  try { await writeFile(target, content, { mode: 0o600, flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (await readFile(target, 'utf8') !== content) throw new Error('Acceptance fixture contains unexpected content')
  }
}
async function prepare() {
  try { await access(path.join(root, '.git')) } catch {
    await mkdir(path.join(root, 'nested'), { recursive: true })
    git(['init', '-b', 'main'])
    git(['config', 'user.name', 'Files acceptance'])
    git(['config', 'user.email', 'files-acceptance@example.invalid'])
    await writeFile(path.join(root, 'review.txt'), 'BASE\n')
    await writeFile(path.join(root, 'nested/notes.txt'), 'UTF-8 中文 😀\n')
    await writeFile(path.join(root, 'README.md'), '# Acceptance\n\nLocal read-only workspace.\n')
    git(['add', '.']); git(['commit', '-m', 'fixture baseline'])
    await writeFile(path.join(root, 'review.txt'), 'STAGED\n'); git(['add', 'review.txt'])
    await writeFile(path.join(root, 'review.txt'), 'WORKTREE\n')
  }
  await ensureFixtureFile('0-这是用于验证最大动态字号和关闭菜单可达性的很长中文文件名称.txt', '长标题预览\n')
  await mkdir(path.join(root, 'nested/paging'), { recursive: true, mode: 0o700 })
  await Promise.all(Array.from({ length: 205 }, (_, index) => {
    const number = String(index).padStart(4, '0')
    return ensureFixtureFile(`nested/paging/page-${number}.txt`, `分页验收 ${number}\nUTF-8 中文 😀\n`)
  }))
  const excludeFile = path.join(root, '.git/info/exclude')
  let excluded = ''
  try { excluded = await readFile(excludeFile, 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!excluded.split('\n').includes('/nested/paging/')) {
    await writeFile(excludeFile, `${excluded}${excluded && !excluded.endsWith('\n') ? '\n' : ''}/nested/paging/\n`, { mode: 0o600 })
  }
  let credentials
  try { credentials = JSON.parse(await readFile(credentialsFile, 'utf8')) } catch {
    const suffix = randomUUID().slice(0, 8)
    credentials = { email: `files-${suffix}@example.invalid`, password: `Files-${randomUUID()}-Passw0rd`, baseURL: `${baseUrl}/api` }
    await post('/api/auth/register', { email: credentials.email, password: credentials.password, handle: `files${suffix}` })
    await writeFile(credentialsFile, JSON.stringify(credentials), { mode: 0o600 })
  }
  return { credentials, login: await post('/api/auth/login', { email: credentials.email, password: credentials.password }) }
}
async function main() {
  const { login } = await prepare()
  const configurationHome = '/tmp/synapse-workspace-files-acceptance-config'
  await mkdir(configurationHome, { recursive: true, mode: 0o700 })
  await writeFile(path.join(configurationHome, '.gitconfig'), '[core]\n\tautocrlf = false\n', { mode: 0o600 })
  const canonicalConfigurationHome = await realpath(configurationHome)
  const accountUserId = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString('utf8')).sub
  const auditEvents = []
  const auditSink = { record: (event) => auditEvents.push({ action: event.action, outcome: event.outcome }), isHealthy: () => true }
  const permissionGuard = createPermissionGuard()
  configureGitCommandSecurity({ processRunner: createControlledProcessRunner({ permissionGuard, auditSink }) })
  const service = createMobileWorkspaceFilesService({ permissionGuard, auditSink,
    gitConfigurationLocations: { homeDirectory: canonicalConfigurationHome },
    resolveSessionContext: async (id) => id === sessionId ? { cwd: root, shell: '/bin/zsh' } : null })
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/api/live/desktop`, { headers: { authorization: `Bearer ${login.accessToken}` } })
  const envelope = (type, payload) => ({ type, id: randomUUID(), sentAt: new Date().toISOString(), payload })
  const send = (type, payload) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope(type, payload))) }
  const summary = () => send('mobile.summary', { desktopClientInstanceId: desktopId, desktopName: 'Files Acceptance Mac', workspaceFilesVersion: 1, revision: 1, groups: [{ id: groupId, name: 'Acceptance' }], sessions: [{ id: sessionId, groupId, title: 'Files acceptance', status: 'running', attention: { state: 'not_waiting', kind: 'unknown' }, cwd: root, cols: 88, rows: 24, startedAt: sessionStartedAt, lastLine: 'Files acceptance', lastOutputSeq: 1 }] })
  let attached = null
  let gitRevision = 0
  const status = (mobileId) => send('mobile.gitStatus', { desktopClientInstanceId: desktopId, mobileClientInstanceId: mobileId, sessionId, revision: ++gitRevision, status: { cwd: root, branch: git(['branch', '--show-current']).trim(), upstream: null, ahead: 0, behind: 0, changeCount: 1, hasConflicts: false } })
  socket.on('open', () => send('live.hello', { clientInstanceId: desktopId, appVersion: 'files-acceptance', platform: 'darwin-arm64', deviceName: 'Files Acceptance Mac' }))
  socket.on('message', async (raw) => {
    try {
      const message = JSON.parse(String(raw))
      if (message.type === 'live.welcome') { summary(); process.stdout.write('Real workspace adapter endpoint ready on local relay.\n'); return }
      if (message.type === 'mobile.detached') { service.cleanupOwner({ mobileClientInstanceId: message.payload.mobileClientInstanceId }); return }
      if (message.type !== 'mobile.intent') return
      const { mobileClientInstanceId: mobileId, intent } = message.payload
      if (intent.kind === 'workspaceFiles') {
        const result = await service.runIntent({ accountUserId, desktopClientInstanceId: desktopId, mobileClientInstanceId: mobileId }, intent)
        send('mobile.intentResult', { desktopClientInstanceId: desktopId, mobileClientInstanceId: mobileId, result })
        process.stdout.write(`files ${intent.operation}: ${result.outcome}${result.code ? ` ${result.code}` : ''}\n`)
        return
      }
      let result = { intentId: intent.intentId, sessionId: intent.sessionId, outcome: 'accepted' }
      switch (intent.kind) {
        case 'sync': summary(); break
        case 'attach':
          attached = mobileId
          send('mobile.frame', { desktopClientInstanceId: desktopId, mobileClientInstanceId: mobileId, frame: { v: 1, sessionId, kind: 'reset', seq: 1, from: 0, lines: [['Files acceptance']], total: 1, cursor: { row: 0, col: 0, visible: true }, alt: false, truncated: false, sizeRevision: 1 } })
          status(mobileId); break
        case 'git': if (intent.action === 'status') status(mobileId); else result = { ...result, outcome: 'rejected', code: 'acceptance_read_only', message: '验收端点只读' }; break
        case 'detach': service.cleanupOwner({ mobileClientInstanceId: mobileId }); attached = null; break
        case 'resize': case 'releaseGrid': case 'ping': break
        default: result = { ...result, outcome: 'rejected', code: 'acceptance_unimplemented', message: '验收端点不支持此操作' }
      }
      send('mobile.intentResult', { mobileClientInstanceId: mobileId, result })
    } catch (error) { process.stderr.write(`Acceptance endpoint error: ${error.name}\n`) }
  })
  socket.on('error', (error) => process.stderr.write(`Local relay error: ${error.name}\n`))
  socket.on('close', (code) => process.stderr.write(`Local relay closed: ${code}\n`))
  const heartbeat = setInterval(() => send('live.ping', { sentAt: new Date().toISOString() }), 20000)
  function stop() { clearInterval(heartbeat); service.dispose(); socket.close(); process.stdout.write(`Acceptance stopped; ${auditEvents.length} audit decisions.\n`) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
