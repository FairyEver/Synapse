import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import {
  createPortalHttp,
  type PortalRequestConfig,
} from '../src/http/client.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createFinanceAllocationIndicatorCapability,
  financeAllocationIndicatorCapabilities,
  FINANCE_ALLOCATION_INDICATOR_METHODS,
  FINANCE_ALLOCATION_INDICATOR_PAGE_PATH,
} from '../src/capabilities/finance-setting-allocation-indicator.js'
import {
  FINANCE_ALLOCATION_INDICATOR_AI_CONTRACTS as contracts,
  FINANCE_ALLOCATION_INDICATOR_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-allocation-indicator.js'
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
  return { api: createFinanceAllocationIndicatorCapability(request), calls }
}

const backendRow = {
  id: '9007199254740993',
  quickNumber: '用电量',
  abstracts: 1,
  dataSource: 2,
  instruction: '按月录入',
  status: false,
  update: '2026-09-22',
  updateTime: '不属于页面消费字段',
}

describe('费用分配指标库PC页面动作', () => {
  it('默认查询逐字段复现页面请求，并只投影页面字段', async () => {
    const f = setup([{ list: [backendRow], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({
      list: [{
        id: '9007199254740993',
        quickNumber: '用电量',
        abstracts: 1,
        dataSource: 2,
        instruction: '按月录入',
        update: '2026-09-22',
        status: 0,
      }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/indicator-library/page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        quickNumber: null,
        status: 0,
        pageNo: 1,
        pageSize: 20,
      },
    })
    expect(f.calls[0]?.params && Object.keys(f.calls[0].params as object)).toEqual([
      'order', 'orderField', 'quickNumber', 'status', 'pageNo', 'pageSize',
    ])
  })

  it('名称、停用状态和分页按页面字段发送，后端Boolean状态归一为1', async () => {
    const f = setup([{ list: [{ ...backendRow, quickNumber: null, abstracts: null, dataSource: null, instruction: null, update: null, status: true }], total: 7 }])
    await expect(f.api.list({ quickNumber: '电', status: 1, pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [{
        id: '9007199254740993',
        quickNumber: null,
        abstracts: null,
        dataSource: null,
        instruction: null,
        update: null,
        status: 1,
      }],
      total: 7,
    })
    expect(f.calls[0]?.params).toEqual({
      order: '', orderField: '', quickNumber: '电', status: 1, pageNo: 2, pageSize: 50,
    })
  })

  it('状态更新只提交id/status，并要求目标状态与当前状态相反', async () => {
    const f = setup([true, true])
    await expect(f.api.setStatus({ id: '9007199254740993', currentStatus: 0, status: 1 })).resolves.toBe(true)
    await expect(f.api.setStatus({ id: 7, currentStatus: 1, status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/indicator-library/update', method: 'put', data: { id: '9007199254740993', status: 1 } },
      { url: '/admin-api/finance/indicator-library/update', method: 'put', data: { id: 7, status: 0 } },
    ])
    await expect(f.api.setStatus({ id: 7, currentStatus: 0, status: 0 })).rejects.toThrow('相反')
    await expect(f.api.setStatus({ id: 7, currentStatus: 0, status: true as unknown as 0 })).rejects.toThrow('0（启用）')
    expect(f.calls).toHaveLength(2)
  })

  it('坏参数、坏响应和后端非true响应不会伪装成功', async () => {
    const f = setup([{ list: null, total: 0 }])
    await expect(f.api.list({ quickNumber: 7 as unknown as string })).rejects.toThrow('quickNumber')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(f.api.list()).rejects.toThrow('list或total')
    expect(f.calls).toHaveLength(1)

    const badRow = setup([{ list: [{ ...backendRow, status: 2 }], total: 1 }])
    await expect(badRow.api.list()).rejects.toThrow('status')

    const badUpdate = setup([false])
    await expect(badUpdate.api.setStatus({ id: 7, currentStatus: 0, status: 1 })).rejects.toThrow('不是true')
  })
})

function captureHttp () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config)
    const isUpdate = String(config.url).endsWith('/indicator-library/update')
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: isUpdate ? true : { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceAllocationIndicatorCapability(config => call(
    FINANCE_ALLOCATION_INDICATOR_PAGE_PATH,
    config as PortalRequestConfig,
  ))
  return { api, calls, http }
}

describe('费用分配指标库请求上下文', () => {
  it('页面目录未匹配module-type，真实platform请求不发送该头且省略quickNumber=null', async () => {
    expect(resolveModuleType(FINANCE_ALLOCATION_INDICATOR_PAGE_PATH).moduleType).toBeNull()
    const { api, calls, http } = captureHttp()
    await api.list()
    await api.setStatus({ id: 7, currentStatus: 0, status: 1 })
    const listConfig = calls[0]!
    expect(listConfig.headers.has('module-type')).toBe(false)
    expect(listConfig.headers.get('tenant-id')).toBe('7')
    const listUri = http.getUri(listConfig).replace(/([?&]_t=)\d+/, '$1<ts>')
    expect(listUri).toContain('https://biz-api-test.wodecorp.cn/admin-api/finance/indicator-library/page?')
    expect(listUri).toContain('order=&orderField=&status=0&pageNo=1&pageSize=20')
    expect(listUri).not.toContain('quickNumber=')
    expect(calls[1]?.method).toBe('put')
  })
})

describe('费用分配指标库AI契约与共享接线要求', () => {
  it('两个当前页面能力、公开方法与AI说明一一对应且结构有效', async () => {
    expect(financeAllocationIndicatorCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_ALLOCATION_INDICATOR_METHODS))
    expect(financeAllocationIndicatorCapabilities.every(item => item.pagePath === FINANCE_ALLOCATION_INDICATOR_PAGE_PATH)).toBe(true)
    expect(financeAllocationIndicatorCapabilities.every(item => item.permission === '/dashboard/finance/setting/allocation-indicator')).toBe(true)
    expect(financeAllocationIndicatorCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeAllocationIndicatorCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(Object.keys(contracts)).toEqual(financeAllocationIndicatorCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'financeAllocationIndicator.list',
      'financeAllocationIndicator.setStatus',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: financeAllocationIndicatorCapabilities,
      contracts,
    })).toEqual([])
    expect(validateAiContracts(contracts, {
      profile: 'complete',
      definitions: financeAllocationIndicatorCapabilities,
      contracts,
    }).map((issue: { code: string }) => issue.code)).toEqual([
      'incomplete-evidence',
      'incomplete-evidence',
    ])
  })

  it('锁定页面字段、字典值、Boolean状态归一、写入映射和可逆恢复步骤', () => {
    const list = contracts['finance-allocation-indicator-list']!
    expect(list.output.fields.map(item => item.path)).toEqual([
      '$', 'list', 'list[]', 'list[].id', 'list[].quickNumber', 'list[].abstracts',
      'list[].dataSource', 'list[].instruction', 'list[].update', 'list[].status', 'total',
    ])
    expect(list.output.fields.find(item => item.path === 'list[].status')?.values).toEqual({
      '0': '启用；页面行操作显示“停用”',
      '1': '停用；页面行操作显示“启用”',
    })
    expect(list.steps[0]?.mapping).toEqual({
      id: 'result.list[].id', currentStatus: 'result.list[].status', status: 'user.targetStatus',
    })
    expect(list.inputs.quickNumber?.nullable).toBe(true)
    expect(list.inputs.quickNumber?.nullMeaning).toContain('不按指标名称筛选')

    const setStatus = contracts['finance-allocation-indicator-set-status']!
    expect(setStatus.inputs.currentStatus?.required).toBe(true)
    expect(setStatus.inputs.status?.options).toEqual([{ value: 0, label: '启用' }, { value: 1, label: '停用' }])
    expect(setStatus.steps[0]?.mapping).toEqual({ status: 'args.status' })
    expect(setStatus.steps[1]?.mapping).toEqual({
      id: 'args.id', currentStatus: 'args.status', status: 'context.previousStatus',
    })
    expect(setStatus.consume.join('\n')).toContain('不把currentStatus发送给后端')
    expect(setStatus.boundaries.join('\n')).toContain('没有独立cancel URL')
    expect(setStatus.gaps?.join('\n')).toContain('未在测试环境执行PUT状态写入')
  })
})
