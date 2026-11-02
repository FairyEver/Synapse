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
    const submit = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存')!
    await act(async () => submit.click())
    expect(save).toHaveBeenCalledWith('key', { mode: 'selected', tableIds: ['other-page-table'] })
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks() }
})
