// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChannelsPage from './index'
import { channelApi } from './channel-api'
import { ChannelKeyResourcesDialog } from './channel-key-resources'
import type { DashboardApiKey } from '@/lib/api'

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
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root!.render(<QueryClientProvider client={client!}>{node}</QueryClientProvider>)
  })
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

function findButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
  if (!btn) throw new Error(`Button not found: ${label}`)
  return btn
}

describe('Dashboard Channels Console UI', () => {
  it('lists channels, opens detail debugger via debug-ticket WS, receives presence/events, and sends test publish', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(channelApi, 'list').mockResolvedValue({
      data: [{
        id: 'ch_screen_1',
        name: '客厅大屏',
        description: '手机遥控器联动',
        onlineCount: 2,
        tokenCount: 3,
        createdAt: '2026-11-25T08:00:00.000Z',
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    vi.spyOn(channelApi, 'get').mockResolvedValue({
      id: 'ch_screen_1',
      name: '客厅大屏',
      description: '手机遥控器联动',
      onlineCount: 2,
      tokenCount: 3,
      createdAt: '2026-11-25T08:00:00.000Z',
      updatedAt: '2026-11-25T08:00:00.000Z',
    })
    vi.spyOn(channelApi, 'listTokens').mockResolvedValue({
      data: [{
        id: 'cht_1',
        channelId: 'ch_screen_1',
        name: '大屏只读',
        role: 'subscribe',
        prefix: 'syc_abcdefgh',
        lastUsedAt: null,
        createdAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    vi.spyOn(channelApi, 'getState').mockResolvedValue({
      channelId: 'ch_screen_1',
      latestSeq: 5,
      presence: [],
      retained: [{
        event: 'scene.current',
        payload: { scene: 'hero' },
        seq: 5,
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    vi.spyOn(channelApi, 'issueDebugTicket').mockResolvedValue({
      ticket: 'sydbg_test_ticket_1234567890',
      expiresAt: '2026-11-25T08:01:00.000Z',
    })

    await renderNode(<ChannelsPage />)
    await flush()

    expect(document.body.textContent).toContain('客厅大屏')
    await act(async () => findButton('客厅大屏').click())
    await flush()

    // Connect live debugger via debug ticket
    await act(async () => findButton('连接调试').click())
    await flush()

    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]!
    expect(ws.url).toContain('/api/open/v1/channels/ch_screen_1/ws')
    expect(ws.sent[0]).toMatchObject({ type: 'auth', token: 'sydbg_test_ticket_1234567890' })

    // Simulate server ready + live event
    await act(async () => {
      ws.emitServer({
        type: 'ready',
        channelId: 'ch_screen_1',
        connectionId: 'conn_dbg',
        clientId: 'console-debugger',
        role: 'pubsub',
        latestSeq: 5,
        replayTruncated: false,
        presence: [{
          connectionId: 'conn_1',
          clientId: 'screen-1',
          clientName: '大屏主屏',
          role: 'subscribe',
          meta: {},
          connectedAt: '2026-11-25T08:00:00.000Z',
        }],
        retained: [],
      })
      ws.emitServer({
        type: 'event',
        seq: 6,
        event: 'slide.next',
        payload: { step: 1 },
        retain: false,
        replayed: false,
        targeted: false,
        sender: { connectionId: 'conn_r', clientId: 'phone-1', clientName: '遥控器' },
        sentAt: '2026-11-25T08:00:05.000Z',
      })
    })
    expect(document.body.textContent).toContain('大屏主屏')
    expect(document.body.textContent).toContain('slide.next')

    // Send a test signal over live WS
    await act(async () => findButton('发送事件').click())
    expect(ws.sent.some((m) => m.type === 'publish')).toBe(true)
  })

  it('saves API key channel resources via ChannelKeyResourcesDialog', async () => {
    vi.spyOn(channelApi, 'list').mockResolvedValue({
      data: [{
        id: 'ch_1',
        name: '后台控制',
        description: '',
        onlineCount: 0,
        tokenCount: 1,
        createdAt: '2026-11-25T08:00:00.000Z',
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    const saveResources = vi.spyOn(channelApi, 'updateKeyResources').mockResolvedValue({})
    const onClose = vi.fn()
    const apiKey: DashboardApiKey = {
      id: 'key_1',
      name: '家庭后端',
      prefix: 'syn_sk_1234',
      scopes: ['channels.publish', 'channels.subscribe'],
      channelResources: { mode: 'selected', channelIds: [] },
      lastUsedAt: null,
      createdAt: '2026-11-25T08:00:00.000Z',
    }

    await renderNode(<ChannelKeyResourcesDialog apiKey={apiKey} onClose={onClose} />)
    await flush()

    expect(document.body.textContent).toContain('后台控制')
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => checkbox.click())
    await act(async () => findButton('保存更改').click())
    await flush()

    expect(saveResources).toHaveBeenCalledWith('key_1', { mode: 'selected', channelIds: ['ch_1'] })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('creates and reveals channel tokens once, revokes tokens, and clears retained snapshots silently', async () => {
    vi.spyOn(channelApi, 'list').mockResolvedValue({
      data: [{
        id: 'ch_2',
        name: '测试频道',
        description: '',
        onlineCount: 0,
        tokenCount: 1,
        createdAt: '2026-11-25T08:00:00.000Z',
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    vi.spyOn(channelApi, 'get').mockResolvedValue({
      id: 'ch_2',
      name: '测试频道',
      description: '',
      onlineCount: 0,
      tokenCount: 1,
      createdAt: '2026-11-25T08:00:00.000Z',
      updatedAt: '2026-11-25T08:00:00.000Z',
    })
    vi.spyOn(channelApi, 'listTokens').mockResolvedValue({
      data: [{
        id: 'cht_existing',
        channelId: 'ch_2',
        name: '旧大屏',
        role: 'subscribe',
        prefix: 'syc_oldtoken',
        lastUsedAt: null,
        createdAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    const createToken = vi.spyOn(channelApi, 'createToken').mockResolvedValue({
      token: {
        id: 'cht_new',
        channelId: 'ch_2',
        name: '新大屏',
        role: 'subscribe',
        prefix: 'syc_newtoken',
        lastUsedAt: null,
        createdAt: '2026-11-25T08:01:00.000Z',
      },
      secret: 'syc_secret_plaintext_shown_once_1234567890',
    })
    const revokeToken = vi.spyOn(channelApi, 'revokeToken').mockResolvedValue({ revoked: true })
    vi.spyOn(channelApi, 'getState').mockResolvedValue({
      channelId: 'ch_2',
      latestSeq: 9,
      presence: [],
      retained: [{
        event: 'scene.current',
        payload: { scene: 'night' },
        seq: 9,
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    const clearRetained = vi.spyOn(channelApi, 'clearRetained').mockResolvedValue({ deleted: true })

    await renderNode(<ChannelsPage />)
    await flush()
    await act(async () => findButton('测试频道').click())
    await flush()

    // Switch to 接入凭证 tab
    const tokensTab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent?.includes('接入凭证')) as HTMLElement
    await act(async () => tokensTab.click())
    await flush()
    expect(document.body.textContent).toContain('旧大屏')

    // Create token & see one-time secret modal
    await act(async () => findButton('签发凭证').click())
    await flush()
    const nameInput = document.querySelector('[role="dialog"] input') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, '新大屏')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const form = document.querySelector('[role="dialog"] form') as HTMLFormElement
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    expect(createToken).toHaveBeenCalledWith('ch_2', { name: '新大屏', role: 'subscribe' })
    expect(document.body.textContent).toContain('syc_secret_plaintext_shown_once_1234567890')
    await act(async () => findButton('我已保存').click())
    await flush()

    // Revoke existing token
    await act(async () => findButton('撤销').click())
    await flush()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('立即断开')
    const confirmRevoke = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === '撤销') as HTMLButtonElement
    await act(async () => confirmRevoke.click())
    await flush()
    expect(revokeToken).toHaveBeenCalledWith('ch_2', 'cht_existing')

    // Switch to Retain 状态 tab & clear retained snapshot
    const retainedTab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent?.includes('Retain 状态')) as HTMLElement
    await act(async () => retainedTab.click())
    await flush()
    expect(document.body.textContent).toContain('scene.current')
    await act(async () => findButton('清除').click())
    await flush()
    const confirmClear = Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === '清除') as HTMLButtonElement
    await act(async () => confirmClear.click())
    await flush()
    expect(clearRetained).toHaveBeenCalledWith('ch_2', 'scene.current')
  })

  it('prunes stale deleted channel IDs when saving ChannelKeyResourcesDialog', async () => {
    vi.spyOn(channelApi, 'list').mockResolvedValue({
      data: [{
        id: 'ch_alive',
        name: '存活频道',
        description: '',
        onlineCount: 0,
        tokenCount: 0,
        createdAt: '2026-11-25T08:00:00.000Z',
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    const updateKeyResources = vi.spyOn(channelApi, 'updateKeyResources').mockResolvedValue({
      channelResources: { mode: 'selected', channelIds: ['ch_alive'] },
    })
    const apiKey: DashboardApiKey = {
      id: 'key_stale',
      name: '带失效频道的密钥',
      prefix: 'syn_stale',
      scopes: ['channels.publish'],
      channelResources: { mode: 'selected', channelIds: ['ch_deleted_1', 'ch_alive'] },
      expiresAt: null,
      lastUsedAt: null,
      createdAt: '2026-11-25T08:00:00.000Z',
    }

    await renderNode(<ChannelKeyResourcesDialog apiKey={apiKey} onClose={() => undefined} />)
    await flush()
    expect(document.body.textContent).toContain('已自动排除 1 个已删除的失效频道 ID')
    await act(async () => {
      const form = document.querySelector('[role="dialog"] form') as HTMLFormElement
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    expect(updateKeyResources).toHaveBeenCalledWith('key_stale', {
      mode: 'selected',
      channelIds: ['ch_alive'],
    })
  })

  it('aborts opening WebSocket if disconnected while debug-ticket request is still in flight', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(channelApi, 'list').mockResolvedValue({
      data: [{
        id: 'ch_race',
        name: '竞态测试频道',
        description: '',
        onlineCount: 0,
        tokenCount: 0,
        createdAt: '2026-11-25T08:00:00.000Z',
        updatedAt: '2026-11-25T08:00:00.000Z',
      }],
    })
    vi.spyOn(channelApi, 'get').mockResolvedValue({
      id: 'ch_race',
      name: '竞态测试频道',
      description: '',
      onlineCount: 0,
      tokenCount: 0,
      createdAt: '2026-11-25T08:00:00.000Z',
      updatedAt: '2026-11-25T08:00:00.000Z',
    })
    vi.spyOn(channelApi, 'listTokens').mockResolvedValue({ data: [] })
    vi.spyOn(channelApi, 'getState').mockResolvedValue({
      channelId: 'ch_race',
      latestSeq: 0,
      presence: [],
      retained: [],
    })
    let resolveTicket!: (value: { ticket: string; expiresAt: string }) => void
    vi.spyOn(channelApi, 'issueDebugTicket').mockImplementation(
      () => new Promise((resolve) => { resolveTicket = resolve }),
    )

    await renderNode(<ChannelsPage />)
    await flush()
    await act(async () => findButton('竞态测试频道').click())
    await flush()
    await act(async () => findButton('连接调试').click())
    await flush()
    expect(document.body.textContent).toContain('连接中')
    await act(async () => findButton('断开连接').click())
    await flush()
    await act(async () => resolveTicket({ ticket: 'sydbg_late', expiresAt: '2026-11-25T08:01:00.000Z' }))
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(document.body.textContent).toContain('未连接')
  })
})
