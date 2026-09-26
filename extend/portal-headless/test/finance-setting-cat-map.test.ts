import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingCatMapCapability,
  financeSettingCatMapCapabilities,
  FINANCE_SETTING_CAT_MAP_METHODS,
  FINANCE_SETTING_CAT_MAP_PAGE_PATH,
} from '../src/capabilities/finance-setting-cat-map.js'
import {
  FINANCE_SETTING_CAT_MAP_AI_CONTRACTS as contracts,
  FINANCE_SETTING_CAT_MAP_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-cat-map.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingCatMapCapability(request), calls }
}

function captureHttp () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceSettingCatMapCapability(
    config => call(FINANCE_SETTING_CAT_MAP_PAGE_PATH, config as PortalRequestConfig),
  )
  return { api, calls, http }
}

const row = {
  id: '9007199254740993',
  financeCategoryId: '9007199254740993',
  financeCategoryName: '收入》》销售收入',
  thingCategoryIds: ['17', 19],
  thingCategoryName: ['办公》》电脑', '办公》》显示器'],
  bindTime: null,
}

describe('类目对照表页面动作', () => {
  it('按Portal树组件接口搜索两类候选，并保留路径、占用状态和limit', async () => {
    const f = fixture([
      [{ id: 1, categoryName: '收入', children: [{ id: '9007199254740993', categoryName: '销售收入', children: [] }] }],
      [{ id: 7, catName: '办公', isUse: 0, children: [{ id: 8, catName: '电脑', isUse: 1, children: [] }] }],
    ])

    await expect(f.api.searchFinanceCategories({ keyword: '销售' })).resolves.toEqual({
      list: [{ id: '9007199254740993', name: '销售收入', path: '收入》》销售收入' }],
      matched: 1,
    })
    await expect(f.api.searchThingCategories({ keyword: '办', limit: 1 })).resolves.toEqual({
      list: [{ id: 7, name: '办公', path: '办公', isUse: 0, selectable: true }],
      matched: 1,
    })
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/income-category/page', method: 'get' },
      { url: '/admin-api/finance/thing-category/getThingTree', method: 'get' },
    ])
  })

  it('候选关键字和limit必须收窄，坏树节点不被静默吞掉', async () => {
    const f = fixture([[]])
    await expect(f.api.searchFinanceCategories({ keyword: '  ' })).rejects.toThrow('keyword')
    await expect(f.api.searchThingCategories({ keyword: '办公', limit: 0 })).rejects.toThrow('limit')
    expect(f.calls).toHaveLength(0)

    const bad = fixture([[{ id: 1, categoryName: '收入', children: [{ id: 2, categoryName: 3 }] }]])
    await expect(bad.api.searchFinanceCategories({ keyword: '收入' })).rejects.toThrow('categoryName')
  })

  it('列表复刻无分页的renren默认参数，只投影页面字段并保留空bindTime', async () => {
    const f = fixture([[{ ...row, ignored: 'not a page field' }]])
    await expect(f.api.list()).resolves.toEqual([row])
    expect(f.calls).toEqual([{
      url: '/admin-api/finance/thing-category/page',
      method: 'get',
      params: { order: '', orderField: '' },
    }])
  })

  it('列表不是分页对象，ID命名空间或字段形状错误时不会伪造成空结果', async () => {
    const badEnvelope = fixture([{ list: [row], total: 1 }])
    await expect(badEnvelope.api.list()).rejects.toThrow('数组')

    const badId = fixture([[{ ...row, financeCategoryId: 99 }]])
    await expect(badId.api.list()).rejects.toThrow('financeCategoryId')

    const badNames = fixture([[{ ...row, thingCategoryName: null }]])
    await expect(badNames.api.list()).rejects.toThrow('thingCategoryName')
  })

  it('prepareCreate复刻隐藏status/id默认值与POST键序，不发请求', () => {
    const f = fixture()
    expect(f.api.prepareCreate({ financeCategoryId: '7', thingCategoryIds: ['11', 12] })).toEqual({
      draft: { thingCategoryIds: ['11', 12], financeCategoryId: '7', status: true, id: '' },
    })
    expect(f.calls).toHaveLength(0)
    expect(() => f.api.prepareCreate({ financeCategoryId: 7, thingCategoryIds: [] })).toThrow('至少选择一个')
  })

  it('create发送页面完整body并返回根财务类目ID', async () => {
    const f = fixture(['9007199254740993'])
    await expect(f.api.create({ financeCategoryId: '7', thingCategoryIds: ['11', '12'] })).resolves.toBe('9007199254740993')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/thing-category/create',
      method: 'post',
      data: { thingCategoryIds: ['11', '12'], financeCategoryId: '7', status: true, id: '' },
    })
    expect(Object.keys((f.calls[0] as { data: Record<string, unknown> }).data)).toEqual([
      'thingCategoryIds', 'financeCategoryId', 'status', 'id',
    ])
  })

  it('prepareUpdate保留旧id并允许目标财务类目改变，update复刻PUT键序', async () => {
    const f = fixture([true])
    const prepared = f.api.prepareUpdate({
      current: row,
      changes: { financeCategoryId: '8', thingCategoryIds: ['21', '22'] },
    })
    expect(prepared).toEqual({
      previous: { thingCategoryIds: ['17', 19], financeCategoryId: '9007199254740993', status: true, id: '9007199254740993' },
      draft: { thingCategoryIds: ['21', '22'], financeCategoryId: '8', status: true, id: '9007199254740993' },
    })
    expect(f.calls).toHaveLength(0)

    await expect(f.api.update({ current: row, changes: { financeCategoryId: '8', thingCategoryIds: ['21', '22'] } })).resolves.toBe(true)
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/thing-category/update',
      method: 'put',
      data: { thingCategoryIds: ['21', '22'], financeCategoryId: '8', status: true, id: '9007199254740993' },
    })
    expect(Object.keys((f.calls[0] as { data: Record<string, unknown> }).data)).toEqual([
      'thingCategoryIds', 'financeCategoryId', 'status', 'id',
    ])
  })

  it('update严格要求true，discard允许空资产数组并复刻false请求体', async () => {
    const f = fixture([false, true])
    await expect(f.api.update({ current: row })).rejects.toThrow('不是true')
    await expect(f.api.discard({ id: '7', financeCategoryId: '7', thingCategoryIds: [] })).resolves.toBe(true)
    expect(f.calls[1]).toEqual({
      url: '/admin-api/finance/thing-category/discard',
      method: 'put',
      data: { id: '7', status: false, thingCategoryIds: [], financeCategoryId: '7' },
    })
    expect(Object.keys((f.calls[1] as { data: Record<string, unknown> }).data)).toEqual([
      'id', 'status', 'thingCategoryIds', 'financeCategoryId',
    ])
    await expect(f.api.discard({ id: 7, financeCategoryId: 8, thingCategoryIds: [] })).rejects.toThrow('一致')
  })

  it('platform请求层不发module-type，保留tenant/token并发送页面默认空参数', async () => {
    const { api, calls, http } = captureHttp()
    await expect(api.list()).resolves.toEqual([])
    const config = calls[0]!
    expect(config.headers.has('module-type')).toBe(false)
    expect(config.headers.get('tenant-id')).toBe('7')
    expect(config.headers.get('token')).toBe('fixture-token')
    expect(http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')).toBe(
      'https://biz-api-test.wodecorp.cn/admin-api/finance/thing-category/page?order=&orderField=&_t=<ts>',
    )
  })
})

describe('类目对照表AI契约与反证', () => {
  it('能力定义、公开方法映射和AI契约一一对应', async () => {
    expect(financeSettingCatMapCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_CAT_MAP_METHODS))
    expect(Object.keys(contracts)).toEqual(financeSettingCatMapCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'financeSettingCatMap.searchFinanceCategories',
      'financeSettingCatMap.searchThingCategories',
      'financeSettingCatMap.list',
      'financeSettingCatMap.prepareCreate',
      'financeSettingCatMap.create',
      'financeSettingCatMap.prepareUpdate',
      'financeSettingCatMap.update',
      'financeSettingCatMap.discard',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: financeSettingCatMapCapabilities,
      contracts,
    })).toEqual([])
    expect(validateAiContracts(contracts, {
      profile: 'complete',
      definitions: financeSettingCatMapCapabilities,
      contracts,
    }).map((issue: { code: string }) => issue.code)).toEqual(Array(8).fill('incomplete-evidence'))
  })

  it('契约锁定平台实例、候选映射、隐藏字段、无恢复接口和写后核对', () => {
    expect(financeSettingCatMapCapabilities.every(item => item.pagePath === FINANCE_SETTING_CAT_MAP_PAGE_PATH)).toBe(true)
    expect(financeSettingCatMapCapabilities.every(item => item.permission === '/dashboard/finance/setting/cat-map')).toBe(true)
    expect(financeSettingCatMapCapabilities.every(item => item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(contracts['finance-setting-cat-map-list']?.boundaries.join('\n')).toContain('全量数组')
    expect(contracts['finance-setting-cat-map-create']?.steps.find(step => step.role === 'cancel')?.capabilityId).toBe('finance-setting-cat-map-discard')
    expect(contracts['finance-setting-cat-map-discard']?.boundaries.join('\n')).toContain('没有后端恢复接口')
    expect(contracts['finance-setting-cat-map-create']?.output.fields.find(item => item.path === '$')?.type).toBe('string | number')
  })

  it('反证：把discard取消映射改成未登记输出字段时，契约校验会报错', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl)
    const original = contracts['finance-setting-cat-map-create']!
    const broken = {
      ...original,
      steps: original.steps.map(step => step.role === 'cancel'
        ? { ...step, mapping: { ...step.mapping, financeCategoryId: 'result.thingCategoryIds' } }
        : step),
    }
    const issues = validateAiContract('finance-setting-cat-map-create', broken, {
      definitions: financeSettingCatMapCapabilities,
      contracts,
    })
    expect((issues as Array<{ code: string }>).some(issue => issue.code === 'unknown-source-field')).toBe(true)
  })
})
