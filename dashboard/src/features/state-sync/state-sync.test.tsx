// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi, type DashboardApiKey } from '@/lib/api'
import { ApiKeysSettings } from '@/features/settings/api-keys-settings'
import StateSyncPage from './index'
import { stateSyncApi, type StateSyncSpaceSummary } from './state-sync-api'
import { StateSyncKeyResourcesDialog } from './state-sync-key-resources'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close(code = 1000, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  emitServer(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

const sampleSpace: StateSyncSpaceSummary = {
  id: 'ss_space_1',
  name: '协同白板空间',
  description: '多人协作画布状态',
  defaultDocTtlSeconds: 86400,
  maxDocs: 100,
  docCount: 2,
  onlineCount: 3,
  tokenCount: 1,
  createdAt: '2026-11-26T01:00:00.000Z',
  updatedAt: '2026-11-26T01:00:00.000Z',
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let client: QueryClient | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  host = null
  client?.clear()
  client = null
  FakeWebSocket.instances.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderNode(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  await act(async () => {
    root!.render(<QueryClientProvider client={client!}>{node}</QueryClientProvider>)
  })
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

function findButton(label: string, position: 'first' | 'last' = 'first'): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.includes(label))
  const btn = position === 'last' ? buttons.at(-1) : buttons[0]
  if (!btn) throw new Error(`Button not found: ${label}`)
  return btn
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('Dashboard State Sync Console UI', () => {
  it('lists spaces, creates a new space, and deletes a space with confirmation', async () => {
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    const createdSpace: StateSyncSpaceSummary = {
      ...sampleSpace,
      id: 'ss_space_new',
      name: '桌游计分空间',
      description: '实时回合状态',
      docCount: 0,
      onlineCount: 0,
      tokenCount: 0,
    }
    const createSpace = vi.spyOn(stateSyncApi, 'createSpace').mockResolvedValue(createdSpace)
    vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(createdSpace)
    vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({ data: [], nextCursor: null })
    const deleteSpace = vi.spyOn(stateSyncApi, 'deleteSpace').mockResolvedValue({ deleted: true })

    await renderNode(<StateSyncPage />)
    await flush()

    expect(document.body.textContent).toContain('协同白板空间')
    expect(document.body.textContent).toContain('ss_space_1')
    expect(document.body.textContent).toContain('1 天')

    // Create space
    await act(async () => findButton('创建空间').click())
    await flush()
    const inputs = Array.from(document.querySelectorAll('[role="dialog"] input')) as HTMLInputElement[]
    await setInputValue(inputs[0]!, '桌游计分空间')
    const textarea = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement
    await setInputValue(textarea, '实时回合状态')
    await act(async () => {
      const form = document.querySelector('[role="dialog"] form') as HTMLFormElement
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(createSpace).toHaveBeenCalledWith({
      name: '桌游计分空间',
      description: '实时回合状态',
      defaultDocTtlSeconds: 86400,
      maxDocs: 100,
    })

    // Go back to list and delete space
    const backBtn = document.querySelector('button[aria-label="返回空间列表"]') as HTMLButtonElement
    await act(async () => backBtn.click())
    await flush()

    await act(async () => findButton('删除').click())
    await flush()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('立即断开')
    const confirmDelete = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (b) => b.textContent === '删除',
    ) as HTMLButtonElement
    await act(async () => confirmDelete.click())
    await flush()

    expect(deleteSpace).toHaveBeenCalledWith('ss_space_1')
  })

  it('lists rooms, creates a test room, connects debugger via debug-ticket WS, applies live mutations, and submits HTTP PATCH', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(sampleSpace)
    vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({
      data: [{
        spaceId: 'ss_space_1',
        docId: 'room-alpha',
        rev: 2,
        onlineCount: 1,
        ttlSeconds: 3600,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: '2026-11-26T01:00:00.000Z',
        updatedAt: '2026-11-26T01:05:00.000Z',
      }],
      nextCursor: null,
    })
    const createDoc = vi.spyOn(stateSyncApi, 'createDoc').mockResolvedValue({
      spaceId: 'ss_space_1',
      docId: 'room-beta',
      rev: 0,
      expiresAt: null,
      wsPath: '/api/open/v1/state-sync/spaces/ss_space_1/docs/room-beta/ws',
    })
    const deleteDoc = vi.spyOn(stateSyncApi, 'deleteDoc').mockResolvedValue({ deleted: true })
    vi.spyOn(stateSyncApi, 'issueDebugTicket').mockResolvedValue({
      ticket: 'syssdbg_ticket_abc123',
      expiresAt: '2026-11-26T01:10:00.000Z',
    })
    const mutateDoc = vi.spyOn(stateSyncApi, 'mutateDoc').mockResolvedValue({
      rev: 4,
      changed: true,
      expiresAt: null,
    })

    await renderNode(<StateSyncPage />)
    await flush()

    await act(async () => findButton('协同白板空间').click())
    await flush()

    expect(document.body.textContent).toContain('room-alpha')

    // Select room-alpha -> automatically connects via debug-ticket WS as hidden observer
    await act(async () => findButton('room-alpha').click())
    await flush()

    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]!
    expect(ws.url).toContain('/api/open/v1/state-sync/spaces/ss_space_1/docs/room-alpha/ws')
    expect(ws.sent[0]).toMatchObject({ type: 'auth', token: 'syssdbg_ticket_abc123', paths: ['/'] })

    // Emit ready snapshot + live mutation + presence join
    await act(async () => {
      ws.emitServer({
        type: 'ready',
        spaceId: 'ss_space_1',
        docId: 'room-alpha',
        connectionId: 'conn_obs',
        clientId: 'console-debugger',
        role: 'read',
        rev: 2,
        expiresAt: null,
        replayTruncated: false,
        presence: [{
          connectionId: 'conn_p1',
          clientId: 'player-1',
          clientName: '玩家甲',
          role: 'write',
          meta: { seat: 1 },
          connectedAt: '2026-11-26T01:00:00.000Z',
        }],
        snapshots: [{
          path: '/',
          exists: true,
          value: { score: 10, board: { turn: 'black' } },
        }],
      })
      ws.emitServer({
        type: 'mutation',
        rev: 3,
        op: 'set',
        path: '/score',
        value: 25,
        replayed: false,
        actor: { connectionId: 'conn_p1', clientId: 'player-1', clientName: '玩家甲' },
        ts: '2026-11-26T01:06:00.000Z',
      })
    })
    await flush()

    expect(document.body.textContent).toContain('玩家甲')
    expect(document.body.textContent).toContain('25')
    expect(document.body.textContent).toContain('/score')
    expect(document.body.textContent).toContain('rev 3')

    // Submit HTTP PATCH mutation with path, value & expectedRev
    const pathInput = document.querySelector('input[aria-label="目标路径"]') as HTMLInputElement
    const revInput = document.querySelector('input[aria-label="期望版本（expectedRev，可选）"]') as HTMLInputElement
    const valTextarea = document.querySelector('textarea[aria-label="JSON 值"]') as HTMLTextAreaElement
    await setInputValue(pathInput, '/game/round')
    await setInputValue(revInput, '3')
    await setInputValue(valTextarea, '5')
    await act(async () => findButton('提交变更').click())
    await flush()

    expect(mutateDoc).toHaveBeenCalledWith('ss_space_1', 'room-alpha', {
      op: 'set',
      path: '/game/round',
      value: 5,
      expectedRev: 3,
    })

    // Create test room modal
    await act(async () => findButton('新建房间').click())
    await flush()
    const docIdInput = document.querySelector('[role="dialog"] input[aria-label="自定义房间 ID（可选）"]') as HTMLInputElement
    const initTextarea = document.querySelector('[role="dialog"] textarea[aria-label="初始 JSON 数据"]') as HTMLTextAreaElement
    await setInputValue(docIdInput, 'room-beta')
    await setInputValue(initTextarea, '{"phase":"lobby"}')
    await act(async () => {
      const form = document.querySelector('[role="dialog"] form') as HTMLFormElement
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(createDoc).toHaveBeenCalledWith('ss_space_1', {
      docId: 'room-beta',
      initialData: { phase: 'lobby' },
    })

    // Delete room-alpha with confirmation
    const deleteRoomBtn = document.querySelector('button[aria-label="删除房间 room-alpha"]') as HTMLButtonElement
    await act(async () => deleteRoomBtn.click())
    await flush()
    const confirmDelete = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (b) => b.textContent === '删除',
    ) as HTMLButtonElement
    await act(async () => confirmDelete.click())
    await flush()

    expect(deleteDoc).toHaveBeenCalledWith('ss_space_1', 'room-alpha')
  })

  it('creates and reveals space tokens once and revokes tokens with confirmation', async () => {
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(sampleSpace)
    vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({ data: [], nextCursor: null })
    vi.spyOn(stateSyncApi, 'listTokens').mockResolvedValue({
      data: [{
        id: 'sst_existing',
        spaceId: 'ss_space_1',
        name: '只读大屏',
        role: 'read',
        prefix: 'sys_oldtoken',
        lastUsedAt: null,
        createdAt: '2026-11-26T01:00:00.000Z',
      }],
    })
    const createToken = vi.spyOn(stateSyncApi, 'createToken').mockResolvedValue({
      token: {
        id: 'sst_new',
        spaceId: 'ss_space_1',
        name: '房主客户端',
        role: 'read',
        prefix: 'sys_newtoken',
        lastUsedAt: null,
        createdAt: '2026-11-26T01:05:00.000Z',
      },
      secret: 'sys_secret_plaintext_shown_once_9876543210',
    })
    const revokeToken = vi.spyOn(stateSyncApi, 'revokeToken').mockResolvedValue({ revoked: true })

    await renderNode(<StateSyncPage />)
    await flush()
    await act(async () => findButton('协同白板空间').click())
    await flush()

    const tokensTab = Array.from(document.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.includes('接入凭证'),
    ) as HTMLElement
    await act(async () => tokensTab.click())
    await flush()
    expect(document.body.textContent).toContain('只读大屏')

    await act(async () => findButton('签发凭证').click())
    await flush()
    const nameInput = document.querySelector('[role="dialog"] input') as HTMLInputElement
    await setInputValue(nameInput, '房主客户端')
    await act(async () => {
      const form = document.querySelector('[role="dialog"] form') as HTMLFormElement
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(createToken).toHaveBeenCalledWith('ss_space_1', { name: '房主客户端', role: 'read' })
    expect(document.body.textContent).toContain('sys_secret_plaintext_shown_once_9876543210')
    await act(async () => findButton('我已保存').click())
    await flush()

    await act(async () => findButton('撤销').click())
    await flush()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('立即断开')
    const confirmRevoke = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(
      (b) => b.textContent === '撤销',
    ) as HTMLButtonElement
    await act(async () => confirmRevoke.click())
    await flush()
    expect(revokeToken).toHaveBeenCalledWith('ss_space_1', 'sst_existing')
  })

  it('renders live SDK version from /sdk/manifest.json and exact SDK snippets in Examples tab', async () => {
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(sampleSpace)
    vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({ data: [], nextCursor: null })
    vi.spyOn(stateSyncApi, 'getSdkManifest').mockResolvedValue({
      schemaVersion: 1,
      sdks: {
        'state-sync': {
          name: 'state-sync',
          title: 'Synapse State Sync SDK',
          manifestUrl: '/sdk/state-sync/manifest.json',
          latest: '1.2.3',
          major: 'v1',
          globalName: 'SynapseStateSync',
          docsUrl: '/document/open-api/api/state-sync',
          files: {
            browserGlobal: {
              url: '/sdk/state-sync/1.2.3/state-sync.global.min.js',
              latestUrl: '/sdk/state-sync/v1/state-sync.global.min.js',
            },
            esm: {
              url: '/sdk/state-sync/1.2.3/state-sync.esm.min.js',
              latestUrl: '/sdk/state-sync/v1/state-sync.esm.min.js',
            },
            cjs: {
              url: '/sdk/state-sync/1.2.3/state-sync.cjs',
              latestUrl: '/sdk/state-sync/v1/state-sync.cjs',
            },
            types: {
              url: '/sdk/state-sync/1.2.3/index.d.ts',
              latestUrl: '/sdk/state-sync/v1/index.d.ts',
            },
          },
          versions: ['1.2.3'],
        },
      },
    })

    await renderNode(<StateSyncPage />)
    await flush()
    await act(async () => findButton('协同白板空间').click())
    await flush()

    const examplesTab = Array.from(document.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.includes('接入与 SDK 示例'),
    ) as HTMLElement
    await act(async () => examplesTab.click())
    await flush()

    const text = document.body.textContent ?? ''
    expect(text).toContain('1.2.3')
    expect(text).toContain('ss_space_1')
    expect(text).toContain('SynapseStateSync.createClient')
    expect(text).toContain('import { createClient }')
    expect(text).toContain('createRoom')
    expect(text).toContain('.join(')
    expect(text).toContain('onDisconnect([')
    expect(text).toContain('room.close()')
    expect(text).toContain('-X PATCH')
  })

  it('updates space settings including never-expire TTL and maxDocs', async () => {
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(sampleSpace)
    vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({ data: [], nextCursor: null })
    const updateSpace = vi.spyOn(stateSyncApi, 'updateSpace').mockResolvedValue({
      ...sampleSpace,
      name: '新空间名',
      defaultDocTtlSeconds: null,
      maxDocs: 200,
    })

    await renderNode(<StateSyncPage />)
    await flush()
    await act(async () => findButton('协同白板空间').click())
    await flush()

    const settingsTab = Array.from(document.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.includes('设置'),
    ) as HTMLElement
    await act(async () => settingsTab.click())
    await flush()

    const nameInput = document.querySelector('input[aria-label="空间名称"]') as HTMLInputElement
    const maxDocsInput = document.querySelector('input[aria-label="最大房间数"]') as HTMLInputElement
    const neverExpireCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    await setInputValue(nameInput, '新空间名')
    await setInputValue(maxDocsInput, '200')
    await act(async () => neverExpireCheckbox.click())
    await act(async () => findButton('保存更改').click())
    await flush()

    expect(updateSpace).toHaveBeenCalledWith('ss_space_1', {
      name: '新空间名',
      description: '多人协作画布状态',
      defaultDocTtlSeconds: null,
      maxDocs: 200,
    })
  })

  it('saves API key state sync resources via StateSyncKeyResourcesDialog and prunes stale IDs', async () => {
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    const saveResources = vi.spyOn(stateSyncApi, 'updateKeyResources').mockResolvedValue({
      stateSyncResources: { mode: 'selected', spaceIds: ['ss_space_1'] },
    })
    const onClose = vi.fn()
    const apiKey: DashboardApiKey = {
      id: 'key_ss_1',
      name: '后端状态同步密钥',
      prefix: 'syn_sk_ss1',
      scopes: ['state_sync.manage', 'state_sync.write'],
      stateSyncResources: { mode: 'selected', spaceIds: ['ss_deleted_stale', 'ss_space_1'] },
      lastUsedAt: null,
      createdAt: '2026-11-26T01:00:00.000Z',
    }

    await renderNode(<StateSyncKeyResourcesDialog apiKey={apiKey} onClose={onClose} />)
    await flush()

    expect(document.body.textContent).toContain('协同白板空间')
    expect(document.body.textContent).toContain('已自动排除 1 个已删除的失效空间 ID')
    await act(async () => findButton('保存更改').click())
    await flush()

    expect(saveResources).toHaveBeenCalledWith('key_ss_1', { mode: 'selected', spaceIds: ['ss_space_1'] })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('embeds StateSyncKeyResourcesField in ApiKeysSettings create dialog when state_sync.* scope is selected', async () => {
    vi.spyOn(dashboardApi, 'listApiKeys').mockResolvedValue([])
    vi.spyOn(dashboardApi, 'listApiKeyCapabilities').mockResolvedValue([
      {
        scope: 'state_sync.manage',
        name: '状态同步管理',
        description: '管理同步空间、房间与空间凭证。',
        documentationUrl: '/document/open-api/api/state-sync',
      },
      {
        scope: 'state_sync.write',
        name: '状态同步写入',
        description: '写入状态同步房间。',
        documentationUrl: '/document/open-api/api/state-sync',
      },
    ])
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    const createApiKey = vi.spyOn(dashboardApi, 'createApiKey').mockResolvedValue({
      apiKey: {
        id: 'key_created_1',
        name: '同步脚本',
        prefix: 'syn_sk_new',
        scopes: ['state_sync.manage'],
        stateSyncResources: { mode: 'all_owned', spaceIds: [] },
        lastUsedAt: null,
        createdAt: '2026-11-26T01:00:00.000Z',
      },
      secret: 'syn_sk_full_secret_once',
    })

    await renderNode(<ApiKeysSettings />)
    await flush()

    await act(async () => findButton('创建密钥').click())
    await flush()

    const nameInput = document.getElementById('api-key-name') as HTMLInputElement
    await setInputValue(nameInput, '同步脚本')
    const scopeLabel = Array.from(document.querySelectorAll('label')).find(
      (el) => el.textContent?.includes('状态同步管理'),
    ) as HTMLLabelElement
    await act(async () => scopeLabel.click())
    await flush()

    expect(document.body.textContent).toContain('同步空间资源范围')
    expect(document.body.textContent).toContain('协同白板空间')

    // Switch to all_owned radio
    const allOwnedRadio = document.querySelector('input[type="radio"][value="all_owned"]') as HTMLInputElement
    await act(async () => allOwnedRadio.click())
    await flush()

    await act(async () => findButton('创建', 'last').click())
    await flush()

    expect(createApiKey).toHaveBeenCalledWith({
      name: '同步脚本',
      scopes: ['state_sync.manage'],
      stateSyncResources: { mode: 'all_owned', spaceIds: [] },
    })
  })

  it('aborts opening WebSocket if disconnected while debug-ticket request is still in flight', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })
    vi.spyOn(stateSyncApi, 'getSpace').mockResolvedValue(sampleSpace)
    vi.spyOn(stateSyncApi, 'listDocs').mockResolvedValue({
      data: [{
        spaceId: 'ss_space_1',
        docId: 'room-race',
        rev: 0,
        onlineCount: 0,
        ttlSeconds: 3600,
        expiresAt: null,
        createdAt: '2026-11-26T01:00:00.000Z',
        updatedAt: '2026-11-26T01:00:00.000Z',
      }],
      nextCursor: null,
    })
    let resolveTicket!: (value: { ticket: string; expiresAt: string }) => void
    vi.spyOn(stateSyncApi, 'issueDebugTicket').mockImplementation(
      () => new Promise((resolve) => { resolveTicket = resolve }),
    )

    await renderNode(<StateSyncPage />)
    await flush()
    await act(async () => findButton('协同白板空间').click())
    await flush()
    await act(async () => findButton('room-race').click())
    await flush()

    expect(document.body.textContent).toContain('连接中')
    await act(async () => findButton('断开连接').click())
    await flush()

    await act(async () => resolveTicket({ ticket: 'syssdbg_late', expiresAt: '2026-11-26T02:00:00.000Z' }))
    await flush()

    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(document.body.textContent).toContain('未连接')
  })

  it('shows 同步空间资源 button on existing API key card with state_sync.* scope and falls back when SDK manifest is unavailable', async () => {
    vi.spyOn(dashboardApi, 'listApiKeys').mockResolvedValue([{
      id: 'key_existing_ss',
      name: '状态同步后端',
      prefix: 'syn_sk_exist',
      scopes: ['state_sync.read', 'state_sync.write'],
      stateSyncResources: { mode: 'selected', spaceIds: ['ss_space_1'] },
      lastUsedAt: null,
      createdAt: '2026-11-26T01:00:00.000Z',
    }])
    vi.spyOn(dashboardApi, 'listApiKeyCapabilities').mockResolvedValue([])
    vi.spyOn(stateSyncApi, 'listSpaces').mockResolvedValue({ data: [sampleSpace] })

    await renderNode(<ApiKeysSettings />)
    await flush()

    expect(document.body.textContent).toContain('同步空间资源')
    await act(async () => findButton('同步空间资源').click())
    await flush()
    expect(document.body.textContent).toContain('密钥的同步空间资源')
    expect(document.body.textContent).toContain('协同白板空间')
  })
})
