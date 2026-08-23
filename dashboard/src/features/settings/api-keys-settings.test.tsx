// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardApi } from '@/lib/api'
import { ApiKeysSettings } from './api-keys-settings'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  dashboardApi: {
    listApiKeys: vi.fn(),
    listApiKeyCapabilities: vi.fn(),
    listApiKeyUsageLogs: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const mockedDashboardApi = vi.mocked(dashboardApi)
const clipboardWrite = vi.fn()
let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  })
  clipboardWrite.mockResolvedValue(undefined)
  mockedDashboardApi.listApiKeyCapabilities.mockResolvedValue([{
    scope: 'drive.share_link.download',
    name: '获取分享链接文件',
  }])
  mockedDashboardApi.listApiKeyUsageLogs.mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    pageSize: 10,
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ApiKeysSettings', () => {
  it('creates a named key and reveals the secret once', async () => {
    mockedDashboardApi.listApiKeys.mockResolvedValue([])
    mockedDashboardApi.createApiKey.mockResolvedValue({
      apiKey: apiKey({ id: 'key-2', name: 'CLI', prefix: 'syn_sk_abcdefgh' }),
      secret: 'syn_sk_once-only-secret',
    })

    renderSettings()
    await waitForText('尚无秘钥')
    await click(buttonByText('创建秘钥'))
    await inputValue(inputById('api-key-name'), ' CLI ')
    await click(checkbox())
    await click(buttonByText('创建', 'last'))

    await waitForText('秘钥已创建')
    expect(mockedDashboardApi.createApiKey).toHaveBeenCalledWith({
      name: 'CLI',
      scopes: ['drive.share_link.download'],
    })
    expect(document.body.textContent).toContain('关闭后无法再次查看')
    expect(inputByValue('syn_sk_once-only-secret')).not.toBeNull()

    await click(buttonByText('复制秘钥'))
    expect(clipboardWrite).toHaveBeenCalledWith('syn_sk_once-only-secret')

    await click(buttonByText('完成'))
    expect(document.body.textContent).not.toContain('syn_sk_once-only-secret')
    expect(document.body.textContent).toContain('CLI')
  })

  it('revokes a key only after confirmation', async () => {
    mockedDashboardApi.listApiKeys.mockResolvedValue([apiKey()])
    mockedDashboardApi.revokeApiKey.mockResolvedValue({ ok: true })

    renderSettings()
    await waitForText('开发环境')
    await click(buttonByText('撤销'))
    await waitForText('撤销“开发环境”后将无法恢复。')
    await click(buttonByText('撤销', 'last'))

    await waitFor(() => {
      expect(mockedDashboardApi.revokeApiKey).toHaveBeenCalledWith('key-1')
      expect(document.body.textContent).not.toContain('开发环境')
    })
  })

  it('loads the selected key usage summary without file information', async () => {
    mockedDashboardApi.listApiKeys.mockResolvedValue([apiKey()])
    mockedDashboardApi.listApiKeyUsageLogs.mockResolvedValue({
      data: [{
        id: 'usage-1',
        requestId: 'req-1',
        operation: 'download',
        status: 'succeeded',
        httpStatus: 200,
        errorCode: null,
        sourceType: 'share',
        artifactType: 'file',
        durationMs: 50,
        responseBytes: '1024',
        startedAt: '2026-08-23T09:00:00.000Z',
        completedAt: '2026-08-23T09:00:00.050Z',
      }],
      total: 1,
      page: 1,
      pageSize: 10,
    })

    renderSettings()
    await waitForText('开发环境')
    await click(buttonByText('使用记录'))
    await waitForText('req-1')

    expect(mockedDashboardApi.listApiKeyUsageLogs).toHaveBeenCalledWith('key-1', {
      page: 1,
      pageSize: 10,
    })
    expect(document.body.textContent).toContain('下载')
    expect(document.body.textContent).toContain('成功')
  })
})

function renderSettings() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ApiKeysSettings />
      </QueryClientProvider>
    )
  })
}

function apiKey(overrides: Partial<Awaited<ReturnType<typeof dashboardApi.listApiKeys>>[number]> = {}) {
  return {
    id: 'key-1',
    name: '开发环境',
    prefix: 'syn_sk_12345678',
    scopes: ['drive.share_link.download'],
    lastUsedAt: null,
    createdAt: '2026-08-21T08:00:00.000Z',
    ...overrides,
  }
}

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function waitForText(text: string) {
  await waitFor(() => {
    expect(document.body.textContent).toContain(text)
  })
}

async function waitFor(assertion: () => void) {
  let lastError: unknown
  for (let index = 0; index < 20; index += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

function inputById(id: string): HTMLInputElement {
  const input = document.getElementById(id)
  if (!(input instanceof HTMLInputElement)) throw new Error(`${id} input not found`)
  return input
}

function inputByValue(value: string): HTMLInputElement {
  const input = Array.from(document.querySelectorAll('input'))
    .find((item) => item.value === value)
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${value}`)
  return input
}

function checkbox(): HTMLButtonElement {
  const element = document.querySelector('[role="checkbox"]')
  if (!(element instanceof HTMLButtonElement)) throw new Error('Checkbox not found')
  return element
}

function buttonByText(text: string, position: 'first' | 'last' = 'first'): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button'))
    .filter((item) => item.textContent?.includes(text))
  const button = position === 'last' ? buttons.at(-1) : buttons[0]
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
  return button
}
