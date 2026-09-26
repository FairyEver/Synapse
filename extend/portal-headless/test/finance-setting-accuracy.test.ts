import type { InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingAccuracyCapability,
  financeSettingAccuracyCapabilities,
  FINANCE_SETTING_ACCURACY_METHODS,
  FINANCE_SETTING_ACCURACY_PAGE_PATH,
} from '../src/capabilities/finance-setting-accuracy.js'
import {
  FINANCE_SETTING_ACCURACY_AI_CONTRACTS as contracts,
  FINANCE_SETTING_ACCURACY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-accuracy.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingAccuracyCapability(request), calls }
}

const backendRow = {
  id: '9007199254740993',
  accuracyName: '历史名称',
  tenantName: '测试企业',
  currencyType: 1,
  accuracyDelimiter: 1,
  decimalPlaces: 2,
  decimalQuantity: 2,
  decimalUnitPrice: 4,
  decimalAmount: 2,
  status: 0,
  isUsedByAccountSet: 0,
  createTime: '2026-09-22 09:00:00',
  ignored: '不属于页面列表投影',
}

const detail = {
  id: backendRow.id,
  accuracyName: backendRow.accuracyName,
  currencyType: backendRow.currencyType,
  accuracyDelimiter: backendRow.accuracyDelimiter,
  decimalPlaces: backendRow.decimalPlaces,
  decimalQuantity: backendRow.decimalQuantity,
  decimalUnitPrice: backendRow.decimalUnitPrice,
  decimalAmount: backendRow.decimalAmount,
  status: 0 as const,
  isUsedByAccountSet: 0 as const,
  createTime: backendRow.createTime,
  tenantName: backendRow.tenantName,
}

describe('财务设置/精度管理PC页面动作', () => {
  it('默认列表逐字段复现Portal请求并只投影页面列表字段', async () => {
    const f = setup([
      {
        list: [backendRow, {
          id: 7,
          tenantName: null,
          currencyType: null,
          decimalQuantity: null,
          decimalUnitPrice: null,
          decimalAmount: null,
          status: 1,
          isUsedByAccountSet: 1,
          createTime: null,
        }],
        total: 2,
      },
      { list: [], total: 2 },
    ])

    await expect(f.api.list()).resolves.toEqual({
      list: [
        {
          id: backendRow.id,
          tenantName: '测试企业',
          currencyType: 1,
          decimalQuantity: 2,
          decimalUnitPrice: 4,
          decimalAmount: 2,
          status: 0,
          isUsedByAccountSet: 0,
          createTime: '2026-09-22 09:00:00',
        },
        {
          id: 7,
          tenantName: null,
          currencyType: null,
          decimalQuantity: null,
          decimalUnitPrice: null,
          decimalAmount: null,
          status: 1,
          isUsedByAccountSet: 1,
          createTime: null,
        },
      ],
      total: 2,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accuracy-manage/page',
      method: 'get',
      params: { order: '', orderField: '', pageNo: 1, pageSize: 20 },
    })
    expect(Object.keys(f.calls[0]?.params as object)).toEqual(['order', 'orderField', 'pageNo', 'pageSize'])
    await expect(f.api.list({ pageNo: 2, pageSize: 100 })).resolves.toEqual({ list: [], total: 2 })
    expect(f.calls[1]?.params).toEqual({ order: '', orderField: '', pageNo: 2, pageSize: 100 })
  })

  it('详情按id读取，Portal customLoad的三个空小数位补0，未找到保持null', async () => {
    const f = setup([detail, null])
    await expect(f.api.get({ id: backendRow.id })).resolves.toEqual({
      id: backendRow.id,
      accuracyName: '历史名称',
      currencyType: 1,
      accuracyDelimiter: 1,
      decimalPlaces: 2,
      decimalQuantity: 2,
      decimalUnitPrice: 4,
      decimalAmount: 2,
      status: 0,
      isUsedByAccountSet: 0,
      createTime: '2026-09-22 09:00:00',
      tenantName: '测试企业',
    })
    await expect(f.api.get({ id: 7 })).resolves.toBeNull()
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/accuracy-manage/get', method: 'get', params: { id: backendRow.id } },
      { url: '/admin-api/finance/accuracy-manage/get', method: 'get', params: { id: 7 } },
    ])

    const emptyDecimal = setup([{ ...detail, decimalQuantity: null, decimalUnitPrice: undefined, decimalAmount: null }])
    await expect(emptyDecimal.api.get({ id: backendRow.id })).resolves.toMatchObject({ decimalQuantity: 0, decimalUnitPrice: 0, decimalAmount: 0 })
  })

  it('prepareCreate与create保持表单字段及键序，status固定0且返回Long ID', async () => {
    const f = setup(['9007199254740997'])
    const prepared = f.api.prepareCreate({ currencyType: 1, decimalQuantity: 2, decimalUnitPrice: 4, decimalAmount: 2 })
    expect(prepared).toEqual({ draft: { currencyType: 1, decimalQuantity: 2, decimalUnitPrice: 4, decimalAmount: 2, status: 0 } })
    await expect(f.api.create(prepared.draft)).resolves.toBe('9007199254740997')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accuracy-manage/create',
      method: 'post',
      data: { currencyType: 1, decimalQuantity: 2, decimalUnitPrice: 4, decimalAmount: 2, status: 0 },
    })
    expect(Object.keys(f.calls[0]?.data as object)).toEqual(['currencyType', 'decimalQuantity', 'decimalUnitPrice', 'decimalAmount', 'status'])
    await expect(f.api.create({ currencyType: 1, decimalQuantity: 10, decimalUnitPrice: 2, decimalAmount: 2 })).rejects.toThrow('0至9')
    expect(f.calls).toHaveLength(1)
  })

  it('prepareUpdate保留Portal详情快照并只合并四个可编辑字段', async () => {
    const f = setup([true])
    const prepared = f.api.prepareUpdate({
      current: detail,
      changes: { currencyType: 2, decimalAmount: 3 },
    })
    expect(prepared.previous).toEqual({
      id: backendRow.id,
      accuracyName: '历史名称',
      currencyType: 1,
      accuracyDelimiter: 1,
      decimalPlaces: 2,
      decimalQuantity: 2,
      decimalUnitPrice: 4,
      decimalAmount: 2,
      status: 0,
      isUsedByAccountSet: 0,
      createTime: '2026-09-22 09:00:00',
      tenantName: '测试企业',
    })
    expect(prepared.draft).toEqual({ ...prepared.previous, currencyType: 2, decimalAmount: 3 })
    await expect(f.api.update({ current: prepared.draft })).resolves.toBe(true)
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accuracy-manage/update',
      method: 'put',
      data: { ...prepared.draft },
    })
    expect(Object.keys(f.calls[0]?.data as object)).toEqual([
      'id', 'accuracyName', 'currencyType', 'accuracyDelimiter', 'decimalPlaces',
      'decimalQuantity', 'decimalUnitPrice', 'decimalAmount', 'status',
      'isUsedByAccountSet', 'createTime', 'tenantName',
    ])
    expect(() => f.api.prepareUpdate({ current: { ...detail, status: 1 as const } })).toThrow('禁止编辑')
    expect(() => f.api.prepareUpdate({ current: { ...detail, isUsedByAccountSet: 1 as const } })).toThrow('已被账套引用')
    await expect(f.api.update({ current: detail, changes: { status: 1 } as never })).rejects.toThrow('不支持字段status')
    expect(f.calls).toHaveLength(1)
  })

  it('启停和删除保持Portal的最小请求体，并复刻状态/引用保护', async () => {
    const f = setup([true, true])
    await expect(f.api.setStatus({ id: backendRow.id, currentStatus: 0, status: 1 })).resolves.toBe(true)
    await expect(f.api.remove({ id: 7, currentStatus: 0, isUsedByAccountSet: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/accuracy-manage/enableOrStop', method: 'put', data: { id: backendRow.id, status: 1 } },
      { url: '/admin-api/finance/accuracy-manage/delete', method: 'delete', params: { id: 7 } },
    ])
    await expect(f.api.setStatus({ id: 7, currentStatus: 0, status: 0 })).rejects.toThrow('相反')
    await expect(f.api.remove({ id: 7, currentStatus: 1, isUsedByAccountSet: 0 })).rejects.toThrow('禁止删除')
    await expect(f.api.remove({ id: 7, currentStatus: 0, isUsedByAccountSet: 1 })).rejects.toThrow('已被账套引用')
    expect(f.calls).toHaveLength(2)

    const bad = setup([false, { list: null, total: 0 }])
    await expect(bad.api.setStatus({ id: 7, currentStatus: 0, status: 1 })).rejects.toThrow('不是true')
    await expect(bad.api.list()).rejects.toThrow('list或total')
  })

  it('页面上下文使用platform、显式tenant-id且不发送module-type', async () => {
    expect(resolveModuleType(FINANCE_SETTING_ACCURACY_PAGE_PATH).moduleType).toBeNull()
    const calls: InternalAxiosRequestConfig[] = []
    const http = createPortalHttp({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'fixture-token', tenantId: 7 },
    })
    http.defaults.adapter = async (config) => {
      calls.push(config)
      const page = String(config.url).includes('/accuracy-manage/page')
      return {
        data: { ret: 'SUCCESS', code: 0, msg: '', data: page ? { list: [], total: 0 } : true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
    const api = createFinanceSettingAccuracyCapability(config => call(
      FINANCE_SETTING_ACCURACY_PAGE_PATH,
      config as PortalRequestConfig,
    ))
    await api.list()
    await api.setStatus({ id: 7, currentStatus: 0, status: 1 })
    expect(calls[0]?.headers.has('module-type')).toBe(false)
    expect(calls[0]?.headers.get('tenant-id')).toBe('7')
    const listUri = http.getUri(calls[0]!).replace(/([?&]_t=)\d+/, '$1<ts>')
    expect(listUri).toContain('https://biz-api-test.wodecorp.cn/admin-api/finance/accuracy-manage/page?')
    expect(listUri).toContain('order=&orderField=&pageNo=1&pageSize=20')
    expect(calls[1]?.method).toBe('put')
    expect(calls[1]?.headers.has('module-type')).toBe(false)
  })
})

describe('财务设置/精度管理AI契约', () => {
  it('能力定义、契约、方法契约一一对应，结构检查通过且证据缺口显式保留', async () => {
    expect(financeSettingAccuracyCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_ACCURACY_METHODS))
    expect(financeSettingAccuracyCapabilities.every(item => item.pagePath === FINANCE_SETTING_ACCURACY_PAGE_PATH)).toBe(true)
    expect(financeSettingAccuracyCapabilities.every(item => item.permission === '/dashboard/finance/setting/accuracy')).toBe(true)
    expect(financeSettingAccuracyCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingAccuracyCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(Object.keys(contracts)).toEqual(financeSettingAccuracyCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_ACCURACY_METHODS).map(method => `financeSettingAccuracy.${method}`))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: financeSettingAccuracyCapabilities, contracts })).toEqual([])
    expect(validateAiContracts(contracts, { profile: 'complete', definitions: financeSettingAccuracyCapabilities, contracts }).map((issue: { code: string }) => issue.code)).toEqual(Array(8).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) {
      expect(contract.gaps?.join(' ')).toContain('本轮未启动浏览器')
      expect(contract.gaps?.join(' ')).toContain('dcb3f360194')
    }
  })

  it('锁定页面字段、表单映射、请求保护和不可逆删除边界', () => {
    expect(contracts['finance-setting-accuracy-list']?.output.fields.map(item => item.path)).toEqual([
      '$', 'list', 'list[]', 'list[].id', 'list[].tenantName', 'list[].currencyType',
      'list[].decimalQuantity', 'list[].decimalUnitPrice', 'list[].decimalAmount',
      'list[].status', 'list[].isUsedByAccountSet', 'list[].createTime', 'total',
    ])
    expect(contracts['finance-setting-accuracy-list']?.steps[1]?.mapping).toEqual({
      id: 'result.list[].id', currentStatus: 'result.list[].status', status: 'user.targetStatus',
    })
    expect(contracts['finance-setting-accuracy-prepare-create']?.steps[0]?.mapping).toEqual({
      currencyType: 'result.draft.currencyType',
      decimalQuantity: 'result.draft.decimalQuantity',
      decimalUnitPrice: 'result.draft.decimalUnitPrice',
      decimalAmount: 'result.draft.decimalAmount',
      requestId: 'context.requestId',
    })
    expect(contracts['finance-setting-accuracy-create']?.steps[1]?.mapping).toEqual({
      id: 'result.$', currentStatus: 'literal:0', isUsedByAccountSet: 'literal:0',
    })
    expect(contracts['finance-setting-accuracy-set-status']?.steps[1]?.mapping).toEqual({
      id: 'args.id', currentStatus: 'args.status', status: 'context.previousStatus',
    })
    expect(contracts['finance-setting-accuracy-remove']?.completion).toContain('没有cancel步骤')
    expect(contracts['finance-setting-accuracy-remove']?.steps.some(step => step.role === 'cancel')).toBe(false)
    expect(contracts['finance-setting-accuracy-get']?.output.empty).toContain('null')
  })
})
