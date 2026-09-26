import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingDateConfigCapability,
  financeSettingDateConfigCapabilities,
  FINANCE_SETTING_DATE_CONFIG_METHODS,
  FINANCE_SETTING_DATE_CONFIG_PAGE_PATH,
} from '../src/capabilities/finance-setting-date-config.js'
import {
  FINANCE_SETTING_DATE_CONFIG_AI_CONTRACTS as contracts,
  FINANCE_SETTING_DATE_CONFIG_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-date-config.js'

type RequestConfig = Parameters<PortalRequest>[0]
const fixedNow = () => new Date('2026-09-23T03:00:00.000Z')

function fixture (...responses: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = responses.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createFinanceSettingDateConfigCapability(request, { now: fixedNow }), calls }
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
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceSettingDateConfigCapability(
    config => call(FINANCE_SETTING_DATE_CONFIG_PAGE_PATH, config as PortalRequestConfig),
    { now: fixedNow },
  )
  return { api, calls, http }
}

const row = {
  id: '9007199254740993',
  tenantName: '沃德股份',
  yearMonth: '2026-09',
  timeDimension: 2,
  timeDimensionName: '周',
  weekList: [{
    id: '11',
    parentId: '9007199254740993',
    weekNumber: 1,
    weekName: '第1周',
    startDate: '2026-09-01',
    endDate: '2026-09-07',
  }],
  status: 1,
  updateTime: '2026-09-23 10:20:30',
}

describe('支付计划时间管理页面动作', () => {
  it('目录定义锁定页面、菜单权限、platform实例、无module-type和实际写能力', () => {
    expect(financeSettingDateConfigCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_DATE_CONFIG_METHODS))
    expect(financeSettingDateConfigCapabilities.every(item => item.pagePath === FINANCE_SETTING_DATE_CONFIG_PAGE_PATH)).toBe(true)
    expect(financeSettingDateConfigCapabilities.every(item => item.permission === '/dashboard/finance/setting/date-config')).toBe(true)
    expect(financeSettingDateConfigCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingDateConfigCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(financeSettingDateConfigCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-setting-date-config-create',
      'finance-setting-date-config-set-status',
    ])
  })

  it('源码锚点锁定列表接口、两个按钮权限和无编辑/删除动作', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const list = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/date-config/list.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/date-config/[mode]/[id].vue'), 'utf8')
    const menu = readFileSync(join(root, 'app/portal/menus/finance.js'), 'utf8')
    expect(menu).toContain("{ title: '支付计划时间管理', path: '/dashboard/finance/setting/date-config/list', permission: '/dashboard/finance/setting/date-config' }")
    expect(list).toContain("getDataListURL: '/admin-api/finance/payment-plan-time-management/page'")
    expect(list).toContain("create: 'finance:setting:date-config:create'")
    expect(list).toContain("status: 'finance:setting:date-config:status'")
    expect(list).toContain("http.post('/admin-api/finance/payment-plan-time-management/update-status', formData)")
    expect(form).toContain("http.post('/admin-api/finance/payment-plan-time-management/create'")
    expect(form).toContain('status: 1')
    expect(list).not.toContain('actionEdit')
    expect(list).not.toContain('actionDelete')
    expect(form).not.toContain("http.put('/admin-api/finance/payment-plan-time-management/update'")
    expect(form).not.toContain("http.delete('/admin-api/finance/payment-plan-time-management")
  })

  it('列表复刻Portal默认筛选、分页参数并只投影页面字段', async () => {
    const f = fixture({ list: [{ ...row, ignored: 'not a page field' }], total: 1 })
    await expect(f.api.list()).resolves.toEqual({
      list: [{
        id: row.id,
        tenantName: row.tenantName,
        yearMonth: row.yearMonth,
        timeDimensionName: row.timeDimensionName,
        weekList: [{ weekName: '第1周', startDate: '2026-09-01', endDate: '2026-09-07' }],
        status: 1,
        updateTime: row.updateTime,
      }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/payment-plan-time-management/page',
      method: 'get',
      params: {
        order: '', orderField: '', tenantName: '', yearMonth: '2026-09', status: 1, pageNo: 1, pageSize: 20,
      },
    })
  })

  it('列表允许空年月并保留显式筛选与页码', async () => {
    const f = fixture({ list: [], total: 0 })
    await expect(f.api.list({ tenantName: '  沃德  ', yearMonth: '', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]?.params).toEqual({
      order: '', orderField: '', tenantName: '  沃德  ', yearMonth: '', status: 0, pageNo: 2, pageSize: 50,
    })
  })

  it('平台请求不发送module-type并保留tenant-id、token和列表参数', async () => {
    const { api, calls, http } = captureHttp()
    await expect(api.list()).resolves.toEqual({ list: [], total: 0 })
    const config = calls[0]!
    expect(config.headers?.get('module-type')).toBeUndefined()
    expect(config.headers?.get('tenant-id')).toBe('7')
    expect(config.headers?.get('token')).toBe('fixture-token')
    expect(http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')).toBe(
      'https://biz-api-test.wodecorp.cn/admin-api/finance/payment-plan-time-management/page?order=&orderField=&tenantName=&yearMonth=2026-09&status=1&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('prepareCreate只做本地校验；周维度按Portal顺序生成后端周对象', async () => {
    const f = fixture('9007199254740994')
    const input = {
      yearMonth: '2026-10',
      timeDimension: '2' as const,
      weekList: [['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-15']] as [string, string][],
    }
    expect(f.api.prepareCreate(input)).toEqual({ draft: input })
    expect(f.calls).toHaveLength(0)
    await expect(f.api.create(input)).resolves.toBe('9007199254740994')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/payment-plan-time-management/create',
      method: 'post',
      data: {
        status: 1,
        yearMonth: '2026-10',
        timeDimension: '2',
        weekList: [
          { weekName: '第1周', weekNumber: 1, startDate: '2026-10-01', endDate: '2026-10-07' },
          { weekName: '第2周', weekNumber: 2, startDate: '2026-10-08', endDate: '2026-10-15' },
        ],
      },
    })
  })

  it('日/月维度发送空weekList；创建输入复刻页面日期和周次规则', async () => {
    const f = fixture('42', true)
    await expect(f.api.create({ yearMonth: '2026-09', timeDimension: '1' })).resolves.toBe('42')
    expect(f.calls[0]?.data).toEqual({ status: 1, yearMonth: '2026-09', timeDimension: '1', weekList: [] })
    expect(() => f.api.prepareCreate({ yearMonth: '2026-08', timeDimension: '1' })).toThrow('不能早于当前月份')
    expect(() => f.api.prepareCreate({ yearMonth: '2026-11', timeDimension: '2', weekList: [] })).toThrow('至少保留一个周')
    expect(() => f.api.prepareCreate({ yearMonth: '2026-11', timeDimension: '2', weekList: [['2026-11-02', '2026-11-04'], ['2026-11-04', '2026-11-08']] })).toThrow('日期重复')
    expect(() => f.api.prepareCreate({ yearMonth: '2026-11', timeDimension: '2', weekList: [['2026-11-01', '2026-12-01']] })).toThrow('所属月份内')
    expect(() => f.api.prepareCreate({ yearMonth: '2026-11', timeDimension: '2', weekList: [['2026-11-08', '2026-11-01']] })).toThrow('不能大于')
    expect(f.calls).toHaveLength(1)
  })

  it('启停复刻FormData字段、绝对状态反转约束和true回执', async () => {
    const f = fixture(true)
    await expect(f.api.setStatus({ id: '9007199254740993', currentStatus: 1, status: 0 })).resolves.toBe(true)
    const form = f.calls[0]?.data as FormData
    expect(Array.from(form.entries())).toEqual([['id', '9007199254740993'], ['status', '0']])
    expect(f.calls[0]).toMatchObject({
      url: '/admin-api/finance/payment-plan-time-management/update-status',
      method: 'post',
    })
    await expect(f.api.setStatus({ id: 1, currentStatus: 0, status: 0 })).rejects.toThrow('相反')
    expect(f.calls).toHaveLength(1)
  })

  it('坏分页、坏周次和非true写回执不被改写成空结果或成功', async () => {
    const badPage = fixture({ list: [{ ...row, status: 2 }], total: 1 })
    await expect(badPage.api.list()).rejects.toThrow('status')
    const badShape = fixture({ list: [], total: -1 })
    await expect(badShape.api.list()).rejects.toThrow('有效list或total')
    const failed = fixture(false)
    await expect(failed.api.setStatus({ id: 1, currentStatus: 1, status: 0 })).rejects.toThrow('不是true')
  })
})

describe('支付计划时间管理AI契约与反证', () => {
  it('能力定义、公开方法和AI契约一一对应且结构通过', async () => {
    expect(financeSettingDateConfigCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_DATE_CONFIG_METHODS))
    expect(Object.keys(contracts)).toEqual(financeSettingDateConfigCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_DATE_CONFIG_METHODS).map(method => `financeSettingDateConfig.${method}`))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: financeSettingDateConfigCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: financeSettingDateConfigCapabilities, contracts }) as Array<{ code: string }>
    expect(complete.length).toBeGreaterThan(0)
    expect(new Set(complete.map(issue => issue.code))).toEqual(new Set(['incomplete-evidence']))
    for (const item of Object.values(contracts)) expect(item.gaps?.join(' ')).toContain('未启动浏览器')
  })

  it('契约锁定无编辑/删除、创建补偿仅为停用、FormData启停映射和无module-type', () => {
    expect(contracts['finance-setting-date-config-list']?.boundaries.join('\n')).toContain('不发布后端存在但页面没有调用的get')
    expect(contracts['finance-setting-date-config-create']?.steps.find(step => step.role === 'cancel')?.capabilityId).toBe('finance-setting-date-config-set-status')
    expect(contracts['finance-setting-date-config-create']?.steps.find(step => step.role === 'cancel')?.instruction).toContain('不是删除')
    expect(contracts['finance-setting-date-config-set-status']?.consume.join('\n')).toContain('FormData')
    expect(contracts['finance-setting-date-config-list']?.boundaries.join('\n')).toContain('不发送module-type')
  })

  it('反证：把创建后的状态回查映射改成未知字段时，契约校验会报错', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl)
    const original = contracts['finance-setting-date-config-create']!
    const broken = {
      ...original,
      steps: original.steps.map(step => step.role === 'required'
        ? { ...step, mapping: { id: 'result.missingId' } }
        : step),
    }
    const issues = validateAiContract('finance-setting-date-config-create', broken, {
      definitions: financeSettingDateConfigCapabilities,
      contracts,
    }) as Array<{ code: string }>
    expect(issues.some(issue => issue.code === 'unknown-source-field')).toBe(true)
  })
})
