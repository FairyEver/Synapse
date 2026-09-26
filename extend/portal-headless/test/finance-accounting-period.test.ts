import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  buildFinanceAccountingPeriodMonths,
  createFinanceAccountingPeriodCapability,
  financeAccountingPeriodCapabilities,
  FINANCE_ACCOUNTING_PERIOD_METHODS,
  FINANCE_ACCOUNTING_PERIOD_PAGE_PATH,
} from '../src/capabilities/finance-accounting-period.js'
import {
  FINANCE_ACCOUNTING_PERIOD_AI_CONTRACTS as contracts,
  FINANCE_ACCOUNTING_PERIOD_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-accounting-period.js'

type RequestConfig = Parameters<PortalRequest>[0]
const NOW = new Date('2026-09-22T04:00:00.000Z')

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return {
    api: createFinanceAccountingPeriodCapability(request, { now: () => NOW }),
    calls,
  }
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
  const api = createFinanceAccountingPeriodCapability(
    config => call(FINANCE_ACCOUNTING_PERIOD_PAGE_PATH, config as PortalRequestConfig),
    { now: () => NOW },
  )
  return { api, calls, http }
}

describe('会计期间PC页面动作', () => {
  it('能力绑定页面权限、platform实例和不发送module-type', () => {
    expect(financeAccountingPeriodCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_ACCOUNTING_PERIOD_METHODS))
    expect(financeAccountingPeriodCapabilities.every(item => item.pagePath === FINANCE_ACCOUNTING_PERIOD_PAGE_PATH)).toBe(true)
    expect(financeAccountingPeriodCapabilities.every(item => item.permission === '/dashboard/finance/setting/accounting-period')).toBe(true)
    expect(financeAccountingPeriodCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeAccountingPeriodCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(financeAccountingPeriodCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-accounting-period-create',
      'finance-accounting-period-set-status',
    ])
  })

  it('逐页核对Portal按钮权限、表单payload、详情本地展开和Java DTO/回执', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/accounting-period.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/accounting-period/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/accounting-period/[mode]/[id].vue'), 'utf8')
    const detail = readFileSync(join(portalRoot, 'app/portal/views/dashboard/finance/setting/accounting-period/detail/[id].vue'), 'utf8')
    const javaDir = join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/accountingperiod')
    const controller = readFileSync(join(javaDir, 'AccountingPeriodController.java'), 'utf8')
    const pageReq = readFileSync(join(javaDir, 'vo/AccountingPeriodPageReqVO.java'), 'utf8')
    const saveReq = readFileSync(join(javaDir, 'vo/AccountingPeriodSaveReqVO.java'), 'utf8')
    const monthReq = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/accountingperiodmonth/vo/AccountingPeriodMonthSaveReqVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/service/accountingperiod/AccountingPeriodServiceImpl.java'), 'utf8')

    expect(menu).toContain("{ title: '会计期间', path: '/dashboard/finance/setting/accounting-period/list', permission: '/dashboard/finance/setting/accounting-period' }")
    expect(route).toContain('permission: /dashboard/finance/setting/accounting-period')
    expect(menu).toContain('export const financeListPermissionSwitch = true')
    expect(list).toContain("getDataListURL: '/admin-api/finance/accounting-period/page'")
    expect(list).toContain("create: 'finance:setting:accounting-period:create'")
    expect(list).toContain("status: 'finance:setting:accounting-period:status'")
    expect(list).toContain("detail: 'finance:setting:accounting-period:detail'")
    expect(list).toContain('v-if="userStore.state.username === \'admin\'"')
    expect(list).toContain('v-if="permissionCheck(permissions.create)"')
    expect(list).toContain('v-if="permissionCheck(permissions.status)"')
    expect(list).toContain('v-if="permissionCheck(permissions.detail)"')
    expect(list).toContain("http.get('/admin-api/finance/accounting-period/enableOrStop'")
    expect(list).not.toContain('query:')
    expect(list).not.toMatch(/actionEdit|actionDelete|exportURL|download|upload/i)
    expect(form).toContain("http.post('/admin-api/finance/accounting-period/create'")
    expect(form).toContain('accountingPeriodMonthList: dataSource.value.map(e => ({ month: e.month, startDate: e.start, endDate: e.end }))')
    expect(detail).toContain('bridgeGet(route.query.bridge)')
    expect(detail).toContain('for (let i = 1; i <= 12; i++)')

    expect(controller).toContain('@RequestMapping("/finance/accounting-period")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@GetMapping("/page")')
    expect(controller).toContain('@GetMapping("/enableOrStop")')
    expect(controller).toContain('return success(null)')
    expect(controller).toContain('@PutMapping("/update")')
    expect(controller).toContain('@GetMapping("/get")')
    expect(controller).toContain('@GetMapping("/export-excel")')
    expect(controller).not.toContain('@PreAuthorize')
    for (const field of ['year', 'status', 'tenantName']) expect(pageReq).toContain(`private ${field === 'year' || field === 'tenantName' ? 'String' : 'Integer'} ${field};`)
    for (const field of ['startDate', 'endDate', 'accountingPeriodMonthList']) expect(saveReq).toContain(`private ${field === 'accountingPeriodMonthList' ? 'List<AccountingPeriodMonthSaveReqVO>' : 'LocalDate'} ${field};`)
    expect(monthReq).toContain('private Boolean month;')
    expect(service).toContain('同一年内禁止创建多个有效的会计期间数据')
    expect(service).toContain('queryWrapper.like("status",0)')
  })

  it('默认查询逐字段复现浏览器请求，并只输出PC字段', async () => {
    const f = fixture([{ list: [{
      id: '9007199254740993',
      tenantName: null,
      orgName: '隐藏字段',
      year: 2026,
      startDate: '2026-02-03',
      endDate: '2026-12-20',
      status: 0,
      updateTime: '2026-09-22 10:20:30',
      createTime: '隐藏字段',
    }], total: 1 }])
    expect(await f.api.list()).toEqual({
      list: [{
        id: '9007199254740993',
        tenantName: null,
        year: 2026,
        startDate: '2026-02-03',
        endDate: '2026-12-20',
        status: 0,
        updateTime: '2026-09-22 10:20:30',
      }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accounting-period/page',
      method: 'get',
      params: {
        order: '', orderField: '', year: '', tenantName: null, status: 0, pageNo: 1, pageSize: 20,
      },
    })
  })

  it('真实请求层省略null企业名、不发module-type，URL与浏览器基准一致', async () => {
    const baseline = JSON.parse(readFileSync(new URL('../baseline/finance-accounting-period.browser.json', import.meta.url), 'utf8')) as {
      requests: Array<{ action: string; method: string; url: string }>
      absentHeaders: string[]
    }
    const { api, calls, http } = captureHttp()
    await api.list()
    const config = calls[0]!
    for (const header of baseline.absentHeaders) expect(config.headers.has(header)).toBe(false)
    expect(http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')).toBe(
      `https://biz-api-test.wodecorp.cn${baseline.requests[0]?.url}`,
    )
  })

  it('年度、企业、停用状态和分页筛选按页面字段发送', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list({ year: '2025', tenantName: '测试企业', status: 1, pageNo: 2, pageSize: 50 })
    expect(f.calls[0]?.params).toEqual({
      order: '', orderField: '', year: '2025', tenantName: '测试企业', status: 1, pageNo: 2, pageSize: 50,
    })
  })

  it('非法筛选和坏分页响应不会被改写成空列表', async () => {
    const f = fixture([{ list: null, total: 0 }])
    await expect(f.api.list({ year: '25' })).rejects.toThrow('YYYY')
    await expect(f.api.list({ status: 2 as 0 })).rejects.toThrow('0（启用）')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    expect(f.calls).toHaveLength(0)
    await expect(f.api.list()).rejects.toThrow('list或total')

    const badTenant = fixture([{ list: [{
      id: 1, tenantName: 7, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 0, updateTime: null,
    }], total: 1 }])
    await expect(badTenant.api.list()).rejects.toThrow('tenantName')
  })

  it('详情不发请求，固定生成12行并保留区间外空字符串', () => {
    const f = fixture()
    expect(f.api.detail({ startDate: '2026-02-03', endDate: '2026-04-20' })).toEqual({
      list: [
        { month: 1, start: '', end: '' },
        { month: 2, start: '2026-02-03', end: '2026-02-28' },
        { month: 3, start: '2026-03-01', end: '2026-03-31' },
        { month: 4, start: '2026-04-01', end: '2026-04-20' },
        { month: 5, start: '', end: '' },
        { month: 6, start: '', end: '' },
        { month: 7, start: '', end: '' },
        { month: 8, start: '', end: '' },
        { month: 9, start: '', end: '' },
        { month: 10, start: '', end: '' },
        { month: 11, start: '', end: '' },
        { month: 12, start: '', end: '' },
      ],
    })
    expect(f.calls).toHaveLength(0)
  })

  it('闰年月底与单日区间逐字按PC算法生成', () => {
    expect(buildFinanceAccountingPeriodMonths({ startDate: '2028-02-29', endDate: '2028-02-29' })[1]).toEqual({
      month: 2, start: '2028-02-29', end: '2028-02-29',
    })
    expect(buildFinanceAccountingPeriodMonths({ startDate: '2028-01-01', endDate: '2028-03-31' })[1]).toEqual({
      month: 2, start: '2028-02-01', end: '2028-02-29',
    })
  })

  it('prepareCreate按Asia/Shanghai当前年校验并生成真实POST载荷', () => {
    const f = fixture()
    const result = f.api.prepareCreate({ startDate: '2026-02-03', endDate: '2026-04-20' })
    expect(result.draft.accountingPeriodMonthList).toHaveLength(12)
    expect(result.draft.accountingPeriodMonthList.slice(0, 5)).toEqual([
      { month: 1, startDate: '', endDate: '' },
      { month: 2, startDate: '2026-02-03', endDate: '2026-02-28' },
      { month: 3, startDate: '2026-03-01', endDate: '2026-03-31' },
      { month: 4, startDate: '2026-04-01', endDate: '2026-04-20' },
      { month: 5, startDate: '', endDate: '' },
    ])
    expect(() => f.api.prepareCreate({ startDate: '2025-01-01', endDate: '2025-12-31' })).toThrow('当前年度')
    expect(() => f.api.prepareCreate({ startDate: '2026-01-01', endDate: '2027-01-01' })).toThrow('同一年')
    expect(() => f.api.prepareCreate({ startDate: '2026-04-02', endDate: '2026-04-01' })).toThrow('不能早于')
    expect(() => f.api.prepareCreate({ startDate: '2026-02-30', endDate: '2026-12-31' })).toThrow('有效日期')
    expect(f.calls).toHaveLength(0)
  })

  it('当前年边界按Asia/Shanghai计算，不依赖进程本地时区', () => {
    const boundary = createFinanceAccountingPeriodCapability(async () => undefined as never, {
      now: () => new Date('2026-12-31T16:30:00.000Z'),
    })
    expect(() => boundary.prepareCreate({ startDate: '2026-12-31', endDate: '2026-12-31' })).toThrow('当前年度')
    expect(() => boundary.prepareCreate({ startDate: '2027-01-01', endDate: '2027-12-31' })).not.toThrow()
  })

  it('create发送两日期加12项，返回根ID；不接受过去年度', async () => {
    const f = fixture(['9007199254740993'])
    expect(await f.api.create({ startDate: '2026-02-03', endDate: '2026-04-20' })).toBe('9007199254740993')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accounting-period/create',
      method: 'post',
      data: {
        startDate: '2026-02-03',
        endDate: '2026-04-20',
        accountingPeriodMonthList: [
          { month: 1, startDate: '', endDate: '' },
          { month: 2, startDate: '2026-02-03', endDate: '2026-02-28' },
          { month: 3, startDate: '2026-03-01', endDate: '2026-03-31' },
          { month: 4, startDate: '2026-04-01', endDate: '2026-04-20' },
          { month: 5, startDate: '', endDate: '' },
          { month: 6, startDate: '', endDate: '' },
          { month: 7, startDate: '', endDate: '' },
          { month: 8, startDate: '', endDate: '' },
          { month: 9, startDate: '', endDate: '' },
          { month: 10, startDate: '', endDate: '' },
          { month: 11, startDate: '', endDate: '' },
          { month: 12, startDate: '', endDate: '' },
        ],
      },
    })
    await expect(f.api.create({ startDate: '2025-01-01', endDate: '2025-12-31' })).rejects.toThrow('当前年度')
    expect(f.calls).toHaveLength(1)
  })

  it('setStatus发送绝对目标状态GET，0不会被当成空值', async () => {
    const f = fixture([null, null])
    await expect(f.api.setStatus({ id: '9007199254740993', status: 1 })).resolves.toBeNull()
    await expect(f.api.setStatus({ id: 7, status: 0 })).resolves.toBeNull()
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/accounting-period/enableOrStop', method: 'get', params: { id: '9007199254740993', status: 1 } },
      { url: '/admin-api/finance/accounting-period/enableOrStop', method: 'get', params: { id: 7, status: 0 } },
    ])
    await expect(f.api.setStatus({ id: 7, status: true as unknown as 0 })).rejects.toThrow('0（启用）')
    expect(f.calls).toHaveLength(2)
  })

  it('启停严格接受Java success(null)回执，非法ID和非0/1状态不发请求', async () => {
    const badResponse = fixture([true])
    await expect(badResponse.api.setStatus({ id: 7, status: 1 })).rejects.toThrow('必须为null')
    expect(badResponse.calls).toHaveLength(1)

    const invalid = fixture()
    await expect(invalid.api.setStatus({ id: 0, status: 1 })).rejects.toThrow('安全正整数')
    await expect(invalid.api.setStatus({ id: '01', status: 1 })).rejects.toThrow('安全正整数')
    await expect(invalid.api.setStatus({ id: 7, status: 2 as 0 })).rejects.toThrow('0（启用）')
    expect(invalid.calls).toHaveLength(0)
  })

  it('后端错误原样抛出，不伪造成业务结果', async () => {
    const f = fixture([new Error('同一年内禁止创建多个有效的会计期间数据')])
    await expect(f.api.create({ startDate: '2026-01-01', endDate: '2026-12-31' })).rejects.toThrow('禁止创建')
  })
})

describe('会计期间AI契约与共享接线要求', () => {
  it('5项能力、公开方法映射和AI结构一一对应', async () => {
    expect(financeAccountingPeriodCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_ACCOUNTING_PERIOD_METHODS))
    expect(Object.keys(contracts)).toEqual(financeAccountingPeriodCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'financeAccountingPeriod.list',
      'financeAccountingPeriod.detail',
      'financeAccountingPeriod.prepareCreate',
      'financeAccountingPeriod.createIdempotent',
      'financeAccountingPeriod.setStatus',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: financeAccountingPeriodCapabilities,
      contracts,
    })).toEqual([])
    expect(validateAiContracts(contracts, {
      profile: 'complete', definitions: financeAccountingPeriodCapabilities, contracts,
    }).map((issue: { code: string }) => issue.code)).toEqual(Array(5).fill('incomplete-evidence'))
  })

  it('锁定详情本地边界、状态绝对值、创建防重与关键动作映射', () => {
    const list = contracts['finance-accounting-period-list']!
    expect(list.boundaries.join('\n')).toContain('不发送该头')
    expect(list.output.fields.find(item => item.path === 'list[].status')?.values).toEqual({ '0': '启用', '1': '停用' })
    expect(list.steps.find(step => step.capabilityId === 'finance-accounting-period-detail')?.mapping).toEqual({
      startDate: 'result.list[].startDate', endDate: 'result.list[].endDate',
    })
    const detail = contracts['finance-accounting-period-detail']!
    expect(detail.effect).toBe('local')
    expect(detail.output.fields.find(item => item.path === 'list')?.constraints).toContain('始终12行；区间外月份仍保留空日期行')
    const create = contracts['finance-accounting-period-create']!
    expect(create.inputs.requestId?.required).toBe(true)
    expect(create.idempotency).toContain('进程内短窗口防重')
    expect(create.steps[0]?.capabilityId).toBe('finance-accounting-period-list')
    expect(create.steps[0]?.mapping).toEqual({ status: 'literal:0' })
    const setStatus = contracts['finance-accounting-period-set-status']!
    expect(setStatus.output.shape).toBe('null')
    expect(setStatus.steps[0]?.mapping).toEqual({ status: 'args.status' })
    expect(setStatus.steps[1]?.mapping).toEqual({ id: 'args.id', status: 'context.previousStatus' })
  })

  it('明确公开当前PC没有编辑、删除和导出，真实写验证缺口保持可见', () => {
    for (const contract of Object.values(contracts)) {
      expect(contract.boundaries.join('\n')).toContain('页面没有编辑、删除、导入导出')
      expect(contract.gaps?.join('\n')).toContain('不能清理自建记录')
      expect(contract.evidence.some(item => item.kind === 'browser')).toBe(true)
    }
  })
})
