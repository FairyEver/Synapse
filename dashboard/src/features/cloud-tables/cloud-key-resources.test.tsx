// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { DashboardApiKey } from '@/lib/api'
import { CloudKeyResourcesDialog } from './cloud-key-resources'
import { cloudTableApi } from './cloud-table-api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('lets users remove unavailable selected table IDs without discarding other pages', async () => {
  vi.spyOn(cloudTableApi, 'list').mockResolvedValue({ data: [], nextCursor: 'next-page' })
  const save = vi.spyOn(cloudTableApi, 'resources').mockResolvedValue({} as never)
  const apiKey = { id: 'key', tableResources: { mode: 'selected', tableIds: ['deleted-table', 'other-page-table'] } } as DashboardApiKey
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><CloudKeyResourcesDialog apiKey={apiKey} onClose={() => undefined} /></QueryClientProvider>))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const remove = document.querySelector('[aria-label="移除表 deleted-table"]') as HTMLButtonElement
    expect(remove).not.toBeNull()
    await act(async () => remove.click())
    const submit = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存更改')!
    await act(async () => submit.click())
    expect(save).toHaveBeenCalledWith('key', { mode: 'selected', tableIds: ['other-page-table'] })
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})

it('filters the current page and bulk-selects visible tables without dropping cross-page selections', async () => {
  vi.spyOn(cloudTableApi, 'list').mockImplementation(async (_trash, cursor) => cursor
    ? { data: [{ id: 'page-two', name: '网页交付回归' }], nextCursor: null }
    : { data: [{ id: 'team_tasks', name: '团队待办清单' }, { id: 'prr_prs', name: 'prr_prs' }], nextCursor: 'next-page' })
  const save = vi.spyOn(cloudTableApi, 'resources').mockResolvedValue({} as never)
  const apiKey = { id: 'key', tableResources: { mode: 'selected', tableIds: ['page-two'] } } as DashboardApiKey
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><CloudKeyResourcesDialog apiKey={apiKey} onClose={() => undefined} /></QueryClientProvider>))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const search = document.querySelector('input[aria-label="搜索表名称或标识"]') as HTMLInputElement
    expect(search).not.toBeNull()
    await act(async () => {
      const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setNativeValue.call(search, 'prr')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      search.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const selectVisible = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '选择当前显示')!
    await act(async () => selectVisible.click())
    expect(save).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-labelledby="selected-resources-heading"]')).not.toBeNull()
    const submit = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存更改')!
    await act(async () => submit.click())
    expect(save).toHaveBeenCalledWith('key', { mode: 'selected', tableIds: ['page-two', 'prr_prs'] })
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})

it('saves all-owned scope with an empty table id list', async () => {
  vi.spyOn(cloudTableApi, 'list').mockResolvedValue({ data: [{ id: 'table-1', name: '团队待办清单' }], nextCursor: null })
  const save = vi.spyOn(cloudTableApi, 'resources').mockResolvedValue({} as never)
  const apiKey = { id: 'key', tableResources: { mode: 'selected', tableIds: ['table-1'] } } as DashboardApiKey
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><CloudKeyResourcesDialog apiKey={apiKey} onClose={() => undefined} /></QueryClientProvider>))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const allOwned = Array.from(document.querySelectorAll('label')).find(label => label.textContent?.includes('自己的全部表')) as HTMLElement
    await act(async () => allOwned.click())
    const selectedOnly = Array.from(document.querySelectorAll('label')).find(label => label.textContent?.includes('仅限选中的表')) as HTMLElement
    await act(async () => selectedOnly.click())
    expect(document.querySelector('[aria-label="移除表 table-1"]')).not.toBeNull()
    await act(async () => allOwned.click())
    const submit = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存更改')!
    await act(async () => submit.click())
    expect(save).toHaveBeenCalledWith('key', { mode: 'all_owned', tableIds: [] })
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})

it('keeps the selected resources list independently scrollable', async () => {
  vi.spyOn(cloudTableApi, 'list').mockResolvedValue({ data: [{ id: 'table-1', name: '团队待办清单' }], nextCursor: null })
  const apiKey = { id: 'key', tableResources: { mode: 'selected', tableIds: ['table-1'] } } as DashboardApiKey
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><CloudKeyResourcesDialog apiKey={apiKey} onClose={() => undefined} /></QueryClientProvider>))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const panel = document.querySelector('[aria-labelledby="selected-resources-heading"]')!
    expect(panel.querySelector('.max-h-72.overflow-y-auto')).not.toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})
