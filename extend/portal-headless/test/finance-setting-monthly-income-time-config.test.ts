import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingMonthlyIncomeTimeConfigCapability,
  financeSettingMonthlyIncomeTimeConfigCapabilities,
  FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHODS,
  FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH,
} from '../src/capabilities/finance-setting-monthly-income-time-config.js'
import {
  FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_AI_CONTRACTS as contracts,
  FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-monthly-income-time-config.js'
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
  return { api: createFinanceSettingMonthlyIncomeTimeConfigCapability(request), calls }
}

function captureHttp () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config)
    const url = String(config.url)
    const data = url.includes('/update')
      ? true
      : url.includes('/get')
        ? [{ bizType: 1, lockDay: 25, remark: '' }]
        : { list: [], total: 0 }
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceSettingMonthlyIncomeTimeConfigCapability(config => call(
    FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH,
    config as PortalRequestConfig,
  ))
  return { api, calls, http }
}

describe('财务设置→月度收入时间配置PC页面动作', () => {
  it('目录定义锁定页面、权限、platform实例和无module-type', () => {
    expect(financeSettingMonthlyIncomeTimeConfigCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHODS))
    expect(financeSettingMonthlyIncomeTimeConfigCapabilities.every(item => item.pagePath === FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH)).toBe(true)
    expect(financeSettingMonthlyIncomeTimeConfigCapabilities.every(item => item.permission === '/dashboard/finance/setting/monthly-income-time-config')).toBe(true)
    expect(financeSettingMonthlyIncomeTimeConfigCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingMonthlyIncomeTimeConfigCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(financeSettingMonthlyIncomeTimeConfigCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-setting-monthly-income-time-config-update',
    ])
    expect(resolveModuleType(FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH).moduleType).toBeNull()
  })

  it('源码锚定菜单、管理员/普通用户分支、三个请求和保存权限；没有删除或启停动作', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/monthly-income-time-config.vue'), 'utf8')
    const source = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/monthly-income-time-config/list.vue'), 'utf8')
    const controller = readFileSync(
      '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/monthlyincomebudgeteditconfig/MonthlyIncomeBudgetEditConfigController.java',
      'utf8',
    )
    const updateVO = readFileSync(
      '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/monthlyincomebudgeteditconfig/vo/MonthlyIncomeBudgetEditConfigUpdateReqVO.java',
      'utf8',
    )
    const service = readFileSync(
      '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java/erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/monthlyincomebudgeteditconfig/MonthlyIncomeBudgetEditConfigServiceImpl.java',
      'utf8',
    )
    expect(menu).toContain("{ title: '月度收入时间配置', path: '/dashboard/finance/setting/monthly-income-time-config/list', permission: '/dashboard/finance/setting/monthly-income-time-config' }")
    expect(route).toContain('permission: /dashboard/finance/setting/monthly-income-time-config')
    expect(source).toContain("getDataListURL: '/admin-api/finance/monthly-income-budget-edit-config/page'")
    expect(source).toContain("http.get('/admin-api/finance/monthly-income-budget-edit-config/get')")
    expect(source).toContain("http.put('/admin-api/finance/monthly-income-budget-edit-config/update'")
    expect(source).toContain("update: 'finance:monthly-income-budget-edit-config:update'")
    expect(source).toContain("return state.username === 'admin' || Number(state.superAdmin) === 1")
    expect(source).toContain('if (isAdmin.value) rrList.logicFetch()')
    expect(source).toContain('else loadConfig()')
    expect(source).toContain('const dayOptions = Array.from({ length: 31 }')
    expect(source).toContain('lockDay: current?.lockDay ?? null')
    expect(source).toContain('formState.items.map(({ bizType, lockDay, remark }) => ({ bizType, lockDay, remark }))')
    expect(source).not.toContain('http.delete(')
    expect(source).not.toContain('update-status')
    expect(controller).toContain("@PreAuthorize(\"@ss.hasPermission('finance:monthly-income-budget-edit-config:update')\")")
    expect(updateVO).toContain('@NotEmpty')
    expect(updateVO).toContain('@Min(1)')
    expect(updateVO).toContain('@Max(31)')
    expect(service).toContain('DEFAULT_LOCK_DAY = 25')
    expect(service).toContain('ensureDefaults()')
  })

  it('generated页面元数据与能力范围一致', () => {
    const catalog = JSON.parse(readFileSync(new URL('../generated/page-catalog.json', import.meta.url), 'utf8')) as {
      items: Array<Record<string, unknown>>
    }
    expect(catalog.items.find(item => item.menuPath === FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH)).toMatchObject({
      id: '51f696',
      title: '月度收入时间配置',
      permission: '/dashboard/finance/setting/monthly-income-time-config',
      routeFile: 'app/portal/views/dashboard/finance/setting/monthly-income-time-config/list.vue',
      kind: '列表页(声明式 getDataListURL)',
      write: true,
      menuSource: 'app/portal/menus/finance.js',
      moduleType: null,
    })
  })

  it('管理员列表默认参数逐字段复现Portal，并投影页面字段', async () => {
    const f = setup([{ list: [{
      id: '9007199254740993',
      bizType: 1,
      lockDay: 25,
      remark: null,
      tenantId: '9007199254740994',
      ignored: '不应泄漏',
    }], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({
      list: [{ id: '9007199254740993', bizType: 1, lockDay: 25, remark: null, tenantId: '9007199254740994' }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/monthly-income-budget-edit-config/page',
      method: 'get',
      params: { order: '', orderField: '', tenantId: undefined, bizType: undefined, pageNo: 1, pageSize: 20 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'tenantId', 'bizType', 'pageNo', 'pageSize'])
  })

  it('管理员筛选、分页和异常参数按页面规则发送', async () => {
    const f = setup([{ list: [], total: 0 }])
    await f.api.list({ tenantId: '9007199254740994', bizType: 4, pageNo: 2, pageSize: 50 })
    expect(f.calls[0]?.params).toEqual({ order: '', orderField: '', tenantId: '9007199254740994', bizType: 4, pageNo: 2, pageSize: 50 })
    await expect(f.api.list({ tenantId: 0 })).rejects.toThrow('tenantId')
    await expect(f.api.list({ bizType: 5 as never })).rejects.toThrow('bizType')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    expect(f.calls).toHaveLength(1)
  })

  it('普通用户get按Portal补齐四项，保留业务类型并把null备注归一为空字符串', async () => {
    const f = setup([[{ bizType: 4, lockDay: 31, remark: '其他预测' }, { bizType: 1, lockDay: 25, remark: null }]])
    await expect(f.api.get()).resolves.toEqual([
      { bizType: 1, lockDay: 25, remark: '' },
      { bizType: 2, lockDay: null, remark: '' },
      { bizType: 3, lockDay: null, remark: '' },
      { bizType: 4, lockDay: 31, remark: '其他预测' },
    ])
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/monthly-income-budget-edit-config/get',
      method: 'get',
    })
    const malformed = setup([{ items: [{ bizType: 1, lockDay: 32, remark: '' }] }])
    await expect(malformed.api.get()).rejects.toThrow('lockDay')
  })

  it('update锁定四项表单、1-31截止日和Portal三字段载荷，输入顺序规范化', async () => {
    const f = setup([true])
    await expect(f.api.update({ items: [
      { bizType: 4, lockDay: 31, remark: null },
      { bizType: 2, lockDay: 20, remark: '预测' },
      { bizType: 1, lockDay: 25, remark: '' },
      { bizType: 3, lockDay: 10, remark: '资金' },
    ] })).resolves.toBe(true)
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/monthly-income-budget-edit-config/update',
      method: 'put',
      data: {
        items: [
          { bizType: 1, lockDay: 25, remark: '' },
          { bizType: 2, lockDay: 20, remark: '预测' },
          { bizType: 3, lockDay: 10, remark: '资金' },
          { bizType: 4, lockDay: 31, remark: '' },
        ],
      },
    })
    expect(Object.keys((f.calls[0]?.data as { items: object[] }).items[0]!)).toEqual(['bizType', 'lockDay', 'remark'])
    await expect(f.api.update({ items: [{ bizType: 1, lockDay: 1, remark: '' }] })).rejects.toThrow('业务类型1、2、3、4')
    await expect(f.api.update({ items: [
      { bizType: 1, lockDay: 0, remark: '' }, { bizType: 2, lockDay: 2, remark: '' },
      { bizType: 3, lockDay: 3, remark: '' }, { bizType: 4, lockDay: 4, remark: '' },
    ] })).rejects.toThrow('1至31')
    expect(f.calls).toHaveLength(1)
  })

  it('保存非true和网络错误保持失败语义，取消不伪造后端接口', async () => {
    const bad = setup([false])
    const items = { items: [
      { bizType: 1 as const, lockDay: 1, remark: '' }, { bizType: 2 as const, lockDay: 2, remark: '' },
      { bizType: 3 as const, lockDay: 3, remark: '' }, { bizType: 4 as const, lockDay: 4, remark: '' },
    ] }
    await expect(bad.api.update(items)).rejects.toThrow('不是true')
    const failed = setup([new Error('权限不足')])
    await expect(failed.api.update(items)).rejects.toThrow('权限不足')
    expect(failed.calls).toHaveLength(1)
  })
})

describe('月度收入时间配置请求上下文', () => {
  it('platform请求携带会话租户头，不发module-type，并保留GET防缓存请求', async () => {
    const { api, calls, http } = captureHttp()
    await api.list()
    await api.get()
    await api.update({ items: [
      { bizType: 1, lockDay: 1, remark: '' }, { bizType: 2, lockDay: 2, remark: '' },
      { bizType: 3, lockDay: 3, remark: '' }, { bizType: 4, lockDay: 4, remark: '' },
    ] })
    expect(calls).toHaveLength(3)
    for (const config of calls) {
      expect(config.headers.has('module-type')).toBe(false)
      expect(config.headers.get('tenant-id')).toBe('7')
      expect(config.headers.get('token')).toBe('fixture-token')
    }
    const listUri = http.getUri(calls[0]!).replace(/([?&]_t=)\d+/, '$1<ts>')
    expect(listUri).toContain('https://biz-api-test.wodecorp.cn/admin-api/finance/monthly-income-budget-edit-config/page?')
    expect(listUri).toContain('order=&orderField=&pageNo=1&pageSize=20')
    expect(listUri).not.toContain('module-type')
    expect(http.getUri(calls[1]!).replace(/([?&]_t=)\d+/, '$1<ts>')).toContain('/monthly-income-budget-edit-config/get?_t=<ts>')
    expect(calls[2]?.method).toBe('put')
    expect(String(calls[2]?.url)).toContain('/monthly-income-budget-edit-config/update')
  })
})

describe('月度收入时间配置AI契约与共享接线要求', () => {
  it('三项当前页面能力、公开方法与AI说明一一对应且结构有效', async () => {
    expect(Object.keys(contracts)).toEqual(financeSettingMonthlyIncomeTimeConfigCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'financeSettingMonthlyIncomeTimeConfig.list',
      'financeSettingMonthlyIncomeTimeConfig.get',
      'financeSettingMonthlyIncomeTimeConfig.update',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: financeSettingMonthlyIncomeTimeConfigCapabilities,
      contracts,
    })).toEqual([])
    expect(validateAiContracts(contracts, {
      profile: 'complete', definitions: financeSettingMonthlyIncomeTimeConfigCapabilities, contracts,
    }).map((issue: { code: string }) => issue.code)).toEqual(Array(3).fill('incomplete-evidence'))
  })

  it('契约锁定四类业务类型、嵌套截止日字段、更新载荷和保存后回查', () => {
    expect(contracts['finance-setting-monthly-income-time-config-get']?.output.fields.map(item => item.path)).toEqual([
      '$', '[]', '[].bizType', '[].lockDay', '[].remark',
    ])
    expect(contracts['finance-setting-monthly-income-time-config-update']?.inputs['items[].lockDay']?.constraints?.join('\n')).toContain('1至31')
    expect(contracts['finance-setting-monthly-income-time-config-update']?.steps[0]?.mapping).toEqual({})
    expect(contracts['finance-setting-monthly-income-time-config-update']?.steps.find(step => step.role === 'cancel')?.mapping).toEqual({ items: 'context.previousItems' })
    expect(contracts['finance-setting-monthly-income-time-config-update']?.gaps?.join('\n')).toContain('get→update→get')
    expect(contracts['finance-setting-monthly-income-time-config-get']?.boundaries.join('\n')).toContain('取消')
  })

  it('反证：错误的后续结果映射会被契约检查器拒绝，缺少lockDay字段也会被测试锁住', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    const broken = {
      ...contracts,
      'finance-setting-monthly-income-time-config-update': {
        ...contracts['finance-setting-monthly-income-time-config-update']!,
        steps: [{
          ...contracts['finance-setting-monthly-income-time-config-update']!.steps[0]!,
          mapping: { items: 'result.missing' },
        }],
      },
    }
    expect(validateAiContracts(broken, {
      definitions: financeSettingMonthlyIncomeTimeConfigCapabilities,
      contracts: broken,
    }).map((issue: { code: string }) => issue.code)).toContain('unknown-source-field')
    expect(contracts['finance-setting-monthly-income-time-config-get']?.output.fields.some(item => item.path === '[].lockDay')).toBe(true)
  })

  it('明确未完成真实浏览器/写入证据，不把静态推断伪装为实测', () => {
    for (const contract of Object.values(contracts)) {
      expect(contract.evidence.some(item => item.kind === 'browser')).toBe(false)
      expect(contract.evidence.some(item => item.kind === 'smoke')).toBe(false)
      expect(contract.gaps?.join('\n')).toContain('未启动浏览器')
      expect(contract.gaps?.join('\n')).toContain('真实环境')
    }
  })
})
