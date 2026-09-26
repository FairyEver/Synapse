import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingAnnualCarryforwardCapability,
  financeSettingAnnualCarryforwardCapabilities,
  FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS,
  FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH,
} from '../src/capabilities/finance-setting-annual-carryforward.js'

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
    api: createFinanceSettingAnnualCarryforwardCapability(request, { now: () => NOW }),
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
    const isList = String(config.url).includes('/annual-closing/page')
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: isList ? { list: [], total: 0 } : true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceSettingAnnualCarryforwardCapability(
    config => call(FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH, config as PortalRequestConfig),
    { now: () => NOW },
  )
  return { api, calls, http }
}

describe('年度账结转页面动作', () => {
  it('核对generated目录元数据与页面能力范围', () => {
    const catalog = JSON.parse(readFileSync(new URL('../generated/page-catalog.json', import.meta.url), 'utf8')) as {
      items: Array<Record<string, unknown>>
    }
    const page = catalog.items.find(item => item.menuPath === FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH)
    expect(page).toMatchObject({
      id: '6430a9',
      title: '年度账结转',
      permission: '/dashboard/finance/setting/annual-carryforward',
      routeFile: 'app/portal/views/dashboard/finance/setting/annual-carryforward/list.vue',
      kind: '列表页(声明式 getDataListURL)',
      write: true,
      menuSource: 'app/portal/menus/finance.js',
      moduleType: null,
    })
    expect(financeSettingAnnualCarryforwardCapabilities.map(item => item.id)).toEqual([
      'finance-setting-annual-carryforward-list',
      'finance-setting-annual-carryforward-prepare-transfer',
      'finance-setting-annual-carryforward-transfer',
      'finance-setting-annual-carryforward-cancel-transfer',
      'finance-setting-annual-carryforward-opening-balance',
      'finance-setting-annual-carryforward-opening-balance-detail',
      'finance-setting-annual-carryforward-trial-balance',
      'finance-setting-annual-carryforward-reconcile',
    ])
    expect(financeSettingAnnualCarryforwardCapabilities.every(item => item.pagePath === FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH)).toBe(true)
    expect(financeSettingAnnualCarryforwardCapabilities.every(item => item.httpInstance === 'platform' && item.moduleType === null)).toBe(true)
  })

  it('锁定详情页对账入口与固定Java检出状态：页面绑了按钮，后端没有这条路由', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const detail = readFileSync(`${portal}/app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/index.vue`, 'utf8')
    const controller = readFileSync(`${java}/erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/annualclosing/AnnualClosingController.java`, 'utf8')
    expect(detail).toContain("http.post('/admin-api/finance/annual-closing/reconcile'")
    expect(detail).toContain('accountingSetId: data.id')
    expect(detail).toContain('periodYear: data.periodYear')
    expect(controller).not.toContain('@PostMapping("/reconcile")')
    // ⚠️ 这一条在 2026-09-26 的补缺口轮次里**反向**了：上一轮按“不可交付能力不暴露”
    //    把详情页四个动作整组排除，本轮按派单要求把页面实际绑定的对账按钮也交付出来，
    //    并把“后端未核到路由”写进 gaps。能力存在 ≠ 后端可用：下面同时钉住这两个事实。
    expect('reconcile' in fixture().api).toBe(true)
  })

  it('默认查询逐字段复现Portal列表请求，投影隐藏字段并保留两个不同ID', async () => {
    const f = fixture([{ list: [{
      id: '9007199254740993',
      accountingSetId: '9007199254740994',
      tenantName: null,
      accountingName: '账套A',
      accountCode: 'AC-001',
      periodYear: '2026',
      closingStatus: 0,
      closingTime: null,
      closingByName: null,
      ignored: '不应泄漏',
    }], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({
      list: [{
        id: '9007199254740993',
        accountingSetId: '9007199254740994',
        tenantName: null,
        accountingName: '账套A',
        accountCode: 'AC-001',
        periodYear: '2026',
        closingStatus: 0,
        closingTime: null,
        closingByName: null,
      }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/annual-closing/page',
      method: 'get',
      params: {
        order: '', orderField: '', accountingSetIds: [], periodYear: '2026', closingStatus: undefined, pageNo: 1, pageSize: 20,
      },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual([
      'order', 'orderField', 'accountingSetIds', 'periodYear', 'closingStatus', 'pageNo', 'pageSize',
    ])
  })

  it('账套、年份、状态和分页筛选按Portal键序发送', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list({ accountingSetIds: ['7', 8], periodYear: '2025', closingStatus: 1, pageNo: 2, pageSize: 50 })
    expect(f.calls[0]?.params).toEqual({
      order: '', orderField: '', accountingSetIds: ['7', 8], periodYear: '2025', closingStatus: 1, pageNo: 2, pageSize: 50,
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual([
      'order', 'orderField', 'accountingSetIds', 'periodYear', 'closingStatus', 'pageNo', 'pageSize',
    ])
  })

  it('列表坏数据、坏筛选和坏分页不会被改写成空列表', async () => {
    const f = fixture([{ list: null, total: 0 }])
    await expect(f.api.list({ periodYear: '26' })).rejects.toThrow('YYYY')
    await expect(f.api.list({ closingStatus: 2 as 0 })).rejects.toThrow('0（未结转）或1（已结转）')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    expect(f.calls).toHaveLength(0)
    await expect(f.api.list()).rejects.toThrow('list或total')

    const badRow = fixture([{ list: [{
      id: 1,
      accountingSetId: 2,
      tenantName: 7,
      accountingName: null,
      accountCode: null,
      periodYear: '2026',
      closingStatus: 0,
      closingTime: null,
      closingByName: null,
    }], total: 1 }])
    await expect(badRow.api.list()).rejects.toThrow('tenantName')
  })

  it('prepareTransfer按Portal弹窗显示上年到目标年，且不发请求', () => {
    const f = fixture()
    expect(f.api.prepareTransfer({ accountingSetIds: ['9007199254740994'], periodYear: '2026' })).toEqual({
      draft: { periodYear: 2026, accountingSetIds: ['9007199254740994'] },
      fromYear: 2025,
      toYear: 2026,
    })
    expect(f.calls).toHaveLength(0)
    expect(() => f.api.prepareTransfer({ accountingSetIds: [], periodYear: '2026' })).toThrow('不能为空')
    expect(() => f.api.prepareTransfer({ accountingSetIds: ['1', '1'], periodYear: 2026 })).toThrow('重复')
  })

  it('结转与取消结转使用后端真实载荷，取消结转必须显式年份', async () => {
    const f = fixture([true, true])
    await expect(f.api.transfer({ accountingSetIds: ['9007199254740994'], periodYear: '2026' })).resolves.toBe(true)
    await expect(f.api.cancelTransfer({ accountingSetIds: ['9007199254740994'], periodYear: 2026 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      {
        url: '/admin-api/finance/annual-closing/close', method: 'post',
        data: { periodYear: 2026, accountingSetIds: ['9007199254740994'] },
      },
      {
        url: '/admin-api/finance/annual-closing/cancel-close', method: 'post',
        data: { periodYear: 2026, accountingSetIds: ['9007199254740994'] },
      },
    ])
    await expect(f.api.cancelTransfer({ accountingSetIds: ['1'], periodYear: undefined as never })).rejects.toThrow('必须提供periodYear')
    expect(f.calls).toHaveLength(2)
  })

  it('写响应不是true或后端错误时保持失败语义', async () => {
    const badResponse = fixture([false])
    await expect(badResponse.api.transfer({ accountingSetIds: ['1'], periodYear: '2026' })).rejects.toThrow('不是true')
    const backendError = fixture([new Error('已发生业务，不允许取消结转')])
    await expect(backendError.api.cancelTransfer({ accountingSetIds: ['1'], periodYear: '2026' })).rejects.toThrow('不允许取消')
  })

  it('真实HTTP层使用platform前缀和会话头，且不发module-type', async () => {
    const { api, calls, http } = captureHttp()
    await api.list()
    const config = calls[0]!
    expect(config.headers.has('module-type')).toBe(false)
    expect(config.headers.get('tenant-id')).toBe('7')
    expect(config.headers.get('token')).toBe('fixture-token')
    const uri = http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')
    expect(uri).toContain('https://biz-api-test.wodecorp.cn/admin-api/finance/annual-closing/page?')
    expect(uri).toContain('order=')
    expect(uri).toContain('orderField=')
    expect(uri).toContain('periodYear=2026')
    expect(uri).toContain('pageNo=1')
    expect(uri).toContain('pageSize=20')
    expect(uri).not.toContain('module-type')
  })
})

describe('嵌套详情页（期初余额）四个动作', () => {
  const balanceRow = {
    subjectId: '9007199254740993',
    subjectCode: 1001,
    subjectName: '库存现金',
    balanceDirection: 1,
    openingBalance: 1234.56,
    ancillaryAccounting: 'supplierCode,customerCode',
    detailType: 'SUPPLIER',
    detailApi: '/finance/annual-closing/supplier-balance/detail',
    detailParams: { supplierId: 1 },
    detailEnabled: true,
    detailLabel: '供应商余额明细',
    ignored: '不应泄漏',
  }
  const trialItem = (subjectType: number | null, name: string, amount: number, direction: number) =>
    ({ subjectType, subjectTypeName: name, balanceAmount: amount, balanceDirection: direction })

  it('期初余额按页面原样全量取：pageNo=1、pageSize=-1，参数键序与页面一致', async () => {
    const f = fixture([{ list: [balanceRow], total: 1 }])
    await expect(f.api.listOpeningBalance({ accountingSetId: '9007199254740994', periodYear: '2026' })).resolves.toEqual({
      list: [{
        subjectId: '9007199254740993',
        subjectCode: 1001,
        subjectName: '库存现金',
        balanceDirection: 1,
        openingBalance: 1234.56,
        ancillaryAccounting: 'supplierCode,customerCode',
        detailType: 'SUPPLIER',
        detailApi: '/finance/annual-closing/supplier-balance/detail',
        detailParams: { supplierId: 1 },
        detailEnabled: true,
        detailLabel: '供应商余额明细',
      }],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/annual-closing/opening-balance/page',
      method: 'get',
      params: { accountingSetId: '9007199254740994', periodYear: '2026', subjectCode: undefined, pageNo: 1, pageSize: -1 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual([
      'accountingSetId', 'periodYear', 'subjectCode', 'pageNo', 'pageSize',
    ])
  })

  it('科目筛选沿用页面的 subjectCode 参数名（页面传的是科目ID，SDK 不做 id→code 换算）', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.listOpeningBalance({ accountingSetId: 5, periodYear: '2026', subjectCode: 77 })
    expect(f.calls[0]?.params).toEqual({
      accountingSetId: 5, periodYear: '2026', subjectCode: 77, pageNo: 1, pageSize: -1,
    })
    // 页面就是这么写的：property key 是 subjectCode，值来自科目选择器的 id
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const page = readFileSync(`${portal}/app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/index.vue`, 'utf8')
    expect(page).toContain('subjectCode: form.subjectId || undefined')
    expect(page).toContain('pageSize: -1')
  })

  it('期初余额明细只发四个字段且必须是数组；空数组是合法结果', async () => {
    const f = fixture([[{ ancillaryCode: 'S001', ancillaryName: '供应商A', balanceDirection: 1, balance: 100 }], []])
    await expect(f.api.getOpeningBalanceDetail({
      accountingSetId: 5, periodYear: '2026', subjectId: '9007199254740993', ancillaryField: 'supplierCode',
    })).resolves.toEqual([{ ancillaryCode: 'S001', ancillaryName: '供应商A', balanceDirection: 1, balance: 100 }])
    await expect(f.api.getOpeningBalanceDetail({
      accountingSetId: 5, periodYear: '2026', subjectId: 6, ancillaryField: 'supplierCode',
    })).resolves.toEqual([])
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/annual-closing/opening-balance/detail',
      method: 'get',
      params: { accountingSetId: 5, periodYear: '2026', subjectId: '9007199254740993', ancillaryField: 'supplierCode' },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual([
      'accountingSetId', 'periodYear', 'subjectId', 'ancillaryField',
    ])
  })

  it('试算平衡把 periodYear 拼成 YYYY-12，投影五类与两侧合计并保留 isBalanced', async () => {
    const f = fixture([{
      asset: trialItem(1, '资产', 50000, 1),
      liability: trialItem(2, '负债', 20000, 2),
      equity: trialItem(3, '权益', 20000, 2),
      cost: trialItem(4, '成本', 0, 3),
      profitLoss: trialItem(5, '损益', -10000, 2),
      assetCostTotal: trialItem(null, '资产+成本合计', 50000, 1),
      equityLiabilityProfitLossTotal: trialItem(null, '权益+负债+损益合计', 50000, 2),
      isBalanced: true,
    }])
    const result = await f.api.getTrialBalance({ accountingSetId: 5, periodYear: '2026' })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/annual-closing/trial-balance',
      method: 'get',
      params: { accountingSetId: 5, period: '2026-12' },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['accountingSetId', 'period'])
    expect(result.isBalanced).toBe(true)
    expect(result.assetCostTotal).toEqual({ subjectType: null, subjectTypeName: '资产+成本合计', balanceAmount: 50000, balanceDirection: 1 })
    expect(result.asset.balanceDirection).toBe(1)
    expect(result.cost.balanceDirection).toBe(3)
    // 页面自己拼的就是这一条：`const period = `${data.periodYear}-12``
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const page = readFileSync(`${portal}/app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/index.vue`, 'utf8')
    expect(page).toContain('const period = `${data.periodYear}-12`')
  })

  it('对账按页面 POST body 提交，成功时返回 undefined（页面不读响应体）', async () => {
    const f = fixture([null])
    await expect(f.api.reconcile({ accountingSetId: 5, periodYear: '2026' })).resolves.toBeUndefined()
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/annual-closing/reconcile',
      method: 'post',
      data: { accountingSetId: 5, periodYear: '2026' },
    })
    const backendError = fixture([new Error('Request failed with status code 404')])
    await expect(backendError.api.reconcile({ accountingSetId: 5, periodYear: '2026' })).rejects.toThrow('404')
  })

  it('四个动作的坏输入与坏响应不会被改写成空数据', async () => {
    const f = fixture([[null], { asset: {}, isBalanced: 'yes' }])
    await expect(f.api.listOpeningBalance({ accountingSetId: 0, periodYear: '2026' })).rejects.toThrow('accountingSetId')
    await expect(f.api.listOpeningBalance({ accountingSetId: 5, periodYear: '26' })).rejects.toThrow('YYYY')
    await expect(f.api.getOpeningBalanceDetail({ accountingSetId: 5, periodYear: '2026', subjectId: 6, ancillaryField: '  ' })).rejects.toThrow('ancillaryField')
    await expect(f.api.getOpeningBalanceDetail({ accountingSetId: 5, periodYear: '2026', subjectId: 6, ancillaryField: 'supplierCode' })).rejects.toThrow('明细行')
    await expect(f.api.getTrialBalance({ accountingSetId: 5, periodYear: '2026' })).rejects.toThrow('isBalanced')
    // 前三条在发请求前就被本地校验拦下，只有最后一条真的发了请求
    expect(f.calls).toHaveLength(2)
    const badPage = fixture([{ list: [{ ...balanceRow, balanceDirection: 9 }], total: 1 }])
    await expect(badPage.api.listOpeningBalance({ accountingSetId: 5, periodYear: '2026' })).rejects.toThrow('balanceDirection')
    const badPage2 = fixture([{ list: [], total: -1 }])
    await expect(badPage2.api.listOpeningBalance({ accountingSetId: 5, periodYear: '2026' })).rejects.toThrow('list或total')
    const badDetail = fixture([{ notAnArray: true }])
    await expect(badDetail.api.getOpeningBalanceDetail({ accountingSetId: 5, periodYear: '2026', subjectId: 6, ancillaryField: 'supplierCode' })).rejects.toThrow('必须是数组')
  })

  it('四个动作都归属同一个页面路径与权限上下文，写标记只给对账', () => {
    const detail = financeSettingAnnualCarryforwardCapabilities.filter(item => /opening-balance|trial-balance|reconcile/.test(item.id))
    expect(detail.map(item => item.id)).toEqual([
      'finance-setting-annual-carryforward-opening-balance',
      'finance-setting-annual-carryforward-opening-balance-detail',
      'finance-setting-annual-carryforward-trial-balance',
      'finance-setting-annual-carryforward-reconcile',
    ])
    expect(detail.every(item => item.pagePath === FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH)).toBe(true)
    expect(detail.every(item => item.permission === '/dashboard/finance/setting/annual-carryforward')).toBe(true)
    expect(detail.map(item => item.write)).toEqual([false, false, false, true])
    // 嵌套页与列表页是同一个 permission（route 块里写的就是这一个）
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const subjectDetail = readFileSync(`${portal}/app/portal/views/dashboard/finance/setting/annual-carryforward/detail/balance/subject-detail/index.vue`, 'utf8')
    expect(subjectDetail).toContain('permission: /dashboard/finance/setting/annual-carryforward')
  })
})

describe('年度账结转AI契约与共享接线要求', () => {
  it('4项可交付能力、公开方法映射和AI结构一一对应', async () => {
    const {
      FINANCE_SETTING_ANNUAL_CARRYFORWARD_AI_CONTRACTS: contracts,
      FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHOD_CONTRACTS: methodContracts,
    } = await import('../src/catalog/contracts-finance-setting-annual-carryforward.js')
    const activeIds = financeSettingAnnualCarryforwardCapabilities.map(item => item.id)
    const activeContracts = Object.fromEntries(activeIds.map(id => [id, contracts[id]!]))
    expect(activeIds.every(id => contracts[id] !== undefined)).toBe(true)
    expect(Object.keys(methodContracts)).toEqual([
      'financeSettingAnnualCarryforward.list',
      'financeSettingAnnualCarryforward.prepareTransfer',
      'financeSettingAnnualCarryforward.transfer',
      'financeSettingAnnualCarryforward.cancelTransfer',
      'financeSettingAnnualCarryforward.listOpeningBalance',
      'financeSettingAnnualCarryforward.getOpeningBalanceDetail',
      'financeSettingAnnualCarryforward.getTrialBalance',
      'financeSettingAnnualCarryforward.reconcile',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(activeContracts, {
      definitions: financeSettingAnnualCarryforwardCapabilities,
      contracts: activeContracts,
    })).toEqual([])
    expect(validateAiContracts(activeContracts, {
      profile: 'complete', definitions: financeSettingAnnualCarryforwardCapabilities, contracts: activeContracts,
    }).map((issue: { code: string }) => issue.code)).toEqual(Array(financeSettingAnnualCarryforwardCapabilities.length).fill('incomplete-evidence'))
  })

  it('锁定Portal单条载荷的记录ID映射、后端账套字段与写后回查', async () => {
    const { FINANCE_SETTING_ANNUAL_CARRYFORWARD_AI_CONTRACTS: contracts } = await import('../src/catalog/contracts-finance-setting-annual-carryforward.js')
    const list = contracts['finance-setting-annual-carryforward-list']!
    expect(list.boundaries.join('\n')).toContain('不发送module-type')
    expect(list.output.fields.find(item => item.path === 'list[].id')?.meaning).toContain('Portal单条按钮')
    expect(list.output.fields.find(item => item.path === 'list[].accountingSetId')?.meaning).toContain('后端响应')
    expect(list.steps.find(step => step.capabilityId === 'finance-setting-annual-carryforward-prepare-transfer')?.mapping).toEqual({
      accountingSetIds: 'result.list[].id', periodYear: 'result.list[].periodYear',
    })
    const transfer = contracts['finance-setting-annual-carryforward-transfer']!
    expect(transfer.steps.find(step => step.capabilityId === 'finance-setting-annual-carryforward-list')?.mapping).toEqual({
      accountingSetIds: 'args.accountingSetIds', periodYear: 'args.periodYear', closingStatus: 'literal:1',
    })
    expect(transfer.gaps?.join('\n')).toContain('未启动浏览器')
    expect(transfer.gaps?.join('\n')).toContain('accountingSetIds')

    const openingBalance = contracts['finance-setting-annual-carryforward-opening-balance']!
    expect(openingBalance.effect).toBe('read')
    expect(openingBalance.inputs.accountingSetId?.meaning).toContain('不是结转记录行 id')
    expect(openingBalance.output.fields.find(item => item.path === 'list[].subjectId')?.meaning).toContain('不是科目编码')
    expect(openingBalance.inputs.subjectCode?.source).toContain('valueType=id')
    expect(openingBalance.output.empty).toContain('closingStatus=1')
    expect(openingBalance.steps.find(step => step.capabilityId === 'finance-setting-annual-carryforward-opening-balance-detail')?.mapping).toEqual({
      accountingSetId: 'args.accountingSetId', periodYear: 'args.periodYear', subjectId: 'result.list[].subjectId', ancillaryField: 'result.list[].ancillaryAccounting',
    })

    const detail = contracts['finance-setting-annual-carryforward-opening-balance-detail']!
    expect(detail.inputs.subjectId?.meaning).toContain('不是 subjectCode')
    expect(detail.inputs.ancillaryField?.source).toContain('ancillaryAccounting')
    expect(detail.output.empty).toContain('未结转')

    const trial = contracts['finance-setting-annual-carryforward-trial-balance']!
    expect(trial.inputs.periodYear?.meaning).toContain('-12')
    expect(trial.output.fields.find(item => item.path === 'isBalanced')?.meaning).toContain('互为相反数')
    expect(trial.output.fields.find(item => item.path === 'asset.balanceDirection')?.values?.['3']).toBe('平')
    expect(trial.gaps?.join('\n')).toContain('真实环境')

    const reconcile = contracts['finance-setting-annual-carryforward-reconcile']!
    expect(reconcile.effect).toBe('write')
    expect(reconcile.output.shape).toBe('undefined')
    expect(reconcile.boundaries.join('\n')).toContain('对账')
    expect(reconcile.boundaries.join('\n')).toContain('没有对应映射')
    expect(reconcile.gaps?.join('\n')).toContain('两个检出里都核不到对应路由')
    expect(reconcile.steps.some(step => step.role === 'recovery')).toBe(true)

    const broken = {
      ...contracts,
      'finance-setting-annual-carryforward-list': {
        ...list,
        output: {
          ...list.output,
        fields: list.output.fields.filter(item => item.path !== 'list[].id'),
        },
      },
    }
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(broken, {
      definitions: financeSettingAnnualCarryforwardCapabilities,
      contracts: broken,
    }).map((issue: { code: string }) => issue.code)).toContain('unknown-source-field')
  })

  it('明确未完成真实浏览器/写入证据，不把静态推断伪装为实测', () => {
    return import('../src/catalog/contracts-finance-setting-annual-carryforward.js').then(({ FINANCE_SETTING_ANNUAL_CARRYFORWARD_AI_CONTRACTS: contracts }) => {
    for (const contract of Object.values(contracts)) {
      expect(contract.evidence.some(item => item.kind === 'browser')).toBe(false)
      expect(contract.evidence.some(item => item.kind === 'smoke')).toBe(false)
      expect(contract.gaps?.join('\n')).toContain('未启动浏览器')
      expect(contract.gaps?.join('\n')).toContain('真实环境')
    }
    })
  })
})
