import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingRelatedPartySettlementAccountCapability,
  financeSettingRelatedPartySettlementAccountCapabilities,
  FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHODS,
  FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH,
} from '../src/capabilities/finance-setting-related-party-settlement-account.js'
import {
  FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_AI_CONTRACTS as contracts,
  FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-related-party-settlement-account.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { baseDeptDictPermissionCapabilities } from '../src/capabilities/base-dept-dict-permission.js'
import { financeLedgerAccountsCapabilities } from '../src/capabilities/finance-ledger-accounts.js'
import { BASE_AI_CONTRACTS } from '../src/catalog/contracts-base.js'
import { FINANCE_LEDGER_ACCOUNTS_AI_CONTRACTS } from '../src/catalog/contracts-finance-ledger-accounts.js'

type RequestConfig = Parameters<PortalRequest>[0]
const originalAdapter = axios.defaults.adapter
afterEach(() => { axios.defaults.adapter = originalAdapter })

const rawRow = {
  id: '9007199254740993',
  paymentContent: 9,
  payerDebitSubjectId: '1001',
  payerDebitSubjectName: '资产 / 银行存款',
  payerCreditSubjectId: '2001',
  payerCreditSubjectName: '负债 / 应付账款',
  payeeDebitSubjectId: '3001',
  payeeDebitSubjectName: '资产 / 应收账款',
  payeeCreditSubjectId: '4001',
  payeeCreditSubjectName: '资产 / 银行存款',
  status: 1,
  remark: null,
} as const

function setup (...responses: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = responses.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createFinanceSettingRelatedPartySettlementAccountCapability(request), calls }
}

describe('财务设置→关联方结算科目配置PC页面动作', () => {
  it('目录定义锁定页面、权限、platform实例、无module-type和可达写动作', () => {
    expect(financeSettingRelatedPartySettlementAccountCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHODS))
    expect(financeSettingRelatedPartySettlementAccountCapabilities.every(item => item.pagePath === FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH)).toBe(true)
    expect(financeSettingRelatedPartySettlementAccountCapabilities.every(item => item.permission === '/dashboard/finance/setting/related-party-settlement-account')).toBe(true)
    expect(financeSettingRelatedPartySettlementAccountCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingRelatedPartySettlementAccountCapabilities.every(item => item.moduleType === null)).toBe(true)
    expect(financeSettingRelatedPartySettlementAccountCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'finance-setting-related-party-settlement-account-create',
      'finance-setting-related-party-settlement-account-update',
      'finance-setting-related-party-settlement-account-set-status',
    ])
  })

  it('静态锁定菜单、路由、权限按钮、选项接口、真实页面接口和没有DELETE动作', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/finance.js'), 'utf8')
    const listSource = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/related-party-settlement-account/list.vue'), 'utf8')
    const formSource = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/related-party-settlement-account/[mode]/[id].vue'), 'utf8')
    const dictSource = readFileSync(join(root, 'app/portal/utils/system.js'), 'utf8')
    const ledgerSource = readFileSync(join(root, 'app/portal/components/portal/finance/ledger-select/index.vue'), 'utf8')
    expect(menu).toContain("path: '/dashboard/finance/setting/related-party-settlement-account/list'")
    expect(menu).toContain("permission: '/dashboard/finance/setting/related-party-settlement-account'")
    expect(listSource).toContain("getDataListURL: '/admin-api/finance/payment-slip-society-related-settlement/subject-config/page'")
    expect(listSource).toContain("create: 'finance:setting:related-party-settlement-account:create'")
    expect(listSource).toContain("status: 'finance:setting:related-party-settlement-account:status'")
    expect(listSource).toContain("detail: 'finance:setting:related-party-settlement-account:detail'")
    expect(listSource).toContain("http.put('/admin-api/finance/payment-slip-society-related-settlement/subject-config/update'")
    expect(listSource).toContain('status: null')
    expect(listSource).not.toContain('http.delete(')
    expect(formSource).toContain("http.get('/admin-api/finance/related-party-settlement-account/getConfig'")
    expect(formSource).toContain("http.post('/admin-api/finance/payment-slip-society-related-settlement/subject-config/create'")
    expect(formSource).toContain("http.put('/admin-api/finance/payment-slip-society-related-settlement/subject-config/update'")
    expect(formSource).toContain('payeeDebitSubjectId')
    expect(formSource).toContain('payeeCreditSubjectId')
    expect(formSource).toContain('receiverDebitSubjectId')
    expect(dictSource).toContain("http('/admin-api/system/dict-data/grouped-list')")
    expect(listSource).toContain("type=\"finance_related_settlement_content\"")
    expect(ledgerSource).toContain("default: '/admin-api/finance/ledger-accounts/page'")
    expect(ledgerSource).toContain('params: { pageSize: -1 }')

    const catalog = JSON.parse(readFileSync(new URL('../generated/page-catalog.json', import.meta.url), 'utf8')) as {
      items: Array<{ menuPath: string; permission: string; menuSource: string; kind: string; write: boolean; moduleType: number | null }>
    }
    expect(catalog.items.find(item => item.menuPath === FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH)).toEqual(expect.objectContaining({
      permission: '/dashboard/finance/setting/related-party-settlement-account',
      menuSource: 'app/portal/menus/finance.js',
      kind: '列表页(声明式 getDataListURL)',
      write: true,
      moduleType: null,
    }))
  })

  it('默认列表逐字段发送表单与分页参数，并投影页面行字段', async () => {
    const f = setup({ list: [rawRow], total: 1 })
    await expect(f.api.list()).resolves.toEqual({
      list: [rawRow],
      total: 1,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/payment-slip-society-related-settlement/subject-config/page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        paymentContent: '',
        payerSubjectId: '',
        receiverSubjectId: '',
        status: null,
        pageNo: 1,
        pageSize: 20,
      },
    })
    expect(Object.keys(f.calls[0]?.params as object)).toEqual([
      'order', 'orderField', 'paymentContent', 'payerSubjectId', 'receiverSubjectId', 'status', 'pageNo', 'pageSize',
    ])
  })

  it('筛选值、分页和状态按页面字段发送，并不把payeeSubjectId擅自改成页面未使用的字段', async () => {
    const f = setup({ list: [], total: 0 })
    await expect(f.api.list({ paymentContent: '9', payerSubjectId: '1001', receiverSubjectId: '3001', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]?.params).toEqual({
      order: '', orderField: '', paymentContent: '9', payerSubjectId: '1001', receiverSubjectId: '3001', status: 0, pageNo: 2, pageSize: 50,
    })
    expect(f.calls[0]?.params).not.toHaveProperty('payeeSubjectId')
  })

  it('详情按Portal表单源码使用getConfig并只投影表单字段', async () => {
    const f = setup(rawRow)
    await expect(f.api.detail({ id: rawRow.id })).resolves.toEqual({
      id: rawRow.id,
      paymentContent: rawRow.paymentContent,
      payerDebitSubjectId: rawRow.payerDebitSubjectId,
      payerCreditSubjectId: rawRow.payerCreditSubjectId,
      payeeDebitSubjectId: rawRow.payeeDebitSubjectId,
      payeeCreditSubjectId: rawRow.payeeCreditSubjectId,
    })
    expect(f.calls[0]).toEqual({ url: '/admin-api/finance/related-party-settlement-account/getConfig', method: 'get', params: { id: rawRow.id } })
  })

  it('创建草稿默认status=1，保存只提交后端VO字段并返回Long ID', async () => {
    const f = setup('9007199254740994')
    const prepared = f.api.prepareCreate({
      paymentContent: '9',
      payerDebitSubjectId: '1001',
      payerCreditSubjectId: '2001',
      payeeDebitSubjectId: '3001',
      payeeCreditSubjectId: '4001',
    })
    expect(prepared).toEqual({ draft: {
      paymentContent: '9', payerDebitSubjectId: '1001', payerCreditSubjectId: '2001', payeeDebitSubjectId: '3001', payeeCreditSubjectId: '4001', status: 1,
    } })
    await expect(f.api.create(prepared.draft)).resolves.toBe('9007199254740994')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/payment-slip-society-related-settlement/subject-config/create',
      method: 'post',
      data: prepared.draft,
    })
    expect(Object.keys(f.calls[0]?.data as object)).toEqual([
      'paymentContent', 'payerDebitSubjectId', 'payerCreditSubjectId', 'payeeDebitSubjectId', 'payeeCreditSubjectId', 'status',
    ])
    expect(() => f.api.prepareCreate({ ...prepared.draft, payeeDebitSubjectId: '' as never })).toThrow('payeeDebitSubjectId')
  })

  it('编辑只合并业务字段并保留id/status，更新不发送名称字段', async () => {
    const f = setup(true)
    const prepared = f.api.prepareUpdate({ current: rawRow, changes: { paymentContent: 10, payeeCreditSubjectId: '5001' } })
    expect(prepared.previous).toEqual({
      id: rawRow.id, paymentContent: 9, payerDebitSubjectId: '1001', payerCreditSubjectId: '2001', payeeDebitSubjectId: '3001', payeeCreditSubjectId: '4001', status: 1, remark: null,
    })
    expect(prepared.draft).toEqual({
      id: rawRow.id, paymentContent: 10, payerDebitSubjectId: '1001', payerCreditSubjectId: '2001', payeeDebitSubjectId: '3001', payeeCreditSubjectId: '5001', status: 1, remark: null,
    })
    await expect(f.api.update({ draft: prepared.draft })).resolves.toBe(true)
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/payment-slip-society-related-settlement/subject-config/update',
      method: 'put',
      data: prepared.draft,
    })
    expect(f.calls[0]?.data).not.toHaveProperty('payerDebitSubjectName')
    expect(() => f.api.prepareUpdate({ current: rawRow, changes: { status: 0 } as never })).toThrow('不支持字段status')
  })

  it('启停保存Portal整行展开语义，要求绝对目标状态相反并保留previous补偿快照', async () => {
    const f = setup(true)
    const prepared = f.api.prepareSetStatus({ current: rawRow, targetStatus: 0 })
    expect(prepared.previous).toEqual(rawRow)
    expect(prepared.draft).toEqual({ ...rawRow, status: 0 })
    await expect(f.api.setStatus({ draft: prepared.draft })).resolves.toBe(true)
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/payment-slip-society-related-settlement/subject-config/update',
      method: 'put',
      data: { ...rawRow, status: 0 },
    })
    expect(() => f.api.prepareSetStatus({ current: rawRow, targetStatus: 1 })).toThrow('相反')
    const invalid = setup(true)
    await expect(invalid.api.setStatus({ draft: { ...prepared.draft, status: 1 } })).resolves.toBe(true)
    expect(invalid.calls[0]?.data).toMatchObject({ id: rawRow.id, status: 1 })
    expect(() => f.api.prepareSetStatus({ current: { ...rawRow, payeeDebitSubjectId: null }, targetStatus: 0 })).toThrow('payeeDebitSubjectId')
  })

  it('坏参数、坏响应和非true回执不会伪装成功，也不提供删除路径', async () => {
    const bad = setup({ list: null, total: 0 })
    await expect(bad.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(bad.api.list()).rejects.toThrow('list或total')
    expect(bad.calls).toHaveLength(1)
    const badRow = setup({ list: [{ ...rawRow, status: 2 }], total: 1 })
    await expect(badRow.api.list()).rejects.toThrow('status')
    const failed = setup(false)
    await expect(failed.api.update({ draft: { ...rawRow } })).rejects.toThrow('不是true')
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
    const url = String(config.url)
    let data: unknown = { list: [], total: 0 }
    if (url.endsWith('/update')) data = true
    if (url.endsWith('/getConfig')) data = rawRow
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceSettingRelatedPartySettlementAccountCapability(config => call(
    FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH,
    config as PortalRequestConfig,
  ))
  return { api, calls, http }
}

describe('关联方结算科目配置请求上下文与AI契约', () => {
  it('platform请求不发送module-type，保留tenant-id和分页查询串', async () => {
    expect(resolveModuleType(FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH).moduleType).toBeNull()
    const { api, calls, http } = captureHttp()
    await api.list()
    const config = calls[0]!
    expect(config.headers.has('module-type')).toBe(false)
    expect(config.headers.get('tenant-id')).toBe('7')
    const uri = http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')
    expect(uri).toContain('https://biz-api-test.wodecorp.cn/admin-api/finance/payment-slip-society-related-settlement/subject-config/page?')
    expect(uri).toContain('order=&orderField=&paymentContent=&payerSubjectId=&receiverSubjectId=&pageNo=1&pageSize=20')
    expect(uri).not.toContain('status=')
  })

  it('八项页面能力、公开方法与AI说明一一对应且结构有效', async () => {
    expect(Object.keys(contracts)).toEqual(financeSettingRelatedPartySettlementAccountCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHODS).map(method => `financeSettingRelatedPartySettlementAccount.${method}`))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    const definitions = [...baseDeptDictPermissionCapabilities, ...financeLedgerAccountsCapabilities, ...financeSettingRelatedPartySettlementAccountCapabilities]
    const allContracts = { ...BASE_AI_CONTRACTS, ...FINANCE_LEDGER_ACCOUNTS_AI_CONTRACTS, ...contracts }
    const ids = new Set(Object.keys(contracts))
    const structural = validateAiContracts(allContracts, { definitions, contracts: allContracts }).filter((issue: { capabilityId: string }) => ids.has(issue.capabilityId))
    expect(structural).toEqual([])
    const complete = validateAiContracts(allContracts, { profile: 'complete', definitions, contracts: allContracts }).filter((issue: { capabilityId: string }) => ids.has(issue.capabilityId)) as Array<{ code: string }>
    expect(complete.length).toBeGreaterThan(0)
    expect(new Set(complete.map(issue => issue.code))).toEqual(new Set(['incomplete-evidence']))
  })

  it('契约锁定选项lookup、payee数组语义、整行启停映射和无删除边界', () => {
    expect(contracts['finance-setting-related-party-settlement-account-list']?.inputs.paymentContent?.lookup).toEqual({
      capabilityId: 'base-dict-get', args: { dictType: 'finance_related_settlement_content' }, valueField: 'entries[].value', labelField: 'entries[].label',
    })
    expect(contracts['finance-setting-related-party-settlement-account-create']?.inputs.payeeDebitSubjectId?.lookup?.capabilityId).toBe('finance-ledger-account-list')
    expect(contracts['finance-setting-related-party-settlement-account-create']?.inputs.payeeCreditSubjectId?.meaning).toContain('收款方贷方')
    expect(contracts['finance-setting-related-party-settlement-account-prepare-update']?.steps[0]?.mapping).toEqual({ draft: 'result.draft' })
    expect(contracts['finance-setting-related-party-settlement-account-set-status']?.steps[0]?.mapping).toEqual({ status: 'args.draft.status' })
    expect(contracts['finance-setting-related-party-settlement-account-set-status']?.steps.find(step => step.role === 'cancel')?.mapping).toEqual({ draft: 'context.previousDraft' })
    expect(contracts['finance-setting-related-party-settlement-account-create']?.steps.find(step => step.role === 'cancel')?.capabilityId).toBeUndefined()
    expect(contracts['finance-setting-related-party-settlement-account-list']?.boundaries.join('\n')).toContain('不发布后端存在但页面未提供的删除')
    expect(contracts['finance-setting-related-party-settlement-account-detail']?.gaps?.join('\n')).toContain('getConfig')
  })
})
