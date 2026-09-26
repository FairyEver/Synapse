import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPortalHeadless } from '../src/index.js'
import { installPortalPageCompatibility } from '../src/capabilities/portal-page-compat.js'

const plan = (id: number | string) => ({ request: { url: `/admin-api/system/openApiRegistry/delete/${id}`, method: 'delete', params: { id } }, undo: null, note: '删除' })
function fixture () {
  const client = { list: vi.fn(async () => ({ list: [{ id: 7, isBound: true }], total: 1 })), prepareRemove: vi.fn(async (id: unknown) => plan(id as number)), submit: vi.fn(async (_plan: unknown) => null) }
  const host = { aiPromptTool: { openApiRegistry: client } }
  installPortalPageCompatibility(host)
  return { host, client }
}

describe('Portal list deletion condition', () => {
  it('blocks the page-disabled action in both preparation and submission', async () => {
    const { client } = fixture()
    const result = await client.list()
    expect(result).toEqual({ list: [{ id: 7, isBound: true }], total: 1 })
    await expect(client.prepareRemove(7)).rejects.toThrow('已被提示词绑定')
    await expect(client.submit(plan('7') as never)).rejects.toThrow('已被提示词绑定')
  })
  it.each([false, undefined, null, 0, '', 'false', 1])('uses page truthiness for isBound=%s, without treating missing as evidence of absence', async (isBound) => {
    const client = { list: async () => ({ list: [{ id: 7, isBound }], total: 1 }), prepareRemove: vi.fn(async (_id: unknown) => plan(7)), submit: vi.fn(async (_plan: unknown) => null) }
    installPortalPageCompatibility({ aiPromptTool: { openApiRegistry: client } })
    await client.list()
    if (isBound) await expect(client.prepareRemove(7 as never)).rejects.toThrow('无法删除')
    else expect(await client.prepareRemove(7 as never)).toEqual(plan(7))
  })
  it('a refreshed row replaces its flag; clients do not share snapshots', async () => {
    let isBound = true
    const client = { list: async () => ({ list: [{ id: 7, isBound }], total: 1 }), prepareRemove: async (_id: unknown) => plan(7), submit: async (_plan: unknown) => null }
    installPortalPageCompatibility({ aiPromptTool: { openApiRegistry: client } })
    await client.list()
    await expect(client.prepareRemove(7)).rejects.toThrow('无法删除')
    isBound = false
    await client.list()
    expect(await client.prepareRemove(7)).toEqual(plan(7))
    const other = fixture()
    expect(await other.client.prepareRemove(7)).toEqual(plan(7))
  })
  it('installation is optional and idempotent, with no extra business requests', async () => {
    installPortalPageCompatibility({})
    const { host, client } = fixture()
    const wrapped = client.list
    installPortalPageCompatibility(host)
    expect(client.list).toBe(wrapped)
    expect(await client.prepareRemove(8)).toEqual(plan(8))
  })
})

describe.skipIf(!existsSync(new URL('../src/capabilities/ai-prompt-tool.ts', import.meta.url)))('actual SDK public executor', () => {
  it('shares the list flag between invoke and direct methods and prevents DELETE', async () => {
    const sdk = createPortalHeadless({ baseUrl: 'https://page-contract.invalid', credential: { token: 'offline', tenantId: 1 } })
    const calls: string[] = []
    sdk.http.defaults.adapter = async config => {
      calls.push(config.url!)
      return { config, status: 200, statusText: 'OK', headers: {}, data: { ret: 'SUCCESS', data: { list: [{ id: 7, isBound: true }], total: 1 }, msg: '' } }
    }
    await sdk.capabilities.invoke('ai-open-api-registry-list')
    await expect(sdk.capabilities.invoke('ai-open-api-registry-remove', { id: 7 })).rejects.toThrow('已被提示词绑定')
    const registry = (sdk as unknown as { aiPromptTool: { openApiRegistry: { submit: (input: unknown) => Promise<unknown> } } }).aiPromptTool.openApiRegistry
    await expect(registry.submit(plan(7))).rejects.toThrow('已被提示词绑定')
    expect(calls).toHaveLength(1)
  })
})
