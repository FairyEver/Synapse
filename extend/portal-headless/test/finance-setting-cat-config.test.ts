import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingCatConfigCapability,
  financeSettingCatConfigCapabilities,
  FINANCE_SETTING_CAT_CONFIG_METHODS,
  FINANCE_SETTING_CAT_CONFIG_PAGE_PATH,
} from '../src/capabilities/finance-setting-cat-config.js'
import {
  FINANCE_SETTING_CAT_CONFIG_AI_CONTRACTS as contracts,
  FINANCE_SETTING_CAT_CONFIG_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-cat-config.js'

type RequestConfig = Parameters<PortalRequest>[0]
const originalAdapter = axios.defaults.adapter
afterEach(() => { axios.defaults.adapter = originalAdapter })

const rawChild = {
  id: '9007199254740994',
  status: 1,
  createTime: null,
  categoryName: '子类目',
  categoryType: 3,
  pid: '9007199254740993',
  parentId: '9007199254740993',
  children: [],
  topIndex: 0,
}

const rawRoot = {
  id: '9007199254740993',
  status: 1,
  createTime: '2026-09-22 10:20:30',
  categoryName: '根类目',
  categoryType: 1,
  pid: 0,
  parentId: 0,
  children: [rawChild],
  topIndex: 0,
}

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createFinanceSettingCatConfigCapability(request), calls }
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
  const api = createFinanceSettingCatConfigCapability(
    config => call(FINANCE_SETTING_CAT_CONFIG_PAGE_PATH, config as PortalRequestConfig),
  )
  return { api, calls, http }
}

describe('财务设置→类目配置PC页面能力', () => {
  it('目录定义锁定页面、权限、platform实例和无module-type', () => {
    expect(financeSettingCatConfigCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_CAT_CONFIG_METHODS))
    expect(financeSettingCatConfigCapabilities.every(item => item.pagePath === FINANCE_SETTING_CAT_CONFIG_PAGE_PATH)).toBe(true)
    expect(financeSettingCatConfigCapabilities.every(item => item.permission === '/dashboard/finance/setting/cat-config')).toBe(true)
    expect(financeSettingCatConfigCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingCatConfigCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(financeSettingCatConfigCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-setting-cat-config-create',
      'finance-setting-cat-config-update',
      'finance-setting-cat-config-discard',
    ])
  })

  it('页面清单与源码锚点仍指向这个列表页，四个按钮权限和真实接口存在', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const source = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/cat-config/list.vue'), 'utf8')
    const formSource = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/cat-config/[mode]/[id].vue'), 'utf8')
    expect(source).toContain("getDataListURL: '/admin-api/finance/income-category/page'")
    expect(source).toContain("http.put('/admin-api/finance/income-category/update'")
    expect(formSource).toContain("http.post('/admin-api/finance/income-category/create'")
    expect(source).toContain("create: 'finance:setting:cat-config:create'")
    expect(source).toContain("edit: 'finance:setting:cat-config:edit'")
    expect(source).toContain("delete: 'finance:setting:cat-config:delete'")
    expect(source).toContain("detail: 'finance:setting:cat-config:detail'")
    expect(source).toContain("status: 0")
    expect(source).toContain('rrList.actionDetail(record, record)')
    expect(source).not.toContain("http.delete('/admin-api/finance/income-category")

    const catalog = JSON.parse(readFileSync(new URL('../generated/page-catalog.json', import.meta.url), 'utf8')) as {
      items: Array<{ menuPath: string; permission: string; menuSource: string; kind: string; write: boolean; moduleType: number | null }>
    }
    expect(catalog.items.find(item => item.menuPath === FINANCE_SETTING_CAT_CONFIG_PAGE_PATH)).toEqual(expect.objectContaining({
      permission: '/dashboard/finance/setting/cat-config',
      menuSource: 'app/portal/menus/finance.js',
      kind: '列表页(声明式 getDataListURL)',
      write: true,
      moduleType: null,
    }))
  })

  it('默认列表只发送order/orderField，保留树结构并投影页面业务字段', async () => {
    const { api, calls } = setup([rawRoot])
    await expect(api.list()).resolves.toEqual([{
      id: rawRoot.id,
      status: 1,
      createTime: rawRoot.createTime,
      categoryName: rawRoot.categoryName,
      categoryType: 1,
      pid: null,
      parentId: null,
      children: [{
        id: rawChild.id,
        status: 1,
        createTime: null,
        categoryName: rawChild.categoryName,
        categoryType: 3,
        pid: rawRoot.id,
        parentId: rawRoot.id,
        children: [],
      }],
    }])
    expect(calls[0]).toEqual({
      url: '/admin-api/finance/income-category/page',
      method: 'get',
      params: { order: '', orderField: '' },
    })
    expect(calls[0]?.params).not.toHaveProperty('pageNo')
    expect(calls[0]?.params).not.toHaveProperty('pageSize')
  })

  it('平台页面调用不发module-type，并保留GET防缓存语义', async () => {
    const { api, calls, http } = captureHttp()
    await expect(api.list()).resolves.toEqual([])
    const config = calls[0]!
    expect(config.headers?.get('module-type')).toBeUndefined()
    expect(http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')).toBe(
      'https://biz-api-test.wodecorp.cn/admin-api/finance/income-category/page?order=&orderField=&_t=<ts>',
    )
  })

  it('详情只读取桥接行，不发请求；没有pName时保留页面的顶级显示语义', async () => {
    const { api, calls } = setup()
    expect(api.detail({ row: {
      id: rawChild.id,
      status: 1,
      createTime: null,
      categoryName: rawChild.categoryName,
      categoryType: rawChild.categoryType,
      pid: rawRoot.id,
      parentId: rawRoot.id,
      children: [],
    } })).toEqual({
      id: rawChild.id,
      pName: null,
      pid: rawRoot.id,
      categoryName: rawChild.categoryName,
      categoryType: rawChild.categoryType,
    })
    expect(calls).toHaveLength(0)
  })

  it('prepareCreate使用顶级空pid和页面类别默认1，create只提交三个后端字段并返回Long ID', async () => {
    const { api, calls } = setup('9007199254740995')
    expect(api.prepareCreate({ categoryName: '新顶级类目' })).toEqual({
      draft: { pid: '', categoryName: '新顶级类目', categoryType: 1 },
    })
    const prepared = api.prepareCreate({ pid: rawRoot.id, categoryName: '新子类目', categoryType: 4 })
    expect(prepared).toEqual({
      draft: { pid: rawRoot.id, categoryName: '新子类目', categoryType: 4 },
    })
    await expect(api.create(prepared.draft)).resolves.toBe('9007199254740995')
    expect(calls[0]).toEqual({
      url: '/admin-api/finance/income-category/create',
      method: 'post',
      data: { pid: rawRoot.id, categoryName: '新子类目', categoryType: 4 },
    })
    expect(Object.keys(calls[0]?.data as object)).toEqual(['pid', 'categoryName', 'categoryType'])
    expect(() => api.prepareCreate({ categoryName: ' ', categoryType: 1 })).toThrow('categoryName')
    expect(() => api.prepareCreate({ categoryName: '非法类别', categoryType: '1' as never })).toThrow('categoryType')
    expect(calls).toHaveLength(1)
  })

  it('prepareUpdate仅合并可编辑字段，update提交完整VO字段并保留previous', async () => {
    const { api, calls } = setup(true)
    const current = {
      id: rawChild.id,
      status: 1 as const,
      createTime: null,
      categoryName: rawChild.categoryName,
      categoryType: rawChild.categoryType,
      pid: rawRoot.id,
      parentId: rawRoot.id,
      children: [],
    }
    const prepared = api.prepareUpdate({ current, changes: { categoryName: '编辑后的子类目', categoryType: 4, pid: '' } })
    expect(prepared).toEqual({
      previous: { id: rawChild.id, status: 1, categoryName: rawChild.categoryName, categoryType: 3, pid: rawRoot.id },
      draft: { id: rawChild.id, status: 1, categoryName: '编辑后的子类目', categoryType: 4, pid: '' },
    })
    await expect(api.update({ draft: prepared.draft })).resolves.toBe(true)
    expect(calls[0]).toEqual({
      url: '/admin-api/finance/income-category/update',
      method: 'put',
      data: { id: rawChild.id, status: 1, categoryName: '编辑后的子类目', categoryType: 4, pid: '' },
    })
    expect(Object.keys(calls[0]?.data as object)).toEqual(['id', 'status', 'categoryName', 'categoryType', 'pid'])
    expect(() => api.prepareUpdate({ current, changes: { status: 0 } as never })).toThrow('不支持字段status')
  })

  it('prepareDiscard只接受启用节点，discard复用update并将status设为0', async () => {
    const { api, calls } = setup(true)
    const current = {
      id: rawRoot.id,
      status: 1 as const,
      createTime: rawRoot.createTime,
      categoryName: rawRoot.categoryName,
      categoryType: rawRoot.categoryType,
      pid: null,
      parentId: null,
      children: [],
    }
    const prepared = api.prepareDiscard({ current })
    expect(prepared).toEqual({
      previous: { id: rawRoot.id, status: 1, categoryName: rawRoot.categoryName, categoryType: 1, pid: '' },
      draft: { id: rawRoot.id, status: 0, categoryName: rawRoot.categoryName, categoryType: 1, pid: '' },
    })
    await expect(api.discard({ draft: prepared.draft })).resolves.toBe(true)
    expect(calls[0]).toEqual({
      url: '/admin-api/finance/income-category/update',
      method: 'put',
      data: { id: rawRoot.id, status: 0, categoryName: rawRoot.categoryName, categoryType: 1, pid: '' },
    })
    expect(() => api.prepareDiscard({ current: { ...current, status: 0 } })).toThrow('只能废弃')
    const invalid = setup(true)
    await expect(invalid.api.discard({ draft: { ...prepared.draft, status: 1 } })).rejects.toThrow('status必须为0')
    expect(invalid.calls).toHaveLength(0)
  })

  it('坏树响应和非true更新响应不被改写成成功', async () => {
    const badTree = setup([{ ...rawRoot, status: 2 }])
    await expect(badTree.api.list()).rejects.toThrow('status')
    const badChildren = setup([{ ...rawRoot, children: {} }])
    await expect(badChildren.api.list()).rejects.toThrow('children')
    const failed = setup(false)
    const draft = { id: rawRoot.id, status: 1 as const, categoryName: rawRoot.categoryName, categoryType: 1, pid: '' }
    await expect(failed.api.update({ draft })).rejects.toThrow('不是true')
    expect(failed.calls).toHaveLength(1)
  })
})

describe('财务设置→类目配置AI契约', () => {
  it('能力契约结构通过，完整检查明确保留当前无浏览器/真实环境证据缺口', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: financeSettingCatConfigCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, {
      profile: 'complete',
      definitions: financeSettingCatConfigCapabilities,
      contracts,
    }) as Array<{ code: string }>
    expect(complete.length).toBeGreaterThan(0)
    expect(new Set(complete.map(issue => issue.code))).toEqual(new Set(['incomplete-evidence']))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_CAT_CONFIG_METHODS).map(method => `financeSettingCatConfig.${method}`))
    for (const item of Object.values(contracts)) {
      expect(item.gaps?.join(' ')).toContain('未启动浏览器')
      expect(item.boundaries.join(' ')).toContain('不是删除')
    }
  })

  it('契约映射锁定树节点、创建草稿、编辑草稿和废弃补偿快照', () => {
    expect(contracts['finance-setting-cat-config-list']?.output.fields.map(item => item.path)).toContain('[].children[].id')
    expect(contracts['finance-setting-cat-config-prepare-create']?.steps[0]?.mapping).toEqual({
      pid: 'result.draft.pid', categoryName: 'result.draft.categoryName', categoryType: 'result.draft.categoryType',
    })
    expect(contracts['finance-setting-cat-config-prepare-update']?.steps[0]?.mapping).toEqual({ draft: 'result.draft' })
    expect(contracts['finance-setting-cat-config-prepare-discard']?.steps[0]?.mapping).toEqual({ draft: 'result.draft' })
    expect(contracts['finance-setting-cat-config-create']?.steps.find(step => step.role === 'cancel')?.capabilityId).toBeUndefined()
    expect(contracts['finance-setting-cat-config-discard']?.steps.find(step => step.role === 'cancel')?.mapping).toEqual({ draft: 'context.previousDraft' })
  })
})
