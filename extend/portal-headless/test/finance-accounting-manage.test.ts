import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import type { AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceAccountingManageCapability,
  financeAccountingManageCapabilities,
  FINANCE_ACCOUNTING_MANAGE_METHODS,
  FINANCE_ACCOUNTING_MANAGE_PAGE_PATH,
} from '../src/capabilities/finance-accounting-manage.js'
import {
  FINANCE_ACCOUNTING_MANAGE_AI_CONTRACTS as contracts,
  FINANCE_ACCOUNTING_MANAGE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-accounting-manage.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture(responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceAccountingManageCapability(request), calls }
}

const row = {
  id: '9007199254740993',
  accountingName: '测试账套',
  accountCode: '0042',
  currencyType: 0,
  corporationId: 71,
  corporationName: '测试法人',
  accountingStandardsApply: 1,
  natureId: 8,
  natureName: '企业会计',
  isLongTerm: 0,
  startTime: '2026-01-01',
  endTime: '2026-12-31',
  periodId: 16,
  periodYear: '2026',
  accuracyId: 29,
  accuracyName: '默认精度',
  accuracyCurrencyType: 0,
  accuracyDecimalQuantity: 2,
  accuracyDecimalUnitPrice: 4,
  accuracyDecimalAmount: 2,
  industry: null,
  creditCode: 'TEST-CREDIT',
  taxCode: null,
  businessAddress: null,
  contacts: '测试联系人',
  contactPhone: '13800000000',
  valueAddedUserId: null,
  valueAddedUserName: null,
  status: 0,
  isEnable: null,
  createTime: '2026-09-22 10:20:30',
  tenantName: '页面不用',
  organizationId: '历史字段',
}

const draft = {
  accountingName: 'SDK测试账套',
  accountCode: '0043',
  corporationId: 71,
  accountingStandardsApply: 1,
  isLongTerm: 0 as const,
  startTime: '2026-01-01',
  endTime: '2026-12-31',
  periodId: 16,
  accuracyId: 29,
  industry: '测试行业',
  creditCode: 'TEST-CREDIT-2',
  contacts: '测试联系人',
  contactPhone: '13800000000',
}

describe('账套管理PC页面动作', () => {
  it('默认分页逐字段对齐浏览器基准，无module-type由页面上下文决定', async () => {
    const baseline = JSON.parse(readFileSync(new URL('../baseline/finance-accounting-manage.browser.json', import.meta.url), 'utf8')) as {
      requests: Array<{ action: string; method: string; url: string }>
    }
    const f = fixture([{ list: [], total: 0 }])
    await expect(f.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accounting-manage/page',
      method: 'get',
      params: {
        order: '', orderField: '', corporationId: null, accountCode: '', accountingName: '',
        accountingStandardsApply: '', periodYear: '', status: 0, pageNo: 1, pageSize: 20,
      },
    })
    expect(baseline.requests.find(item => item.action === 'list-default')?.url).not.toContain('corporationId=')
    expect(financeAccountingManageCapabilities.every(item => item.moduleType === undefined)).toBe(true)
    expect(financeAccountingManageCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
  })

  it('列表只投影PC详情与动作所需字段并保留长ID和空值', async () => {
    const f = fixture([{ list: [row, { ...row, id: 2, corporationId: null, corporationName: null }], total: 2 }])
    const result = await f.api.list({
      corporationId: '71', accountCode: '0042', accountingName: '测试', accountingStandardsApply: 1,
      periodYear: '2026', status: 0, pageNo: 2, pageSize: 50,
    })
    expect(result.total).toBe(2)
    expect(result.list[0]).toEqual({
      id: '9007199254740993', accountingName: '测试账套', accountCode: '0042', currencyType: 0,
      corporationId: 71, corporationName: '测试法人', accountingStandardsApply: 1,
      natureId: 8, natureName: '企业会计', isLongTerm: 0, startTime: '2026-01-01', endTime: '2026-12-31',
      periodId: 16, periodYear: '2026', accuracyId: 29, accuracyName: '默认精度', accuracyCurrencyType: 0,
      accuracyDecimalQuantity: 2, accuracyDecimalUnitPrice: 4, accuracyDecimalAmount: 2,
      industry: null, creditCode: 'TEST-CREDIT', taxCode: null, businessAddress: null,
      contacts: '测试联系人', contactPhone: '13800000000', valueAddedUserId: null, valueAddedUserName: null,
      status: 0, isEnable: null, createTime: '2026-09-22 10:20:30',
    })
    expect(result.list[0]).not.toHaveProperty('tenantName')
    expect(result.list[1]?.corporationId).toBeNull()
    expect(result.list[1]?.corporationName).toBeNull()
    expect(f.calls[0]?.params).toMatchObject({ corporationId: '71', accountCode: '0042', periodYear: '2026', pageNo: 2, pageSize: 50 })
  })

  it('详情是列表行的本地投影，不额外请求后端', () => {
    const f = fixture()
    const projected = f.api.detail({ row: row as never })
    expect(projected.id).toBe('9007199254740993')
    expect(projected.accuracyDecimalUnitPrice).toBe(4)
    expect(projected.natureName).toBe('企业会计')
    expect(f.api.detail({ row: { ...row, corporationId: null, corporationName: null } as never }).corporationId).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('导出复用同一platform请求，去掉分页并返回非空二进制base64', async () => {
    const response = {
      data: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer,
      headers: { 'content-type': 'application/vnd.ms-excel' },
    } as AxiosResponse<ArrayBuffer>
    const f = fixture([response])
    await expect(f.api.exportExcel({ accountCode: '0042', status: 1 })).resolves.toEqual({
      fileName: '账套管理.xls', contentType: 'application/vnd.ms-excel',
      base64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString('base64'), byteLength: 4,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/accounting-manage/export-excel', method: 'get',
      params: { corporationId: null, accountCode: '0042', accountingName: '', accountingStandardsApply: '', periodYear: '', status: 1 },
      responseType: 'arraybuffer',
    })
  })

  it('法人和人员候选强制关键字与小页，人员只查在职/返聘', async () => {
    const f = fixture([
      { list: [{ id: 71, name: '测试法人', creditCode: 'hidden' }], total: 1 },
      { list: [{ id: '9007199254740993', realName: '测试人员', username: '00042', mobile: 'hidden' }], total: 1 },
    ])
    await expect(f.api.searchCorporations({ keyword: ' 测试 ', pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [{ id: 71, name: '测试法人' }], total: 1,
    })
    await expect(f.api.searchUsers({ keyword: '测试' })).resolves.toEqual({
      list: [{ id: '9007199254740993', realName: '测试人员', username: '00042', label: '测试人员(00042)' }], total: 1,
    })
    expect(f.calls[0]?.params).toEqual({ order: '', orderField: '', name: '测试', mainInvest: '', pageNo: 2, pageSize: 50 })
    expect(f.calls[1]?.params).toEqual({ pageNo: 1, pageSize: 20, name: '测试', statusList: '1,4' })

    const rejected = fixture()
    await expect(rejected.api.searchCorporations({ keyword: ' ' })).rejects.toThrow('非空关键字')
    await expect(rejected.api.searchUsers({ keyword: '', pageSize: 20 })).rejects.toThrow('非空关键字')
    await expect(rejected.api.searchUsers({ keyword: '人', pageSize: 500 })).rejects.toThrow('1至100')
    expect(rejected.calls).toHaveLength(0)
  })

  it('会计准则、期间和精度候选保留各自ID命名空间与页面过滤', async () => {
    const f = fixture([
      [{ dictType: 'other', dataList: [] }, { dictType: 'accounting_standards_apply', dataList: [{ id: 3, value: '1', label: '企业会计准则' }] }],
      { list: [{ id: 16, year: 2026 }, { id: 17, year: 2027 }, { id: 18, year: 2025 }], total: 3 },
      { list: [{ id: 29, accuracyName: '', currencyType: 0, decimalQuantity: 2, decimalUnitPrice: 4, decimalAmount: 2 }], total: 1 },
    ])
    await expect(f.api.accountingStandardsOptions()).resolves.toEqual({ list: [{ id: 3, value: 1, label: '企业会计准则' }] })
    await expect(f.api.accountingPeriodOptions({ startTime: '2026-04-01', isLongTerm: 1 })).resolves.toEqual({
      list: [{ id: 16, year: 2026 }, { id: 17, year: 2027 }], total: 2,
    })
    await expect(f.api.accuracyOptions()).resolves.toEqual({ list: [{
      id: 29, name: '精度 #29', currencyType: 0, decimalQuantity: 2, decimalUnitPrice: 4, decimalAmount: 2,
    }] })
    expect(f.calls.slice(1).map(call => call.params)).toEqual([{ pageSize: -1, status: 0 }, { pageSize: -1, status: 0 }])
  })

  it('prepare与create复刻PC默认值、条件日期和根ID返回', async () => {
    const f = fixture(['9007199254740993'])
    const prepared = f.api.prepareCreate(draft)
    expect(prepared.draft).toEqual({
      corporationId: 71, accountingName: 'SDK测试账套', contactPhone: '13800000000', contacts: '测试联系人',
      businessAddress: '', taxCode: '', creditCode: 'TEST-CREDIT-2', industry: '测试行业', periodId: 16,
      accuracyId: 29, startTime: '2026-01-01', endTime: '2026-12-31', accountingStandardsApply: 1,
      accountCode: '0043', isLongTerm: 0, status: 0, valueAddedUserId: null,
    })
    await expect(f.api.create(draft)).resolves.toBe('9007199254740993')
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/accounting-manage/create', method: 'post', data: prepared.draft })

    expect(f.api.prepareCreate({ ...draft, isLongTerm: 1, endTime: null }).draft.endTime).toBe('')
    expect(() => f.api.prepareCreate({ ...draft, accountCode: '43' })).toThrow('4位数字')
    expect(() => f.api.prepareCreate({ ...draft, startTime: '2026-12-31', endTime: '2027-01-01' })).toThrow('同一年')
    expect(() => f.api.prepareCreate({ ...draft, endTime: '2025-12-31' })).toThrow('不能早于')
    expect(() => f.api.prepareCreate({ ...draft, contactPhone: '123' })).toThrow('手机号')
    expect(() => f.api.prepareCreate({ ...draft, isLongTerm: 1, endTime: '2026-12-31' })).toThrow('必须省略')
  })

  it('启停只允许相反目标，并复刻PC停用行isEnable保护', async () => {
    const f = fixture([true, true])
    await expect(f.api.setStatus({ id: 9, currentStatus: 0, status: 1 })).resolves.toBe(true)
    await expect(f.api.setStatus({ id: 9, currentStatus: 1, status: 0, isEnable: 1 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/accounting-manage/enableOrStop', method: 'put', data: { id: 9, status: 1 } },
      { url: '/admin-api/finance/accounting-manage/enableOrStop', method: 'put', data: { id: 9, status: 0 } },
    ])
    await expect(f.api.setStatus({ id: 9, currentStatus: 0, status: 0 })).rejects.toThrow('相反')
    await expect(f.api.setStatus({ id: 9, currentStatus: 1, status: 0, isEnable: 0 })).rejects.toThrow('禁止启用')
    expect(f.calls).toHaveLength(2)
  })

  it('坏分页、坏行、空导出和后端错误都不会伪装成功', async () => {
    const f = fixture([
      { list: null, total: 0 },
      { list: [{ ...row, periodId: null }], total: 1 },
      { data: new ArrayBuffer(0), headers: {} } as AxiosResponse<ArrayBuffer>,
      new Error('同一法人只能存在一个启用账套'),
    ])
    await expect(f.api.list()).rejects.toThrow('list或total')
    await expect(f.api.list()).rejects.toThrow('periodId')
    await expect(f.api.exportExcel()).rejects.toThrow('空文件')
    await expect(f.api.create(draft)).rejects.toThrow('只能存在一个启用账套')
    await expect(f.api.list({ periodYear: '26' })).rejects.toThrow('YYYY')
    await expect(f.api.list({ status: 2 as 0 })).rejects.toThrow('0（启用）')
    await expect(f.api.list({ pageSize: 30 as 20 })).rejects.toThrow('10、20、50或100')
  })
})

describe('账套管理AI契约与共享接线要求', () => {
  it('11项能力、公开方法与AI说明一一对应且结构有效', async () => {
    expect(FINANCE_ACCOUNTING_MANAGE_PAGE_PATH).toBe('/dashboard/finance/setting/accounting-manage/list')
    expect(financeAccountingManageCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_ACCOUNTING_MANAGE_METHODS))
    expect(Object.keys(contracts)).toEqual(financeAccountingManageCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_ACCOUNTING_MANAGE_METHODS).map(method => `financeAccountingManage.${method}`))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: financeAccountingManageCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: financeAccountingManageCapabilities, contracts }) as Array<{ code: string }>
    expect(complete.map(issue => issue.code)).toEqual(Array(11).fill('incomplete-evidence'))
  })

  it('锁定详情本地快照、候选ID命名空间、写入防重和启用保护', () => {
    const detail = contracts['finance-accounting-manage-detail']!
    expect(detail.effect).toBe('local')
    expect(detail.boundaries.join(' ')).toContain('详情不发网络请求')
    const create = contracts['finance-accounting-manage-create']!
    expect(create.inputs.corporationId?.lookup?.capabilityId).toBe('finance-accounting-manage-corporation-search')
    expect(create.inputs.periodId?.lookup?.capabilityId).toBe('finance-accounting-manage-accounting-period-options')
    expect(create.inputs.accuracyId?.lookup?.capabilityId).toBe('finance-accounting-manage-accuracy-options')
    expect(create.inputs.valueAddedUserId?.lookup?.capabilityId).toBe('finance-accounting-manage-user-search')
    expect(create.inputs.requestId?.required).toBe(true)
    expect(create.idempotency).toContain('进程内短窗口防重')
    const createDefinition = financeAccountingManageCapabilities.find(item => item.id === 'finance-accounting-manage-create')!
    expect(createDefinition.params.find(item => item.name === 'corporationId')?.lookup).toEqual({
      capabilityId: 'finance-accounting-manage-corporation-search', keywordParam: 'keyword',
    })
    expect(createDefinition.params.find(item => item.name === 'accountingStandardsApply')?.lookup).toBeUndefined()
    expect(createDefinition.params.find(item => item.name === 'periodId')?.lookup).toBeUndefined()
    expect(createDefinition.params.find(item => item.name === 'accuracyId')?.lookup).toBeUndefined()
    const setStatus = contracts['finance-accounting-manage-set-status']!
    expect(setStatus.inputs.isEnable?.meaning).toContain('允许启用')
    expect(setStatus.steps[0]?.mapping).toEqual({ status: 'args.status' })
    expect(setStatus.steps[1]?.mapping).toEqual({ id: 'args.id', currentStatus: 'args.status', status: 'args.currentStatus', isEnable: 'context.restoreIsEnable' })
    expect(contracts['finance-accounting-manage-list']!.output.fields.find(item => item.path === 'list[].corporationId')).toMatchObject({
      nullable: true,
      nullMeaning: expect.stringContaining('历史账套未绑定法人'),
    })
    expect(create.inputs.corporationId?.required).toBe(true)
  })

  it('没有把后端无入口能力编造成编辑/删除，真实验证缺口保持可见', () => {
    for (const contract of Object.values(contracts)) {
      expect(contract.boundaries.join(' ')).toContain('页面没有编辑、删除')
      expect(contract.gaps?.join(' ')).toContain('未自建真实写测试记录')
      expect(contract.evidence.some(item => item.kind === 'browser')).toBe(true)
    }
    expect(Object.keys(contracts).some(id => /update|delete|remove/.test(id))).toBe(false)
  })
})
